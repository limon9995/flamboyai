import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClientDashboardService } from '../client-dashboard/client-dashboard.service';
import { WalletService } from '../wallet/wallet.service';

/**
 * Tools that let the dashboard assistant (Liza) act like a store manager.
 *
 * READ tools run immediately and return account data scoped to one page.
 * WRITE tools never run inside the AI loop — they are validated, turned into
 * a human-readable preview (PendingAction) and shown to the user as a
 * Confirm/Cancel card. Only an explicit click calls executeAction(), which
 * re-validates everything, so the model can never change data on its own.
 */

export type PendingActionType =
  | 'update_product'
  | 'update_settings'
  | 'add_bot_knowledge'
  | 'order_action';

export interface PendingAction {
  type: PendingActionType;
  params: Record<string, any>;
  title: string;
  changes: { label: string; from: string; to: string }[];
}

type FieldType = 'boolean' | 'number' | 'string' | 'enum';
interface FieldSpec {
  type: FieldType;
  label: string;
  values?: string[];
  max?: number;
  /** 'modes' → routed through updateModes (plan-access checked); 'business' → updateBusinessSettings */
  group: 'modes' | 'business';
}

const SETTINGS_FIELDS: Record<string, FieldSpec> = {
  // Bot / feature modes
  automationOn: { type: 'boolean', label: 'বট অটোমেশন (সব auto reply)', group: 'modes' },
  orderModeOn: { type: 'boolean', label: 'অর্ডার মোড (bot order নেবে)', group: 'modes' },
  infoModeOn: { type: 'boolean', label: 'ইনফো মোড', group: 'modes' },
  smartBotOn: { type: 'boolean', label: 'স্মার্ট AI বট', group: 'modes' },
  businessBotOn: { type: 'boolean', label: 'বিজনেস বট', group: 'modes' },
  commentReplyOn: { type: 'boolean', label: 'কমেন্ট অটো রিপ্লাই', group: 'modes' },
  ocrOn: { type: 'boolean', label: 'OCR (ছবি থেকে product code)', group: 'modes' },
  printModeOn: { type: 'boolean', label: 'প্রিন্ট মোড', group: 'modes' },
  callConfirmModeOn: { type: 'boolean', label: 'কল কনফার্ম মোড', group: 'modes' },
  memoSaveModeOn: { type: 'boolean', label: 'মেমো সেভ মোড', group: 'modes' },
  recurringNotifMode: { type: 'boolean', label: 'Recurring notification (subscribe বাটন)', group: 'modes' },
  // Business info
  businessName: { type: 'string', label: 'ব্যবসার নাম', max: 120, group: 'business' },
  businessPhone: { type: 'string', label: 'ব্যবসার ফোন', max: 40, group: 'business' },
  businessAddress: { type: 'string', label: 'ব্যবসার ঠিকানা', max: 300, group: 'business' },
  websiteUrl: { type: 'string', label: 'ওয়েবসাইট', max: 200, group: 'business' },
  memoFooterText: { type: 'string', label: 'মেমো footer লেখা', max: 300, group: 'business' },
  businessInfo: { type: 'string', label: 'ব্যবসার তথ্য (বটের জন্য)', max: 3000, group: 'business' },
  // Delivery
  deliveryFeeInsideDhaka: { type: 'number', label: 'ঢাকার ভিতরে ডেলিভারি চার্জ (৳)', group: 'business' },
  deliveryFeeOutsideDhaka: { type: 'number', label: 'ঢাকার বাইরে ডেলিভারি চার্জ (৳)', group: 'business' },
  deliveryTimeInsideDhaka: { type: 'string', label: 'ঢাকার ভিতরে ডেলিভারি সময়', max: 100, group: 'business' },
  deliveryTimeOutsideDhaka: { type: 'string', label: 'ঢাকার বাইরে ডেলিভারি সময়', max: 100, group: 'business' },
  deliveryTimeText: { type: 'string', label: 'ডেলিভারি সময় (সাধারণ)', max: 200, group: 'business' },
  // Payment
  paymentMode: { type: 'enum', label: 'পেমেন্ট মোড', values: ['cod', 'advance_outside', 'full_advance'], group: 'business' },
  codEnabled: { type: 'boolean', label: 'ক্যাশ অন ডেলিভারি (COD)', group: 'business' },
  advanceAmount: { type: 'number', label: 'অগ্রিম পরিমাণ (৳)', group: 'business' },
  advanceThresholdAmount: { type: 'number', label: 'যত টাকার বেশি হলে অগ্রিম লাগবে (৳)', group: 'business' },
  advanceBkash: { type: 'string', label: 'bKash নম্বর', max: 20, group: 'business' },
  advanceNagad: { type: 'string', label: 'Nagad নম্বর', max: 20, group: 'business' },
  advanceRocket: { type: 'string', label: 'Rocket নম্বর', max: 20, group: 'business' },
  advancePaymentMessage: { type: 'string', label: 'অগ্রিম পেমেন্ট মেসেজ', max: 500, group: 'business' },
  webOrderEnabled: { type: 'boolean', label: 'ওয়েবসাইট থেকে অর্ডার', group: 'business' },
  // AI behaviour
  behaviorInstructions: { type: 'string', label: 'বটের আচরণ নির্দেশনা', max: 3000, group: 'business' },
  textFallbackAiOn: { type: 'boolean', label: 'Text fallback AI', group: 'business' },
  imageRecognitionOn: { type: 'boolean', label: 'ছবি দেখে product চেনা', group: 'business' },
  autoPauseOnHumanTakeover: { type: 'boolean', label: 'মানুষ reply দিলে bot pause', group: 'business' },
  autoPauseTimeoutMinutes: { type: 'number', label: 'Bot pause সময় (মিনিট)', group: 'business' },
  // Promotions
  loyaltyEnabled: { type: 'boolean', label: 'Lucky Customer (loyalty) ছাড়', group: 'business' },
  loyaltyThresholdOrders: { type: 'number', label: 'Loyalty — কত অর্ডার পর', group: 'business' },
  loyaltyDiscountPercent: { type: 'number', label: 'Loyalty ছাড় (%)', group: 'business' },
  happyHourEnabled: { type: 'boolean', label: 'Happy Hour ছাড়', group: 'business' },
  happyHourDiscountPercent: { type: 'number', label: 'Happy Hour ছাড় (%)', group: 'business' },
  happyHourLabel: { type: 'string', label: 'Happy Hour লেবেল', max: 60, group: 'business' },
  milestoneRewardsEnabled: { type: 'boolean', label: 'Milestone rewards', group: 'business' },
};

