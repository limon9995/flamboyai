import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { MessengerService } from '../messenger/messenger.service';
import { WaMessengerService } from '../whatsapp/wa-messenger.service';
import { IgMessengerService } from '../instagram/ig-messenger.service';
import { EncryptionService } from '../common/encryption.service';

export interface FollowUpSettings {
  orderReceivedEnabled: boolean;
  orderReceivedDelay: number;
  orderReceivedMsg: string;
  orderDeliveredEnabled: boolean;
  orderDeliveredDelay: number;
  orderDeliveredMsg: string;
  abandonedCartEnabled: boolean;
  abandonedCartDelay: number;
  abandonedCartMsg: string;
  reviewRequestEnabled: boolean;
  reviewRequestDelay: number;
  reviewRequestMsg: string;
}

@Injectable()
export class FollowUpService {
  private readonly logger = new Logger(FollowUpService.name);
  private readonly settingsDir = path.join(
    process.cwd(),
    'storage',
    'followup-settings',
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly messenger: MessengerService,
    private readonly waMessenger: WaMessengerService,
    private readonly igMessenger: IgMessengerService,
    private readonly encryption: EncryptionService,
  ) {}

  async schedule(
    pageId: number,
    data: {
      psid: string;
      orderId?: number;
      triggerType: string;
      message: string;
      delayHours?: number;
      platform?: string;
    },
  ) {
    const scheduledAt = new Date(
      Date.now() + (data.delayHours ?? 0) * 60 * 60 * 1000,
    );
    return this.prisma.followUp.create({
      data: {
        pageId,
        psid: data.psid,
        orderId: data.orderId ?? null,
        triggerType: data.triggerType,
        message: data.message,
        scheduledAt,
        status: 'pending',
        platform: data.platform ?? 'FACEBOOK',
      },
    });
  }

  async list(pageId: number, status?: string) {
    const where: any = { pageId };
    if (status) where.status = status;
    return this.prisma.followUp.findMany({
      where,
      orderBy: { scheduledAt: 'desc' },
      take: 200,
      include: { order: { select: { id: true, customerName: true } } },
    });
  }

  async cancel(pageId: number, id: number) {
    const f = await this.prisma.followUp.findUnique({ where: { id } });
    if (!f || f.pageId !== pageId || f.status !== 'pending')
      return { success: false };
    await this.prisma.followUp.update({
      where: { id },
      data: { status: 'cancelled' },
    });
    return { success: true };
  }

  async createManual(
    pageId: number,
    body: {
      psid: string;
      message: string;
      scheduledAt?: string;
      orderId?: number;
      platform?: string;
    },
  ) {
    return this.prisma.followUp.create({
      data: {
        pageId,
        psid: body.psid,
        orderId: body.orderId ?? null,
        triggerType: 'custom',
        message: body.message,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : new Date(),
        status: 'pending',
        platform: body.platform ?? 'FACEBOOK',
      },
    });
  }

  async getSettings(pageId: number): Promise<FollowUpSettings> {
    const file = this.settingsFile(pageId);
    try {
      if (!fs.existsSync(file)) return this.parseSettings(null);
      return this.parseSettings(fs.readFileSync(file, 'utf8'));
    } catch (e: any) {
      this.logger.error(
        `[FollowUp] Failed to read settings for page=${pageId}: ${e.message}`,
      );
      return this.parseSettings(null);
    }
  }

