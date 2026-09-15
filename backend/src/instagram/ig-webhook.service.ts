import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { IgMessengerService } from './ig-messenger.service';
import { BotKnowledgeService } from '../bot-knowledge/bot-knowledge.service';
import { BotIntentService } from '../bot/bot-intent.service';
import { ConversationContextService } from '../conversation-context/conversation-context.service';
import { DraftOrderHandler } from '../webhook/handlers/draft-order.handler';
import { CrmService } from '../crm/crm.service';
import { MessageLogService } from '../inbox/inbox.module';
import {
  formatSlabsBn,
  isRestaurantReady,
  parseSlabs,
} from '../common/restaurant-delivery';

@Injectable()
export class IgWebhookService {
  private readonly logger = new Logger(IgWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly igMessenger: IgMessengerService,
    private readonly botKnowledge: BotKnowledgeService,
    private readonly botIntent: BotIntentService,
    private readonly ctx: ConversationContextService,
    private readonly draftHandler: DraftOrderHandler,
    private readonly crm: CrmService,
    private readonly messageLog: MessageLogService,
  ) {}

  // ── Entry point ─────────────────────────────────────────────────────────────

  async handle(body: any): Promise<void> {
    if (!body || body.object !== 'instagram') return;

    for (const entry of body.entry ?? []) {
      const igAccountId: string = entry.id;
      if (!igAccountId) continue;

      const page = await this.prisma.page.findFirst({
        where: { igBusinessAccountId: igAccountId, igEnabled: true, isActive: true },
      });

      if (!page) {
        this.logger.warn(`[IG] No active page for igBusinessAccountId=${igAccountId}`);
        continue;
      }

      if (!page.igToken) {
        this.logger.warn(`[IG] Page id=${page.id} has no igToken`);
        continue;
      }

      if (page.subscriptionStatus === 'SUSPENDED') {
        this.logger.log(`[IG] Page id=${page.id} SUSPENDED — skipping`);
        continue;
      }
      if (page.nextBillingDate && new Date(page.nextBillingDate) < new Date()) {
        await this.prisma.page.update({
          where: { id: page.id },
          data: { subscriptionStatus: 'SUSPENDED' },
        });
        continue;
      }

      // ── DM messages ────────────────────────────────────────────────────────
      for (const msgEvent of entry.messaging ?? []) {
        const senderId: string = msgEvent.sender?.id;
        if (!senderId || senderId === igAccountId) continue; // skip own messages

        this.processDm(page, senderId, msgEvent).catch((err) =>
          this.logger.error(`[IG] processDm error senderId=${senderId}: ${err}`),
        );
      }

      // ── Post comments ──────────────────────────────────────────────────────
      for (const change of entry.changes ?? []) {
        if (change.field !== 'comments') continue;

        const value = change.value;
        const commentId: string = value?.id;
        const commentText: string = value?.text || '';
        const commenterId: string = value?.from?.id;

        if (!commentId || !commentText || !commenterId) continue;
        if (commenterId === igAccountId) continue; // skip own comments

        this.processComment(page, commentId, commenterId, commentText).catch((err) =>
          this.logger.error(`[IG] processComment error commentId=${commentId}: ${err}`),
        );
      }
    }
  }

  // ── DM processor ────────────────────────────────────────────────────────────

