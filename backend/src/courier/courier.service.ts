import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import axios, { AxiosError } from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { OrderNotificationService } from '../orders/order-notification.service';
import { TelegramNotificationService } from '../telegram/telegram-notification.service';
import { isInsideDhakaAddress } from '../webhook/handlers/dhaka-areas';
import {
  parseCustomFieldValues,
  parseOrderFields,
} from '../common/order-fields';

export type CourierName =
  | 'pathao'
  | 'steadfast'
  | 'redx'
  | 'paperfly'
  | 'manual';

export interface CourierSettings {
  defaultCourier: CourierName;
  autoBookOnConfirm: boolean;
  pathao?: { apiKey: string; secretKey: string; storeId?: string; username?: string; password?: string };
  steadfast?: { apiKey: string; secretKey: string };
  redx?: { apiKey: string };
  paperfly?: { apiKey: string; apiPassword: string };
  // V29: booking-dialog field mapping remembered per courier —
  // { steadfast: { recipientName: 'name', note: 'cf:Product', ... } }
  fieldMap?: Record<string, Record<string, string>>;
}

export interface BookingInput {
  orderId: number;
  pageId: number;
  courier: CourierName;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  codAmount: number;
  weight?: number;
  note?: string;
  // V29: booking dialog extras
  invoice?: string;
  itemDescription?: string;
  pathaoCityId?: number;
  pathaoZoneId?: number;
  pathaoAreaId?: number;
  pathaoStoreId?: string;
  itemQuantity?: number;
  // re-book an order that already has a live courier parcel
  force?: boolean;
}

// V29: which credential fields each courier's dialog may update
const CREDENTIAL_KEYS: Record<string, string[]> = {
  steadfast: ['apiKey', 'secretKey'],
  pathao: ['apiKey', 'secretKey', 'username', 'password', 'storeId'],
};

const PATHAO_BASE = 'https://api-hermes.pathao.com/aladdin/api/v1';

export interface ManualShipmentInput {
  courierName?: CourierName;
  trackingId?: string;
  trackingUrl?: string;
  codAmount?: number;
  weight?: number;
  courierFee?: number;
  bookedAt?: string | Date | null;
}

// FIX 3: courier API timeout — 15s, retry up to 2 times with 2s backoff
const COURIER_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;

@Injectable()
export class CourierService {
  private readonly logger = new Logger(CourierService.name);
  private readonly settingsDir = path.join(
    process.cwd(),
    'storage',
    'courier-settings',
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly notification: OrderNotificationService,
    private readonly telegram: TelegramNotificationService,
  ) {}

