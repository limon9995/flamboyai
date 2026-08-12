import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentVerifyService } from '../payment-verify/payment-verify.service';
import { MessengerService } from '../messenger/messenger.service';
import {
  aggregateMetrics,
  computeProfits,
  RawMetrics,
  ComputedProfits,
} from './profit-engine';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface AccountingOverview extends RawMetrics, ComputedProfits {
  currency: string;
  confirmedOrders: number;
  returnCount: number;
  exchangeCount: number;
}

export interface DailyPoint {
  date: string;
  revenue: number;
  collection: number;
  expense: number;
}
export interface CategoryBreakdown {
  category: string;
  amount: number;
}
export interface OrderStatusDist {
  status: string;
  count: number;
}

@Injectable()
export class AccountingService {
  private readonly logger = new Logger(AccountingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentVerify: PaymentVerifyService,
    private readonly messenger: MessengerService,
  ) {}

  // ── Overview ──────────────────────────────────────────────────────────────

  async getOverview(pageId: number): Promise<AccountingOverview> {
    const page = await this.prisma.page.findUnique({ where: { id: pageId } });
    if (!page) throw new NotFoundException('Page not found');

    const [
      confirmedOrders,
      collections,
      expenses,
      returnEntries,
      exchangeEntries,
      deliveredCourierShipments,
    ] = await Promise.all([
      this.prisma.order.findMany({
        where: { pageIdRef: pageId, status: { in: ['CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED'] } },
        include: { items: true },
      }),
      this.prisma.collection.findMany({ where: { pageId } }),
      this.prisma.expense.findMany({ where: { pageId } }),
      this.prisma.returnEntry.findMany({ where: { pageId } }),
      this.prisma.exchangeEntry.findMany({ where: { pageId } }),
      this.prisma.courierShipment.findMany({
        where: { order: { pageIdRef: pageId }, status: 'delivered' },
        select: { courierFee: true },
      }),
    ]);

    const costMap = await this.buildCostMap(pageId);
    const allItems = confirmedOrders.flatMap((o) => o.items);

    // ── Uses ProfitEngine — no formula duplication ─────────────────────────
    const raw = aggregateMetrics({
      confirmedOrderItems: allItems,
      costMap,
      collections,
      expenses,
      returnEntries,
      exchangeEntries,
      deliveredCourierShipments,
    });
    const derived = computeProfits(raw);

    return {
      currency: page.currencySymbol || '৳',
      ...raw,
      ...derived,
      confirmedOrders: confirmedOrders.length,
      returnCount: returnEntries.length,
      exchangeCount: exchangeEntries.length,
    };
  }

  // ── Ranged overview (used by reports + analytics) ─────────────────────────

