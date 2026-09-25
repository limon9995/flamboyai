import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { PageService } from '../page/page.service';
import { ProductsService } from '../products/products.service';
import { OrdersService } from '../orders/orders.service';
import { MemoService } from '../memo/memo.service';
import { PrintService } from '../print/print.service';
import { BotKnowledgeService } from '../bot-knowledge/bot-knowledge.service';
import { CallService } from '../call/call.service';
import { TtsService } from '../call/tts.service';
import { VisionOpsService } from '../vision-ops/vision-ops.service';
import { OcrService } from '../ocr/ocr.service';
import { WalletService } from '../wallet/wallet.service';
import { CourierService } from '../courier/courier.service';
import { CourierAccountingService } from '../courier/courier-accounting.service';
import { OrderNotificationService } from '../orders/order-notification.service';
import { TelegramService } from '../common/telegram.service';
import { TelegramNotificationService } from '../telegram/telegram-notification.service';
import { AdminService } from '../admin/admin.service';
import { PricingService } from '../pricing/pricing.service';
import { PartnerService } from '../partner/partner.service';
import {
  normalizeOrderFields,
  parseOrderFields,
} from '../common/order-fields';
import {
  haversineKm,
  isRestaurantReady,
  isValidLat,
  isValidLng,
  MAX_DELIVERY_SLABS,
  parsePriceVariants,
  parseSlabs,
  parseBusinessHours,
  resolveDeliveryFee,
} from '../common/restaurant-delivery';
import {
  CardButtonConfig,
  MAX_CARD_BUTTONS,
  parseCardButtons,
} from '../common/product-card-buttons';

@Injectable()
export class ClientDashboardService {
  private readonly modeAccessMap: Record<string, string> = {
    automationOn: 'automationAllowed',
    ocrOn: 'ocrAllowed',
    infoModeOn: 'infoModeAllowed',
    orderModeOn: 'orderModeAllowed',
    printModeOn: 'printModeAllowed',
    callConfirmModeOn: 'callConfirmModeAllowed',
    memoSaveModeOn: 'memoSaveModeAllowed',
    memoTemplateModeOn: 'memoTemplateModeAllowed',
    autoMemoDesignModeOn: 'autoMemoDesignModeAllowed',
    commentReplyOn: 'commentReplyAllowed',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly pageService: PageService,
    private readonly productsService: ProductsService,
    private readonly ordersService: OrdersService,
    private readonly memoService: MemoService,
    private readonly printService: PrintService,
    private readonly botKnowledgeService: BotKnowledgeService,
    private readonly callService: CallService,
    private readonly ttsService: TtsService,
    private readonly visionOps: VisionOpsService,
    private readonly ocrService: OcrService,
    private readonly walletService: WalletService,
    private readonly courierService: CourierService,
    private readonly courierAccounting: CourierAccountingService,
    private readonly orderNotification: OrderNotificationService,
    private readonly telegram: TelegramService,
    private readonly adminService: AdminService,
    private readonly telegramNotif: TelegramNotificationService,
    private readonly pricing: PricingService,
    private readonly partner: PartnerService,
  ) {}

  // ── Summary ────────────────────────────────────────────────────────────────
  async getSummary(pageId: number) {
    const page: any = await this.pageService.getById(pageId);
    const [orders, products] = await Promise.all([
      this.prisma.order.findMany({
        where: { pageIdRef: pageId },
        select: { status: true, callStatus: true, negotiationRequested: true },
      }),
      this.prisma.product.count({ where: { pageId } }),
    ]);
    return {
      page: {
        id: page.id,
        pageId: page.pageId,
        pageName: page.pageName,
        businessName: page.businessName || '',
      },
      metrics: {
        totalOrders: orders.length,
        confirmedOrders: orders.filter((o) => o.status === 'CONFIRMED').length,
        pendingOrders: orders.filter((o) =>
          ['RECEIVED', 'PENDING'].includes(o.status),
        ).length,
        issueOrders: orders.filter((o) => o.status === 'ISSUE').length,
        products,
        pendingCalls: orders.filter((o) => o.callStatus === 'PENDING_CALL')
          .length,
        confirmedCalls: orders.filter(
          (o) => o.callStatus === 'CONFIRMED_BY_CALL',
        ).length,
        failedCalls: orders.filter((o) => o.callStatus === 'CALL_FAILED')
          .length,
        negotiated: orders.filter((o) => o.negotiationRequested).length,
      },
    };
  }

  // ── Sender count ───────────────────────────────────────────────────────────
  async getSenderCount(pageId: number) {
    const total = await this.prisma.conversationSession.count({
      where: { pageIdRef: pageId },
    });
    return { uniqueSenders: total };
  }

  // ── Feature modes ──────────────────────────────────────────────────────────
  async getModes(pageId: number) {
    const page: any = await this.pageService.getById(pageId);
    return {
      automationOn: Boolean(page.automationOn),
      ocrOn: Boolean(page.ocrOn),
      infoModeOn: Boolean(page.infoModeOn),
      orderModeOn: Boolean(page.orderModeOn),
      printModeOn: Boolean(page.printModeOn),
      callConfirmModeOn: Boolean(page.callConfirmModeOn),
      memoSaveModeOn: Boolean(page.memoSaveModeOn),
      memoTemplateModeOn: Boolean(page.memoTemplateModeOn),
      autoMemoDesignModeOn: Boolean(page.autoMemoDesignModeOn),
      smartBotOn: Boolean(page.smartBotOn),
      businessBotOn: Boolean(page.businessBotOn),
      businessInfo: page.businessInfo ?? '',
      commentReplyOn: Boolean(page.commentReplyOn),
      recurringNotifMode: Boolean(page.recurringNotifMode),
      modeAccess: this.getModeAccess(page),
    };
  }

  async updateModes(pageId: number, body: any) {
    const page: any = await this.pageService.getById(pageId);
    const allowed = [
      'automationOn',
      'ocrOn',
      'infoModeOn',
      'orderModeOn',
      'printModeOn',
      'callConfirmModeOn',
      'memoSaveModeOn',
      'memoTemplateModeOn',
      'autoMemoDesignModeOn',
      'smartBotOn',
      'businessBotOn',
      'commentReplyOn',
      'recurringNotifMode',
      'universityModeOn',
    ];
    const patch: any = {};
    for (const k of allowed) {
      if (!(k in body)) continue;
      const nextVal = Boolean(body[k]);
      const accessKey = this.modeAccessMap[k];
      if (nextVal && accessKey && page?.[accessKey] === false) {
        throw new BadRequestException(
          `${k} is not available on your current plan. Please contact admin to upgrade.`,
        );
      }
      patch[k] = nextVal;
    }
    if (typeof body.businessInfo === 'string')
      patch.businessInfo = body.businessInfo.trim() || null;
    if (Object.keys(patch).length > 0)
      await this.prisma.page.update({ where: { id: pageId }, data: patch });
    return this.getModes(pageId);
  }

  // ── Orders ─────────────────────────────────────────────────────────────────
  async listOrders(
    pageId: number,
    status?: string,
    source?: string,
    paymentStatus?: string,
  ) {
    const where: any = { pageIdRef: pageId };
    if (status && status !== 'ALL') where.status = status.toUpperCase();
    if (source && source !== 'ALL') where.source = source.toUpperCase();
    if (paymentStatus && paymentStatus !== 'ALL')
      where.paymentStatus = paymentStatus;
    const orders = await this.prisma.order.findMany({
      where,
      include: {
        items: true,
        courierShipment: {
          select: {
            status: true,
            courierName: true,
            trackingId: true,
            trackingUrl: true,
          },
        },
      },
      orderBy: { id: 'desc' },
      take: 300,
    });
    // Attach botMuted flag from conversation context
    const psids = orders.map(o => o.customerPsid).filter(Boolean) as string[];
    const sessions = psids.length > 0
      ? await this.prisma.conversationSession.findMany({
          where: { pageIdRef: pageId, customerPsid: { in: psids }, agentHandling: true },
          select: { customerPsid: true },
        })
      : [];
    const mutedSet = new Set(sessions.map(s => s.customerPsid));
    return orders.map(o => ({ ...o, botMuted: o.customerPsid ? mutedSet.has(o.customerPsid) : false }));
  }

  async markOrdersPrinted(pageId: number, ids: number[]) {
    await this.ensureOrders(pageId, ids || []);
    if (!ids?.length) return { updated: 0 };
    await this.prisma.$executeRawUnsafe(
      `UPDATE "Order" SET "printedAt" = CURRENT_TIMESTAMP WHERE "pageIdRef" = ? AND id IN (${ids.map(() => '?').join(',')})`,
      pageId,
      ...ids,
    );
    return { updated: ids.length };
  }

