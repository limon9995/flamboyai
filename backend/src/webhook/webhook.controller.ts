import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import * as crypto from 'crypto';
import type { Request } from 'express';
import { WebhookService } from './webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/encryption.service';

@SkipThrottle({ global: true, auth: true, chat: true }) // Facebook can send many events — skip global rate limit
@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  private readonly isProduction = process.env.NODE_ENV === 'production';

  constructor(
    private readonly webhookService: WebhookService,
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  // ── GET: Facebook webhook verification ───────────────────────────────────
  @Get()
  async verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    if (mode !== 'subscribe' || !token) return 'Verification failed';

    // Check against any page's verifyToken in DB
    const page = await this.prisma.page.findFirst({
      where: { verifyToken: token, isActive: true },
    });
    if (page) {
      this.logger.log(`[Webhook] Verified page=${page.pageId}`);
      return challenge;
    }

    // Fallback: env var
    if (
      !this.isProduction &&
      process.env.DEFAULT_VERIFY_TOKEN &&
      token === process.env.DEFAULT_VERIFY_TOKEN
    ) {
      this.logger.log(`[Webhook] Verified via DEFAULT_VERIFY_TOKEN`);
      return challenge;
    }

    // Shared secret for the one-time app-level Meta Webhooks product
    // handshake (the shared flamboyai app, not a per-client custom app).
    // Works in production too, unlike DEFAULT_VERIFY_TOKEN above.
    if (
      process.env.PLATFORM_VERIFY_TOKEN &&
      token === process.env.PLATFORM_VERIFY_TOKEN
    ) {
      this.logger.log(`[Webhook] Verified via PLATFORM_VERIFY_TOKEN`);
      return challenge;
    }

    this.logger.warn(`[Webhook] Verification failed — unknown token`);
    return 'Verification failed';
  }

  // ── POST: Receive webhook events ─────────────────────────────────────────
  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: any,
    @Headers('x-hub-signature-256') sig: string,
  ) {
    // ── Resolve HMAC secret: per-page custom app OR global platform fallback ──
    const rawBody = (req as any).rawBody ?? req.body;
    const payload = Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(JSON.stringify(rawBody));

    let secret = process.env.FB_WEBHOOK_SECRET?.trim() ?? '';

    try {
      const quick = JSON.parse(payload.toString('utf8'));
      const fbPageId: string | null = quick?.entry?.[0]?.id
        ? String(quick.entry[0].id)
        : null;
      if (fbPageId) {
        const pageRow = await this.prisma.page.findFirst({
          where: { pageId: fbPageId, isActive: true },
          select: { fbAppSecret: true },
        });
        if (pageRow?.fbAppSecret) {
          secret = this.encryption.decrypt(pageRow.fbAppSecret);
        }
      }
    } catch {
      // unparseable body or DB error — fall through, global secret used
    }

    if (secret) {
      if (!sig) {
        this.logger.warn(
          '[Webhook] Missing X-Hub-Signature-256 header — rejecting',
        );
        return 'EVENT_RECEIVED'; // return 200 to FB but don't process
      }

      const expected =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(payload).digest('hex');

      const sigBuf = Buffer.from(sig);
      const expBuf = Buffer.from(expected);
      const sigValid =
        sigBuf.length === expBuf.length &&
        crypto.timingSafeEqual(sigBuf, expBuf);

      if (!sigValid) {
        this.logger.warn(
          '[Webhook] Invalid signature — possible spoofed request, ignoring',
        );
        return 'EVENT_RECEIVED'; // 200 to avoid FB retries, but don't process
      }
    } else {
      // No secret configured — log warning but continue (dev mode)
      this.logger.warn(
        '[Webhook] FB_WEBHOOK_SECRET not set — signature verification SKIPPED (insecure in production!)',
      );
    }

    // Parse body: if raw buffer was received, parse JSON now
    let parsedBody = body;
    if (Buffer.isBuffer(body)) {
      try {
        parsedBody = JSON.parse(body.toString('utf8'));
      } catch {
        this.logger.error('[Webhook] Failed to parse body');
        return 'EVENT_RECEIVED';
      }
    }

    this.logger.log(
      `[Webhook] Received object=${parsedBody?.object} entries=${parsedBody?.entry?.length ?? 0}`,
    );
    try {
      await this.webhookService.handle(parsedBody);
    } catch (e) {
      this.logger.error('[Webhook] Unhandled error in handle()', e);
    }
    return 'EVENT_RECEIVED';
  }
}
