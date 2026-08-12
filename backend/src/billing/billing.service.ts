import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../common/telegram.service';
import { SmsGatewayService } from '../sms-gateway/sms-gateway.service';
import { PartnerService } from '../partner/partner.service';

const TRIAL_DAYS = 7;
const PAGE_FEATURE_FIELDS = [
  'automationAllowed',
  'ocrAllowed',
  'infoModeAllowed',
  'orderModeAllowed',
  'printModeAllowed',
  'callConfirmModeAllowed',
  'memoSaveModeAllowed',
  'memoTemplateModeAllowed',
  'autoMemoDesignModeAllowed',
] as const;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly globalConfigFile = path.join(
    process.cwd(),
    'storage',
    'global-config.json',
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly smsGateway: SmsGatewayService,
    private readonly partner: PartnerService,
  ) {}

  // ── Startup: ensure single default plan exists (required for DB FK) ────────
  async onModuleInit() {
    await this.prisma.plan.upsert({
      where: { name: 'custom' },
      update: { displayName: 'Custom', isActive: true },
      create: {
        id: 'plan_custom',
        name: 'custom',
        displayName: 'Custom',
        priceMonthly: 0,
        ordersLimit: -1,
        pagesLimit: -1,
        agentsLimit: -1,
        isActive: true,
      },
    });
    // Deactivate old named plans
    await this.prisma.plan.updateMany({
      where: { name: { in: ['basic', 'starter', 'pro', 'business', 'enterprise'] } },
      data: { isActive: false },
    });
    this.logger.log('[Billing] Plan seeded');
  }

  // ── Get or create subscription for user ──────────────────────────────────
  async getOrCreateSubscription(userId: string) {
    let sub = await this.prisma.subscription.findFirst({
      where: { userId },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!sub) {
      const plan = await this.prisma.plan.findFirst({
        where: { name: 'custom' },
      });
      const now = new Date();
      const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
      const periodEnd = new Date(now.getTime() + 30 * 86_400_000);

      try {
        sub = await this.prisma.subscription.create({
          data: {
            id: crypto.randomUUID(),
            userId,
            planId: plan!.id,
            status: 'trial',
            periodStart: now,
            periodEnd,
            ordersLimit: plan!.ordersLimit,
            trialEndsAt: trialEnd,
            nextPaymentDue: trialEnd,
          },
          include: { plan: true },
        });
        this.logger.log(
          `[Billing] Trial subscription created for user ${userId}`,
        );
      } catch {
        // Concurrent creation race — fetch the one that won
        sub = await this.prisma.subscription.findFirst({
          where: { userId },
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
        });
        if (!sub) throw new Error(`Failed to get or create subscription for user ${userId}`);
      }
    }
    return sub;
  }

  // ── Get subscription status summary ──────────────────────────────────────
  async getStatus(userId: string) {
    const sub = await this.getOrCreateSubscription(userId);
    const now = new Date();

    // Auto-expire trial — only once the actual granted period (periodEnd) has
    // also passed. trialEndsAt alone isn't enough: if an admin extends
    // periodEnd (e.g. adminSetSubscription) without also moving status off
    // 'trial', this used to flip a legitimately-extended subscription to
    // 'expired' the moment the original short trial window passed.
    if (
      sub.status === 'trial' &&
      sub.trialEndsAt &&
      sub.trialEndsAt < now &&
      sub.periodEnd < now
    ) {
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'expired', updatedAt: now },
      });
      sub.status = 'expired';
    }

    // Auto-expire active
    if (sub.status === 'active' && sub.periodEnd < now) {
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'grace', updatedAt: now },
      });
      sub.status = 'grace';
    }

    const daysLeft =
      sub.status === 'trial' && sub.trialEndsAt
        ? Math.max(
            0,
            Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / 86_400_000),
          )
        : Math.max(
            0,
            Math.ceil((sub.periodEnd.getTime() - now.getTime()) / 86_400_000),
          );

    const ordersUsed = sub.ordersUsed;
    const ordersLimit = sub.ordersLimit;
    const usagePct =
      ordersLimit === -1
        ? 0
        : Math.min(100, Math.round((ordersUsed / ordersLimit) * 100));

    return {
      subscriptionId: sub.id,
      status: sub.status, // trial | active | expired | grace | cancelled
      daysLeft,
      periodEnd: sub.periodEnd.toISOString(),
      trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
      ordersUsed,
      ordersLimit,
      usagePct,
      nextPaymentDue: sub.nextPaymentDue?.toISOString() ?? null,
      isActive: ['trial', 'active', 'grace'].includes(sub.status),
      canTakeOrders: this.canTakeOrders(sub),
      warnings: this.buildWarnings(sub, daysLeft, usagePct),
      adminContact: this.getBillingSupportContact(),
      paymentConfig: this.getPaymentConfig(),
    };
  }

  // ── Check if user can take new orders ────────────────────────────────────
  // Pay-as-you-go model: there is no plan / monthly order-limit system — AI,
  // broadcasts and order-taking are gated ONLY by the per-page wallet balance
  // (WalletService.canProcessAi). So order-taking is never blocked here.
  canTakeOrders(_sub: any): boolean {
    return true;
  }

  // ── Increment order usage ─────────────────────────────────────────────────
  async incrementOrderUsage(userId: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    if (!sub) return;
    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { ordersUsed: { increment: 1 }, updatedAt: new Date() },
    });
  }

  // ── Submit payment (client submits bKash transaction ID) ──────────────────
  async submitPayment(
    userId: string,
    body: {
      amount: number;
      method: string;
      transactionId: string;
      note?: string;
    },
  ) {
    const sub = await this.getOrCreateSubscription(userId);
    if (!body.transactionId?.trim())
      throw new BadRequestException('Transaction ID required');
    if (body.amount <= 0) throw new BadRequestException('Invalid amount');

    const payment = await this.prisma.payment.create({
      data: {
        id: crypto.randomUUID(),
        subscriptionId: sub.id,
        amount: body.amount,
        method: body.method || 'bkash',
        transactionId: body.transactionId.trim(),
        status: 'pending',
        note: body.note ?? null,
        paidAt: new Date(),
      },
    });

    this.logger.log(
      `[Billing] Payment submitted userId=${userId} txn=${body.transactionId} amount=${body.amount}`,
    );

    // ── SMS auto-confirm: check if admin's phone received matching SMS ────────
    const smsMatch = await this.smsGateway.matchAdminPayment(
      body.transactionId.trim(),
      body.amount,
    );
    if (smsMatch.matched) {
      const now = new Date();
      const periodEnd = new Date(now.getTime() + 30 * 86_400_000);
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'confirmed', confirmedAt: now, confirmedBy: 'sms-auto' },
      });
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'active',
          periodStart: now,
          periodEnd,
          ordersUsed: 0,
          lastPaymentAt: now,
          nextPaymentDue: periodEnd,
          updatedAt: now,
        },
      });
      this.logger.log(`[Billing] Payment auto-confirmed via SMS txn=${body.transactionId}`);
      void this.partner.recordEarningIfReferred(
        userId,
        'SUBSCRIPTION_FEE',
        body.amount,
        payment.id,
      );
      return {
        paymentId: payment.id,
        status: 'confirmed',
        autoConfirmed: true,
        message: `✅ Payment verify হয়েছে! Subscription ${periodEnd.toLocaleDateString('bn-BD')} পর্যন্ত active।`,
      };
    }
    // ── End SMS auto-confirm ──────────────────────────────────────────────────

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    void this.telegram.sendMessage(
      `💳 <b>নতুন Payment Request!</b>\n` +
      `👤 User: ${user?.name || userId} (${user?.email || ''})\n` +
      `💰 Amount: ${body.amount} BDT\n` +
      `📱 Method: ${body.method || 'bkash'}\n` +
      `🔖 TxID: ${body.transactionId}\n` +
      (body.note ? `📝 Note: ${body.note}\n` : '') +
      `🕐 সময়: ${new Date().toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' })}`,
    );

    return {
      paymentId: payment.id,
      status: 'pending',
      message:
        'আপনার payment received। Admin confirm করলে subscription activate হবে।',
    };
  }

  // ── Get payment history ───────────────────────────────────────────────────
  async getPayments(userId: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    if (!sub) return [];
    return this.prisma.payment.findMany({
      where: { subscriptionId: sub.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  // ── Get all plans ─────────────────────────────────────────────────────────
  async getPlans() {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { priceMonthly: 'asc' },
    });
  }

  // ── ADMIN: Confirm payment + activate subscription ────────────────────────
  async adminConfirmPayment(
    paymentId: string,
    adminUserId: string,
  ) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { subscription: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === 'confirmed')
      throw new BadRequestException('Already confirmed');

    const now = new Date();
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'confirmed', confirmedAt: now, confirmedBy: adminUserId },
    });

    const periodStart = now;
    const periodEnd = new Date(now.getTime() + 30 * 86_400_000);

    await this.prisma.subscription.update({
      where: { id: payment.subscriptionId },
      data: {
        status: 'active',
        periodStart,
        periodEnd,
        ordersUsed: 0,
        lastPaymentAt: now,
        nextPaymentDue: periodEnd,
        updatedAt: now,
      },
    });

    this.logger.log(`[Billing] Payment confirmed ${paymentId} → subscription activated`);
    void this.partner.recordEarningIfReferred(
      payment.subscription.userId,
      'SUBSCRIPTION_FEE',
      payment.amount,
      payment.id,
    );
    return {
      success: true,
      message: `Subscription activated until ${periodEnd.toLocaleDateString()}`,
    };
  }

  // ── ADMIN: List all subscriptions ─────────────────────────────────────────
  async adminListSubscriptions(filter?: { status?: string }) {
    const where: any = {};
    if (filter?.status) where.status = filter.status;
    return this.prisma.subscription.findMany({
      where,
      include: {
        plan: true,
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            email: true,
            pages: {
              select: {
                id: true,
                pageName: true,
                automationAllowed: true,
                ocrAllowed: true,
                infoModeAllowed: true,
                orderModeAllowed: true,
                printModeAllowed: true,
                callConfirmModeAllowed: true,
                memoSaveModeAllowed: true,
                memoTemplateModeAllowed: true,
                autoMemoDesignModeAllowed: true,
              },
              orderBy: { id: 'asc' },
            },
          },
        },
        payments: { orderBy: { createdAt: 'desc' }, take: 3 },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── ADMIN: List pending payments ──────────────────────────────────────────
  async adminListPendingPayments() {
    return this.prisma.payment.findMany({
      where: { status: 'pending' },
      include: {
        subscription: {
          include: {
            plan: true,
            user: { select: { id: true, username: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── ADMIN: Manually set subscription ─────────────────────────────────────
  async adminSetSubscription(
    userId: string,
    body: {
      status: string;
      periodDays?: number;
      ordersLimit?: number;
      note?: string;
      featureAccess?: Partial<
        Record<(typeof PAGE_FEATURE_FIELDS)[number], boolean>
      >;
    },
  ) {
    const plan = await this.prisma.plan.findFirst({ where: { name: 'custom' } });
    if (!plan) throw new NotFoundException('Default plan not found');

    const existing = await this.prisma.subscription.findFirst({
      where: { userId },
    });
    const now = new Date();
    const days = body.periodDays ?? 30;
    const periodEnd = new Date(now.getTime() + days * 86_400_000);
    const nextOrdersLimit =
      typeof body.ordersLimit === 'number' && Number.isFinite(body.ordersLimit)
        ? body.ordersLimit
        : -1;
    const pagePatch = this.buildPageFeaturePatch(body.featureAccess);
    // trialEndsAt is only meaningful while status stays 'trial' — otherwise it's
    // a stale short window that the auto-expire check (getStatus) can use to
    // wrongly expire an extension. Keep it in sync with the new periodEnd, or
    // clear it entirely once the subscription isn't a trial anymore.
    const nextTrialEndsAt = body.status === 'trial' ? periodEnd : null;

    if (existing) {
      await this.prisma.subscription.update({
        where: { id: existing.id },
        data: {
          status: body.status,
          ordersLimit: nextOrdersLimit,
          ordersUsed: 0,
          periodStart: now,
          periodEnd,
          trialEndsAt: nextTrialEndsAt,
          nextPaymentDue: periodEnd,
          note: body.note ?? null,
          updatedAt: now,
        },
      });
    } else {
      await this.prisma.subscription.create({
        data: {
          id: crypto.randomUUID(),
          userId,
          planId: plan.id,
          status: body.status,
          ordersLimit: nextOrdersLimit,
          trialEndsAt: nextTrialEndsAt,
          periodStart: now,
          periodEnd,
          nextPaymentDue: periodEnd,
          note: body.note ?? null,
        },
      });
    }
    if (Object.keys(pagePatch).length > 0) {
      await this.prisma.page.updateMany({
        where: { ownerId: userId },
        data: pagePatch,
      });
    }
    this.logger.log(`[Billing] Admin set subscription for ${userId} → ${body.status}`);
    return { success: true };
  }

  // ── Reset monthly usage (called by cron on 1st of month) ─────────────────
  async resetMonthlyUsage() {
    const result = await this.prisma.subscription.updateMany({
      where: { status: { in: ['active', 'trial'] } },
      data: { ordersUsed: 0 },
    });
    this.logger.log(
      `[Billing] Monthly usage reset — ${result.count} subscriptions`,
    );
    return result.count;
  }

  // ── Build warning messages ────────────────────────────────────────────────
  private buildWarnings(
    sub: any,
    daysLeft: number,
    usagePct: number,
  ): string[] {
    const w: string[] = [];
    if (sub.status === 'trial' && daysLeft <= 3)
      w.push(`⚠️ Trial ${daysLeft} দিনে শেষ হবে — upgrade করুন`);
    if (sub.status === 'trial' && daysLeft <= 7)
      w.push(`Trial ${daysLeft} দিন বাকি`);
    if (sub.status === 'active' && daysLeft <= 2)
      w.push(
        `⚠️ Subscription ${daysLeft} দিনের মধ্যে শেষ হবে — admin এর সাথে কথা বলুন`,
      );
    if (sub.status === 'expired')
      w.push('❌ Subscription expired — payment করুন');
    if (sub.status === 'grace') w.push('⚠️ Grace period চলছে — payment করুন');
    // No order-limit warnings — pay-as-you-go has no order cap.
    return w;
  }

  private buildPageFeaturePatch(
    input?: Partial<Record<(typeof PAGE_FEATURE_FIELDS)[number], boolean>>,
  ) {
    const patch: Record<string, boolean> = {};
    for (const field of PAGE_FEATURE_FIELDS) {
      if (typeof input?.[field] === 'boolean') {
        patch[field] = input[field];
      }
    }
    return patch;
  }

  private getPaymentConfig() {
    try {
      if (fs.existsSync(this.globalConfigFile)) {
        const cfg = JSON.parse(fs.readFileSync(this.globalConfigFile, 'utf8'));
        const p = cfg?.adminPayment || {};
        return {
          smsGatewayEnabled: !!p.smsGatewayEnabled,
          bkashEnabled:      !!p.bkashEnabled,
          nagadEnabled:      !!p.nagadEnabled,
          manualEnabled:     true,
        };
      }
    } catch {}
    return { smsGatewayEnabled: false, bkashEnabled: false, nagadEnabled: false, manualEnabled: true };
  }

  private getBillingSupportContact() {
    try {
      if (fs.existsSync(this.globalConfigFile)) {
        const cfg = JSON.parse(fs.readFileSync(this.globalConfigFile, 'utf8'));
        const support = cfg?.billingSupport || {};
        const s = (v: any) => String(v || '').trim();
        return {
          label:       s(support.label) || 'Admin Support',
          phone:       s(support.phone),
          whatsappUrl: s(support.whatsappUrl),
          messengerUrl:s(support.messengerUrl),
          email:       s(support.email),
          note:        s(support.note),
          bkash:       s(support.bkash),
          nagad:       s(support.nagad),
          rocket:      s(support.rocket),
          bankAccount: s(support.bankAccount),
          bankName:    s(support.bankName),
          bankBranch:  s(support.bankBranch),
          bankHolder:  s(support.bankHolder),
        };
      }
    } catch {}
    return {
      label: 'Admin Support',
      phone: '', whatsappUrl: '', messengerUrl: '', email: '', note: '',
      bkash: '', nagad: '', rocket: '',
      bankAccount: '', bankName: '', bankBranch: '', bankHolder: '',
    };
  }
}