  async createManualOrder(pageId: number, body: any) {
    const VALID_SOURCES = [
      'WHATSAPP',
      'INSTAGRAM',
      'PHONE',
      'MANUAL',
      'FACEBOOK',
    ];
    const source = VALID_SOURCES.includes(
      String(body?.source || '').toUpperCase(),
    )
      ? String(body.source).toUpperCase()
      : 'MANUAL';

    // V24: Restaurant mode — owner may pin the customer's location; fee is
    // computed server-side from the page's slabs. No pin → fee-less order
    // (pickup / phone orders stay allowed).
    let restaurantDelivery: {
      deliveryLat: number;
      deliveryLng: number;
      deliveryFee: number;
      deliveryDistanceKm: number;
    } | null = null;
    const dLat = Number(body?.deliveryLat);
    const dLng = Number(body?.deliveryLng);
    if (
      body?.deliveryLat != null &&
      body?.deliveryLng != null &&
      isValidLat(dLat) &&
      isValidLng(dLng)
    ) {
      const page: any = await this.pageService.getById(pageId);
      if (isRestaurantReady(page)) {
        const distanceKm =
          Math.round(
            haversineKm(page.restaurantLat, page.restaurantLng, dLat, dLng) *
              100,
          ) / 100;
        const slab = resolveDeliveryFee(
          parseSlabs(page.deliverySlabsJson),
          distanceKm,
        );
        if (!slab)
          throw new BadRequestException(
            'লোকেশনটা ডেলিভারি এলাকার বাইরে — শেষ slab-এর দূরত্বের মধ্যে pin করুন',
          );
        restaurantDelivery = {
          deliveryLat: dLat,
          deliveryLng: dLng,
          deliveryFee: slab.fee,
          deliveryDistanceKm: distanceKm,
        };
      }
    }

    const order = await this.prisma.order.create({
      data: {
        pageIdRef: pageId,
        customerPsid: '',
        customerName: body?.customerName || '',
        phone: body?.phone || '',
        address: body?.address || '',
        orderNote: body?.orderNote || '',
        status: 'RECEIVED',
        source,
        ...(restaurantDelivery ?? {}),
      },
    });

    // Create order items
    const items: any[] = Array.isArray(body?.items) ? body.items : [];
    let subtotal = 0;
    for (const item of items) {
      if (!item?.productCode) continue;
      const code = String(item.productCode).toUpperCase();
      // V25: size/portion variant — server resolves the variant's price and
      // stores the choice structurally; a client-sent unitPrice on a variant
      // product is ignored.
      let unitPrice = Number(item.unitPrice) || 0;
      let metaJson: string | null = null;
      let productName: string | null = null;
      if (item.variantLabel) {
        const product = await this.prisma.product.findFirst({
          where: { pageId, code },
          select: { name: true, priceVariantsJson: true },
        });
        const variants = parsePriceVariants(product?.priceVariantsJson);
        const chosen = variants.find(
          (v) => v.label === String(item.variantLabel).trim(),
        );
        if (chosen) {
          unitPrice = chosen.price;
          metaJson = JSON.stringify({
            variantLabel: chosen.label,
            ...(chosen.pieces ? { pieces: chosen.pieces } : {}),
          });
          productName = product?.name ? `${product.name} (${chosen.label})` : null;
        }
      }
      const qty = Number(item.qty) || 1;
      subtotal += unitPrice * qty;
      await this.prisma.orderItem.create({
        data: {
          orderId: order.id,
          productCode: code,
          qty,
          unitPrice,
          productName,
          metaJson,
        },
      });
    }

    // excludeOrderId=order.id: this order row already exists (items are
    // attached after creation to resolve variant prices first) — without
    // this, the loyalty/milestone order-count would count this order as
    // one of its own "prior" orders.
    const orderedCodes = items.filter((it) => it?.productCode).map((it) => String(it.productCode).toUpperCase());
    const [discounts, isCombo] = await Promise.all([
      subtotal > 0
        ? this.pricing.computeDiscounts(pageId, order.phone, subtotal, new Date(), order.id)
        : Promise.resolve({ loyaltyDiscount: 0, happyHourDiscount: 0 }),
      this.pricing.isComboOrder(pageId, orderedCodes),
    ]);
    const { thisOrderNumber, rewards } = await this.pricing.getMilestoneRewards(
      pageId,
      order.phone,
      isCombo,
      order.id,
    );

    const orderUpdate: any = {};
    if (discounts.loyaltyDiscount) orderUpdate.loyaltyDiscountAmount = discounts.loyaltyDiscount;
    if (discounts.happyHourDiscount) orderUpdate.happyHourDiscountAmount = discounts.happyHourDiscount;
    const milestoneDiscountAmount = this.pricing.computeMilestoneDiscount(rewards, subtotal);
    if (milestoneDiscountAmount) orderUpdate.milestoneDiscountAmount = milestoneDiscountAmount;
    if (rewards.length) {
      orderUpdate.milestoneRewardAppliedJson = JSON.stringify(
        rewards.map((r) => ({ ...r, orderNumber: thisOrderNumber })),
      );
      if (rewards.some((r) => r.rewardType === 'FREE_DELIVERY')) orderUpdate.deliveryFee = 0;
    }
    if (Object.keys(orderUpdate).length) {
      await this.prisma.order.update({ where: { id: order.id }, data: orderUpdate });
    }
    for (const reward of rewards) {
      if (reward.rewardType === 'FREE_ITEM' && reward.productCode) {
        await this.prisma.orderItem.create({
          data: {
            orderId: order.id,
            productCode: reward.productCode,
            qty: reward.qty,
            unitPrice: 0,
            productName: `🎁 Free — ${reward.productName}`,
          },
        });
      }
    }

    return this.prisma.order.findUnique({
      where: { id: order.id },
      include: { items: true },
    });
  }

  async getOrder(pageId: number, orderId: number) {
    return this.prisma.order.findFirst({
      where: { id: orderId, pageIdRef: pageId },
      include: { items: true },
    });
  }

