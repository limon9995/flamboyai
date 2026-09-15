import { Injectable, Logger } from '@nestjs/common';
import { MessageLogService } from '../inbox/inbox.module';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = [1000, 2000, 4000];

@Injectable()
export class IgMessengerService {
  private readonly logger = new Logger(IgMessengerService.name);

  constructor(private readonly messageLog: MessageLogService) {}

  /** Send a DM reply via Instagram Messenger API. `pageId` (dashboard page id, if known) enables Inbox logging. */
  async sendText(
    rawToken: string,
    recipientId: string,
    text: string,
    pageId?: number,
  ): Promise<void> {
    if (!rawToken || !recipientId || !text) {
      this.logger.warn(`[IgMessenger] sendText missing params recipientId=${recipientId}`);
      return;
    }

    const url = `https://graph.facebook.com/v20.0/me/messages`;
    const body = JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
      messaging_type: 'RESPONSE',
    });

    const ok = await this.postWithRetry(url, rawToken, body, `DM recipientId=${recipientId}`);
    if (ok && pageId) {
      this.messageLog
        .logByPageId({ pageId, customerPsid: recipientId, platform: 'INSTAGRAM', direction: 'OUT', content: text })
        .catch(() => {});
    }
  }

  /** Reply to an Instagram post comment */
  async sendCommentReply(rawToken: string, commentId: string, message: string): Promise<void> {
    if (!rawToken || !commentId || !message) {
      this.logger.warn(`[IgMessenger] sendCommentReply missing params commentId=${commentId}`);
      return;
    }

    const url = `https://graph.facebook.com/v20.0/${commentId}/replies`;
    const body = JSON.stringify({ message });

    await this.postWithRetry(url, rawToken, body, `comment reply commentId=${commentId}`);
  }

  private async postWithRetry(url: string, rawToken: string, body: string, label: string): Promise<boolean> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${rawToken}`,
          },
          body,
        });

        if (res.ok) {
          this.logger.debug(`[IgMessenger] Sent ${label}`);
          return true;
        }

        const errText = await res.text().catch(() => '');

        if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS[attempt];
          this.logger.warn(
            `[IgMessenger] status=${res.status} ${label} — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        this.logger.error(
          `[IgMessenger] Send failed status=${res.status} ${label} body=${errText.slice(0, 200)}`,
        );
        return false;
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS[attempt];
          this.logger.warn(
            `[IgMessenger] Network error ${label} — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`,
          );
          await new Promise((r) => setTimeout(r, delay));
        } else {
          this.logger.error(`[IgMessenger] Network error ${label} (exhausted): ${err}`);
        }
      }
    }
    return false;
  }
}
