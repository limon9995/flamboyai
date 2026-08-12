import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { computeTextTierCredits } from './text-tier-pricing';

export type AiStatus = 'ok' | 'no_balance' | 'trial_limit_exceeded' | 'suspended';
const TRIAL_DAILY_AI_LIMIT = 100;

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Evaluates if a page has enough balance to proceed with an AI operation.
   * Returns false if balance is <= 0 or subscription is SUSPENDED.
   */
  async canProcessAi(pageId: number): Promise<boolean> {
    const status = await this.getAiStatus(pageId);
    return status === 'ok';
  }

  /**
   * Returns detailed AI permission status for a page.
   * 'ok'                  — AI allowed
   * 'trial_limit_exceeded'— Free trial daily limit (100/day) reached — bot silent
   * 'no_balance'          — Paid page with zero balance — send fallback message
   * 'suspended'           — Subscription suspended
   */
  async getAiStatus(pageId: number): Promise<AiStatus> {
    try {
      const page = await this.prisma.page.findUnique({
        where: { id: pageId },
        select: { creditBalance: true, subscriptionStatus: true, ownerId: true },
      });

      if (!page) return 'suspended';
      if (page.subscriptionStatus !== 'ACTIVE') return 'suspended';

      // Grace period: allow AI even with zero/negative balance
      const isGrace = await this.isGracePeriod(pageId);
      if (isGrace) return 'ok';

      // Free trial check
      if (page.ownerId) {
        const isTrial = await this.isTrialPage(page.ownerId);
        if (isTrial) {
          const todayCount = await this.getTrialDailyAiUsage(pageId);
          if (todayCount >= TRIAL_DAILY_AI_LIMIT) return 'trial_limit_exceeded';
          return 'ok';
        }
      }

      if (page.creditBalance <= 0) return 'no_balance';
      return 'ok';
    } catch (error) {
      this.logger.error(`Failed to check AI status for page ${pageId}: ${error}`);
      return 'no_balance';
    }
  }

  private async isTrialPage(ownerId: string): Promise<boolean> {
    const sub = await this.prisma.subscription.findFirst({
      where: { userId: ownerId, status: 'trial' },
      select: { id: true },
    });
    return !!sub;
  }

  private async getTrialDailyAiUsage(pageId: number): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return this.prisma.walletTransaction.count({
      where: {
        pageId,
        type: { startsWith: 'DEDUCT' },
        createdAt: { gte: startOfDay },
      },
    });
  }

  /**
   * Deducts a specific amount from the page's wallet based on the usage type.
   */
  async deductUsage(
    pageId: number,
    type:
      | 'TEXT'
      | 'VOICE'
      | 'IMAGE'
      | 'IMAGE_LOCAL'
      | 'IMAGE_OCR'
      | 'ADMIN_VISION'
      | 'IMAGE_UNIQUENESS'
      | 'AI_GENERATE'
      | 'DUAL_PHOTO_AI'
      | 'SMART_BOT'
      | 'MEMO_PRINT'
      | 'KEYWORD_REPLY'
      | 'COMMENT_REPLY'
      | 'BROADCAST',
    options?: { photoCount?: number; memoCount?: number; msgCount?: number; provider?: string; charCount?: number },
  ): Promise<boolean> {
    try {
      const page = await this.prisma.page.findUnique({ where: { id: pageId } });
      if (!page) return false;

      let amountToDeduct = 0;
      let description = '';

      switch (type) {
        case 'TEXT':
          if (options?.charCount == null) {
            this.logger.warn(`deductUsage TEXT called without charCount for page ${pageId} — using base tier`);
          }
          amountToDeduct = computeTextTierCredits(options?.charCount ?? 0);
          description = 'বট টেক্সট রিপ্লাই';
          break;
        case 'VOICE':
          amountToDeduct = page.costPerVoiceMsgCredit;
          description = 'ভয়েস মেসেজ প্রসেস';
          break;
        case 'IMAGE':
          amountToDeduct = page.costPerImageCredit;
          description = 'ছবি থেকে পণ্য শনাক্ত (AI)';
          break;
        case 'IMAGE_LOCAL':
          amountToDeduct = (page as any).costPerImageLocalCredit ?? 4;
          description = 'ছবি থেকে পণ্য শনাক্ত';
          break;
        case 'IMAGE_OCR':
          amountToDeduct = Math.max(1, Math.round(page.costPerImageCredit * 0.5));
          description = 'ছবি থেকে অর্ডার কোড পড়া (OCR)';
          break;
        case 'ADMIN_VISION':
          amountToDeduct = page.costPerAnalyzeCredit;
          description = 'পণ্য ছবি বিশ্লেষণ';
          break;
        case 'IMAGE_UNIQUENESS':
          amountToDeduct = 1;
          description = 'পণ্য যাচাই';
          break;
        case 'AI_GENERATE':
          amountToDeduct = (page as any).costPerAiGenerateCredit ?? 4;
          description = 'AI কন্টেন্ট তৈরি';
          break;
        case 'DUAL_PHOTO_AI': {
          const photoCount = options?.photoCount ?? 3;
          amountToDeduct = (page.costPerAnalyzeCredit ?? 8) * photoCount;
          description = `ডুয়েল ফটো পণ্য শনাক্ত (${photoCount}টি ছবি)`;
          break;
        }
        case 'SMART_BOT':
          if (options?.charCount == null) {
            this.logger.warn(`deductUsage SMART_BOT called without charCount for page ${pageId} — using base tier`);
          }
          amountToDeduct = computeTextTierCredits(options?.charCount ?? 0);
          description = 'স্মার্ট বট রিপ্লাই';
          break;
        case 'MEMO_PRINT': {
          const memoCount = options?.memoCount ?? 1;
          amountToDeduct =
            ((page as any).costPerMemoPrintCredit ?? 4) * memoCount;
          description = `মেমো প্রিন্ট / ডাউনলোড (${memoCount}টি)`;
          break;
        }
        case 'KEYWORD_REPLY':
          amountToDeduct = (page as any).costPerKeywordReplyCredit ?? 1;
          description = 'কীওয়ার্ড বট রিপ্লাই';
          break;
        case 'COMMENT_REPLY':
          amountToDeduct = (page as any).costPerCommentReplyCredit ?? 2;
          description = 'কমেন্ট অটো-রিপ্লাই';
          break;
        case 'BROADCAST': {
          const msgCount = options?.msgCount ?? 1;
          amountToDeduct = ((page as any).costPerBroadcastMsgCredit ?? 2) * msgCount;
          description = `ব্রডকাস্ট মেসেজ (${msgCount}টি)`;
          break;
        }
      }

      if (amountToDeduct <= 0) return true; // Free setup or overridden to 0

      // Trial pages: log usage for daily count tracking but don't deduct balance
      const pageForTrial = await this.prisma.page.findUnique({ where: { id: pageId }, select: { ownerId: true } });
      if (pageForTrial?.ownerId && await this.isTrialPage(pageForTrial.ownerId)) {
        await this.prisma.walletTransaction.create({
          data: { pageId, type: `DEDUCT_${type}`, amountCredit: 0, description: `[Trial] ${description}`, provider: options?.provider ?? null },
        });
        return true;
      }

      // Transactionally deduct and log.
      // In grace mode: always deduct (balance may go negative — debt is repaid on next recharge).
      // Otherwise: skip if balance is already 0 or below (non-grace pages stop at zero).
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.page.findUnique({
          where: { id: pageId },
          select: { creditBalance: true, subscriptionStatus: true },
        });
        if (!current) return;

        // Check if subscription is currently in grace period
        const isGrace = await this.isGracePeriod(pageId, tx as any);

        // Non-grace pages: stop deducting once balance hits zero
        if (!isGrace && current.creditBalance <= 0) return;

        await tx.page.update({
          where: { id: pageId },
          data: { creditBalance: { decrement: amountToDeduct } },
        });

        await tx.walletTransaction.create({
          data: {
            pageId,
            type: `DEDUCT_${type}`,
            amountCredit: -amountToDeduct,
            description: isGrace ? `[Grace] ${description}` : description,
            provider: options?.provider ?? null,
          },
        });
      });

      return true;
    } catch (error) {
      this.logger.error(
        `Failed to deduct usage for page ${pageId} (${type}): ${error}`,
      );
      return false;
    }
  }

  /**
   * Deducts a fixed credit amount (e.g. SMS verify 1% fee) and logs it.
   */
  async deductFixed(
    pageId: number,
    amountCredit: number,
    description: string,
    type: string = 'DEDUCT_FIXED',
  ): Promise<boolean> {
    if (amountCredit <= 0) return true;
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.page.findUnique({
          where: { id: pageId },
          select: { creditBalance: true },
        });
        if (!current || current.creditBalance <= 0) return;
        await tx.page.update({
          where: { id: pageId },
          data: { creditBalance: { decrement: amountCredit } },
        });
        await tx.walletTransaction.create({
          data: { pageId, type, amountCredit: -amountCredit, description },
        });
      });
      return true;
    } catch (error) {
      this.logger.error(`Failed to deduct fixed fee for page ${pageId}: ${error}`);
      return false;
    }
  }

  /**
   * Deducts the monthly base platform fee (credit unit).
   * Suspends the page if balance drops to 0 or below after deduction.
   */
  async deductBaseFee(
    pageId: number,
    feeCredit: number,
  ): Promise<{ suspended: boolean }> {
    try {
      let suspended = false;
      await this.prisma.$transaction(async (tx) => {
        const page = await tx.page.findUnique({
          where: { id: pageId },
          select: { creditBalance: true, subscriptionStatus: true },
        });
        if (!page || page.subscriptionStatus !== 'ACTIVE') return;

        const newBalance = page.creditBalance - feeCredit;
        suspended = newBalance <= 0;

        await tx.page.update({
          where: { id: pageId },
          data: {
            creditBalance: { decrement: feeCredit },
            ...(suspended ? { subscriptionStatus: 'SUSPENDED' } : {}),
          },
        });

        await tx.walletTransaction.create({
          data: {
            pageId,
            type: 'DEDUCT_BASE_FEE',
            amountCredit: -feeCredit,
            description: `Monthly platform maintenance fee`,
          },
        });
      });
      return { suspended };
    } catch (error) {
      this.logger.error(
        `Failed to deduct base fee for page ${pageId}: ${error}`,
      );
      return { suspended: false };
    }
  }

  private async isGracePeriod(pageId: number, tx?: any): Promise<boolean> {
    const db = tx ?? this.prisma;
    const page = await db.page.findUnique({
      where: { id: pageId },
      select: { ownerId: true },
    });
    if (!page?.ownerId) return false;
    const sub = await db.subscription.findFirst({
      where: { userId: page.ownerId, status: 'grace' },
      select: { id: true },
    });
    return !!sub;
  }

  /**
   * Admin / System recharges a wallet with credits.
   */
  async rechargeWallet(
    pageId: number,
    creditAmount: number,
    transactionId: string,
  ): Promise<boolean> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.page.update({
          where: { id: pageId },
          data: {
            creditBalance: { increment: creditAmount },
            subscriptionStatus: 'ACTIVE', // Automatically resume if it was suspended
          },
        });

        await tx.walletTransaction.create({
          data: {
            pageId,
            type: 'RECHARGE',
            amountCredit: creditAmount,
            description: `Recharge via Trx: ${transactionId}`,
          },
        });
      });
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to recharge wallet for page ${pageId}: ${error}`,
      );
      return false;
    }
  }
}