  // ── V29: Edit Order Fields ─────────────────────────────────────────────────
  async getOrderFields(pageId: number) {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { orderFieldsJson: true },
    });
    return { fields: parseOrderFields(page?.orderFieldsJson) };
  }

  async saveOrderFields(pageId: number, raw: unknown) {
    if (!Array.isArray(raw))
      throw new BadRequestException('fields must be an array');
    const fields = normalizeOrderFields(raw);
    await this.prisma.page.update({
      where: { id: pageId },
      data: { orderFieldsJson: fields.length ? JSON.stringify(fields) : null },
    });
    return { fields };
  }

  /** Merchant edits an order's custom field values (blank value = remove). */
  async saveOrderCustomFieldValues(pageId: number, orderId: number, raw: any) {
    await this.ensureOrder(pageId, orderId);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new BadRequestException('values must be an object');
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw).slice(0, 40)) {
      const key = String(k).trim().slice(0, 60);
      const val = String(v ?? '').trim().slice(0, 500);
      if (key && val) values[key] = val;
    }
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        customFieldsJson: Object.keys(values).length
          ? JSON.stringify(values)
          : null,
      },
    });
    return { values };
  }

  async updateOrder(pageId: number, orderId: number, body: any) {
    await this.ensureOrder(pageId, orderId);
    return this.ordersService.updateOrderInfo(orderId, body || {});
  }

  async applyOrderAction(pageId: number, orderId: number, action: string, cancelNote?: string) {
    await this.ensureOrder(pageId, orderId);
    const a = String(action || '').toLowerCase();
    if (a === 'confirm')
      return this.ordersService.confirmByAgent(orderId, pageId);
    if (a === 'cancel') return this.ordersService.cancelOrder(orderId, pageId, cancelNote);
    if (a === 'issue') return this.ordersService.markIssue(orderId, pageId);
    if (a === 'pack')
      return this.prisma.order.update({
        where: { id: orderId },
        data: { status: 'PACKED', updatedAt: new Date() },
      });
    if (a === 'ship')
      return this.prisma.order.update({
        where: { id: orderId },
        data: { status: 'SHIPPED', updatedAt: new Date() },
      });
    if (a === 'deliver') {
      await this.ordersService.markDelivered(orderId, pageId);
      void this.orderNotification.notifyDelivered(pageId, orderId);
      void this.orderNotification.scheduleReviewFollowUp(pageId, orderId);
      // Also sync courier shipment status if exists
      const shipment = await this.prisma.courierShipment.findUnique({
        where: { orderId },
      });
      if (
        shipment &&
        shipment.pageId === pageId &&
        shipment.status !== 'delivered'
      ) {
        await this.prisma.courierShipment.update({
          where: { orderId },
          data: { status: 'delivered', deliveredAt: new Date() },
        });
      }
      return { id: orderId, status: 'DELIVERED' };
    }
    if (a === 'cancel-delivery') {
      await this.ordersService.cancelOrder(orderId, pageId);
      void this.orderNotification.notifyDeliveryCancelled(pageId, orderId);
      const shipment = await this.prisma.courierShipment.findUnique({
        where: { orderId },
      });
      if (
        shipment &&
        shipment.pageId === pageId &&
        shipment.status !== 'cancelled'
      ) {
        await this.prisma.courierShipment.update({
          where: { orderId },
          data: { status: 'cancelled' },
        });
      }
      return { id: orderId, status: 'CANCELLED' };
    }
    throw new BadRequestException(`Unknown action: ${action}`);
  }

  // V9: Bulk order action — confirm/cancel/issue multiple orders at once
  async bulkOrderAction(
    pageId: number,
    ids: number[],
    action: string,
    cancelNote?: string,
  ): Promise<{
    success: number;
    failed: number;
    results: any[];
  }> {
    const a = String(action || '').toLowerCase();
    if (
      ![
        'confirm',
        'cancel',
        'issue',
        'pack',
        'deliver',
        'cancel-delivery',
      ].includes(a)
    )
      throw new BadRequestException(`Unknown action: ${action}`);
    let success = 0,
      failed = 0;
    const results: any[] = [];
    for (const id of ids) {
      try {
        const order = await this.prisma.order.findUnique({ where: { id } });
        if (!order || order.pageIdRef !== pageId) throw new Error('Not found');
        if (a === 'confirm')
          await this.ordersService.confirmByAgent(id, pageId);
        if (a === 'cancel') await this.ordersService.cancelOrder(id, pageId, cancelNote);
        if (a === 'issue') await this.ordersService.markIssue(id, pageId);
        if (a === 'pack')
          await this.prisma.order.update({
            where: { id },
            data: { status: 'PACKED', updatedAt: new Date() },
          });
        if (a === 'deliver') await this.applyOrderAction(pageId, id, 'deliver');
        if (a === 'cancel-delivery')
          await this.applyOrderAction(pageId, id, 'cancel-delivery');
        results.push({ id, success: true });
        success++;
      } catch (e: any) {
        results.push({ id, success: false, error: e.message });
        failed++;
      }
    }
    return { success, failed, results };
  }

  // ── Delivery Zone ──────────────────────────────────────────────────────────

  /** Returns all PACKED orders with courier shipment info for the delivery zone. */
  async getDeliveryOrders(pageId: number) {
    return this.prisma.order.findMany({
      where: { pageIdRef: pageId, status: 'PACKED' },
      include: {
        items: true,
        courierShipment: {
          select: {
            id: true,
            courierName: true,
            trackingId: true,
            trackingUrl: true,
            status: true,
            bookedAt: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Sync courier API status for all PACKED orders.
   * For each shipment that has a courier API (not manual):
   * - If courier says delivered → mark DELIVERED + notify
   * - If courier says returned/cancelled → mark CANCELLED + notify
   */
  async syncCourierDeliveries(pageId: number) {
    const shipments = await this.prisma.courierShipment.findMany({
      where: {
        pageId,
        courierName: { not: 'manual' },
        status: { in: ['booked', 'picked', 'in_transit'] },
      },
      include: { order: { select: { id: true, status: true } } },
    });

    const settingsRaw = await this.courierService.getSettings(pageId);
    const settings = this.courierService.parseSettings(settingsRaw);

    const results: { orderId: number; newStatus: string; error?: string }[] =
      [];

    for (const shipment of shipments) {
      if (
        !shipment.trackingId ||
        shipment.order.status === 'DELIVERED' ||
        shipment.order.status === 'CANCELLED'
      )
        continue;
      try {
        const normalized = await this.courierService.getLiveStatus(
          shipment.courierName as any,
          settings,
          shipment.trackingId,
        );
        if (!normalized || normalized === shipment.status) continue;

        await this.courierAccounting.updateShipmentStatus(
          pageId,
          shipment.orderId,
          normalized,
        );
        results.push({ orderId: shipment.orderId, newStatus: normalized });
      } catch (e: any) {
        results.push({
          orderId: shipment.orderId,
          newStatus: '',
          error: e.message,
        });
      }
    }

    return { synced: results.filter((r) => !r.error).length, results };
  }

  // ── Manual Call Queue ──────────────────────────────────────────────────────
  async getCallQueue(pageId: number) {
    return this.prisma.order.findMany({
      where: {
        pageIdRef: pageId,
        status: { in: ['RECEIVED', 'PENDING'] },
        callStatus: { not: 'CONFIRMED_BY_CALL' },
      },
      include: { items: true },
      orderBy: { createdAt: 'asc' },
      take: 300,
    });
  }

  async logManualCall(
    pageId: number,
    orderId: number,
    body: {
      result: 'CONFIRMED' | 'CANCELLED' | 'NOT_ANSWERED' | 'CALLBACK_LATER';
      note?: string;
    },
  ) {
    await this.ensureOrder(pageId, orderId);
    const now = new Date();

    const callStatusMap: Record<string, string> = {
      CONFIRMED: 'CONFIRMED_BY_CALL',
      CANCELLED: 'CALL_FAILED',
      NOT_ANSWERED: 'NOT_ANSWERED',
      CALLBACK_LATER: 'PENDING_CALL',
    };

    const orderStatusMap: Record<string, string | null> = {
      CONFIRMED: 'CONFIRMED',
      CANCELLED: 'CANCELLED',
      NOT_ANSWERED: null,
      CALLBACK_LATER: null,
    };

    const newCallStatus = callStatusMap[body.result];
    const newOrderStatus = orderStatusMap[body.result];

    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { callRetryCount: true, phone: true, stockDecremented: true },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;

      await tx.callAttempt.create({
        data: {
          orderId,
          pageId,
          phone: order?.phone || '',
          callProvider: 'manual',
          status:
            body.result === 'CONFIRMED'
              ? 'ANSWERED'
              : body.result === 'NOT_ANSWERED'
                ? 'NOT_ANSWERED'
                : 'ANSWERED',
          errorMsg: body.note || null,
        },
      });

      const patch: any = {
        callStatus: newCallStatus,
        lastCallAt: now,
        callRetryCount: { increment: 1 },
      };
      if (newOrderStatus) {
        patch.status = newOrderStatus;
        if (newOrderStatus === 'CONFIRMED') patch.confirmedAt = now;
        if (newOrderStatus === 'CANCELLED' && order?.stockDecremented) {
          // Same restore-on-cancel rule as orders.service.ts's cancelOrder() —
          // this path bypasses that method, so it needs its own copy.
          const items = await tx.orderItem.findMany({ where: { orderId } });
          for (const item of items) {
            await tx.product.updateMany({
              where: { pageId, code: item.productCode },
              data: { stockQty: { increment: item.qty } },
            });
          }
          patch.stockDecremented = false;
        }
      }
      if (body.note) patch.callResult = body.note;

      await tx.order.update({ where: { id: orderId }, data: patch });
    });

    // Customer never got a Messenger message when confirmed via the call-log
    // button — this path updates order.status directly and skipped the
    // notification that confirmOrder() sends elsewhere.
    if (newOrderStatus === 'CONFIRMED') {
      void this.orderNotification.notifyConfirmed(pageId, orderId);
    }
    if (newOrderStatus === 'CANCELLED') {
      void this.orderNotification.notifyCancelled(pageId, orderId, body.note);
    }

    // Telegram notification for call result
    const callEmoji: Record<string, string> = {
      CONFIRMED: '✅', CANCELLED: '❌', NOT_ANSWERED: '📵', CALLBACK_LATER: '🔄',
    };
    const callLabel: Record<string, string> = {
      CONFIRMED: 'Confirmed by call', CANCELLED: 'Cancelled',
      NOT_ANSWERED: 'Not Answered', CALLBACK_LATER: 'Callback Later',
    };
    const noteText = body.note ? `\n📝 ${body.note}` : '';
    this.telegramNotif.notify(
      pageId,
      `${callEmoji[body.result] ?? '📞'} <b>Call Result — Order #${orderId}</b>\n${callLabel[body.result] ?? body.result}${noteText}`,
    ).catch(() => {});

    return { success: true, result: body.result };
  }

  // ── Call actions ───────────────────────────────────────────────────────────
  async sendCall(pageId: number, orderId: number) {
    await this.ensureOrder(pageId, orderId);
    return this.callService.sendManualCall(pageId, orderId);
  }
  async resendCall(pageId: number, orderId: number) {
    await this.ensureOrder(pageId, orderId);
    return this.callService.resendCall(pageId, orderId);
  }
  async confirmByCall(pageId: number, orderId: number) {
    await this.ensureOrder(pageId, orderId);
    return this.callService.confirmByCall(pageId, orderId);
  }
  async cancelByCall(pageId: number, orderId: number) {
    await this.ensureOrder(pageId, orderId);
    return this.callService.cancelByCall(pageId, orderId);
  }

  // ── Products — always page-scoped ─────────────────────────────────────────
  async listProducts(pageId: number) {
    return this.productsService.listByPage(pageId);
  }
  async createProduct(pageId: number, body: any) {
    if (!body?.code?.trim())
      throw new BadRequestException('Product code required');
    return this.productsService.create({
      pageId,
      code: String(body.code),
      price: Number(body.price ?? 0),
      costPrice: Number(body.costPrice ?? 0),
      stockQty: Number(body.stockQty ?? 0),
      name: body.name || undefined,
      description: body.description || undefined,
      imageUrl: body.imageUrl || undefined,
      referenceImagesJson: body.referenceImagesJson || undefined,
      productGroup: body.productGroup || undefined,
      variantLabel: body.variantLabel || undefined,
      videoUrl: body.videoUrl || undefined,
      postCaption: body.postCaption || undefined,
      catalogVisible:
        body.catalogVisible !== undefined ? Boolean(body.catalogVisible) : true,
      variantOptions: body.variantOptions
        ? this.parseVariantOptionsText(body.variantOptions)
        : undefined,
      // V18: Image recognition metadata
      category: body.category || undefined,
      color: body.color || undefined,
      tags: body.tags || undefined,
      imageKeywords: body.imageKeywords || undefined,
      aiDescription: body.aiDescription || undefined,
      visionSearchable:
        body.visionSearchable !== undefined
          ? Boolean(body.visionSearchable)
          : undefined,
      fbPostUrl: body.fbPostUrl || undefined,
      productType: body.productType || undefined,
      unit: body.unit || undefined,
      orderEnabled:
        body.orderEnabled !== undefined ? Boolean(body.orderEnabled) : undefined,
      deliveryCharge: body.deliveryCharge || undefined,
      originalPrice:
        body.originalPrice !== undefined &&
        body.originalPrice !== null &&
        body.originalPrice !== ''
          ? Number(body.originalPrice)
          : undefined,
      pricingPolicyOverride: body.pricingPolicyOverride || undefined,
    });
  }
  async updateProduct(pageId: number, code: string, body: any) {
    return this.productsService.updateOne(pageId, code, {
      price: body?.price !== undefined ? Number(body.price) : undefined,
      costPrice:
        body?.costPrice !== undefined ? Number(body.costPrice) : undefined,
      stockQty:
        body?.stockQty !== undefined ? Number(body.stockQty) : undefined,
      name: body?.name,
      description: body?.description,
      isActive: body?.isActive,
      imageUrl:
        body?.imageUrl !== undefined ? String(body.imageUrl || '') : undefined,
      referenceImagesJson:
        body?.referenceImagesJson !== undefined
          ? String(body.referenceImagesJson || '')
          : undefined,
      productGroup:
        body?.productGroup !== undefined
          ? String(body.productGroup || '')
          : undefined,
      variantLabel:
        body?.variantLabel !== undefined
          ? String(body.variantLabel || '')
          : undefined,
      videoUrl:
        body?.videoUrl !== undefined ? String(body.videoUrl || '') : undefined,
      postCaption:
        body?.postCaption !== undefined
          ? String(body.postCaption || '')
          : undefined,
      catalogVisible:
        body?.catalogVisible !== undefined
          ? Boolean(body.catalogVisible)
          : undefined,
      catalogSortOrder:
        body?.catalogSortOrder !== undefined
          ? Number(body.catalogSortOrder)
          : undefined,
      variantOptions:
        body?.variantOptions !== undefined
          ? this.parseVariantOptionsText(body.variantOptions)
          : undefined,
      // V18: Image recognition metadata
      category:
        body?.category !== undefined ? String(body.category || '') : undefined,
      color: body?.color !== undefined ? String(body.color || '') : undefined,
      tags: body?.tags !== undefined ? String(body.tags || '') : undefined,
      imageKeywords:
        body?.imageKeywords !== undefined
          ? String(body.imageKeywords || '')
          : undefined,
      aiDescription:
        body?.aiDescription !== undefined
          ? String(body.aiDescription || '')
          : undefined,
      visionSearchable:
        body?.visionSearchable !== undefined
          ? Boolean(body.visionSearchable)
          : undefined,
      // V23/V24 fields — previously missing from this mapping, so the
      // dashboard's PATCH (which goes through /client-dashboard, not
      // /products) silently dropped them: the API returned 200 but
      // originalPrice/deliveryCharge/fbPostUrl never reached the DB.
      fbPostUrl:
        body?.fbPostUrl !== undefined ? String(body.fbPostUrl || '') : undefined,
      unit: body?.unit !== undefined ? String(body.unit || '') || null : undefined,
      orderEnabled:
        body?.orderEnabled !== undefined ? Boolean(body.orderEnabled) : undefined,
      deliveryCharge:
        body?.deliveryCharge !== undefined
          ? String(body.deliveryCharge)
          : undefined,
      originalPrice:
        body?.originalPrice !== undefined
          ? body.originalPrice === null || body.originalPrice === ''
            ? null
            : Number(body.originalPrice)
          : undefined,
      pricingPolicyOverride:
        body?.pricingPolicyOverride !== undefined
          ? body.pricingPolicyOverride
            ? String(body.pricingPolicyOverride)
            : null
          : undefined,
    });
  }

  /** Parse "Size: S,M,L,XL\nColor: Red,Blue" → JSON string for DB storage */
  private parseVariantOptionsText(text: string): string | null {
    const lines = String(text || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return null;
    const result = lines.map((line) => {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) return { label: line.trim(), choices: [] };
      const label = line.slice(0, colonIdx).trim();
      const choices = line
        .slice(colonIdx + 1)
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      return { label, choices };
    });
    return result.length ? JSON.stringify(result) : null;
  }
  async deleteProduct(pageId: number, code: string) {
    return this.productsService.deleteOne(pageId, code);
  }

  async uploadProductImage(pageId: number, file: any) {
    if (!file?.buffer) throw new BadRequestException('Image file required');
    return this.visionOps.uploadProductAsset(pageId, file);
  }

  async detectProductCodeFromImage(pageId: number, imageUrl: string) {
    if (!imageUrl) throw new BadRequestException('imageUrl required');
    const products = await this.prisma.product.findMany({
      where: { pageId, isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        price: true,
        postCaption: true,
      },
    });
    const ocrResult = await this.ocrService.extractFull(
      imageUrl,
      undefined,
      products.map((p) => ({ code: p.code, postCaption: p.postCaption })),
    );
    const matchedProducts = products
      .filter((p) => ocrResult.allCodes.includes(p.code))
      .map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        price: Number(p.price),
      }));
    return { codes: ocrResult.allCodes, products: matchedProducts };
  }

  async analyzeProductImage(pageId: number, body: any) {
    const imageUrl = String(body?.imageUrl || '').trim();
    const excludeCode = body?.excludeCode
      ? String(body.excludeCode).trim()
      : undefined;
    if (!imageUrl) throw new BadRequestException('Image URL required');
    const result = await this.visionOps.analyzeProductImage(
      pageId,
      imageUrl,
      excludeCode,
    );
    await this.visionOps.logVisionAttempt({
      pageId,
      type: 'product_analyze',
      imageUrl,
      note: 'Admin analyzed product image from dashboard',
      attrs: result.attrs,
      confidence: result.attrs.confidence,
    });
    return result;
  }

  async batchAnalyzeReferenceImages(pageId: number, body: any) {
    const imageUrls: string[] = Array.isArray(body?.imageUrls)
      ? body.imageUrls.map((u: any) => String(u).trim()).filter(Boolean)
      : [];
    const excludeCode = body?.excludeCode
      ? String(body.excludeCode).trim()
      : undefined;
    if (!imageUrls.length)
      throw new BadRequestException('imageUrls array required');
    const result = await this.visionOps.batchAnalyzeReferenceImages(
      pageId,
      imageUrls,
      excludeCode,
    );
    await this.visionOps.logVisionAttempt({
      pageId,
      type: 'product_analyze',
      imageUrl: imageUrls[0],
      note: `Multi-angle batch analysis: ${imageUrls.length} images`,
      attrs: result.attrs,
      confidence: result.attrs.confidence,
    });
    return result;
  }

  async setupDualPhotoAI(
    pageId: number,
    holdingRefUrl: string,
    wearingRefUrl: string,
    livePhotoUrls: string[] = [],
  ) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new BadRequestException('OpenAI API key not configured');
    if (!holdingRefUrl || !wearingRefUrl)
      throw new BadRequestException('Both reference images required');

    // Balance check
    const hasBalance = await this.walletService.canProcessAi(pageId);
    if (!hasBalance)
      throw new BadRequestException('Wallet balance শেষ — recharge করুন');

    const liveCount = livePhotoUrls.length;
    const totalImages = 2 + liveCount;
    const hasLive = liveCount > 0;

    const liveDescLines = livePhotoUrls
      .map(
        (_, i) =>
          `- Image ${3 + i}: Live video screenshot #${i + 1} showing BOTH dresses at the same time`,
      )
      .join('\n');

    const prompt = `You are analyzing dress products for a Bangladeshi clothing live-video seller.

You have ${totalImages} images:
- Image 1: Reference photo of a dress that will be HELD in hand during the live
- Image 2: Reference photo of a dress that will be WORN on the model's body during the live${hasLive ? '\n' + liveDescLines : ''}

Your tasks:
1. Extract the product code from Image 1 if visible (codes look like: DF-0042, SK-001, LT-100, printed on tag/label/sticker/paper/cloth)
2. Extract the product code from Image 2 if visible (same)${
      hasLive
        ? `
3. Using ALL live screenshots (Images 3+), identify which dress is being HELD in hand and which is being WORN on the model's body. Multiple frames improve accuracy.
4. Match each dress in the live photos to its reference image (Image 1 or Image 2)
5. If the live photos show Image 1's dress is actually WORN (not held), set swapped=true`
        : ''
    }

