import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { WaMessengerService } from './wa-messenger.service';
import { BotKnowledgeService } from '../bot-knowledge/bot-knowledge.service';
import { BotIntentService } from '../bot/bot-intent.service';
import { ConversationContextService } from '../conversation-context/conversation-context.service';
import { DraftOrderHandler } from '../webhook/handlers/draft-order.handler';
import { CrmService } from '../crm/crm.service';
import { SmartBotService } from '../bot/smart-bot.service';
import { BillingService } from '../billing/billing.service';
import { WalletService } from '../wallet/wallet.service';
import { OcrService } from '../ocr/ocr.service';
import { OcrQueueService } from '../ocr-queue/ocr-queue.service';
import { VisionAnalysisService } from '../vision-analysis/vision-analysis.service';
import { ProductMatchService } from '../product-match/product-match.service';
import { WhisperService } from '../whisper/whisper.service';
import { extractTransactionId } from '../common/payment-ocr.util';
import { MessageLogService } from '../inbox/inbox.module';

@Injectable()
export class WaWebhookService {
  private readonly logger = new Logger(WaWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly waMessenger: WaMessengerService,
    private readonly messageLog: MessageLogService,
    private readonly botKnowledge: BotKnowledgeService,
    private readonly botIntent: BotIntentService,
    private readonly ctx: ConversationContextService,
    private readonly draftHandler: DraftOrderHandler,
    private readonly crm: CrmService,
    private readonly smartBot: SmartBotService,
    private readonly billing: BillingService,
    private readonly walletService: WalletService,
    private readonly ocr: OcrService,
    private readonly ocrQueue: OcrQueueService,
    private readonly visionAnalysis: VisionAnalysisService,
    private readonly productMatch: ProductMatchService,
    private readonly whisper: WhisperService,
  ) {}

  // ── Entry point ─────────────────────────────────────────────────────────────