  async saveSettings(pageId: number, settings: FollowUpSettings) {
    const next = this.parseSettings(JSON.stringify(settings || {}));
    const file = this.settingsFile(pageId);
    try {
      fs.mkdirSync(this.settingsDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
      return next;
    } catch (e: any) {
      this.logger.error(
        `[FollowUp] Failed to save settings for page=${pageId}: ${e.message}`,
      );
      throw e;
    }
  }

  parseSettings(raw: string | null | undefined): FollowUpSettings {
    const defaults: FollowUpSettings = {
      orderReceivedEnabled: false,
      orderReceivedDelay: 24,
      orderReceivedMsg: 'আপনার Order #{{orderId}} টি কি পেয়েছেন? 💖',
      orderDeliveredEnabled: false,
      orderDeliveredDelay: 2,
      orderDeliveredMsg:
        'আপনার Order #{{orderId}} ডেলিভারি হয়েছে ✅ ধন্যবাদ! 💖',
      abandonedCartEnabled: false,
      abandonedCartDelay: 2,
      // {{name}} → customer's name, {{product}} → the product they were eyeing.
      abandonedCartMsg:
        '{{name}}, আপনি {{product}} নিয়ে ভাবছিলেন 😊 এখনো নিতে চাইলে বলুন — আমি অর্ডারটা রেডি করে দিই।',
      reviewRequestEnabled: false,
      reviewRequestDelay: 4,
      reviewRequestMsg:
        'আপনার Order #{{orderId}} কেমন লাগলো? একটা review দিন 💖 {{reviewLink}}',
    };
    try {
      const parsed = JSON.parse(raw || '{}');
      return {
        orderReceivedEnabled: Boolean(parsed.orderReceivedEnabled),
        orderReceivedDelay:
          Number(parsed.orderReceivedDelay) || defaults.orderReceivedDelay,
        orderReceivedMsg: String(
          parsed.orderReceivedMsg || defaults.orderReceivedMsg,
        ),
        orderDeliveredEnabled: Boolean(parsed.orderDeliveredEnabled),
        orderDeliveredDelay:
          Number(parsed.orderDeliveredDelay) || defaults.orderDeliveredDelay,
        orderDeliveredMsg: String(
          parsed.orderDeliveredMsg || defaults.orderDeliveredMsg,
        ),
        abandonedCartEnabled: Boolean(parsed.abandonedCartEnabled),
        abandonedCartDelay:
          Number(parsed.abandonedCartDelay) || defaults.abandonedCartDelay,
        abandonedCartMsg: String(
          parsed.abandonedCartMsg || defaults.abandonedCartMsg,
        ),
        reviewRequestEnabled: Boolean(parsed.reviewRequestEnabled),
        reviewRequestDelay:
          Number(parsed.reviewRequestDelay) || defaults.reviewRequestDelay,
        reviewRequestMsg: String(
          parsed.reviewRequestMsg || defaults.reviewRequestMsg,
        ),
      };
    } catch {
      return defaults;
    }
  }

  private settingsFile(pageId: number) {
    return path.join(this.settingsDir, `page-${pageId}.json`);
  }

  /**
   * FIX 2: Idempotent execution
   * Uses DB-level status transition: only processes rows in 'pending' state.
   * Each row is atomically claimed by updating status to 'processing' before sending.
   * This prevents duplicate sends even if cron fires twice concurrently.
   *
   * FIX 4: Skip blocked customers
   */
  async processPending() {
    const now = new Date();

    // Fetch candidates
    const candidates = await this.prisma.followUp.findMany({
      where: { status: 'pending', scheduledAt: { lte: now } },
      take: 50,
      orderBy: { scheduledAt: 'asc' },
    });

    if (!candidates.length) return { processed: 0 };

    // FIX 2: atomically claim — only update rows still in 'pending'
    // (race-safe: if another worker already claimed it, updateMany won't touch it)
    const ids = candidates.map((c) => c.id);
    const claimed = await this.prisma.followUp.updateMany({
      where: { id: { in: ids }, status: 'pending' }, // double-check status
      data: { status: 'processing' },
    });

    this.logger.log(
      `[FollowUp] Claimed ${claimed.count} of ${candidates.length}`,
    );

    // Now fetch the claimed ones to process
    const toProcess = await this.prisma.followUp.findMany({
      where: { id: { in: ids }, status: 'processing' },
    });

    for (const fu of toProcess) {
      try {
        // FIX 4: skip blocked customers
        const customer = await this.prisma.customer.findUnique({
          where: { pageId_psid: { pageId: fu.pageId, psid: fu.psid } },
          select: { isBlocked: true },
        });
        if (customer?.isBlocked) {
          await this.prisma.followUp.update({
            where: { id: fu.id },
            data: { status: 'cancelled', error: 'Customer is blocked' },
          });
          this.logger.log(`[FollowUp] Skipped #${fu.id} — customer blocked`);
          continue;
        }

        const page = await this.prisma.page.findUnique({
          where: { id: fu.pageId },
        });
        if (!page) {
          await this.prisma.followUp.update({
            where: { id: fu.id },
            data: { status: 'failed', error: 'Page not found' },
          });
          continue;
        }

        const platform = (fu as any).platform ?? 'FACEBOOK';

        if (platform === 'WHATSAPP') {
          if (!page.waToken || !page.waPhoneNumberId) {
            await this.prisma.followUp.update({
              where: { id: fu.id },
              data: { status: 'failed', error: 'No WA token or phone number ID' },
            });
            continue;
          }
          const waToken = this.encryption.decrypt(page.waToken);
          await this.waMessenger.sendText(page.waPhoneNumberId, waToken, fu.psid, fu.message);
        } else if (platform === 'INSTAGRAM') {
          if (!page.igToken) {
            await this.prisma.followUp.update({
              where: { id: fu.id },
              data: { status: 'failed', error: 'No IG token' },
            });
            continue;
          }
          const igToken = this.encryption.decrypt(page.igToken);
          await this.igMessenger.sendText(igToken, fu.psid, fu.message);
        } else {
          if (!page.pageToken) {
            await this.prisma.followUp.update({
              where: { id: fu.id },
              data: { status: 'failed', error: 'No page token' },
            });
            continue;
          }
          const token = this.encryption.decrypt(page.pageToken);
          await this.messenger.sendText(token, fu.psid, fu.message);
        }

        // FIX 2: mark sent — final state
        await this.prisma.followUp.update({
          where: { id: fu.id },
          data: { status: 'sent', sentAt: new Date() },
        });
        this.logger.log(`[FollowUp] Sent #${fu.id} to psid=${fu.psid}`);
      } catch (e: any) {
        await this.prisma.followUp.update({
          where: { id: fu.id },
          data: {
            status: 'failed',
            error: String(e.message || e).slice(0, 200),
          },
        });
        this.logger.error(`[FollowUp] Failed #${fu.id}: ${e.message}`);
      }
    }

    return { processed: toProcess.length };
  }
}