Return ONLY a single valid JSON object with NO markdown:
{
  "holding": {
    "productCode": "DF-0042",
    "codeFound": true,
    "confidence": 0.92
  },
  "wearing": {
    "productCode": "SK-001",
    "codeFound": true,
    "confidence": 0.88
  },
  "swapped": false,
  "note": "brief English explanation"
}

Rules:
- productCode must be UPPERCASE. If no code is visible, set productCode to null and codeFound to false
- confidence is your certainty (0.0 to 1.0) for that detection. Multiple live frames → higher confidence
- swapped=true only when live photos prove Image 1's dress is worn and Image 2's dress is held (opposite of what was labeled)
- If no live photo, set swapped=false always`;

    const content: any[] = [{ type: 'text', text: prompt }];
    content.push({
      type: 'image_url',
      image_url: { url: holdingRefUrl, detail: 'high' },
    });
    content.push({
      type: 'image_url',
      image_url: { url: wearingRefUrl, detail: 'high' },
    });
    for (const url of livePhotoUrls) {
      content.push({ type: 'image_url', image_url: { url, detail: 'high' } });
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 400,
        temperature: 0.1,
        messages: [{ role: 'user', content }],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok)
      throw new BadRequestException(`OpenAI vision error: ${res.status}`);
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? '';

    let ai: any = {};
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) ai = JSON.parse(match[0]);
    } catch {
      /* use empty */
    }

    const swapped = Boolean(ai.swapped);
    const holdingCode: string | null = swapped
      ? (ai.wearing?.productCode ?? null)
      : (ai.holding?.productCode ?? null);
    const wearingCode: string | null = swapped
      ? (ai.holding?.productCode ?? null)
      : (ai.wearing?.productCode ?? null);
    const holdingConf: number = swapped
      ? (ai.wearing?.confidence ?? 0)
      : (ai.holding?.confidence ?? 0);
    const wearingConf: number = swapped
      ? (ai.holding?.confidence ?? 0)
      : (ai.wearing?.confidence ?? 0);

    // Find products by code (case-insensitive)
    const lookup = async (code: string | null) => {
      if (!code) return null;
      const p = await this.prisma.product.findFirst({
        where: {
          pageId,
          isActive: true,
          code: { equals: code, mode: 'insensitive' } as any,
        },
        select: { id: true, code: true, name: true, price: true },
      });
      return p
        ? { id: p.id, code: p.code, name: p.name ?? '', price: Number(p.price) }
        : null;
    };
    const [holdingProduct, wearingProduct] = await Promise.all([
      lookup(holdingCode),
      lookup(wearingCode),
    ]);

    // Deduct wallet: 2 reference + N live photos = totalImages × costPerAnalyzeCredit
    void this.walletService.deductUsage(pageId, 'DUAL_PHOTO_AI', {
      photoCount: totalImages,
    });

    return {
      swapped,
      totalImages,
      holding: {
        code: holdingCode,
        confidence: holdingConf,
        codeFound: Boolean(holdingCode),
        product: holdingProduct,
      },
      wearing: {
        code: wearingCode,
        confidence: wearingConf,
        codeFound: Boolean(wearingCode),
        product: wearingProduct,
      },
      note: ai.note ?? '',
    };
  }

  async getProductVideoGuide(pageId: number, body: any) {
    const videoUrl = String(body?.videoUrl || '').trim();
    const existingImages = Number(body?.existingImages || 0);
    return this.visionOps.buildVideoCaptureGuide(videoUrl, existingImages);
  }

  // ── LIVE SESSION (new Dual Photo system) ────────────────────────────────────

  private readonly PRODUCT_SELECT = {
    id: true,
    code: true,
    name: true,
    price: true,
    imageUrl: true,
  } as const;

  private parseSessions(sessions: any[]) {
    return sessions.map((s) => ({
      ...s,
      screenshots: this.parseJson(s.screenshots, []),
      aiMemo: s.aiMemo ? this.parseJson(s.aiMemo, null) : null,
    }));
  }

  private parseJson(raw: string | null | undefined, fallback: any) {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  async getLiveSessions(pageId: number) {
    const rows = await this.prisma.liveSession.findMany({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
      include: {
        wornProduct: { select: this.PRODUCT_SELECT },
        heldProduct: { select: this.PRODUCT_SELECT },
      },
    });
    return this.parseSessions(rows);
  }

  async createLiveSession(
    pageId: number,
    body: {
      label?: string;
      screenshots?: string[];
      wornProductId?: number | null;
      heldProductId?: number | null;
    },
  ) {
    const row = await this.prisma.liveSession.create({
      data: {
        pageId,
        label: body.label?.trim() || null,
        screenshots: JSON.stringify(body.screenshots ?? []),
        wornProductId: body.wornProductId ?? null,
        heldProductId: body.heldProductId ?? null,
      },
      include: {
        wornProduct: { select: this.PRODUCT_SELECT },
        heldProduct: { select: this.PRODUCT_SELECT },
      },
    });
    return this.parseSessions([row])[0];
  }

  async updateLiveSession(
    pageId: number,
    sessionId: number,
    body: {
      label?: string;
      screenshots?: string[];
      wornProductId?: number | null;
      heldProductId?: number | null;
      isActive?: boolean;
    },
  ) {
    const data: any = {};
    if (body.label !== undefined) data.label = body.label?.trim() || null;
    if (body.screenshots !== undefined)
      data.screenshots = JSON.stringify(body.screenshots);
    if ('wornProductId' in body)
      data.wornProductId = body.wornProductId ?? null;
    if ('heldProductId' in body)
      data.heldProductId = body.heldProductId ?? null;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    data.updatedAt = new Date();

    const row = await this.prisma.liveSession.updateMany({
      where: { id: sessionId, pageId },
      data,
    });
    if (row.count === 0) throw new NotFoundException('Session not found');

    const updated = await this.prisma.liveSession.findUnique({
      where: { id: sessionId },
      include: {
        wornProduct: { select: this.PRODUCT_SELECT },
        heldProduct: { select: this.PRODUCT_SELECT },
      },
    });
    return this.parseSessions([updated!])[0];
  }

  async deleteLiveSession(pageId: number, sessionId: number) {
    await this.prisma.liveSession.deleteMany({
      where: { id: sessionId, pageId },
    });
    return { ok: true };
  }

  async analyzeLiveSession(pageId: number, sessionId: number) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new BadRequestException('OpenAI API key not configured');

    const session = await this.prisma.liveSession.findFirst({
      where: { id: sessionId, pageId },
      include: {
        wornProduct: true,
        heldProduct: true,
      },
    });
    if (!session) throw new NotFoundException('Session not found');

    const screenshots: string[] = this.parseJson(session.screenshots, []);
    if (!screenshots.length)
      throw new BadRequestException('No screenshots uploaded yet');
    if (!session.wornProductId && !session.heldProductId) {
      throw new BadRequestException(
        'Assign at least one product (worn or held) before analyzing',
      );
    }

    if (!(await this.walletService.canProcessAi(pageId))) {
      throw new BadRequestException('Wallet balance শেষ — recharge করুন');
    }

    const wornName = session.wornProduct
      ? `${session.wornProduct.name} (Code: ${session.wornProduct.code})`
      : 'Not assigned';
    const heldName = session.heldProduct
      ? `${session.heldProduct.name} (Code: ${session.heldProduct.code})`
      : 'Not assigned';

    const prompt = `You are helping a Bangladeshi clothing seller identify products from live video screenshots.