  async processDm(page: any, senderId: string, event: any): Promise<void> {
    const pageId = page.id as number;
    const rawToken = this.encryption.decrypt(page.igToken as string);

    // Log every inbound DM for the dashboard Inbox, regardless of bot/agent state below.
    const inboundMsg = event.message;
    if (inboundMsg) {
      const inboundText =
        (inboundMsg.text || '').trim() ||
        (inboundMsg.attachments?.[0]?.type ? `[${inboundMsg.attachments[0].type}]` : '');
      if (inboundText) {
        this.messageLog
          .logByPageId({
            pageId,
            customerPsid: senderId,
            platform: 'INSTAGRAM',
            direction: 'IN',
            type: inboundMsg.attachments?.length ? inboundMsg.attachments[0].type : 'text',
            content: inboundText,
            externalId: inboundMsg.mid ?? null,
          })
          .catch(() => {});
      }
    }

    const safeSend = async (text: string) => {
      if (!text) return;
      try {
        await this.igMessenger.sendText(rawToken, senderId, text, pageId);
      } catch (err) {
        this.logger.error(`[IG] safeSend senderId=${senderId}: ${err}`);
      }
    };

    // Record platform for this customer (fire-and-forget)
    this.crm.touchPlatform(pageId, senderId, 'INSTAGRAM').catch(() => {});

    const isBlocked = await this.crm.isBlocked(pageId, senderId);
    if (isBlocked) return;

    const agentHandling = await this.ctx.isAgentHandling(pageId, senderId);
    if (agentHandling) return;

    const msg = event.message;
    if (!msg) return;

    // Image attachment
    if (msg.attachments?.some((a: any) => a.type === 'image')) {
      if (!page.automationOn) return;
      await safeSend('📸 ছবি পেয়েছি! Product code দিলে আরও দ্রুত সাহায্য করতে পারব 💖');
      return;
    }

    const text = (msg.text || '').trim();
    if (!text) return;
    if (!page.automationOn) return;

    let draft = await this.ctx.getActiveDraft(pageId, senderId);
    if (draft) {
      const session = await this.ctx.getSession(pageId, senderId);
      const hoursSince = session
        ? (Date.now() - new Date(session.updatedAt).getTime()) / 3_600_000
        : 0;
      if (hoursSince > 24) {
        await this.ctx.clearDraft(pageId, senderId);
        draft = null;
      }
    }

    const awaitingConfirm =
      draft?.currentStep === 'confirm' ||
      (draft?.pendingMultiPreview?.length ?? 0) > 0;

    const intent = this.botIntent.detectIntent(text, awaitingConfirm);

    if (intent === 'CANCEL' && draft) {
      await this.ctx.clearDraft(pageId, senderId);
      const msg2 = await this.botKnowledge.resolveSystemReply(pageId, 'order_cancelled');
      await safeSend(msg2 || 'ঠিক আছে 💖 কোনো সমস্যা নেই।');
      return;
    }

    // ── PENDING MULTI-PRODUCT PREVIEW ──────────────────────────────────────────
    if ((draft?.pendingMultiPreview?.length ?? 0) > 0) {
      await this.handleMultiProductPreview(page, senderId, safeSend, text, intent, draft!);
      return;
    }

    if (draft && page.orderModeOn) {
      const result = await this.draftHandler.captureField(pageId, senderId, text, draft, page);

      if (result === null) {
        const stillExists = await this.ctx.getActiveDraft(pageId, senderId);
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

    if (page.infoModeOn) {
      const prefix = (page.productCodePrefix as string | undefined) || 'DF';
      const codes = this.botIntent.extractAllCodes(text, prefix);

      if (codes.length > 1) {
        const found = await this.prisma.product.findMany({
          where: { pageId, code: { in: codes }, stockQty: { gt: 0 } },
        });
        if (found.length > 0) {
          const newDraft = this.draftHandler.emptyDraft('INSTAGRAM');
          newDraft.pendingMultiPreview = codes;
          await this.ctx.saveDraft(pageId, senderId, newDraft);
          await this.sendMultiProductPreview(page, senderId, safeSend, codes);
          return;
        }
      }

      if (codes.length >= 1) {
        const code = codes[0];
        const product = await this.prisma.product.findFirst({
          where: { pageId, code, stockQty: { gt: 0 } },
        });

        if (product) {
          let infoMsg = await this.botKnowledge.resolveSystemReply(pageId, 'product_info', {
            productCode: product.code,
            productPrice: product.price,
            productStock: product.stockQty,
            productInfoNote: product.description || '',
          });

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
            const newDraft = this.draftHandler.startDraftFromCodes([code], [product as any], variantOptions, 'INSTAGRAM');
            await this.ctx.saveDraft(pageId, senderId, newDraft);
          }

          await safeSend(infoMsg.trim());
          return;
        } else if (product === null) {
          const notFound = await this.botKnowledge.resolveSystemReply(pageId, 'product_not_found', {
            productCode: code,
          });
          await safeSend(notFound);
          return;
        }
      }
    }

    if (intent === 'GREETING') {
      const reply = await this.botKnowledge.resolveReply(pageId, text, senderId);
      if (reply?.reply) { await safeSend(reply.reply); return; }
      const greeting = await this.botKnowledge.resolveSystemReply(pageId, 'greeting');
      if (greeting) { await safeSend(greeting); return; }
      await safeSend('হ্যালো 💖 আমি এখানে আছি। কীভাবে সাহায্য করতে পারি?');
      return;
    }

    if (intent === 'CATALOG_REQUEST' && page.infoModeOn) {
      const catalogUrl = page.websiteUrl || '';
      if (catalogUrl) {
        await safeSend(`আমাদের সব product দেখতে এখানে যান:\n${catalogUrl}`);
      } else {
        const reply = await this.botKnowledge.resolveReply(pageId, text, senderId);
        if (reply?.reply) { await safeSend(reply.reply); return; }
        await safeSend('Product code বা screenshot দিন, সাহায্য করব 💖');
      }
      return;
    }

    const learned = await this.botKnowledge.resolveReply(pageId, text, senderId);
    if (learned?.reply) {
      const reminder = draft ? `\n\n${this.draftHandler.reminder(draft)}` : '';
      await safeSend(learned.reply + reminder);
      return;
    }

    this.logger.debug(`[IG] No DM reply for senderId=${senderId} text="${text.slice(0, 60)}"`);
  }

  // ── Comment processor ────────────────────────────────────────────────────────

  async processComment(page: any, commentId: string, commenterId: string, text: string): Promise<void> {
    const pageId = page.id as number;
    const rawToken = this.encryption.decrypt(page.igToken as string);

    if (!page.automationOn) return;

    const isBlocked = await this.crm.isBlocked(pageId, commenterId);
    if (isBlocked) return;

    const safeSendComment = async (msg: string) => {
      if (!msg) return;
      try {
        await this.igMessenger.sendCommentReply(rawToken, commentId, msg);
      } catch (err) {
        this.logger.error(`[IG] comment reply commentId=${commentId}: ${err}`);
      }
    };

    const safeSendDm = async (msg: string) => {
      if (!msg) return;
      try {
        await this.igMessenger.sendText(rawToken, commenterId, msg, pageId);
      } catch (err) {
        this.logger.debug(`[IG] DM to commenter failed (may not have messaged first) commenterId=${commenterId}: ${err}`);
      }
    };

    // Fetch top 15 active products for AI classification
    const products = await this.prisma.product.findMany({
      where: { pageId, isActive: true },
      select: { code: true, name: true, price: true, stockQty: true, description: true },
      orderBy: { stockQty: 'desc' },
      take: 15,
    });

    const classification = await this.botIntent.classifyComment(products, text);
    if (!classification?.shouldReply) return;

    const { productCodes, intent } = classification;
    const mention = commenterId ? `@[${commenterId}] ` : '';
    const inboxCta = `\n\n📩 Order বা আরও তথ্যের জন্য আমাদের Inbox-এ message করুন।`;

    // All-prices intent
    if (intent === 'all_prices' || (intent === 'price' && productCodes.length === 0 && products.length > 0)) {
      const lines = products.map((p, i) => `${i + 1}. ${p.name ?? p.code} — ${p.price}৳`).join('\n');
      await safeSendComment(`${mention}📦 আমাদের সব product এর দাম:\n${lines}${inboxCta}`);
      if (page.igCommentToDmEnabled !== false) await safeSendDm(`📦 আমাদের সব product এর দাম:\n${lines}${inboxCta}`);
      this.logger.log(`[IG] All-prices comment reply commentId=${commentId}`);
      return;
    }

    // Emoji/praise
    if (intent === 'emoji_praise') {
      const reply = `${mention}ধন্যবাদ! ❤️ আপনার ভালোবাসাই আমাদের অনুপ্রেরণা! 😊 কোনো product সম্পর্কে জানতে চাইলে Inbox-এ message করুন। 📩`;
      await safeSendComment(reply);
      this.logger.log(`[IG] Emoji/praise comment reply commentId=${commentId}`);
      return;
    }

    // No specific product or general question
    if (productCodes.length === 0 || intent === 'other') {
      await safeSendComment(mention + `আগ্রহের জন্য ধন্যবাদ! 😊 আমাদের Inbox-এ message করুন — দাম, stock ও অর্ডার সম্পর্কে সব তথ্য পাবেন। 📩`);
      if (page.igCommentToDmEnabled !== false) await safeSendDm(`আমাদের Inbox-এ message করুন — দাম, stock ও অর্ডার সম্পর্কে সব তথ্য পাবেন। 📩`);
      this.logger.log(`[IG] Generic comment reply commentId=${commentId}`);
      return;
    }

    const matched = products.filter(p => productCodes.includes(p.code));
    if (matched.length === 0) {
      await safeSendComment(mention + `আগ্রহের জন্য ধন্যবাদ! 😊 আমাদের Inbox-এ message করুন — দাম, stock ও অর্ডার সম্পর্কে সব তথ্য পাবেন। 📩`);
      return;
    }

    // Multiple products matched
    if (matched.length > 1) {
      const parts = matched.map(p => this.buildProductLine(p, intent, page)).filter(Boolean);
      if (!parts.length) return;
      const reply = mention + parts.join('\n') + inboxCta;
      await safeSendComment(reply);
      if (page.igCommentToDmEnabled !== false) await safeSendDm(parts.join('\n') + inboxCta);
      this.logger.log(`[IG] Multi-product comment reply commentId=${commentId} codes=${productCodes.join(',')}`);
      return;
    }

    // Single product
    const reply = this.buildCommentReply(matched[0], intent, page);
    if (!reply) return;
    await safeSendComment(mention + reply);
    if (page.igCommentToDmEnabled !== false) await safeSendDm(reply);
    this.logger.log(`[IG] Comment replied commentId=${commentId} code=${productCodes[0]} intent=${intent}`);
  }

  private buildProductLine(product: any, intent: string, page: any): string | null {
    const label = product.name ?? product.code;
    switch (intent) {
      case 'price': return `• ${label} — ${product.price}৳ 🏷️`;
      case 'stock': return `• ${label} — ${product.stockQty > 0 ? `${product.stockQty}টি stock ✅` : 'stock নেই ❌'}`;
      case 'delivery': return isRestaurantReady(page)
        ? `• ডেলিভারি চার্জ দূরত্ব অনুযায়ী: ${formatSlabsBn(parseSlabs(page.deliverySlabsJson))} 🛵`
        : `• ঢাকার ভেতরে ${page.deliveryFeeInsideDhaka ?? 80}৳, বাইরে ${page.deliveryFeeOutsideDhaka ?? 120}৳ 🚚`;
      case 'description': return product.description ? `• ${label}: ${product.description}` : null;
      default: return null;
    }
  }

  private buildCommentReply(product: any, intent: string, page: any): string | null {
    const label = product.name ? `${product.name} (${product.code})` : product.code;
    const inboxCta = `\n\n📩 Order বা আরও তথ্যের জন্য আমাদের Inbox-এ message করুন।`;
    switch (intent) {
      case 'price': return `${label} এর দাম ${product.price}৳ 🏷️${inboxCta}`;
      case 'stock': return (product.stockQty > 0
        ? `${label} এ ${product.stockQty} টি stock আছে ✅`
        : `${label} বর্তমানে stock এ নেই ❌`) + inboxCta;
      case 'delivery': return isRestaurantReady(page)
        ? `ডেলিভারি চার্জ দূরত্ব অনুযায়ী: ${formatSlabsBn(parseSlabs(page.deliverySlabsJson))} 🛵${inboxCta}`
        : `ঢাকার ভেতরে ডেলিভারি ${page.deliveryFeeInsideDhaka ?? 80}৳, বাইরে ${page.deliveryFeeOutsideDhaka ?? 120}৳ 🚚${inboxCta}`;
      case 'description': return product.description ? `${product.description}${inboxCta}` : null;
      default: return null;
    }
  }

  // ── Multi-product preview helpers ────────────────────────────────────────────

  private async sendMultiProductPreview(
    page: any,
    senderId: string,
    safeSend: (t: string) => Promise<void>,
    codes: string[],
  ): Promise<void> {
    const products = await this.prisma.product.findMany({
      where: { pageId: page.id, code: { in: codes } },
    });
    if (!products.length) return;

    const sym = (page as any).currencySymbol || '৳';
    const lines = codes
      .map((c) => products.find((p) => p.code === c))
      .filter(Boolean)
      .map(
        (p: any) =>
          `${p.code} — ${p.price}${sym}${p.stockQty <= 0 ? ' ❌ Stock Out' : ''}`,
      );

    await safeSend(
      lines.join('\n') + '\n\nসবগুলো order করতে চান? confirm / cancel লিখুন 💖',
    );
  }

  private async handleMultiProductPreview(
    page: any,
    senderId: string,
    safeSend: (t: string) => Promise<void>,
    _text: string,
    intent: string | null,
    draft: any,
  ): Promise<void> {
    const pageId = page.id as number;
    const codes = draft.pendingMultiPreview as string[];

    if (intent === 'CONFIRM' || intent === 'MULTI_CONFIRM') {
      const products = await this.prisma.product.findMany({
        where: { pageId, code: { in: codes } },
      });
      const newDraft = this.draftHandler.startDraftFromCodes(codes, products as any[], [], 'INSTAGRAM');
      await this.ctx.saveDraft(pageId, senderId, newDraft);
      await safeSend('ঠিক আছে 💖 আপনার নাম দিন।');
    } else if (intent === 'CANCEL') {
      await this.ctx.clearDraft(pageId, senderId);
      const msg = await this.botKnowledge.resolveSystemReply(pageId, 'order_cancelled');
      await safeSend(msg || 'ঠিক আছে 💖 কোনো সমস্যা নেই।');
    } else {
      await safeSend(
        'সবগুলো order করতে confirm লিখুন, বাতিল করতে cancel লিখুন 💖',
      );
    }
  }
}
