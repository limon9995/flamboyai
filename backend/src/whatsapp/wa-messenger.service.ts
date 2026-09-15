import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { MessageLogService } from '../inbox/inbox.module';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = [1000, 2000, 4000];

export interface WaListSection {
  title: string;
  rows: { id: string; title: string; description?: string }[];
}

@Injectable()
export class WaMessengerService {
  private readonly logger = new Logger(WaMessengerService.name);
  private readonly storageRoot = path.join(process.cwd(), 'storage', 'wa-media');

  constructor(private readonly messageLog: MessageLogService) {
    fs.mkdirSync(this.storageRoot, { recursive: true });
  }

  /**
   * WhatsApp Cloud API only gives a media_id in the webhook payload (unlike
   * Facebook's direct CDN URL) — resolve it, download the bytes, and save to
   * local storage so the existing URL-based OCR/vision/Whisper pipelines
   * (built for Facebook's public CDN URLs) can be reused unchanged.
   */
  async downloadMediaToStorage(
    mediaId: string,
    rawToken: string,
    pageId: number,
  ): Promise<{ url: string; contentType: string } | null> {
    try {
      const metaRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
        headers: { Authorization: `Bearer ${rawToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!metaRes.ok) {
        this.logger.warn(`[WaMessenger] media metadata fetch failed status=${metaRes.status} mediaId=${mediaId}`);
        return null;
      }
      const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
      if (!meta.url) return null;

      const fileRes = await fetch(meta.url, {
        headers: { Authorization: `Bearer ${rawToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!fileRes.ok) {
        this.logger.warn(`[WaMessenger] media download failed status=${fileRes.status} mediaId=${mediaId}`);
        return null;
      }
      const buffer = Buffer.from(await fileRes.arrayBuffer());
      const contentType = meta.mime_type || fileRes.headers.get('content-type') || 'application/octet-stream';
      const ext = this.extFromContentType(contentType);

      const pageDir = path.join(this.storageRoot, `page-${pageId}`);
      fs.mkdirSync(pageDir, { recursive: true });
      const fname = `${crypto.randomUUID()}${ext}`;
      fs.writeFileSync(path.join(pageDir, fname), buffer);

      const base = (process.env.STORAGE_PUBLIC_URL || 'http://localhost:3000/storage').replace(/\/$/, '');
      return { url: `${base}/wa-media/page-${pageId}/${fname}`, contentType };
    } catch (err) {
      this.logger.error(`[WaMessenger] downloadMediaToStorage failed mediaId=${mediaId}: ${err}`);
      return null;
    }
  }

  private extFromContentType(contentType: string): string {
    if (contentType.includes('png')) return '.png';
    if (contentType.includes('webp')) return '.webp';
    if (contentType.includes('ogg')) return '.ogg';
    if (contentType.includes('mpeg') || contentType.includes('mp3')) return '.mp3';
    if (contentType.includes('mp4') || contentType.includes('m4a')) return '.m4a';
    if (contentType.includes('amr')) return '.amr';
    return '.jpg';
  }

  async sendImage(
    phoneNumberId: string,
    rawToken: string,
    to: string,
    imageUrl: string,
    caption?: string,
  ): Promise<void> {
    if (!phoneNumberId || !rawToken || !to || !imageUrl) return;

    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
    const body = JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'image',
      image: { link: imageUrl, ...(caption ? { caption } : {}) },
    });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawToken}` },
          body,
        });
        if (res.ok) {
          this.logger.debug(`[WaMessenger] Image sent to=${to}`);
          return;
        }
        const errText = await res.text().catch(() => '');
        if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS[attempt]));
          continue;
        }
        this.logger.error(`[WaMessenger] Image send failed status=${res.status} to=${to} body=${errText.slice(0, 200)}`);
        return;
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS[attempt]));
        } else {
          this.logger.error(`[WaMessenger] Image network error to=${to} (exhausted): ${err}`);
        }
      }
    }
  }

  /** WhatsApp's carousel analog — an interactive list message (max 10 rows across sections). */
  async sendInteractiveList(
    phoneNumberId: string,
    rawToken: string,
    to: string,
    bodyText: string,
    buttonText: string,
    sections: WaListSection[],
  ): Promise<void> {
    if (!phoneNumberId || !rawToken || !to || !sections.length) return;

    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
    const body = JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: bodyText.slice(0, 1024) },
        action: { button: buttonText.slice(0, 20), sections },
      },
    });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawToken}` },
          body,
        });
        if (res.ok) {
          this.logger.debug(`[WaMessenger] Interactive list sent to=${to}`);
          return;
        }
        const errText = await res.text().catch(() => '');
        if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS[attempt]));
          continue;
        }
        this.logger.error(`[WaMessenger] Interactive list send failed status=${res.status} to=${to} body=${errText.slice(0, 200)}`);
        return;
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS[attempt]));
        } else {
          this.logger.error(`[WaMessenger] Interactive list network error to=${to} (exhausted): ${err}`);
        }
      }
    }
  }

  /**
   * Send a text message via WhatsApp Cloud API.
   * phoneNumberId: Meta phone number ID
   * rawToken: decrypted WA access token
   * to: recipient wa_id (phone number e.g. "8801712345678")
   */
  /**
   * Send an approved WhatsApp template message.
   * Used when the 24h messaging window has expired.
   * templateName must be pre-approved in Meta Business Manager.
   * languageCode defaults to 'en_US'.
   */
  async sendTemplate(
    phoneNumberId: string,
    rawToken: string,
    to: string,
    templateName: string,
    languageCode = 'en_US',
    components: any[] = [],
  ): Promise<void> {
    if (!phoneNumberId || !rawToken || !to || !templateName) {
      this.logger.warn(`[WaMessenger] sendTemplate missing params to=${to}`);
      return;
    }

    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
    const body = JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components.length ? { components } : {}),
      },
    });

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
          this.logger.debug(`[WaMessenger] Template sent to=${to} template=${templateName}`);
          return;
        }

        const errText = await res.text().catch(() => '');

        if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS[attempt];
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        this.logger.error(
          `[WaMessenger] Template send failed status=${res.status} to=${to} body=${errText.slice(0, 200)}`,
        );
        return;
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS[attempt]));
        } else {
          this.logger.error(`[WaMessenger] Template network error to=${to} (exhausted): ${err}`);
        }
      }
    }
  }

  async sendText(
    phoneNumberId: string,
    rawToken: string,
    to: string,
    text: string,
  ): Promise<void> {
    if (!phoneNumberId || !rawToken || !to || !text) {
      this.logger.warn(`[WaMessenger] sendText called with missing params to=${to}`);
      return;
    }

    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
    const body = JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: text },
    });

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
          this.logger.debug(`[WaMessenger] Sent to=${to} len=${text.length}`);
          this.messageLog.logByWaPhoneNumberId(phoneNumberId, to, 'OUT', text).catch(() => {});
          return;
        }

        const errText = await res.text().catch(() => '');

        // Detect 24h messaging window expiry (error 131047)
        if (res.status === 400) {
          try {
            const errJson = JSON.parse(errText);
            const errCode = errJson?.error?.code;
            if (errCode === 131047) {
              this.logger.warn(
                `[WaMessenger] 24h window expired for to=${to} — cannot send free-form message. Customer must message first or use approved template.`,
              );
              return;
            }
          } catch {}
        }

        if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS[attempt];
          this.logger.warn(
            `[WaMessenger] status=${res.status} to=${to} — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        this.logger.error(
          `[WaMessenger] Send failed status=${res.status} to=${to} body=${errText.slice(0, 200)}`,
        );
        return;
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS[attempt];
          this.logger.warn(
            `[WaMessenger] Network error to=${to} — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`,
          );
          await new Promise((r) => setTimeout(r, delay));
        } else {
          this.logger.error(`[WaMessenger] Network error to=${to} (exhausted): ${err}`);
        }
      }
    }
  }
}