  /**
   * Single entry point for "auto-book a courier the moment an order becomes
   * CONFIRMED" — call this from every place an order's status transitions to
   * CONFIRMED (bot draft-finalize, manual dashboard confirm, call-confirm,
   * web-order payment confirm). Previously this logic lived inline only in
   * the bot's draft-finalize path, so a COD order confirmed later via the
   * dashboard or a confirmation call never got auto-booked even with
   * autoBookOnConfirm enabled — the setting only ever fired for orders that
   * were already CONFIRMED at creation (advance payment paid upfront).
   * Safe to call from multiple paths: skips if a shipment already exists
   * for this order, so it can never double-book with the courier.
   */
  async autoBookOnConfirm(pageId: number, orderId: number): Promise<void> {
    try {
      const settings = this.parseSettings(await this.getSettings(pageId));
      if (!settings.autoBookOnConfirm || settings.defaultCourier === 'manual')
        return;

      const existing = await this.prisma.courierShipment.findUnique({
        where: { orderId },
      });
      if (existing) return; // already booked — never re-book automatically

      const order: any = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order || order.pageIdRef !== pageId) return;

      const subtotal = (order.items || []).reduce(
        (s: number, i: any) => s + i.unitPrice * i.qty,
        0,
      );
      await this.bookShipment(pageId, {
        orderId,
        pageId,
        courier: settings.defaultCourier,
        recipientName: order.customerName || 'Customer',
        recipientPhone: order.phone || '',
        recipientAddress: order.address || '',
        codAmount: subtotal,
      });
      this.telegram
        .notify(
          pageId,
          `📦 Order #${orderId} auto-booked with ${settings.defaultCourier}`,
        )
        .catch(() => {});
    } catch (e: any) {
      this.logger.error(`[AutoBook] Failed for order ${orderId}: ${e.message}`);
      this.telegram
        .notify(
          pageId,
          `⚠️ Auto courier booking failed for Order #${orderId}: ${e.message}`,
        )
        .catch(() => {});
    }
  }

  // ── Book a shipment ───────────────────────────────────────────────────────
  async bookShipment(pageId: number, input: BookingInput): Promise<any> {
    const order = await this.prisma.order.findUnique({
      where: { id: input.orderId },
    });
    if (!order || order.pageIdRef !== pageId)
      throw new NotFoundException('Order not found');

    const settings = this.parseSettings(await this.getSettings(pageId));

    // A second API booking would create a duplicate parcel at the courier —
    // only allowed when the merchant explicitly re-books (force).
    const prior = await this.prisma.courierShipment.findUnique({
      where: { orderId: input.orderId },
    });
    if (
      input.courier !== 'manual' &&
      !input.force &&
      prior?.trackingId &&
      prior.courierName !== 'manual' &&
      prior.status !== 'cancelled'
    ) {
      throw new BadRequestException(
        `Order #${input.orderId} already booked with ${prior.courierName} (${prior.trackingId})`,
      );
    }

    let trackingId: string | null = null;
    let trackingUrl: string | null = null;
    let rawResponse: any = null;

    if (input.courier !== 'manual') {
      // FIX 3: with retry
      const result = await this.callWithRetry(input.courier, settings, input);
      trackingId = result.trackingId;
      trackingUrl = result.trackingUrl;
      rawResponse = result.raw;
    } else {
      // Auto-generate unique tracking ID for manual courier
      const date = new Date();
      const ymd = `${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}`;
      const rand = Math.floor(1000 + Math.random() * 9000);
      trackingId = `MCR-${ymd}-${input.orderId}-${rand}`;
    }

    const existing = prior;
    const data = {
      pageId,
      courierName: input.courier,
      trackingId: trackingId ?? null,
      trackingUrl: trackingUrl ?? null,
      status: 'booked',
      codAmount: Number(input.codAmount) || 0,
      weight: Number(input.weight) || 0.5,
      bookedAt: new Date(),
      rawResponse: rawResponse ? JSON.stringify(rawResponse) : null,
    };

    const shipment = existing
      ? await this.prisma.courierShipment.update({
          where: { orderId: input.orderId },
          data,
        })
      : await this.prisma.courierShipment.create({
          data: { ...data, orderId: input.orderId },
        });

    this.logger.log(
      `[Courier] Booked: order=${input.orderId} courier=${input.courier} tracking=${trackingId}`,
    );

    // Fire-and-forget: notify customer via Messenger
    void this.notification.notifyCourierSent(pageId, input.orderId, {
      courierName: input.courier,
      trackingId: trackingId,
    });

    return shipment;
  }

  // ── FIX 3: Retry wrapper ──────────────────────────────────────────────────
  private async callWithRetry(
    courier: CourierName,
    settings: CourierSettings,
    input: BookingInput,
    attempt = 1,
  ): Promise<{
    trackingId: string | null;
    trackingUrl: string | null;
    raw: any;
  }> {
    try {
      return await this.callCourierApi(courier, settings, input);
    } catch (e: any) {
      const isRetryable = this.isRetryableError(e);
      if (attempt < MAX_RETRIES && isRetryable) {
        const delay = attempt * 2000;
        this.logger.warn(
          `[Courier] ${courier} attempt ${attempt} failed (${e.message}), retrying in ${delay}ms...`,
        );
        await new Promise((r) => setTimeout(r, delay));
        return this.callWithRetry(courier, settings, input, attempt + 1);
      }
      // FIX 3: detailed failure logging
      this.logger.error(
        `[Courier] ${courier} FAILED after ${attempt} attempt(s): ${e.message} ` +
          `| Status: ${(e as AxiosError)?.response?.status ?? 'N/A'} ` +
          `| Response: ${JSON.stringify((e as AxiosError)?.response?.data ?? {}).slice(0, 200)}`,
      );
      throw e;
    }
  }

  // Network errors and 5xx are retryable; 4xx (bad API key etc.) are not
  private isRetryableError(e: any): boolean {
    if (!e.response) return true; // network error
    const status = e.response?.status ?? 0;
    return status >= 500;
  }

  // ── Bulk book ─────────────────────────────────────────────────────────────
  async bulkBook(pageId: number, orderIds: number[], courier: CourierName) {
    const results: any[] = [];
    let success = 0,
      failed = 0;

    for (const orderId of orderIds) {
      try {
        const order: any = await this.prisma.order.findUnique({
          where: { id: orderId },
          include: { items: true },
        });
        if (!order || order.pageIdRef !== pageId) {
          failed++;
          results.push({ orderId, success: false, error: 'Not found' });
          continue;
        }

        const subtotal = (order.items || []).reduce(
          (s: number, i: any) => s + i.unitPrice * i.qty,
          0,
        );
        const shipment = await this.bookShipment(pageId, {
          orderId,
          pageId,
          courier,
          recipientName: order.customerName || 'Customer',
          recipientPhone: order.phone || '',
          recipientAddress: order.address || '',
          codAmount: subtotal,
        });
        results.push({
          orderId,
          success: true,
          trackingId: shipment.trackingId,
        });
        success++;
      } catch (e: any) {
        results.push({ orderId, success: false, error: e.message });
        failed++;
      }
    }
    return { success, failed, results };
  }

  async trackShipment(pageId: number, orderId: number) {
    const s = await this.prisma.courierShipment.findUnique({
      where: { orderId },
    });
    if (!s || s.pageId !== pageId)
      throw new NotFoundException('Shipment not found');
    return s;
  }

  /** Normalizes a raw courier-API status string into our internal shipment status vocabulary. */
  normalizeCourierStatus(raw: string): string {
    const s = (raw || '').toLowerCase();
    if (['delivered', 'deliver', 'success'].includes(s)) return 'delivered';
    if (['returned', 'return', 'cancelled', 'canceled', 'failed'].includes(s))
      return 'returned';
    if (
      ['picked', 'picked_up', 'in_transit', 'intransit', 'on_the_way'].includes(
        s,
      )
    )
      return 'in_transit';
    return s;
  }

  /**
   * Calls the courier's real tracking API (not the cached CourierShipment.status
   * row) and returns the normalized status, or null if the courier has no live
   * tracking endpoint wired up here, or the call fails.
   */
  async getLiveStatus(
    courier: CourierName,
    settings: CourierSettings,
    trackingId: string,
  ): Promise<string | null> {
    try {
      if (courier === 'steadfast') {
        // trackingId holds Steadfast's tracking_code (see bookSteadfast), so
        // it must be looked up by tracking code, not consignment id
        const res = await axios.get(
          `https://portal.packzy.com/api/v1/status_by_trackingcode/${encodeURIComponent(trackingId)}`,
          {
            headers: {
              'Api-Key': settings.steadfast?.apiKey,
              'Secret-Key': settings.steadfast?.secretKey,
            },
            timeout: COURIER_TIMEOUT_MS,
          },
        );
        const raw = res.data?.delivery_status;
        return raw ? this.normalizeCourierStatus(raw) : null;
      }
      if (courier === 'redx') {
        const res = await axios.get(
          `https://openapi.redx.com.bd/v1.0.0-beta/parcel/track/${trackingId}`,
          {
            headers: { 'API-ACCESS-TOKEN': `Bearer ${settings.redx?.apiKey}` },
            timeout: COURIER_TIMEOUT_MS,
          },
        );
        const raw = res.data?.info?.status;
        return raw ? this.normalizeCourierStatus(raw) : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  async listShipments(pageId: number, status?: string) {
    const where: any = { pageId };
    if (status) where.status = status;
    return this.prisma.courierShipment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        order: {
          select: {
            id: true,
            customerName: true,
            phone: true,
            address: true,
            status: true,
          },
        },
      },
    });
  }

  async cancelShipment(pageId: number, orderId: number) {
    const s = await this.prisma.courierShipment.findUnique({
      where: { orderId },
    });
    if (!s || s.pageId !== pageId)
      throw new NotFoundException('Shipment not found');
    return this.prisma.courierShipment.update({
      where: { orderId },
      data: { status: 'cancelled' },
    });
  }

  async upsertManualShipment(
    pageId: number,
    orderId: number,
    input: ManualShipmentInput,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order || order.pageIdRef !== pageId)
      throw new NotFoundException('Order not found');

    const existing = await this.prisma.courierShipment.findUnique({
      where: { orderId },
    });
    const subtotal = (order.items || []).reduce(
      (s: number, i: any) => s + i.unitPrice * i.qty,
      0,
    );
    const courierName = this.isCourierName(input?.courierName)
      ? input.courierName
      : (existing?.courierName as CourierName | undefined) || 'manual';
    const bookedAt =
      input?.bookedAt === null
        ? null
        : input?.bookedAt
          ? new Date(input.bookedAt)
          : existing?.bookedAt || new Date();

    const data = {
      pageId,
      courierName,
      trackingId: input?.trackingId?.trim() || null,
      trackingUrl: input?.trackingUrl?.trim() || null,
      status: existing?.status || 'booked',
      codAmount:
        input?.codAmount !== undefined
          ? Number(input.codAmount) || 0
          : existing?.codAmount || subtotal,
      weight:
        input?.weight !== undefined
          ? Number(input.weight) || 0.5
          : existing?.weight || 0.5,
      courierFee:
        input?.courierFee !== undefined && input?.courierFee !== null
          ? Number(input.courierFee) || 0
          : (existing?.courierFee ?? null),
      bookedAt,
    };

    return existing
      ? this.prisma.courierShipment.update({ where: { orderId }, data })
      : this.prisma.courierShipment.create({
          data: {
            ...data,
            orderId,
            rawResponse: null,
          },
        });
  }

  async getSettings(pageId: number): Promise<string | null> {
    const file = this.settingsFile(pageId);
    try {
      if (!fs.existsSync(file)) return null;
      return fs.readFileSync(file, 'utf8');
    } catch (e: any) {
      this.logger.error(
        `[Courier] Failed to read settings for page=${pageId}: ${e.message}`,
      );
      return null;
    }
  }

  async saveSettings(pageId: number, settings: CourierSettings) {
    const next = this.normalizeSettings(settings);
    const file = this.settingsFile(pageId);
    try {
      fs.mkdirSync(this.settingsDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
      return next;
    } catch (e: any) {
      this.logger.error(
        `[Courier] Failed to save settings for page=${pageId}: ${e.message}`,
      );
      throw new BadRequestException('Failed to save courier settings');
    }
  }

  parseSettings(raw: string | null): CourierSettings {
    try {
      return this.normalizeSettings(JSON.parse(raw || '{}'));
    } catch {
      return this.defaultSettings();
    }
  }

  private settingsFile(pageId: number) {
    return path.join(this.settingsDir, `page-${pageId}.json`);
  }

  private defaultSettings(): CourierSettings {
    return {
      defaultCourier: 'manual',
      autoBookOnConfirm: false,
      pathao: { apiKey: '', secretKey: '', storeId: '', username: '', password: '' },
      steadfast: { apiKey: '', secretKey: '' },
      redx: { apiKey: '' },
      paperfly: { apiKey: '', apiPassword: '' },
    };
  }

  private normalizeSettings(input: any): CourierSettings {
    const defaults = this.defaultSettings();
    const defaultCourier = this.isCourierName(input?.defaultCourier)
      ? input.defaultCourier
      : defaults.defaultCourier;

    return {
      defaultCourier,
      autoBookOnConfirm: Boolean(input?.autoBookOnConfirm),
      pathao: {
        apiKey: String(input?.pathao?.apiKey || ''),
        secretKey: String(input?.pathao?.secretKey || ''),
        storeId: String(input?.pathao?.storeId || ''),
        username: String(input?.pathao?.username || ''),
        password: String(input?.pathao?.password || ''),
      },
      steadfast: {
        apiKey: String(input?.steadfast?.apiKey || ''),
        secretKey: String(input?.steadfast?.secretKey || ''),
      },
      redx: {
        apiKey: String(input?.redx?.apiKey || ''),
      },
      paperfly: {
        apiKey: String(input?.paperfly?.apiKey || ''),
        apiPassword: String(input?.paperfly?.apiPassword || ''),
      },
      fieldMap: this.normalizeFieldMap(input?.fieldMap),
    };
  }

  private normalizeFieldMap(raw: any): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const courier of ['steadfast', 'pathao']) {
      const m = raw[courier];
      if (!m || typeof m !== 'object') continue;
      out[courier] = Object.fromEntries(
        Object.entries(m)
          .filter(([k, v]) => /^[a-zA-Z]{1,30}$/.test(k) && typeof v === 'string')
          .map(([k, v]) => [k, String(v).slice(0, 80)]),
      );
    }
    return out;
  }

  // ── V29: Booking dialog support ───────────────────────────────────────────

  /** "abc...wxyz" — enough for the merchant to recognise a saved key. */
  private maskSecret(v?: string): string {
    const s = String(v || '');
    if (!s) return '';
    return s.length <= 8 ? '••••' : `${s.slice(0, 3)}...${s.slice(-4)}`;
  }

  /**
   * Saves only the credential fields the merchant actually typed — a blank
   * input means "keep the current value", as the dialog shows only masks.
   */
  async saveCredentials(pageId: number, courier: string, body: any) {
    const keys = CREDENTIAL_KEYS[courier];
    if (!keys) throw new BadRequestException(`Unknown courier: ${courier}`);
    const settings = this.parseSettings(await this.getSettings(pageId));
    const current: any = { ...((settings as any)[courier] || {}) };
    for (const k of keys) {
      const v = typeof body?.[k] === 'string' ? body[k].trim() : '';
      if (v) current[k] = v;
    }
    (settings as any)[courier] = current;
    await this.saveSettings(pageId, settings);
    return this.credentialStatus(settings);
  }

  private credentialStatus(settings: CourierSettings) {
    const sf = settings.steadfast || { apiKey: '', secretKey: '' };
    const pa: any = settings.pathao || {};
    return {
      steadfast: {
        configured: Boolean(sf.apiKey && sf.secretKey),
        apiKey: this.maskSecret(sf.apiKey),
        secretKey: this.maskSecret(sf.secretKey),
      },
      pathao: {
        configured: Boolean(pa.apiKey && pa.secretKey && pa.username && pa.password),
        apiKey: this.maskSecret(pa.apiKey),
        secretKey: this.maskSecret(pa.secretKey),
        username: pa.username || '',
        password: pa.password ? '••••' : '',
        storeId: pa.storeId || '',
      },
    };
  }

  async saveFieldMap(pageId: number, courier: string, map: any) {
    if (!CREDENTIAL_KEYS[courier])
      throw new BadRequestException(`Unknown courier: ${courier}`);
    const settings = this.parseSettings(await this.getSettings(pageId));
    settings.fieldMap = this.normalizeFieldMap({
      ...(settings.fieldMap || {}),
      [courier]: map,
    });
    await this.saveSettings(pageId, settings);
    return settings.fieldMap[courier] || {};
  }

  /**
   * Everything the booking dialog needs for one order: the selectable value
   * sources (built-in order data + the order's custom field values), the
   * remembered field mapping, masked credentials and any existing shipment.
   */
  async getBookingDraft(pageId: number, orderId: number) {
    const order: any = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, courierShipment: true },
    });
    if (!order || order.pageIdRef !== pageId)
      throw new NotFoundException('Order not found');
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: {
        orderFieldsJson: true,
        deliveryFeeInsideDhaka: true,
        deliveryFeeOutsideDhaka: true,
      },
    });
    const settings = this.parseSettings(await this.getSettings(pageId));

    const items: any[] = order.items || [];
    const subtotal = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
    const discounts =
      (order.loyaltyDiscountAmount || 0) +
      (order.happyHourDiscountAmount || 0) +
      (order.milestoneDiscountAmount || 0);
    const deliveryFee =
      order.deliveryFee ??
      (isInsideDhakaAddress(order.address || '', page)
        ? (page?.deliveryFeeInsideDhaka ?? 80)
        : (page?.deliveryFeeOutsideDhaka ?? 120));
    const productsText = items
      .map((i) => `${i.productName || i.productCode}${i.qty > 1 ? ` ×${i.qty}` : ''}`)
      .join(', ');
    const totalQty = items.reduce((s, i) => s + (i.qty || 0), 0);

    const sources: { key: string; label: string; value: string }[] = [
      { key: 'invoice', label: 'Invoice (INV-ID)', value: `INV-${order.id}` },
      { key: 'orderId', label: 'Order ID', value: String(order.id) },
      { key: 'name', label: 'Name', value: order.customerName || '' },
      { key: 'phone', label: 'Phone', value: order.phone || '' },
      { key: 'address', label: 'Address', value: order.address || '' },
      {
        key: 'total',
        label: 'Total (delivery সহ)',
        value: String(Math.max(0, subtotal - discounts + deliveryFee)),
      },
      { key: 'subtotal', label: 'Subtotal (products)', value: String(subtotal) },
      { key: 'products', label: 'Products', value: productsText },
      { key: 'quantity', label: 'Quantity', value: String(totalQty || 1) },
      { key: 'note', label: 'Order note', value: order.orderNote || '' },
    ];
    // Page fields first (in the merchant's order), then any other captured
    // values such as product variant answers (Size, Color)
    const values = parseCustomFieldValues(order.customFieldsJson);
    const labels = [
      ...parseOrderFields(page?.orderFieldsJson).map((f) => f.label),
      ...Object.keys(values),
    ];
    for (const label of [...new Set(labels)]) {
      sources.push({ key: `cf:${label}`, label, value: values[label] ?? '' });
    }

    const s = order.courierShipment;
    return {
      orderId: order.id,
      paymentStatus: order.paymentStatus,
      sources,
      fieldMap: settings.fieldMap || {},
      credentials: this.credentialStatus(settings),
      shipment: s
        ? {
            courierName: s.courierName,
            trackingId: s.trackingId,
            trackingUrl: s.trackingUrl,
            status: s.status,
            bookedAt: s.bookedAt,
          }
        : null,
    };
  }

  // ── V29: Pathao location lookups (city → zone → area) + stores ───────────

  private pathaoTokenCache = new Map<string, { token: string; exp: number }>();

  private async pathaoToken(cfg: CourierSettings['pathao']): Promise<string> {
    if (!cfg?.apiKey || !cfg?.secretKey)
      throw new BadRequestException('Pathao Client ID / Client Secret দেওয়া হয়নি');
    if (!cfg?.username || !cfg?.password)
      throw new BadRequestException('Pathao merchant email/password দেওয়া হয়নি');
    const cacheKey = `${cfg.apiKey}:${cfg.username}:${cfg.password}`;
    const hit = this.pathaoTokenCache.get(cacheKey);
    if (hit && hit.exp > Date.now()) return hit.token;
    let res;
    try {
      res = await axios.post(
        `${PATHAO_BASE}/issue-token`,
        {
          client_id: cfg.apiKey,
          client_secret: cfg.secretKey,
          grant_type: 'password',
          username: cfg.username,
          password: cfg.password,
        },
        { timeout: COURIER_TIMEOUT_MS },
      );
    } catch (e: any) {
      if (e?.response?.status && e.response.status < 500)
        throw new BadRequestException(
          'Pathao login failed — Client ID/Secret বা email/password ভুল',
        );
      throw e;
    }
    const token = res.data?.access_token;
    if (!token) throw new BadRequestException('Pathao token পাওয়া যায়নি');
    const ttlMs = Math.max(60, Number(res.data?.expires_in) || 3600) * 1000;
    this.pathaoTokenCache.set(cacheKey, {
      token,
      exp: Date.now() + ttlMs - 60_000,
    });
    return token;
  }

  private async pathaoGet(pageId: number, pathSuffix: string): Promise<any[]> {
    const settings = this.parseSettings(await this.getSettings(pageId));
    const token = await this.pathaoToken(settings.pathao);
    const res = await axios.get(`${PATHAO_BASE}${pathSuffix}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: COURIER_TIMEOUT_MS,
    });
    const data = res.data?.data?.data ?? res.data?.data ?? [];
    return Array.isArray(data) ? data : [];
  }

  async pathaoCities(pageId: number) {
    const rows = await this.pathaoGet(pageId, '/city-list');
    return rows.map((r) => ({ id: Number(r.city_id), name: String(r.city_name) }));
  }

  async pathaoZones(pageId: number, cityId: number) {
    const rows = await this.pathaoGet(pageId, `/cities/${Number(cityId)}/zone-list`);
    return rows.map((r) => ({ id: Number(r.zone_id), name: String(r.zone_name) }));
  }

  async pathaoAreas(pageId: number, zoneId: number) {
    const rows = await this.pathaoGet(pageId, `/zones/${Number(zoneId)}/area-list`);
    return rows.map((r) => ({ id: Number(r.area_id), name: String(r.area_name) }));
  }

  async pathaoStores(pageId: number) {
    const rows = await this.pathaoGet(pageId, '/stores');
    return rows.map((r) => ({ id: String(r.store_id), name: String(r.store_name) }));
  }

  private isCourierName(value: unknown): value is CourierName {
    return (
      value === 'pathao' ||
      value === 'steadfast' ||
      value === 'redx' ||
      value === 'paperfly' ||
      value === 'manual'
    );
  }

  // ── Courier API adapters ──────────────────────────────────────────────────
  private async callCourierApi(
    courier: CourierName,
    settings: CourierSettings,
    input: BookingInput,
  ): Promise<{
    trackingId: string | null;
    trackingUrl: string | null;
    raw: any;
  }> {
    switch (courier) {
      case 'pathao':
        return this.bookPathao(settings.pathao, input);
      case 'steadfast':
        return this.bookSteadfast(settings.steadfast, input);
      case 'redx':
        return this.bookRedx(settings.redx, input);
      case 'paperfly':
        return this.bookPaperfly(settings.paperfly, input);
      default:
        throw new BadRequestException(`Unknown courier: ${courier}`);
    }
  }

  private async bookPathao(
    cfg: CourierSettings['pathao'],
    input: BookingInput,
  ) {
    const token = await this.pathaoToken(cfg);
    const storeId = Number(input.pathaoStoreId || cfg?.storeId);
    if (!storeId)
      throw new BadRequestException('Pathao Store select করা হয়নি');

    // City/zone/area only when actually chosen (booking dialog). Never send a
    // placeholder id — that silently books the parcel into the wrong area.
    const location: Record<string, number> = {};
    if (input.pathaoCityId) location.recipient_city = Number(input.pathaoCityId);
    if (input.pathaoZoneId) location.recipient_zone = Number(input.pathaoZoneId);
    if (input.pathaoAreaId) location.recipient_area = Number(input.pathaoAreaId);

    let res;
    try {
      res = await axios.post(
        `${PATHAO_BASE}/orders`,
        {
          store_id: storeId,
          merchant_order_id: input.invoice || String(input.orderId),
          recipient_name: input.recipientName,
          recipient_phone: this.localBdPhone(input.recipientPhone),
          recipient_address: input.recipientAddress,
          ...location,
          delivery_type: 48,
          item_type: 2,
          special_instruction: input.note || '',
          item_quantity: Math.max(1, Math.round(input.itemQuantity || 1)),
          item_weight: input.weight ?? 0.5,
          item_description: input.itemDescription || '',
          amount_to_collect: Math.round(input.codAmount || 0),
        },
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: COURIER_TIMEOUT_MS,
        },
      );
    } catch (e: any) {
      const status = e?.response?.status;
      if (status && status < 500) {
        const d = e.response.data;
        const detail = d?.errors
          ? Object.values(d.errors).flat().join(', ')
          : d?.message;
        throw new BadRequestException(`Pathao: ${detail || 'booking rejected'}`);
      }
      throw e;
    }
    return {
      trackingId: res.data?.data?.consignment_id || null,
      trackingUrl: res.data?.data?.consignment_id
        ? `https://pathao.com/t/${res.data.data.consignment_id}`
        : null,
      raw: res.data,
    };
  }

  private async bookSteadfast(
    cfg: CourierSettings['steadfast'],
    input: BookingInput,
  ) {
    if (!cfg?.apiKey || !cfg?.secretKey)
      throw new BadRequestException('Steadfast API Key / Secret Key দেওয়া হয়নি');
    let res;
    try {
      res = await axios.post(
        'https://portal.packzy.com/api/v1/create_order',
        {
          invoice: input.invoice || String(input.orderId),
          recipient_name: input.recipientName,
          recipient_phone: this.localBdPhone(input.recipientPhone),
          recipient_address: input.recipientAddress,
          cod_amount: input.codAmount,
          note: input.note || '',
          ...(input.itemDescription
            ? { item_description: input.itemDescription }
            : {}),
        },
        {
          headers: { 'Api-Key': cfg.apiKey, 'Secret-Key': cfg.secretKey },
          timeout: COURIER_TIMEOUT_MS,
        },
      );
    } catch (e: any) {
      const status = e?.response?.status;
      if (status && status < 500) {
        const d = e.response.data;
        const detail = d?.errors
          ? Object.values(d.errors).flat().join(', ')
          : d?.message;
        throw new BadRequestException(
          `Steadfast: ${detail || (status === 401 ? 'API Key / Secret Key ভুল' : 'booking rejected')}`,
        );
      }
      throw e;
    }
    // Steadfast reports validation errors (e.g. duplicate invoice) with an
    // HTTP 200 and status != 200 in the body
    if (res.data?.status && Number(res.data.status) !== 200) {
      const detail = res.data?.errors
        ? Object.values(res.data.errors).flat().join(', ')
        : res.data?.message;
      throw new BadRequestException(`Steadfast: ${detail || 'booking rejected'}`);
    }
    return {
      trackingId: res.data?.consignment?.tracking_code || null,
      trackingUrl: res.data?.consignment?.tracking_code
        ? `https://steadfast.com.bd/t/${res.data.consignment.tracking_code}`
        : null,
      raw: res.data,
    };
  }

  /** "+8801712345678" / "01712-345678" → "01712345678" (couriers want 11 digits). */
  private localBdPhone(phone: string): string {
    const digits = String(phone || '')
      .replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))
      .replace(/\D/g, '');
    return digits.startsWith('880') ? digits.slice(2) : digits;
  }

  private async bookRedx(cfg: CourierSettings['redx'], input: BookingInput) {
    if (!cfg?.apiKey)
      throw new BadRequestException('RedX API key not configured');
    const res = await axios.post(
      'https://openapi.redx.com.bd/v1.0.0-beta/parcel',
      {
        customer_name: input.recipientName,
        customer_phone: input.recipientPhone,
        delivery_area: input.recipientAddress,
        delivery_area_id: 1,
        merchant_invoice_id: String(input.orderId),
        cash_collection_amount: input.codAmount,
        parcel_weight: (input.weight ?? 0.5) * 1000,
      },
      {
        headers: { 'API-ACCESS-TOKEN': `Bearer ${cfg.apiKey}` },
        timeout: COURIER_TIMEOUT_MS,
      },
    );
    return {
      trackingId: res.data?.tracking_id || null,
      trackingUrl: null,
      raw: res.data,
    };
  }

  private async bookPaperfly(
    cfg: CourierSettings['paperfly'],
    input: BookingInput,
  ) {
    if (!cfg?.apiKey)
      throw new BadRequestException('Paperfly API key not configured');
    const auth = Buffer.from(`${cfg.apiKey}:${cfg.apiPassword}`).toString(
      'base64',
    );
    const res = await axios.post(
      'https://merchant.paperfly.com.bd/api/merchant/order/create/',
      [
        {
          merchant_order_id: String(input.orderId),
          customer_name: input.recipientName,
          customer_mobile: input.recipientPhone,
          shipping_address: input.recipientAddress,
          cod_amount: input.codAmount,
          order_weight: (input.weight ?? 0.5) * 1000,
          package_description: `Order #${input.orderId}`,
        },
      ],
      {
        headers: { Authorization: `Basic ${auth}` },
        timeout: COURIER_TIMEOUT_MS,
      },
    );
    return {
      trackingId: res.data?.[0]?.tracking_id || null,
      trackingUrl: null,
      raw: res.data,
    };
  }

  // ── V10/V17: Get courier tutorial videos (set by admin) ────────────────────
  getTutorials(): Record<string, string> {
    try {
      const fs = require('fs');
      const path = require('path');
      // V17: prefer unified tutorials.json, fall back to old courier-tutorials.json
      const unified = path.join(process.cwd(), 'storage', 'tutorials.json');
      if (fs.existsSync(unified)) {
        const data = JSON.parse(fs.readFileSync(unified, 'utf8'));
        return (data.courier as Record<string, string>) || {};
      }
      const legacy = path.join(
        process.cwd(),
        'storage',
        'courier-tutorials.json',
      );
      if (!fs.existsSync(legacy)) return {};
      return JSON.parse(fs.readFileSync(legacy, 'utf8'));
    } catch {
      return {};
    }
  }

  // ── V17: Get full tutorials config (for client use) ────────────────────────
  getFullTutorials(): Record<string, any> {
    try {
      const fs = require('fs');
      const path = require('path');
      const unified = path.join(process.cwd(), 'storage', 'tutorials.json');
      if (fs.existsSync(unified))
        return JSON.parse(fs.readFileSync(unified, 'utf8'));
      const courier = this.getTutorials();
      return { courier, facebookAccessToken: '', generalOnboarding: '', pageConnect: '' };
    } catch {
      return { courier: {}, facebookAccessToken: '', generalOnboarding: '', pageConnect: '' };
    }
  }
}
