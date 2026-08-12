import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MessengerService } from '../messenger/messenger.service';
import { WaMessengerService } from '../whatsapp/wa-messenger.service';
import { IgMessengerService } from '../instagram/ig-messenger.service';
import { EncryptionService } from '../common/encryption.service';
import { BillingService } from '../billing/billing.service';
import { WalletService } from '../wallet/wallet.service';

/**
 * FIX 1: Queue-based broadcast architecture.
 *
 * Instead of sending all messages in one long loop inside a single async call,
 * we use a per-broadcast in-memory queue that:
 *  - processes in chunks of CHUNK_SIZE
 *  - yields between chunks (setImmediate) so the event loop stays responsive
 *  - rate-limits to RATE_LIMIT_MS per message
 *  - can be cancelled mid-flight
 *  - updates progress in DB every chunk
 *
 * Future upgrade path → replace the in-memory queue with BullMQ + Redis:
 *   1. Install bullmq, ioredis
 *   2. Replace broadcastQueues Map with BullMQ Queue
 *   3. Move sendChunk logic to a BullMQ Worker
 *   4. No API surface change needed
 */

const RATE_LIMIT_MS = 50; // ms between messages (Facebook safe rate)
const CHUNK_SIZE = 20; // messages per chunk before yielding

@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);

  // FIX 1: track active broadcast jobs — allows cancellation
  private readonly activeBroadcasts = new Map<number, { cancelled: boolean }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly messenger: MessengerService,
    private readonly waMessenger: WaMessengerService,
    private readonly igMessenger: IgMessengerService,
    private readonly encryption: EncryptionService,
    private readonly billing: BillingService,
    private readonly wallet: WalletService,
  ) {}

  async create(
    pageId: number,
    body: {
      title: string;
      message: string;
      targetType: string;
      targetValue?: string;
      scheduledAt?: string;
      platform?: string;
    },
  ) {
    if (!body.title?.trim()) throw new BadRequestException('Title required');
    if (!body.message?.trim())
      throw new BadRequestException('Message required');

    // Basic plan does not include Broadcast
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { ownerId: true },
    });
    if (page?.ownerId) {
      const sub = await this.billing.getOrCreateSubscription(page.ownerId);
      if (!this.billing.canTakeOrders(sub)) {
        throw new ForbiddenException('Subscription expired। Admin-এর সাথে যোগাযোগ করুন।');
      }
    }

    const platform = (body.platform ?? 'FACEBOOK').toUpperCase();
    if (!['FACEBOOK', 'INSTAGRAM', 'WHATSAPP'].includes(platform)) {
      throw new BadRequestException('Invalid platform. Use FACEBOOK, INSTAGRAM, or WHATSAPP');
    }

    return this.prisma.broadcast.create({
      data: {
        pageId,
        title: body.title.trim(),
        message: body.message.trim(),
        targetType: body.targetType || 'all',
        targetValue: body.targetValue ?? null,
        status: 'draft',
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
        platform,
      },
    });
  }

  async list(pageId: number) {
    return this.prisma.broadcast.findMany({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async delete(pageId: number, id: number) {
    const b = await this.prisma.broadcast.findUnique({ where: { id } });
    if (!b || b.pageId !== pageId)
      throw new NotFoundException('Broadcast not found');
    if (b.status === 'running')
      throw new BadRequestException('Cannot delete running broadcast');
    await this.prisma.broadcast.delete({ where: { id } });
    return { success: true };
  }

  async send(pageId: number, id: number) {
    const broadcast = await this.prisma.broadcast.findUnique({ where: { id } });
    if (!broadcast || broadcast.pageId !== pageId)
      throw new NotFoundException('Broadcast not found');
    if (broadcast.status === 'running')
      throw new BadRequestException('Already running');
    if (broadcast.status === 'completed')
      throw new BadRequestException('Already completed');

    const page = await this.prisma.page.findUnique({ where: { id: pageId } });
    if (!page) throw new BadRequestException('Page not found');

    const platform = (broadcast as any).platform ?? 'FACEBOOK';

    if (platform === 'WHATSAPP' && (!page.waToken || !page.waPhoneNumberId)) {
      throw new BadRequestException('WhatsApp token বা Phone Number ID নেই। Settings থেকে configure করুন।');
    }
    if (platform === 'INSTAGRAM' && !page.igToken) {
      throw new BadRequestException('Instagram token নেই। Settings থেকে configure করুন।');
    }
    if (platform === 'FACEBOOK' && !page.pageToken) {
      throw new BadRequestException('Page token not found');
    }

    // FIX 4: filter out blocked customers when building target list
    const psids = await this.getTargets(
      pageId,
      broadcast.targetType,
      broadcast.targetValue,
      platform,
    );

    // Wallet check: calculate total cost and verify sufficient balance
    const costPerMsg = (page as any).costPerBroadcastMsgCredit ?? 2;
    const totalCost = costPerMsg * psids.length;

    if (psids.length > 0) {
      const walletOk = await this.wallet.canProcessAi(pageId);
      if (!walletOk) {
        throw new BadRequestException(
          `Credit balance নেই। Broadcast বন্ধ। Recharge করুন।`,
        );
      }
      if (page.creditBalance < totalCost) {
        throw new BadRequestException(
          `Insufficient balance। ${psids.length} জনকে message পাঠাতে ${totalCost.toFixed(0)} credit লাগবে, কিন্তু balance-এ আছে ${page.creditBalance.toFixed(0)} credit।`,
        );
      }
      // Deduct full cost upfront before sending
      await this.wallet.deductUsage(pageId, 'BROADCAST', { msgCount: psids.length });
    }

    await this.prisma.broadcast.update({
      where: { id },
      data: {
        status: 'running',
        totalTarget: psids.length,
        startedAt: new Date(),
      },
    });

    // FIX 1: register in active map for potential cancellation
    this.activeBroadcasts.set(id, { cancelled: false });

    // Build sender function based on platform
    let sendFn: (recipient: string) => Promise<void>;
    if (platform === 'WHATSAPP') {
      const waToken = this.encryption.decrypt(page.waToken!);
      const phoneNumberId = page.waPhoneNumberId!;
      sendFn = (to) => this.waMessenger.sendText(phoneNumberId, waToken, to, broadcast.message);
    } else if (platform === 'INSTAGRAM') {
      const igToken = this.encryption.decrypt(page.igToken!);
      sendFn = (recipientId) => this.igMessenger.sendText(igToken, recipientId, broadcast.message);
    } else {
      const fbToken = this.encryption.decrypt(page.pageToken!);
      sendFn = (psid) => this.messenger.sendText(fbToken, psid, broadcast.message, 'POST_PURCHASE_UPDATE');
    }

    // Start processing in background
    this.processQueue(id, broadcast.message, psids, sendFn).catch((e) =>
      this.logger.error(`[Broadcast] Queue error #${id}: ${e.message}`),
    );

    return {
      broadcastId: id,
      totalTarget: psids.length,
      message: 'Broadcast started',
    };
  }

  // FIX 1: chunk-based queue processor
  private async processQueue(
    id: number,
    message: string,
    psids: string[],
    sendFn: (recipient: string) => Promise<void>,
  ) {
    let sent = 0,
      failed = 0;
    const job = this.activeBroadcasts.get(id);

    for (let i = 0; i < psids.length; i++) {
      // Check if cancelled
      if (job?.cancelled) {
        this.logger.log(`[Broadcast] #${id} cancelled at ${i}/${psids.length}`);
        break;
      }

      try {
        await sendFn(psids[i]);
        sent++;
        await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
      } catch {
        failed++;
      }

      // FIX 1: yield every CHUNK_SIZE messages so event loop stays free
      if (i > 0 && i % CHUNK_SIZE === 0) {
        // Update DB progress
        await this.prisma.broadcast
          .update({
            where: { id },
            data: { totalSent: sent, totalFailed: failed },
          })
          .catch(() => {});
        // Yield to event loop
        await new Promise((r) => setImmediate(r));
      }
    }

    const status = job?.cancelled ? 'failed' : 'completed';
    await this.prisma.broadcast
      .update({
        where: { id },
        data: {
          status,
          totalSent: sent,
          totalFailed: failed,
          completedAt: new Date(),
        },
      })
      .catch(() => {});

    this.activeBroadcasts.delete(id);
    this.logger.log(
      `[Broadcast] #${id} ${status}: sent=${sent} failed=${failed}`,
    );
  }

  // ── Build target recipient list — FIX 4: exclude blocked customers ────────────
  private async getTargets(
    pageId: number,
    targetType: string,
    targetValue?: string | null,
    platform = 'FACEBOOK',
  ): Promise<string[]> {
    // For platform-specific broadcast, filter by platform in customer table
    const platformFilter = ['INSTAGRAM', 'WHATSAPP'].includes(platform)
      ? { platform }
      : {};

    switch (targetType) {
      case 'all': {
        const cs = await this.prisma.customer.findMany({
          where: { pageId, isBlocked: false, ...platformFilter },
          select: { psid: true },
        });
        return cs.map((c) => c.psid);
      }
      case 'tag': {
        if (!targetValue) return [];
        const cs = await this.prisma.customer.findMany({
          where: {
            pageId,
            isBlocked: false,
            tags: { contains: `"${targetValue}"` },
            ...platformFilter,
          },
          select: { psid: true },
        });
        return cs.map((c) => c.psid);
      }
      case 'ordered_before': {
        const before = targetValue ? new Date(targetValue) : new Date();
        const os = await this.prisma.order.findMany({
          where: { pageIdRef: pageId, createdAt: { lte: before } },
          select: { customerPsid: true },
          distinct: ['customerPsid'],
        });
        const blocked = await this.prisma.customer.findMany({
          where: { pageId, isBlocked: true },
          select: { psid: true },
        });
        const blockedSet = new Set(blocked.map((b) => b.psid));
        // If platform filter needed, further filter by platform
        if (platformFilter.platform) {
          const platformCustomers = await this.prisma.customer.findMany({
            where: { pageId, platform: platformFilter.platform },
            select: { psid: true },
          });
          const platformSet = new Set(platformCustomers.map((c) => c.psid));
          return os
            .map((o) => o.customerPsid)
            .filter((p) => p && !blockedSet.has(p) && platformSet.has(p));
        }
        return os
          .map((o) => o.customerPsid)
          .filter((p) => p && !blockedSet.has(p));
      }
      case 'never_ordered': {
        const cs = await this.prisma.customer.findMany({
          where: { pageId, isBlocked: false, totalOrders: 0, ...platformFilter },
          select: { psid: true },
        });
        return cs.map((c) => c.psid);
      }
      case 'custom_psids': {
        try {
          return JSON.parse(targetValue || '[]');
        } catch {
          return [];
        }
      }
      case 'recurring_subscribers': {
        const subs = await this.prisma.recurringSubscriber.findMany({
          where: { pageId, declined: false, tokenExpiresAt: { gt: new Date() } },
          select: { psid: true },
        });
        return subs.map((s) => s.psid);
      }
      default:
        return [];
    }
  }

  // ── Recurring Notification: subscribe prompt after order ──────────────────

  async sendSubscribePrompt(pageId: number, psid: string, fbToken: string): Promise<void> {
    const existing = await this.prisma.recurringSubscriber.findUnique({
      where: { pageId_psid: { pageId, psid } },
    });
    if (existing && !existing.declined && existing.tokenExpiresAt > new Date()) return;
    if (existing?.declined) return;

    // Throttle: only prompt once per day per customer
    if (existing?.promptedAt) {
      const hoursSince = (Date.now() - existing.promptedAt.getTime()) / 3600000;
      if (hoursSince < 24) return;
    }

    await this.messenger.sendSubscribeButton(fbToken, psid);
    await this.prisma.recurringSubscriber.upsert({
      where: { pageId_psid: { pageId, psid } },
      create: { pageId, psid, token: '', frequency: 'WEEKLY', tokenExpiresAt: new Date(0), promptedAt: new Date() },
      update: { promptedAt: new Date() },
    });
  }

  async saveSubscriberToken(
    pageId: number,
    psid: string,
    name: string | undefined,
    token: string,
    frequency: string,
  ): Promise<void> {
    const frequencyMonths: Record<string, number> = { DAILY: 6, WEEKLY: 9, MONTHLY: 12 };
    const months = frequencyMonths[frequency] ?? 9;
    const tokenExpiresAt = new Date();
    tokenExpiresAt.setMonth(tokenExpiresAt.getMonth() + months);

    await this.prisma.recurringSubscriber.upsert({
      where: { pageId_psid: { pageId, psid } },
      create: { pageId, psid, name, token, frequency, tokenExpiresAt, promptedAt: new Date() },
      update: { token, frequency, tokenExpiresAt, declined: false, name: name ?? undefined },
    });
  }

  async declineSubscription(pageId: number, psid: string): Promise<void> {
    await this.prisma.recurringSubscriber.upsert({
      where: { pageId_psid: { pageId, psid } },
      create: { pageId, psid, token: '', frequency: 'WEEKLY', tokenExpiresAt: new Date(0), promptedAt: new Date(), declined: true },
      update: { declined: true },
    });
  }

  async sendRecurringBroadcast(pageId: number, message: string, _fbToken?: string): Promise<{ sent: number; skipped: number }> {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { costPerRecurringNotifCredit: true, creditBalance: true, pageToken: true },
    });
    const fbToken = page?.pageToken ?? _fbToken ?? '';
    if (!page) throw new NotFoundException('Page not found');

    const subs = await this.prisma.recurringSubscriber.findMany({
      where: { pageId, declined: false, tokenExpiresAt: { gt: new Date() } },
    });

    const eligible = subs.filter((s) => {
      if (!s.lastNotifiedAt) return true;
      const gapHours: Record<string, number> = { DAILY: 20, WEEKLY: 160, MONTHLY: 700 };
      const gap = gapHours[s.frequency] ?? 160;
      return (Date.now() - s.lastNotifiedAt.getTime()) / 3600000 >= gap;
    });

    if (!eligible.length) return { sent: 0, skipped: subs.length };

    const totalCost = eligible.length * (page.costPerRecurringNotifCredit ?? 4);
    if (page.creditBalance < totalCost) {
      throw new BadRequestException(`Credit balance insufficient. Need ${totalCost.toFixed(0)} credit, have ${page.creditBalance.toFixed(0)} credit`);
    }

    let sent = 0;
    for (const sub of eligible) {
      try {
        await this.messenger.sendText(fbToken, sub.psid, message, 'POST_PURCHASE_UPDATE');
        await this.prisma.recurringSubscriber.update({
          where: { id: sub.id },
          data: { lastNotifiedAt: new Date() },
        });
        sent++;
      } catch (e) {
        this.logger.warn(`Recurring notif failed for psid ${sub.psid}: ${e.message}`);
      }
    }

    if (sent > 0) {
      const cost = sent * (page.costPerRecurringNotifCredit ?? 4);
      await this.prisma.page.update({
        where: { id: pageId },
        data: { creditBalance: { decrement: cost } },
      });
      await this.prisma.walletTransaction.create({
        data: {
          pageId,
          type: 'DEDUCT_RECURRING_NOTIF',
          amountCredit: -cost,
          description: `Recurring notification: ${sent} message(s) sent`,
        },
      });
    }

    return { sent, skipped: subs.length - sent };
  }

  async getSubscribers(pageId: number) {
    return this.prisma.recurringSubscriber.findMany({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
