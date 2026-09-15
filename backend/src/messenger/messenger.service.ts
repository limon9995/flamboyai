import { Injectable, Logger } from '@nestjs/common';
import { EncryptionService } from '../common/encryption.service';
import { MessageLogService } from '../inbox/inbox.module';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = [1000, 2000, 4000]; // exponential backoff

@Injectable()
export class MessengerService {
  private readonly logger = new Logger(MessengerService.name);

  constructor(
    private readonly encryption: EncryptionService,
    private readonly messageLog: MessageLogService,
  ) {}

  /**
   * Send a text message via Facebook Messenger Send API.
   * Retries up to 3× on 429 (rate limit) or 5xx errors with exponential backoff.
   */
  async sendText(
    pageToken: string,
    psid: string,
    text: string,
    tag?: string,
  ): Promise<void> {
    if (!pageToken || !psid || !text) {
      this.logger.warn(
        `[Messenger] sendText called with missing params: psid=${psid}`,
      );
      return;
    }

    const rawToken = this.encryption.decrypt(pageToken);
    const url = `https://graph.facebook.com/v20.0/me/messages?access_token=${encodeURIComponent(rawToken)}`;
    const payload: Record<string, unknown> = {
      recipient: { id: psid },
      message: { text },
    };
    if (tag) {
      payload.messaging_type = 'MESSAGE_TAG';
      payload.tag = tag;
    }
    const body = JSON.stringify(payload);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });

        if (res.ok) {
          this.logger.log(`[Messenger] Sent psid=${psid} len=${text.length}`);
          this.messageLog.logByFbPageToken(pageToken, psid, 'OUT', text).catch(() => {});
          return;
        }

        const errText = await res.text().catch(() => '');

        // Rate limited or server error — retry with backoff
        if (
          (res.status === 429 || res.status >= 500) &&
          attempt < MAX_RETRIES
        ) {
          const delay = RETRY_DELAY_MS[attempt];
          this.logger.warn(
            `[Messenger] status=${res.status} psid=${psid} — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        // 4xx (except 429) or exhausted retries — log and give up
        this.logger.error(
          `[Messenger] Send failed status=${res.status} psid=${psid} body=${errText.slice(0, 200)}`,
        );
        return;
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS[attempt];
          this.logger.warn(
            `[Messenger] Network error psid=${psid} — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`,
          );
          await new Promise((r) => setTimeout(r, delay));
        } else {
          this.logger.error(
            `[Messenger] Network error psid=${psid} (exhausted retries): ${err}`,
          );
        }
      }
    }
  }

  /**
   * Send a sender_action (e.g. 'typing_on', 'typing_off', 'mark_seen') so the
   * customer sees a "typing…" indicator before the bot replies — makes the bot
   * feel like a real person. Best-effort: never throws, no retry (it's cosmetic).
   */
  async sendSenderAction(
    pageToken: string,
    psid: string,
    action: 'typing_on' | 'typing_off' | 'mark_seen' = 'typing_on',
  ): Promise<void> {
    if (!pageToken || !psid) return;
    try {
      const rawToken = this.encryption.decrypt(pageToken);
      const url = `https://graph.facebook.com/v20.0/me/messages?access_token=${encodeURIComponent(rawToken)}`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: psid }, sender_action: action }),
      });
    } catch (err) {
      // Cosmetic only — swallow errors so it never blocks the actual reply
      this.logger.debug(`[Messenger] sender_action failed psid=${psid}: ${err}`);
    }
  }

  // Cache Facebook profile names so we don't hit the Graph API on every message.
  private readonly profileCache = new Map<string, { name: string | null; ts: number }>();
  private readonly PROFILE_TTL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Fetch the customer's Facebook first name for a PSID (so the bot can greet
   * "প্রিয় <name>" before they've given their order name). Cached for an hour;
   * returns null if unavailable (privacy settings, error) — caller must handle.
   */
  async getUserFirstName(pageToken: string, psid: string): Promise<string | null> {
    if (!pageToken || !psid) return null;
    const cached = this.profileCache.get(psid);
    if (cached && Date.now() - cached.ts < this.PROFILE_TTL_MS) return cached.name;
    try {
      const rawToken = this.encryption.decrypt(pageToken);
      const url = `https://graph.facebook.com/${encodeURIComponent(psid)}?fields=first_name&access_token=${encodeURIComponent(rawToken)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      let name: string | null = null;
      if (res.ok) {
        const data = (await res.json()) as any;
        name = data?.first_name ? String(data.first_name).trim() || null : null;
      }
      this.profileCache.set(psid, { name, ts: Date.now() });
      if (this.profileCache.size > 5000) {
        const cutoff = Date.now() - this.PROFILE_TTL_MS;
        for (const [k, v] of this.profileCache) {
          if (v.ts < cutoff) this.profileCache.delete(k);
        }
      }
      return name;
    } catch {
      return null;
    }
  }

  async sendCommentReply(pageToken: string, commentId: string, text: string): Promise<void> {
    if (!pageToken || !commentId || !text) return;
    const rawToken = this.encryption.decrypt(pageToken);
    const url = `https://graph.facebook.com/v20.0/${encodeURIComponent(commentId)}/comments?access_token=${encodeURIComponent(rawToken)}`;
    const body = JSON.stringify({ message: text });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        if (res.ok) {
          this.logger.debug(`[Messenger] Comment reply sent commentId=${commentId}`);
          return;
        }
        const errText = await res.text().catch(() => '');
        if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS[attempt]));
          continue;
        }
        this.logger.error(`[Messenger] Comment reply failed status=${res.status} body=${errText.slice(0, 200)}`);
        return;
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS[attempt]));
        } else {
          this.logger.error(`[Messenger] Comment reply network error: ${err}`);
        }
      }
    }
  }

  async likeComment(pageToken: string, commentId: string): Promise<void> {
    if (!pageToken || !commentId) return;
    const rawToken = this.encryption.decrypt(pageToken);
    const url = `https://graph.facebook.com/v20.0/${encodeURIComponent(commentId)}/reactions?type=LOVE&access_token=${encodeURIComponent(rawToken)}`;
    try {
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        this.logger.warn(`[Messenger] Comment like failed status=${res.status} body=${err.slice(0, 100)}`);
      }
    } catch (err) {
      this.logger.warn(`[Messenger] Comment like network error: ${err}`);
    }
  }

  async sendSubscribeButton(encryptedToken: string, psid: string): Promise<void> {
    if (!encryptedToken || !psid) return;
    const rawToken = this.encryption.decrypt(encryptedToken);
    const url = `https://graph.facebook.com/v20.0/me/messages?access_token=${encodeURIComponent(rawToken)}`;
    const payload = {
      recipient: { id: psid },
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'one_time_notif_req',
            title: '🔔 নতুন পণ্য ও অফারের আপডেট পেতে চান?',
            payload: 'RECURRING_SUBSCRIBE_WEEKLY',
          },
        },
      },
    };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        this.logger.error(`[Messenger] Subscribe button failed: ${err.slice(0, 200)}`);
      }
    } catch (err) {
      this.logger.error(`[Messenger] Subscribe button network error: ${err}`);
    }
  }

  /** Send a single image attachment (e.g. the restaurant's menu photo). */
  async sendImage(
    encryptedToken: string,
    psid: string,
    imageUrl: string,
  ): Promise<void> {
    if (!encryptedToken || !psid || !imageUrl) return;
    const rawToken = this.encryption.decrypt(encryptedToken);
    const url = `https://graph.facebook.com/v20.0/me/messages?access_token=${encodeURIComponent(rawToken)}`;
    const body = JSON.stringify({
      recipient: { id: psid },
      message: {
        attachment: {
          type: 'image',
          payload: { url: imageUrl, is_reusable: true },
        },
      },
    });
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        this.logger.error(
          `[Messenger] sendImage failed status=${res.status} psid=${psid} body=${errText.slice(0, 150)}`,
        );
      }
    } catch (err) {
      this.logger.error(`[Messenger] sendImage network error psid=${psid}: ${err}`);
    }
  }

  async sendGenericTemplate(
    encryptedToken: string,
    psid: string,
    elements: Array<{
      title: string;
      image_url?: string;
      subtitle?: string;
      buttons?: Array<{
        type: 'web_url' | 'postback';
        url?: string;
        title: string;
        payload?: string;
      }>;
    }>,
  ): Promise<void> {
    if (!encryptedToken || !psid || !elements || elements.length === 0) return;
    const rawToken = this.encryption.decrypt(encryptedToken);
    const url = `https://graph.facebook.com/v20.0/me/messages?access_token=${encodeURIComponent(rawToken)}`;
    
    const payload = {
      recipient: { id: psid },
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'generic',
            // 'square' (1:1) crops far less aggressively than Facebook's default
            // 'horizontal' (1.91:1) — most product photos here are portrait shots,
            // which get cut off top/bottom under the horizontal default.
            image_aspect_ratio: 'square',
            elements: elements.slice(0, 10).map((el) => ({
              title: el.title.slice(0, 80),
              image_url: el.image_url || undefined,
              subtitle: el.subtitle ? el.subtitle.slice(0, 80) : undefined,
              buttons: el.buttons && el.buttons.length > 0 ? el.buttons.slice(0, 3).map((btn) => {
                if (btn.type === 'web_url') {
                  return {
                    type: 'web_url',
                    url: btn.url,
                    title: btn.title.slice(0, 20),
                    webview_height_ratio: 'full',
                  };
                } else {
                  return {
                    type: 'postback',
                    title: btn.title.slice(0, 20),
                    payload: btn.payload,
                  };
                }
              }) : undefined,
            })),
          },
        },
      },
    };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          this.logger.debug(`[Messenger] Sent generic template psid=${psid} count=${elements.length}`);
          return;
        }

        const errText = await res.text().catch(() => '');
        if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS[attempt];
          this.logger.warn(`[Messenger] Generic template status=${res.status} psid=${psid} — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        this.logger.error(`[Messenger] Generic template failed status=${res.status} psid=${psid} body=${errText.slice(0, 200)}`);
        return;
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS[attempt];
          this.logger.warn(`[Messenger] Generic template network error psid=${psid} — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
          await new Promise((r) => setTimeout(r, delay));
        } else {
          this.logger.error(`[Messenger] Generic template network error psid=${psid} (exhausted retries): ${err}`);
        }
      }
    }
  }
}
