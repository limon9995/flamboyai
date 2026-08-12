import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/encryption.service';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = [1000, 2000, 4000];

@Injectable()
export class TelegramNotificationService {
  private readonly logger = new Logger(TelegramNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /** Send a merchant alert for a given page, if Telegram is configured and enabled. */
  async notify(pageId: number, message: string): Promise<void> {
    try {
      const page = await this.prisma.page.findUnique({
        where: { id: pageId },
        select: {
          telegramNotifEnabled: true,
          telegramBotToken: true,
          telegramChatId: true,
        },
      });
      if (
        !page?.telegramNotifEnabled ||
        !page.telegramBotToken ||
        !page.telegramChatId
      ) {
        return;
      }
      const token = this.encryption.decrypt(page.telegramBotToken);
      await this.send(token, page.telegramChatId, message);
    } catch (err: any) {
      this.logger.error(
        `[Telegram] notify failed pageId=${pageId}: ${err.message}`,
      );
    }
  }

  /**
   * Send a message with Telegram inline keyboard buttons.
   * buttons: array of rows, each row is array of { text, callback_data } or { text, url }
   */
  async notifyWithButtons(
    pageId: number,
    message: string,
    buttons: Array<
      Array<{ text: string; callback_data?: string; url?: string }>
    >,
  ): Promise<void> {
    try {
      const page = await this.prisma.page.findUnique({
        where: { id: pageId },
        select: {
          telegramNotifEnabled: true,
          telegramBotToken: true,
          telegramChatId: true,
        },
      });
      if (
        !page?.telegramNotifEnabled ||
        !page.telegramBotToken ||
        !page.telegramChatId
      )
        return;
      const token = this.encryption.decrypt(page.telegramBotToken);
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const body = JSON.stringify({
        chat_id: page.telegramChatId,
        text: message,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons },
      });
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok)
        this.logger.log(
          `[Telegram] Sent with buttons chat_id=${page.telegramChatId}`,
        );
      else
        this.logger.warn(`[Telegram] notifyWithButtons failed: ${res.status}`);
    } catch (err: any) {
      this.logger.error(
        `[Telegram] notifyWithButtons error pageId=${pageId}: ${err.message}`,
      );
    }
  }

  /** Answer a Telegram callback_query (removes loading spinner on button). */
  async answerCallback(
    token: string,
    callbackQueryId: string,
    text?: string,
  ): Promise<void> {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text ?? '',
      }),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {});
  }

  /** Set Telegram webhook for a bot token pointing to our server. */
  async setWebhook(
    token: string,
    webhookUrl: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/setWebhook`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // message delivery powers the merchant command panel (permanent
          // keyboard); callback_query powers the inline Confirm/Courier buttons.
          body: JSON.stringify({
            url: webhookUrl,
            allowed_updates: ['callback_query', 'message'],
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      const data = await res.json();
      return data.ok ? { ok: true } : { ok: false, error: data.description };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /** Send a message to the system admin Telegram bot (uses env vars). */
  async sendMessage(text: string): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    try {
      await this.send(token, chatId, text);
    } catch {
      /* non-fatal */
    }
  }

  /** Auto-register Telegram webhook for a page by pageId. */
  async setWebhookForPage(pageId: number, apiBase: string): Promise<void> {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { telegramBotToken: true },
    });
    if (!page?.telegramBotToken) return;
    const token = this.encryption.decrypt(page.telegramBotToken);
    const encryptedToken = this.encryption.encrypt(token);
    const webhookUrl = `${apiBase}/telegram/callback/${encodeURIComponent(encryptedToken)}`;
    await this.setWebhook(token, webhookUrl);
  }

  /** Get the decrypted bot token for a page (used by webhook handler). */
  async getPageByBotToken(
    encryptedToken: string,
  ): Promise<{ id: number; telegramChatId: string; token: string } | null> {
    try {
      const pages = await this.prisma.page.findMany({
        where: { telegramBotToken: encryptedToken },
        select: { id: true, telegramChatId: true, telegramBotToken: true },
        take: 1,
      });
      if (!pages.length) return null;
      const page = pages[0];
      const token = this.encryption.decrypt(page.telegramBotToken!);
      return { id: page.id, telegramChatId: page.telegramChatId!, token };
    } catch {
      return null;
    }
  }

  /** Raw send — public for reuse in webhook handler */
  async sendRaw(token: string, chatId: string, text: string): Promise<void> {
    await this.send(token, chatId, text);
  }

  /**
   * Raw send with inline buttons — no page lookup / telegramNotifEnabled
   * check, because this replies to a command the merchant just typed.
   */
  async sendRawWithButtons(
    token: string,
    chatId: string,
    text: string,
    buttons: Array<
      Array<{ text: string; callback_data?: string; url?: string }>
    >,
  ): Promise<void> {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: buttons },
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!res.ok)
        this.logger.warn(`[Telegram] sendRawWithButtons failed: ${res.status}`);
    } catch (err: any) {
      this.logger.error(
        `[Telegram] sendRawWithButtons error chat_id=${chatId}: ${err.message}`,
      );
    }
  }

  /**
   * Raw send attaching a persistent reply keyboard — the button menu pinned
   * under Telegram's text input. Button presses arrive back as plain text
   * messages on the same webhook.
   */
  async sendRawWithKeyboard(
    token: string,
    chatId: string,
    text: string,
    keyboard: string[][],
  ): Promise<void> {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            reply_markup: {
              keyboard: keyboard.map((row) =>
                row.map((label) => ({ text: label })),
              ),
              resize_keyboard: true,
              is_persistent: true,
            },
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!res.ok)
        this.logger.warn(
          `[Telegram] sendRawWithKeyboard failed: ${res.status}`,
        );
    } catch (err: any) {
      this.logger.error(
        `[Telegram] sendRawWithKeyboard error chat_id=${chatId}: ${err.message}`,
      );
    }
  }

  /** Raw send — public for reuse in webhook handler */
  async sendTest(
    token: string,
    chatId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: '✅ FlamboyAI Telegram notification test successful!',
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (res.ok) return { ok: true };
      const errText = await res.text().catch(() => '');
      return {
        ok: false,
        error: errText.slice(0, 200) || `HTTP ${res.status}`,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /** Send a photo (buffer) to merchant's Telegram — used for payment screenshots */
  async sendPhoto(
    pageId: number,
    photoBuffer: Buffer,
    caption: string,
  ): Promise<void> {
    try {
      const page = await this.prisma.page.findUnique({
        where: { id: pageId },
        select: {
          telegramNotifEnabled: true,
          telegramBotToken: true,
          telegramChatId: true,
        },
      });
      if (
        !page?.telegramNotifEnabled ||
        !page.telegramBotToken ||
        !page.telegramChatId
      )
        return;
      const token = this.encryption.decrypt(page.telegramBotToken);
      const FormData = (await import('form-data')).default;
      const fd = new FormData();
      fd.append('chat_id', page.telegramChatId);
      fd.append('caption', caption);
      fd.append('photo', photoBuffer, {
        filename: 'payment.jpg',
        contentType: 'image/jpeg',
      });
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendPhoto`,
        {
          method: 'POST',
          body: fd as any,
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!res.ok)
        this.logger.warn(`[Telegram] sendPhoto failed: ${res.status}`);
      else
        this.logger.log(
          `[Telegram] Photo sent to chat_id=${page.telegramChatId}`,
        );
    } catch (err: any) {
      this.logger.error(
        `[Telegram] sendPhoto error pageId=${pageId}: ${err.message}`,
      );
    }
  }

  private async send(
    token: string,
    chatId: string,
    text: string,
  ): Promise<void> {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const body = JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(10_000),
        });

        if (res.ok) {
          this.logger.log(`[Telegram] Sent chat_id=${chatId}`);
          return;
        }

        const errText = await res.text().catch(() => '');
        if (
          (res.status === 429 || res.status >= 500) &&
          attempt < MAX_RETRIES
        ) {
          const delay = RETRY_DELAY_MS[attempt];
          this.logger.warn(
            `[Telegram] status=${res.status} chat_id=${chatId} — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        this.logger.error(
          `[Telegram] Send failed status=${res.status} chat_id=${chatId} body=${errText.slice(0, 200)}`,
        );
        return;
      } catch (err: any) {
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS[attempt];
          await new Promise((r) => setTimeout(r, delay));
        } else {
          this.logger.error(
            `[Telegram] Network error chat_id=${chatId} (exhausted retries): ${err.message}`,
          );
        }
      }
    }
  }
}
