import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type MessagePlatform = 'FACEBOOK' | 'INSTAGRAM' | 'WHATSAPP' | 'TELEGRAM';
export type MessageDirection = 'IN' | 'OUT';

/**
 * Writes every inbound/outbound customer message into the unified Message
 * log that powers the dashboard Inbox. Logging must never break the actual
 * messaging pipeline, so every method swallows its own errors.
 */
@Injectable()
export class MessageLogService {
  private readonly logger = new Logger(MessageLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async logByPageId(params: {
    pageId: number;
    customerPsid: string;
    platform: MessagePlatform;
    direction: MessageDirection;
    type?: string;
    content?: string | null;
    externalId?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.message.create({
        data: {
          pageId: params.pageId,
          customerPsid: params.customerPsid,
          platform: params.platform,
          direction: params.direction,
          type: params.type ?? 'text',
          content: params.content ?? null,
          externalId: params.externalId ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`[Inbox] log failed pageId=${params.pageId}: ${err}`);
    }
  }

  /** FB Messenger send/webhook calls carry the page's still-encrypted pageToken, which is unique per Page row. */
  async logByFbPageToken(
    pageToken: string,
    psid: string,
    direction: MessageDirection,
    content: string,
    type: string = 'text',
  ): Promise<void> {
    try {
      const page = await this.prisma.page.findFirst({ where: { pageToken } });
      if (!page) return;
      await this.logByPageId({
        pageId: page.id,
        customerPsid: psid,
        platform: 'FACEBOOK',
        direction,
        type,
        content,
      });
    } catch (err) {
      this.logger.warn(`[Inbox] logByFbPageToken failed: ${err}`);
    }
  }

  /** WhatsApp Cloud API sends are identified by the sender's phoneNumberId, unique per Page row. */
  async logByWaPhoneNumberId(
    phoneNumberId: string,
    psid: string,
    direction: MessageDirection,
    content: string,
    type: string = 'text',
  ): Promise<void> {
    try {
      const page = await this.prisma.page.findFirst({ where: { waPhoneNumberId: phoneNumberId } });
      if (!page) return;
      await this.logByPageId({
        pageId: page.id,
        customerPsid: psid,
        platform: 'WHATSAPP',
        direction,
        type,
        content,
      });
    } catch (err) {
      this.logger.warn(`[Inbox] logByWaPhoneNumberId failed: ${err}`);
    }
  }
}
