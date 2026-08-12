import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import * as fs from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentVerifyService } from '../payment-verify/payment-verify.service';
import { SmsGatewayService } from '../sms-gateway/sms-gateway.service';
import { TelegramNotificationService } from '../telegram/telegram-notification.service';
import { ReviewsService } from '../reviews/reviews.service';
import { PricingService } from '../pricing/pricing.service';
import {
  haversineKm,
  isRestaurantReady,
  isValidLat,
  isValidLng,
  parseMapsPoint,
  parsePriceVariants,
  parseSlabs,
  priceRangeText,
  PriceVariant,
  resolveDeliveryFee,
  resolveMapsShortLink,
  parseBusinessHours,
  isOpenNow,
} from '../common/restaurant-delivery';

// ── Video URL helpers ─────────────────────────────────────────────────────────

function extractYouTubeId(url: string): string | null {
  if (!url?.trim()) return null;
  const m = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  );
  return m?.[1] ?? null;
}

function extractFacebookVideoId(url: string): string | null {
  if (!url?.trim()) return null;
  // facebook.com/video/xxx  |  fb.watch/xxx  |  facebook.com/reel/xxx
  const m = url.match(
    /(?:facebook\.com\/(?:video|reel|watch)\/|fb\.watch\/|facebook\.com\/[^/]+\/videos\/)([0-9a-zA-Z_-]+)/,
  );
  return m?.[1] ?? null;
}

type VideoType = 'youtube' | 'facebook' | null;

function detectVideoType(url: string): VideoType {
  if (!url?.trim()) return null;
  if (extractYouTubeId(url)) return 'youtube';
  if (url.includes('facebook.com') || url.includes('fb.watch'))
    return 'facebook';
  return null;
}

/** Convert any name to URL-safe slug: "Limon Tech Diary" → "limon-tech-diary" */
export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Build Prisma where clause: tries numeric id → slug → Facebook pageId */
function pageWhere(pid: string) {
  const numId = Number(pid);
  if (!isNaN(numId) && numId > 0) return { id: numId, isActive: true };
  return { OR: [{ catalogSlug: pid }, { pageId: pid }], isActive: true } as any;
}

function esc(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizePhone(phone?: string | null): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('880')) return digits;
  if (digits.startsWith('0')) return `88${digits}`;
  return digits;
}

function buildWhatsAppUrl(phone?: string | null): string {
  const normalized = normalizePhone(phone);
  return normalized ? `https://wa.me/${normalized}` : '';
}

function isWhatsAppUrl(url?: string | null): boolean {
  const value = String(url ?? '').toLowerCase();
  return value.includes('wa.me/') || value.includes('whatsapp.com/');
}

function buildFacebookPageUrl(
  pageId?: string | null,
  messengerUrl?: string | null,
) {
  const customUrl = String(messengerUrl ?? '').trim();
  if (customUrl && !isWhatsAppUrl(customUrl)) return customUrl;
  const cleanPageId = String(pageId ?? '').trim();
  if (!cleanPageId) return '';
  return `https://www.facebook.com/${cleanPageId}`;
}

// ── Controller ────────────────────────────────────────────────────────────────

// ── "Powered by" badge ───────────────────────────────────────────────────────

const LANDING_URL = process.env.LANDING_PAGE_URL || '';
const POWERED_CSS = `
/* Powered-by badge */
.pwby{position:fixed;bottom:16px;right:16px;z-index:9999;display:flex;align-items:center;gap:6px;background:rgba(15,23,42,.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:rgba(255,255,255,.75);text-decoration:none;padding:6px 11px 6px 8px;border-radius:22px;font-size:11.5px;font-weight:600;letter-spacing:.01em;border:1px solid rgba(255,255,255,.12);box-shadow:0 4px 16px rgba(0,0,0,.22);transition:all .18s;white-space:nowrap;font-family:"Inter",system-ui,sans-serif}
.pwby:hover{background:rgba(79,70,229,.85);color:#fff;border-color:rgba(255,255,255,.25);transform:translateY(-2px);box-shadow:0 6px 20px rgba(79,70,229,.35)}
.pwby-icon{width:18px;height:18px;border-radius:6px;background:linear-gradient(135deg,#4f46e5,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0}
.pwby-text{opacity:.85}.pwby-brand{opacity:1;font-weight:700;color:#a5b4fc}
.pwby:hover .pwby-text,.pwby:hover .pwby-brand{opacity:1;color:#fff}
@media(max-width:480px){.pwby{bottom:12px;right:12px;padding:5px 9px 5px 7px;font-size:11px}}`;

function poweredByBadge(): string {
  if (!LANDING_URL) return '';
  return `
<style>${POWERED_CSS}</style>
<a class="pwby" href="${esc(LANDING_URL)}" target="_blank" rel="noopener" title="FlamboyAI দিয়ে তৈরি">
  <div class="pwby-icon">🤖</div>
  <span class="pwby-text">Powered by </span><span class="pwby-brand">FlamboyAI</span>
</a>`;
}