  async getOverviewForRange(
    pageId: number,
    from: Date,
    to: Date,
  ): Promise<AccountingOverview> {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { currencySymbol: true },
    });

    const [
      confirmedOrders,
      collections,
      expenses,
      returnEntries,
      exchangeEntries,
      deliveredCourierShipments,
    ] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          pageIdRef: pageId,
          status: { in: ['CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED'] },
          confirmedAt: { gte: from, lte: to },
        },
        include: { items: true },
      }),
      this.prisma.collection.findMany({
        where: { pageId, collectedAt: { gte: from, lte: to } },
      }),
      this.prisma.expense.findMany({
        where: { pageId, spentAt: { gte: from, lte: to } },
      }),
      this.prisma.returnEntry.findMany({
        where: { pageId, createdAt: { gte: from, lte: to } },
      }),
      this.prisma.exchangeEntry.findMany({
        where: { pageId, createdAt: { gte: from, lte: to } },
      }),
      this.prisma.courierShipment.findMany({
        where: {
          order: { pageIdRef: pageId },
          status: 'delivered',
          deliveredAt: { gte: from, lte: to },
        },
        select: { courierFee: true },
      }),
    ]);

    const costMap = await this.buildCostMap(pageId);
    const allItems = confirmedOrders.flatMap((o) => o.items);

    // ── Uses ProfitEngine ──────────────────────────────────────────────────
    const raw = aggregateMetrics({
      confirmedOrderItems: allItems,
      costMap,
      collections,
      expenses,
      returnEntries,
      exchangeEntries,
      deliveredCourierShipments,
    });
    const derived = computeProfits(raw);

    return {
      currency: page?.currencySymbol || '৳',
      ...raw,
      ...derived,
      confirmedOrders: confirmedOrders.length,
      returnCount: returnEntries.length,
      exchangeCount: exchangeEntries.length,
    };
  }

  // ── Chart Data ─────────────────────────────────────────────────────────────

  async getDailyTrend(pageId: number, days = 30): Promise<DailyPoint[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [orders, collections, expenses] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          pageIdRef: pageId,
          status: { in: ['CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED'] },
          confirmedAt: { gte: since },
        },
        include: { items: true },
      }),
      this.prisma.collection.findMany({
        where: { pageId, collectedAt: { gte: since } },
      }),
      this.prisma.expense.findMany({
        where: { pageId, spentAt: { gte: since } },
      }),
    ]);

    const map = new Map<string, DailyPoint>();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    for (let i = 0; i <= days; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      const k = fmt(d);
      map.set(k, { date: k, revenue: 0, collection: 0, expense: 0 });
    }
    for (const o of orders) {
      const k = fmt(new Date(o.confirmedAt ?? o.createdAt));
      const p = map.get(k);
      if (p) p.revenue += o.items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
    }
    for (const c of collections) {
      const k = fmt(new Date(c.collectedAt));
      const p = map.get(k);
      if (p) p.collection += c.amount;
    }
    for (const e of expenses) {
      const k = fmt(new Date(e.spentAt));
      const p = map.get(k);
      if (p) p.expense += e.amount;
    }
    return Array.from(map.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  }

  async getExpenseBreakdown(pageId: number): Promise<CategoryBreakdown[]> {
    const expenses = await this.prisma.expense.findMany({ where: { pageId } });
    const map = new Map<string, number>();
    for (const e of expenses)
      map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
    return Array.from(map.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  }

  async getOrderStatusDist(pageId: number): Promise<OrderStatusDist[]> {
    const orders = await this.prisma.order.findMany({
      where: { pageIdRef: pageId },
      select: { status: true },
    });
    const map = new Map<string, number>();
    for (const o of orders) map.set(o.status, (map.get(o.status) ?? 0) + 1);
    return Array.from(map.entries()).map(([status, count]) => ({
      status,
      count,
    }));
  }

  async getPlatformDist(pageId: number): Promise<{ platform: string; count: number; revenue: number }[]> {
    const orders = await this.prisma.order.findMany({
      where: { pageIdRef: pageId },
      select: { source: true, items: { select: { unitPrice: true, qty: true } } },
    });
    const map = new Map<string, { count: number; revenue: number }>();
    for (const o of orders) {
      const platform = (o.source || 'FACEBOOK').toUpperCase();
      const revenue = o.items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
      const cur = map.get(platform) ?? { count: 0, revenue: 0 };
      map.set(platform, { count: cur.count + 1, revenue: cur.revenue + revenue });
    }
    return Array.from(map.entries()).map(([platform, v]) => ({ platform, ...v }));
  }

  // ── Collections ────────────────────────────────────────────────────────────

  async addCollection(
    pageId: number,
    dto: {
      orderId?: number;
      type: string;
      method: string;
      amount: number;
      note?: string;
      collectedAt?: string;
    },
  ) {
    this.validateStrictlyPositive(dto.amount, 'amount');
    if (dto.orderId) await this.ensureOrderOwnership(pageId, dto.orderId);
    return this.prisma.collection.create({
      data: {
        pageId,
        orderId: dto.orderId ?? null,
        type: dto.type || 'full_payment',
        method: dto.method || 'cash',
        amount: dto.amount,
        note: dto.note ?? null,
        collectedAt: dto.collectedAt ? new Date(dto.collectedAt) : new Date(),
      },
    });
  }

  async listCollections(pageId: number, from?: string, to?: string) {
    const where: any = { pageId };
    if (from || to) {
      where.collectedAt = {};
      if (from) where.collectedAt.gte = new Date(from);
      if (to) where.collectedAt.lte = new Date(to);
    }
    return this.prisma.collection.findMany({
      where,
      orderBy: { collectedAt: 'desc' },
      take: 500,
      include: { order: { select: { id: true, customerName: true } } },
    });
  }

  async deleteCollection(pageId: number, id: number) {
    await this.ensureCollectionOwnership(pageId, id);
    await this.prisma.collection.delete({ where: { id } });
    return { success: true };
  }

  // ── Expenses ──────────────────────────────────────────────────────────────

  async addExpense(
    pageId: number,
    dto: {
      orderId?: number;
      category: string;
      amount: number;
      note?: string;
      spentAt?: string;
    },
  ) {
    this.validateStrictlyPositive(dto.amount, 'amount');
    if (dto.orderId) await this.ensureOrderOwnership(pageId, dto.orderId);
    return this.prisma.expense.create({
      data: {
        pageId,
        orderId: dto.orderId ?? null,
        category: dto.category || 'misc',
        amount: dto.amount,
        note: dto.note ?? null,
        spentAt: dto.spentAt ? new Date(dto.spentAt) : new Date(),
      },
    });
  }

  async listExpenses(pageId: number, from?: string, to?: string) {
    const where: any = { pageId };
    if (from || to) {
      where.spentAt = {};
      if (from) where.spentAt.gte = new Date(from);
      if (to) where.spentAt.lte = new Date(to);
    }
    return this.prisma.expense.findMany({
      where,
      orderBy: { spentAt: 'desc' },
      take: 500,
      include: { order: { select: { id: true, customerName: true } } },
    });
  }

  async deleteExpense(pageId: number, id: number) {
    await this.ensureExpenseOwnership(pageId, id);
    await this.prisma.expense.delete({ where: { id } });
    return { success: true };
  }

  // ── Returns ───────────────────────────────────────────────────────────────

  async addReturn(
    pageId: number,
    dto: {
      orderId: number;
      returnType: string;
      refundAmount: number;
      returnCost: number;
      note?: string;
    },
  ) {
    await this.ensureOrderOwnership(pageId, dto.orderId);
    this.validateNonNegative(dto.refundAmount, 'refundAmount');
    this.validateNonNegative(dto.returnCost, 'returnCost');
    return this.prisma.returnEntry.create({
      data: {
        pageId,
        orderId: dto.orderId,
        returnType: dto.returnType || 'full',
        refundAmount: dto.refundAmount,
        returnCost: dto.returnCost,
        note: dto.note ?? null,
      },
    });
  }

  async listReturns(pageId: number) {
    return this.prisma.returnEntry.findMany({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
      include: {
        order: {
          select: {
            id: true,
            customerName: true,
            items: {
              select: {
                id: true,
                productCode: true,
                qty: true,
                unitPrice: true,
              },
            },
            courierShipment: { select: { status: true, courierName: true } },
          },
        },
      },
    });
  }

  async resolvePartialItems(
    pageId: number,
    returnId: number,
    items: {
      orderItemId: number;
      qty: number;
      unitPrice: number;
      restock: boolean;
    }[],
  ) {
    const entry = await this.prisma.returnEntry.findUnique({
      where: { id: returnId },
      include: { order: { select: { pageIdRef: true } } },
    });
    if (!entry || entry.order.pageIdRef !== pageId)
      throw new Error('Return entry not found');
    if (entry.returnType !== 'partial')
      throw new Error('Not a partial return entry');

    const refundAmount = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);

    // Update return entry with calculated refund amount
    await this.prisma.returnEntry.update({
      where: { id: returnId },
      data: { refundAmount, refundStatus: 'pending' },
    });

    // Restock selected items
    for (const item of items.filter((i) => i.restock)) {
      const orderItem = await this.prisma.orderItem.findUnique({
        where: { id: item.orderItemId },
        select: { productCode: true },
      });
      if (!orderItem) continue;
      await this.prisma.product.updateMany({
        where: { pageId, code: orderItem.productCode },
        data: { stockQty: { increment: item.qty } },
      });
    }

    return this.prisma.returnEntry.findUnique({ where: { id: returnId } });
  }

  // ── Advance Refund Queue ──────────────────────────────────────────────────

  async getRefundQueue(pageId: number) {
    // Returns where customer paid advance AND refund not yet given
    return this.prisma.returnEntry.findMany({
      where: {
        pageId,
        refundStatus: { in: ['pending', 'given'] },
        order: { collections: { some: { type: 'advance' } } },
      },
      include: {
        order: {
          include: {
            collections: {
              where: { type: 'advance' },
              orderBy: { collectedAt: 'asc' },
            },
            courierShipment: {
              select: { status: true, trackingId: true, courierName: true },
            },
            items: {
              select: { productCode: true, qty: true, unitPrice: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async confirmRefund(pageId: number, returnId: number, givenAmount: number) {
    return this.initiateRefund(pageId, returnId, {
      method: 'bkash_manual',
      givenAmount,
    });
  }

  async initiateRefund(
    pageId: number,
    returnId: number,
    dto: {
      method: string;
      givenAmount: number;
      phoneNumber?: string;
    },
  ) {
    const entry = await this.prisma.returnEntry.findUnique({
      where: { id: returnId },
      include: {
        order: {
          select: {
            pageIdRef: true,
            id: true,
            customerName: true,
            customerPsid: true,
            phone: true,
          },
        },
      },
    });
    if (!entry || entry.order.pageIdRef !== pageId)
      throw new NotFoundException('Return entry not found');
    this.validateNonNegative(dto.givenAmount, 'givenAmount');

    const isAuto = dto.method === 'bkash_auto' || dto.method === 'nagad_auto';
    const phone = dto.phoneNumber || entry.order.phone || '';
    const reference = `refund-order-${entry.order.id}`;

    let gatewayTxId: string | undefined;
    let failReason: string | undefined;

    if (isAuto) {
      const result = dto.method === 'bkash_auto'
        ? await this.paymentVerify.refundViaBkash(pageId, dto.givenAmount, phone, reference)
        : await this.paymentVerify.refundViaNagad(pageId, dto.givenAmount, phone, reference);

      if (result.success) {
        gatewayTxId = result.txId;
      } else {
        failReason = result.errorMessage;
        // auto failed — save the failure, keep status pending so merchant can retry manually
        await this.prisma.returnEntry.update({
          where: { id: returnId },
          data: {
            refundMethod: dto.method,
            refundPhoneNumber: phone || null,
            refundInitiatedAt: new Date(),
            refundFailReason: failReason,
          },
        });
        return {
          success: false,
          errorMessage: failReason,
          entry: await this.prisma.returnEntry.findUnique({ where: { id: returnId } }),
        };
      }
    }

    const updated = await this.prisma.returnEntry.update({
      where: { id: returnId },
      data: {
        refundStatus: 'given',
        refundGivenAt: new Date(),
        refundGivenAmount: dto.givenAmount,
        refundMethod: dto.method,
        refundPhoneNumber: phone || null,
        refundGatewayTxId: gatewayTxId ?? null,
        refundInitiatedAt: new Date(),
        refundFailReason: null,
      },
    });

    // Notify customer via Messenger (fire-and-forget)
    void this.sendRefundNotification(entry.order, dto.givenAmount, dto.method, gatewayTxId);

    return { success: true, gatewayTxId, entry: updated };
  }

  private async sendRefundNotification(
    order: { customerPsid: string; id: number; customerName?: string | null; pageIdRef: number },
    amount: number,
    method: string,
    gatewayTxId?: string,
  ) {
    if (!order.customerPsid || order.customerPsid === 'WEB') return;

    const page = await this.prisma.page.findUnique({
      where: { id: order.pageIdRef },
      select: { pageId: true, currencySymbol: true },
    });
    if (!page) return;

    const cur = page.currencySymbol || '৳';
    const methodLabel: Record<string, string> = {
      bkash_auto: 'bKash (Auto)',
      nagad_auto: 'Nagad (Auto)',
      bkash_manual: 'bKash',
      nagad_manual: 'Nagad',
      cash: 'নগদ (Cash)',
      bank: 'Bank Transfer',
    };
    const label = methodLabel[method] || method;

    let msg = `✅ আপনার রিফান্ড সম্পন্ন হয়েছে!\n`;
    msg += `💰 পরিমাণ: ${cur}${amount}\n`;
    msg += `📱 মাধ্যম: ${label}\n`;
    if (gatewayTxId) msg += `🔖 TxID: ${gatewayTxId}\n`;
    msg += `📦 অর্ডার #${order.id}`;

    try {
      await this.messenger.sendText(page.pageId, order.customerPsid, msg);
    } catch (err) {
      this.logger.warn(`[Accounting] Refund notification failed for order ${order.id}: ${err.message}`);
    }
  }

  async markRefundNotApplicable(pageId: number, returnId: number) {
    const entry = await this.prisma.returnEntry.findUnique({
      where: { id: returnId },
      include: { order: { select: { pageIdRef: true } } },
    });
    if (!entry || entry.order.pageIdRef !== pageId)
      throw new NotFoundException('Return entry not found');
    return this.prisma.returnEntry.update({
      where: { id: returnId },
      data: { refundStatus: 'not_applicable' },
    });
  }

  async getRefundSummary(pageId: number) {
    const [pending, given] = await Promise.all([
      this.prisma.returnEntry.count({
        where: {
          pageId,
          refundStatus: 'pending',
          order: { collections: { some: { type: 'advance' } } },
        },
      }),
      this.prisma.returnEntry.aggregate({
        where: { pageId, refundStatus: 'given' },
        _sum: { refundGivenAmount: true },
        _count: true,
      }),
    ]);
    return {
      pendingCount: pending,
      givenCount: given._count,
      totalGiven: given._sum.refundGivenAmount ?? 0,
    };
  }

  // ── Exchanges ─────────────────────────────────────────────────────────────

  async addExchange(
    pageId: number,
    dto: {
      orderId: number;
      extraCharge: number;
      refundAdjustment: number;
      note?: string;
    },
  ) {
    await this.ensureOrderOwnership(pageId, dto.orderId);
    this.validateNonNegative(dto.extraCharge, 'extraCharge');
    this.validateNonNegative(dto.refundAdjustment, 'refundAdjustment');
    return this.prisma.exchangeEntry.create({
      data: {
        pageId,
        orderId: dto.orderId,
        extraCharge: dto.extraCharge,
        refundAdjustment: dto.refundAdjustment,
        note: dto.note ?? null,
      },
    });
  }

  async listExchanges(pageId: number) {
    return this.prisma.exchangeEntry.findMany({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
      include: { order: { select: { id: true, customerName: true } } },
    });
  }

  // ── Reports ───────────────────────────────────────────────────────────────

  async getReport(pageId: number, period: 'daily' | 'weekly' | 'monthly') {
    const { from, to, label } = this.periodRange(period);
    const [overview, trend, topProducts] = await Promise.all([
      this.getOverviewForRange(pageId, from, to),
      this.getDailyTrend(
        pageId,
        period === 'daily' ? 1 : period === 'weekly' ? 7 : 30,
      ),
      this.getTopProducts(pageId, from, to),
    ]);
    const biggestExpenseCat = await this.getExpenseBreakdown(pageId).then(
      (cats) => cats[0] ?? null,
    );
    return {
      period,
      label,
      from: from.toISOString(),
      to: to.toISOString(),
      overview,
      trend,
      topProducts,
      biggestExpenseCat,
    };
  }

  async getTopProducts(pageId: number, from?: Date, to?: Date, limit = 5) {
    const where: any = { pageIdRef: pageId, status: { in: ['CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED'] } };
    if (from || to) {
      where.confirmedAt = {};
      if (from) where.confirmedAt.gte = from;
      if (to) where.confirmedAt.lte = to;
    }
    const orders = await this.prisma.order.findMany({
      where,
      include: { items: true },
    });
    const map = new Map<
      string,
      { code: string; qty: number; revenue: number }
    >();
    for (const o of orders) {
      for (const i of o.items) {
        const cur = map.get(i.productCode) ?? {
          code: i.productCode,
          qty: 0,
          revenue: 0,
        };
        cur.qty += i.qty;
        cur.revenue += i.unitPrice * i.qty;
        map.set(i.productCode, cur);
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);
  }

  // ── Export ────────────────────────────────────────────────────────────────

  async getExportData(
    pageId: number,
    type: 'collections' | 'expenses' | 'returns' | 'exchanges' | 'summary',
  ) {
    switch (type) {
      case 'collections':
        return { type, rows: await this.listCollections(pageId) };
      case 'expenses':
        return { type, rows: await this.listExpenses(pageId) };
      case 'returns':
        return { type, rows: await this.listReturns(pageId) };
      case 'exchanges':
        return { type, rows: await this.listExchanges(pageId) };
      case 'summary':
        return { type, overview: await this.getOverview(pageId) };
    }
  }

  async buildReportHtml(
    pageId: number,
    period: 'daily' | 'weekly' | 'monthly',
  ): Promise<string> {
    const report = await this.getReport(pageId, period);
    const page = await this.prisma.page.findUnique({ where: { id: pageId } });
    const ov = report.overview;
    const cur = ov.currency;
    const fmt = (n: number) =>
      `${cur}${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    const profitColor = ov.estimatedNetProfit >= 0 ? '#16a34a' : '#dc2626';
    const profitLabel =
      ov.estimatedNetProfit >= 0
        ? 'Estimated Net Profit'
        : 'Estimated Net Loss';
    const topProdsHtml = report.topProducts.length
      ? report.topProducts
          .map(
            (p, i) =>
              `<tr><td>${i + 1}</td><td>${p.code}</td><td>${p.qty}</td><td>${fmt(p.revenue)}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="4" style="color:#94a3b8">No confirmed orders in this period</td></tr>';

    return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#111;background:#fff;padding:32px}
  h1{font-size:22px;font-weight:800;color:#1e293b;margin-bottom:4px}
  .meta{font-size:12px;color:#64748b;margin-bottom:28px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:28px}
  .card{border:1px solid #e2e8f0;border-radius:10px;padding:14px 18px}
  .card .val{font-size:22px;font-weight:800}
  .card .lbl{font-size:11px;color:#64748b;margin-top:3px;text-transform:uppercase;letter-spacing:.05em}
  .section-title{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin:22px 0 10px}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;padding:8px 10px;font-size:11px;background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#64748b;text-transform:uppercase}
  td{padding:9px 10px;border-bottom:1px solid #f1f5f9;font-size:12px}
  .highlight{background:#f0fdf4}
  footer{margin-top:32px;font-size:11px;color:#94a3b8;text-align:center}
</style>
</head><body>
<h1>📊 ${report.period.charAt(0).toUpperCase() + report.period.slice(1)} Report — ${page?.pageName || ''}</h1>
<div class="meta">Period: ${report.label} &nbsp;|&nbsp; Generated: ${new Date().toLocaleString()}</div>
<div class="grid">
  <div class="card"><div class="val">${fmt(ov.estimatedRevenue)}</div><div class="lbl">Est. Revenue</div></div>
  <div class="card"><div class="val">${fmt(ov.totalCollection)}</div><div class="lbl">Collected</div></div>
  <div class="card"><div class="val" style="color:#dc2626">${fmt(ov.totalDue)}</div><div class="lbl">Due</div></div>
  <div class="card"><div class="val">${fmt(ov.totalExpenses)}</div><div class="lbl">Expenses</div></div>
  <div class="card"><div class="val">${fmt(ov.totalRefunds)}</div><div class="lbl">Return Refunds</div></div>
  <div class="card highlight"><div class="val" style="color:${profitColor}">${fmt(Math.abs(ov.estimatedNetProfit))}</div><div class="lbl">${profitLabel}</div></div>
</div>
<div class="section-title">Top Selling Products</div>
<table><thead><tr><th>#</th><th>Code</th><th>Qty</th><th>Revenue</th></tr></thead><tbody>${topProdsHtml}</tbody></table>
${report.biggestExpenseCat ? `<div class="section-title">Biggest Expense Category</div><p style="font-size:13px">${report.biggestExpenseCat.category} — ${fmt(report.biggestExpenseCat.amount)}</p>` : ''}
<div class="section-title">Daily Trend (Last ${report.trend.length} days)</div>
<table><thead><tr><th>Date</th><th>Revenue</th><th>Collected</th><th>Expenses</th></tr></thead><tbody>
  ${report.trend
    .slice(-14)
    .map(
      (d) =>
        `<tr><td>${d.date}</td><td>${fmt(d.revenue)}</td><td>${fmt(d.collection)}</td><td>${fmt(d.expense)}</td></tr>`,
    )
    .join('')}
</tbody></table>
<footer>FlamboyAI V6 — Accounting Report | ${page?.businessName || page?.pageName || ''}</footer>
</body></html>`;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  async buildCostMap(pageId: number): Promise<Map<string, number>> {
    const prods = await this.prisma.product.findMany({
      where: { pageId },
      select: { code: true, costPrice: true },
    });
    return new Map(prods.map((p) => [p.code, p.costPrice ?? 0]));
  }

  async getReportCustom(pageId: number, from: Date, to: Date) {
    const days = Math.max(
      1,
      Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)),
    );
    const label = `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`;
    const [overview, trend, topProducts] = await Promise.all([
      this.getOverviewForRange(pageId, from, to),
      this.getDailyTrend(pageId, days),
      this.getTopProducts(pageId, from, to),
    ]);
    const biggestExpenseCat = await this.getExpenseBreakdown(pageId).then(
      (cats) => cats[0] ?? null,
    );
    return {
      period: 'custom',
      label,
      from: from.toISOString(),
      to: to.toISOString(),
      overview,
      trend,
      topProducts,
      biggestExpenseCat,
    };
  }

  periodRange(period: 'daily' | 'weekly' | 'monthly') {
    const to = new Date();
    const from = new Date();
    if (period === 'daily') {
      from.setDate(from.getDate() - 1);
      return { from, to, label: 'Last 24 hours' };
    }
    if (period === 'weekly') {
      from.setDate(from.getDate() - 7);
      return { from, to, label: 'Last 7 days' };
    }
    from.setDate(from.getDate() - 30);
    return { from, to, label: 'Last 30 days' };
  }

  private validateStrictlyPositive(val: number, field: string) {
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0)
      throw new BadRequestException(`${field} must be greater than 0`);
  }
  private validateNonNegative(val: number, field: string) {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0)
      throw new BadRequestException(`${field} must be 0 or greater`);
  }
  private async ensureOrderOwnership(pageId: number, orderId: number) {
    if (!orderId || !Number.isInteger(orderId) || orderId <= 0)
      throw new BadRequestException('Invalid orderId');
    const o = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, pageIdRef: true },
    });
    if (!o || o.pageIdRef !== pageId)
      throw new NotFoundException('Order not found for this page');
    return o;
  }
  private async ensureCollectionOwnership(pageId: number, id: number) {
    const c = await this.prisma.collection.findUnique({
      where: { id },
      select: { pageId: true },
    });
    if (!c || c.pageId !== pageId)
      throw new NotFoundException('Collection not found');
  }
  private async ensureExpenseOwnership(pageId: number, id: number) {
    const e = await this.prisma.expense.findUnique({
      where: { id },
      select: { pageId: true },
    });
    if (!e || e.pageId !== pageId)
      throw new NotFoundException('Expense not found');
  }
}
