import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../common/mailer.service';
import { OrderActionTokenService } from './order-action-token.service';

const API_BASE = process.env.API_BASE_URL || 'https://api.flamboyai.com';
const DASHBOARD_BASE = 'https://app.flamboyai.com';

@Injectable()
export class OrderOwnerMailerService {
  private readonly logger = new Logger(OrderOwnerMailerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly actionToken: OrderActionTokenService,
  ) {}

  /** Owner email alert for a new/confirmed order, with View/Reject action links. */
  async sendNewOrderAlert(pageId: number, orderId: number): Promise<void> {
    try {
      const page = await this.prisma.page.findUnique({
        where: { id: pageId },
        select: {
          orderEmailNotifEnabled: true,
          businessName: true,
          owner: { select: { email: true } },
        },
      });
      if (!page?.orderEmailNotifEnabled || !page.owner?.email) return;

      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order) return;

      const subtotal = order.items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
      const itemsHtml = order.items
        .map((i) => `<li>${i.productCode} × ${i.qty} — ৳${i.unitPrice * i.qty}</li>`)
        .join('');

      const viewUrl = `${DASHBOARD_BASE}/orders?pageId=${pageId}&highlight=${orderId}`;
      const rejectToken = this.actionToken.build({ orderId, pageId, action: 'reject' });
      const rejectUrl = `${API_BASE}/public/order/action/reject/${rejectToken}`;

      await this.mailer
        .sendMail(
          page.owner.email,
          `🛒 নতুন Order #${order.id}${page.businessName ? ` — ${page.businessName}` : ''}`,
          `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
            <h2 style="color:#4f46e5">🛒 New Order #${order.id}</h2>
            <p><b>${order.customerName}</b><br/>${order.phone ?? '-'}<br/>${order.address ?? '-'}</p>
            <ul style="padding-left:18px">${itemsHtml}</ul>
            <p><b>Total: ৳${subtotal}</b></p>
            <p>
              <a href="${viewUrl}" style="display:inline-block;padding:10px 20px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:6px;margin-right:8px">View</a>
              <a href="${rejectUrl}" style="display:inline-block;padding:10px 20px;background:#dc2626;color:#fff;text-decoration:none;border-radius:6px">Reject</a>
            </p>
          </div>`,
        )
        .catch(() => {});
    } catch (e: any) {
      this.logger.error(
        `[OrderOwnerMailer] sendNewOrderAlert failed pageId=${pageId} orderId=${orderId}: ${e.message}`,
      );
    }
  }

  /**
   * Owner alert for an AI-flagged escalation (complaint/refund/etc. — see the
   * ESCALATE action in smart-bot.service.ts). SECURITY: this method takes no
   * email/destination parameter at all — the destination is always resolved
   * here, fresh, from page.owner.email, exactly like sendNewOrderAlert above.
   * `issueSummary` is the AI's reply text, used only as email BODY content —
   * it can never become the destination, no matter what a client's custom
   * prompt instructs the model to say.
   */
  async sendEscalationAlert(
    pageId: number,
    psid: string,
    issueSummary: string,
  ): Promise<void> {
    try {
      const page = await this.prisma.page.findUnique({
        where: { id: pageId },
        select: {
          orderEmailNotifEnabled: true,
          businessName: true,
          owner: { select: { email: true } },
        },
      });
      if (!page?.orderEmailNotifEnabled || !page.owner?.email) return;

      await this.mailer
        .sendMail(
          page.owner.email,
          `⚠️ Customer complaint/escalation${page.businessName ? ` — ${page.businessName}` : ''}`,
          `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
            <h2 style="color:#dc2626">⚠️ Escalation — needs your attention</h2>
            <p><b>Customer PSID:</b> ${psid}</p>
            <p>${issueSummary}</p>
          </div>`,
        )
        .catch(() => {});
    } catch (e: any) {
      this.logger.error(
        `[OrderOwnerMailer] sendEscalationAlert failed pageId=${pageId} psid=${psid}: ${e.message}`,
      );
    }
  }
}