@SkipThrottle({ global: true, auth: true, chat: true }) // Public catalog page — no auth needed
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productsService: ProductsService,
    private readonly ordersService: OrdersService,
    private readonly paymentVerify: PaymentVerifyService,
    private readonly smsGatewayService: SmsGatewayService,
    private readonly telegram: TelegramNotificationService,
    private readonly reviews: ReviewsService,
    private readonly pricing: PricingService,
  ) {}

  private normalizeCodeList(raw?: string): string[] {
    return String(raw || '')
      .split(',')
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 12);
  }

  private parseReferenceImages(raw?: string | null): string[] {
    const value = String(raw || '').trim();
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => String(item || '').trim())
          .filter(Boolean)
          .filter((url, index, all) => all.indexOf(url) === index);
      }
    } catch {
      // Allow legacy plain-text values.
    }
    return value
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((url, index, all) => all.indexOf(url) === index);
  }

  // JSON API — used by dashboard preview
  @Get(':pageId/data')
  async getCatalogData(
    @Param('pageId') pid: string,
    @Query('q') q?: string,
    @Query('codes') codes?: string,
  ) {
    return this.buildData(pid, q, codes);
  }

  // Single product HTML page
  @Get(':pageId/product/:code')
  async getProductHtml(
    @Param('pageId') pid: string,
    @Param('code') code: string,
    @Res() res: Response,
    @Query('select') select?: string,
    @Query('codes') codes?: string,
  ) {
    const page = await this.prisma.page.findFirst({
      where: pageWhere(pid),
      select: {
        id: true,
        pageId: true,
        pageName: true,
        businessName: true,
        businessPhone: true,
        businessAddress: true,
        logoUrl: true,
        currencySymbol: true,
        primaryColor: true,
        memoFooterText: true,
        catalogMessengerUrl: true,
        catalogSlug: true,
        paymentMode: true,
        advanceAmount: true,
        advanceBkash: true,
        advanceNagad: true,
        advanceRocket: true,
        advancePaymentMessage: true,
        webOrderEnabled: true,
        restaurantModeEnabled: true,
        restaurantLat: true,
        restaurantLng: true,
        deliverySlabsJson: true,
      },
    });
    if (!page) {
      res.status(404).send('<h2>Page not found</h2>');
      return;
    }

    const product = await this.prisma.product.findFirst({
      where: { pageId: page.id, code: code.toUpperCase(), isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        price: true,
        originalPrice: true,
        stockQty: true,
        imageUrl: true,
        description: true,
        videoUrl: true,
        variantOptions: true,
        deliveryCharge: true,
        category: true,
        priceVariantsJson: true,
        trackStock: true,
      },
    });
    if (!product) {
      res.status(404).send('<h2>Product not found</h2>');
      return;
    }

    // Independent lookups — run in parallel instead of one-after-another.
    const [productWithReferenceImages, reviewSummary, happyHour] = await Promise.all([
      this.productsService.attachReferenceImages(page.id, product),
      this.reviews
        .listForProduct(page.id, product.code)
        .catch(() => ({ avgRating: 0, count: 0, reviews: [] })),
      this.pricing
        .getHappyHourStatus(page.id)
        .catch(() => ({ active: false, discountPercent: 0, label: '' })),
    ]);

    // V21: Increment product view counter — fire-and-forget
    void this.prisma.product
      .update({
        where: { id: product.id },
        data: { productViews: { increment: 1 } },
      })
      .catch(() => {});

    const pageInfo = {
      id: page.id,
      pageId: page.pageId,
      name: page.businessName || page.pageName,
      phone: page.businessPhone || '',
      logoUrl: page.logoUrl || '',
      currency: page.currencySymbol || '৳',
      primaryColor: page.primaryColor || '#5b63f5',
      footerText: page.memoFooterText || '',
      messengerUrl: page.catalogMessengerUrl || `https://m.me/${page.pageId}`,
      whatsappUrl: buildWhatsAppUrl(page.businessPhone),
      facebookPageUrl: buildFacebookPageUrl(
        page.pageId,
        page.catalogMessengerUrl,
      ),
      webOrderEnabled: (page as any).webOrderEnabled ?? false,
      paymentMode: (page as any).paymentMode ?? 'cod',
      advanceAmount: (page as any).advanceAmount ?? 0,
      advanceBkash: (page as any).advanceBkash ?? '',
      advanceNagad: (page as any).advanceNagad ?? '',
      advanceRocket: (page as any).advanceRocket ?? '',
      advancePaymentMessage: (page as any).advancePaymentMessage ?? '',
      // V24: Restaurant mode — map-pin checkout with distance-slab fee
      restaurantMode: isRestaurantReady(page as any),
      restaurantLat: (page as any).restaurantLat ?? null,
      restaurantLng: (page as any).restaurantLng ?? null,
      deliverySlabs: parseSlabs((page as any).deliverySlabsJson),
    };
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
      this.buildProductHtml(pageInfo, productWithReferenceImages, {
        selectionMode: select === '1',
        shortlistCodes: this.normalizeCodeList(codes),
        reviewSummary,
        happyHour,
      }),
    );
  }

  // Custom domain route — Nginx proxies shop.mybrand.com → /catalog/by-domain?host=shop.mybrand.com
  @Get('by-domain')
  async getCatalogByDomain(
    @Res() res: Response,
    @Query('host') host: string,
    @Query('path') path?: string,
    @Query('q') q?: string,
    @Query('codes') codes?: string,
    @Query('select') select?: string,
  ) {
    const domain = (host || '')
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')
      .split('/')[0];
    if (!domain) {
      res.status(400).send('<h2>Bad Request</h2>');
      return;
    }

    const page = await this.prisma.page.findFirst({
      where: { customDomain: domain, isActive: true },
      select: { id: true },
    });
    if (!page) {
      res
        .status(404)
        .send(
          '<html><body style="font-family:sans-serif;padding:40px"><h2>Website not found</h2><p>No website is configured for this domain.</p></body></html>',
        );
      return;
    }

    // If path includes /product/:code, serve product page
    const productMatch = (path || '').match(/\/product\/([A-Z0-9]+)/i);
    if (productMatch) {
      return this.getProductHtml(
        String(page.id),
        productMatch[1],
        res,
        select,
        codes,
      );
    }

    const data = await this.buildData(String(page.id), q, codes);
    if ('error' in data) {
      res.status(404).send('<h2>Not found</h2>');
      return;
    }
    void this.prisma.page
      .update({
        where: { id: page.id },
        data: { catalogViews: { increment: 1 } },
      })
      .catch(() => {});
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
      this.buildHtml(data, q || '', {
        selectionMode: select === '1',
        shortlistCodes: this.normalizeCodeList(codes),
      }),
    );
  }

  // Static Bangladesh division/district/upazila reference data for the
  // checkout address selects — loaded once and cached in memory.
  // Registered before the ':pageId' catch-all route below (literal routes
  // must be declared before same-depth wildcard routes or they get shadowed).
  private static bdGeoCache: any = null;
  @Get('bd-geo')
  getBdGeo(@Res() res: Response) {
    if (!CatalogController.bdGeoCache) {
      const raw = fs.readFileSync(
        join(process.cwd(), 'src', 'catalog', 'bd-geo-data.json'),
        'utf8',
      );
      CatalogController.bdGeoCache = JSON.parse(raw);
    }
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.json(CatalogController.bdGeoCache);
  }

  // Resolve a Google Maps link (incl. maps.app.goo.gl short links, which the
  // browser can't follow due to CORS) or raw coordinates into {lat, lng} for
  // the restaurant checkout's paste-location fallback.
  @Get('maps-resolve')
  async mapsResolve(@Query('u') u: string) {
    const input = String(u || '').trim();
    if (!input) throw new BadRequestException('u required');
    const point = parseMapsPoint(input) || (await resolveMapsShortLink(input));
    if (!point)
      throw new BadRequestException(
        'লোকেশন পড়া যায়নি — Google Maps-এর share link বা "23.79, 90.41" ফরম্যাটে দিন',
      );
    return point;
  }

  // ── Web Order Endpoints ────────────────────────────────────────────────────

  @Post(':pageId/web-order')
  async createWebOrder(@Param('pageId') pid: string, @Body() body: any) {
    const page = await this.prisma.page.findFirst({
      where: pageWhere(pid),
      select: {
        id: true,
        paymentMode: true,
        advanceAmount: true,
        advanceBkash: true,
        advanceNagad: true,
        advanceRocket: true,
        advancePaymentMessage: true,
        webOrderEnabled: true,
        smsGatewayEnabled: true,
        restaurantModeEnabled: true,
        restaurantLat: true,
        restaurantLng: true,
        deliverySlabsJson: true,
      },
    });
    if (!page) throw new NotFoundException('Page not found');
    if (!page.webOrderEnabled)
      throw new BadRequestException(
        'Web ordering is not enabled for this page',
      );

    const {
      customerName,
      phone,
      address,
      productCode,
      qty,
      price,
      productName,
      orderNote,
    } = body;
    if (!customerName?.trim()) throw new BadRequestException('নাম দিন');
    if (!phone?.trim()) throw new BadRequestException('ফোন নম্বর দিন');
    if (!address?.trim()) throw new BadRequestException('ঠিকানা দিন');
    if (!productCode) throw new BadRequestException('Product code required');

    // V25: Server-authoritative pricing. The client's `price` is only a
    // display value — the real unit price comes from the product row, and for
    // size/portion products from the chosen variant.
    const product = await this.prisma.product.findFirst({
      where: {
        pageId: page.id,
        code: String(productCode).toUpperCase(),
        isActive: true,
      },
      select: { price: true, name: true, priceVariantsJson: true },
    });
    if (!product) throw new BadRequestException('Product পাওয়া যায়নি');
    const priceVariants = parsePriceVariants(product.priceVariantsJson);
    let unitPrice = Number(product.price) || Number(price) || 0;
    let itemMetaJson: string | null = null;
    let itemName = productName || product.name || undefined;
    if (priceVariants.length > 0) {
      const chosen = priceVariants.find(
        (v) => v.label === String(body.variantLabel ?? '').trim(),
      );
      if (!chosen) throw new BadRequestException('সাইজ/পরিমাণ বেছে নিন');
      unitPrice = chosen.price;
      itemMetaJson = JSON.stringify({
        variantLabel: chosen.label,
        ...(chosen.pieces ? { pieces: chosen.pieces } : {}),
      });
      itemName = `${product.name || productCode} (${chosen.label})`;
    }

    // V24: Restaurant mode — fee is ALWAYS recomputed here from the customer's
    // map pin; anything fee-like sent by the client is ignored.
    let restaurantDelivery: {
      deliveryLat: number;
      deliveryLng: number;
      deliveryFee: number;
      deliveryDistanceKm: number;
    } | null = null;
    if (isRestaurantReady(page)) {
      const dLat = Number(body.deliveryLat);
      const dLng = Number(body.deliveryLng);
      if (!isValidLat(dLat) || !isValidLng(dLng))
        throw new BadRequestException('ম্যাপে আপনার ডেলিভারি লোকেশন pin করুন');
      const distanceKm =
        Math.round(
          haversineKm(page.restaurantLat!, page.restaurantLng!, dLat, dLng) *
            100,
        ) / 100;
      const slab = resolveDeliveryFee(
        parseSlabs(page.deliverySlabsJson),
        distanceKm,
      );
      if (!slab)
        throw new BadRequestException(
          'দুঃখিত, আপনার লোকেশন আমাদের ডেলিভারি এলাকার বাইরে 😔',
        );
      restaurantDelivery = {
        deliveryLat: dLat,
        deliveryLng: dLng,
        deliveryFee: slab.fee,
        deliveryDistanceKm: distanceKm,
      };
    }

    const order = await this.ordersService.createWebOrder({
      pageIdRef: page.id,
      customerName: String(customerName).trim(),
      phone: String(phone).trim(),
      address: String(address).trim(),
      orderNote: orderNote?.trim() || undefined,
      items: [
        {
          productCode: String(productCode).toUpperCase(),
          qty: Math.max(1, Number(qty) || 1),
          unitPrice,
          productName: itemName,
          metaJson: itemMetaJson,
        },
      ],
      paymentMode: page.paymentMode,
      ...(restaurantDelivery ?? {}),
    });

    const requiresPayment = order.paymentStatus === 'pending_proof';
    if (!requiresPayment) {
      return { orderId: order.id, paymentRequired: false };
    }

    // Check for gateway / direct credential
    const credential = await this.paymentVerify.getActiveCredential(page.id);
    if (credential?.type === 'gateway') {
      const { randomUUID } = require('crypto') as typeof import('crypto');
      const sessionToken = randomUUID();
      const apiBase =
        process.env.API_BASE_URL ||
        `http://localhost:${process.env.PORT || 3000}`;
      await this.prisma.pendingPayment.create({
        data: {
          pageId: page.id,
          psid: 'WEB',
          draftJson: JSON.stringify({ webOrder: true }),
          amount: page.advanceAmount || 0,
          method: credential.method,
          sessionToken,
          webOrderId: order.id,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
      });
      const paymentUrl = await this.paymentVerify.generateGatewayLink(
        page.id,
        credential.method,
        sessionToken,
        page.advanceAmount || 0,
        apiBase,
      );
      return {
        orderId: order.id,
        paymentRequired: true,
        method: 'gateway',
        paymentUrl,
      };
    }

    if (credential?.type === 'direct') {
      return {
        orderId: order.id,
        paymentRequired: true,
        method: 'direct',
        directMethod: credential.method,
        advanceAmount: page.advanceAmount,
        advanceBkash: page.advanceBkash,
        advanceNagad: page.advanceNagad,
        advanceRocket: (page as any).advanceRocket,
      };
    }

    if ((page as any).smsGatewayEnabled) {
      return {
        orderId: order.id,
        paymentRequired: true,
        method: 'sms',
        advanceAmount: page.advanceAmount,
        advanceBkash: page.advanceBkash,
        advanceNagad: page.advanceNagad,
        advanceRocket: (page as any).advanceRocket,
      };
    }

    return {
      orderId: order.id,
      paymentRequired: true,
      method: 'manual',
      advanceAmount: page.advanceAmount,
      advanceBkash: page.advanceBkash,
      advanceNagad: page.advanceNagad,
      advanceRocket: (page as any).advanceRocket,
      advancePaymentMessage: page.advancePaymentMessage,
    };
  }

  @Post(':pageId/web-order/:orderId/sms-txid')
  async submitSmsTxId(
    @Param('pageId') pid: string,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body('transactionId') transactionId: string,
  ) {
    const page = await this.prisma.page.findFirst({
      where: pageWhere(pid),
      select: { id: true, advanceAmount: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    if (!transactionId?.trim())
      throw new BadRequestException('Transaction ID required');
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, pageIdRef: page.id },
      select: { id: true, paymentStatus: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.paymentStatus !== 'pending_proof')
      throw new BadRequestException('Payment not expected');

    const smsMatch = await this.smsGatewayService.matchPayment(
      page.id,
      transactionId.trim(),
      null,
      page.advanceAmount ?? 0,
    );
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: 'advance_paid',
        transactionId: transactionId.trim(),
        paymentVerifyStatus: smsMatch.matched ? 'verified' : 'pending_review',
      },
    });
    return { success: true, autoVerified: smsMatch.matched };
  }

  @Post(':pageId/web-order/:orderId/verify-direct')
  async verifyDirectPayment(
    @Param('pageId') pid: string,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() body: any,
  ) {
    const page = await this.prisma.page.findFirst({
      where: pageWhere(pid),
      select: { id: true, advanceAmount: true },
    });
    if (!page) throw new NotFoundException('Page not found');

    const credential = await this.paymentVerify.getActiveCredential(page.id);
    if (!credential || credential.type !== 'direct')
      throw new BadRequestException('No direct payment credential configured');

    const result = await this.paymentVerify.verifyDirect(
      page.id,
      credential.method,
      String(body.transactionId || ''),
      page.advanceAmount || 0,
    );

    if (result.verified) {
      await this.ordersService.confirmWebOrderPayment(orderId, page.id);
      return { success: true, verified: true };
    }

    return {
      success: false,
      verified: false,
      fallbackToScreenshot: true,
      message: result.errorMessage,
    };
  }

  @Post(':pageId/web-order/:orderId/payment-proof')
  @UseInterceptors(
    FileInterceptor('screenshot', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async uploadPaymentProof(
    @Param('pageId') pid: string,
    @Param('orderId', ParseIntPipe) orderId: number,
    @UploadedFile() file: any,
    @Body('transactionId') transactionId?: string,
  ) {
    const page = await this.prisma.page.findFirst({
      where: pageWhere(pid),
      select: { id: true, smsGatewayEnabled: true, advanceAmount: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    if (!file?.buffer && !transactionId?.trim())
      throw new BadRequestException('Transaction ID or screenshot required');

    // If only TxID provided (no screenshot) — try SMS gateway match first
    if (!file?.buffer && transactionId?.trim()) {
      const smsMatch = await this.smsGatewayService.matchPayment(
        page.id,
        transactionId.trim(),
        null,
        page.advanceAmount ?? 0,
      );
      const order = await this.prisma.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: 'advance_paid',
          transactionId: transactionId.trim(),
          paymentVerifyStatus: smsMatch.matched ? 'verified' : 'pending_review',
        },
        select: { id: true, customerName: true, phone: true },
      });
      const status = smsMatch.matched
        ? '✅ Auto-verified'
        : '⏳ Pending review';
      void this.telegram
        .notify(
          page.id,
          `💸 Payment Received\nOrder #${order.id}\nTxID: ${transactionId.trim()}\nCustomer: ${order.customerName ?? '?'} | ${order.phone ?? '?'}\nStatus: ${status}`,
        )
        .catch(() => {});
      return { success: true, autoVerified: smsMatch.matched };
    }

    // Screenshot provided — send to Telegram, don't store on server
    await this.ordersService.uploadWebOrderScreenshot(
      orderId,
      page.id,
      file,
      transactionId,
    );
    return { success: true, autoVerified: false };
  }

  @Get(':pageId/order-status/:orderId')
  async getOrderStatus(
    @Param('pageId') pid: string,
    @Param('orderId', ParseIntPipe) orderId: number,
  ) {
    const page = await this.prisma.page.findFirst({
      where: pageWhere(pid),
      select: { id: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    return this.ordersService.getWebOrderStatus(orderId, page.id);
  }

  @Get(':pageId/track')
  async getTrackPage(@Param('pageId') pid: string, @Res() res: Response) {
    const page = await this.prisma.page.findFirst({
      where: pageWhere(pid),
      select: { id: true, primaryColor: true },
    });
    if (!page) {
      res.status(404).send('<h2>Not found</h2>');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
      this.buildTrackHtml(String(page.id), page.primaryColor || '#5b63f5'),
    );
  }

  @Get(':pageId/order-success/:orderId')
  async getOrderSuccessPage(
    @Param('pageId') pid: string,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Res() res: Response,
  ) {
    const page = await this.prisma.page.findFirst({
      where: pageWhere(pid),
      select: { id: true, primaryColor: true },
    });
    if (!page) {
      res.status(404).send('<h2>Not found</h2>');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
      this.buildOrderSuccessHtml(
        String(page.id),
        orderId,
        page.primaryColor || '#5b63f5',
      ),
    );
  }

  // Public HTML catalog page
  @Get(':pageId')
  async getCatalogHtml(
    @Param('pageId') pid: string,
    @Res() res: Response,
    @Query('q') q: string,
    @Query('codes') codes?: string,
    @Query('select') select?: string,
  ) {
    const data = await this.buildData(pid, q, codes);
    if ('error' in data) {
      res
        .status(404)
        .send(
          '<html><body style="font-family:sans-serif;padding:40px"><h2>Page not found</h2></body></html>',
        );
      return;
    }
    // V21: Increment catalog view counter — fire-and-forget
    void this.prisma.page
      .update({
        where: { id: data.page.id },
        data: { catalogViews: { increment: 1 } },
      })
      .catch(() => {});
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
      this.buildHtml(data, q || '', {
        selectionMode: select === '1',
        shortlistCodes: this.normalizeCodeList(codes),
      }),
    );
  }

  // ── Data builder ────────────────────────────────────────────────────────
  private async buildData(
    pageId: string,
    search?: string,
    codeFilterRaw?: string,
  ) {
    const page = await this.prisma.page.findFirst({
      where: pageWhere(pageId),
      select: {
        id: true,
        pageId: true,
        pageName: true,
        businessName: true,
        businessPhone: true,
        businessAddress: true,
        logoUrl: true,
        currencySymbol: true,
        primaryColor: true,
        memoFooterText: true,
        catalogMessengerUrl: true,
        catalogSlug: true,
        catalogViews: true,
        customDomain: true,
        websiteUrl: true,
        websiteEnabled: true,
        restaurantModeEnabled: true,
        menuImagesJson: true,
        businessHoursJson: true,
        businessInfo: true,
        owner: { select: { isActive: true } },
      },
    });
    if (!page) return { error: 'Page not found' };
    if ((page as any).owner?.isActive === false)
      return { error: 'Account is disabled' };
    if ((page as any).websiteEnabled === false)
      return { error: 'Website is currently unavailable' };

    const where: any = {
      pageId: page.id,
      isActive: true,
      catalogVisible: true,
      // trackStock=false (restaurant food) — BOM ingredients are the real
      // stock, so item stockQty must not hide the dish from the menu
      AND: [{ OR: [{ stockQty: { gt: 0 } }, { trackStock: false }] }],
    };
    if (search?.trim()) {
      where.AND.push({
        OR: [
          { name: { contains: search } },
          { code: { contains: search.toUpperCase() } },
          { description: { contains: search } },
        ],
      });
    }
    const filteredCodes = this.normalizeCodeList(codeFilterRaw);
    if (filteredCodes.length > 0) {
      where.code = { in: filteredCodes };
    }

    const rawProducts = await this.prisma.product.findMany({
      where,
      orderBy: [{ catalogSortOrder: 'asc' }, { id: 'desc' }],
      select: {
        id: true,
        code: true,
        name: true,
        price: true,
        originalPrice: true,
        stockQty: true,
        imageUrl: true,
        description: true,
        videoUrl: true,
        productViews: true,
        deliveryCharge: true,
        category: true,
        priceVariantsJson: true,
        trackStock: true,
        isFeatured: true,
      },
    });
    // Fall back to the first Reference Image when no main Image URL is set —
    // otherwise products added via paste-into-Reference-Images show no photo here,
    // even though the single product page already handles this correctly.
    const productsWithRefs =
      await this.productsService.attachReferenceImagesList(
        page.id,
        rawProducts,
      );
    const products = productsWithRefs.map((p: any) => ({
      ...p,
      imageUrl:
        p.imageUrl ||
        this.parseReferenceImages(p.referenceImagesJson)[0] ||
        null,
      priceVariants: parsePriceVariants(p.priceVariantsJson),
    }));

    return {
      page: {
        id: page.id,
        pageId: page.pageId,
        name: page.businessName || page.pageName,
        phone: page.businessPhone || '',
        address: page.businessAddress || '',
        logoUrl: page.logoUrl || '',
        currency: page.currencySymbol || '৳',
        // Restaurant pages default to a warm food-brand orange; the
        // merchant's own primaryColor always wins when set.
        primaryColor:
          page.primaryColor ||
          ((page as any).restaurantModeEnabled ? '#ea580c' : '#5b63f5'),
        tagline:
          String((page as any).businessInfo || '')
            .split('\n')[0]
            ?.slice(0, 90) || '',
        footerText: page.memoFooterText || '',
        messengerUrl: page.catalogMessengerUrl || `https://m.me/${page.pageId}`,
        whatsappUrl: buildWhatsAppUrl(page.businessPhone),
        facebookPageUrl: buildFacebookPageUrl(
          page.pageId,
          page.catalogMessengerUrl,
        ),
        catalogSlug: page.catalogSlug || null,
        catalogViews: page.catalogViews ?? 0,
        customDomain: page.customDomain || null,
        websiteUrl: page.websiteUrl || null,
        restaurantMode: Boolean((page as any).restaurantModeEnabled),
        menuImages: (() => {
          try {
            const raw = JSON.parse((page as any).menuImagesJson || '[]');
            return Array.isArray(raw)
              ? raw.filter((u: any) => typeof u === 'string')
              : [];
          } catch {
            return [];
          }
        })(),
        // null when the merchant hasn't set hours yet — hides the badge
        businessHours: (() => {
          const raw = (page as any).businessHoursJson;
          if (!raw) return null;
          try {
            return parseBusinessHours(JSON.parse(raw));
          } catch {
            return null;
          }
        })(),
      },
      products,
      total: products.length,
    };
  }

  // ── Single product HTML page ─────────────────────────────────────────────
  private buildProductHtml(
    page: any,
    p: any,
    opts?: {
      selectionMode?: boolean;
      shortlistCodes?: string[];
      reviewSummary?: { avgRating: number; count: number; reviews: any[] };
      happyHour?: { active: boolean; discountPercent: number; label: string };
    },
  ): string {
    const primary = esc(page.primaryColor);
    const currency = esc(page.currency);
    // trackStock=false (restaurant food) — BOM ingredients are the inventory,
    // the item itself is always orderable while active
    const inStock = p.trackStock === false ? true : p.stockQty > 0;
    const foodVariants = parsePriceVariants(p.priceVariantsJson);
    const hasFoodVariants = foodVariants.length > 0;
    const qtyMax = p.trackStock === false ? 99 : p.stockQty;
    const selectionMode = Boolean(opts?.selectionMode);
    const shortlistCodes = opts?.shortlistCodes || [];
    const shortlistQuery = shortlistCodes.length
      ? `?select=1&codes=${encodeURIComponent(shortlistCodes.join(','))}`
      : '?select=1';
    const catalogHref = shortlistCodes.length
      ? `/catalog/${esc(page.id)}${shortlistQuery}`
      : `/catalog/${esc(page.id)}`;

    const reviewSummary = opts?.reviewSummary || { avgRating: 0, count: 0, reviews: [] };
    const happyHour = opts?.happyHour;
    const stars = (n: number) =>
      '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
    const reviewsHtml = reviewSummary.count
      ? `<div class="desc-lbl">রিভিউ</div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <span style="color:#f59e0b;font-size:16px;letter-spacing:1px;">${stars(reviewSummary.avgRating)}</span>
          <span style="font-size:12.5px;color:#6b7280;">${reviewSummary.avgRating} (${reviewSummary.count}টা রিভিউ)</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px;">
          ${reviewSummary.reviews
            .slice(0, 10)
            .map(
              (r: any) => `<div style="border:1px solid #e5e7eb;border-radius:9px;padding:8px 10px;">
                <div style="display:flex;justify-content:space-between;gap:8px;">
                  <span style="font-weight:700;font-size:12.5px;">${esc(r.customerName || 'Customer')}</span>
                  <span style="color:#f59e0b;font-size:12px;">${stars(r.rating)}</span>
                </div>
                ${r.comment ? `<div style="font-size:12.5px;color:#374151;margin-top:3px;">${esc(r.comment)}</div>` : ''}
              </div>`,
            )
            .join('')}
        </div>
        <div class="divider"></div>`
      : '';

    const videoType = detectVideoType(p.videoUrl || '');
    const ytId = videoType === 'youtube' ? extractYouTubeId(p.videoUrl) : null;
    const isFB = videoType === 'facebook';
    const galleryImages = [
      p.imageUrl,
      ...this.parseReferenceImages(p.referenceImagesJson),
    ].filter((value, index, all) => !!value && all.indexOf(value) === index);
    const primaryImage = galleryImages[0] || '';
    const hasMedia = !!(ytId || isFB || primaryImage);

    let mediaBlock = '';
    let videoBlock = '';
    let imageBlock = '';

    if (ytId) {
      videoBlock = `<div class="media-frame video-box" id="main-video"><iframe src="https://www.youtube.com/embed/${esc(ytId)}?rel=0&modestbranding=1&color=white" frameborder="0" allowfullscreen allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" loading="lazy"></iframe></div>`;
    } else if (isFB) {
      const fbUrl = encodeURIComponent(p.videoUrl);
      videoBlock = `<div class="media-frame video-box fb-box" id="main-video"><iframe src="https://www.facebook.com/plugins/video.php?href=${fbUrl}&width=500&show_text=false" frameborder="0" allowfullscreen scrolling="no" allow="autoplay;clipboard-write;encrypted-media;picture-in-picture;web-share" loading="lazy"></iframe></div>`;
    }

    if (primaryImage) {
      imageBlock = `<div class="media-frame img-frame" id="main-img" ${videoBlock ? 'style="display:none"' : ''}><img src="${esc(primaryImage)}" alt="${esc(p.name || p.code)}" loading="lazy" onerror="this.closest('.media-frame').outerHTML=noImgBlock"/></div>`;
    }

    mediaBlock = videoBlock + imageBlock;

    let galleryBlock = '';
    const hasMultiple = (videoBlock ? 1 : 0) + galleryImages.length > 1;
    if (hasMultiple) {
      let g = '<div class="gallery-strip">';
      let firstActive = true;
      if (videoBlock) {
        g += `<button class="g-thumb active" type="button" onclick="setGalleryMode('video', this)"><div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#0f172a;color:#fff;font-size:24px;">🎬</div></button>`;
        firstActive = false;
      }
      g += galleryImages
        .map((url: string, index: number) => {
          const isActive = firstActive && index === 0;
          return `<button class="g-thumb ${isActive ? 'active' : ''}" type="button" onclick="setGalleryMode('image', this, '${esc(url)}')"><img src="${esc(url)}" alt="${esc(p.name || p.code)} view ${index + 1}" loading="lazy"/></button>`;
        })
        .join('');
      g += '</div>';
      galleryBlock = g;
    }

    let variantHtml = '';
    if (p.variantOptions) {
      try {
        const variants: Array<{ label: string; choices?: string[] }> =
          JSON.parse(p.variantOptions);
        variantHtml = variants
          .filter((v) => v.choices?.length)
          .map(
            (v) => `
          <div class="var-group">
            <div class="var-label">${esc(v.label)}</div>
            <div class="var-chips">
              ${v.choices!.map((c) => `<button class="chip" onclick="this.parentElement.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));this.classList.add('active')">${esc(c)}</button>`).join('')}
            </div>
          </div>`,
          )
          .join('');
      } catch {
        /* ignore */
      }
    }

    const orderText = encodeURIComponent(`${p.code} order করতে চাই`);
    const selectText = encodeURIComponent(`SELECT_PRODUCT:${p.code}`);
    const priceFormatted = Number(p.price).toLocaleString('bn-BD');
    const productPublicUrl = `https://api.flamboyai.com/catalog/${esc(page.id)}/product/${esc(p.code)}`;
    const ogOfferBit =
      Number(p.originalPrice) > Number(p.price) && Number(p.price) > 0
        ? `🔥 ${Math.round((1 - Number(p.price) / Number(p.originalPrice)) * 100)}% ছাড় — আগের দাম ${currency}${Number(p.originalPrice).toLocaleString()} · `
        : '';
    const productDesc = `${ogOfferBit}মূল্য: ${currency}${Number(p.price).toLocaleString()} · ${inStock ? 'Stock আছে' : 'Stock নেই'} · ${esc(p.description || p.name || p.code)} — ${esc(page.name)}`;
    const mmeOrderUrl = `https://m.me/${esc(page.pageId)}?text=${orderText}`;
    // V21: WhatsApp share URL
    const waShareText = encodeURIComponent(
      `${p.name || p.code} — ${currency}${Number(p.price).toLocaleString()}\n${productPublicUrl}`,
    );
    const waShareUrl = `https://wa.me/?text=${waShareText}`;

    return `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="theme-color" content="${primary}"/>
<title>${esc(p.name || p.code)} — ${esc(page.name)} | Online Shop</title>
<meta name="description" content="${productDesc}"/>
<meta name="robots" content="index, follow"/>
<link rel="canonical" href="${productPublicUrl}"/>
<meta property="og:type" content="product"/>
<meta property="og:url" content="${productPublicUrl}"/>
<meta property="og:site_name" content="${esc(page.name)}"/>
<meta property="og:title" content="${esc(p.name || p.code)} — ${esc(page.name)}"/>
<meta property="og:description" content="${productDesc}"/>
${
  primaryImage
    ? `<meta property="og:image" content="${esc(primaryImage)}"/>
<meta property="og:image:width" content="800"/>
<meta property="og:image:height" content="800"/>`
    : ''
}
<meta property="og:locale" content="bn_BD"/>
<meta property="product:price:amount" content="${Number(p.price)}"/>
<meta property="product:price:currency" content="BDT"/>
<meta property="product:availability" content="${inStock ? 'in stock' : 'out of stock'}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(p.name || p.code)} — ${esc(page.name)}"/>
<meta name="twitter:description" content="${productDesc}"/>
${primaryImage ? `<meta name="twitter:image" content="${esc(primaryImage)}"/>` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"/>
${
  page.webOrderEnabled && page.restaurantMode
    ? `<link rel="stylesheet" href="/vendor/leaflet/leaflet.css"/>
<script src="/vendor/leaflet/leaflet.js"></script>`
    : ''
}
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --p:${primary};
  --p-dark:color-mix(in srgb,${primary} 78%,#000);
  --p-light:color-mix(in srgb,${primary} 12%,#fff);
  --p-mid:color-mix(in srgb,${primary} 18%,transparent);
  --bg:#f4f6fb;
  --surface:#fff;
  --text:#0d1117;
  --sub:#4b5563;
  --muted:#9ca3af;
  --border:#e5e7eb;
  --r:18px;
  --shadow:0 2px 20px rgba(0,0,0,.07),0 1px 4px rgba(0,0,0,.04);
  --shadow-lg:0 8px 40px rgba(0,0,0,.1),0 2px 8px rgba(0,0,0,.06);
}
html{scroll-behavior:smooth}
body{font-family:"Hind Siliguri","Inter",system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;-webkit-font-smoothing:antialiased}

/* ── NAV ── */
.nav{position:sticky;top:0;z-index:200;background:rgba(255,255,255,.92);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-bottom:1px solid var(--border);box-shadow:0 1px 8px rgba(0,0,0,.04)}
.nav-inner{max-width:980px;margin:0 auto;padding:11px 20px;display:flex;align-items:center;gap:10px}
.nav-logo{width:34px;height:34px;border-radius:10px;object-fit:cover;flex-shrink:0;border:1.5px solid var(--border)}
.nav-logo-ph{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,var(--p),var(--p-dark));display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0}
.nav-biz{font-size:14.5px;font-weight:700;color:var(--text);letter-spacing:-.2px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nav-back{display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:22px;background:var(--bg);color:var(--sub);text-decoration:none;font-size:12.5px;font-weight:600;border:1.5px solid var(--border);transition:all .15s;white-space:nowrap;flex-shrink:0}
.nav-back:hover{background:var(--p);color:#fff;border-color:var(--p)}
.nav-back svg{width:13px;height:13px;fill:currentColor}

/* ── LAYOUT ── */
.wrapper{max-width:1100px;margin:32px auto 100px;padding:0 28px}
.product-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:start}

/* ── MEDIA COLUMN ── */
.media-col{position:sticky;top:70px;display:flex;flex-direction:column;gap:16px}
.media-frame{border-radius:22px;overflow:hidden;box-shadow:var(--shadow-lg);background:var(--surface);position:relative}
.img-frame img{width:100%;aspect-ratio:4/5;object-fit:cover;display:block;transition:transform .5s cubic-bezier(.25,.46,.45,.94)}
.img-frame:hover img{transform:scale(1.04)}
.gallery-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:12px}
.g-thumb{appearance:none;border:1.5px solid var(--border);border-radius:14px;overflow:hidden;aspect-ratio:1;background:var(--surface);padding:0;cursor:pointer;box-shadow:var(--shadow);transition:transform .15s,border-color .15s,box-shadow .15s}
.g-thumb:hover{transform:translateY(-1px);border-color:color-mix(in srgb,var(--p) 30%,#dbe4f0)}
.g-thumb.active{border-color:var(--p);box-shadow:0 0 0 3px color-mix(in srgb,var(--p) 16%,transparent),var(--shadow)}
.g-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.video-box{aspect-ratio:16/9;position:relative}
.fb-box{aspect-ratio:4/3}
.video-box iframe{position:absolute;inset:0;width:100%;height:100%;border:none}

/* No-image placeholder — rich design */
.no-img-card{background:linear-gradient(145deg,var(--p-light),color-mix(in srgb,var(--p) 6%,#fff));border-radius:22px;box-shadow:var(--shadow-lg);overflow:hidden;position:relative;aspect-ratio:4/5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:32px;border:1.5px solid color-mix(in srgb,var(--p) 14%,#fff)}
.no-img-orb{position:absolute;border-radius:50%;opacity:.18;pointer-events:none}
.no-img-orb-1{width:260px;height:260px;top:-60px;left:-60px;background:radial-gradient(circle,var(--p),transparent 70%)}
.no-img-orb-2{width:200px;height:200px;bottom:-40px;right:-40px;background:radial-gradient(circle,var(--p-dark),transparent 70%)}
.no-img-icon{font-size:72px;line-height:1;filter:drop-shadow(0 4px 12px rgba(0,0,0,.12));position:relative;z-index:1}
.no-img-code{position:relative;z-index:1;background:rgba(255,255,255,.75);backdrop-filter:blur(8px);border:1.5px solid color-mix(in srgb,var(--p) 22%,#fff);border-radius:12px;padding:10px 22px;text-align:center}
.no-img-code-lbl{font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;margin-bottom:4px}
.no-img-code-val{font-size:22px;font-weight:900;color:var(--p);letter-spacing:.04em}
.no-img-hint{position:relative;z-index:1;font-size:11.5px;color:var(--muted);font-weight:500;text-align:center;opacity:.8}

/* Info panel below image */
.media-info-strip{background:var(--surface);border-radius:14px;padding:14px 18px;box-shadow:var(--shadow);display:flex;gap:0;border:1px solid var(--border)}
.mi-item{flex:1;text-align:center;position:relative}
.mi-item+.mi-item::before{content:'';position:absolute;left:0;top:10%;bottom:10%;width:1px;background:var(--border)}
.mi-val{font-size:13px;font-weight:800;color:var(--text);margin-bottom:3px}
.mi-lbl{font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.06em}
.tips-card{margin-top:14px;background:linear-gradient(135deg,var(--p-light),color-mix(in srgb,var(--p) 6%,#fff));border:1.5px solid color-mix(in srgb,var(--p) 18%,#fff);border-radius:16px;padding:16px 16px 14px;box-shadow:var(--shadow)}
.tips-kicker{font-size:10.5px;font-weight:800;color:var(--p);letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px}
.tips-title{font-size:14px;font-weight:800;color:var(--text);margin-bottom:10px}
.tips-list{display:grid;gap:7px}
.tip-row{display:flex;align-items:flex-start;gap:8px;font-size:12.5px;color:var(--sub);line-height:1.6}
.tip-dot{width:22px;height:22px;border-radius:999px;background:rgba(255,255,255,.72);border:1px solid color-mix(in srgb,var(--p) 16%,#fff);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0}
.tips-visual{margin-top:12px;display:grid;grid-template-columns:96px 1fr;gap:10px;align-items:center}
.tips-frame{position:relative;width:96px;height:118px;border-radius:16px;background:rgba(255,255,255,.82);border:1.5px dashed color-mix(in srgb,var(--p) 18%,#fff)}
.tips-frame::before{content:'';position:absolute;inset:14px 12px;border:2px solid var(--p);border-radius:12px}
.tips-frame::after{content:'1 item';position:absolute;bottom:8px;left:8px;padding:4px 8px;border-radius:999px;background:var(--p);color:#fff;font-size:9px;font-weight:800}
.tips-copy{font-size:12px;color:var(--sub);line-height:1.55}

/* ── INFO CARD ── */
.info-card{background:var(--surface);border-radius:22px;box-shadow:var(--shadow-lg);overflow:hidden}
.info-card-accent{height:5px;background:linear-gradient(90deg,var(--p),var(--p-dark),color-mix(in srgb,var(--p) 60%,#c084fc))}
.info-body{padding:32px 32px 36px}

/* Breadcrumb */
.bc{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-bottom:16px}
.bc a{color:var(--muted);text-decoration:none;transition:color .12s}
.bc a:hover{color:var(--p)}
.bc-sep{opacity:.35}

/* Code pill */
.code-pill{display:inline-flex;align-items:center;gap:5px;background:var(--p-light);border:1px solid color-mix(in srgb,var(--p) 20%,transparent);color:var(--p);font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;padding:5px 12px;border-radius:8px;margin-bottom:14px}

/* Name */
.pname{font-size:25px;font-weight:800;line-height:1.35;color:var(--text);letter-spacing:-.4px;margin-bottom:22px}

/* Price block */
.price-block{display:flex;align-items:center;gap:16px;padding:20px 24px;background:linear-gradient(135deg,var(--p-mid),color-mix(in srgb,var(--p) 8%,transparent));border-radius:16px;border:1.5px solid color-mix(in srgb,var(--p) 18%,transparent);margin-bottom:26px}
.price-val{font-size:38px;font-weight:900;color:var(--p);letter-spacing:-1px;line-height:1}
.price-offer{display:flex;flex-direction:column;gap:4px}
.price-old{font-size:16px;font-weight:700;color:var(--muted);text-decoration:line-through}
.off-badge{display:inline-block;align-self:flex-start;background:#ef4444;color:#fff;font-size:12px;font-weight:800;padding:3px 10px;border-radius:999px;margin-top:2px}
.stock-pill{font-size:11.5px;font-weight:700;padding:5px 13px;border-radius:20px;letter-spacing:.03em;white-space:nowrap}
.s-in{background:#dcfce7;color:#15803d;border:1px solid #bbf7d0}
.s-out{background:#fee2e2;color:#dc2626;border:1px solid #fecaca}

/* Divider */
.divider{height:1px;background:var(--border);margin:18px 0}

/* Variants */
.var-group{margin-bottom:16px}
.var-label{font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;margin-bottom:9px}
.var-chips{display:flex;flex-wrap:wrap;gap:7px}
.chip{padding:7px 16px;border-radius:22px;border:1.5px solid var(--border);font-size:13px;font-weight:600;color:var(--sub);background:var(--surface);cursor:pointer;transition:all .15s;font-family:inherit}
.chip:hover,.chip.active{border-color:var(--p);color:var(--p);background:var(--p-light);transform:translateY(-1px);box-shadow:0 2px 8px color-mix(in srgb,var(--p) 20%,transparent)}

/* Description */
.desc-lbl{font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;margin-bottom:9px}
.desc-txt{font-size:14px;color:var(--sub);line-height:1.85}

/* CTA */
.cta-stack{display:flex;flex-direction:column;gap:10px;margin-top:2px}
.btn-order{display:flex;align-items:center;justify-content:center;gap:9px;background:linear-gradient(135deg,var(--p),var(--p-dark));color:#fff;text-decoration:none;padding:15px 24px;border-radius:14px;font-weight:700;font-size:15px;transition:all .2s;box-shadow:0 4px 18px color-mix(in srgb,var(--p) 38%,transparent);font-family:inherit;border:none;cursor:pointer;letter-spacing:.01em}
.btn-order:hover:not(.disabled){transform:translateY(-2px);box-shadow:0 8px 28px color-mix(in srgb,var(--p) 48%,transparent)}
.btn-order:active:not(.disabled){transform:translateY(0)}
.btn-order.disabled{background:var(--border);color:var(--muted);pointer-events:none;box-shadow:none}
.btn-secondary{display:flex;align-items:center;justify-content:center;gap:7px;background:var(--bg);color:var(--sub);text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600;font-size:13.5px;transition:all .15s;border:1.5px solid var(--border)}
.btn-secondary:hover{background:var(--border);color:var(--text)}

/* Share + phone */
.action-row{display:flex;gap:8px;margin-top:8px}
.btn-action{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;background:var(--bg);color:var(--sub);border:1.5px solid var(--border);border-radius:10px;padding:10px 8px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;text-decoration:none;white-space:nowrap}
.btn-action:hover{background:var(--border);color:var(--text);border-color:#d1d5db}

/* Trust */
.trust-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--border)}
.trust-item{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);font-weight:600;background:var(--bg);padding:4px 10px;border-radius:20px;border:1px solid var(--border)}

/* ── FOOTER ── */
.site-footer{background:var(--surface);border-top:1px solid var(--border);padding:28px 20px;text-align:center;margin-top:16px}
.footer-inner{max-width:980px;margin:0 auto}
.footer-biz{font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px}
.footer-sub{font-size:13px;color:var(--muted)}
.footer-sub a{color:var(--p);text-decoration:none;font-weight:600}
.footer-help{font-size:13px;color:var(--muted);margin-top:8px}
.footer-links{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:10px}
.footer-links a{color:var(--p);text-decoration:none;font-weight:600}

/* ── MOBILE STICKY CTA ── */
.mobile-cta{display:none;position:fixed;bottom:0;left:0;right:0;z-index:300;padding:10px 16px 18px;background:linear-gradient(to top,rgba(255,255,255,1) 60%,rgba(255,255,255,0));pointer-events:none}
.mobile-cta .btn-order{pointer-events:all}

/* ── MOBILE ── */
@media(max-width:680px){
  .wrapper{padding:0 14px;margin-top:14px;margin-bottom:80px}
  .product-grid{grid-template-columns:1fr;gap:18px}
  .media-col{position:static}
  .img-frame img{aspect-ratio:1/1}
  .info-body{padding:22px 20px 26px}
  .pname{font-size:20px}
  .price-val{font-size:32px}
  .price-block{padding:16px 18px}
  .btn-order{font-size:15px;padding:15px 20px}
  .mobile-cta{display:block}
  .media-info-strip{display:none}
}

/* ── ANIMATIONS ── */
@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
.media-col{animation:fadeUp .4s ease both}
.info-card{animation:fadeUp .4s .07s ease both}

/* ── DARK MODE ── */
@media(prefers-color-scheme:dark){
  :root{color-scheme:dark;--bg:#0b0b13;--surface:#13131f;--text:#eeeef5;--sub:#9ca3af;--muted:#6b7280;--border:rgba(255,255,255,.08)}
  .nav{background:rgba(19,19,31,.92)!important}
  .no-img-card{background:linear-gradient(145deg,rgba(79,70,229,.12),rgba(124,58,237,.07))!important;border-color:rgba(255,255,255,.07)!important}
  .media-info-strip{background:rgba(255,255,255,.03)}
  .s-in{background:rgba(21,128,61,.18);color:#4ade80;border-color:rgba(21,128,61,.3)}
  .s-out{background:rgba(220,38,38,.18);color:#f87171;border-color:rgba(220,38,38,.3)}
  .mobile-cta{background:linear-gradient(to top,rgba(11,11,19,1) 60%,rgba(11,11,19,0))!important}
}
[data-dark="1"]{color-scheme:dark;--bg:#0b0b13;--surface:#13131f;--text:#eeeef5;--sub:#9ca3af;--muted:#6b7280;--border:rgba(255,255,255,.08)}
[data-dark="1"] .nav{background:rgba(19,19,31,.92)!important}
[data-dark="1"] .no-img-card{background:linear-gradient(145deg,rgba(79,70,229,.12),rgba(124,58,237,.07))!important;border-color:rgba(255,255,255,.07)!important}
[data-dark="1"] .media-info-strip{background:rgba(255,255,255,.03)}
[data-dark="1"] .s-in{background:rgba(21,128,61,.18);color:#4ade80;border-color:rgba(21,128,61,.3)}
[data-dark="1"] .s-out{background:rgba(220,38,38,.18);color:#f87171;border-color:rgba(220,38,38,.3)}
[data-dark="1"] .mobile-cta{background:linear-gradient(to top,rgba(11,11,19,1) 60%,rgba(11,11,19,0))!important}
[data-dark="0"]{color-scheme:light;--bg:#f4f6fb;--surface:#fff;--text:#0d1117;--sub:#4b5563;--muted:#9ca3af;--border:#e5e7eb}
[data-dark="0"] body{background:var(--bg)!important}
[data-dark="0"] .nav{background:rgba(255,255,255,.92)!important}
[data-dark="0"] .no-img-card{background:linear-gradient(145deg,var(--p-light),color-mix(in srgb,var(--p) 6%,#fff))!important;border-color:color-mix(in srgb,var(--p) 14%,#fff)!important}
[data-dark="0"] .media-info-strip{background:var(--surface)!important}
[data-dark="0"] .info-card{background:var(--surface)!important}
[data-dark="0"] .s-in{background:#dcfce7!important;color:#15803d!important;border-color:#bbf7d0!important}
[data-dark="0"] .s-out{background:#fee2e2!important;color:#dc2626!important;border-color:#fecaca!important}
[data-dark="0"] .mobile-cta{background:linear-gradient(to top,rgba(255,255,255,1) 60%,rgba(255,255,255,0))!important}
[data-dark="0"] .chip{background:var(--surface)!important;color:var(--sub)!important;border-color:var(--border)!important}
[data-dark="0"] .btn-secondary{background:var(--bg)!important;color:var(--sub)!important;border-color:var(--border)!important}
[data-dark="0"] .btn-action{background:var(--bg)!important;color:var(--sub)!important;border-color:var(--border)!important}
[data-dark="0"] .site-footer{background:var(--surface)!important;border-color:var(--border)!important}

/* Dark toggle button */
.dark-btn{background:var(--bg);border:1.5px solid var(--border);color:var(--sub);border-radius:22px;padding:6px 12px;font-size:14px;cursor:pointer;transition:all .15s;flex-shrink:0;line-height:1;display:flex;align-items:center;justify-content:center}
.dark-btn:hover{background:var(--border)}
</style>
<script>
(function(){
  var s=localStorage.getItem('cat_dark');
  var sys=window.matchMedia('(prefers-color-scheme:dark)').matches;
  document.documentElement.dataset.dark=(s!==null?s==='1':sys)?'1':'0';
})();
</script>
</head>
<body>

<nav class="nav">
  <div class="nav-inner">
    ${
      page.logoUrl
        ? `<img src="${esc(page.logoUrl)}" alt="logo" class="nav-logo" onerror="this.outerHTML='<div class=nav-logo-ph>🛍️</div>'">`
        : `<div class="nav-logo-ph">🛍️</div>`
    }
    <span class="nav-biz">${esc(page.name)}</span>
    <a href="${catalogHref}" class="nav-back">
      <svg viewBox="0 0 20 20"><path d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"/></svg>
      সব Product
    </a>
    <button class="dark-btn" id="dkBtn" onclick="(function(){var d=document.documentElement.dataset.dark==='1';document.documentElement.dataset.dark=d?'0':'1';localStorage.setItem('cat_dark',d?'0':'1');document.getElementById('dkBtn').textContent=d?'🌙':'☀️'})()">🌙</button>
  </div>
</nav>
<script>document.addEventListener('DOMContentLoaded',function(){var b=document.getElementById('dkBtn');if(b)b.textContent=document.documentElement.dataset.dark==='1'?'☀️':'🌙'});</script>

<div class="wrapper">
  ${happyHour?.active ? `<div style="background:#f59e0b18;border:1px solid #f59e0b40;color:#b45309;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-weight:700;font-size:13px;text-align:center;">${esc(happyHour.label)}</div>` : ''}
  <div class="product-grid">

    <!-- Left: Media -->
    <div class="media-col">
      ${
        hasMedia
          ? mediaBlock
          : `
      <div class="no-img-card">
        <div class="no-img-orb no-img-orb-1"></div>
        <div class="no-img-orb no-img-orb-2"></div>
        <div class="no-img-icon">🛍️</div>
        <div class="no-img-code">
          <div class="no-img-code-lbl">Product Code</div>
          <div class="no-img-code-val">${esc(p.code)}</div>
        </div>
        <div class="no-img-hint">ছবি শীঘ্রই আসছে</div>
      </div>`
      }

      ${galleryBlock}

      <div class="media-info-strip">
        <div class="mi-item">
          <div class="mi-val">${currency}${Number(p.price).toLocaleString()}</div>
          <div class="mi-lbl">Price</div>
        </div>
        <div class="mi-item">
          <div class="mi-val" style="color:${inStock ? '#16a34a' : '#dc2626'}">${inStock ? 'Available' : 'Out'}</div>
          <div class="mi-lbl">Stock</div>
        </div>
        <div class="mi-item">
          <div class="mi-val">${esc(p.code)}</div>
          <div class="mi-lbl">Code</div>
        </div>
      </div>
    </div>

    <!-- Right: Info -->
    <div class="info-card">
      <div class="info-card-accent"></div>
      <div class="info-body">

        <div class="bc">
          <a href="/catalog/${esc(page.id)}">Catalog</a>
          <span class="bc-sep">›</span>
          <span>${esc(p.name || p.code)}</span>
        </div>

        <div class="code-pill">🏷️ ${esc(p.code)}</div>
        <div class="pname">${esc(p.name || p.code)}</div>

        <div class="price-block">
          ${
            hasFoodVariants
              ? `<div class="price-val" id="pvPrice">${priceRangeText(foodVariants, p.price, currency)}</div>`
              : Number(p.originalPrice) > Number(p.price) && Number(p.price) > 0
                ? `<div class="price-offer"><span class="price-old">${currency}${Number(p.originalPrice).toLocaleString()}</span><div class="price-val">${currency}${Number(p.price).toLocaleString()}</div><span class="off-badge">-${Math.round((1 - Number(p.price) / Number(p.originalPrice)) * 100)}% ছাড়</span></div>`
                : `<div class="price-val">${currency}${Number(p.price).toLocaleString()}</div>`
          }
          <span class="stock-pill ${inStock ? 's-in' : 's-out'}">${inStock ? '✓ In Stock' : '✕ Stock Out'}</span>
          ${p.deliveryCharge === 'FREE' ? '<span class="stock-pill s-in">🚚 Free Delivery</span>' : ''}
          ${p.category && hasFoodVariants ? `<span class="stock-pill s-in" style="background:var(--p-light);color:var(--p-dark);border-color:var(--p-mid)">🍽️ ${esc(p.category)}</span>` : ''}
        </div>

        ${
          hasFoodVariants
            ? `<div class="var-group">
            <div class="var-label">সাইজ/পরিমাণ বেছে নিন</div>
            <div class="var-chips" id="pvChips">
              ${foodVariants.map((v, i) => `<button class="chip pv-chip${i === 0 ? ' active' : ''}" data-label="${esc(v.label)}" data-price="${v.price}" onclick="pvSelect(this)">${esc(v.label)} — ${currency}${v.price.toLocaleString()}</button>`).join('')}
            </div>
          </div><div class="divider"></div>`
            : ''
        }

        ${variantHtml ? `${variantHtml}<div class="divider"></div>` : ''}

        ${
          p.description
            ? `
        <div class="desc-lbl">বিবরণ</div>
        <div class="desc-txt">${esc(p.description)}</div>
        <div class="divider"></div>`
            : '<div class="divider"></div>'
        }

        ${reviewsHtml}

        <div class="cta-stack">
          ${
            selectionMode
              ? `<a class="btn-order${!inStock ? ' disabled' : ''}"
            href="${esc(page.messengerUrl)}?text=${selectText}"
            target="_blank" rel="noopener"
            ${!inStock ? 'onclick="return false"' : ''}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            ${inStock ? 'এই Product টা Select করুন' : 'Stock নেই'}
          </a>`
              : ''
          }
          <a class="btn-order${!inStock ? ' disabled' : ''}"
            href="${inStock ? mmeOrderUrl : '#'}"
            target="_blank" rel="noopener"
            ${!inStock ? 'onclick="return false"' : ''}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            ${inStock ? 'Messenger এ Order করুন' : 'Stock নেই'}
          </a>
          ${
            page.webOrderEnabled && inStock
              ? `<button class="btn-order" style="background:linear-gradient(135deg,#059669,#047857);box-shadow:0 4px 18px rgba(5,150,105,.35)" onclick="woOpen()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
            Website থেকে Order করুন
          </button>`
              : ''
          }
          <a class="btn-secondary" href="${catalogHref}">
            🛍️ ${shortlistCodes.length ? 'শর্টলিস্টে ফিরে যান' : 'সব Product দেখুন'}
          </a>
        </div>

        <div class="action-row">
          <button class="btn-action" onclick="if(navigator.share){navigator.share({title:'${esc(p.name || p.code)}',url:location.href})}else{navigator.clipboard.writeText(location.href);this.innerHTML='✅ Copied!'}">
            🔗 Share
          </button>
          <a class="btn-action" href="${waShareUrl}" target="_blank" rel="noopener">
            💚 WhatsApp
          </a>
          ${page.phone ? `<a class="btn-action" href="tel:${esc(page.phone)}">📞 Call</a>` : ''}
        </div>

        <div class="trust-row">
          <span class="trust-item">🔒 Secure Order</span>
          <span class="trust-item">💬 Fast Reply</span>
          ${inStock ? '<span class="trust-item">🚚 Home Delivery</span>' : ''}
        </div>

      </div>
    </div>

  </div>
</div>

${
  inStock
    ? `
<div class="mobile-cta" style="display:flex;gap:10px;flex-wrap:wrap">
  <a class="btn-order" href="${mmeOrderUrl}" target="_blank" rel="noopener" style="flex:1;min-width:0">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    Messenger
  </a>
  ${
    page.webOrderEnabled
      ? `<button class="btn-order" onclick="woOpen()" style="flex:1;min-width:0;background:linear-gradient(135deg,#059669,#047857);box-shadow:0 4px 18px rgba(5,150,105,.35)">
    🌐 Website Order
  </button>`
      : ''
  }
</div>`
    : ''
}

<footer class="site-footer">
  <div class="footer-inner">
    <div class="footer-biz">${esc(page.name)}</div>
    <div class="footer-sub">
      ${page.footerText ? `${esc(page.footerText)} · ` : ''}
      <a href="${esc(page.messengerUrl)}" target="_blank">💬 Messenger এ Order করুন</a>
    </div>
    ${page.phone ? `<div class="footer-help">Helpline: ${esc(page.phone)}</div>` : ''}
    ${
      page.whatsappUrl || page.facebookPageUrl
        ? `<div class="footer-links">
      ${page.whatsappUrl ? `<a href="${esc(page.whatsappUrl)}" target="_blank" rel="noopener">WhatsApp Support</a>` : ''}
      ${page.facebookPageUrl ? `<a href="${esc(page.facebookPageUrl)}" target="_blank" rel="noopener">Facebook Page</a>` : ''}
    </div>`
        : ''
    }
  </div>
</footer>

${
  page.webOrderEnabled
    ? `
<!-- ── Web Order Modal ── -->
<style>
.wo-overlay{display:none;position:fixed;inset:0;z-index:600;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);align-items:flex-end;justify-content:center;padding:0}
@media(min-width:480px){.wo-overlay{align-items:center;padding:16px}}
.wo-overlay.open{display:flex}
.wo-sheet{background:var(--surface);border-radius:22px 22px 0 0;width:100%;max-width:480px;max-height:92vh;overflow-y:auto;box-shadow:0 -8px 40px rgba(0,0,0,.18);animation:slideUp .28s ease both}
@media(min-width:480px){.wo-sheet{border-radius:22px;animation:fadeUp .25s ease both}}
@keyframes slideUp{from{transform:translateY(60px);opacity:0}to{transform:none;opacity:1}}
@keyframes fadeUp{from{transform:translateY(20px);opacity:0}to{transform:none;opacity:1}}
.wo-head{padding:20px 20px 0;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:14px}
.wo-title{font-size:16px;font-weight:800;color:var(--text)}
.wo-close{width:30px;height:30px;border-radius:50%;border:1.5px solid var(--border);background:var(--bg);cursor:pointer;font-size:16px;color:var(--muted);display:flex;align-items:center;justify-content:center}
.wo-body{padding:18px 20px 24px;display:flex;flex-direction:column;gap:13px}
.wo-lbl{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px}
.wo-inp{width:100%;padding:11px 13px;border-radius:11px;border:1.5px solid var(--border);background:var(--bg);color:var(--text);font-size:14px;font-family:inherit;outline:none;transition:border-color .15s}
.wo-inp:focus{border-color:var(--p)}
.wo-row2{display:grid;grid-template-columns:1fr 80px;gap:10px}
.wo-row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px}
@media(max-width:380px){.wo-row3{grid-template-columns:1fr}}
.wo-row3 select:disabled{opacity:.55;cursor:not-allowed}
.wo-addr-lbl-row{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:5px}
.wo-addr-loading{font-size:10.5px;color:var(--muted);display:none}
.wo-addr-loading.show{display:inline}
#woMap{height:230px;border-radius:12px;border:1.5px solid var(--border);margin-bottom:8px;overflow:hidden;z-index:1}
.wo-gps-btn{width:100%;padding:10px;border-radius:11px;border:1.5px solid var(--p);background:var(--p-light);color:var(--p-dark);font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px}
.wo-gps-btn:disabled{opacity:.6;cursor:not-allowed}
.wo-fee-box{font-size:13.5px;padding:11px 13px;border-radius:11px;border:1.5px solid var(--border);background:var(--bg);color:var(--sub);line-height:1.6;margin-bottom:4px}
.wo-fee-box.ok{border-color:#a7f3d0;background:#ecfdf5;color:#065f46;font-weight:600}
.wo-fee-box.bad{border-color:#fecaca;background:#fef2f2;color:#991b1b;font-weight:600}
.wo-product-info{padding:12px 14px;background:var(--bg);border-radius:12px;border:1px solid var(--border);font-size:13.5px;color:var(--text)}
.wo-product-info strong{color:var(--p);font-size:15px}
.wo-btn{width:100%;padding:13px;border-radius:13px;border:none;background:linear-gradient(135deg,#059669,#047857);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 4px 18px rgba(5,150,105,.35)}
.wo-btn:disabled{opacity:.6;cursor:not-allowed}
.wo-err{font-size:13px;color:#991b1b;padding:10px 13px;background:#fef2f2;border-radius:10px;border:1.5px solid #fecaca;display:none;line-height:1.5}
.wo-payment-box{padding:15px;background:color-mix(in srgb,var(--p) 8%,transparent);border:1.5px solid color-mix(in srgb,var(--p) 25%,transparent);border-radius:13px;font-size:13.5px;color:var(--text);line-height:1.7}
.wo-num{font-size:22px;font-weight:900;color:var(--p);letter-spacing:.04em}
.wo-file-area{display:flex;align-items:center;justify-content:center;gap:8px;padding:14px;border-radius:12px;border:2px dashed var(--border);cursor:pointer;font-size:13.5px;font-weight:600;color:var(--muted);transition:border-color .15s;background:var(--bg)}
.wo-file-area:hover{border-color:var(--p);color:var(--p)}
.wo-method-btn{display:flex;align-items:center;gap:14px;width:100%;padding:14px 16px;border-radius:14px;border:2px solid var(--border);background:var(--bg);color:var(--text);font-family:inherit;cursor:pointer;text-align:left;transition:border-color .15s,background .15s}
.wo-method-btn:hover{border-color:var(--p);background:color-mix(in srgb,var(--p) 6%,transparent)}
.wo-success{text-align:center;padding:20px 0 8px}
.wo-success .wo-icon{font-size:52px;margin-bottom:12px}
.wo-success h3{font-size:18px;font-weight:800;color:#059669;margin-bottom:6px}
.wo-success .wo-oid{font-size:32px;font-weight:900;color:var(--p);margin:10px 0}
.wo-success .wo-msg{font-size:13px;color:var(--sub);line-height:1.6;padding:12px 14px;background:var(--bg);border-radius:10px;border:1px solid var(--border);text-align:left;margin-top:10px}
.wo-step{display:none}.wo-step.active{display:block}
.wo-progress-track{height:4px;background:var(--border);border-radius:2px;margin:0 20px;overflow:hidden}
.wo-progress-fill{height:100%;width:33%;border-radius:2px;background:linear-gradient(90deg,var(--p),var(--p-dark));transition:width .3s ease}
.wo-progress-labels{display:flex;justify-content:space-between;padding:6px 20px 0;font-size:10.5px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.wo-progress-labels span.on{color:var(--p)}
</style>

<div class="wo-overlay" id="woModal" onclick="if(event.target===this)woClose()">
  <div class="wo-sheet">
    <div class="wo-head">
      <span class="wo-title" id="woTitle">🛒 Order করুন</span>
      <button class="wo-close" onclick="woClose()">✕</button>
    </div>
    <div class="wo-progress-track"><div class="wo-progress-fill" id="woProgressFill"></div></div>
    <div class="wo-progress-labels">
      <span id="woProgLbl1" class="on">তথ্য</span>
      <span id="woProgLbl2">পেমেন্ট</span>
      <span id="woProgLbl3">সম্পন্ন</span>
    </div>
    <div class="wo-body">

      <!-- Step 0: Order Form -->
      <div class="wo-step active" id="woStep0">
        <div class="wo-product-info">
          <strong>${esc(p.name || p.code)}</strong><br>
          <span style="font-size:13px;color:var(--sub)">${esc(p.code)} · <span id="woInfoPrice">${
            hasFoodVariants
              ? `${esc(page.currency)}${foodVariants[0].price.toLocaleString()} (${esc(foodVariants[0].label)})`
              : `${esc(page.currency)}${Number(p.price).toLocaleString('bn-BD')}`
          }</span></span>
        </div>
        ${
          hasFoodVariants
            ? `<div><div class="wo-lbl">সাইজ/পরিমাণ *</div><select class="wo-inp" id="woSizeSel" onchange="woSizeChange()">${foodVariants.map((v, i) => `<option value="${esc(v.label)}" data-price="${v.price}"${i === 0 ? ' selected' : ''}>${esc(v.label)} — ${currency}${v.price.toLocaleString()}</option>`).join('')}</select></div>`
            : ''
        }
        ${(() => {
          let varSelects = '';
          try {
            const vopts = JSON.parse(p.variantOptions || '[]');
            if (Array.isArray(vopts) && vopts.length) {
              varSelects = vopts
                .map((v: any) => {
                  const label = esc(String(v.label || ''));
                  const choices: string[] = Array.isArray(v.choices)
                    ? v.choices
                    : [];
                  if (!choices.length) return '';
                  const opts = choices
                    .map(
                      (c: string) =>
                        `<option value="${esc(c)}">${esc(c)}</option>`,
                    )
                    .join('');
                  return `<div><div class="wo-lbl">${label}</div><select class="wo-inp wo-variant" data-label="${label}"><option value="">-- ${label} বেছে নিন --</option>${opts}</select></div>`;
                })
                .join('');
            }
          } catch {
            varSelects = '';
          }
          return varSelects;
        })()}
        <div class="wo-row2">
          <div><div class="wo-lbl">পরিমাণ (Qty)</div><input class="wo-inp" id="woQty" type="number" min="1" max="${qtyMax}" value="1"></div>
          <div style="display:flex;align-items:flex-end"><div style="font-size:13px;color:var(--sub);padding-bottom:12px">${p.trackStock === false ? '' : `max ${p.stockQty}`}</div></div>
        </div>
        <div><div class="wo-lbl">আপনার নাম *</div><input class="wo-inp" id="woName" type="text" placeholder="পুরো নাম"></div>
        <div><div class="wo-lbl">ফোন নম্বর *</div><input class="wo-inp" id="woPhone" type="tel" placeholder="01XXXXXXXXX" onblur="woCheckLoyalty();woCheckMilestone();"></div>
        <div id="woLoyaltyBox" style="display:none;font-size:12.5px;padding:8px 10px;border-radius:8px;margin:-6px 0 8px;"></div>
        <div id="woMilestoneBox" style="display:none;font-size:12.5px;padding:8px 10px;border-radius:8px;margin:-6px 0 8px;background:rgba(139,92,246,0.12);color:#7c3aed;"></div>
        ${
          page.restaurantMode
            ? `<div class="wo-addr-lbl-row"><div class="wo-lbl" style="margin-bottom:0">ডেলিভারি লোকেশন * (ম্যাপে pin করুন)</div></div>
        <div id="woMap"></div>
        <button type="button" class="wo-gps-btn" id="woGpsBtn" onclick="woUseGps()">📍 আমার লোকেশন ব্যবহার করুন (GPS)</button>
        <div style="display:flex;gap:6px;margin-top:6px">
          <input class="wo-inp" id="woMapsLink" type="text" style="flex:1" placeholder="অথবা Google Maps link / 23.79, 90.41 paste করুন">
          <button type="button" class="wo-gps-btn" style="width:auto;padding:0 14px;margin:0" id="woMapsLinkBtn" onclick="woPasteLocation()">✔</button>
        </div>
        <div class="wo-fee-box" id="woFeeBox">ম্যাপে আপনার ডেলিভারি লোকেশন pin করুন — delivery charge দেখাবে</div>
        <div><textarea class="wo-inp" id="woAddrDetail" rows="2" placeholder="বাসা/রোড/ফ্লোর — বিস্তারিত ঠিকানা"></textarea></div>`
            : `<div class="wo-addr-lbl-row"><div class="wo-lbl" style="margin-bottom:0">ঠিকানা *</div><span class="wo-addr-loading" id="woGeoLoading">এলাকার তালিকা লোড হচ্ছে...</span></div>
        <div class="wo-row3">
          <div><select class="wo-inp" id="woDivision"><option value="">বিভাগ</option></select></div>
          <div><select class="wo-inp" id="woDistrict" disabled><option value="">জেলা</option></select></div>
          <div><select class="wo-inp" id="woUpazila" disabled><option value="">উপজেলা/থানা</option></select></div>
        </div>
        <div><textarea class="wo-inp" id="woAddrDetail" rows="2" placeholder="বাসা/রোড/গ্রামের নাম, ল্যান্ডমার্ক (বিস্তারিত ঠিকানা)"></textarea></div>`
        }
        <div><div class="wo-lbl">নোট (ঐচ্ছিক)</div><input class="wo-inp" id="woNote" type="text" placeholder="কোনো বিশেষ নির্দেশনা"></div>
        <div class="wo-err" id="woErr0"></div>
        <button class="wo-btn" id="woBtnSubmit" onclick="woSubmit()">অর্ডার দিন →</button>
      </div>


      <!-- Step 1a: Gateway Payment -->
      <div class="wo-step" id="woStep1a">
        <div class="wo-payment-box">
          <div style="font-size:13px;font-weight:700;margin-bottom:8px">💳 Payment করুন</div>
          <div style="font-size:13px;margin-bottom:12px">Advance: <strong id="woGwAmount"></strong></div>
        </div>
        <button class="wo-btn" id="woBtnGw" onclick="woGoGateway()">পেমেন্ট করুন →</button>
      </div>

      <!-- Step M: Method Selection -->
      <div class="wo-step" id="woStepM">
        <div style="text-align:center;margin-bottom:18px">
          <div style="font-size:16px;font-weight:700;margin-bottom:4px">💸 Advance Payment</div>
          <div style="font-size:13px;color:var(--muted,#94a3b8)">পরিমাণ: <strong id="woMethodAmt" style="color:var(--fg)"></strong></div>
        </div>
        <div style="font-size:12px;color:var(--muted,#64748b);margin-bottom:14px;text-align:center">কোন মেথডে পাঠাবেন বেছে নিন</div>
        <div id="woMethodBtns" style="display:flex;flex-direction:column;gap:10px">
          <button id="woBtnBkash" class="wo-method-btn" onclick="woSelectMethod('bkash')" style="display:none">
            <span style="font-size:20px">📱</span>
            <div><div style="font-weight:700;font-size:14px">বিকাশ</div><div id="woMBkashNum" style="font-size:12px;opacity:.8"></div></div>
          </button>
          <button id="woBtnNagad" class="wo-method-btn" onclick="woSelectMethod('nagad')" style="display:none">
            <span style="font-size:20px">📱</span>
            <div><div style="font-weight:700;font-size:14px">নগদ</div><div id="woMNagadNum" style="font-size:12px;opacity:.8"></div></div>
          </button>
          <button id="woBtnRocket" class="wo-method-btn" onclick="woSelectMethod('rocket')" style="display:none">
            <span style="font-size:20px">🚀</span>
            <div><div style="font-weight:700;font-size:14px">রকেট</div><div id="woMRocketNum" style="font-size:12px;opacity:.8"></div></div>
          </button>
        </div>
      </div>

      <!-- Step P: Pay + TxID -->
      <div class="wo-step" id="woStepP">
        <div class="wo-payment-box" style="text-align:center;padding:16px">
          <div id="woPIcon" style="font-size:28px;margin-bottom:6px"></div>
          <div id="woPName" style="font-size:13px;font-weight:700;margin-bottom:10px"></div>
          <div style="font-size:12px;color:var(--muted,#94a3b8);margin-bottom:4px">এই নম্বরে পাঠান</div>
          <div id="woPNum" style="font-size:20px;font-weight:800;letter-spacing:1px;color:var(--p,#6366f1);margin-bottom:8px"></div>
          <div style="font-size:13px">পরিমাণ: <strong id="woPAmt" style="font-size:16px"></strong></div>
        </div>
        <div style="font-size:12px;color:var(--muted,#64748b);background:var(--surface-2,#f1f5f9);padding:9px 12px;border-radius:8px;margin-bottom:12px;line-height:1.6">
          ✅ Payment পাঠানোর পর নিচে <strong>Transaction ID</strong> দিন।
        </div>
        <div style="margin-bottom:10px"><div class="wo-lbl">TRANSACTION ID *</div><input class="wo-inp" id="woFinalTxId" type="text" placeholder="যেমন: 8N7XXXXXX" autocomplete="off"></div>
        <div style="margin-bottom:10px">
          <div class="wo-lbl" style="display:flex;align-items:center;justify-content:space-between">
            <span>PAYMENT SCREENSHOT</span><span style="font-size:11px;font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted,#94a3b8)">(optional — Telegram এ যাবে)</span>
          </div>
          <label class="wo-file-area" for="woPScreenshot" id="woPFileArea">
            <span id="woPFileLabel">📷 Screenshot বেছে নিন</span>
          </label>
          <input type="file" id="woPScreenshot" accept="image/*" style="display:none" onchange="woPFileChosen(this)">
        </div>
        <div class="wo-err" id="woErrP"></div>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button class="wo-btn" style="background:var(--surface-2,#e2e8f0);color:var(--fg,#1e293b);flex:0 0 auto;width:44px;font-size:18px;padding:0" onclick="woShowStep('M')">←</button>
          <button class="wo-btn" id="woBtnPaySubmit" style="flex:1" onclick="woPaySubmit()">Submit করুন →</button>
        </div>
      </div>


      <!-- Step 2: Success -->
      <div class="wo-step" id="woStep2">
        <div class="wo-success">
          <div class="wo-icon">🎉</div>
          <h3>অর্ডার সম্পন্ন!</h3>
          <div class="wo-lbl" style="text-align:center">Order ID</div>
          <div class="wo-oid" id="woOrderId"></div>
          <div class="wo-msg">
            📱 <strong>Delivery update পেতে:</strong> Facebook Messenger এ <strong id="woMsgId"></strong> লিখে পাঠান — bot আপনাকে status জানাবে।
          </div>
          <a href="/catalog/${esc(String(page.id))}/track" style="display:block;margin-top:12px;text-align:center;font-size:13px;color:var(--p);text-decoration:none">📦 Order Track করুন →</a>
        </div>
      </div>

    </div>
  </div>
</div>

<script>
var WO_PAGE_ID = ${JSON.stringify(String(page.id))};
var WO_CODE = ${JSON.stringify(String(p.code))};
var WO_PRICE = ${Number(p.price)};
var WO_NAME = ${JSON.stringify(String(p.name || p.code))};
var WO_CURRENCY = ${JSON.stringify(String(page.currency || '৳'))};
var WO_PAY_MODE = ${JSON.stringify(String(page.paymentMode || 'cod'))};
var WO_ADV_AMT = ${Number(page.advanceAmount || 0)};
var WO_BKASH = ${JSON.stringify(String(page.advanceBkash || ''))};
var WO_NAGAD = ${JSON.stringify(String(page.advanceNagad || ''))};
var WO_ROCKET = ${JSON.stringify(String(page.advanceRocket || ''))};
var WO_ADV_MSG = ${JSON.stringify(String(page.advancePaymentMessage || ''))};
var WO_RESTO = ${page.restaurantMode ? 1 : 0};
var WO_RLAT = ${Number(page.restaurantLat) || 0};
var WO_RLNG = ${Number(page.restaurantLng) || 0};
var WO_SLABS = ${JSON.stringify(page.deliverySlabs || [])};
var WO_VARIANTS = ${JSON.stringify(foodVariants)};
var woVarLabel = WO_VARIANTS.length ? WO_VARIANTS[0].label : null;
var woOrderIdVal = null;
var woPaymentUrl = null;

// ── Size/portion price variants — server re-validates the chosen label ──────
function woApplyVariant(label){
  var v = null;
  for (var i = 0; i < WO_VARIANTS.length; i++) { if (WO_VARIANTS[i].label === label) { v = WO_VARIANTS[i]; break; } }
  if (!v) return;
  woVarLabel = v.label;
  WO_PRICE = v.price;
  var pv = document.getElementById('pvPrice');
  if (pv) pv.textContent = WO_CURRENCY + v.price.toLocaleString();
  var info = document.getElementById('woInfoPrice');
  if (info) info.textContent = WO_CURRENCY + v.price.toLocaleString() + ' (' + v.label + ')';
  // keep page chips + modal select in sync
  document.querySelectorAll('.pv-chip').forEach(function(c){ c.classList.toggle('active', c.getAttribute('data-label') === v.label); });
  var sel = document.getElementById('woSizeSel');
  if (sel && sel.value !== v.label) sel.value = v.label;
  if (typeof woRecalcFee === 'function') woRecalcFee();
}
function pvSelect(btn){ woApplyVariant(btn.getAttribute('data-label')); }
function woSizeChange(){ var sel = document.getElementById('woSizeSel'); if (sel) woApplyVariant(sel.value); }

function woOpen(){ document.getElementById('woModal').classList.add('open'); document.body.style.overflow='hidden'; if(WO_RESTO){ woInitMap(); } else { woLoadGeo(); } }
function woClose(){ document.getElementById('woModal').classList.remove('open'); document.body.style.overflow=''; }

// ── Restaurant mode: Leaflet map pin + distance-slab delivery fee ───────────
// Client-side fee is a live preview only — the server recomputes from the
// pinned coordinates and is authoritative.
var woMap=null, woCustMarker=null, woLat=null, woLng=null, woFee=null;
function woHaversineKm(lat1,lng1,lat2,lng2){
  var R=6371, toRad=function(d){ return d*Math.PI/180; };
  var dLat=toRad(lat2-lat1), dLng=toRad(lng2-lng1);
  var a=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)*Math.sin(dLng/2);
  return 2*R*Math.asin(Math.sqrt(a));
}
function woInitMap(){
  if(woMap||!WO_RESTO||typeof L==='undefined') { if(woMap) setTimeout(function(){ woMap.invalidateSize(); },80); return; }
  woMap=L.map('woMap').setView([WO_RLAT,WO_RLNG],15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(woMap);
  var restoIcon=L.divIcon({className:'',html:'<div style="font-size:26px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))">🏪</div>',iconSize:[26,26],iconAnchor:[13,24]});
  L.marker([WO_RLAT,WO_RLNG],{icon:restoIcon,interactive:false}).addTo(woMap);
  var maxKm=WO_SLABS.length?WO_SLABS[WO_SLABS.length-1].maxKm:0;
  if(maxKm>0){ L.circle([WO_RLAT,WO_RLNG],{radius:maxKm*1000,color:'#059669',weight:1.5,fillOpacity:.06}).addTo(woMap); }
  woMap.on('click',function(e){ woPlacePin(e.latlng.lat,e.latlng.lng); });
  // The bottom-sheet just became visible — Leaflet measured a hidden container
  setTimeout(function(){ woMap.invalidateSize(); },80);
}
function woPlacePin(lat,lng){
  woLat=lat; woLng=lng;
  if(!woCustMarker){
    var pinIcon=L.divIcon({className:'',html:'<div style="font-size:30px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))">📍</div>',iconSize:[30,30],iconAnchor:[15,28]});
    woCustMarker=L.marker([lat,lng],{icon:pinIcon,draggable:true}).addTo(woMap);
    woCustMarker.on('dragend',function(){ var ll=woCustMarker.getLatLng(); woLat=ll.lat; woLng=ll.lng; woRecalcFee(); });
  } else { woCustMarker.setLatLng([lat,lng]); }
  woRecalcFee();
}
function woRecalcFee(){
  var box=document.getElementById('woFeeBox'); if(!box) return;
  if(woLat===null){ box.className='wo-fee-box'; box.textContent='ম্যাপে আপনার ডেলিভারি লোকেশন pin করুন — delivery charge দেখাবে'; return; }
  var km=Math.round(woHaversineKm(WO_RLAT,WO_RLNG,woLat,woLng)*100)/100;
  var slab=null;
  for(var i=0;i<WO_SLABS.length;i++){ if(km<=WO_SLABS[i].maxKm){ slab=WO_SLABS[i]; break; } }
  if(!slab){
    woFee=null;
    box.className='wo-fee-box bad';
    box.textContent='দুঃখিত, এই লোকেশন আমাদের ডেলিভারি এলাকার বাইরে ('+km+' km) 😔';
    return;
  }
  woFee=slab.fee;
  var qty=parseInt(document.getElementById('woQty').value)||1;
  var total=WO_PRICE*qty+slab.fee;
  box.className='wo-fee-box ok';
  box.innerHTML='🛵 Delivery charge: <strong>'+WO_CURRENCY+slab.fee+'</strong> ('+km+' km)<br>মোট: <strong>'+WO_CURRENCY+total.toLocaleString()+'</strong> ('+WO_CURRENCY+WO_PRICE.toLocaleString()+' × '+qty+' + delivery)';
}
function woUseGps(){
  var btn=document.getElementById('woGpsBtn');
  if(!navigator.geolocation){ woSetErr('woErr0','আপনার browser-এ GPS support নেই — Google Maps link paste করুন বা ম্যাপে ট্যাপ করে pin করুন'); return; }
  btn.disabled=true; btn.textContent='লোকেশন খোঁজা হচ্ছে...';
  // Watchdog: some in-app browsers/WebViews never fire either native callback
  // even with {timeout}, leaving the button stuck forever with no feedback.
  var woGpsDone=false;
  var woGpsWatchdog=setTimeout(function(){
    if(woGpsDone) return;
    woGpsDone=true;
    btn.disabled=false; btn.textContent='📍 আমার লোকেশন ব্যবহার করুন (GPS)';
    woSetErr('woErr0','লোকেশন পেতে বেশি সময় লাগছে। নিচের ঘরে Google Maps link paste করুন বা সরাসরি ম্যাপে ট্যাপ করে pin করুন');
  },12000);
  navigator.geolocation.getCurrentPosition(function(pos){
    if(woGpsDone) return;
    woGpsDone=true; clearTimeout(woGpsWatchdog);
    btn.disabled=false; btn.textContent='📍 আমার লোকেশন ব্যবহার করুন (GPS)';
    woSetErr('woErr0','');
    woPlacePin(pos.coords.latitude,pos.coords.longitude);
    woMap.setView([pos.coords.latitude,pos.coords.longitude],16);
  },function(){
    if(woGpsDone) return;
    woGpsDone=true; clearTimeout(woGpsWatchdog);
    btn.disabled=false; btn.textContent='📍 আমার লোকেশন ব্যবহার করুন (GPS)';
    // Messenger/Facebook-এর ভেতরের browser প্রায়ই GPS permission-ই চায় না
    woSetErr('woErr0','লোকেশন পাওয়া যায়নি। Messenger-এর ভেতরের browser-এ GPS প্রায়ই কাজ করে না — নিচের ঘরে Google Maps link paste করুন, ম্যাপে ট্যাপ করুন, অথবা Chrome-এ খুলুন (⋯ menu → Open in browser)');
  },{enableHighAccuracy:true,timeout:10000});
}
// Paste fallback: Google Maps link (short link resolved server-side) or raw
// "lat, lng" — for in-app browsers where the GPS prompt never appears.
function woPasteLocation(){
  var inp=document.getElementById('woMapsLink');
  var btn=document.getElementById('woMapsLinkBtn');
  var v=(inp&&inp.value||'').trim();
  if(!v){ woSetErr('woErr0','Google Maps link বা coordinates দিন'); return; }
  woSetErr('woErr0','');
  // quick client-side parse: @lat,lng / q=lat,lng / raw pair
  var m=v.match(/@(-?\\d{1,3}\\.\\d+),(-?\\d{1,3}\\.\\d+)/)||v.match(/[?&](?:q|ll|query|destination)=(-?\\d{1,3}\\.\\d+)(?:%2C|,)(-?\\d{1,3}\\.\\d+)/i)||v.match(/(-?\\d{1,3}\\.\\d{3,})\\s*[,;\\s]\\s*(-?\\d{1,3}\\.\\d{3,})/);
  if(m){ var la=parseFloat(m[1]),ln=parseFloat(m[2]); if(isFinite(la)&&isFinite(ln)){ woPlacePin(la,ln); woMap.setView([la,ln],16); return; } }
  btn.disabled=true; btn.textContent='...';
  fetch('/catalog/maps-resolve?u='+encodeURIComponent(v)).then(function(r){ return r.json(); }).then(function(d){
    btn.disabled=false; btn.textContent='✔';
    if(d&&isFinite(d.lat)&&isFinite(d.lng)){ woPlacePin(d.lat,d.lng); woMap.setView([d.lat,d.lng],16); }
    else { woSetErr('woErr0',(d&&d.message)||'লোকেশন পড়া যায়নি — Google Maps-এর share link দিন'); }
  }).catch(function(){
    btn.disabled=false; btn.textContent='✔';
    woSetErr('woErr0','লোকেশন পড়া যায়নি — Google Maps-এর share link দিন');
  });
}
if(WO_RESTO){
  var woQtyEl=document.getElementById('woQty');
  if(woQtyEl) woQtyEl.addEventListener('input',woRecalcFee);
}

// ── Division / District / Upazila cascading address selects ────────────────
var woGeoData=null, woGeoLoaded=false, woGeoLoading=false;
function woLoadGeo(){
  if(woGeoLoaded||woGeoLoading) return;
  woGeoLoading=true;
  var loadingEl=document.getElementById('woGeoLoading'); if(loadingEl) loadingEl.classList.add('show');
  fetch('/catalog/bd-geo').then(function(r){ return r.json(); }).then(function(d){
    woGeoData=d; woGeoLoaded=true; woGeoLoading=false;
    if(loadingEl) loadingEl.classList.remove('show');
    var divSel=document.getElementById('woDivision');
    d.divisions.forEach(function(dv){
      var opt=document.createElement('option'); opt.value=dv.id; opt.textContent=dv.bn+' ('+dv.name+')'; divSel.appendChild(opt);
    });
  }).catch(function(){
    woGeoLoading=false;
    if(loadingEl){ loadingEl.textContent='এলাকার তালিকা লোড করা যায়নি — আবার চেষ্টা করুন'; loadingEl.classList.add('show'); }
  });
}
function woOnDivisionChange(){
  var distSel=document.getElementById('woDistrict'), upaSel=document.getElementById('woUpazila');
  distSel.innerHTML='<option value="">জেলা</option>'; upaSel.innerHTML='<option value="">উপজেলা/থানা</option>';
  upaSel.disabled=true;
  var divId=parseInt(document.getElementById('woDivision').value)||null;
  if(!divId||!woGeoData){ distSel.disabled=true; return; }
  distSel.disabled=false;
  woGeoData.districts.filter(function(d){ return d.divisionId===divId; }).forEach(function(d){
    var opt=document.createElement('option'); opt.value=d.id; opt.textContent=d.bn+' ('+d.name+')'; distSel.appendChild(opt);
  });
}
function woOnDistrictChange(){
  var upaSel=document.getElementById('woUpazila');
  upaSel.innerHTML='<option value="">উপজেলা/থানা</option>';
  var distId=parseInt(document.getElementById('woDistrict').value)||null;
  if(!distId||!woGeoData){ upaSel.disabled=true; return; }
  upaSel.disabled=false;
  woGeoData.upazilas.filter(function(u){ return u.districtId===distId; }).forEach(function(u){
    var opt=document.createElement('option'); opt.value=u.id; opt.textContent=u.bn+' ('+u.name+')'; upaSel.appendChild(opt);
  });
}
// Restaurant mode renders a map instead of these selects — guard so the
// missing elements don't throw and kill the whole inline script.
var woDivEl=document.getElementById('woDivision'), woDistEl=document.getElementById('woDistrict');
if(woDivEl) woDivEl.addEventListener('change', woOnDivisionChange);
if(woDistEl) woDistEl.addEventListener('change', woOnDistrictChange);

function woGeoLabel(selId, dataKey){
  var sel=document.getElementById(selId);
  var id=parseInt(sel.value)||null;
  if(!id||!woGeoData) return null;
  var item=woGeoData[dataKey].find(function(x){ return x.id===id; });
  return item?item.bn:null;
}

// ── Mobile keyboard: keep the focused field visible above the soft keyboard ─
// Fixed-position bottom sheets don't shrink with the on-screen keyboard on
// most mobile/in-app (Messenger/Facebook) browsers, so the focused input can
// end up hidden behind it. visualViewport handles modern browsers; the
// scrollIntoView-on-focus fallback covers in-app browsers that don't fire it.
if(window.visualViewport){
  window.visualViewport.addEventListener('resize', function(){
    var sheet=document.querySelector('.wo-sheet');
    if(sheet && document.getElementById('woModal').classList.contains('open')){
      sheet.style.maxHeight=(window.visualViewport.height*0.95)+'px';
    }
  });
}
document.querySelectorAll('.wo-inp').forEach(function(el){
  el.addEventListener('focus', function(){
    setTimeout(function(){ el.scrollIntoView({block:'center', behavior:'smooth'}); }, 300);
  });
});
function woShowStep(n){ ['woStep0','woStep1a','woStepM','woStepP','woStep2'].forEach(function(id){ var el=document.getElementById(id); if(el) el.classList.remove('active'); }); var t=document.getElementById('woStep'+n); if(t) t.classList.add('active'); woUpdateProgress(n); }
function woUpdateProgress(n){
  var phase = (n==='2') ? 3 : (n==='0') ? 1 : 2; // Details -> Payment (gateway/method/proof) -> Done
  var fill = document.getElementById('woProgressFill'); if(fill) fill.style.width = (phase*100/3)+'%';
  [['woProgLbl1',1],['woProgLbl2',2],['woProgLbl3',3]].forEach(function(pair){
    var el=document.getElementById(pair[0]); if(el) el.classList.toggle('on', phase>=pair[1]);
  });
}
function woSetErr(id,msg){ var el=document.getElementById(id); if(el){ el.textContent=msg; el.style.display=msg?'block':'none'; } }
async function woCheckLoyalty(){
  var box=document.getElementById('woLoyaltyBox');
  var phone=document.getElementById('woPhone').value.trim();
  if(!box||phone.replace(/\\D/g,'').length<10){ if(box) box.style.display='none'; return; }
  try {
    var r=await fetch('/catalog/'+WO_PAGE_ID+'/loyalty-status?phone='+encodeURIComponent(phone));
    var d=await r.json();
    if(!d.enabled||!d.message){ box.style.display='none'; return; }
    box.textContent=d.message;
    box.style.background=d.isLoyal?'rgba(22,163,74,0.12)':'rgba(245,158,11,0.12)';
    box.style.color=d.isLoyal?'#16a34a':'#b45309';
    box.style.display='block';
  } catch { box.style.display='none'; }
}
async function woCheckMilestone(){
  var box=document.getElementById('woMilestoneBox');
  var phone=document.getElementById('woPhone').value.trim();
  if(!box||phone.replace(/\\D/g,'').length<10){ if(box) box.style.display='none'; return; }
  try {
    var r=await fetch('/catalog/'+WO_PAGE_ID+'/milestone-status?phone='+encodeURIComponent(phone));
    var d=await r.json();
    if(!d.enabled){ box.style.display='none'; return; }
    var msg=null;
    if(d.rewards&&d.rewards.length){
      var whats=d.rewards.map(function(r){ return r.rewardType==='FREE_DELIVERY'?'ফ্রি ডেলিভারি':(r.rewardType==='DISCOUNT'?(r.discountPercent+'% ছাড়'):('ফ্রি '+r.productName)); });
      msg='🎁 এই অর্ডারেই আপনি পাচ্ছেন '+whats.join(' + ')+'!';
    } else if(d.next){
      var what2=d.next.rewardType==='FREE_DELIVERY'?'ফ্রি ডেলিভারি':(d.next.rewardType==='DISCOUNT'?(d.next.discountPercent+'% ছাড়'):('ফ্রি '+d.next.productName));
      msg='🎁 আরও '+d.next.ordersAway+'টা অর্ডার করলে পাবেন '+what2+'!';
    }
    if(!msg){ box.style.display='none'; return; }
    box.textContent=msg;
    box.style.display='block';
  } catch { box.style.display='none'; }
}

var woAdvData={};

async function woSubmit(){
  var name=document.getElementById('woName').value.trim();
  var phone=document.getElementById('woPhone').value.trim();
  var addrDetail=document.getElementById('woAddrDetail').value.trim();
  var qty=parseInt(document.getElementById('woQty').value)||1;
  var note=document.getElementById('woNote').value.trim();
  if(!name){woSetErr('woErr0','নাম দিন');return;}
  if(!phone){woSetErr('woErr0','ফোন নম্বর দিন');return;}
  var phoneDigits=phone.replace(/\D/g,'');
  if(phoneDigits.length<10||phoneDigits.length>12){woSetErr('woErr0','সঠিক ফোন নম্বর দিন (যেমন: 01XXXXXXXXX)');return;}
  var normPhone=phoneDigits.length===12&&phoneDigits.startsWith('88')?phoneDigits.slice(2):phoneDigits;
  if(normPhone.length!==11||!normPhone.startsWith('0')){woSetErr('woErr0','সঠিক বাংলাদেশি ফোন নম্বর দিন (01XXXXXXXXX)');return;}
  var addr;
  if(WO_RESTO){
    if(woLat===null||woLng===null){woSetErr('woErr0','ম্যাপে আপনার ডেলিভারি লোকেশন pin করুন');return;}
    if(woFee===null){woSetErr('woErr0','দুঃখিত, আপনার লোকেশন ডেলিভারি এলাকার বাইরে — কাছের কোনো ঠিকানা দিন');return;}
    if(!addrDetail){woSetErr('woErr0','বিস্তারিত ঠিকানা দিন (বাসা/রোড/ফ্লোর)');return;}
    addr=addrDetail;
  } else {
    var divLabel=woGeoLabel('woDivision','divisions');
    var distLabel=woGeoLabel('woDistrict','districts');
    var upaLabel=woGeoLabel('woUpazila','upazilas');
    if(!divLabel){woSetErr('woErr0','বিভাগ বেছে নিন');return;}
    if(!distLabel){woSetErr('woErr0','জেলা বেছে নিন');return;}
    if(!upaLabel){woSetErr('woErr0','উপজেলা/থানা বেছে নিন');return;}
    if(!addrDetail){woSetErr('woErr0','বিস্তারিত ঠিকানা দিন (বাসা/রোড/গ্রাম)');return;}
    addr=addrDetail+', '+upaLabel+', '+distLabel+', '+divLabel;
  }
  woSetErr('woErr0','');
  var btn=document.getElementById('woBtnSubmit');
  btn.disabled=true; btn.textContent='পাঠানো হচ্ছে...';
  try {
    var body={customerName:name,phone:phone,address:addr,productCode:WO_CODE,qty:qty,price:WO_PRICE,productName:WO_NAME,orderNote:note};
    if(WO_RESTO){ body.deliveryLat=woLat; body.deliveryLng=woLng; }
    if(WO_VARIANTS.length){ body.variantLabel=woVarLabel; }
    var r=await fetch('/catalog/'+WO_PAGE_ID+'/web-order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json();
    if(!r.ok) throw new Error(d.message||'Error');
    woOrderIdVal=d.orderId;
    if(!d.paymentRequired){
      document.getElementById('woOrderId').textContent='#'+d.orderId;
      document.getElementById('woMsgId').textContent='#'+d.orderId;
      woShowStep(2);
    } else if(d.method==='gateway'){
      woPaymentUrl=d.paymentUrl;
      document.getElementById('woGwAmount').textContent=WO_CURRENCY+(d.advanceAmount||WO_ADV_AMT);
      woShowStep('1a'); document.getElementById('woTitle').textContent='💳 Payment করুন';
    } else {
      // All direct/sms/manual methods → method selection screen
      var amt=WO_CURRENCY+(d.advanceAmount||WO_ADV_AMT);
      woAdvData={bkash:d.advanceBkash||WO_BKASH,nagad:d.advanceNagad||WO_NAGAD,rocket:d.advanceRocket||WO_ROCKET,amt:amt};
      document.getElementById('woMethodAmt').textContent=amt;
      // Show only available method buttons
      var bkashBtn=document.getElementById('woBtnBkash');
      var nagadBtn=document.getElementById('woBtnNagad');
      var rocketBtn=document.getElementById('woBtnRocket');
      if(woAdvData.bkash){ document.getElementById('woMBkashNum').textContent=woAdvData.bkash; bkashBtn.style.display='flex'; } else { bkashBtn.style.display='none'; }
      if(woAdvData.nagad){ document.getElementById('woMNagadNum').textContent=woAdvData.nagad; nagadBtn.style.display='flex'; } else { nagadBtn.style.display='none'; }
      if(woAdvData.rocket){ document.getElementById('woMRocketNum').textContent=woAdvData.rocket; rocketBtn.style.display='flex'; } else { rocketBtn.style.display='none'; }
      // If only 1 method, auto-select it
      var available=[woAdvData.bkash&&'bkash',woAdvData.nagad&&'nagad',woAdvData.rocket&&'rocket'].filter(Boolean);
      if(available.length===1){ woSelectMethod(available[0]); }
      else { woShowStep('M'); document.getElementById('woTitle').textContent='💸 Payment করুন'; }
    }
  } catch(e){ woSetErr('woErr0',e.message||'কিছু একটা সমস্যা হয়েছে'); }
  btn.disabled=false; btn.textContent='অর্ডার দিন →';
}

function woGoGateway(){ if(woPaymentUrl) window.location.href=woPaymentUrl; }

function woPFileChosen(inp){ var lbl=document.getElementById('woPFileLabel'); if(inp.files&&inp.files[0]) lbl.textContent='✅ '+inp.files[0].name; else lbl.textContent='📷 Screenshot বেছে নিন'; }

function woSelectMethod(method){
  var icons={bkash:'📱',nagad:'📱',rocket:'🚀'};
  var names={bkash:'বিকাশ',nagad:'নগদ',rocket:'রকেট'};
  var nums={bkash:woAdvData.bkash,nagad:woAdvData.nagad,rocket:woAdvData.rocket};
  document.getElementById('woPIcon').textContent=icons[method]||'📱';
  document.getElementById('woPName').textContent=names[method]||method;
  document.getElementById('woPNum').textContent=nums[method]||'';
  document.getElementById('woPAmt').textContent=woAdvData.amt||'';
  document.getElementById('woFinalTxId').value='';
  var ss=document.getElementById('woPScreenshot'); if(ss) ss.value='';
  document.getElementById('woPFileLabel').textContent='📷 Screenshot বেছে নিন';
  woSetErr('woErrP','');
  woShowStep('P'); document.getElementById('woTitle').textContent='💸 Payment করুন';
}

async function woPaySubmit(){
  var txId=document.getElementById('woFinalTxId').value.trim();
  var ssFile=document.getElementById('woPScreenshot').files[0];
  if(!txId){woSetErr('woErrP','Transaction ID দিন');return;}
  woSetErr('woErrP','');
  var btn=document.getElementById('woBtnPaySubmit');
  btn.disabled=true; btn.textContent='Submit হচ্ছে...';
  try {
    var fd=new FormData();
    fd.append('transactionId',txId);
    if(ssFile) fd.append('screenshot',ssFile);
    var r=await fetch('/catalog/'+WO_PAGE_ID+'/web-order/'+woOrderIdVal+'/payment-proof',{method:'POST',body:fd});
    var d=await r.json();
    if(!r.ok) throw new Error(d.message||'Submit failed');
    document.getElementById('woOrderId').textContent='#'+woOrderIdVal;
    document.getElementById('woMsgId').textContent='#'+woOrderIdVal;
    woShowStep(2);
  } catch(e){ woSetErr('woErrP',e.message||'Submit করা যায়নি'); }
  btn.disabled=false; btn.textContent='Submit করুন →';
}

</script>
`
    : ''
}

<script>
var noImgBlock = '<div class="no-img-card"><div class="no-img-orb no-img-orb-1"></div><div class="no-img-orb no-img-orb-2"></div><div class="no-img-icon">🛍️</div><div class="no-img-code"><div class="no-img-code-lbl">Product Code</div><div class="no-img-code-val">${esc(p.code)}</div></div><div class="no-img-hint">ছবি শীঘ্রই আসছে</div></div>';
function setGalleryMode(mode, button, url) {
  var videoFrame = document.getElementById('main-video');
  var imgFrame = document.getElementById('main-img');
  
  if (mode === 'video') {
    if(videoFrame) videoFrame.style.display = 'block';
    if(imgFrame) imgFrame.style.display = 'none';
  } else if (mode === 'image') {
    if(videoFrame) videoFrame.style.display = 'none';
    if(imgFrame) {
      imgFrame.style.display = 'block';
      var img = imgFrame.querySelector('img');
      if(img && url) img.src = url;
    }
  }

  document.querySelectorAll('.g-thumb').forEach(function(item) { item.classList.remove('active'); });
  if (button) button.classList.add('active');
}
</script>
${poweredByBadge()}
</body>
</html>`;
  }

  // ── Catalog HTML page ──────────────────────────────────────────────────────
  private buildHtml(
    data: any,
    search: string,
    opts?: { selectionMode?: boolean; shortlistCodes?: string[] },
  ): string {
    const { page, products } = data;
    const primary = esc(page.primaryColor);
    const currency = esc(page.currency);
    const selectionMode = Boolean(opts?.selectionMode);
    const shortlistCodes = opts?.shortlistCodes || [];
    const shortlistQuery = shortlistCodes.length
      ? `?select=1&codes=${encodeURIComponent(shortlistCodes.join(','))}`
      : '?select=1';

    // V25: Restaurant pages get burgerbhai-style category tabs (Momo's (6) …)
    const restaurantTabs = Boolean(page.restaurantMode);

    // V26: open/closed pill — only shown once the merchant has set hours
    const openNow = page.businessHours ? isOpenNow(page.businessHours) : null;
    const todayRow = page.businessHours
      ? page.businessHours.find((r: any) => r.day === new Date().getDay())
      : null;
    const openStatusPill =
      openNow === null
        ? ''
        : openNow
          ? `<span class="resto-pill resto-pill-open">🟢 এখন খোলা${todayRow && !todayRow.closed ? ` — ${esc(todayRow.open)}-${esc(todayRow.close)}` : ''}</span>`
          : `<span class="resto-pill resto-pill-closed">🔴 এখন বন্ধ</span>`;
    const categoryCounts = new Map<string, number>();
    if (restaurantTabs) {
      for (const p of products) {
        const c = String(p.category || '').trim();
        if (!c) continue;
        categoryCounts.set(c, (categoryCounts.get(c) || 0) + 1);
      }
    }
    const categoryTabs = [...categoryCounts.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );

    const cards = products
      .map((p: any, idx: number) => {
        const videoType = detectVideoType(p.videoUrl || '');
        const ytId =
          videoType === 'youtube' ? extractYouTubeId(p.videoUrl) : null;
        const isFB = videoType === 'facebook';
        const inStock = p.trackStock === false ? true : p.stockQty > 0;
        const delay = Math.min(idx * 40, 400);
        // V25: size/portion pricing → show range ("৳120 – ৳220") on the card
        const cardVariants: PriceVariant[] = Array.isArray(p.priceVariants)
          ? p.priceVariants
          : [];
        // V24 offer: strikethrough old price + % badge when originalPrice > price
        const origPrice = Number(p.originalPrice) || 0;
        const curPrice = Number(p.price) || 0;
        const hasOffer = origPrice > curPrice && curPrice > 0;
        const offPct = hasOffer
          ? Math.round((1 - curPrice / origPrice) * 100)
          : 0;
        const priceBlock = cardVariants.length
          ? `<div class="c-price" style="font-size:17px">${priceRangeText(cardVariants, curPrice, currency)}</div>`
          : hasOffer
            ? `<div class="c-price-wrap"><span class="c-price-old">${currency}${origPrice.toLocaleString()}</span><div class="c-price">${currency}${curPrice.toLocaleString()} <span class="c-off-badge">-${offPct}%</span></div></div>`
            : `<div class="c-price">${currency}${curPrice.toLocaleString()}</div>`;

        let topBlock = '';
        if (ytId) {
          topBlock = `<div class="c-video"><iframe src="https://www.youtube.com/embed/${esc(ytId)}?rel=0&modestbranding=1" frameborder="0" allowfullscreen allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" loading="lazy"></iframe></div>`;
        } else if (isFB) {
          const fbUrl = encodeURIComponent(p.videoUrl);
          topBlock = `<div class="c-video fb"><iframe src="https://www.facebook.com/plugins/video.php?href=${fbUrl}&width=500&show_text=false&appId" frameborder="0" allowfullscreen scrolling="no" allow="autoplay;clipboard-write;encrypted-media;picture-in-picture;web-share" loading="lazy"></iframe></div>`;
        } else if (p.imageUrl) {
          topBlock = `<div class="c-img"><img src="${esc(p.imageUrl)}" alt="${esc(p.name || p.code)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=c-ph>${restaurantTabs ? '🍽️' : '🛍️'}</div>'"/></div>`;
        } else {
          topBlock = `<div class="c-ph">${restaurantTabs ? '🍽️' : '🛍️'}</div>`;
        }

        return `
      <a class="card" href="/catalog/${esc(page.id)}/product/${esc(p.code)}${selectionMode ? shortlistQuery : ''}" style="animation-delay:${delay}ms" id="p-${esc(p.id)}" data-price="${Number(p.price) || 0}" data-custom-index="${idx}" data-new-index="${idx}" data-product-id="${esc(p.id)}" data-name="${esc((p.name || p.code || '').toLowerCase())}" data-code="${esc((p.code || '').toLowerCase())}" data-desc="${esc((p.description || '').toLowerCase().slice(0, 300))}" data-category="${esc(String(p.category || '').toLowerCase())}">
        <div class="c-media">
          ${topBlock}
          ${!inStock ? '<div class="c-out-badge">Stock Out</div>' : p.deliveryCharge === 'FREE' ? '<div class="c-free-badge">🚚 Free Delivery</div>' : ''}
          ${p.isFeatured ? '<div class="c-featured-badge">🔥 জনপ্রিয়</div>' : ''}
          ${videoType ? '<div class="c-vid-badge">🎬</div>' : ''}
        </div>
        <div class="c-body">
          <div class="c-code">${esc(p.code)}</div>
          <div class="c-name">${esc(p.name || p.code)}</div>
          ${p.description ? `<div class="c-desc">${esc(p.description)}</div>` : ''}
          <div class="c-footer">
            ${priceBlock}
            <div class="c-order ${!inStock ? 'c-order-dis' : ''}">${inStock ? (selectionMode ? '✅ Select' : restaurantTabs ? '🛒 Order' : '💬 Order') : 'Out'}</div>
          </div>
        </div>
      </a>`;
      })
      .join('');

    const emptyState =
      products.length === 0
        ? `
      <div class="empty">
        <div class="empty-icon">🔍</div>
        <div class="empty-title">${search ? `"${esc(search)}" পাওয়া যায়নি` : selectionMode ? 'ম্যাচ করা shortlist এ কোনো product নেই' : 'কোনো product নেই'}</div>
        ${search || selectionMode ? `<a href="/catalog/${esc(page.id)}" class="empty-btn">সব product দেখুন</a>` : ''}
      </div>`
        : '';

    const catalogSlugOrId = page.catalogSlug || page.id;
    const catalogPublicUrl = `https://api.flamboyai.com/catalog/${catalogSlugOrId}`;
    const ogDesc = `${esc(page.name)}-এর সব product দেখুন। ${products.length > 0 ? `${products.length}টি product available।` : ''} পছন্দের product বেছে Messenger-এ order করুন।`;
    // V21: Catalog WhatsApp share
    const catalogWaShare = `https://wa.me/?text=${encodeURIComponent(`${page.name}-এর সব product দেখুন 👇\n${catalogPublicUrl}`)}`;
    const ogImage = products.find((p: any) => p.imageUrl)?.imageUrl || '';

    return `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="theme-color" content="${primary}"/>
<title>${esc(page.name)} — Product Catalog | Online Shop</title>
<meta name="description" content="${ogDesc}"/>
<meta name="robots" content="index, follow"/>
<link rel="canonical" href="${catalogPublicUrl}"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="${catalogPublicUrl}"/>
<meta property="og:title" content="${esc(page.name)} — Product Catalog"/>
<meta property="og:description" content="${ogDesc}"/>
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}"/>` : ''}
<meta property="og:locale" content="bn_BD"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(page.name)} — Product Catalog"/>
<meta name="twitter:description" content="${ogDesc}"/>
${ogImage ? `<meta name="twitter:image" content="${esc(ogImage)}"/>` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --p:${primary};
  --p2:color-mix(in srgb,${primary} 80%,#000);
  --p-soft:color-mix(in srgb,${primary} 14%,#fff);
  --bg:#f7f8fc;
  --surface:#ffffff;
  --surface-2:#f9fbff;
  --text:#0f172a;
  --sub:#475569;
  --muted:#94a3b8;
  --border:#e2e8f0;
  --r:22px;
  --shadow:0 18px 50px rgba(15,23,42,.08);
  --shadow-sm:0 8px 24px rgba(15,23,42,.06);
}
html{scroll-behavior:smooth}
body{font-family:"Hind Siliguri","Inter",system-ui,sans-serif;background:radial-gradient(circle at top left,color-mix(in srgb,var(--p) 12%,transparent),transparent 34%),linear-gradient(180deg,#f9fbff 0%,#f6f7fb 32%,#eef2f8 100%);color:var(--text);min-height:100vh;-webkit-font-smoothing:antialiased}

/* ── HEADER ── */
.header{background:linear-gradient(135deg,var(--p),var(--p2));color:#fff;position:sticky;top:0;z-index:100;box-shadow:0 10px 30px rgba(15,23,42,.16)}
.header::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:1px;background:rgba(255,255,255,.15)}
.header-glass{backdrop-filter:blur(0);-webkit-backdrop-filter:blur(0)}
.header-inner{max-width:1180px;margin:0 auto;padding:14px 20px 10px;display:flex;align-items:center;gap:14px}
.h-logo{width:48px;height:48px;border-radius:15px;object-fit:cover;border:2px solid rgba(255,255,255,.3);flex-shrink:0}
.h-logo-ph{width:48px;height:48px;border-radius:15px;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;border:2px solid rgba(255,255,255,.2)}
.h-biz{font-size:19px;font-weight:800;letter-spacing:-.3px;line-height:1.15}
.h-sub{font-size:12px;opacity:.82;margin-top:4px;font-weight:500}
.header-actions{margin-left:auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}
.h-msg-btn{background:rgba(255,255,255,.18);color:#fff;border:1.5px solid rgba(255,255,255,.35);border-radius:999px;padding:10px 18px;font-weight:700;font-size:13px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:7px;white-space:nowrap;backdrop-filter:blur(8px);transition:all .15s;font-family:inherit}
.h-msg-btn:hover{background:rgba(255,255,255,.28);border-color:rgba(255,255,255,.5)}

/* ── HERO ── */
.hero-wrap{max-width:1180px;margin:0 auto;padding:0 20px 8px}
.hero-card{position:relative;overflow:hidden;border-radius:22px;background:linear-gradient(135deg,rgba(255,255,255,.14),rgba(255,255,255,.06));border:1px solid rgba(255,255,255,.12);padding:14px 16px;box-shadow:inset 0 1px 0 rgba(255,255,255,.12)}
.hero-card::before{content:'';position:absolute;width:340px;height:340px;border-radius:50%;right:-110px;top:-160px;background:radial-gradient(circle,rgba(255,255,255,.28),transparent 70%)}
.hero-card::after{content:'';position:absolute;width:240px;height:240px;border-radius:50%;left:-60px;bottom:-120px;background:radial-gradient(circle,rgba(255,255,255,.14),transparent 72%)}
.hero-search{position:relative;z-index:2;margin-bottom:12px}
/* ── V25: Restaurant hero ── */
.resto-hero{position:relative;z-index:2;display:grid;grid-template-columns:minmax(0,1.6fr) minmax(150px,.7fr);gap:16px;align-items:center;margin-bottom:14px}
.resto-kicker{display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.2);font-size:10.5px;font-weight:800;letter-spacing:.1em}
.resto-title{margin-top:10px;font-size:30px;line-height:1.05;font-weight:900;letter-spacing:-1px;text-shadow:0 2px 12px rgba(0,0,0,.18)}
.resto-sub{margin-top:8px;font-size:13.5px;line-height:1.65;color:rgba(255,255,255,.88);max-width:52ch}
.resto-pills{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.resto-pill{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.18);font-size:11.5px;font-weight:700}
.resto-pill-open{background:rgba(34,197,94,.22);border-color:rgba(34,197,94,.4)}
.resto-pill-closed{background:rgba(239,68,68,.22);border-color:rgba(239,68,68,.4)}
.resto-hero-img{position:relative;display:block;border-radius:16px;overflow:hidden;border:2px solid rgba(255,255,255,.35);box-shadow:0 14px 34px rgba(0,0,0,.25);transform:rotate(2deg);transition:transform .2s}
.resto-hero-img:hover{transform:rotate(0deg) scale(1.02)}
.resto-hero-img img{display:block;width:100%;height:150px;object-fit:cover}
.resto-menu-tag{position:absolute;bottom:8px;left:8px;padding:4px 10px;border-radius:8px;background:rgba(0,0,0,.55);color:#fff;font-size:11px;font-weight:800}
@media(max-width:700px){.resto-hero{grid-template-columns:1fr}.resto-hero-img{display:none}.resto-title{font-size:24px}}
.hero-grid{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1.7fr) minmax(240px,.8fr);gap:10px;align-items:center}
.hero-copy{padding:0}
.hero-kicker{display:inline-flex;align-items:center;gap:8px;padding:6px 11px;border-radius:999px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.16);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.hero-title{margin-top:8px;font-size:22px;line-height:1.08;font-weight:900;letter-spacing:-.8px;max-width:none}
.hero-text{margin-top:8px;max-width:60ch;font-size:12.5px;line-height:1.6;color:rgba(255,255,255,.82)}
.hero-points{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
.hero-pill{display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border-radius:999px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.14);font-size:11.5px;font-weight:600}
.hero-panel{background:rgba(255,255,255,.92);backdrop-filter:blur(12px);border-radius:18px;padding:12px 14px;border:1px solid rgba(255,255,255,.5);box-shadow:0 18px 44px rgba(15,23,42,.12);color:var(--text)}
.hero-panel-label{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.hero-panel-title{margin-top:4px;font-size:17px;font-weight:900;letter-spacing:-.5px}
.hero-panel-text{margin-top:6px;font-size:12px;line-height:1.55;color:var(--sub)}
.hero-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:10px}
.hero-stat{padding:8px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border)}
.hero-stat-num{font-size:16px;font-weight:900;color:var(--p);letter-spacing:-.5px}
.hero-stat-lbl{font-size:10px;color:var(--sub);margin-top:2px}
.hero-tips{margin-top:12px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.hero-tip{display:flex;gap:8px;align-items:flex-start;padding:9px 10px;border-radius:14px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.12);font-size:11.5px;line-height:1.5}
.hero-tip-badge{width:22px;height:22px;border-radius:999px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0}
.hero-guide{margin-top:12px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:12px;display:grid;grid-template-columns:112px 1fr;gap:12px;align-items:center}
.hero-guide-frame{position:relative;width:112px;height:138px;border-radius:18px;background:linear-gradient(180deg,rgba(255,255,255,.24),rgba(255,255,255,.08));border:1.5px dashed rgba(255,255,255,.46);overflow:hidden}
.hero-guide-box{position:absolute;inset:18px 14px;border-radius:14px;border:2px solid rgba(255,255,255,.88)}
.hero-guide-dot{position:absolute;top:10px;left:50%;transform:translateX(-50%);width:34px;height:6px;border-radius:999px;background:rgba(255,255,255,.9)}
.hero-guide-badge{position:absolute;padding:4px 8px;border-radius:999px;background:rgba(10,16,28,.72);color:#fff;font-size:9.5px;font-weight:800}
.hero-guide-badge.top{top:10px;right:8px}
.hero-guide-badge.bottom{bottom:10px;left:8px}
.hero-guide-copy{font-size:12px;line-height:1.6;color:rgba(255,255,255,.88)}
.hero-guide-copy strong{display:block;font-size:13px;color:#fff;margin-bottom:4px}

/* ── SEARCH ── */
.search-strip{padding:0}
.search-inner{max-width:none;margin:0}
.s-wrap{position:relative}
.s-icon{position:absolute;left:18px;top:50%;transform:translateY(-50%);opacity:.45;pointer-events:none;font-size:16px;line-height:1}
.s-input{width:100%;padding:14px 18px 14px 48px;border-radius:18px;border:1.5px solid rgba(255,255,255,.22);font-size:14px;font-family:inherit;background:rgba(9,13,20,.14);outline:none;color:#fff;box-shadow:0 10px 26px rgba(15,23,42,.12);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.s-input::placeholder{color:var(--muted)}
.s-input:focus{box-shadow:0 0 0 4px color-mix(in srgb,var(--p) 18%,transparent),0 10px 26px rgba(15,23,42,.14);border-color:rgba(255,255,255,.42)}

/* ── STATS ── */
.stats{max-width:1180px;margin:8px auto 6px;padding:0 20px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.stats-count{font-size:14px;font-weight:700;color:var(--sub)}
.stats-count span{color:var(--p)}
.stats-badges{display:flex;flex-wrap:wrap;gap:10px}
.stats-badge{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:999px;background:rgba(255,255,255,.9);border:1px solid var(--border);box-shadow:var(--shadow-sm);font-size:12px;font-weight:700;color:var(--sub)}

/* ── FILTERS ── */
.filters{max-width:1180px;margin:4px auto 0;padding:0 20px}
.filters-inner{display:flex;gap:10px;flex-wrap:wrap}
.filter-btn{appearance:none;border:none;cursor:pointer;padding:10px 14px;border-radius:999px;background:rgba(255,255,255,.88);border:1px solid var(--border);box-shadow:var(--shadow-sm);font-size:12.5px;font-weight:800;color:var(--sub);font-family:inherit;transition:all .18s}
.filter-btn:hover{transform:translateY(-1px);border-color:color-mix(in srgb,var(--p) 22%,#dbe4f0)}
.filter-btn.active{background:linear-gradient(135deg,var(--p),var(--p2));color:#fff;border-color:transparent;box-shadow:0 14px 28px color-mix(in srgb,var(--p) 28%,transparent)}

/* ── GRID ── */
.grid-wrap{max-width:1180px;margin:0 auto 70px;padding:0 28px}
.section-head{display:flex;align-items:end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:12px 0 14px}
.section-kicker{font-size:11px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:var(--p)}
.section-title{margin-top:6px;font-size:28px;font-weight:900;letter-spacing:-.8px}
.section-text{margin-top:6px;font-size:13px;color:var(--sub)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:26px}

/* ── CARD ── */
.card{position:relative;background:linear-gradient(180deg,#fff 0%,#fbfcff 100%);border-radius:28px;overflow:hidden;text-decoration:none;color:inherit;display:flex;flex-direction:column;border:1px solid rgba(148,163,184,.16);transition:transform .22s cubic-bezier(.25,.46,.45,.94),box-shadow .22s,border-color .22s;box-shadow:var(--shadow-sm);animation:fadeUp .45s ease both}
.card:hover{transform:translateY(-7px);box-shadow:var(--shadow);border-color:color-mix(in srgb,var(--p) 22%,#dbe4f0)}
.card::after{content:'';position:absolute;inset:auto 0 0 0;height:5px;background:linear-gradient(90deg,var(--p),color-mix(in srgb,var(--p) 40%,#fff));opacity:0;transition:opacity .18s}
.card:hover::after{opacity:1}

/* Media */
.c-media{position:relative;overflow:hidden}
.c-img{width:100%;aspect-ratio:1;overflow:hidden;background:linear-gradient(135deg,#f8fbff,#eef3ff)}
.c-img img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .35s cubic-bezier(.25,.46,.45,.94)}
.card:hover .c-img img{transform:scale(1.07)}
.c-video{position:relative;width:100%;padding-top:56.25%;background:#0f172a}
.c-video.fb{padding-top:60%}
.c-video iframe{position:absolute;inset:0;width:100%;height:100%}
.c-ph{width:100%;aspect-ratio:1;background:radial-gradient(circle at top left,#eff4ff,#dfe8ff);display:flex;align-items:center;justify-content:center;font-size:54px}
.c-out-badge{position:absolute;top:14px;left:14px;background:rgba(220,38,38,.92);color:#fff;font-size:10px;font-weight:800;padding:5px 10px;border-radius:999px;letter-spacing:.06em}
.c-vid-badge{position:absolute;top:14px;right:14px;background:rgba(15,23,42,.72);color:#fff;font-size:10px;font-weight:700;padding:5px 10px;border-radius:999px;backdrop-filter:blur(6px)}
.c-free-badge{position:absolute;top:14px;left:14px;background:rgba(22,163,74,.92);color:#fff;font-size:10px;font-weight:800;padding:5px 10px;border-radius:999px;letter-spacing:.03em}
.c-featured-badge{position:absolute;top:14px;right:14px;background:rgba(234,88,12,.92);color:#fff;font-size:10px;font-weight:800;padding:5px 10px;border-radius:999px;letter-spacing:.03em}
.c-store-badge{position:absolute;left:14px;bottom:14px;background:rgba(255,255,255,.88);color:var(--text);font-size:10.5px;font-weight:800;padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.95);backdrop-filter:blur(8px)}

/* Body */
.c-body{padding:18px 20px 20px;flex:1;display:flex;flex-direction:column}
.c-code{font-size:10.5px;color:var(--muted);font-weight:800;letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px}
.c-name{font-size:16px;font-weight:800;color:var(--text);margin-bottom:6px;line-height:1.35;flex:1}
.c-desc{font-size:12px;color:var(--sub);line-height:1.65;margin-bottom:12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.c-footer{display:flex;align-items:end;justify-content:space-between;gap:10px;margin-top:auto;padding-top:12px;border-top:1px solid var(--border)}
.c-price-wrap{display:flex;flex-direction:column;gap:3px}
.c-price-lbl{font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.c-price{font-size:22px;font-weight:900;color:var(--p);letter-spacing:-.8px}
.c-price-old{font-size:12.5px;font-weight:700;color:var(--muted);text-decoration:line-through}
.c-off-badge{display:inline-block;background:#ef4444;color:#fff;font-size:10.5px;font-weight:800;padding:2px 7px;border-radius:999px;vertical-align:middle;letter-spacing:.02em}
.c-order{background:linear-gradient(135deg,var(--p),var(--p2));color:#fff;font-size:11.5px;font-weight:800;padding:9px 14px;border-radius:999px;white-space:nowrap;transition:opacity .15s}
.c-order:hover{opacity:.88}
.c-order-dis{background:var(--border);color:var(--muted)}

/* ── EMPTY ── */
.empty{grid-column:1/-1;text-align:center;padding:90px 22px;border-radius:28px;background:rgba(255,255,255,.76);backdrop-filter:blur(10px);border:1px solid var(--border);box-shadow:var(--shadow-sm)}
.empty-icon{font-size:56px;margin-bottom:16px}
.empty-title{font-size:18px;font-weight:700;color:var(--sub)}
.empty-btn{display:inline-block;margin-top:20px;padding:12px 24px;background:linear-gradient(135deg,var(--p),var(--p2));color:#fff;border-radius:999px;text-decoration:none;font-size:14px;font-weight:800;transition:opacity .15s}
.empty-btn:hover{opacity:.88}

/* ── FOOTER ── */
.site-footer{padding:20px 20px 36px}
.footer-inner{max-width:1180px;margin:0 auto;background:linear-gradient(180deg,rgba(255,255,255,.95),rgba(255,255,255,.84));border:1px solid var(--border);border-radius:30px;padding:28px 22px;text-align:center;box-shadow:var(--shadow-sm)}
.f-name{font-size:18px;font-weight:900;color:var(--text);margin-bottom:6px;letter-spacing:-.3px}
.f-sub{font-size:13px;color:var(--muted)}
.f-sub a{color:var(--p);text-decoration:none;font-weight:600}
.footer-help{font-size:13px;color:var(--sub);margin-top:10px;font-weight:600}
.footer-links{display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin-top:12px}
.footer-links a{display:inline-flex;align-items:center;gap:7px;padding:10px 14px;border-radius:999px;background:var(--surface-2);border:1px solid var(--border);box-shadow:var(--shadow-sm);text-decoration:none;font-size:12.5px;font-weight:700;color:var(--text)}

/* ── RESPONSIVE ── */
@media(max-width:900px){
  .hero-grid{grid-template-columns:1fr}
  .hero-panel{display:none}
  .hero-title{max-width:none}
  .stats{align-items:flex-start}
  .hero-tips{grid-template-columns:1fr}
}
@media(max-width:600px){
  .header-inner{padding:14px 16px 10px;align-items:flex-start}
  .header-actions{width:100%;margin-left:0;justify-content:space-between}
  .hero-wrap,.stats,.filters,.grid-wrap,.site-footer{padding-left:14px;padding-right:14px}
  .hero-card{padding:12px 14px}
  .hero-kicker{font-size:10px;padding:5px 9px}
  .hero-title{font-size:18px}
  .hero-text{font-size:11.5px}
  .hero-points{display:none}
  .h-biz{font-size:16px}
  .h-msg-btn{padding:9px 14px;font-size:12px}
  .h-msg-btn .h-msg-txt{display:inline}
  .s-input{padding:13px 16px 13px 44px;font-size:13px}
  .grid{grid-template-columns:repeat(2,1fr);gap:16px}
  .section-title{font-size:23px}
  .c-body{padding:14px 14px 16px}
  .c-name{font-size:14px}
  .c-price{font-size:18px}
  .c-order{font-size:10px;padding:5px 10px}
  .stats-badges{gap:8px}
  .stats-badge{padding:8px 12px;font-size:11px}
}
@media(max-width:360px){.grid{grid-template-columns:1fr}}

/* ── ANIMATION ── */
@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
.header{animation:fadeUp .3s ease}

/* ── DARK MODE ── */
@media(prefers-color-scheme:dark){
  :root{color-scheme:dark;--bg:#05070b;--surface:#0f141c;--surface-2:#131a24;--text:#eef2ff;--sub:#9aa6bc;--muted:#64748b;--border:rgba(255,255,255,.08);--shadow:0 24px 64px rgba(0,0,0,.42);--shadow-sm:0 12px 30px rgba(0,0,0,.28)}
  body{background:
    radial-gradient(circle at top left,color-mix(in srgb,var(--p) 18%,transparent),transparent 32%),
    radial-gradient(circle at top right,rgba(255,255,255,.04),transparent 24%),
    linear-gradient(180deg,#04060a 0%,#090d14 34%,#0b1119 100%)}
  .header{background:linear-gradient(180deg,#090d14 0%,#0c1220 58%,#10192a 100%)!important;box-shadow:0 14px 40px rgba(0,0,0,.34)}
  .hero-card{background:linear-gradient(135deg,rgba(16,25,42,.96),rgba(18,24,38,.88));border-color:rgba(255,255,255,.06);box-shadow:0 18px 40px rgba(0,0,0,.24),inset 0 1px 0 rgba(255,255,255,.04)}
  .hero-panel,.footer-inner,.stats-badge,.footer-links a,.filter-btn{background:#121925;color:var(--text);border-color:rgba(255,255,255,.08)}
  .hero-kicker,.hero-pill{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.1)}
  .hero-text{color:rgba(238,242,255,.8)}
  .hero-panel-title,.section-title,.c-name,.f-name{color:#eef2ff}
  .hero-panel-label,.section-kicker,.c-code,.c-price-lbl{color:#9fb2d8}
  .hero-panel-text,.section-text,.c-desc,.f-sub,.footer-help,.stats-count{color:#9aa6bc}
  .hero-stat-num,.stats-count span,.c-price{color:#8ea2ff}
  .hero-stat-lbl,.s-input::placeholder{color:#7b8aa3}
  .stats-badge,.filter-btn,.footer-links a{color:#dbe7ff !important}
  .filter-btn.active{color:#fff !important}
  .h-sub,.nav-sub{color:#c5d1ec}
  .h-msg-btn,.dk-btn{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.12);color:#eef2ff}
  .h-msg-btn:hover,.dk-btn:hover{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.18)}
  .s-input{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.08);color:#eef2ff;box-shadow:0 12px 30px rgba(0,0,0,.18)}
  .stats-badge,.filter-btn,.footer-links a,.hero-panel{backdrop-filter:none}
  .card{background:linear-gradient(180deg,#0f141c 0%,#121924 100%);border-color:rgba(255,255,255,.06)}
  .c-img{background:linear-gradient(135deg,#0f1722,#131b29)}
  .c-ph{background:linear-gradient(135deg,#141b27,#0f141d)!important}
  .c-store-badge{background:rgba(10,14,20,.84);color:#eef2ff;border-color:rgba(255,255,255,.08)}
  .c-order-dis{background:#1b2431;color:#7b8aa3}
  .hero-stat{background:rgba(255,255,255,.03)}
  .stats-badge,.footer-links a,.filter-btn{box-shadow:none}
  .filter-btn:hover{border-color:color-mix(in srgb,var(--p) 35%,rgba(255,255,255,.12))}
  .site-footer{background:transparent}
  .section-text,.c-desc,.hero-panel-text,.footer-help{color:var(--sub)}
}
[data-dark="1"]{color-scheme:dark;--bg:#05070b;--surface:#0f141c;--surface-2:#131a24;--text:#eef2ff;--sub:#9aa6bc;--muted:#64748b;--border:rgba(255,255,255,.08);--shadow:0 24px 64px rgba(0,0,0,.42);--shadow-sm:0 12px 30px rgba(0,0,0,.28)}
[data-dark="1"] body{background:
  radial-gradient(circle at top left,color-mix(in srgb,var(--p) 18%,transparent),transparent 32%),
  radial-gradient(circle at top right,rgba(255,255,255,.04),transparent 24%),
  linear-gradient(180deg,#04060a 0%,#090d14 34%,#0b1119 100%)}
[data-dark="1"] .header{background:linear-gradient(180deg,#090d14 0%,#0c1220 58%,#10192a 100%)!important;box-shadow:0 14px 40px rgba(0,0,0,.34)}
[data-dark="1"] .hero-card{background:linear-gradient(135deg,rgba(16,25,42,.96),rgba(18,24,38,.88));border-color:rgba(255,255,255,.06);box-shadow:0 18px 40px rgba(0,0,0,.24),inset 0 1px 0 rgba(255,255,255,.04)}
[data-dark="1"] .hero-panel,[data-dark="1"] .footer-inner,[data-dark="1"] .stats-badge,[data-dark="1"] .footer-links a,[data-dark="1"] .filter-btn{background:#121925;color:var(--text);border-color:rgba(255,255,255,.08)}
[data-dark="1"] .hero-kicker,[data-dark="1"] .hero-pill{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.1)}
[data-dark="1"] .hero-text{color:rgba(238,242,255,.8)}
[data-dark="1"] .hero-panel-title,[data-dark="1"] .section-title,[data-dark="1"] .c-name,[data-dark="1"] .f-name{color:#eef2ff}
[data-dark="1"] .hero-panel-label,[data-dark="1"] .section-kicker,[data-dark="1"] .c-code,[data-dark="1"] .c-price-lbl{color:#9fb2d8}
[data-dark="1"] .hero-panel-text,[data-dark="1"] .section-text,[data-dark="1"] .c-desc,[data-dark="1"] .f-sub,[data-dark="1"] .footer-help,[data-dark="1"] .stats-count{color:#9aa6bc}
[data-dark="1"] .hero-stat-num,[data-dark="1"] .stats-count span,[data-dark="1"] .c-price{color:#8ea2ff}
[data-dark="1"] .hero-stat-lbl,[data-dark="1"] .s-input::placeholder{color:#7b8aa3}
[data-dark="1"] .stats-badge,[data-dark="1"] .filter-btn,[data-dark="1"] .footer-links a{color:#dbe7ff !important}
[data-dark="1"] .filter-btn.active{color:#fff !important}
[data-dark="1"] .h-sub,[data-dark="1"] .nav-sub{color:#c5d1ec}
[data-dark="1"] .h-msg-btn,[data-dark="1"] .dk-btn{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.12);color:#eef2ff}
[data-dark="1"] .h-msg-btn:hover,[data-dark="1"] .dk-btn:hover{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.18)}
[data-dark="1"] .s-input{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.08);color:#eef2ff;box-shadow:0 12px 30px rgba(0,0,0,.18)}
[data-dark="1"] .stats-badge,[data-dark="1"] .filter-btn,[data-dark="1"] .footer-links a,[data-dark="1"] .hero-panel{backdrop-filter:none}
[data-dark="1"] .card{background:linear-gradient(180deg,#0f141c 0%,#121924 100%);border-color:rgba(255,255,255,.06)}
[data-dark="1"] .c-img{background:linear-gradient(135deg,#0f1722,#131b29)}
[data-dark="1"] .c-ph{background:linear-gradient(135deg,#141b27,#0f141d)!important}
[data-dark="1"] .c-store-badge{background:rgba(10,14,20,.84);color:#eef2ff;border-color:rgba(255,255,255,.08)}
[data-dark="1"] .c-order-dis{background:#1b2431;color:#7b8aa3}
[data-dark="1"] .hero-stat{background:rgba(255,255,255,.03)}
[data-dark="1"] .stats-badge,[data-dark="1"] .footer-links a,[data-dark="1"] .filter-btn{box-shadow:none}
[data-dark="1"] .filter-btn:hover{border-color:color-mix(in srgb,var(--p) 35%,rgba(255,255,255,.12))}
[data-dark="1"] .site-footer{background:transparent}
[data-dark="1"] .section-text,[data-dark="1"] .c-desc,[data-dark="1"] .hero-panel-text,[data-dark="1"] .footer-help{color:var(--sub)}
[data-dark="0"]{color-scheme:light;--bg:#f0f2f8;--surface:#fff;--text:#0f172a;--sub:#475569;--muted:#94a3b8;--border:#e2e8f0;--shadow:0 18px 50px rgba(15,23,42,.08);--shadow-sm:0 8px 24px rgba(15,23,42,.06)}
[data-dark="0"] body{background:radial-gradient(circle at top left,color-mix(in srgb,var(--p) 12%,transparent),transparent 34%),linear-gradient(180deg,#f9fbff 0%,#f6f7fb 32%,#eef2f8 100%)!important}
[data-dark="0"] .header{background:linear-gradient(135deg,var(--p),var(--p2))!important;box-shadow:0 10px 30px rgba(15,23,42,.16)!important}
[data-dark="0"] .hero-card{background:linear-gradient(135deg,rgba(255,255,255,.14),rgba(255,255,255,.06))!important;border-color:rgba(255,255,255,.12)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.12)!important}
[data-dark="0"] .s-input{background:rgba(255,255,255,.15);border-color:rgba(255,255,255,.28);color:#fff}
[data-dark="0"] .s-input::placeholder{color:rgba(255,255,255,.55)}
[data-dark="0"] .hero-panel,[data-dark="0"] .footer-inner{background:rgba(255,255,255,.96)!important;color:var(--text)!important;border-color:var(--border)!important}
[data-dark="0"] .hero-kicker,[data-dark="0"] .hero-pill{background:rgba(255,255,255,.16)!important;border-color:rgba(255,255,255,.18)!important}
[data-dark="0"] .stats-badge{background:rgba(255,255,255,.9)!important;color:var(--sub)!important;border-color:var(--border)!important;box-shadow:var(--shadow-sm)!important}
[data-dark="0"] .filter-btn{background:rgba(255,255,255,.88)!important;color:var(--sub)!important;border-color:var(--border)!important;box-shadow:var(--shadow-sm)!important}
[data-dark="0"] .filter-btn.active{background:linear-gradient(135deg,var(--p),var(--p2))!important;color:#fff!important;border-color:transparent!important;box-shadow:0 14px 28px color-mix(in srgb,var(--p) 28%,transparent)!important}
[data-dark="0"] .card{background:linear-gradient(180deg,#fff 0%,#fbfcff 100%)!important;border-color:rgba(148,163,184,.16)!important}
[data-dark="0"] .c-name{color:#0f172a!important}
[data-dark="0"] .c-img{background:linear-gradient(135deg,#f8fbff,#eef3ff)!important}
[data-dark="0"] .c-ph{background:radial-gradient(circle at top left,#eff4ff,#dfe8ff)!important}
[data-dark="0"] .c-store-badge{background:rgba(255,255,255,.88)!important;color:var(--text)!important;border-color:rgba(255,255,255,.95)!important}
[data-dark="0"] .c-order-dis{background:var(--border)!important;color:var(--muted)!important}
[data-dark="0"] .hero-stat{background:rgba(255,255,255,.6)!important}
[data-dark="0"] .footer-links a{background:rgba(255,255,255,.9)!important;color:var(--text)!important;border-color:var(--border)!important}
[data-dark="0"] .site-footer{background:unset!important}
[data-dark="0"] .h-msg-btn,[data-dark="0"] .dk-btn{background:rgba(255,255,255,.18)!important;border-color:rgba(255,255,255,.35)!important;color:#fff!important}
[data-dark="0"] .section-title{color:#0f172a!important}
[data-dark="0"] .section-text{color:#475569!important}
[data-dark="0"] .hero-panel-title,[data-dark="0"] .hero-panel-label,[data-dark="0"] .hero-panel-text{color:inherit!important}
[data-dark="0"] .stats-count{color:var(--sub)!important}
[data-dark="0"] .stats-count span{color:var(--p)!important}

/* Search clear button */
.s-clear{position:absolute;right:14px;top:50%;transform:translateY(-50%);background:none;border:none;color:rgba(255,255,255,.55);font-size:15px;cursor:pointer;display:none;padding:4px 7px;line-height:1;border-radius:50%;transition:all .15s}
.s-clear:hover{color:#fff;background:rgba(255,255,255,.15)}

/* Dark toggle in header */
.dk-btn{background:rgba(255,255,255,.14);border:1.5px solid rgba(255,255,255,.25);color:#fff;border-radius:22px;padding:7px 12px;font-size:14px;cursor:pointer;transition:all .15s;line-height:1;backdrop-filter:blur(8px);flex-shrink:0}
.dk-btn:hover{background:rgba(255,255,255,.24)}
</style>
<script>
(function(){
  var s=localStorage.getItem('cat_dark');
  var sys=window.matchMedia('(prefers-color-scheme:dark)').matches;
  document.documentElement.dataset.dark=(s!==null?s==='1':sys)?'1':'0';
})();
</script>
</head>
<body>

<header class="header">
  <div class="header-inner">
    ${
      page.logoUrl
        ? `<img src="${esc(page.logoUrl)}" alt="logo" class="h-logo" onerror="this.outerHTML='<div class=h-logo-ph>🛍️</div>'">`
        : `<div class="h-logo-ph">🛍️</div>`
    }
    <div>
      <div class="h-biz">${esc(page.name)}</div>
      ${page.phone ? `<div class="h-sub">📞 ${esc(page.phone)}</div>` : ''}
    </div>
    <div class="header-actions">
      <a class="h-msg-btn" href="${catalogWaShare}" target="_blank" rel="noopener" title="WhatsApp এ শেয়ার করুন">
        💚 <span class="h-msg-txt">Share</span>
      </a>
      <a class="h-msg-btn" href="${esc(page.messengerUrl)}" target="_blank" rel="noopener">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span class="h-msg-txt">Message করুন</span>
      </a>
      <button class="dk-btn" id="dkBtn" onclick="(function(){var d=document.documentElement.dataset.dark==='1';document.documentElement.dataset.dark=d?'0':'1';localStorage.setItem('cat_dark',d?'0':'1');document.getElementById('dkBtn').textContent=d?'🌙':'☀️'})()">🌙</button>
    </div>
  </div>
<script>document.addEventListener('DOMContentLoaded',function(){var b=document.getElementById('dkBtn');if(b)b.textContent=document.documentElement.dataset.dark==='1'?'☀️':'🌙'});</script>
  <div class="hero-wrap">
    <div class="hero-card">
      ${
        restaurantTabs
          ? `<div class="resto-hero">
        <div class="resto-hero-copy">
          <div class="resto-kicker">🍽️ RESTAURANT &nbsp;·&nbsp; ONLINE ORDER</div>
          <div class="resto-title">${esc(page.name)}</div>
          <div class="resto-sub">${esc(page.tagline || 'গরম গরম খাবার — ম্যাপে লোকেশন দিন, আমরাই পৌঁছে দেব 🛵')}</div>
          <div class="resto-pills">
            ${openStatusPill}
            <span class="resto-pill">⚡ Fresh &amp; Hot</span>
            <span class="resto-pill">🛵 Home Delivery</span>
            <span class="resto-pill">📍 Live Location Order</span>
          </div>
        </div>
        ${page.menuImages && page.menuImages.length ? `<a class="resto-hero-img" href="${esc(page.menuImages[0])}" target="_blank" rel="noopener" title="Full menu দেখুন"><img src="${esc(page.menuImages[0])}" alt="Menu" loading="lazy"/><span class="resto-menu-tag">📖 Menu</span></a>` : ''}
      </div>`
          : ''
      }
      <div class="hero-search">
        <div class="search-strip">
          <div class="search-inner">
            <form method="GET" action="/catalog/${esc(page.id)}">
              <div class="s-wrap">
                <span class="s-icon">🔍</span>
                <input class="s-input" id="searchBox" type="search"
                  placeholder="Product খুঁজুন — code, নাম, যেকোনো কিছু..."
                  value="${esc(search)}" autocomplete="off" spellcheck="false"/>
                <button class="s-clear" id="sClear" type="button" aria-label="Clear search">✕</button>
              </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  </div>
</header>

<div class="stats">
  <div class="stats-count">
    ${
      search
        ? `"${esc(search)}" — <span>${products.length} টি result</span>`
        : `মোট <span>${products.length}</span> টি product`
    }
  </div>
</div>

${
  restaurantTabs && categoryTabs.length > 0
    ? `<div class="filters">
  <div class="filters-inner" id="categoryBar">
    <button type="button" class="filter-btn active" data-cat="">🍽️ সব (${products.length})</button>
    ${categoryTabs.map(([cat, count]) => `<button type="button" class="filter-btn" data-cat="${esc(cat.toLowerCase())}">${esc(cat)} (${count})</button>`).join('\n    ')}
  </div>
</div>`
    : ''
}
<div class="filters">
  <div class="filters-inner" id="filterBar">
    <button type="button" class="filter-btn active" data-sort="all">All</button>
    <button type="button" class="filter-btn" data-sort="custom">Custom</button>
    <button type="button" class="filter-btn" data-sort="new">New</button>
    <button type="button" class="filter-btn" data-sort="price-asc">Pricing Up</button>
    <button type="button" class="filter-btn" data-sort="price-desc">Pricing Down</button>
  </div>
</div>

<div class="grid-wrap">
  <div class="section-head">
    <div>
      <div class="section-kicker">${restaurantTabs ? "Today's Menu" : 'Featured Products'}</div>
      <div class="section-title">${search ? 'Search Result' : restaurantTabs ? '🍽️ আমাদের Menu' : 'Shop The Collection'}</div>
      <div class="section-text">${search ? 'আপনার search অনুযায়ী filtered product দেখানো হচ্ছে।' : 'স্টোরের available product গুলো browse করুন, detail page খুলে order complete করুন।'}</div>
    </div>
  </div>
  <div class="grid">
    ${cards || emptyState}
  </div>
</div>

<footer class="site-footer">
  <div class="footer-inner">
    <div class="f-name">${esc(page.name)}</div>
    <div class="f-sub">
      ${page.footerText ? `${esc(page.footerText)} · ` : ''}
      <a href="${esc(page.messengerUrl)}" target="_blank">💬 Messenger এ Order করুন</a>
    </div>
    ${page.phone ? `<div class="footer-help">Helpline: ${esc(page.phone)}</div>` : ''}
    ${
      page.whatsappUrl || page.facebookPageUrl
        ? `<div class="footer-links">
      ${page.whatsappUrl ? `<a href="${esc(page.whatsappUrl)}" target="_blank" rel="noopener">WhatsApp Support</a>` : ''}
      ${page.facebookPageUrl ? `<a href="${esc(page.facebookPageUrl)}" target="_blank" rel="noopener">Facebook Page</a>` : ''}
    </div>`
        : ''
    }
    <div class="footer-links" style="margin-top:8px">
      <a href="/catalog/${esc(page.id.toString())}/track">📦 Order Track করুন</a>
    </div>
  </div>
</footer>

${poweredByBadge()}
<script>
(function(){
  var grid = document.querySelector('.grid');
  var searchBox = document.getElementById('searchBox');
  var sClear = document.getElementById('sClear');
  var statsEl = document.querySelector('.stats-count');
  if(!grid) return;

  var allCards = Array.from(grid.querySelectorAll('.card'));
  var sortMode = 'all';
  var currentCat = '';
  var currentQuery = (searchBox ? searchBox.value : '').toLowerCase().trim();

  /* ── normalize text for matching ── */
  function norm(s){ return (s||'').toLowerCase().replace(/\s+/g,' ').trim(); }

  /* ── tokenize into words for multi-word search ── */
  function tokens(s){ return norm(s).split(' ').filter(Boolean); }

  /* ── check one card against query ── */
  function matches(card, q){
    if(!q) return true;
    var name = card.dataset.name || '';
    var code = card.dataset.code || '';
    var desc = card.dataset.desc || '';
    var price = String(card.dataset.price || '');
    var all = name + ' ' + code + ' ' + desc;

    /* exact substring */
    if(all.includes(q)) return true;

    /* code digits only: "42" matches "df-0042" */
    var numQ = q.replace(/\D/g,'');
    if(numQ.length >= 2 && code.replace(/\D/g,'').includes(numQ)) return true;

    /* every word must appear somewhere */
    var toks = tokens(q);
    if(toks.length > 1 && toks.every(function(t){ return all.includes(t); })) return true;

    return false;
  }

  /* ── apply current filter + sort ── */
  function apply(){
    var q = norm(currentQuery);
    var visible = [];
    allCards.forEach(function(c){
      var show = matches(c, q);
      if(show && currentCat){ show = (c.dataset.category || '') === currentCat; }
      c.style.display = show ? '' : 'none';
      if(show) visible.push(c);
    });

    /* sort visible */
    if(sortMode === 'price-asc'){
      visible.sort(function(a,b){ return Number(a.dataset.price||0)-Number(b.dataset.price||0); });
    } else if(sortMode === 'price-desc'){
      visible.sort(function(a,b){ return Number(b.dataset.price||0)-Number(a.dataset.price||0); });
    } else if(sortMode === 'new'){
      visible.sort(function(a,b){ return Number(b.dataset.productId||0)-Number(a.dataset.productId||0); });
    } else {
      visible.sort(function(a,b){ return Number(a.dataset.customIndex||0)-Number(b.dataset.customIndex||0); });
    }
    visible.forEach(function(c){ grid.appendChild(c); });

    /* update stats */
    if(statsEl){
      statsEl.innerHTML = q
        ? '"'+q+'" — <span>'+visible.length+' টি result</span>'
        : 'মোট <span>'+allCards.length+'</span> টি product';
    }

    /* live empty state */
    var live = grid.querySelector('.empty-live');
    if(visible.length === 0){
      if(!live){
        var e = document.createElement('div');
        e.className = 'empty empty-live';
        e.style.cssText = 'grid-column:1/-1';
        e.innerHTML = '<div class="empty-icon">🔍</div><div class="empty-title">"'+currentQuery+'" পাওয়া যায়নি</div><div style="margin-top:10px;font-size:13px;color:var(--muted)">অন্য keyword বা product code দিয়ে try করুন</div>';
        grid.appendChild(e);
      }
    } else {
      if(live) live.remove();
    }

    /* clear button */
    if(sClear) sClear.style.display = q ? '' : 'none';
  }

  /* ── search input ── */
  if(searchBox){
    searchBox.addEventListener('input', function(){
      currentQuery = this.value;
      apply();
    });
    /* clear button */
    if(sClear){
      sClear.addEventListener('click', function(){
        searchBox.value = '';
        currentQuery = '';
        apply();
        searchBox.focus();
      });
    }
  }

  /* ── sort buttons (scoped to #filterBar — category bar has its own state) ── */
  var buttons = Array.from(document.querySelectorAll('#filterBar .filter-btn'));
  buttons.forEach(function(btn){
    btn.addEventListener('click', function(){
      buttons.forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      sortMode = btn.dataset.sort || 'all';
      apply();
    });
  });

  /* ── V25: restaurant category tabs ── */
  var catButtons = Array.from(document.querySelectorAll('#categoryBar .filter-btn'));
  catButtons.forEach(function(btn){
    btn.addEventListener('click', function(){
      catButtons.forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      currentCat = btn.dataset.cat || '';
      apply();
    });
  });

  /* initial render */
  apply();
})();
</script>
</body>
</html>`;
  }

  private buildTrackHtml(pageId: string, primaryColor: string): string {
    const primary = esc(primaryColor);
    return `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Order Track করুন</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --p:${primary};
  --p-dark:color-mix(in srgb,${primary} 78%,#000);
  --bg:#f4f6fb;
  --surface:#fff;
  --text:#0d1117;
  --sub:#4b5563;
  --muted:#9ca3af;
  --border:#e5e7eb;
}
body{font-family:"Hind Siliguri","Inter",system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;-webkit-font-smoothing:antialiased}
.card{background:var(--surface);border-radius:20px;padding:32px 28px;width:100%;max-width:440px;box-shadow:0 8px 32px rgba(0,0,0,.10)}
h1{font-size:20px;font-weight:800;color:var(--text);margin-bottom:6px}
p{font-size:13.5px;color:var(--sub);margin-bottom:24px;line-height:1.6}
label{display:block;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
input{width:100%;padding:12px 14px;border-radius:12px;border:1.5px solid var(--border);background:var(--bg);color:var(--text);font-size:15px;font-family:inherit;outline:none;transition:border-color .15s}
input:focus{border-color:var(--p)}
button{width:100%;margin-top:14px;padding:13px;border-radius:13px;border:none;background:linear-gradient(135deg,var(--p),var(--p-dark));color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 4px 18px color-mix(in srgb,var(--p) 35%,transparent)}
button:disabled{opacity:.6;cursor:not-allowed}
.result{margin-top:20px;padding:16px;border-radius:14px;font-size:14px;line-height:1.7;display:none}
.result.ok{background:#f0fdf4;border:1.5px solid #bbf7d0;color:#14532d}
.result.err{background:#fef2f2;border:1.5px solid #fecaca;color:#991b1b}
.order-id{font-size:20px;font-weight:800;color:var(--p);margin-bottom:8px}
.status-line{font-size:16px;font-weight:700;margin-bottom:6px}
.items-list{font-size:13px;color:#555;margin-top:8px}
.back{display:block;text-align:center;margin-top:20px;font-size:13px;color:var(--p);text-decoration:none}
</style>
</head>
<body>
<div class="card">
  <h1>📦 Order Track করুন</h1>
  <p>আপনার Order ID দিন — আমরা delivery status জানাব।</p>
  <label>Order ID</label>
  <input type="number" id="oidInput" placeholder="যেমন: 1234" min="1">
  <button id="trackBtn" onclick="track()">Track করুন</button>
  <div class="result" id="result"></div>
  <a href="/catalog/${esc(pageId)}" class="back">← Catalog এ ফিরে যান</a>
</div>
<script>
var PAGE_ID = '${esc(pageId)}';
async function track() {
  var oid = document.getElementById('oidInput').value.trim();
  if (!oid) return;
  var btn = document.getElementById('trackBtn');
  var res = document.getElementById('result');
  btn.disabled = true; btn.textContent = 'খুঁজছি...';
  res.style.display = 'none';
  try {
    var r = await fetch('/catalog/' + PAGE_ID + '/order-status/' + oid);
    var d = await r.json();
    if (!r.ok) throw new Error(d.message || 'Order পাওয়া যায়নি');
    var items = (d.items || []).map(function(i){ return (i.productName || i.productCode) + ' × ' + i.qty; }).join(', ');
    var date = new Date(d.createdAt).toLocaleDateString('bn-BD', {day:'numeric',month:'long',year:'numeric'});
    res.className = 'result ok';
    res.innerHTML = '<div class="order-id">#' + d.id + '</div><div class="status-line">' + (d.statusBn || d.status) + '</div><div class="items-list">' + (items ? '🛍 ' + items : '') + '</div><div style="font-size:12px;color:#888;margin-top:4px">অর্ডার তারিখ: ' + date + '</div>';
    res.style.display = 'block';
  } catch(e) {
    res.className = 'result err';
    res.textContent = e.message || 'Order পাওয়া যায়নি। ID টি সঠিক কিনা দেখুন।';
    res.style.display = 'block';
  }
  btn.disabled = false; btn.textContent = 'Track করুন';
}
document.getElementById('oidInput').addEventListener('keydown', function(e){ if(e.key==='Enter') track(); });
</script>
</body>
</html>`;
  }

  private buildOrderSuccessHtml(
    pageId: string,
    orderId: number,
    primaryColor: string,
  ): string {
    const primary = esc(primaryColor);
    return `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>অর্ডার সম্পন্ন!</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --p:${primary};
  --p-dark:color-mix(in srgb,${primary} 78%,#000);
  --p-light:color-mix(in srgb,${primary} 12%,#fff);
  --p-mid:color-mix(in srgb,${primary} 22%,transparent);
}
body{font-family:"Hind Siliguri","Inter",system-ui,sans-serif;background:var(--p-light);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;-webkit-font-smoothing:antialiased}
.card{background:#fff;border-radius:24px;padding:40px 28px;width:100%;max-width:440px;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,.10)}
.icon{font-size:56px;margin-bottom:16px}
h1{font-size:22px;font-weight:800;color:var(--p-dark);margin-bottom:8px}
p{font-size:14px;color:#555;line-height:1.7;margin-bottom:20px}
.order-id-box{background:var(--p-light);border:2px solid var(--p-mid);border-radius:16px;padding:16px 20px;margin-bottom:24px}
.oid-label{font-size:11px;font-weight:700;color:var(--p-dark);text-transform:uppercase;letter-spacing:.1em}
.oid-value{font-size:36px;font-weight:900;color:var(--p-dark);letter-spacing:.05em}
.msg-box{background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:14px;padding:14px 16px;font-size:13px;color:#1e40af;line-height:1.6;text-align:left;margin-bottom:20px}
.msg-box strong{display:block;margin-bottom:4px;font-size:13.5px}
.btn-row{display:flex;gap:10px;flex-wrap:wrap}
.btn{flex:1;min-width:120px;padding:13px;border-radius:13px;border:none;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;text-decoration:none;display:block;text-align:center}
.btn-primary{background:linear-gradient(135deg,var(--p),var(--p-dark));color:#fff;box-shadow:0 4px 18px color-mix(in srgb,var(--p) 35%,transparent)}
.btn-secondary{background:#f1f5f9;color:#334155;border:1.5px solid #e2e8f0}
</style>
</head>
<body>
<div class="card">
  <div class="icon">🎉</div>
  <h1>অর্ডার সম্পন্ন হয়েছে!</h1>
  <p>আপনার অর্ডার সফলভাবে নেওয়া হয়েছে। নিচের Order ID টি সংরক্ষণ করুন।</p>
  <div class="order-id-box">
    <div class="oid-label">Order ID</div>
    <div class="oid-value">#${orderId}</div>
  </div>
  <div class="msg-box">
    <strong>📱 Messenger এ delivery update পেতে:</strong>
    Facebook Messenger এ আমাদের page এ গিয়ে শুধু <b>#${orderId}</b> লিখে পাঠান — bot আপনাকে delivery status জানাবে।
  </div>
  <div class="btn-row">
    <a href="/catalog/${esc(pageId)}/track" class="btn btn-secondary">📦 Order Track</a>
    <a href="/catalog/${esc(pageId)}" class="btn btn-primary">🛍 আরো কেনাকাটা</a>
  </div>
</div>
</body>
</html>`;
  }
}