const PRODUCT_FIELDS: Record<string, { type: FieldType; label: string; values?: string[]; max?: number }> = {
  name: { type: 'string', label: 'নাম', max: 200 },
  price: { type: 'number', label: 'দাম (৳)' },
  originalPrice: { type: 'number', label: 'আগের দাম (৳) — 0 দিলে মুছে যাবে' },
  costPrice: { type: 'number', label: 'ক্রয় মূল্য (৳)' },
  stockQty: { type: 'number', label: 'স্টক' },
  description: { type: 'string', label: 'বিবরণ', max: 5000 },
  isActive: { type: 'boolean', label: 'Active' },
  catalogVisible: { type: 'boolean', label: 'ক্যাটালগে দেখাবে' },
  orderEnabled: { type: 'boolean', label: 'অর্ডার নেওয়া যাবে' },
  deliveryCharge: { type: 'enum', label: 'হোম ডেলিভারি', values: ['FREE', 'PAID'] },
  category: { type: 'string', label: 'ক্যাটাগরি', max: 80 },
  color: { type: 'string', label: 'রং', max: 80 },
};

const ORDER_ACTIONS: Record<string, string> = {
  confirm: 'কনফার্ম',
  cancel: 'বাতিল',
  pack: 'প্যাকড',
  ship: 'শিপড',
  deliver: 'ডেলিভারড',
  issue: 'ইস্যু হিসেবে মার্ক',
};

const WRITE_TOOLS = new Set<string>(['update_product', 'update_settings', 'add_bot_knowledge', 'order_action']);
const MAX_PENDING = 20;

function fieldSchema(spec: { type: FieldType; label: string; values?: string[] }) {
  if (spec.type === 'enum') return { type: 'string', enum: spec.values, description: spec.label };
  return { type: spec.type, description: spec.label };
}

