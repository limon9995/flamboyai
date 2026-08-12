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
import { IgWebhookService } from './ig-webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/encryption.service';

@SkipThrottle({ global: true, auth: true, chat: true })
@Controller('ig-webhook')
export class IgWebhookController {
  private readonly logger = new Logger(IgWebhookController.name);

  constructor(
    private readonly igWebhookService: IgWebhookService,
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  // ── GET: Instagram webhook verification ───────────────────────────────────
  @Get()
  async verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    if (mode !== 'subscribe' || !token) return 'Verification failed';

    const page = await this.prisma.page.findFirst({
      where: { igVerifyToken: token, igEnabled: true, isActive: true },
    });

    if (page) {
      this.logger.log(`[IG Webhook] Verified page id=${page.id}`);
      return challenge;
    }

    // Shared secret for the one-time app-level Meta Webhooks product
    // handshake (the shared flamboyai app, not a per-client custom app).
    if (
      process.env.PLATFORM_VERIFY_TOKEN &&
      token === process.env.PLATFORM_VERIFY_TOKEN
    ) {
      this.logger.log(`[IG Webhook] Verified via PLATFORM_VERIFY_TOKEN`);
      return challenge;
    }

    this.logger.warn(`[IG Webhook] Verification failed — unknown token`);
    return 'Verification failed';
  }

  // ── POST: Receive Instagram webhook events ────────────────────────────────
  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: any,
    @Headers('x-hub-signature-256') sig: string,
  ) {
    // Parse body first so we can do per-page HMAC lookup
    let parsedBody = body;
    if (Buffer.isBuffer(body)) {
      try {
        parsedBody = JSON.parse(body.toString('utf8'));
      } catch {
        this.logger.error('[IG Webhook] Failed to parse body');
        return 'EVENT_RECEIVED';
      }
    }

    // Resolve HMAC secret: prefer per-page fbAppSecret, fall back to global
    const igAccountId: string | undefined = parsedBody?.entry?.[0]?.id;
    let secret = process.env.FB_WEBHOOK_SECRET?.trim();
    if (igAccountId) {
      const page = await this.prisma.page.findFirst({
        where: { igBusinessAccountId: igAccountId },
        select: { fbAppSecret: true },
      });
      if (page?.fbAppSecret) {
        try {
          secret = this.encryption.decrypt(page.fbAppSecret);
        } catch {
          // keep global secret if decrypt fails
        }
      }
    }

    if (secret) {
      const rawBody = (req as any).rawBody ?? req.body;
      const payload = Buffer.isBuffer(rawBody)
        ? rawBody
        : Buffer.from(JSON.stringify(rawBody));

      if (!sig) {
        this.logger.warn('[IG Webhook] Missing X-Hub-Signature-256 — rejecting');
        return 'EVENT_RECEIVED';
      }

      const expected =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(payload).digest('hex');

      const sigValid = crypto.timingSafeEqual(
        Buffer.from(sig),
        Buffer.from(expected),
      );

      if (!sigValid) {
        this.logger.warn('[IG Webhook] Invalid signature — ignoring');
        return 'EVENT_RECEIVED';
      }
    } else {
      this.logger.warn('[IG Webhook] FB_WEBHOOK_SECRET not set — HMAC verification SKIPPED');
    }

    this.logger.debug(
      `[IG Webhook] Received object=${parsedBody?.object} entries=${parsedBody?.entry?.length ?? 0}`,
    );

    await this.igWebhookService.handle(parsedBody);
    return 'EVENT_RECEIVED';
  }
}
