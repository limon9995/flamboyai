import {
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OrderNotificationService } from './order-notification.service';
import { ConversationContextService } from '../conversation-context/conversation-context.service';
import { BroadcastService } from '../broadcast/broadcast.service';
import { TelegramNotificationService } from '../telegram/telegram-notification.service';
import { PricingService } from '../pricing/pricing.service';
import { CourierService } from '../courier/courier.service';

export type OrderStatus =
  | 'RECEIVED'
  | 'PENDING'
  | 'CONFIRMED'
  | 'PACKED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'ISSUE';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notification: OrderNotificationService,
    private readonly ctx: ConversationContextService,
    private readonly broadcast: BroadcastService,
    private readonly telegram: TelegramNotificationService,
    private readonly pricing: PricingService,
    @Inject(forwardRef(() => CourierService))
    private readonly courier: CourierService,
  ) {}

  // ── List / Summary ─────────────────────────────────────────────────────────
  async listOrders(pageId?: number, status?: string) {
    const where: any = {};
    if (pageId) where.pageIdRef = pageId;
    if (status && status !== 'ALL') where.status = status.toUpperCase();
    return this.prisma.order.findMany({
      where,
      include: { items: true },
      orderBy: { id: 'desc' },
      take: 500,
    });
  }

  async getSummary(pageId?: number) {
    const where: any = pageId ? { pageIdRef: pageId } : {};
    const orders = await this.prisma.order.findMany({
      where,
      select: { status: true, callStatus: true, negotiationRequested: true },
    });
    return {
      total: orders.length,
      received: orders.filter((o) => ['RECEIVED', 'PENDING'].includes(o.status))
        .length,
      confirmed: orders.filter((o) => o.status === 'CONFIRMED').length,
      cancelled: orders.filter((o) => o.status === 'CANCELLED').length,
      issue: orders.filter((o) => o.status === 'ISSUE').length,
      pendingCalls: orders.filter((o) => o.callStatus === 'PENDING_CALL')
        .length,
      confirmedByCalls: orders.filter(
        (o) => o.callStatus === 'CONFIRMED_BY_CALL',
      ).length,
      negotiated: orders.filter((o) => o.negotiationRequested).length,
    };
  }

  // ── Create ─────────────────────────────────────────────────────────────────
  async createReceivedOrder(data: {
    pageIdRef: number;
    customerPsid: string;
    customerName?: string;
    phone?: string;
    address?: string;
    negotiationRequested?: boolean;
    customerOfferedPrice?: number | null;
    orderNote?: string | null;
    items?: {
      productCode: string;
      qty: number;
      unitPrice: number;
      productName?: string;
    }[];
  }) {
    return this.prisma.order.create({
      data: {
        pageIdRef: data.pageIdRef,
        customerPsid: data.customerPsid,
        customerName: data.customerName || null,
        phone: data.phone || null,
        address: data.address || null,
        status: 'RECEIVED',
        editToken: randomUUID(),
        negotiationRequested: data.negotiationRequested || false,
        customerOfferedPrice: data.customerOfferedPrice ?? null,
        orderNote: data.orderNote ?? null,
        items: {
          create: (data.items || []).map((it) => ({
            productCode: it.productCode,
            qty: it.qty,
            unitPrice: it.unitPrice,
            productName: it.productName,
          })),
        },
      },
      include: { items: true },
    });
  }

  // ── Update info ────────────────────────────────────────────────────────────
  async updateOrderInfo(
    id: number,
    body: {
      customerName?: string;
      phone?: string;
      address?: string;
      orderNote?: string;
      status?: string;
    },
  ) {
    const order = await this.findOrFail(id);
    const patch: any = {};
    if (body.customerName !== undefined) patch.customerName = body.customerName;
    if (body.phone !== undefined) patch.phone = body.phone;
    if (body.address !== undefined) patch.address = body.address;
    if (body.orderNote !== undefined) patch.orderNote = body.orderNote;
    if (Object.keys(patch).length === 0) return order;
    return this.prisma.order.update({
      where: { id },
      data: patch,
      include: { items: true },
    });
  }

  // ── V25: Restaurant BOM — ingredient usage per recipe ──────────────────────
  // sign = -1 deducts (confirm), +1 restores (cancel). Same math both ways so
  // cancel always credits back exactly what confirm consumed. Negative stock
  // is allowed on deduct — a stale ingredient count must never block a real
  // food order; the panel's low-stock badge surfaces the problem instead.
  private async applyIngredientUsage(
    tx: any,
    order: { pageIdRef: number; items?: any[] },
    sign: 1 | -1,
  ): Promise<boolean> {
    let touched = false;
    for (const item of order.items || []) {
      const product = await tx.product.findFirst({
        where: { pageId: order.pageIdRef, code: item.productCode },
        select: { id: true, productType: true },
      });
      if (!product) continue;
      let meta: any = null;
      try {
        meta = item.metaJson ? JSON.parse(item.metaJson) : null;
      } catch {
        meta = null;
      }
      const variantLabel: string | null = meta?.variantLabel ?? null;
      const pieces = Number(meta?.pieces) > 0 ? Number(meta.pieces) : 1;

      // V27: Combo — expand into its component products and deduct each
      // component's own recipe as if it were ordered (comboQty × item.qty)
      // times, instead of looking for a recipe on the combo itself.
      let recipeSources: { productId: number; multiplier: number }[];
      if (product.productType === 'COMBO') {
        const comboItems = await tx.comboItem.findMany({
          where: { comboProductId: product.id },
        });
        recipeSources = comboItems.map((ci: any) => ({
          productId: ci.componentProductId,
          multiplier: ci.qty,
        }));
      } else {
        recipeSources = [{ productId: product.id, multiplier: 1 }];
      }

      for (const src of recipeSources) {
        const rows = await tx.recipeItem.findMany({
          where: {
            productId: src.productId,
            OR: [{ variantLabel: null }, { variantLabel }],
          },
        });
        for (const row of rows) {
          const amount =
            (row.per === 'piece'
              ? row.qty * pieces * item.qty
              : row.qty * item.qty) * src.multiplier;
          if (!amount) continue;
          await tx.ingredient.update({
            where: { id: row.ingredientId },
            data: { stockQty: { increment: sign * amount } },
          });
          touched = true;
        }
      }
    }
    // Per-ORDER packaging (e.g. 1 carry bag) — once, regardless of items
    const page = await tx.page.findUnique({
      where: { id: order.pageIdRef },
      select: { orderPackagingJson: true },
    });
    try {
      const packaging = JSON.parse(page?.orderPackagingJson || '[]');
      if (Array.isArray(packaging)) {
        for (const p of packaging) {
          const ingredientId = Number(p?.ingredientId);
          const qty = Number(p?.qty);
          if (!Number.isFinite(ingredientId) || !(qty > 0)) continue;
          // updateMany: skip silently if the ingredient was deleted meanwhile
          const res = await tx.ingredient.updateMany({
            where: { id: ingredientId, pageId: order.pageIdRef },
            data: { stockQty: { increment: sign * qty } },
          });
          if (res.count > 0) touched = true;
        }
      }
    } catch {
      /* malformed packaging JSON — ignore */
    }
    return touched;
  }

  // ── Confirm (page-scoped, with stock deduction) ────────────────────────────
  async confirmByAgent(id: number, pageId?: number) {
    const order = await this.findOrFail(id, pageId);
    if (order.status === 'CANCELLED')
      throw new BadRequestException('Cancelled order cannot be confirmed');
    if (order.status === 'CONFIRMED')
      return this.prisma.order.findUnique({
        where: { id },
        include: { items: true },
      });

    await this.prisma.$transaction(async (tx) => {
      // Bot-created orders already decrement stock at draft-finalize time —
      // only decrement here if that hasn't happened yet, so confirming an
      // order never removes stock twice.
      if (!order.stockDecremented) {
        for (const item of order.items || []) {
          // Page-scoped product lookup
          const product = await tx.product.findFirst({
            where: { pageId: order.pageIdRef, code: item.productCode },
          });
          if (!product)
            throw new BadRequestException(
              `Product not found: ${item.productCode}`,
            );
          // V25: trackStock=false (restaurant food) — item stock is not
          // tracked; the BOM ingredient deduction below is the real inventory.
          if (product.trackStock === false) continue;
          if (product.stockQty < item.qty) {
            throw new BadRequestException(
              `Not enough stock for ${item.productCode}. Available: ${product.stockQty}`,
            );
          }
          await tx.product.update({
            where: { id: product.id },
            data: { stockQty: { decrement: item.qty } },
          });
        }
      }
      // V25: BOM ingredient deduction (recipes + per-order packaging)
      let ingredientsDeducted = (order as any).ingredientsDeducted === true;
      if (!ingredientsDeducted) {
        ingredientsDeducted = await this.applyIngredientUsage(tx, order, -1);
      }
      await tx.order.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          stockDecremented: true,
          ingredientsDeducted,
        },
      });
    });

    // Fire-and-forget: notify customer via Messenger
    void this.notification.notifyConfirmed(order.pageIdRef, id);

    // Fire-and-forget: send recurring notification subscribe prompt if mode is ON
    void this.tryRecurringSubscribePrompt(order.pageIdRef, order.customerPsid);

    // Fire-and-forget: auto-book courier if the merchant has it enabled —
    // this is the manual/dashboard confirm path, which is how most COD
    // orders actually become CONFIRMED (they start as RECEIVED)
    void this.courier.autoBookOnConfirm(order.pageIdRef, id);

    return this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
  }

  async cancelOrder(id: number, pageId?: number, cancelNote?: string) {
    const order = await this.findOrFail(id, pageId);
    const result = await this.prisma.$transaction(async (tx) => {
      // Restore stock for any reason the order is cancelled — but only if it
      // was actually decremented, so we never over-credit an order that was
      // cancelled before stock was ever reserved (e.g. still RECEIVED and
      // never sent through confirmByAgent).
      if (order.stockDecremented) {
        for (const item of order.items || []) {
          // trackStock=false products were never decremented at confirm
          await tx.product.updateMany({
            where: {
              pageId: order.pageIdRef,
              code: item.productCode,
              trackStock: true,
            },
            data: { stockQty: { increment: item.qty } },
          });
        }
      }
      // V25: restore BOM ingredients exactly as deducted
      if ((order as any).ingredientsDeducted) {
        await this.applyIngredientUsage(tx, order, 1);
      }
      return tx.order.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          stockDecremented: false,
          ingredientsDeducted: false,
          ...(cancelNote !== undefined ? { cancelNote } : {}),
        },
      });
    });
    void this.tryRecurringSubscribePrompt(order.pageIdRef, order.customerPsid);
    void this.notification.notifyCancelled(order.pageIdRef, id, cancelNote);
    const noteStr = cancelNote ? ` কারণ: ${cancelNote}` : '';
    this.telegram
      .notify(order.pageIdRef, `❌ Order #${order.id} cancelled.${noteStr}`)
      .catch(() => {});
    return result;
  }

  private async tryRecurringSubscribePrompt(
    pageId: number,
    psid: string | null,
  ): Promise<void> {
    if (!psid) return;
    try {
      const page = await this.prisma.page.findUnique({
        where: { id: pageId },
        select: { recurringNotifMode: true, pageToken: true },
      });
      if (!page?.recurringNotifMode || !page.pageToken) return;
      await this.broadcast.sendSubscribePrompt(pageId, psid, page.pageToken);
    } catch (e) {
      // silent — non-critical
    }
  }

  async markIssue(id: number, pageId?: number) {
    await this.findOrFail(id, pageId);
    return this.prisma.order.update({
      where: { id },
      data: { status: 'ISSUE' },
    });
  }

  async markDelivered(id: number, pageId?: number) {
    await this.findOrFail(id, pageId);
    return this.prisma.order.update({
      where: { id },
      data: { status: 'DELIVERED', deliveredAt: new Date() },
    });
  }

  // ── Agent Issues ───────────────────────────────────────────────────────────

  async getAgentIssues(pageId?: number) {
    // Type 1: Payment-issue orders (agent_required)
    const orderWhere: any = { paymentStatus: 'agent_required' };
    if (pageId) orderWhere.pageIdRef = pageId;
    const orders = await this.prisma.order.findMany({
      where: orderWhere,
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const orderIssues = await Promise.all(
      orders.map(async (o) => {
        const botMuted = o.customerPsid
          ? await this.ctx.isAgentHandling(o.pageIdRef, o.customerPsid)
          : false;
        let agentHandlingAt: string | null = null;
        let lastCustomerMsg: string | null = null;
        if (o.customerPsid) {
          const sess = await this.prisma.conversationSession.findUnique({
            where: {
              pageIdRef_customerPsid: {
                pageIdRef: o.pageIdRef,
                customerPsid: o.customerPsid,
              },
            },
            select: { agentHandlingAt: true, lastCustomerMsg: true },
          });
          agentHandlingAt = sess?.agentHandlingAt?.toISOString() ?? null;
          lastCustomerMsg = sess?.lastCustomerMsg ?? null;
        }
        return {
          ...o,
          botMuted,
          issueType: 'payment' as const,
          agentHandlingAt,
          lastCustomerMsg,
        };
      }),
    );

    // Type 2: Unmatched-message customers (agentHandling=true, no payment-issue order)
    const sessionWhere: any = { agentHandling: true };
    if (pageId) sessionWhere.pageIdRef = pageId;
    const flaggedSessions = await this.prisma.conversationSession.findMany({
      where: sessionWhere,
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });

    // Filter out PSIDs already covered by payment-issue orders
    const paymentPsids = new Set(orders.map((o) => o.customerPsid));
    const unmatchedSessions = flaggedSessions.filter(
      (s) => !paymentPsids.has(s.customerPsid),
    );

    // Enrich with CRM data
    const unmatchedIssues = await Promise.all(
      unmatchedSessions.map(async (s) => {
        const crm = pageId
          ? await this.prisma.customer.findUnique({
              where: { pageId_psid: { pageId, psid: s.customerPsid } },
              select: { name: true, phone: true },
            })
          : null;
        return {
          id: null as number | null,
          pageIdRef: s.pageIdRef,
          customerPsid: s.customerPsid,
          customerName: crm?.name ?? null,
          phone: crm?.phone ?? null,
          address: null,
          status: 'RECEIVED',
          orderNote: '🤖 Bot বুঝতে পারেনি — agent review দরকার',
          paymentStatus: 'unmatched',
          createdAt: s.updatedAt.toISOString(),
          agentHandlingAt: s.agentHandlingAt?.toISOString() ?? null,
          lastCustomerMsg: s.lastCustomerMsg ?? null,
          items: [],
          botMuted: true,
          issueType: 'unmatched' as const,
        };
      }),
    );

    return [...orderIssues, ...unmatchedIssues];
  }

  async toggleBotForCustomer(orderId: number, pageId?: number) {
    const order = await this.findOrFail(orderId, pageId);
    if (!order.customerPsid) return { botMuted: false };
    const current = await this.ctx.isAgentHandling(
      order.pageIdRef,
      order.customerPsid,
    );
    await this.ctx.setAgentHandling(
      order.pageIdRef,
      order.customerPsid,
      !current,
    );
    return { botMuted: !current };
  }

  async toggleBotByPsid(pageId: number, psid: string, mute: boolean) {
    await this.ctx.setAgentHandling(pageId, psid, mute);
    return { botMuted: mute };
  }

  /**
   * Dismiss an agent issue — removes it from the issues list.
   * payment type: resets paymentStatus to 'not_required' (agent handled manually)
   * unmatched type: clears agentHandling=false so bot can resume
   */
  async dismissAgentIssue(
    pageId: number,
    body: {
      issueType: 'payment' | 'unmatched';
      orderId?: number;
      psid?: string;
    },
  ) {
    if (body.issueType === 'payment' && body.orderId) {
      const order = await this.findOrFail(body.orderId, pageId);
      await this.prisma.order.update({
        where: { id: order.id },
        data: { paymentStatus: 'not_required' },
      });
      // Also clear agentHandling if set
      if (order.customerPsid) {
        await this.ctx.setAgentHandling(pageId, order.customerPsid, false);
      }
      return { dismissed: true };
    }

    if (body.issueType === 'unmatched' && body.psid) {
      await this.ctx.setAgentHandling(pageId, body.psid, false);
      return { dismissed: true };
    }

    return { dismissed: false };
  }

  // ── Payment Proof Review ────────────────────────────────────────────────────

  async getPaymentProofs(pageId?: number) {
    const where: any = {
      paymentStatus: 'advance_paid',
    };
    if (pageId) where.pageIdRef = pageId;
    return this.prisma.order.findMany({
      where,
      select: {
        id: true,
        pageIdRef: true,
        customerName: true,
        phone: true,
        address: true,
        paymentStatus: true,
        paymentVerifyStatus: true,
        transactionId: true,
        paymentScreenshotUrl: true,
        orderNote: true,
        createdAt: true,
        items: { select: { productCode: true, qty: true, unitPrice: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  }

  async verifyPayment(
    id: number,
    status: 'verified' | 'verify_failed',
    pageId?: number,
  ) {
    const order = await this.findOrFail(id, pageId);
    if (order.paymentStatus !== 'advance_paid') {
      throw new BadRequestException('Order has no advance payment proof');
    }

    // When verified → also confirm the order and notify customer
    if (status === 'verified') {
      const updated = await this.prisma.order.update({
        where: { id },
        data: {
          paymentVerifyStatus: 'verified',
          status: 'CONFIRMED',
          confirmedAt: new Date(),
        },
      });
      void this.notification.notifyConfirmed(order.pageIdRef, id);
      this.telegram
        .notify(order.pageIdRef, `✅ Payment verified & Order #${id} confirmed!\n👤 ${order.customerName} | 📞 ${order.phone ?? '-'}`)
        .catch(() => {});
      void this.courier.autoBookOnConfirm(order.pageIdRef, id);
      return updated;
    }

    return this.prisma.order.update({
      where: { id },
      data: { paymentVerifyStatus: status },
    });
  }

  // ── Web Order Methods ──────────────────────────────────────────────────────

  async createWebOrder(data: {
    pageIdRef: number;
    customerName: string;
    phone: string;
    address: string;
    orderNote?: string;
    items: {
      productCode: string;
      qty: number;
      unitPrice: number;
      productName?: string;
      metaJson?: string | null;
    }[];
    paymentMode: string;
    // V24: Restaurant mode — computed server-side by the catalog controller
    deliveryLat?: number;
    deliveryLng?: number;
    deliveryFee?: number;
    deliveryDistanceKm?: number;
  }) {
    const psid = `WEB-${data.phone.replace(/\D/g, '')}`;
    const paymentStatus =
      data.paymentMode === 'cod' ? 'not_required' : 'pending_proof';
    const subtotal = data.items.reduce((s, it) => s + it.unitPrice * it.qty, 0);
    const [discounts, isCombo] = await Promise.all([
      this.pricing.computeDiscounts(data.pageIdRef, data.phone, subtotal),
      this.pricing.isComboOrder(data.pageIdRef, data.items.map((it) => it.productCode.toUpperCase())),
    ]);
    const { thisOrderNumber, rewards } = await this.pricing.getMilestoneRewards(
      data.pageIdRef,
      data.phone,
      isCombo,
    );
    const extraItems: typeof data.items = rewards
      .filter((r) => r.rewardType === 'FREE_ITEM' && r.productCode)
      .map((r) => ({ productCode: r.productCode!, qty: r.qty, unitPrice: 0, productName: `🎁 Free — ${r.productName}`, metaJson: null }));
    const freeDelivery = rewards.some((r) => r.rewardType === 'FREE_DELIVERY');
    const milestoneDiscountAmount = this.pricing.computeMilestoneDiscount(rewards, subtotal);

    return this.prisma.order.create({
      data: {
        pageIdRef: data.pageIdRef,
        customerPsid: psid,
        customerName: data.customerName,
        phone: data.phone,
        address: data.address,
        status: 'RECEIVED',
        editToken: randomUUID(),
        source: 'WEBSITE',
        orderNote: data.orderNote ?? null,
        paymentStatus,
        deliveryLat: data.deliveryLat ?? null,
        deliveryLng: data.deliveryLng ?? null,
        deliveryFee: freeDelivery ? 0 : (data.deliveryFee ?? null),
        deliveryDistanceKm: data.deliveryDistanceKm ?? null,
        loyaltyDiscountAmount: discounts.loyaltyDiscount,
        happyHourDiscountAmount: discounts.happyHourDiscount,
        milestoneDiscountAmount,
        milestoneRewardAppliedJson: rewards.length
          ? JSON.stringify(rewards.map((r) => ({ ...r, orderNumber: thisOrderNumber })))
          : null,
        items: {
          create: [...data.items, ...extraItems].map((it) => ({
            productCode: it.productCode,
            qty: it.qty,
            unitPrice: it.unitPrice,
            productName: it.productName ?? null,
            metaJson: it.metaJson ?? null,
          })),
        },
      },
      include: { items: true },
    });
  }

  async confirmWebOrderPayment(orderId: number, pageIdRef: number) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, pageIdRef },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    const updated = await this.prisma.$transaction(async (tx) => {
      // V25: BOM ingredient deduction — this path confirms without going
      // through confirmByAgent, so restaurant recipes must deduct here too.
      let ingredientsDeducted = (order as any).ingredientsDeducted === true;
      if (!ingredientsDeducted) {
        ingredientsDeducted = await this.applyIngredientUsage(tx, order, -1);
      }
      return tx.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: 'advance_paid',
          paymentVerifyStatus: 'verified',
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          ingredientsDeducted,
        },
      });
    });
    void this.courier.autoBookOnConfirm(pageIdRef, orderId);
    return updated;
  }

  async uploadWebOrderScreenshot(
    orderId: number,
    pageIdRef: number,
    file: any,
    transactionId?: string,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, pageIdRef },
      select: { id: true, paymentStatus: true, customerName: true, phone: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.paymentStatus !== 'pending_proof') {
      throw new BadRequestException('Payment proof not expected for this order');
    }

    // Send screenshot to merchant's Telegram instead of storing on server
    const caption = `📸 Payment Screenshot\nOrder #${orderId}${transactionId ? `\nTxID: ${transactionId}` : ''}\nCustomer: ${order.customerName ?? '?'} | ${order.phone ?? '?'}`;
    void this.telegram.sendPhoto(pageIdRef, file.buffer, caption).catch(() => {});
    // sendPhoto can't carry inline buttons — follow up with an approve/reject
    // message so the merchant can verify without opening the dashboard.
    void this.telegram
      .notifyWithButtons(
        pageIdRef,
        `💳 <b>Payment Proof — Order #${orderId}</b>\n👤 ${order.customerName ?? '?'} | 📞 ${order.phone ?? '?'}${transactionId ? `\n🔖 TrxID: <code>${transactionId}</code>` : ''}\n\nউপরের screenshot দেখে verify করুন:`,
        [
          [
            { text: '✅ Payment Approve', callback_data: `payok_${orderId}` },
            { text: '❌ Payment Reject', callback_data: `payfail_${orderId}` },
          ],
        ],
      )
      .catch(() => {});

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: 'advance_paid',
        paymentScreenshotUrl: 'telegram',
        transactionId: transactionId ?? null,
        paymentVerifyStatus: 'pending_review',
      },
    });
  }

  async getWebOrderStatus(orderId: number, pageIdRef: number) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, pageIdRef },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        createdAt: true,
        items: {
          select: {
            productCode: true,
            qty: true,
            productName: true,
            unitPrice: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    const statusMap: Record<string, string> = {
      RECEIVED: '✅ অর্ডার পাওয়া হয়েছে — প্রক্রিয়া চলছে',
      PENDING: '⏳ অর্ডার পেন্ডিং আছে',
      CONFIRMED: '✅ অর্ডার কনফার্ম হয়েছে — প্রস্তুত হচ্ছে',
      PACKED: '📦 অর্ডার প্যাক হয়ে গেছে — শীঘ্রই কুরিয়ারে যাবে',
      DELIVERED: '🎉 ডেলিভারি সম্পন্ন হয়েছে',
      CANCELLED: '❌ অর্ডারটি বাতিল হয়েছে',
      ISSUE: '⚠️ অর্ডারে সমস্যা আছে — আমাদের সাথে যোগাযোগ করুন',
    };
    return { ...order, statusBn: statusMap[order.status] ?? order.status };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  async findOrFail(id: number, pageId?: number) {
    const order: any = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (pageId && order.pageIdRef !== pageId)
      throw new NotFoundException('Order not found');
    return order;
  }
}