function fmt(v: any): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'চালু' : 'বন্ধ';
  const s = String(v);
  return s.length > 80 ? s.slice(0, 80) + '…' : s;
}

function coerce(spec: { type: FieldType; values?: string[]; max?: number; label: string }, raw: any): any {
  if (spec.type === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    const s = String(raw).toLowerCase();
    if (['true', '1', 'on', 'yes'].includes(s)) return true;
    if (['false', '0', 'off', 'no'].includes(s)) return false;
    throw new BadRequestException(`${spec.label}: true/false দিতে হবে`);
  }
  if (spec.type === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`${spec.label}: সঠিক সংখ্যা দিন`);
    return n;
  }
  if (spec.type === 'enum') {
    const v = String(raw);
    const match = spec.values!.find((x) => x.toLowerCase() === v.toLowerCase());
    if (!match) throw new BadRequestException(`${spec.label}: ${spec.values!.join('/')} এর একটি দিন`);
    return match;
  }
  return String(raw ?? '').trim().slice(0, spec.max ?? 1000);
}

@Injectable()
export class AssistantToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: ClientDashboardService,
    private readonly wallet: WalletService,
  ) {}

  isWriteTool(name: string) {
    return WRITE_TOOLS.has(name);
  }

  get maxPending() {
    return MAX_PENDING;
  }

  /** Provider-neutral JSON-schema tool declarations. */
  declarations() {
    const settingsProps: Record<string, any> = {};
    for (const [k, spec] of Object.entries(SETTINGS_FIELDS)) settingsProps[k] = fieldSchema(spec);
    const productProps: Record<string, any> = {};
    for (const [k, spec] of Object.entries(PRODUCT_FIELDS)) productProps[k] = fieldSchema(spec);

    return [
      {
        name: 'get_account_overview',
        description:
          'Account snapshot: business name, wallet balance, subscription/plan, total/today orders by status, product count, low-stock count. Use for general "how is my business / account" questions.',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'get_sales_report',
        description:
          'Sales for the last N days (or today when days=0/1): order counts by status, revenue, delivered revenue, average order value, top products.',
        parameters: {
          type: 'object',
          properties: { days: { type: 'integer', description: 'Number of days back, 1 = today only. Default 30, max 365.' } },
        },
      },
      {
        name: 'list_orders',
        description: 'List recent orders, optionally filtered by status or a customer phone/name search.',
        parameters: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['RECEIVED', 'PENDING', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'ISSUE', 'RETURNED'],
            },
            search: { type: 'string', description: 'Customer phone number or name' },
            days: { type: 'integer', description: 'Only orders from the last N days' },
            limit: { type: 'integer', description: 'Max 20, default 10' },
          },
        },
      },
      {
        name: 'get_order',
        description: 'Full details of one order by its numeric ID.',
        parameters: { type: 'object', properties: { orderId: { type: 'integer' } }, required: ['orderId'] },
      },
      {
        name: 'search_products',
        description: 'Search the product catalog by code/name/category, or find low-stock / inactive products.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            lowStockBelow: { type: 'integer', description: 'Only products whose stock is below this number' },
            inactiveOnly: { type: 'boolean' },
            limit: { type: 'integer', description: 'Max 30, default 15' },
          },
        },
      },
      {
        name: 'get_product',
        description: 'Full details of one product by product code.',
        parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
      },
      {
        name: 'get_settings',
        description: 'Current page settings: bot modes, business info, delivery charges, payment mode, AI behaviour, promotions.',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'get_wallet',
        description: 'Wallet credit balance, AI status and the 10 most recent wallet transactions.',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'update_product',
        description:
          'Change one product (price, stock, name, description, active, etc.). Use stockDelta for relative stock changes (e.g. +10 / -3). The user will be shown a confirmation card; nothing changes until they confirm. Call once per product.',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Product code' },
            stockDelta: { type: 'integer', description: 'Add (+) or remove (-) stock relative to current' },
            ...productProps,
          },
          required: ['code'],
        },
      },
      {
        name: 'update_settings',
        description:
          'Change page settings (bot modes on/off, business info, delivery charge, payment mode, bot behaviour, promotions). Only include fields that should change. The user must confirm before it is applied.',
        parameters: { type: 'object', properties: settingsProps },
      },
      {
        name: 'add_bot_knowledge',
        description:
          'Teach the customer-facing bot a new fact/rule by appending text to its knowledge base (e.g. shop timing, return policy). The user must confirm.',
        parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      },
      {
        name: 'order_action',
        description: 'Change an order status: confirm, cancel, pack, ship, deliver or issue. The user must confirm.',
        parameters: {
          type: 'object',
          properties: {
            orderId: { type: 'integer' },
            action: { type: 'string', enum: Object.keys(ORDER_ACTIONS) },
            cancelNote: { type: 'string' },
          },
          required: ['orderId', 'action'],
        },
      },
    ];
  }

  // ── READ ──────────────────────────────────────────────────────────────────

  async runRead(pageId: number, name: string, args: any): Promise<any> {
    switch (name) {
      case 'get_account_overview':
        return this.accountOverview(pageId);
      case 'get_sales_report':
        return this.salesReport(pageId, Number(args?.days ?? 30));
      case 'list_orders':
        return this.listOrders(pageId, args || {});
      case 'get_order':
        return this.getOrder(pageId, Number(args?.orderId));
      case 'search_products':
        return this.searchProducts(pageId, args || {});
      case 'get_product':
        return this.getProduct(pageId, String(args?.code ?? ''));
      case 'get_settings':
        return this.getSettings(pageId);
      case 'get_wallet':
        return this.getWallet(pageId);
      default:
        return { error: `Unknown tool ${name}` };
    }
  }

  private orderTotal(o: { items: { unitPrice: number; qty: number }[]; deliveryFee?: number | null }) {
    return o.items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  }

  private async accountOverview(pageId: number) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const [page, statusGroups, todayOrders, products, lowStock] = await Promise.all([
      this.prisma.page.findUnique({
        where: { id: pageId },
        select: {
          pageName: true, businessName: true, creditBalance: true, subscriptionStatus: true, ownerId: true,
          automationOn: true, orderModeOn: true, waEnabled: true, igEnabled: true,
        },
      }),
      this.prisma.order.groupBy({ by: ['status'], where: { pageIdRef: pageId }, _count: { _all: true } }),
      this.prisma.order.findMany({
        where: { pageIdRef: pageId, createdAt: { gte: startOfToday } },
        select: { status: true, items: { select: { unitPrice: true, qty: true } } },
      }),
      this.prisma.product.count({ where: { pageId } }),
      this.prisma.product.count({ where: { pageId, isActive: true, stockQty: { lte: 3 } } }),
    ]);
    const sub = page?.ownerId
      ? await this.prisma.subscription.findFirst({
          where: { userId: page.ownerId },
          orderBy: { createdAt: 'desc' },
          select: { status: true, periodEnd: true, trialEndsAt: true, ordersUsed: true, ordersLimit: true, plan: { select: { displayName: true } } },
        })
      : null;
    return {
      businessName: page?.businessName || page?.pageName,
      walletCreditBalance: Number((page?.creditBalance ?? 0).toFixed(2)),
      aiStatus: await this.wallet.getAiStatus(pageId),
      pageSubscriptionStatus: page?.subscriptionStatus,
      plan: sub
        ? { name: sub.plan?.displayName, status: sub.status, periodEnd: sub.periodEnd, trialEndsAt: sub.trialEndsAt, ordersUsed: sub.ordersUsed, ordersLimit: sub.ordersLimit }
        : null,
      botAutomationOn: page?.automationOn,
      orderModeOn: page?.orderModeOn,
      whatsappEnabled: page?.waEnabled,
      instagramEnabled: page?.igEnabled,
      ordersByStatus: Object.fromEntries(statusGroups.map((g) => [g.status, g._count._all])),
      today: {
        orders: todayOrders.length,
        revenueExclCancelled: todayOrders.filter((o) => o.status !== 'CANCELLED').reduce((s, o) => s + this.orderTotal(o), 0),
      },
      totalProducts: products,
      lowStockProducts: lowStock,
    };
  }

  private async salesReport(pageId: number, daysRaw: number) {
    const days = Math.min(Math.max(Number.isFinite(daysRaw) ? Math.floor(daysRaw) : 30, 1), 365);
    const since = new Date();
    if (days === 1) since.setHours(0, 0, 0, 0);
    else since.setTime(since.getTime() - days * 86_400_000);
    const orders = await this.prisma.order.findMany({
      where: { pageIdRef: pageId, createdAt: { gte: since } },
      select: { status: true, items: { select: { unitPrice: true, qty: true, productCode: true, productName: true } } },
    });
    const byStatus: Record<string, number> = {};
    let revenue = 0;
    let delivered = 0;
    const productMap = new Map<string, { code: string; name: string | null; qty: number; revenue: number }>();
    for (const o of orders) {
      byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
      if (o.status === 'CANCELLED') continue;
      const total = this.orderTotal(o);
      revenue += total;
      if (o.status === 'DELIVERED') delivered += total;
      for (const i of o.items) {
        const cur = productMap.get(i.productCode) ?? { code: i.productCode, name: i.productName, qty: 0, revenue: 0 };
        cur.qty += i.qty;
        cur.revenue += i.qty * i.unitPrice;
        productMap.set(i.productCode, cur);
      }
    }
    const nonCancelled = orders.length - (byStatus.CANCELLED ?? 0);
    return {
      period: days === 1 ? 'today' : `last ${days} days`,
      totalOrders: orders.length,
      ordersByStatus: byStatus,
      revenueExclCancelled: Math.round(revenue),
      deliveredRevenue: Math.round(delivered),
      averageOrderValue: nonCancelled ? Math.round(revenue / nonCancelled) : 0,
      topProducts: [...productMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 5),
    };
  }

  private async listOrders(pageId: number, args: any) {
    const where: any = { pageIdRef: pageId };
    if (args.status) where.status = String(args.status).toUpperCase();
    if (args.days) where.createdAt = { gte: new Date(Date.now() - Math.min(Number(args.days), 365) * 86_400_000) };
    if (args.search) {
      const q = String(args.search).trim();
      where.OR = [{ phone: { contains: q } }, { customerName: { contains: q, mode: 'insensitive' } }];
    }
    const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 20);
    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit,
      select: {
        id: true, customerName: true, phone: true, status: true, source: true, paymentStatus: true, createdAt: true, deliveryFee: true,
        items: { select: { productCode: true, qty: true, unitPrice: true } },
      },
    });
    return orders.map((o) => ({
      id: o.id, customer: o.customerName, phone: o.phone, status: o.status, source: o.source,
      paymentStatus: o.paymentStatus, createdAt: o.createdAt,
      items: o.items.map((i) => `${i.productCode} x${i.qty}`).join(', '),
      total: this.orderTotal(o),
    }));
  }

  private async getOrder(pageId: number, orderId: number) {
    if (!Number.isInteger(orderId)) return { error: 'orderId দরকার' };
    const o = await this.prisma.order.findFirst({
      where: { id: orderId, pageIdRef: pageId },
      include: {
        items: { select: { productCode: true, productName: true, qty: true, unitPrice: true } },
        courierShipment: { select: { courierName: true, status: true, trackingId: true } },
      },
    });
    if (!o) return { error: `Order #${orderId} পাওয়া যায়নি` };
    return {
      id: o.id, customer: o.customerName, phone: o.phone, address: o.address, status: o.status, source: o.source,
      paymentStatus: o.paymentStatus, transactionId: o.transactionId, callStatus: o.callStatus, note: o.orderNote,
      cancelNote: o.cancelNote, spamRisk: o.spamRisk, createdAt: o.createdAt, confirmedAt: o.confirmedAt, deliveredAt: o.deliveredAt,
      items: o.items, itemsTotal: this.orderTotal(o), deliveryFee: o.deliveryFee, courier: o.courierShipment,
    };
  }

  private async searchProducts(pageId: number, args: any) {
    const where: any = { pageId };
    if (args.query) {
      const q = String(args.query).trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { category: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (args.lowStockBelow !== undefined) where.stockQty = { lt: Number(args.lowStockBelow) };
    if (args.inactiveOnly) where.isActive = false;
    const limit = Math.min(Math.max(Number(args.limit) || 15, 1), 30);
    const [total, rows] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: { id: 'desc' },
        take: limit,
        select: { code: true, name: true, price: true, originalPrice: true, stockQty: true, isActive: true, category: true },
      }),
    ]);
    return { totalMatching: total, products: rows };
  }

  private async getProduct(pageId: number, code: string) {
    const p = await this.findProduct(pageId, code);
    if (!p) return { error: `Product "${code}" পাওয়া যায়নি` };
    const { id: _id, pageId: _pid, referenceImagesJson: _r, aiDescription: _a, imageKeywords: _k, ...rest } = p as any;
    return rest;
  }

  private async getSettings(pageId: number) {
    const page: any = await this.prisma.page.findUnique({ where: { id: pageId } });
    if (!page) return { error: 'Page পাওয়া যায়নি' };
    const out: Record<string, any> = {};
    for (const k of Object.keys(SETTINGS_FIELDS)) {
      const v = page[k];
      out[k] = typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v;
    }
    // Never expose tokens/secrets — only whether they are set.
    out.knowledgeText = String(page.knowledgeText || '').slice(0, 600);
    out.whatsappConnected = Boolean(page.waEnabled && page.waToken);
    out.instagramConnected = Boolean(page.igEnabled && page.igToken);
    out.telegramNotifEnabled = Boolean(page.telegramNotifEnabled);
    return out;
  }

  private async getWallet(pageId: number) {
    const [page, tx] = await Promise.all([
      this.prisma.page.findUnique({ where: { id: pageId }, select: { creditBalance: true, subscriptionStatus: true } }),
      this.prisma.walletTransaction.findMany({
        where: { pageId },
        orderBy: { id: 'desc' },
        take: 10,
        select: { type: true, amountCredit: true, description: true, createdAt: true },
      }),
    ]);
    return {
      creditBalance: Number((page?.creditBalance ?? 0).toFixed(2)),
      subscriptionStatus: page?.subscriptionStatus,
      aiStatus: await this.wallet.getAiStatus(pageId),
      recentTransactions: tx,
    };
  }

  private findProduct(pageId: number, code: string) {
    const c = String(code || '').trim().toUpperCase();
    if (!c) return Promise.resolve(null);
    return this.prisma.product.findFirst({ where: { pageId, code: c } });
  }

  // ── WRITE: preview (validate + diff, no changes) ─────────────────────────

  async preview(pageId: number, name: string, args: any): Promise<PendingAction> {
    if (name === 'update_product') return this.previewProduct(pageId, args || {});
    if (name === 'update_settings') return this.previewSettings(pageId, args || {});
    if (name === 'add_bot_knowledge') return this.previewKnowledge(pageId, args || {});
    if (name === 'order_action') return this.previewOrder(pageId, args || {});
    throw new BadRequestException(`Unknown action ${name}`);
  }

  private async previewProduct(pageId: number, args: any): Promise<PendingAction> {
    const product: any = await this.findProduct(pageId, args.code);
    if (!product) throw new BadRequestException(`Product "${args.code}" পাওয়া যায়নি`);
    const params: Record<string, any> = { code: product.code };
    const changes: PendingAction['changes'] = [];
    for (const [k, spec] of Object.entries(PRODUCT_FIELDS)) {
      if (args[k] === undefined || args[k] === null) continue;
      let v = coerce(spec, args[k]);
      if (k === 'originalPrice' && v === 0) v = null;
      if (k === 'stockQty') v = Math.floor(v);
      if (v === product[k]) continue;
      params[k] = v;
      changes.push({ label: spec.label.replace(/ — .*/, ''), from: fmt(product[k]), to: fmt(v) });
    }
    if (args.stockDelta !== undefined && params.stockQty === undefined) {
      const delta = Math.trunc(Number(args.stockDelta));
      if (!Number.isFinite(delta) || delta === 0) throw new BadRequestException('stockDelta সঠিক নয়');
      const next = Math.max(0, product.stockQty + delta);
      params.stockQty = next;
      changes.push({ label: 'স্টক', from: fmt(product.stockQty), to: `${next} (${delta > 0 ? '+' : ''}${delta})` });
    }
    if (!changes.length) throw new BadRequestException('কোনো পরিবর্তন পাওয়া যায়নি — মান আগের মতোই আছে');
    return { type: 'update_product', params, title: `Product ${product.code}${product.name ? ` — ${product.name}` : ''} আপডেট`, changes };
  }

  private async previewSettings(pageId: number, args: any): Promise<PendingAction> {
    const current: any = await this.prisma.page.findUnique({ where: { id: pageId } });
    const params: Record<string, any> = {};
    const changes: PendingAction['changes'] = [];
    for (const [k, spec] of Object.entries(SETTINGS_FIELDS)) {
      if (args[k] === undefined || args[k] === null) continue;
      const v = coerce(spec, args[k]);
      if (v === current?.[k]) continue;
      params[k] = v;
      changes.push({ label: spec.label, from: fmt(current?.[k]), to: fmt(v) });
    }
    if (!changes.length) throw new BadRequestException('কোনো পরিবর্তন পাওয়া যায়নি — সেটিং আগের মতোই আছে');
    return { type: 'update_settings', params, title: 'সেটিং পরিবর্তন', changes };
  }

  private async previewKnowledge(pageId: number, args: any): Promise<PendingAction> {
    const text = String(args.text ?? '').trim().slice(0, 1000);
    if (!text) throw new BadRequestException('কী শেখাতে হবে লিখুন');
    const page = await this.prisma.page.findUnique({ where: { id: pageId }, select: { knowledgeText: true } });
    const existing = page?.knowledgeText ?? '';
    if (existing.length + text.length + 1 > 3000)
      throw new BadRequestException('বট নলেজ ৩০০০ অক্ষরের সীমা ছাড়িয়ে যাবে — Settings থেকে পুরনো কিছু মুছুন');
    return { type: 'add_bot_knowledge', params: { text }, title: 'বটকে নতুন তথ্য শেখানো', changes: [{ label: 'নতুন নলেজ', from: '—', to: fmt(text) }] };
  }

  private async previewOrder(pageId: number, args: any): Promise<PendingAction> {
    const orderId = Number(args.orderId);
    const action = String(args.action ?? '').toLowerCase();
    if (!ORDER_ACTIONS[action]) throw new BadRequestException('Action সঠিক নয়');
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, pageIdRef: pageId },
      select: { id: true, status: true, customerName: true },
    });
    if (!order) throw new BadRequestException(`Order #${orderId} পাওয়া যায়নি`);
    const params: Record<string, any> = { orderId, action };
    if (action === 'cancel' && args.cancelNote) params.cancelNote = String(args.cancelNote).slice(0, 300);
    return {
      type: 'order_action',
      params,
      title: `Order #${orderId}${order.customerName ? ` (${order.customerName})` : ''} → ${ORDER_ACTIONS[action]}`,
      changes: [{ label: 'Status', from: order.status, to: ORDER_ACTIONS[action] }],
    };
  }

  // ── WRITE: execute (only after the user clicked Confirm) ──────────────────

  async execute(pageId: number, action: { type: string; params: any }): Promise<string> {
    // Re-run the preview so the same validation/whitelisting applies to
    // whatever the client sent back — never trust the params blindly.
    const checked = await this.preview(pageId, action?.type, action?.params);
    const p = checked.params;
    switch (checked.type) {
      case 'update_product': {
        const { code, ...fields } = p;
        await this.dashboard.updateProduct(pageId, code, fields);
        return `✅ ${checked.title} সম্পন্ন`;
      }
      case 'update_settings': {
        const modes: Record<string, any> = {};
        const business: Record<string, any> = {};
        for (const [k, v] of Object.entries(p)) (SETTINGS_FIELDS[k].group === 'modes' ? modes : business)[k] = v;
        if (Object.keys(modes).length) await this.dashboard.updateModes(pageId, modes);
        if (Object.keys(business).length) await this.dashboard.updateBusinessSettings(pageId, business);
        return '✅ সেটিং আপডেট হয়েছে';
      }
      case 'add_bot_knowledge': {
        const page = await this.prisma.page.findUnique({ where: { id: pageId }, select: { knowledgeText: true } });
        const next = [page?.knowledgeText?.trim(), p.text].filter(Boolean).join('\n');
        await this.dashboard.updateBusinessSettings(pageId, { knowledgeText: next });
        return '✅ বট নতুন তথ্য শিখেছে';
      }
      case 'order_action':
        await this.dashboard.applyOrderAction(pageId, p.orderId, p.action, p.cancelNote);
        return `✅ ${checked.title} সম্পন্ন`;
    }
    throw new BadRequestException('Unknown action');
  }
}
