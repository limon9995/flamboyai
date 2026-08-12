import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MessengerService } from '../messenger/messenger.service';
import { BotKnowledgeService } from '../bot-knowledge/bot-knowledge.service';
import { FollowUpService } from '../followup/followup.service';

/**
 * Sends automated Messenger messages to customers when key order events happen.
 *
 * Events:
 *   order_confirmed    — Agent confirms order from dashboard
 *   order_courier_sent — Order booked with courier
 *
 * Message templates are stored in the question bank (systemReplies)
 * so each page owner can customize them.
 */
@Injectable()
export class OrderNotificationService {
  private readonly logger = new Logger(OrderNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messenger: MessengerService,
    private readonly knowledge: BotKnowledgeService,
    private readonly followUp: FollowUpService,
  ) {}

  /** Send order-confirmed message to customer. */
  async notifyConfirmed(pageId: number, orderId: number): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) return;
    const itemLines = order.items
      .map((i: any) => `• ${i.productName || i.productCode} × ${i.qty} = ৳${i.unitPrice * i.qty}`)
      .join('\n');
    const subtotal = order.items.reduce((s: number, i: any) => s + i.unitPrice * i.qty, 0);
    const advance = (order as any).advanceAmount ?? 0;
    const discounts =
      (order.loyaltyDiscountAmount || 0) +
      (order.happyHourDiscountAmount || 0) +
      (order.milestoneDiscountAmount || 0);
    const dueAmount = Math.max(0, subtotal - advance - discounts);
    const editLink = (order as any).editToken
      ? `https://flamboyai.com/order?token=${(order as any).editToken}`
      : null;

    let rewardLine = '';
    if (order.milestoneRewardAppliedJson) {
      try {
        const parsed = JSON.parse(order.milestoneRewardAppliedJson);
        const rewards: any[] = Array.isArray(parsed) ? parsed : [parsed];
        const lines = rewards.map((r) =>
          r.rewardType === 'FREE_DELIVERY'
            ? '🎁 অভিনন্দন! এই অর্ডারে আপনি ফ্রি ডেলিভারি পেয়েছেন।'
            : r.rewardType === 'DISCOUNT'
              ? `🎁 অভিনন্দন! এই অর্ডারে আপনি ${r.discountPercent}% ছাড় পেয়েছেন।`
              : `🎁 অভিনন্দন! এই অর্ডারে আপনি ফ্রি ${r.productName || ''} পেয়েছেন।`,
        );
        if (lines.length) rewardLine = '\n\n' + lines.join('\n');
      } catch {
        /* ignore malformed snapshot */
      }
    }

    await this.send(pageId, orderId, 'order_confirmed', {
      items: (itemLines || '—') + rewardLine,
      phone: order.phone || '—',
      address: order.address || '—',
      total: subtotal,
      advancePaid: advance,
      dueAmount,
      editLink: editLink || '—',
    });
  }

  /** Send courier-booked message to customer. */
  async notifyCourierSent(
    pageId: number,
    orderId: number,
    opts: {
      courierName: string;
      trackingId: string | null;
    },
  ): Promise<void> {
    await this.send(pageId, orderId, 'order_courier_sent', {
      courierName: opts.courierName || 'Courier',
      trackingId: opts.trackingId || '—',
    });
  }

  /** Send delivery-done message to customer. */
  async notifyDelivered(pageId: number, orderId: number): Promise<void> {
    await this.send(pageId, orderId, 'order_delivered', {});
  }

  /**
   * Schedule a delayed "please review your order" follow-up, gated by the
   * merchant's reviewRequestEnabled toggle (FollowUpPage settings). Reuses
   * Order.editToken to build the review link — no separate auth token needed.
   * Only fires for orders reachable via Messenger/WhatsApp/Instagram (needs
   * a customerPsid), same limitation as the other automated follow-ups.
   */
  async scheduleReviewFollowUp(pageId: number, orderId: number): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({ where: { id: orderId } });
      if (!order || !order.customerPsid || order.pageIdRef !== pageId) return;
      const settings = await this.followUp.getSettings(pageId);
      if (!settings.reviewRequestEnabled) return;
      const reviewLink = `https://flamboyai.com/review?token=${order.editToken}`;
      await this.followUp.schedule(pageId, {
        psid: order.customerPsid,
        orderId,
        triggerType: 'review_request',
        message: settings.reviewRequestMsg
          .replace('{{orderId}}', String(orderId))
          .replace('{{reviewLink}}', reviewLink),
        delayHours: settings.reviewRequestDelay,
      });
    } catch (err) {
      this.logger.warn(`[OrderNotify] Failed to schedule review request for order #${orderId}: ${err}`);
    }
  }

  /** Send delivery-cancelled message to customer. */
  async notifyDeliveryCancelled(pageId: number, orderId: number): Promise<void> {
    await this.send(pageId, orderId, 'order_delivery_cancelled', {});
  }

  /** Send order-cancelled message to customer — once, at the moment of cancellation. */
  async notifyCancelled(
    pageId: number,
    orderId: number,
    cancelNote?: string | null,
  ): Promise<void> {
    const note = cancelNote?.trim();
    await this.send(pageId, orderId, 'order_cancelled', {
      cancelNoteBlock: note ? `\n\nকারণ: ${note}` : '',
    });
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async send(
    pageId: number,
    orderId: number,
    key: string,
    vars: Record<string, any>,
  ): Promise<void> {
    this.logger.log(
      `[OrderNotify] send() called key=${key} pageId=${pageId} orderId=${orderId} caller-stack=${new Error().stack?.split('\n').slice(2, 5).join(' | ')}`,
    );
    try {
      // Get order — need customerPsid
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
      });
      if (!order || !order.customerPsid || order.pageIdRef !== pageId) {
        this.logger.warn(
          `[OrderNotify] ${key} skipped — order not found / no psid / page mismatch (orderId=${orderId})`,
        );
        return;
      }

      // Get page token
      const page = await this.prisma.page.findUnique({ where: { id: pageId } });
      if (!page || !page.pageToken) {
        this.logger.warn(`[OrderNotify] ${key} skipped — page/pageToken missing (pageId=${pageId})`);
        return;
      }

      // Resolve template with order-specific variables
      const text = await this.knowledge.resolveSystemReply(pageId, key, {
        ...vars,
        orderId: orderId,
        customerName: order.customerName || '',
      });

      if (!text) {
        this.logger.warn(`[OrderNotify] ${key} skipped — resolved template was empty (orderId=${orderId})`);
        return;
      }

      await this.messenger.sendText(page.pageToken, order.customerPsid, text);
      this.logger.log(
        `[OrderNotify] ${key} → psid=${order.customerPsid} order=#${orderId}`,
      );
    } catch (err) {
      // Never crash the main flow — notification is best-effort
      this.logger.warn(
        `[OrderNotify] Failed to send ${key} for order #${orderId}: ${err}`,
      );
    }
  }
}