In these screenshots from a live video sale:
- The MODEL IS WEARING: ${wornName}
- HELD IN HAND: ${heldName}

Create a detailed visual profile of each product as visible in these screenshots. Focus on:
- Colors, patterns, design details
- Position in frame (worn on body vs held in hand)
- Distinguishing features that make each product unique

Return ONLY valid JSON (no markdown):
{
  "worn": {
    "productCode": "${session.wornProduct?.code ?? ''}",
    "description": "detailed visual description of the worn product",
    "visualCues": ["color", "pattern", "style details", "position"]
  },
  "held": {
    "productCode": "${session.heldProduct?.code ?? ''}",
    "description": "detailed visual description of the held product",
    "visualCues": ["color", "pattern", "style details", "position"]
  },
  "sessionNote": "brief note about this live session setup"
}`;

    const content: any[] = [{ type: 'text', text: prompt }];
    for (const url of screenshots.slice(0, 5)) {
      content.push({ type: 'image_url', image_url: { url, detail: 'high' } });
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 600,
        temperature: 0.1,
        messages: [{ role: 'user', content }],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) throw new BadRequestException(`OpenAI error: ${res.status}`);
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? '';

    let memo: any = {};
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) memo = JSON.parse(match[0]);
    } catch {
      /* use empty */
    }

    const photoCount = screenshots.length;
    void this.walletService.deductUsage(pageId, 'DUAL_PHOTO_AI', {
      photoCount,
    });

    const updated = await this.prisma.liveSession.update({
      where: { id: sessionId },
      data: { aiMemo: JSON.stringify(memo), updatedAt: new Date() },
      include: {
        wornProduct: { select: this.PRODUCT_SELECT },
        heldProduct: { select: this.PRODUCT_SELECT },
      },
    });
    return this.parseSessions([updated])[0];
  }

  async getVisionSummary(pageId: number, days = 30): Promise<any> {
    return this.visionOps.getSummary(pageId, days);
  }

  async getVisionReviewQueue(pageId: number): Promise<any[]> {
    return this.visionOps.getReviewQueue(pageId);
  }

  async updateVisionReviewQueueItem(
    pageId: number,
    itemId: string,
    body: any,
  ): Promise<any> {
    const status = String(body?.status || '').trim() as any;
    if (!status) throw new BadRequestException('Status required');
    return this.visionOps.updateReviewQueueItem(
      pageId,
      itemId,
      status,
      body?.note,
    );
  }

  // ── Settings: unified load ─────────────────────────────────────────────────
  async getBusinessSettings(pageId: number) {
    const [page, cfg]: [any, any] = await Promise.all([
      this.pageService.getById(pageId),
      this.botKnowledgeService.getConfig(pageId),
    ]);
    return {
      // Business
      businessName: page.businessName ?? '',
      businessPhone: page.businessPhone ?? '',
      businessAddress: page.businessAddress ?? '',
      websiteUrl: page.websiteUrl ?? '',
      logoUrl: page.logoUrl ?? '',
      memoFooterText: page.memoFooterText ?? '',
      currencySymbol: page.currencySymbol ?? '৳',
      codLabel: page.codLabel ?? 'COD',
      deliveryFeeInsideDhaka: page.deliveryFeeInsideDhaka ?? 80,
      deliveryFeeOutsideDhaka: page.deliveryFeeOutsideDhaka ?? 120,
      deliveryTimeText: page.deliveryTimeText ?? '',
      deliveryTimeInsideDhaka: page.deliveryTimeInsideDhaka ?? '',
      deliveryTimeOutsideDhaka: page.deliveryTimeOutsideDhaka ?? '',
      // V17: Payment mode
      paymentMode: page.paymentMode ?? 'cod',
      advanceAmount: page.advanceAmount ?? 0,
      advanceBkash: page.advanceBkash ?? '',
      advanceNagad: page.advanceNagad ?? '',
      advanceRocket: page.advanceRocket ?? '',
      advancePaymentMessage: page.advancePaymentMessage ?? '',
      codEnabled: page.codEnabled !== false,
      advanceThresholdAmount: page.advanceThresholdAmount ?? 0,
      webOrderEnabled: Boolean(page.webOrderEnabled),
      // V24: Restaurant mode — slabs returned as a parsed array, never raw JSON
      restaurantModeEnabled: Boolean(page.restaurantModeEnabled),
      restaurantLat: page.restaurantLat ?? null,
      restaurantLng: page.restaurantLng ?? null,
      deliverySlabs: parseSlabs(page.deliverySlabsJson),
      // V29: Messenger product-card buttons — [] means "use the built-in default"
      cardButtons: parseCardButtons(page.productCardButtonsJson),
      catalogMessengerUrl: page.catalogMessengerUrl ?? '',
      catalogSlug: page.catalogSlug ?? '',
      customDomain: page.customDomain ?? '',
      fbPageId: page.pageId ?? '',
      // Feature flags
      automationOn: Boolean(page.automationOn),
      ocrOn: Boolean(page.ocrOn),
      infoModeOn: Boolean(page.infoModeOn),
      orderModeOn: Boolean(page.orderModeOn),
      printModeOn: Boolean(page.printModeOn),
      callConfirmModeOn: Boolean(page.callConfirmModeOn),
      memoSaveModeOn: Boolean(page.memoSaveModeOn),
      memoTemplateModeOn: Boolean(page.memoTemplateModeOn),
      autoMemoDesignModeOn: Boolean(page.autoMemoDesignModeOn),
      modeAccess: this.getModeAccess(page),
      // V18: Image recognition
      imageRecognitionOn: Boolean(page.imageRecognitionOn),
      imageHighConfidence: page.imageHighConfidence ?? 0.75,
      imageMediumConfidence: page.imageMediumConfidence ?? 0.45,
      imageFallbackAiOn: Boolean(page.imageFallbackAiOn),
      textFallbackAiOn: Boolean(page.textFallbackAiOn),
      smsGatewayEnabled: Boolean(page.smsGatewayEnabled),
      // Dual Photo Mode
      dualPhotoMode: Boolean(page.dualPhotoMode),
      dualWearingProductId: page.dualWearingProductId ?? null,
      dualHoldingProductId: page.dualHoldingProductId ?? null,
      dualWearingProduct: page.dualWearingProductId
        ? await this.prisma.product
            .findUnique({
              where: { id: page.dualWearingProductId },
              select: { code: true, name: true },
            })
            .catch(() => null)
        : null,
      dualHoldingProduct: page.dualHoldingProductId
        ? await this.prisma.product
            .findUnique({
              where: { id: page.dualHoldingProductId },
              select: { code: true, name: true },
            })
            .catch(() => null)
        : null,
      // WhatsApp Business API
      waEnabled: Boolean(page.waEnabled),
      waPhoneNumberId: page.waPhoneNumberId ?? '',
      waVerifyToken: page.waVerifyToken ?? '',
      waTokenSet: Boolean(page.waToken), // never return the raw token
      // Instagram Business API
      igEnabled: Boolean(page.igEnabled),
      igBusinessAccountId: page.igBusinessAccountId ?? '',
      igVerifyToken: page.igVerifyToken ?? '',
      igTokenSet: Boolean(page.igToken), // never return the raw token
      // Recurring Notification Mode
      recurringNotifMode: Boolean(page.recurringNotifMode),
      // Telegram merchant notifications
      telegramNotifEnabled: Boolean(page.telegramNotifEnabled),
      telegramChatId: page.telegramChatId ?? '',
      telegramTokenSet: Boolean(page.telegramBotToken), // never return the raw token
      // University Mode
      universityModeOn: Boolean(page.universityModeOn),
      // AI Knowledge
      knowledgeText: page.knowledgeText ?? '',
      // Bot personality — per-page override of the shared agent-type persona
      customPersonaPrompt: page.customPersonaPrompt ?? '',
      // Business-specific behavior rules — supplementary to, cannot override, the fixed task rules
      behaviorInstructions: page.behaviorInstructions ?? '',
      // Custom Prompt mode — client's own full system prompt replaces the
      // hardcoded phrasing blocks when promptMode='custom'
      promptMode: page.promptMode ?? 'guided',
      customSystemPrompt: page.customSystemPrompt ?? '',
      // Agent handoff — pause bot on human takeover
      autoPauseOnHumanTakeover: Boolean(page.autoPauseOnHumanTakeover),
      autoPauseTimeoutMinutes: page.autoPauseTimeoutMinutes ?? 120,
      stopAiCommand: page.stopAiCommand ?? '',
      startAiCommand: page.startAiCommand ?? '',
      // Pricing (from bot-knowledge config)
      pricingPolicy: cfg?.pricingPolicy || {},
      // Call — all fields explicit
      callSettings: {
        callConfirmModeOn: Boolean(page.callConfirmModeOn),
        callMode: page.callMode ?? 'MANUAL',
        callConfirmationScope: page.callConfirmationScope ?? 'ALL',
        initialCallDelayMinutes: page.initialCallDelayMinutes ?? 30,
        retryIntervalMinutes: page.retryIntervalMinutes ?? 30,
        maxCallRetries: page.maxCallRetries ?? 3,
        callProvider: page.callProvider ?? '', // who makes the call
      },
      // Voice / TTS — all fields explicit
      voiceSettings: {
        callLanguage: page.callLanguage ?? 'BN',
        voiceType: page.voiceType ?? 'FEMALE',
        voiceStyle: page.voiceStyle ?? 'NATURAL',
        ttsProvider: page.ttsProvider || 'MANUAL_UPLOAD', // who generates audio
        banglaVoiceId: page.banglaVoiceId ?? '',
        englishVoiceId: page.englishVoiceId ?? '',
        banglaCallScript: page.banglaCallScript ?? '',
        englishCallScript: page.englishCallScript ?? '',
        banglaVoiceFileUrl: page.banglaVoiceFileUrl ?? '',
        englishVoiceFileUrl: page.englishVoiceFileUrl ?? '',
        voiceGeneratedAt: page.voiceGeneratedAt ?? null,
      },
      // V27: Loyalty ("Lucky Customer") + Happy Hour
      loyaltyEnabled: Boolean(page.loyaltyEnabled),
      loyaltyThresholdOrders: page.loyaltyThresholdOrders ?? null,
      loyaltyDiscountPercent: page.loyaltyDiscountPercent ?? null,
      happyHourEnabled: Boolean(page.happyHourEnabled),
      happyHourDiscountPercent: page.happyHourDiscountPercent ?? null,
      happyHourLabel: page.happyHourLabel ?? '',
      // V28: Milestone Rewards
      milestoneRewardsEnabled: Boolean(page.milestoneRewardsEnabled),
    };
  }

  // ── Settings: unified save ─────────────────────────────────────────────────
  async updateBusinessSettings(pageId: number, body: any) {
    const { pricingPolicy, callSettings, voiceSettings, ...pageFields } =
      body || {};

    // Page-level business fields (whitelist)
    const PAGE_FIELDS = [
      'businessName',
      'businessPhone',
      'businessAddress',
      'websiteUrl',
      'logoUrl',
      'memoFooterText',
      'currencySymbol',
      'codLabel',
      'deliveryFeeInsideDhaka',
      'deliveryFeeOutsideDhaka',
      'deliveryTimeText',
      'deliveryTimeInsideDhaka',
      'deliveryTimeOutsideDhaka',
      'infoModeOn',
      'orderModeOn',
      'printModeOn',
      'callConfirmModeOn',
      'memoSaveModeOn',
      'memoTemplateModeOn',
      'autoMemoDesignModeOn',
      'paymentMode',
      'advanceAmount',
      'advanceBkash',
      'advanceNagad',
      'advanceRocket',
      'advancePaymentMessage',
      'codEnabled',
      'advanceThresholdAmount',
      'webOrderEnabled',
      'catalogMessengerUrl',
      'catalogSlug',
      'customDomain',
      'productCodePrefix',
      // V18: image recognition settings
      'imageRecognitionOn',
      'imageHighConfidence',
      'imageMediumConfidence',
      'imageFallbackAiOn',
      // Dual Photo Mode
      'dualPhotoMode',
      'dualWearingProductId',
      'dualHoldingProductId',
      // WhatsApp Business API (token handled separately below)
      'waEnabled',
      'waPhoneNumberId',
      'waVerifyToken',
      // Telegram merchant notifications (token handled separately below)
      'telegramNotifEnabled',
      'telegramChatId',
      // AI / Bot
      'knowledgeText',
      'customPersonaPrompt',
      'behaviorInstructions',
      'promptMode',
      'customSystemPrompt',
      // Agent handoff — pause bot on human takeover
      'autoPauseOnHumanTakeover',
      'autoPauseTimeoutMinutes',
      'stopAiCommand',
      'startAiCommand',
      'textFallbackAiOn',
      'businessBotOn',
      'businessInfo',
      // Recurring Notification Mode
      'recurringNotifMode',
      // V27: Loyalty ("Lucky Customer") + Happy Hour
      'loyaltyEnabled',
      'loyaltyThresholdOrders',
      'loyaltyDiscountPercent',
      'happyHourEnabled',
      'happyHourDiscountPercent',
      'happyHourLabel',
      // V28: Milestone Rewards
      'milestoneRewardsEnabled',
    ];
    const pagePatch: any = {};
    for (const k of PAGE_FIELDS) {
      if (!(k in pageFields)) continue;
      const nextVal = pageFields[k];
      const accessKey = this.modeAccessMap[k];
      if (accessKey && Boolean(nextVal) && pageFields[k] !== undefined) {
        const page: any = await this.pageService.getById(pageId);
        if (page?.[accessKey] === false) {
          throw new BadRequestException(
            `${k} is not available on your current plan. Please contact admin to upgrade.`,
          );
        }
      }
      pagePatch[k] = nextVal;
    }
    // AI / Bot text fields — explicit trim/cap (the generic whitelist loop
    // above applies none; the dashboard <textarea> maxLength is bypassable
    // via direct API calls, so enforce limits server-side too)
    if (typeof pagePatch.knowledgeText === 'string')
      pagePatch.knowledgeText = pagePatch.knowledgeText.slice(0, 3000);
    if (typeof pagePatch.customPersonaPrompt === 'string')
      pagePatch.customPersonaPrompt = pagePatch.customPersonaPrompt.trim().slice(0, 4000) || null;
    if (typeof pagePatch.behaviorInstructions === 'string')
      pagePatch.behaviorInstructions = pagePatch.behaviorInstructions.trim().slice(0, 3000);
    if (typeof pagePatch.customSystemPrompt === 'string')
      pagePatch.customSystemPrompt = pagePatch.customSystemPrompt.trim().slice(0, 8000) || null;
    if (typeof pagePatch.promptMode === 'string')
      pagePatch.promptMode = ['guided', 'custom'].includes(pagePatch.promptMode)
        ? pagePatch.promptMode
        : 'guided';
    // Agent handoff — one exact text/emoji command each way, capped short
    // since these are meant to be typed/tapped quickly by a human agent
    if (typeof pagePatch.stopAiCommand === 'string')
      pagePatch.stopAiCommand = pagePatch.stopAiCommand.trim().slice(0, 40) || null;
    if (typeof pagePatch.startAiCommand === 'string')
      pagePatch.startAiCommand = pagePatch.startAiCommand.trim().slice(0, 40) || null;
    if (pagePatch.autoPauseTimeoutMinutes !== undefined) {
      const n = Number(pagePatch.autoPauseTimeoutMinutes);
      pagePatch.autoPauseTimeoutMinutes = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 120;
    }
    // V24: Restaurant mode fields — explicit sanitization (never through the
    // generic whitelist: coordinates and slabs need validation, and the flag
    // must not turn on while the page is unconfigured)
    if (
      'restaurantModeEnabled' in pageFields ||
      'restaurantLat' in pageFields ||
      'restaurantLng' in pageFields ||
      'deliverySlabs' in pageFields
    ) {
      if ('restaurantLat' in pageFields) {
        const v =
          pageFields.restaurantLat === null ||
          pageFields.restaurantLat === undefined ||
          pageFields.restaurantLat === ''
            ? null
            : Number(pageFields.restaurantLat);
        if (v !== null && !isValidLat(v))
          throw new BadRequestException('Invalid restaurant latitude');
        pagePatch.restaurantLat = v;
      }
      if ('restaurantLng' in pageFields) {
        const v =
          pageFields.restaurantLng === null ||
          pageFields.restaurantLng === undefined ||
          pageFields.restaurantLng === ''
            ? null
            : Number(pageFields.restaurantLng);
        if (v !== null && !isValidLng(v))
          throw new BadRequestException('Invalid restaurant longitude');
        pagePatch.restaurantLng = v;
      }
      if ('deliverySlabs' in pageFields) {
        const raw = pageFields.deliverySlabs;
        if (!Array.isArray(raw))
          throw new BadRequestException('deliverySlabs must be an array');
        if (raw.length > MAX_DELIVERY_SLABS)
          throw new BadRequestException(
            `সর্বোচ্চ ${MAX_DELIVERY_SLABS}টা delivery slab দেওয়া যাবে`,
          );
        const slabs = raw.map((s: any) => ({
          maxKm: Number(s?.maxKm),
          fee: Number(s?.fee),
        }));
        for (const s of slabs) {
          if (!Number.isFinite(s.maxKm) || s.maxKm <= 0 || s.maxKm > 100)
            throw new BadRequestException('Slab-এর দূরত্ব (KM) সঠিক নয়');
          if (!Number.isFinite(s.fee) || s.fee < 0)
            throw new BadRequestException('Slab-এর delivery fee সঠিক নয়');
        }
        slabs.sort((a, b) => a.maxKm - b.maxKm);
        for (let i = 1; i < slabs.length; i++) {
          if (slabs[i].maxKm === slabs[i - 1].maxKm)
            throw new BadRequestException(
              'একই দূরত্বের দুটো slab দেওয়া যাবে না',
            );
        }
        pagePatch.deliverySlabsJson = slabs.length
          ? JSON.stringify(slabs)
          : null;
      }
      if ('restaurantModeEnabled' in pageFields) {
        pagePatch.restaurantModeEnabled = Boolean(
          pageFields.restaurantModeEnabled,
        );
      }
      if (pagePatch.restaurantModeEnabled === true) {
        const current: any = await this.pageService.getById(pageId);
        const merged = {
          restaurantModeEnabled: true,
          restaurantLat:
            'restaurantLat' in pagePatch
              ? pagePatch.restaurantLat
              : current.restaurantLat,
          restaurantLng:
            'restaurantLng' in pagePatch
              ? pagePatch.restaurantLng
              : current.restaurantLng,
          deliverySlabsJson:
            'deliverySlabsJson' in pagePatch
              ? pagePatch.deliverySlabsJson
              : current.deliverySlabsJson,
        };
        if (!isRestaurantReady(merged))
          throw new BadRequestException(
            'Restaurant mode চালু করতে ম্যাপে restaurant-এর location pin করুন এবং অন্তত একটা delivery fee slab দিন',
          );
      }
    }

    // V29: Messenger product-card buttons — explicit sanitization (never
    // through the generic whitelist: each row needs its type-specific fields
    // validated and a safe id minted for postback routing).
    if ('cardButtons' in pageFields) {
      const raw = pageFields.cardButtons;
      if (!Array.isArray(raw))
        throw new BadRequestException('cardButtons must be an array');
      if (raw.length > MAX_CARD_BUTTONS)
        throw new BadRequestException(
          `সর্বোচ্চ ${MAX_CARD_BUTTONS}টা button দেওয়া যাবে`,
        );
      const buttons: CardButtonConfig[] = raw.map((b: any, i: number) => {
        const type = b?.type;
        const label = String(b?.label ?? '').trim().slice(0, 30);
        const id =
          typeof b?.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(b.id)
            ? b.id
            : `btn_${Date.now().toString(36)}_${i}`;
        if (!label) throw new BadRequestException('প্রতিটা button-এর label দিতে হবে');
        if (type === 'order' || type === 'details') {
          return { id, type, label };
        }
        if (type === 'custom') {
          const url = typeof b?.url === 'string' ? b.url.trim() : '';
          const replyText =
            typeof b?.replyText === 'string' ? b.replyText.trim().slice(0, 500) : '';
          if (url && /^https?:\/\//i.test(url)) return { id, type, label, url };
          if (replyText) return { id, type, label, replyText };
          throw new BadRequestException(
            `"${label}" button-এ একটা link অথবা reply text দিতে হবে`,
          );
        }
        throw new BadRequestException('Button type সঠিক নয়');
      });
      pagePatch.productCardButtonsJson = buttons.length
        ? JSON.stringify(buttons)
        : null;
    }

    // Slug uniqueness pre-check: if catalogSlug is being set, verify no other page owns it
    if (typeof pagePatch.catalogSlug === 'string' && pagePatch.catalogSlug) {
      const conflict = await this.prisma.page.findUnique({
        where: { catalogSlug: pagePatch.catalogSlug },
        select: { id: true },
      });
      if (conflict && conflict.id !== pageId) {
        throw new ConflictException(
          'এই URL slug অন্য কেউ ব্যবহার করছে। অন্য নাম দিন।',
        );
      }
    }
    if (Object.keys(pagePatch).length > 0) {
      try {
        await this.prisma.page.update({
          where: { id: pageId },
          data: pagePatch,
        });
      } catch (err: any) {
        if (
          err?.code === 'P2002' &&
          err?.meta?.target?.includes?.('catalogSlug')
        ) {
          throw new ConflictException(
            'এই URL slug অন্য কেউ ব্যবহার করছে। অন্য নাম দিন।',
          );
        }
        throw err;
      }
    }

    // waToken requires encryption — route through pageService.updateById
    if (typeof pageFields.waToken === 'string' && pageFields.waToken.trim()) {
      await this.pageService.updateById(pageId, {
        waToken: pageFields.waToken.trim(),
      });
    }

    // telegramBotToken requires encryption — route through pageService.updateById
    if (
      typeof pageFields.telegramBotToken === 'string' &&
      pageFields.telegramBotToken.trim()
    ) {
      await this.pageService.updateById(pageId, {
        telegramBotToken: pageFields.telegramBotToken.trim(),
      });
      // Auto-register Telegram webhook so inline buttons & callbacks work immediately
      try {
        const apiBase = process.env.API_BASE_URL || 'https://api.flamboyai.com';
        await this.telegramNotif.setWebhookForPage(pageId, apiBase);
      } catch { /* non-fatal */ }
    }

    // Pricing policy
    if (pricingPolicy)
      await this.botKnowledgeService.updatePricingPolicy(pageId, pricingPolicy);

    // Call settings
    if (callSettings) {
      const CALL_FIELDS: Record<string, string> = {
        callConfirmModeOn: 'boolean',
        callMode: 'string',
        callConfirmationScope: 'string',
        initialCallDelayMinutes: 'number',
        retryIntervalMinutes: 'number',
        maxCallRetries: 'number',
        callProvider: 'string',
      };
      const cp: any = {};
      for (const [k, t] of Object.entries(CALL_FIELDS)) {
        if (k in callSettings) {
          if (k === 'callConfirmModeOn') {
            const page: any = await this.pageService.getById(pageId);
            if (
              Boolean(callSettings[k]) &&
              page?.callConfirmModeAllowed === false
            ) {
              throw new BadRequestException(
                'callConfirmModeOn is not available on your current plan. Please contact admin to upgrade.',
              );
            }
          }
          cp[k] =
            t === 'boolean'
              ? Boolean(callSettings[k])
              : t === 'number'
                ? Number(callSettings[k])
                : String(callSettings[k]);
        }
      }
      if (Object.keys(cp).length > 0)
        await this.prisma.page.update({ where: { id: pageId }, data: cp });
    }

    // Voice settings — only save script if changed (clears cached audio)
    if (voiceSettings) {
      const VOICE_STR_FIELDS = [
        'callLanguage',
        'voiceType',
        'voiceStyle',
        'ttsProvider',
        'banglaVoiceId',
        'englishVoiceId',
        'banglaCallScript',
        'englishCallScript',
      ];
      const vp: any = {};
      for (const k of VOICE_STR_FIELDS) {
        if (k in voiceSettings) vp[k] = String(voiceSettings[k] ?? '');
      }
      // If script changed, invalidate cached audio URL + regeneration timestamp
      const page: any = await this.prisma.page.findUnique({
        where: { id: pageId },
      });
      if (
        vp.banglaCallScript &&
        vp.banglaCallScript !== page?.banglaCallScript
      ) {
        vp.banglaVoiceFileUrl = null;
        vp.voiceGeneratedAt = null;
        await this.ttsService.deleteVoice(pageId, 'BN');
      }
      if (
        vp.englishCallScript &&
        vp.englishCallScript !== page?.englishCallScript
      ) {
        vp.englishVoiceFileUrl = null;
        vp.voiceGeneratedAt = null;
        await this.ttsService.deleteVoice(pageId, 'EN');
      }
      if (Object.keys(vp).length > 0)
        await this.prisma.page.update({ where: { id: pageId }, data: vp });
    }

    return this.getBusinessSettings(pageId);
  }

  private _readGlobalCallFeatureEnabled(): boolean {
    try {
      const file = path.join(process.cwd(), 'storage', 'global-config.json');
      if (fs.existsSync(file)) {
        const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
        return cfg?.callFeatureEnabled === true;
      }
    } catch {}
    return false;
  }

  private getModeAccess(page: any) {
    return {
      automationOn: page?.automationAllowed !== false,
      ocrOn: page?.ocrAllowed !== false,
      infoModeOn: page?.infoModeAllowed !== false,
      orderModeOn: page?.orderModeAllowed !== false,
      printModeOn: page?.printModeAllowed !== false,
      callConfirmModeOn: page?.callConfirmModeAllowed !== false,
      memoSaveModeOn: page?.memoSaveModeAllowed !== false,
      memoTemplateModeOn: page?.memoTemplateModeAllowed !== false,
      autoMemoDesignModeOn: page?.autoMemoDesignModeAllowed !== false,
      callFeatureEnabled: this._readGlobalCallFeatureEnabled(),
    };
  }

  // ── Voice generate / preview ───────────────────────────────────────────────
  async generateVoice(pageId: number, language: 'BN' | 'EN') {
    const page: any = await this.prisma.page.findUnique({
      where: { id: pageId },
    });
    if (!page) throw new NotFoundException('Page not found');
    const script =
      language === 'EN' ? page.englishCallScript : page.banglaCallScript;
    if (!script?.trim())
      throw new BadRequestException(`${language} script configure করা নেই`);
    const result = await this.ttsService.generateVoice(
      pageId,
      language,
      script,
      {
        voiceType: page.voiceType,
        voiceStyle: page.voiceStyle,
        ttsProvider: page.ttsProvider,
        voiceId: language === 'EN' ? page.englishVoiceId : page.banglaVoiceId,
      },
    );
    if (result.success && result.url) {
      const patch: any = { voiceGeneratedAt: new Date() };
      if (language === 'BN') patch.banglaVoiceFileUrl = result.url;
      else patch.englishVoiceFileUrl = result.url;
      await this.prisma.page.update({ where: { id: pageId }, data: patch });
    }
    return result;
  }

  async previewVoice(pageId: number, language: 'BN' | 'EN') {
    return this.ttsService.previewVoice(pageId, language);
  }

  async uploadVoice(pageId: number, language: 'BN' | 'EN', file: any) {
    const page: any = await this.prisma.page.findUnique({
      where: { id: pageId },
    });
    if (!page) throw new NotFoundException('Page not found');
    if (!file?.buffer) throw new BadRequestException('Audio file required');

    const allowedMimes = new Set([
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',
      'audio/wave',
      'audio/mp4',
      'audio/x-m4a',
      'audio/aac',
      'audio/ogg',
    ]);
    const name = String(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    const extOk = ['.mp3', '.wav', '.m4a', '.aac', '.ogg'].some((ext) =>
      name.endsWith(ext),
    );
    if (!allowedMimes.has(mime) && !extOk) {
      throw new BadRequestException(
        'Only audio files (.mp3, .wav, .m4a, .aac, .ogg) are allowed',
      );
    }

    const result = await this.ttsService.uploadVoice(pageId, language, file);
    if (result.success && result.url) {
      const patch: any = { voiceGeneratedAt: new Date() };
      if (language === 'BN') patch.banglaVoiceFileUrl = result.url;
      else patch.englishVoiceFileUrl = result.url;
      await this.prisma.page.update({ where: { id: pageId }, data: patch });
    }
    return result;
  }

  // ── Memo / Print ───────────────────────────────────────────────────────────
  async getTemplate(pageId: number) {
    try {
      return await this.memoService.getUploadedTemplate(pageId);
    } catch {
      return null;
    }
  }
  async uploadTemplate(pageId: number, file: any) {
    if (!file?.buffer) throw new BadRequestException('File required');
    return this.memoService.uploadTemplate(pageId, file);
  }
  async updateTemplateMapping(pageId: number, mapping: any, confirm = false) {
    return this.memoService.updateTemplateMapping(
      pageId,
      mapping || {},
      confirm,
    );
  }
  async getTemplatePreview(pageId: number, orderId?: number) {
    return this.memoService.getTemplatePreview(pageId, orderId);
  }
  async confirmTemplate(pageId: number) {
    return this.memoService.confirmTemplate(pageId);
  }
  async getInvoicePdf(pageId: number, ids: number[], style?: string) {
    await this.ensureOrders(pageId, ids);
    return this.printService.generateInvoicePDF(
      ids,
      (style as any) || 'classic',
    );
  }
  async htmlToPdf(html: string) {
    return this.printService.generatePdfFromHtml(html);
  }
  async getPrintHtml(pageId: number, ids: number[], style?: string) {
    await this.ensureOrders(pageId, ids);
    const orders = await this.printService.getOrders(ids);
    return this.printService.buildPrintHTML(
      orders,
      (style as any) || 'classic',
    );
  }
  async getMemoHtml(pageId: number, ids: number[], memosPerPage?: number) {
    await this.ensureOrders(pageId, ids);
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { memoTheme: true, memoLayout: true, memosPerPage: true },
    });
    const theme = (page?.memoTheme as any) || 'classic';
    const layout = (page?.memoLayout as any) || 'memo';
    const count = memosPerPage === 4 ? 4 : page?.memosPerPage || 3;
    return this.memoService.generateA4MemoHtml(
      ids,
      pageId,
      layout,
      theme,
      count,
    );
  }

  async getMemoPreviewHtml(pageId: number) {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { memoTheme: true, memoLayout: true, memosPerPage: true },
    });
    const theme = (page?.memoTheme as any) || 'classic';
    const layout = (page?.memoLayout as any) || 'memo';
    const count = page?.memosPerPage || 3;
    return this.memoService.generateSampleMemoHtml(
      pageId,
      layout,
      theme,
      count,
    );
  }

  async getMemoPreset(pageId: number) {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { memoTheme: true, memoLayout: true, memosPerPage: true },
    });
    return {
      memoTheme: page?.memoTheme || 'classic',
      memoLayout: page?.memoLayout || 'memo',
      memosPerPage: page?.memosPerPage || 3,
    };
  }

  async setMemoPreset(
    pageId: number,
    memoTheme?: string,
    memoLayout?: string,
    memosPerPage?: number,
  ) {
    const validThemes = ['classic', 'fashion', 'luxury'];
    const validLayouts = ['memo', 'invoice'];
    const update: any = {};
    if (memoTheme && validThemes.includes(memoTheme))
      update.memoTheme = memoTheme;
    if (memoLayout && validLayouts.includes(memoLayout))
      update.memoLayout = memoLayout;
    if (memosPerPage && [3, 4].includes(memosPerPage))
      update.memosPerPage = memosPerPage;
    if (Object.keys(update).length === 0) return this.getMemoPreset(pageId);
    await this.prisma.page.update({ where: { id: pageId }, data: update });
    return this.getMemoPreset(pageId);
  }

  // ── Global Search ─────────────────────────────────────────────────────────
  async globalSearch(pageId: number, q: string) {
    const term = (q || '').trim();
    if (term.length < 1) return { orders: [], customers: [], term };

    const isId = /^\d+$/.test(term);

    const [orders, customers] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          pageIdRef: pageId,
          OR: [
            { customerName: { contains: term } },
            { phone: { contains: term } },
            { address: { contains: term } },
            { orderNote: { contains: term } },
            ...(isId ? [{ id: Number(term) }] : []),
            { items: { some: { productCode: { contains: term } } } },
          ],
        },
        include: {
          items: true,
          returnEntries: true,
          exchangeEntries: true,
          collections: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      this.prisma.customer.findMany({
        where: {
          pageId,
          OR: [{ name: { contains: term } }, { phone: { contains: term } }],
        },
        take: 10,
      }),
    ]);

    return { orders, customers, term };
  }

  // ── Agent Issues ───────────────────────────────────────────────────────────
  async getAgentIssues(pageId: number) {
    return this.ordersService.getAgentIssues(pageId);
  }

  async toggleBotForCustomer(pageId: number, orderId: number) {
    return this.ordersService.toggleBotForCustomer(orderId, pageId);
  }

  async toggleBotByPsid(pageId: number, psid: string, mute: boolean) {
    return this.ordersService.toggleBotByPsid(pageId, psid, mute);
  }

  async dismissAgentIssue(pageId: number, body: any) {
    return this.ordersService.dismissAgentIssue(pageId, body);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  private async ensureOrder(pageId: number, orderId: number) {
    const o = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, pageIdRef: true },
    });
    if (!o || o.pageIdRef !== pageId)
      throw new NotFoundException('Order not found');
    return o;
  }
  private async ensureOrders(pageId: number, ids: number[]) {
    if (!ids.length) return [];
    const orders = await this.prisma.order.findMany({
      where: { id: { in: ids } },
      select: { id: true, pageIdRef: true },
    });
    if (
      orders.length !== ids.length ||
      orders.some((o) => o.pageIdRef !== pageId)
    )
      throw new NotFoundException('Some orders not found for this page');
    return orders;
  }

  // ── Wallet ─────────────────────────────────────────────────────────────────

  async getWallet(pageId: number) {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: {
        creditBalance: true,
        costPerKeywordReplyCredit: true,
        costPerVoiceMsgCredit: true,
        costPerImageCredit: true,
        costPerImageLocalCredit: true,
        costPerOcrLocalCredit: true,
        costPerOcrAiCredit: true,
        costPerAnalyzeCredit: true,
        costPerAiGenerateCredit: true,
        costPerBroadcastMsgCredit: true,
        costPerRecurringNotifCredit: true,
        costPerCommentReplyCredit: true,
        costPerMemoPrintCredit: true,
        subscriptionStatus: true,
        nextBillingDate: true,
      },
    });
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  async getCreditPackagesForPage() {
    const [packages, pricing] = await Promise.all([
      this.prisma.creditPackage.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.adminService.getGlobalPricing(),
    ]);
    return { packages, creditsPerBdt: (pricing as any).creditsPerBdt ?? 40 };
  }

  async getWalletTransactions(pageId: number, limit = 50) {
    return this.prisma.walletTransaction.findMany({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });
  }

  async submitRechargeRequest(
    pageId: number,
    body: {
      packageId?: number;
      amountBdt?: number;
      method: string;
      transactionId: string;
      note?: string;
    },
  ) {
    const { method, transactionId, note } = body;
    if (!transactionId?.trim())
      throw new BadRequestException('Transaction ID required');

    const allowed = ['bkash', 'nagad', 'bank', 'manual'];
    if (!allowed.includes(method))
      throw new BadRequestException('Invalid payment method');

    let amountBdt: number;
    let creditsAmount: number;
    let packageId: number | null = null;
    if (body.packageId) {
      const pkg = await this.prisma.creditPackage.findUnique({ where: { id: body.packageId } });
      if (!pkg || !pkg.isActive) throw new BadRequestException('Package পাওয়া যায়নি বা inactive');
      amountBdt = pkg.priceBdt;
      creditsAmount = pkg.credits;
      packageId = pkg.id;
    } else {
      if (!body.amountBdt || body.amountBdt <= 0)
        throw new BadRequestException('Amount must be positive');
      const pricing = await this.adminService.getGlobalPricing();
      const creditsPerBdt = (pricing as any).creditsPerBdt ?? 40;
      amountBdt = body.amountBdt;
      creditsAmount = Math.round(amountBdt * creditsPerBdt);
    }

    // Prevent duplicate pending request for same TrxID + page
    const existing = await this.prisma.walletRechargeRequest.findFirst({
      where: { pageId, transactionId: transactionId.trim(), status: 'pending' },
    });
    if (existing)
      throw new BadRequestException(
        'এই Transaction ID দিয়ে ইতিমধ্যে একটি request pending আছে।',
      );

    const req = await this.prisma.walletRechargeRequest.create({
      data: {
        pageId,
        amountBdt,
        creditsAmount,
        packageId,
        method,
        transactionId: transactionId.trim(),
        note: note?.trim() || null,
      },
    });

    // ── Auto-verify via admin payment config ────────────────────────────────
    const adminPay = this.adminService.getGlobalConfig().adminPayment || {};
    let autoVerified = false;

    if (adminPay.smsGatewayEnabled) {
      const match = this.adminService.matchAdminSms(
        transactionId.trim(),
        amountBdt,
      );
      if (match.matched) {
        await this.prisma.walletRechargeRequest.update({
          where: { id: req.id },
          data: {
            status: 'approved',
            approvedAt: new Date(),
            approvedBy: 'auto-sms',
          },
        });
        await this.walletService.rechargeWallet(
          pageId,
          creditsAmount,
          `${method}:${transactionId.trim()}`,
        );
        autoVerified = true;

        // Agent commission: no-op unless this page's owner was referred by an agent.
        const ownerForCommission = await this.prisma.page.findUnique({
          where: { id: pageId },
          select: { ownerId: true },
        });
        if (ownerForCommission?.ownerId) {
          void this.partner.recordEarningIfReferred(
            ownerForCommission.ownerId,
            'RECHARGE',
            amountBdt,
            String(req.id),
            pageId,
          );
        }
      }
    }

    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { pageName: true },
    });

    if (autoVerified) {
      void this.telegram.sendMessage(
        `✅ <b>Wallet Auto-Verified!</b>\n` +
          `🏪 Page: ${page?.pageName || pageId}\n` +
          `💵 Amount: ৳${amountBdt} → ${creditsAmount} credit\n` +
          `📱 Method: ${method} | TxID: ${transactionId.trim()}`,
      );
      return {
        success: true,
        requestId: req.id,
        autoVerified: true,
        message: 'Payment auto-verified! Balance যোগ হয়েছে।',
      };
    }

    // Notify admin on Telegram with inline Approve/Reject buttons so the admin
    // can credit the balance straight from Telegram (no dashboard needed).
    // The callbacks are handled in TelegramController.handleAdminCallback.
    void this.telegram.sendMessageWithButtons(
      `💰 <b>নতুন Wallet Recharge Request!</b>\n` +
        `🏪 Page: ${page?.pageName || pageId}\n` +
        `💵 Amount: ৳${amountBdt} → ${creditsAmount} credit\n` +
        `📱 Method: ${method}\n` +
        `🔖 TxID: ${transactionId.trim()}\n` +
        (note ? `📝 Note: ${note}\n` : '') +
        `🕐 সময়: ${new Date().toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' })}`,
      [
        [
          { text: '✅ Approve', callback_data: `recharge_approve_${req.id}` },
          { text: '❌ Reject', callback_data: `recharge_reject_${req.id}` },
        ],
      ],
    );

    return { success: true, requestId: req.id, autoVerified: false };
  }

  async getRechargeRequests(pageId: number) {
    return this.prisma.walletRechargeRequest.findMany({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { package: { select: { id: true, name: true } } },
    });
  }

  async chargeMemoDownload(pageId: number, ids: number[]): Promise<number> {
    if (!ids?.length) return 0;

    const newOrders = await this.prisma.order.findMany({
      where: { pageIdRef: pageId, id: { in: ids }, printedAt: null },
      select: { id: true },
    });

    const newCount = newOrders.length;
    if (newCount === 0) return 0;

    await this.walletService.deductUsage(pageId, 'MEMO_PRINT', {
      memoCount: newCount,
    });

    await this.prisma.order.updateMany({
      where: { pageIdRef: pageId, id: { in: newOrders.map((o) => o.id) } },
      data: { printedAt: new Date() },
    });

    return newCount;
  }
}