  async handle(body: any): Promise<void> {
    if (!body || body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        // Find matching page by WA phone number ID
        const page = await this.prisma.page.findFirst({
          where: { waPhoneNumberId: phoneNumberId, waEnabled: true, isActive: true },
        });

        if (!page) {
          this.logger.warn(`[WA] No active page for phoneNumberId=${phoneNumberId}`);
          continue;
        }

        if (!page.waToken) {
          this.logger.warn(`[WA] Page id=${page.id} has no waToken`);
          continue;
        }

        // Subscription gate
        if (page.subscriptionStatus === 'SUSPENDED') {
          this.logger.log(`[WA] Page id=${page.id} SUSPENDED — skipping`);
          continue;
        }
        if (page.nextBillingDate && new Date(page.nextBillingDate) < new Date()) {
          await this.prisma.page.update({
            where: { id: page.id },
            data: { subscriptionStatus: 'SUSPENDED' },
          });
          continue;
        }

        // ── Message status updates (delivered / read / failed) ───────────────
        for (const status of value.statuses ?? []) {
          this.handleStatusUpdate(page.id, status);
        }

        // ── Incoming messages ─────────────────────────────────────────────────
        for (const msg of value.messages ?? []) {
          const waId: string = msg.from; // sender's phone number
          if (!waId) continue;
          this.processMessage(page, waId, msg).catch((err) =>
            this.logger.error(`[WA] processMessage error waId=${waId}: ${err}`),
          );
        }
      }
    }
  }

  // ── Message status handler ───────────────────────────────────────────────────

  private handleStatusUpdate(pageId: number, status: any): void {
    const { id: msgId, status: state, recipient_id, errors } = status ?? {};
    if (!msgId || !state) return;

    if (state === 'failed') {
      const errCode = errors?.[0]?.code;
      const errTitle = errors?.[0]?.title ?? 'unknown';

      if (errCode === 131047) {
        this.logger.warn(
          `[WA] pageId=${pageId} 24h window expired for recipient=${recipient_id} — outbound message blocked. Use approved template to re-open conversation.`,
        );
      } else {
        this.logger.warn(
          `[WA] pageId=${pageId} message failed msgId=${msgId} recipient=${recipient_id} errCode=${errCode} title="${errTitle}"`,
        );
      }
    } else {
      this.logger.debug(
        `[WA] pageId=${pageId} message status=${state} msgId=${msgId} recipient=${recipient_id}`,
      );
    }
  }

  // ── Message processor ────────────────────────────────────────────────────────

  async processMessage(page: any, waId: string, msg: any): Promise<void> {
    const pageId = page.id as number;
    const rawToken = this.encryption.decrypt(page.waToken as string);
    const phoneNumberId = page.waPhoneNumberId as string;

    // Log every inbound message for the dashboard Inbox, regardless of bot/agent state below.
    if (msg?.type) {
      const inboundText =
        msg.type === 'text'
          ? (msg.text?.body || '').trim()
          : `[${msg.type}]`;
      if (inboundText) {
        this.messageLog
          .logByPageId({
            pageId,
            customerPsid: waId,
            platform: 'WHATSAPP',
            direction: 'IN',
            type: msg.type,
            content: inboundText,
            externalId: msg.id ?? null,
          })
          .catch(() => {});
      }
    }

    const safeSend = async (text: string) => {
      if (!text) return;
      try {
        await this.waMessenger.sendText(phoneNumberId, rawToken, waId, text);
      } catch (err) {
        this.logger.error(`[WA] safeSend waId=${waId}: ${err}`);
      }
    };

    // Record platform for this customer (fire-and-forget)
    const senderName: string | undefined = msg?.profile?.name;
    this.crm.touchPlatform(pageId, waId, 'WHATSAPP', senderName).catch(() => {});

    // Block check
    const isBlocked = await this.crm.isBlocked(pageId, waId);
    if (isBlocked) {
      this.logger.log(`[WA] Blocked customer waId=${waId}`);
      return;
    }

    // Agent handling — bot silent
    const agentHandling = await this.ctx.isAgentHandling(pageId, waId);
    if (agentHandling) return;

    // ── Interactive list reply (customer tapped a catalog row) ────────────────
    if (msg.type === 'interactive') {
      const listReplyId: string | undefined = msg.interactive?.list_reply?.id;
      if (listReplyId?.startsWith('product_')) {
        const code = listReplyId.slice('product_'.length);
        await this.processMessage(page, waId, { type: 'text', text: { body: code } });
      }
      return;
    }

    // ── Image message ──────────────────────────────────────────────────────────
    if (msg.type === 'image') {
      if (!page.automationOn) return;
      const mediaId: string | undefined = msg.image?.id;
      if (!mediaId) {
        await safeSend('📸 ছবি পেয়েছি! Product code দিলে আরও দ্রুত সাহায্য করতে পারব 💖');
        return;
      }
      const accepted = await this.ocrQueue.add(() =>
        this.handleImageMessage(page, waId, mediaId, safeSend),
      );
      if (!accepted) void this.handleImageMessage(page, waId, mediaId, safeSend).catch(() => {});
      return;
    }

    // ── Audio message ──────────────────────────────────────────────────────────
    if (msg.type === 'audio') {
      if (!page.automationOn) return;
      const mediaId: string | undefined = msg.audio?.id;
      if (!mediaId) {
        await safeSend('🎤 ভয়েস মেসেজ পেয়েছি! Text-এ লিখলে আরও ভালো সাহায্য করতে পারব 💖');
        return;
      }
      const accepted = await this.ocrQueue.add(() => this.handleAudioMessage(page, waId, mediaId));
      if (!accepted) void this.handleAudioMessage(page, waId, mediaId).catch(() => {});
      return;
    }

    // ── Text message ───────────────────────────────────────────────────────────
    if (msg.type !== 'text') return; // skip reactions, location etc.

    const text = (msg.text?.body || '').trim();
    if (!text) return;

    if (!page.automationOn) return;

    // Auto-expire draft older than 24 hours
    let draft = await this.ctx.getActiveDraft(pageId, waId);
    if (draft) {
      const session = await this.ctx.getSession(pageId, waId);
      const hoursSince = session
        ? (Date.now() - new Date(session.updatedAt).getTime()) / 3_600_000
        : 0;
      if (hoursSince > 24) {
        await this.ctx.clearDraft(pageId, waId);
        draft = null;
      }
    }

    // ── SMART BOT — AI brain (mirrors Facebook's SmartBotService wiring) ──────
    // Falls through to the deterministic keyword pipeline below if the AI is
    // unavailable/declines, so WA never goes silent when SmartBot is off/down.
    if (page.smartBotOn) {
      const aiAllowed = await this.isAiAllowedForPage(page.ownerId);
      if (aiAllowed && this.smartBot.isAvailable()) {
        const result = await this.smartBot.handle(page, waId, text, draft, this.draftHandler);
        if (result !== false) {
          if (typeof result === 'object' && (result as any).showCatalog) {
            await this.sendCatalogList(page, waId, phoneNumberId, rawToken, result.reply);
          } else if (typeof result === 'object' && (result as any).showProductImage) {
            // Custom Prompt mode: one specific product's image. imageUrl came
            // from our own DB lookup (product code → Product.imageUrl) in
            // smart-bot.service.ts, never from the model directly.
            await safeSend(result.reply);
            const rawUrl = (result as any).imageUrl as string | null;
            const fullUrl = rawUrl
              ? rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
                ? rawUrl
                : `${(process.env.API_BASE_URL || 'https://api.flamboyai.com').replace(/\/$/, '')}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`
              : null;
            if (fullUrl) await this.waMessenger.sendImage(phoneNumberId, rawToken, waId, fullUrl);
          } else {
            const replyText = typeof result === 'string' ? result : result.reply;
            await safeSend(replyText);
          }
          return;
        }
      }
      // AI unavailable/declined this message — fall through to the
      // deterministic pipeline below instead of leaving the customer unanswered.
    }

    const awaitingConfirm =
      draft?.currentStep === 'confirm' ||
      (draft?.pendingMultiPreview?.length ?? 0) > 0;

    const intent = this.botIntent.detectIntent(text, awaitingConfirm);

    // ── CANCEL ─────────────────────────────────────────────────────────────────
    if (intent === 'CANCEL' && draft) {
      await this.ctx.clearDraft(pageId, waId);
      const msg2 = await this.botKnowledge.resolveSystemReply(pageId, 'order_cancelled');
      await safeSend(msg2 || 'ঠিক আছে 💖 কোনো সমস্যা নেই।');
      return;
    }

    // ── PENDING MULTI-PRODUCT PREVIEW ──────────────────────────────────────────
    if ((draft?.pendingMultiPreview?.length ?? 0) > 0) {
      await this.handleMultiProductPreview(page, waId, safeSend, text, intent, draft!);
      return;
    }

    // ── ACTIVE DRAFT: capture next field ──────────────────────────────────────
    if (draft && page.orderModeOn) {
      const result = await this.draftHandler.captureField(pageId, waId, text, draft, page);

      if (result === null) {
        const stillExists = await this.ctx.getActiveDraft(pageId, waId);
        if (!stillExists) {
          const wasConfirm =
            draft.currentStep === 'confirm' &&
            this.botIntent.detectIntent(text, true) === 'CONFIRM';
          const key = wasConfirm ? 'order_received' : 'order_cancelled';
          const replyMsg = await this.botKnowledge.resolveSystemReply(pageId, key);
          await safeSend(replyMsg);
        }
        return;
      }

      if (typeof result === 'string') {
        await safeSend(result);
        return;
      }
    }

    // ── PRODUCT CODE detection ─────────────────────────────────────────────────
    if (page.infoModeOn) {
      const prefix = (page.productCodePrefix as string | undefined) || 'DF';
      const codes = this.botIntent.extractAllCodes(text, prefix);

      if (codes.length > 1) {
        const found = await this.prisma.product.findMany({
          where: { pageId, code: { in: codes }, stockQty: { gt: 0 } },
        });
        if (found.length > 0) {
          const newDraft = this.draftHandler.emptyDraft('WHATSAPP');
          newDraft.pendingMultiPreview = codes;
          await this.ctx.saveDraft(pageId, waId, newDraft);
          await this.sendMultiProductPreview(page, waId, safeSend, codes);
          return;
        }
      }

      if (codes.length >= 1) {
        const code = codes[0];
        const product = await this.prisma.product.findFirst({
          where: { pageId, code, stockQty: { gt: 0 } },
        });

        if (product) {
          let infoMsg = await this.botKnowledge.resolveSystemReply(
            pageId,
            'product_info',
            {
              productCode: product.code,
              productPrice: product.price,
              productStock: product.stockQty,
              productInfoNote: product.description || '',
            },
          );

          if (page.orderModeOn) {
            const prompt = await this.botKnowledge.resolveSystemReply(pageId, 'order_prompt');
            if (prompt) infoMsg += `\n\n${prompt}`;

            let variantOptions: any[] = [];
            try {
              if (product.variantOptions)
                variantOptions = this.draftHandler.normalizeVariantOptions(
                  JSON.parse(product.variantOptions),
                );
            } catch {}
            const newDraft = this.draftHandler.startDraftFromCodes(
              [code],
              [product as any],
              variantOptions,
              'WHATSAPP',
            );
            await this.ctx.saveDraft(pageId, waId, newDraft);
          }

          await safeSend(infoMsg.trim());
          return;
        } else if (product === null) {
          const notFound = await this.botKnowledge.resolveSystemReply(
            pageId,
            'product_not_found',
            { productCode: code },
          );
          await safeSend(notFound);
          return;
        }
      }
    }

    // ── GREETING ──────────────────────────────────────────────────────────────
    if (intent === 'GREETING') {
      const reply = await this.botKnowledge.resolveReply(pageId, text, waId);
      if (reply?.reply) {
        await safeSend(reply.reply);
        return;
      }
      const greeting = await this.botKnowledge.resolveSystemReply(pageId, 'greeting');
      if (greeting) {
        await safeSend(greeting);
        return;
      }
      await safeSend('হ্যালো 💖 আমি এখানে আছি। কীভাবে সাহায্য করতে পারি?');
      return;
    }

    // ── CATALOG REQUEST ────────────────────────────────────────────────────────
    if (intent === 'CATALOG_REQUEST' && page.infoModeOn) {
      const catalogUrl = page.websiteUrl || '';
      if (catalogUrl) {
        await safeSend(`আমাদের সব product দেখতে এখানে যান:\n${catalogUrl}`);
      } else {
        const reply = await this.botKnowledge.resolveReply(pageId, text, waId);
        if (reply?.reply) {
          await safeSend(reply.reply);
          return;
        }
        await safeSend('Product code বা screenshot দিন, সাহায্য করব 💖');
      }
      return;
    }

    // ── KEYWORD MATCH (bot knowledge) ─────────────────────────────────────────
    const learned = await this.botKnowledge.resolveReply(pageId, text, waId);
    if (learned?.reply) {
      const reminder = draft ? `\n\n${this.draftHandler.reminder(draft)}` : '';
      await safeSend(learned.reply + reminder);
      return;
    }

    // ── ORDER PROMPT (if order mode on and no intent matched) ─────────────────
    if (page.orderModeOn && !draft && (intent === 'PRODUCT_INFO_REQUEST' || !intent)) {
      const orderPrompt = await this.botKnowledge.resolveSystemReply(pageId, 'order_prompt');
      if (orderPrompt) {
        await safeSend(orderPrompt);
        return;
      }
    }

    this.logger.debug(`[WA] No reply for waId=${waId} text="${text.slice(0, 60)}"`);
  }

  // ── Billing gate (mirrors WebhookService.isAiAllowedForPage) ─────────────────

  private async isAiAllowedForPage(ownerId: string | null): Promise<boolean> {
    if (!ownerId) return true;
    try {
      const sub = await this.billing.getOrCreateSubscription(ownerId);
      return this.billing.canTakeOrders(sub);
    } catch {
      return true;
    }
  }

  // ── Catalog list (WhatsApp's carousel analog) ─────────────────────────────────

  private async sendCatalogList(
    page: any,
    waId: string,
    phoneNumberId: string,
    rawToken: string,
    leadIn: string,
  ): Promise<void> {
    const pageId = page.id as number;
    const products = await this.prisma.product.findMany({
      where: { pageId, isActive: true, stockQty: { gt: 0 } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (!products.length) {
      await this.waMessenger.sendText(phoneNumberId, rawToken, waId, leadIn || 'আমাদের প্রোডাক্ট এখনো যোগ করা হয়নি।');
      return;
    }

    const sym = page.currencySymbol || '৳';
    const rows = products.map((p) => ({
      id: `product_${p.code}`,
      title: (p.name || p.code).slice(0, 24),
      description: `${p.code} — ${p.price}${sym}`.slice(0, 72),
    }));

    await this.waMessenger.sendInteractiveList(
      phoneNumberId,
      rawToken,
      waId,
      leadIn?.trim() || 'আমাদের প্রোডাক্টগুলো দেখুন 💖',
      'Catalog দেখুন',
      [{ title: 'Products', rows }],
    );
  }

  // ── Image handler: payment screenshot OR product vision-match ────────────────

  private async handleImageMessage(
    page: any,
    waId: string,
    mediaId: string,
    safeSend: (t: string) => Promise<void>,
  ): Promise<void> {
    const pageId = page.id as number;
    const rawToken = this.encryption.decrypt(page.waToken as string);
    const fallback = '📸 ছবি পেয়েছি! Product code দিলে আরও দ্রুত সাহায্য করতে পারব 💖';

    const media = await this.waMessenger.downloadMediaToStorage(mediaId, rawToken, pageId);
    if (!media) {
      await safeSend(fallback);
      return;
    }

    const draft = await this.ctx.getActiveDraft(pageId, waId);

    // ── Payment screenshot (customer is at the advance-payment step) ────────
    if (draft?.currentStep === 'advance_payment') {
      try {
        const rawText = await this.ocr.extractTextFromImageUrl(media.url);
        const txnId = extractTransactionId(rawText);

        if (txnId) {
          draft.paymentProof = txnId;
          draft.paymentScreenshotUrl = media.url;
          draft.currentStep = 'confirm';
          await this.ctx.saveDraft(pageId, waId, draft);
          const summary = this.draftHandler.buildSummary(draft, page);
          await safeSend(`✅ Payment পাওয়া গেছে! Transaction ID: *${txnId}*\n\n${summary}`);
        } else {
          draft.paymentScreenshotUrl = media.url;
          await this.ctx.saveDraft(pageId, waId, draft);
          await safeSend(
            '📷 Screenshot পেয়েছি, কিন্তু Transaction ID পড়া যাচ্ছে না।\n\nTransaction ID টা লিখে পাঠান, অথবা শেষের ৪টি সংখ্যা দিন 💖',
          );
        }
      } catch (err) {
        this.logger.error(`[WA][PaymentOCR] Failed page=${page.pageId} waId=${waId}: ${err}`);
        draft.paymentScreenshotUrl = media.url;
        await this.ctx.saveDraft(pageId, waId, draft);
        await safeSend('📷 Screenshot পেয়েছি 💖 Transaction ID টাও লিখে পাঠান (অথবা শেষের ৪টি সংখ্যা)।');
      }
      return;
    }

    // ── Product photo (vision match against catalog) ────────────────────────
    if (!page.infoModeOn) {
      await safeSend(fallback);
      return;
    }
    if (!(await this.walletService.canProcessAi(pageId))) {
      await safeSend(fallback);
      return;
    }

    try {
      const attrs = await this.visionAnalysis.analyze(media.url);
      await this.walletService.deductUsage(pageId, attrs.usedApi ? 'IMAGE' : 'IMAGE_LOCAL');

      const matches = await this.productMatch.findMatches(pageId, attrs, 8);
      if (!matches.length) {
        await safeSend(fallback);
        return;
      }

      const codes = matches.map((m) => m.productCode);
      const found = await this.prisma.product.findMany({
        where: { pageId, code: { in: codes } },
      });
      if (!found.length) {
        await safeSend(fallback);
        return;
      }

      const newDraft = this.draftHandler.emptyDraft('WHATSAPP');
      newDraft.pendingMultiPreview = codes;
      await this.ctx.saveDraft(pageId, waId, newDraft);
      await this.sendMultiProductPreview(page, waId, safeSend, codes);
    } catch (err) {
      this.logger.error(`[WA][VisionRecog] Failed page=${page.pageId} waId=${waId}: ${err}`);
      await safeSend(fallback);
    }
  }

  // ── Audio handler: Whisper transcription ──────────────────────────────────────

  private async handleAudioMessage(page: any, waId: string, mediaId: string): Promise<void> {
    const pageId = page.id as number;
    const phoneNumberId = page.waPhoneNumberId as string;
    const rawToken = this.encryption.decrypt(page.waToken as string);
    const safeSend = async (text: string) => {
      if (!text) return;
      try {
        await this.waMessenger.sendText(phoneNumberId, rawToken, waId, text);
      } catch (err) {
        this.logger.error(`[WA] safeSend waId=${waId}: ${err}`);
      }
    };

    if (!(await this.walletService.canProcessAi(pageId)) || !this.whisper.isAvailable()) {
      await safeSend('🎤 ভয়েস মেসেজ পেয়েছি! Text-এ লিখলে আরও ভালো সাহায্য করতে পারব 💖');
      return;
    }

    const media = await this.waMessenger.downloadMediaToStorage(mediaId, rawToken, pageId);
    if (!media) {
      await safeSend('🎤 ভয়েস মেসেজ পেয়েছি! Text-এ লিখলে আরও ভালো সাহায্য করতে পারব 💖');
      return;
    }

    const transcribed = await this.whisper.transcribe(media.url);
    if (!transcribed) {
      await safeSend('দুঃখিত, আপনার voice message বুঝতে পারিনি। Text-এ লিখে জানান 💖');
      return;
    }

    await this.walletService.deductUsage(pageId, 'VOICE');
    this.logger.log(`[WA][Whisper] Routing transcribed text: "${transcribed.slice(0, 80)}"`);
    await this.processMessage(page, waId, { type: 'text', text: { body: transcribed } });
  }

  // ── Multi-product preview helpers ────────────────────────────────────────────

  private async sendMultiProductPreview(
    page: any,
    waId: string,
    safeSend: (t: string) => Promise<void>,
    codes: string[],
  ): Promise<void> {
    const products = await this.prisma.product.findMany({
      where: { pageId: page.id, code: { in: codes } },
    });
    if (!products.length) return;

    const sym = page.currencySymbol || '৳';
    const lines = codes
      .map((c) => products.find((p) => p.code === c))
      .filter(Boolean)
      .map(
        (p: any) =>
          `${p.code} — ${p.price}${sym}${p.stockQty <= 0 ? ' ❌ Stock Out' : ''}`,
      );

    await safeSend(
      lines.join('\n') + '\n\nসবগুলো order করতে চান? *confirm* / *cancel* লিখুন 💖',
    );
  }

  private async handleMultiProductPreview(
    page: any,
    waId: string,
    safeSend: (t: string) => Promise<void>,
    text: string,
    intent: string | null,
    draft: any,
  ): Promise<void> {
    const pageId = page.id as number;
    const codes = draft.pendingMultiPreview as string[];

    if (intent === 'CONFIRM' || intent === 'MULTI_CONFIRM') {
      const products = await this.prisma.product.findMany({
        where: { pageId, code: { in: codes } },
      });
      const newDraft = this.draftHandler.startDraftFromCodes(codes, products as any[], [], 'WHATSAPP');
      await this.ctx.saveDraft(pageId, waId, newDraft);
      await safeSend('ঠিক আছে 💖 আপনার নাম দিন।');
    } else if (intent === 'CANCEL') {
      await this.ctx.clearDraft(pageId, waId);
      const msg = await this.botKnowledge.resolveSystemReply(pageId, 'order_cancelled');
      await safeSend(msg || 'ঠিক আছে 💖 কোনো সমস্যা নেই।');
    } else {
      await safeSend(
        'সবগুলো order করতে *confirm* লিখুন, বাতিল করতে *cancel* লিখুন 💖',
      );
    }
  }
}
