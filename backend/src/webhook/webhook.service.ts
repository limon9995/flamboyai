import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MessengerService } from '../messenger/messenger.service';
import { MessageQueueService } from '../message-queue/message-queue.service';
import { BotKnowledgeService } from '../bot-knowledge/bot-knowledge.service';
import { OcrService } from '../ocr/ocr.service';
import { OcrQueueService } from '../ocr-queue/ocr-queue.service';
import { BotIntentService } from '../bot/bot-intent.service';
import {
  ConversationContextService,
  DraftSession,
  CustomFieldDef,
} from '../conversation-context/conversation-context.service';
import { DraftOrderHandler } from './handlers/draft-order.handler';
import { FollowUpService } from '../followup/followup.service';
import { ProductInfoHandler } from './handlers/product-info.handler';
import { NegotiationHandler } from './handlers/negotiation.handler';
import { CrmService } from '../crm/crm.service';
// V18: Image recognition imports
import { VisionAnalysisService } from '../vision-analysis/vision-analysis.service';
import {
  ProductMatchService,
  ProductMatchResult,
} from '../product-match/product-match.service';
// V20: Local CLIP visual embedding
import { EmbeddingService } from '../embedding/embedding.service';
import { FallbackAiService } from '../fallback-ai/fallback-ai.service';
import { AiIntentService } from '../bot/ai-intent.service';
import { BotContextService } from '../bot/bot-context.service';
import { VisionOpsService } from '../vision-ops/vision-ops.service';
import { BillingService } from '../billing/billing.service';
import { WalletService, AiStatus } from '../wallet/wallet.service';
import { WhisperService } from '../whisper/whisper.service';
import { SmartBotService } from '../bot/smart-bot.service';
import { ProductNameMatchService } from '../product-name-match/product-name-match.service';
import { UniversityBotService } from '../university/university-bot.service';
import { TelegramNotificationService } from '../telegram/telegram-notification.service';
import { CourierService } from '../courier/courier.service';
import { normalizePhone } from '../crm/phone.util';
import {
  findMapsShortLink,
  formatSlabsBn,
  haversineKm,
  isRestaurantReady,
  parseMapsPoint,
  parsePriceVariants,
  parseSlabs,
  priceRangeText,
  resolveDeliveryFee,
  resolveMapsShortLink,
} from '../common/restaurant-delivery';
import {
  buildProductCardButtons,
  CUSTOM_CARD_BTN_PREFIX,
  parseCardButtons,
} from '../common/product-card-buttons';
import { MessageLogService } from '../inbox/inbox.module';

function getFullImageUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  const base = process.env.API_BASE_URL || 'https://api.flamboyai.com';
  return `${base.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
}

@Injectable()
export class WebhookService implements OnModuleDestroy {
  private readonly logger = new Logger(WebhookService.name);

  // Per-psid image buffer: collects photos sent in quick succession into one batch
  private readonly imageBuffer = new Map<
    string,
    {
      page: any;
      urls: string[];
      caption?: string;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly IMAGE_BUFFER_MS = 500; // near-instant: process each image as it arrives; tiny window only coalesces a same-burst multi-send (duplicates already de-duped by message.mid)

  // Tracks the last reply sent per pageId:psid during a processMessage call
  private readonly inFlightReply = new Map<string, string>();
  // Maps psid → active replyKey (pageId:psid) so safeSend can use the correct key
  private readonly activeReplyKey = new Map<string, string>();
  // Debounce postback ORDER clicks — prevents double-click duplicate
  private readonly recentPostbacks = new Map<string, number>();
  // De-dupe incoming messages by Facebook's message.mid — Meta can redeliver
  // the same webhook event, which without this caused double replies.
  private readonly recentMessageIds = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly messenger: MessengerService,
    private readonly messageQueue: MessageQueueService,
    private readonly botKnowledge: BotKnowledgeService,
    private readonly ocr: OcrService,
    private readonly ocrQueue: OcrQueueService,
    private readonly botIntent: BotIntentService,
    private readonly ctx: ConversationContextService,
    private readonly draftHandler: DraftOrderHandler,
    private readonly productHandler: ProductInfoHandler,
    private readonly negotiationHandler: NegotiationHandler,
    private readonly crm: CrmService,
    // V18: Image recognition services
    private readonly visionAnalysis: VisionAnalysisService,
    private readonly productMatch: ProductMatchService,
    private readonly fallbackAi: FallbackAiService,
    private readonly aiIntent: AiIntentService,
    private readonly visionOps: VisionOpsService,
    private readonly billing: BillingService,
    private readonly walletService: WalletService,
    private readonly whisper: WhisperService,
    private readonly botContext: BotContextService,
    private readonly smartBot: SmartBotService,
    // V20: CLIP embedding for visual similarity search
    private readonly embeddingService: EmbeddingService,
    // V22: Product name matching for simple products
    private readonly productNameMatch: ProductNameMatchService,
    private readonly universityBot: UniversityBotService,
    private readonly telegram: TelegramNotificationService,
    private readonly courier: CourierService,
    private readonly messageLog: MessageLogService,
    private readonly followUp: FollowUpService,
  ) {}

  onModuleDestroy() {
    for (const entry of this.imageBuffer.values()) {
      clearTimeout(entry.timer);
    }
    this.imageBuffer.clear();
  }

  // ── Smart abandoned-cart follow-up ──────────────────────────────────────────
  // Fires only when the bot reads the customer as deferring ("pore nibo / vebe
  // dekhi") AND they showed real buying interest (an active draft or products
  // we just showed them). It schedules ONE personalized re-engagement after the
  // page-owner's configured delay — so window-shoppers who go quiet get a gentle
  // nudge, while random chatters and people who already ordered are left alone.
  private async maybeScheduleAbandonedFollowUp(
    page: any,
    psid: string,
    text: string,
    draft: any,
    awaitingConfirm: boolean,
  ): Promise<void> {
    // 1. Did the bot understand this as hesitation/deferral?
    if (this.botIntent.detectIntent(text, awaitingConfirm) !== 'SOFT_HESITATION')
      return;

    // 2. Owner must have enabled abandoned-cart follow-ups for this page.
    const settings = await this.followUp.getSettings(page.id);
    if (!settings.abandonedCartEnabled) return;

    // 3. Target only interested customers — an active draft, or products we
    //    presented to them. No interest → no chase.
    const lastProducts = await this.ctx.getLastPresentedProducts(page.id, psid);
    const draftItem = draft?.items?.[0];
    if (!draftItem && lastProducts.length === 0) return;

    // 4. One pending re-engagement per customer — never pile them up.
    const existing = await this.prisma.followUp.findFirst({
      where: {
        pageId: page.id,
        psid,
        triggerType: 'abandoned_cart',
        status: 'pending',
      },
      select: { id: true },
    });
    if (existing) return;

    // 5. Personalize with the customer's name + the product they were eyeing.
    const customer = await this.prisma.customer.findUnique({
      where: { pageId_psid: { pageId: page.id, psid } },
      select: { name: true },
    });
    const name = (draft?.customerName || customer?.name || '').trim() || 'ভাই';
    const product =
      (lastProducts[0]?.name || '').trim() ||
      draftItem?.productCode ||
      'product';
    const message = settings.abandonedCartMsg
      .replace(/\{\{\s*name\s*\}\}/g, name)
      .replace(/\{\{\s*product\s*\}\}/g, product);

    await this.followUp.schedule(page.id, {
      psid,
      triggerType: 'abandoned_cart',
      message,
      delayHours: settings.abandonedCartDelay,
      platform: draft?.platform || 'FACEBOOK',
    });
    this.logger.log(
      `[FollowUp] Scheduled abandoned_cart psid=${psid} page=${page.id} after ${settings.abandonedCartDelay}h`,
    );
  }

  // ── Entry point ────────────────────────────────────────────────────────────

  async handle(body: any): Promise<void> {
    if (!body || body.object !== 'page') return;

    for (const entry of body.entry ?? []) {
      const rows = await this.prisma.$queryRaw<any[]>`
        SELECT p.* FROM "Page" p
        LEFT JOIN "User" u ON u.id = p."ownerId"
        WHERE p."pageId" = ${String(entry.id)}
          AND p."isActive" = true
          AND (u.id IS NULL OR u."isActive" = true)
        LIMIT 1
      `;
      const page = rows[0] ?? null;

      if (!page) {
        this.logger.warn(
          `[Webhook] Entry id=${entry.id} — no active page found (or owner account disabled)`,
        );
        continue;
      }
      if (!page.pageToken) {
        this.logger.warn(
          `[Webhook] Page ${page.pageId} (db id=${page.id}) has no pageToken — skipping`,
        );
        continue;
      }

      // ── Subscription gate ────────────────────────────────────────────────
      if (page.subscriptionStatus === 'SUSPENDED') {
        this.logger.log(
          `[Webhook] Page ${page.pageId} subscription SUSPENDED — skipping`,
        );
        continue;
      }
      if (page.nextBillingDate && new Date(page.nextBillingDate) < new Date()) {
        this.logger.log(
          `[Webhook] Page ${page.pageId} subscription expired (${page.nextBillingDate}) — suspending`,
        );
        await this.prisma.page.update({
          where: { id: page.id },
          data: { subscriptionStatus: 'SUSPENDED' },
        });
        continue;
      }

      // Linked page: inherit settings from master, keep own credentials + id
      let resolvedPage = page;
      if (page.masterPageId) {
        const masterRows = await this.prisma.$queryRaw<any[]>`
          SELECT * FROM "Page" WHERE "id" = ${Number(page.masterPageId)} LIMIT 1
        `;
        if (masterRows[0]) {
          resolvedPage = {
            ...masterRows[0],
            // Preserve linked page identity (id used for orders/sessions, pageId/token for FB API)
            id: page.id,
            ownerId: page.ownerId,
            pageId: page.pageId,
            pageName: page.pageName,
            pageToken: page.pageToken,
            verifyToken: page.verifyToken,
            masterPageId: page.masterPageId,
            // Preserve this page's own mode flags so university pages linked to commerce masters still work
            universityModeOn: page.universityModeOn,
            automationOn: page.automationOn ?? masterRows[0].automationOn,
          };
        }
      }

      for (const event of entry.messaging ?? []) {
        // Echo: message sent BY the page itself. Echoes include the sending
        // app's id — our own bot's replies (sent via this same app's Send
        // API) carry FB_APP_ID and must be ignored here, otherwise the bot
        // would treat its own replies as a human agent taking over. Only an
        // echo from a DIFFERENT app id (Meta Business Suite inbox, or
        // another integration) is a genuine manual agent reply.
        if (event.message?.is_echo) {
          const isOwnBotMessage =
            String(event.message?.app_id ?? '') === String(process.env.FB_APP_ID ?? '');
          const customerPsid: string = event?.recipient?.id;
          const echoText: string = String(event.message?.text ?? '');
          if (customerPsid && !isOwnBotMessage) {
            this.handleAgentEcho(resolvedPage, customerPsid, echoText).catch(
              () => {},
            );
            if (echoText) {
              this.messageLog
                .logByPageId({
                  pageId: resolvedPage.id,
                  customerPsid,
                  platform: 'FACEBOOK',
                  direction: 'OUT',
                  type: 'text',
                  content: echoText,
                })
                .catch(() => {});
            }
          }
          continue;
        }

        const psid: string = event?.sender?.id;
        if (!psid || event.delivery || event.read) continue;

        // V21: m.me catalog referral — ORDER_PRODUCTCODE ref triggers auto order flow
        if (event.referral?.ref || event.postback?.referral?.ref) {
          const ref: string =
            event.referral?.ref ?? event.postback?.referral?.ref ?? '';
          if (ref.startsWith('ORDER_')) {
            const productCode = ref.slice(6).toUpperCase();
            this.handleCatalogReferral(resolvedPage, psid, productCode).catch(
              () => {},
            );
            // Referral already produced the full reply for this event (product
            // card / draft start). Never also run a bundled message through the
            // normal pipeline — that caused two independent replies for one click.
            continue;
          }
          if (!event.message) continue;
        }

        // Card-view postback. Payload shapes:
        //   ORDER_<code>            — catalog card, starts an order draft
        //   SELECT_PRODUCT:<code>   — vision-match card, starts an order draft
        //   DETAILS_<code>          — "বিস্তারিত দেখুন" on a card for a
        //                             merchant using their own website
        //                             (no FlamboyAIduct page to link to)
        //   CARDBTN:<btnId>:<code>  — client-configured custom button
        //                             (product-card-buttons.ts) — replies
        //                             with the client's configured text
        if (event.postback?.payload && !event.message) {
          const payload: string = String(event.postback.payload);
          let productCode: string | null = null;
          let kind: 'order' | 'details' | 'custom' = 'order';
          let customBtnId: string | null = null;
          if (payload.startsWith('ORDER_')) {
            productCode = payload.slice(6).toUpperCase();
          } else if (payload.startsWith('SELECT_PRODUCT:')) {
            productCode = payload.slice('SELECT_PRODUCT:'.length).toUpperCase();
          } else if (payload.startsWith('DETAILS_')) {
            productCode = payload.slice(8).toUpperCase();
            kind = 'details';
          } else if (payload.startsWith(CUSTOM_CARD_BTN_PREFIX)) {
            const rest = payload.slice(CUSTOM_CARD_BTN_PREFIX.length);
            const sep = rest.lastIndexOf(':');
            if (sep > 0) {
              customBtnId = rest.slice(0, sep);
              productCode = rest.slice(sep + 1).toUpperCase();
              kind = 'custom';
            }
          }
          if (productCode) {
            // Debounce: ignore duplicate postback within 5 seconds (double-click)
            const debounceKey = `${psid}:${payload}`;
            const lastAt = this.recentPostbacks.get(debounceKey) ?? 0;
            const now = Date.now();
            if (now - lastAt < 5000) {
              continue; // duplicate click, skip
            }
            this.recentPostbacks.set(debounceKey, now);
            // Clean up old entries to prevent memory leak
            if (this.recentPostbacks.size > 1000) {
              const cutoff = now - 10000;
              for (const [k, t] of this.recentPostbacks) {
                if (t < cutoff) this.recentPostbacks.delete(k);
              }
            }
            if (kind === 'details') {
              this.handleProductDetails(resolvedPage, psid, productCode).catch(() => {});
            } else if (kind === 'custom' && customBtnId) {
              this.handleCustomCardButton(resolvedPage, psid, customBtnId).catch(() => {});
            } else {
              this.handleCatalogReferral(resolvedPage, psid, productCode).catch(() => {});
            }
          }
          continue;
        }

        if (!event.message) continue;

        // De-dupe by Facebook's message id: Meta can redeliver the same
        // webhook event (slow ack, network retry, etc.). Without this, the
        // same customer message gets queued and processed twice — sometimes
        // producing two different replies for one message if bot state
        // (e.g. AI availability) shifted between the two runs.
        const mid: string | undefined = event.message?.mid;
        if (mid) {
          if (this.recentMessageIds.has(mid)) {
            continue;
          }
          this.recentMessageIds.set(mid, Date.now());
          if (this.recentMessageIds.size > 2000) {
            const cutoff = Date.now() - 10 * 60 * 1000;
            for (const [k, t] of this.recentMessageIds) {
              if (t < cutoff) this.recentMessageIds.delete(k);
            }
          }
        }

        // Log every inbound message for the dashboard Inbox, regardless of bot state.
        {
          const inboundText =
            (event.message.text || '').trim() ||
            (event.message.attachments?.[0]?.type
              ? `[${event.message.attachments[0].type}]`
              : '');
          if (inboundText) {
            this.messageLog
              .logByPageId({
                pageId: resolvedPage.id,
                customerPsid: psid,
                platform: 'FACEBOOK',
                direction: 'IN',
                type: event.message.attachments?.length
                  ? event.message.attachments[0].type
                  : 'text',
                content: inboundText,
                externalId: mid ?? null,
              })
              .catch(() => {});
          }
        }

        // Push to persistent queue — returns immediately, worker processes async
        await this.messageQueue
          .add(resolvedPage, psid, event.message)
          .catch((err) =>
            this.logger.error(
              `[Webhook] page=${resolvedPage.pageId} psid=${psid} queue error: ${err}`,
            ),
          );
      }

      // ── Feed events: Facebook post comments ──────────────────────────────
      for (const change of entry.changes ?? []) {
        if (change.field !== 'feed') continue;
        const val = change.value ?? {};
        if (val.item !== 'comment' || val.verb !== 'add') continue;
        // Facebook sends sender as val.from.id (not val.sender_id)
        const senderId: string = String(val.sender_id ?? val.from?.id ?? '');
        if (senderId && senderId === String(resolvedPage.pageId)) continue;

        const commentId: string = val.comment_id ?? '';
        const postId: string = val.post_id ?? '';
        const commentText: string = String(val.message ?? '').trim();
        const commenterName: string = String(val.from?.name ?? '').trim();
        const commenterId: string = String(val.from?.id ?? '').trim();
        if (!commentId || !commentText) continue;

        this.handleCommentReply(
          resolvedPage,
          commentId,
          postId,
          commentText,
          commenterName,
          commenterId,
        ).catch((err) =>
          this.logger.error(`[Webhook] Comment reply error: ${err}`),
        );
      }
    }
  }

  // ── Comment reply handler ─────────────────────────────────────────────────

  private async handleCommentReply(
    page: any,
    commentId: string,
    postId: string,
    commentText: string,
    commenterName: string = '',
    commenterId: string = '',
  ): Promise<void> {
    if (!page.commentReplyOn || !page.automationOn) return;
    // M-4: skip if page has no token
    if (!page.pageToken) return;

    const postIdPart = postId.includes('_')
      ? postId.split('_').slice(1).join('_')
      : postId;

    type ProductInfo = {
      code: string;
      name: string | null;
      price: number;
      stockQty: number;
      description: string | null;
    };
    const productSelect = {
      code: true,
      name: true,
      price: true,
      stockQty: true,
      description: true,
    } as const;

    // Try post-linked products first; fall back to full page catalog (capped at 15)
    let products: ProductInfo[] = await this.prisma.product.findMany({
      where: { pageId: page.id, isActive: true, fbPostId: postIdPart },
      select: productSelect,
    });
    if (products.length === 0) {
      products = await this.prisma.product.findMany({
        where: { pageId: page.id, isActive: true },
        select: productSelect,
        orderBy: { stockQty: 'desc' },
        take: 15,
      });
    }

    const classification = await this.botIntent.classifyComment(
      products,
      commentText,
    );
    if (!classification?.shouldReply) return;

    const { productCodes, intent } = classification;
    const mention = commenterId
      ? `@[${commenterId}] `
      : commenterName
        ? `${commenterName} `
        : '';
    const inboxCta = `\n\n📩 Order বা আরও তথ্যের জন্য আমাদের Inbox-এ message করুন।`;

    // M-8: deduct wallet before send so cost is always recorded even if send fails
    const deduct = () =>
      this.walletService.deductUsage(page.id, 'COMMENT_REPLY');

    // All-prices intent: list every post product's price
    if (
      intent === 'all_prices' ||
      (intent === 'price' && productCodes.length === 0 && products.length > 0)
    ) {
      const lines = products
        .map((p, i) => `${i + 1}. ${p.name ?? p.code} — ${p.price}৳`)
        .join('\n');
      const reply = `${mention}📦 আমাদের সব product এর দাম:\n${lines}${inboxCta}`;
      await deduct();
      await this.messenger.sendCommentReply(page.pageToken, commentId, reply);
      this.logger.log(
        `[Webhook] All-prices comment reply page=${page.pageId} commentId=${commentId}`,
      );
      return;
    }

    // Emoji or praise comment → warm appreciation reply
    if (intent === 'emoji_praise') {
      const reply = `${mention}ধন্যবাদ! ❤️ আপনার ভালোবাসাই আমাদের অনুপ্রেরণা! 😊 কোনো product সম্পর্কে জানতে চাইলে Inbox-এ message করুন। 📩`;
      await deduct();
      await this.messenger.sendCommentReply(page.pageToken, commentId, reply);
      this.logger.log(
        `[Webhook] Emoji/praise comment reply page=${page.pageId} commentId=${commentId}`,
      );
      return;
    }

    // No specific product or general question → generic inbox CTA
    if (productCodes.length === 0 || intent === 'other') {
      await deduct();
      await this.messenger.sendCommentReply(
        page.pageToken,
        commentId,
        mention + this.getGenericCommentReply(),
      );
      this.logger.log(
        `[Webhook] Generic comment reply page=${page.pageId} commentId=${commentId}`,
      );
      return;
    }

    const matched = products.filter((p) => productCodes.includes(p.code));
    if (matched.length === 0) {
      await deduct();
      await this.messenger.sendCommentReply(
        page.pageToken,
        commentId,
        mention + this.getGenericCommentReply(),
      );
      return;
    }

    // Multiple specific products matched — combine replies without per-item CTA
    if (matched.length > 1) {
      const parts = matched
        .map((p) => this.buildProductLine(p, intent, page))
        .filter(Boolean);
      if (!parts.length) return;
      const reply = mention + parts.join('\n') + inboxCta;
      await deduct();
      await this.messenger.sendCommentReply(page.pageToken, commentId, reply);
      this.logger.log(
        `[Webhook] Multi-product comment reply page=${page.pageId} commentId=${commentId} codes=${productCodes.join(',')}`,
      );
      return;
    }

    // Single product
    const reply = this.buildCommentReply(matched[0], intent, page);
    if (!reply) return;
    await deduct();
    await this.messenger.sendCommentReply(
      page.pageToken,
      commentId,
      mention + reply,
    );
    this.logger.log(
      `[Webhook] Comment replied page=${page.pageId} commentId=${commentId} code=${productCodes[0]} intent=${intent}`,
    );
  }

  // Single-line summary for multi-product reply (no CTA — added once at the end)
  private buildProductLine(
    product: any,
    intent: string,
    page: any,
  ): string | null {
    const label = product.name ?? product.code;
    switch (intent) {
      case 'price':
        return `• ${label} — ${product.price}৳ 🏷️`;
      case 'stock':
        return `• ${label} — ${product.stockQty > 0 ? `${product.stockQty}টি stock ✅` : 'stock নেই ❌'}`;
      case 'delivery':
        return isRestaurantReady(page)
          ? `• ডেলিভারি চার্জ দূরত্ব অনুযায়ী: ${formatSlabsBn(parseSlabs(page.deliverySlabsJson))} 🛵`
          : `• ঢাকার ভেতরে ${page.deliveryFeeInsideDhaka ?? 80}৳, বাইরে ${page.deliveryFeeOutsideDhaka ?? 120}৳ 🚚`;
      case 'description':
        return product.description
          ? `• ${label}: ${product.description}`
          : null;
      default:
        return null;
    }
  }

  private buildCommentReply(
    product: any,
    intent: string,
    page: any,
  ): string | null {
    const label = product.name
      ? `${product.name} (${product.code})`
      : product.code;
    const inboxCta = `\n\n📩 Order বা আরও তথ্যের জন্য আমাদের Inbox-এ message করুন।`;
    switch (intent) {
      case 'price':
        return `${label} এর দাম ${product.price}৳ 🏷️${inboxCta}`;
      case 'stock':
        return (
          (product.stockQty > 0
            ? `${label} এ ${product.stockQty} টি stock আছে ✅`
            : `${label} বর্তমানে stock এ নেই ❌`) + inboxCta
        );
      case 'delivery':
        return isRestaurantReady(page)
          ? `ডেলিভারি চার্জ দূরত্ব অনুযায়ী: ${formatSlabsBn(parseSlabs(page.deliverySlabsJson))}। Exact charge জানতে আমাদের website-এ ম্যাপে location pin করুন: ${this.buildCatalogUrl(page)} 🛵`
          : `ঢাকার ভেতরে ডেলিভারি ${page.deliveryFeeInsideDhaka ?? 80}৳, বাইরে ${page.deliveryFeeOutsideDhaka ?? 120}৳ 🚚${inboxCta}`;
      case 'description':
        return product.description ? `${product.description}${inboxCta}` : null;
      default:
        return null;
    }
  }

  private getGenericCommentReply(): string {
    return `আগ্রহের জন্য ধন্যবাদ! 😊 আমাদের Inbox-এ message করুন — দাম, stock ও অর্ডার সম্পর্কে সব তথ্য পাবেন। 📩`;
  }

  // ── V21: Catalog referral handler ─────────────────────────────────────────

  private async handleCatalogReferral(
    page: any,
    psid: string,
    productCode: string,
  ): Promise<void> {
    const pageId = page.id as number;
    const tok = page.pageToken as string;

    const product = await this.prisma.product.findFirst({
      where: { pageId, code: productCode, isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        price: true,
        stockQty: true,
        imageUrl: true,
        variantOptions: true,
      },
    });

    if (!product) {
      this.logger.warn(
        `[CatalogRef] Product ${productCode} not found for page ${pageId}`,
      );
      return;
    }

    const currency = page.currencySymbol || '৳';
    const inStock = product.stockQty > 0;
    const priceFormatted = Number(product.price).toLocaleString();

    // Parse variant options (size, color, etc.)
    let variantOptions: CustomFieldDef[] = [];
    if (product.variantOptions) {
      try {
        variantOptions = this.draftHandler.normalizeVariantOptions(
          JSON.parse(product.variantOptions as string),
        );
      } catch {}
    }

    // Increment product view from referral click
    void this.prisma.product
      .update({
        where: { id: product.id },
        data: { productViews: { increment: 1 } },
      })
      .catch(() => {});

    if (!inStock) {
      await this.messenger
        .sendText(tok, psid, `🛍️ ${product.name || product.code}\n\n💰 মূল্য: ${currency}${priceFormatted}\n❌ এই product এর stock শেষ।\n\nআমাদের অন্য product দেখতে চাইলে বলুন।`)
        .catch(() => {});
      return;
    }

    const newDraft = this.draftHandler.startDraftFromCodes(
      [product.code],
      [{ code: product.code, price: Number(product.price) }],
      variantOptions,
    );
    await this.ctx.saveDraft(pageId, psid, newDraft).catch(() => {});

    // First prompt: variant if exists, else name
    let firstMsg: string;
    if (variantOptions.length > 0) {
      const firstField = variantOptions[0];
      firstMsg = `🛍️ ${product.name || product.code} — ${currency}${priceFormatted}\n✅ Stock আছে\n\n`;
      if (firstField.choices?.length) {
        firstMsg += `${firstField.label} কোনটা নেবেন?\n${firstField.choices.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;
      } else {
        firstMsg += `${firstField.label} জানান 💖`;
      }
    } else {
      firstMsg = `🛍️ ${product.name || product.code} — ${currency}${priceFormatted}\n✅ Stock আছে\n\nঅর্ডার করতে আপনার নামটা বলুন 💖`;
    }

    await this.messenger
      .sendText(tok, psid, firstMsg)
      .catch((err) =>
        this.logger.error(`[CatalogRef] sendText failed psid=${psid}: ${err}`),
      );

    this.logger.log(
      `[CatalogRef] psid=${psid} opened catalog for product ${productCode} — referral handled`,
    );
  }

  /**
   * "বিস্তারিত দেখুন" postback for merchants who redirected their storefront
   * to their own website (Page.websiteUrl set) — there's no FlamboyAI-hosted
   * product page to link to, so send the full description in-chat instead.
   */
  private async handleProductDetails(
    page: any,
    psid: string,
    productCode: string,
  ): Promise<void> {
    const pageId = page.id as number;
    const tok = page.pageToken as string;

    const product = await this.prisma.product.findFirst({
      where: { pageId, code: productCode, isActive: true },
      select: {
        code: true,
        name: true,
        price: true,
        originalPrice: true,
        stockQty: true,
        description: true,
        deliveryCharge: true,
      },
    });
    if (!product) return;

    const currency = page.currencySymbol || '৳';
    const priceFormatted = Number(product.price).toLocaleString();
    const offerLine =
      product.originalPrice && Number(product.originalPrice) > Number(product.price)
        ? ` (আগের দাম ${currency}${Number(product.originalPrice).toLocaleString()})`
        : '';
    const stockLine = product.stockQty > 0 ? '✅ Stock আছে' : '❌ Stock শেষ';
    const deliveryLine =
      product.deliveryCharge === 'FREE' ? '\n🚚 Home Delivery ফ্রি' : '';
    const descLine = product.description ? `\n\n${product.description}` : '';

    await this.messenger
      .sendText(
        tok,
        psid,
        `🛍️ ${product.name || product.code}\n💰 ${currency}${priceFormatted}${offerLine}\n${stockLine}${deliveryLine}${descLine}`,
      )
      .catch((err) =>
        this.logger.error(`[ProductDetails] sendText failed psid=${psid}: ${err}`),
      );
  }

  /**
   * Client-configured custom card button (product-card-buttons.ts) with a
   * fixed reply-text action — replies with whatever text the client set for
   * that button in Settings.
   */
  private async handleCustomCardButton(
    page: any,
    psid: string,
    buttonId: string,
  ): Promise<void> {
    const buttons = parseCardButtons(page.productCardButtonsJson);
    const btn = buttons.find((b) => b.id === buttonId && b.type === 'custom');
    if (!btn?.replyText) return;
    await this.messenger
      .sendText(page.pageToken, psid, btn.replyText)
      .catch((err) =>
        this.logger.error(`[CustomCardBtn] sendText failed psid=${psid}: ${err}`),
      );
  }

  // ── Message router ─────────────────────────────────────────────────────────

  async processMessage(page: any, psid: string, message: any): Promise<void> {
    const pageId = page.id as number;
    const customerText = (message.text || '').trim();

    // Master automation switch — if OFF, bot stays completely silent
    if (!page.automationOn) return;

    // Clear any stale reply tracking for this page+psid before processing
    const replyKey = `${pageId}:${psid}`;
    this.inFlightReply.delete(replyKey);
    this.activeReplyKey.set(psid, replyKey);

    await this._processMessageInner(page, psid, message);

    // Save conversation exchange to history for AI context
    if (customerText) {
      const botReply = this.inFlightReply.get(replyKey) ?? null;
      if (botReply) {
        await this.ctx
          .appendToHistory(pageId, psid, customerText, botReply)
          .catch(() => {});
      }
      this.inFlightReply.delete(replyKey);
    }
    this.activeReplyKey.delete(psid);

    // Record the current draft step after processing so loop detection can compare next time.
    // Never let a bookkeeping failure surface as a job failure — a reply may already
    // have been sent, and retrying the job would re-run AI generation and double-send.
    try {
      const updatedDraft = await this.ctx.getActiveDraft(pageId, psid);
      await this.ctx.recordDraftStepAfterProcessing(
        pageId,
        psid,
        updatedDraft?.currentStep ?? null,
      );
    } catch (err: any) {
      this.logger.warn(
        `[Webhook] recordDraftStepAfterProcessing failed: ${err?.message}`,
      );
    }
  }

  private async _processMessageInner(
    page: any,
    psid: string,
    message: any,
  ): Promise<void> {
    const pageId = page.id as number;
    const token = page.pageToken as string; // encrypted — MessengerService decrypts it

    // FIX 4: skip blocked customers — no reply, no order, no OCR
    const isBlocked = await this.crm.isBlocked(pageId, psid);
    if (isBlocked) {
      this.logger.log(
        `[Webhook] Skipping blocked customer psid=${psid} page=${page.pageId}`,
      );
      return;
    }

    // Agent handling mode — bot stays silent until agent resumes bot from dashboard
    const agentHandling = await this.ctx.isAgentHandling(
      pageId,
      psid,
      page.autoPauseTimeoutMinutes ?? 120,
    );
    if (agentHandling) {
      this.logger.log(
        `[Webhook] Bot muted (agent mode) — ignoring message. psid=${psid} page=${page.pageId}`,
      );
      return;
    }

    // ── University Mode — bypass commerce pipeline entirely ───────────────
    if (page.universityModeOn) {
      const text = message.text?.trim() || '';
      const reply = await this.universityBot.handleMessage(page, psid, text);
      if (reply) await this.safeSend(token, psid, reply);
      return;
    }

    // ── Image → payment screenshot OR product OCR ─────────────────────────
    const img = message.attachments?.find(
      (a: any) => a.type === 'image' && a.payload?.url,
    );
    if (img) {
      // V17: if customer is at advance_payment step, route to payment screenshot handler
      const currentDraft = await this.ctx.getActiveDraft(pageId, psid);
      if (currentDraft?.currentStep === 'advance_payment') {
        const payAccepted = await this.ocrQueue.add(() =>
          this.handlePaymentScreenshot(
            page,
            psid,
            img.payload.url,
            currentDraft,
          ),
        );
        if (!payAccepted) {
          // Queue full — run directly via Gemini (API, no local CPU needed)
          void this.handlePaymentScreenshot(
            page,
            psid,
            img.payload.url,
            currentDraft,
            true,
          ).catch(() => {});
        }
        return;
      }

      if (!page.infoModeOn) return;

      // V8: pass caption text alongside image URL for combined detection
      const caption = (message.text || '').trim() || undefined;
      this.bufferCustomerImage(page, psid, img.payload.url, caption);
      return;
    }

    // ── Messenger location share → restaurant delivery fee ────────────────
    const locationAttachment = message.attachments?.find(
      (a: any) =>
        a.type === 'location' &&
        (a.payload?.coordinates?.lat !== undefined ||
          a.payload?.coordinates?.latitude !== undefined),
    );
    if (locationAttachment && isRestaurantReady(page)) {
      const coords = locationAttachment.payload.coordinates;
      await this.replyRestaurantLocationFee(
        page,
        psid,
        Number(coords.lat ?? coords.latitude),
        Number(coords.long ?? coords.longitude ?? coords.lng),
      );
      return;
    }

    // ── Audio (voice message) → Whisper STT ───────────────────────────────
    const audioAttachment = message.attachments?.find(
      (a: any) => a.type === 'audio' && a.payload?.url,
    );
    if (audioAttachment) {
      const audioAccepted = await this.ocrQueue.add(() =>
        this.handleAudioMessage(page, psid, audioAttachment.payload.url),
      );
      if (!audioAccepted) {
        // Queue full — Whisper is already an external API (no local CPU), run directly
        void this.handleAudioMessage(
          page,
          psid,
          audioAttachment.payload.url,
        ).catch(() => {});
      }
      return;
    }

    // ── Facebook Like button (👍 sticker_id 369239263222822) → treat as "👍" text
    const LIKE_STICKER_ID = 369239263222822;
    const isLikeSticker =
      message.sticker_id === LIKE_STICKER_ID ||
      (message.attachments ?? []).some(
        (a: any) => a.payload?.sticker_id === LIKE_STICKER_ID,
      );

    let text = (message.text || '').trim();
    if (!text && isLikeSticker) text = '👍';
    if (!text) return;

    // ── Restaurant: customer pasted a Google Maps link / raw coordinates ──
    // Understand it directly and quote the exact delivery fee.
    if (isRestaurantReady(page)) {
      let point = parseMapsPoint(text);
      if (!point) {
        const shortLink = findMapsShortLink(text);
        if (shortLink) point = await resolveMapsShortLink(shortLink);
      }
      if (point) {
        await this.replyRestaurantLocationFee(page, psid, point.lat, point.lng);
        return;
      }
    }

    // Auto-expire drafts older than 24 hours
    let draft = await this.ctx.getActiveDraft(pageId, psid);
    if (draft) {
      const session = await this.ctx.getSession(pageId, psid);
      const hoursSince = session
        ? (Date.now() - new Date(session.updatedAt).getTime()) / 3_600_000
        : 0;
      if (hoursSince > 24) {
        await this.ctx.clearDraft(pageId, psid);
        draft = null;
        this.logger.log(
          `[Draft] Expired (${Math.floor(hoursSince)}h old) for psid=${psid}`,
        );
      }
    }
    const awaitingConfirm =
      draft?.currentStep === 'confirm' ||
      (draft?.pendingMultiPreview?.length ?? 0) > 0 ||
      (draft?.pendingVisionMatches?.length ?? 0) > 0;

    // ── Reply-to-post product recognition ─────────────────────────────────
    // When a customer replies to / shares one of our Facebook posts (e.g. opens
    // a product post and asks "price?"), figure out which product it is by
    // matching the referenced post id against Product.fbPostId, and remember it
    // as the "last presented product" so SmartBot answers directly instead of
    // asking "which product?". Best-effort + additive: on no match it just logs
    // and normal handling continues.
    try {
      const refPostId = this.extractReferencedPostId(message);
      if (refPostId) {
        const linked = await this.prisma.product.findMany({
          where: { pageId, isActive: true, fbPostId: refPostId },
          select: { code: true, name: true, price: true },
          take: 5,
        });
        if (linked.length > 0) {
          await this.ctx.setLastPresentedProducts(
            pageId,
            psid,
            linked.map((p) => ({ code: p.code, name: p.name, price: p.price })),
          );
          this.logger.log(
            `[Webhook] Reply-to-post matched ${linked.map((p) => p.code).join(',')} via fbPostId=${refPostId} psid=${psid}`,
          );
        } else {
          this.logger.debug(
            `[Webhook] Reply-to-post postId=${refPostId} matched no product (page=${pageId})`,
          );
        }
      }
    } catch (e) {
      this.logger.debug(`[Webhook] extractReferencedPostId failed: ${e}`);
    }

    const aiAllowed = await this.isAiAllowedForPage(page.ownerId);
    const aiStatus: AiStatus = await this.walletService.getAiStatus(pageId);

    // Trial daily limit exceeded — bot silent, agent can still reply manually
    if (aiStatus === 'trial_limit_exceeded') return;

    // ── BUSINESS INFO BOT — replies using businessInfo as knowledge base ──
    if (page.businessBotOn) {
      if (!page.businessInfo) {
        await this.safeSend(
          token,
          psid,
          'আমাদের সাথে যোগাযোগ করার জন্য ধন্যবাদ! 🙏 শীঘ্রই আপনার সাথে যোগাযোগ করা হবে।',
        );
        return;
      }
      if (aiStatus === 'ok') {
        const result = await this.generateBusinessBotReply(
          page.businessInfo as string,
          text,
          pageId,
          psid,
        );
        if (result) {
          await this.safeSend(token, psid, result.reply);
          void this.walletService.deductUsage(pageId, 'TEXT', { charCount: result.charCount });
          return;
        }
      } else {
        await this.safeSend(
          token,
          psid,
          'আমাদের সাথে যোগাযোগ করার জন্য ধন্যবাদ! 🙏 শীঘ্রই আপনার সাথে যোগাযোগ করা হবে।',
        );
        return;
      }
    }

    // ── CANCELLED ORDER: advance refund request ───────────────────────────────
    // The cancellation itself is now announced once, proactively, right when
    // the order is cancelled (OrderNotificationService.notifyCancelled) — this
    // block only handles a customer asking about their refund afterward. It
    // used to also unconditionally repeat the cancellation notice on every
    // subsequent message forever with no way out; that's gone.
    if (!draft && page.orderModeOn) {
      const activeOrder = await this.findRecentCustomerOrder(pageId, psid);
      if (!activeOrder) {
        const wantsNewOrder =
          /notun|new\s*or?der|abar\s*or?der|নতুন\s*অর্ডার|আবার\s*অর্ডার/i.test(text) ||
          ['ORDER_INTENT', 'CATALOG_REQUEST'].includes(
            this.botIntent.detectIntent(text, false) || '',
          );
        const cancelledOrder = wantsNewOrder
          ? null
          : await this.findCancelledOrder(pageId, psid);
        if (cancelledOrder) {
          const pageInfo = await this.prisma.page.findUnique({
            where: { id: pageId },
            select: { telegramBotToken: true, telegramChatId: true, currencySymbol: true },
          });

          // ── ADVANCE REFUND REQUEST ──────────────────────────────────────────
          if (this.isAdvanceRefundRequest(text)) {
            const advanceCollections = cancelledOrder.collections ?? [];
            const totalAdvance = advanceCollections.reduce((s: number, c: { amount: number }) => s + c.amount, 0);
            const hasAdvance = totalAdvance > 0 || cancelledOrder.paymentStatus === 'advance_paid';

            if (!hasAdvance) {
              await this.safeSend(token, psid, `❌ আপনার অর্ডার #${cancelledOrder.id} এ কোনো অগ্রিম পেমেন্ট পাওয়া যায়নি।`);
              return;
            }

            // Check if already refunded
            const existingReturn = (cancelledOrder.returnEntries ?? []).find(
              (r: { id: number; refundStatus: string }) => r.refundStatus === 'given'
            );
            if (existingReturn) {
              const sym = pageInfo?.currencySymbol || '৳';
              await this.safeSend(token, psid, `✅ আপনার অগ্রিম ${sym}${totalAdvance} আগেই ফেরত দেওয়া হয়েছে। আর কোনো রিফান্ড সম্ভব নয়।`);
              return;
            }

            // Check if refund already requested (pending)
            const pendingReturn = (cancelledOrder.returnEntries ?? []).find(
              (r: { id: number; refundStatus: string }) => r.refundStatus === 'pending'
            );
            if (pendingReturn) {
              await this.safeSend(token, psid, `⏳ আপনার অগ্রিম ফেরতের অনুরোধ ইতিমধ্যে পাঠানো হয়েছে। শীঘ্রই যোগাযোগ করা হবে।`);
              return;
            }

            // Create ReturnEntry (pending)
            const returnEntry = await this.prisma.returnEntry.create({
              data: {
                pageId,
                orderId: cancelledOrder.id,
                returnType: 'full',
                refundAmount: totalAdvance,
                returnCost: 0,
                note: 'Customer requested via Messenger',
                refundStatus: 'pending',
                refundPhoneNumber: cancelledOrder.phone || null,
              },
            });

            // Send Telegram notification with confirm button
            if (pageInfo?.telegramBotToken && pageInfo?.telegramChatId) {
              const sym = pageInfo.currencySymbol || '৳';
              await this.telegram.notifyWithButtons(
                pageId,
                [
                  `💸 <b>Advance Refund Request</b>`,
                  `📦 Order #${cancelledOrder.id} — ${cancelledOrder.customerName || 'Customer'}`,
                  `📞 ${cancelledOrder.phone || '—'}`,
                  `💰 Advance Paid: ${sym}${totalAdvance}`,
                  `\n✅ Click below after sending refund:`,
                ].join('\n'),
                [[
                  { text: `✅ Refund দিয়েছি (${sym}${totalAdvance})`, callback_data: `advrefund_confirm_${returnEntry.id}` },
                  { text: `❌ Skip`, callback_data: `advrefund_skip_${returnEntry.id}` },
                ]],
              );
            }

            await this.safeSend(token, psid, `✅ আপনার অগ্রিম ফেরতের অনুরোধ পাঠানো হয়েছে। শীঘ্রই আপনার সাথে যোগাযোগ করা হবে।`);
            return;
          }
          // Not an advance-refund request — nothing more to intercept here;
          // fall through to normal handling (SmartBot/keyword pipeline) so
          // the customer's actual message still gets answered.
        }
      }
    }

    // ── ORDER STATUS / LIVE TRACKING QUERY ────────────────────────────────────
    // Runs before the SmartBot gate so it works the same whether the page uses
    // SmartBot or the keyword pipeline — SmartBot answers everything itself and
    // never falls through to the keyword-only block further below. Gated on
    // !draft so it never interrupts an order the customer is actively placing.
    if (!draft && page.orderModeOn && this.isOrderStatusQuery(text)) {
      const phone = this.extractTrackingPhone(text);
      const orders = await this.findOrdersForTrackingQuery(pageId, psid, phone);
      if (orders.length > 0) {
        await this.safeSend(token, psid, await this.buildOrderStatusReply(pageId, orders));
        return;
      }
    }

    // ── CATALOG REQUEST (pre-SmartBot) — card view ──────────────────────
    // Only for pages that opted OUT of SmartBot. SmartBot pages let the AI
    // decide when to show the catalog (SHOW_CATALOG action), so no keyword
    // matching runs for them.
    if (!page.smartBotOn) {
      const preSmartBotIntent = this.botIntent.detectIntent(text, awaitingConfirm);
      if (preSmartBotIntent === 'CATALOG_REQUEST') {
        await this.sendCatalogFallback(token, psid, page);
        return;
      }
    }

    // ── STRUCTURED DRAFT STEPS — deterministic handler ────────────────────
    // Payment-proof (needs OCR) and custom-choice (cf:*) steps always use the
    // deterministic handler. For name/phone/address, SmartBot pages let the AI
    // collect them instead — it understands combined input like
    // "Limon, Mirpur-2 Dhaka, 01700000000" in one message, whereas captureField
    // sends a rigid "fill this form" template and re-asks. Non-SmartBot pages
    // keep the strict deterministic capture for those basic fields.
    const isPaymentOrCustomStep =
      draft?.currentStep &&
      (draft.currentStep.startsWith('cf:') ||
        draft.currentStep === 'advance_payment');
    const isBasicFieldStep =
      draft?.currentStep &&
      ['name', 'phone', 'address'].includes(draft.currentStep);
    const structuredStep =
      isPaymentOrCustomStep || (isBasicFieldStep && !page.smartBotOn);
    if (structuredStep && page.orderModeOn) {
      // A genuine question during a structured step (e.g. "page theke dibo?" or "age
      // payment korte hbe?" while waiting for name/phone/address) must be answered via
      // FAQ, not silently swallowed by captureField's field-shaped-input validation,
      // which would just re-send the same "please give your info" prompt.
      if (
        !draft!.currentStep.startsWith('cf:') &&
        page.infoModeOn &&
        this.draftHandler.looksLikeQuestion(text)
      ) {
        try {
          const learned = await this.botKnowledge.resolveReply(
            pageId,
            text,
            psid,
          );
          if (learned?.reply) {
            void this.walletService.deductUsage(pageId, 'KEYWORD_REPLY');
            await this.safeSend(
              token,
              psid,
              `${learned.reply}\n\n${this.draftHandler.reminder(draft!)}`,
            );
            return;
          }
        } catch {}
        // No FAQ match found — fall through to captureField as before.
      }

      const result = await this.draftHandler.captureField(
        pageId,
        psid,
        text,
        draft!,
        page,
      );
      if (result === null) {
        const stillExists = await this.ctx.getActiveDraft(pageId, psid);
        if (!stillExists) {
          const wasConfirm =
            draft!.currentStep === 'confirm' &&
            this.botIntent.detectIntent(text, true) === 'CONFIRM';
          const key = wasConfirm ? 'order_received' : 'order_cancelled';
          const msg = await this.botKnowledge.resolveSystemReply(pageId, key, undefined, page.agentType);
          await this.safeSend(token, psid, msg);
        }
        return;
      }
      if (typeof result === 'string') {
        await this.safeSend(token, psid, result);
        return;
      }
    }

    // ── SMART BOT — the ONLY brain for SmartBot pages ─────────────────────
    // Keyword intent matching is fully removed here: every message goes
    // straight to the AI, which reads the full chat history for context.
    // If the AI is momentarily unavailable we send a graceful "busy" reply
    // instead of falling back to the retired keyword pipeline.
    if (page.smartBotOn) {
      const smartBotReady = aiAllowed && this.smartBot.isAvailable();
      if (!smartBotReady) {
        // Diagnostic: without this, an aiAllowed=false page produces the "busy"
        // reply with zero logs, making it undiagnosable. aiAllowed gates on the
        // OWNER's billing subscription (plan status + order limit), separate
        // from the page wallet; available gates on the AI provider key/cooldown.
        this.logger.warn(
          `[SmartBot] skipped psid=${psid} page=${pageId} aiStatus=${aiStatus} aiAllowed=${aiAllowed} available=${this.smartBot.isAvailable()} — aiAllowed=owner subscription/order-limit, available=provider key/cooldown`,
        );
      }
      if (smartBotReady) {
        // "typing…" indicator so the bot feels like a real person
        void this.messenger.sendSenderAction(token, psid, 'typing_on');
        const result = await this.smartBot.handle(
          page,
          psid,
          text,
          draft,
          this.draftHandler,
        );
        if (result !== false) {
          if (typeof result === 'object' && (result as any).showCatalog) {
            // AI chose to show the catalog (replaces the CATALOG_REQUEST keyword).
            // Send just the product cards — they carry their own text, so we skip
            // the AI lead-in to avoid a redundant second catalog message.
            await this.sendCatalogFallback(token, psid, page);
          } else if (typeof result === 'object' && (result as any).showProductImage) {
            // Custom Prompt mode: AI asked for one specific product's image
            // (SHOW_PRODUCT_IMAGE) — send the reply text, then the image as
            // its own message. imageUrl came from our own DB lookup in
            // smart-bot.service.ts (product code → Product.imageUrl), never
            // from the model directly, so there's nothing to sanitize here.
            const replyText = result.reply;
            await this.sendReplyInChunks(token, psid, replyText);
            const fullUrl = getFullImageUrl((result as any).imageUrl);
            if (fullUrl) await this.messenger.sendImage(token, psid, fullUrl);
          } else {
            const replyText =
              typeof result === 'string' ? result : result.reply;
            await this.sendReplyInChunks(token, psid, replyText);
          }
          // If the customer is deferring ("pore nibo / vebe dekhi") and showed
          // real interest, quietly schedule a personalized re-engagement.
          void this.maybeScheduleAbandonedFollowUp(
            page,
            psid,
            text,
            draft,
            awaitingConfirm,
          ).catch(() => {});
          return;
        }
      }
      // SmartBot on but AI unavailable/failed (e.g. zero balance, provider down).
      // If the customer is mid-order, fall back to the deterministic capture
      // handler so order-taking still works without AI. Otherwise a graceful
      // "busy" reply (never the retired keyword pipeline).
      const orderStep =
        draft?.currentStep &&
        (draft.currentStep.startsWith('cf:') ||
          ['name', 'phone', 'address', 'advance_payment', 'confirm'].includes(
            draft.currentStep,
          ));
      if (orderStep && page.orderModeOn) {
        const result = await this.draftHandler.captureField(
          pageId,
          psid,
          text,
          draft!,
          page,
        );
        if (result === null) {
          const stillExists = await this.ctx.getActiveDraft(pageId, psid);
          if (!stillExists) {
            const wasConfirm =
              draft!.currentStep === 'confirm' &&
              this.botIntent.detectIntent(text, true) === 'CONFIRM';
            const key = wasConfirm ? 'order_received' : 'order_cancelled';
            const msg = await this.botKnowledge.resolveSystemReply(
              pageId,
              key,
              undefined,
              page.agentType,
            );
            await this.safeSend(token, psid, msg);
          }
          return;
        }
        if (typeof result === 'string') {
          await this.safeSend(token, psid, result);
          return;
        }
      }
      await this.sendSmartBotUnavailable(token, psid, page);
      return;
    }

    // ── INTENT DETECTION ──────────────────────────────────────────────────
    const keywordIntent = this.botIntent.detectIntent(text, awaitingConfirm);

    // If keyword matched a strong intent (GREETING/CATALOG/CANCEL/CODES), skip AI to save cost.
    // Otherwise, or for nuanced intents (NEGOTIATION/SIDE QUESTIONS), use AI brain.
    let intent = keywordIntent;
    let aiResult = {
      intent: null as string | null,
      reply: null as string | null,
    };

    const isStrongKeyword =
      !!keywordIntent &&
      [
        'CATALOG_REQUEST',
        'CANCEL',
        'ORDER_REMOVE_ITEM',
        'MULTI_CONFIRM',
      ].includes(keywordIntent);

    if (isStrongKeyword) {
      void this.walletService.deductUsage(pageId, 'KEYWORD_REPLY');
    }

    if (!isStrongKeyword && aiAllowed) {
      const businessContext =
        await this.botContext.buildBusinessContext(pageId);
      if (businessContext) {
        // Inject conversation state so AI understands "ok" / soft replies in context
        businessContext.lastBotReply = this.inFlightReply.get(psid) ?? null;
        businessContext.lastPresentedProducts = (
          await this.ctx.getLastPresentedProducts(pageId, psid)
        ).map((p) => ({
          code: p.code,
          price: p.price,
          name: p.name ?? undefined,
        }));

        // Pass conversation history only when the message is ambiguous (no keyword match)
        // or for intents that need contextual replies. Skipping history for clear keywords
        // saves ~800 tokens per call.
        const needsHistory = !keywordIntent; // keyword already matched → no history needed
        const chatHistory = needsHistory
          ? await this.ctx.getHistory(pageId, psid)
          : undefined;

        aiResult = await this.aiIntent.detectIntent(
          pageId,
          text,
          awaitingConfirm,
          draft?.currentStep ?? null,
          businessContext,
          chatHistory,
        );
        if (aiResult.intent && aiResult.intent !== 'UNKNOWN') {
          intent = aiResult.intent;
        }
      }
    }

    // ── LOOP / STUCK DETECTION ────────────────────────────────────────────
    const aiEnabled = page.textFallbackAiOn || this.fallbackAi.isAvailable();
    if (aiEnabled) {
      const loopCount = await this.ctx.checkAndUpdateLoop(
        pageId,
        psid,
        text,
        draft?.currentStep ?? null,
      );
      // Only intercept when intent is truly unresolved — never block a recognised intent
      // (e.g. customer sending "ki ki products" twice must still get the catalog link)
      if (loopCount >= 2 && !intent) {
        this.logger.warn(
          `[Loop] Detected loop (count=${loopCount}) for psid=${psid} step=${draft?.currentStep ?? 'none'} text="${text.slice(0, 60)}"`,
        );
        const draftSummary = draft
          ? `Customer has an active order draft (step: ${draft.currentStep ?? 'unknown'}, products: ${(draft.items ?? []).map((i: any) => i.code).join(', ') || 'none'})`
          : null;
        const fbResult = await this.fallbackAi.generateReply({
          customerMessage: text,
          reason: 'unmatched_intent',
          businessName: page.businessName ?? undefined,
          draftStep: draft?.currentStep ?? null,
          draftSummary,
        });
        if (fbResult.reply) {
          const reply = draft
            ? `${fbResult.reply}\n\n${this.draftHandler.reminder(draft)}`
            : fbResult.reply;
          await this.safeSend(token, psid, reply);
          await this.ctx.resetLoop(pageId, psid);
          return;
        }
      }
    }

    // ── MULTI-ADDRESS INTENT — 2 products to 2 different addresses ────────
    if (!draft && this.isMultiAddressIntent(text)) {
      await this.safeSend(
        token,
        psid,
        '💡 আলাদা ঠিকানায় পাঠাতে হলে আলাদাভাবে order করতে হবে।\n\n১ম order confirm করুন → তারপর ২য় product এর order শুরু করুন 💖\n\nকোন product দিয়ে শুরু করবেন?',
      );
      return;
    }

    // ── CANCEL — only when there's something to cancel ────────────────────
    if (intent === 'CANCEL') {
      const hasOpenOrder =
        !draft &&
        !!(await this.prisma.order.findFirst({
          where: {
            pageIdRef: page.id,
            customerPsid: psid,
            status: { in: ['RECEIVED', 'PENDING'] },
          },
          select: { id: true },
        }));
      if (draft || hasOpenOrder) {
        await this.handleCancel(page, psid, draft, aiResult.reply ?? undefined);
      } else {
        const msg =
          aiResult.reply ??
          'ঠিক আছে 💖 কোনো সমস্যা নেই। কিছু জানার থাকলে বলুন।';
        await this.safeSend(token, psid, msg);
      }
      return;
    }

    if ((draft?.pendingVisionMatches?.length ?? 0) > 0) {
      await this.handlePendingVisionSelection(page, psid, text, draft!);
      return;
    }

    // ── PENDING MULTI-PRODUCT PREVIEW ──────────────────────────────────────
    if ((draft?.pendingMultiPreview?.length ?? 0) > 0) {
      await this.handleMultiProductPreview(page, psid, text, intent, draft!);
      return;
    }

    // ── NEGOTIATION ────────────────────────────────────────────────────────
    if (intent === 'NEGOTIATION') {
      const reply =
        aiResult.reply ??
        (await this.negotiationHandler.handle(
          pageId,
          psid,
          text,
          draft,
          message?.reply_to?.text,
        ));
      const reminder = draft ? `\n\n${this.draftHandler.reminder(draft)}` : '';
      await this.safeSend(token, psid, reply + reminder);
      return;
    }

    // ── REMOVE ITEM FROM DRAFT ─────────────────────────────────────────────
    if (intent === 'ORDER_REMOVE_ITEM' && draft) {
      await this.handleRemoveItem(page, psid, text, draft);
      return;
    }

    // ── IN-DRAFT EDITS ─────────────────────────────────────────────────────
    if (draft && intent === 'EDIT_ORDER') {
      const handled = await this.handleDraftEdit(page, psid, text, draft);
      if (handled) return;
    }

    // ── SIDE QUESTION during active draft ─────────────────────────────────
    if (draft && this.botIntent.isSideQuestion(intent) && page.infoModeOn) {
      try {
        const learned = await this.botKnowledge.resolveReply(
          pageId,
          text,
          psid,
        );
        if (learned?.reply) {
          void this.walletService.deductUsage(pageId, 'KEYWORD_REPLY');
          await this.safeSend(
            token,
            psid,
            `${learned.reply}\n\n${this.draftHandler.reminder(draft)}`,
          );
          return;
        }
      } catch {}
      if (aiResult.reply) {
        await this.safeSend(
          token,
          psid,
          `${aiResult.reply}\n\n${this.draftHandler.reminder(draft)}`,
        );
        return;
      }
    }

    // ── MULTI PRODUCT CODES ────────────────────────────────────────────────
    const prefix = (page.productCodePrefix as string | undefined) || 'DF';
    const allCodes = this.botIntent.extractAllCodes(text, prefix);
    if (allCodes.length > 1 && page.infoModeOn) {
      const found = await this.productHandler.getProductsByCodes(
        pageId,
        allCodes,
      );
      if (found.length > 0) {
        const newDraft = this.draftHandler.emptyDraft();
        newDraft.pendingMultiPreview = allCodes;
        await this.ctx.saveDraft(pageId, psid, newDraft);
        await this.productHandler.sendMultiProductPreview(page, psid, allCodes);
        return;
      }
    }

    // ── SINGLE PRODUCT CODE ────────────────────────────────────────────────
    if (allCodes.length === 1 && page.infoModeOn) {
      await this.handleExplicitProductCode(
        page,
        psid,
        text,
        intent,
        draft,
        message,
        allCodes[0],
      );
      return;
    }

    // ── SIMPLE PRODUCT NAME MATCH (text) ──────────────────────────────────
    // No coded product found — try matching customer text against SIMPLE product names
    if (page.infoModeOn && allCodes.length === 0) {
      const simpleProds = await this.prisma.product.findMany({
        where: { pageId, isActive: true, productType: 'SIMPLE' },
        select: {
          code: true,
          name: true,
          price: true,
          stockQty: true,
          unit: true,
          orderEnabled: true,
          description: true,
          productType: true,
        },
      });
      if (simpleProds.length > 0) {
        const nameMatches = this.productNameMatch.matchProducts(
          text,
          simpleProds,
          { simpleOnly: true },
        );
        const strong = nameMatches.filter(
          (m) => m.confidence === 'HIGH' || m.confidence === 'MEDIUM',
        );
        if (strong.length > 0) {
          this.logger.log(
            `[NameMatch] Text matched simple product(s): ${strong.map((m) => m.productCode).join(',')}`,
          );
          await this.sendSimpleProductInfo(page, psid, strong);
          return;
        }
        // LOW confidence — list all simple products
        const low = nameMatches.filter((m) => m.confidence === 'LOW');
        if (low.length > 0) {
          await this.sendSimpleProductInfo(page, psid, low);
          return;
        }
      }
    }

    // ── DRAFT: OpenAI/intent may decide the customer left the order flow ──
    // In that case clear the draft and let the normal routing below handle it.
    if (
      draft &&
      page.orderModeOn &&
      (intent === 'GREETING' ||
        intent === 'CATALOG_REQUEST' ||
        intent === 'SOFT_HESITATION')
    ) {
      await this.ctx.clearDraft(pageId, psid);
      draft = null;
    }

    // ── PENDING POST-ORDER EDIT: customer is providing the new value ─────────
    if (draft?.pendingEditField && !draft.currentStep) {
      const recentEditOrder = page.orderModeOn
        ? await this.findRecentCustomerOrder(pageId, psid)
        : null;
      if (recentEditOrder) {
        await this.handlePostOrderEdit(page, psid, text, recentEditOrder, draft);
        return;
      }
    }

        // ── ACTIVE DRAFT: capture next field ──────────────────────────────────
    if (draft && page.orderModeOn) {
      const result = await this.draftHandler.captureField(
        pageId,
        psid,
        text,
        draft,
        page,
      );

      if (result === null) {
        const stillExists = await this.ctx.getActiveDraft(pageId, psid);
        if (!stillExists) {
          const wasConfirm =
            draft.currentStep === 'confirm' &&
            this.botIntent.detectIntent(text, true) === 'CONFIRM';
          const key = wasConfirm ? 'order_received' : 'order_cancelled';
          const msg = await this.botKnowledge.resolveSystemReply(pageId, key, undefined, page.agentType);
          await this.safeSend(token, psid, msg);
        }
        return;
      }

      if (typeof result === 'string') {
        // If AI is available and this looks like a validation retry (not a progress message),
        // let AI generate a warmer contextual response instead of the rigid retry message
        const isRetry = result.includes('আবার দিন') || result.includes('পুরো');
        if (isRetry && aiEnabled) {
          const updatedDraft = await this.ctx.getActiveDraft(pageId, psid);
          const draftSummary = updatedDraft
            ? `Customer has an active order draft (step: ${updatedDraft.currentStep ?? 'unknown'}, products: ${(updatedDraft.items ?? []).map((i: any) => i.code).join(', ') || 'none'})`
            : null;
          const fbResult = await this.fallbackAi.generateReply({
            customerMessage: text,
            reason: 'unmatched_intent',
            businessName: page.businessName ?? undefined,
            draftStep: updatedDraft?.currentStep ?? draft.currentStep ?? null,
            draftSummary,
          });
          if (fbResult.reply) {
            await this.safeSend(token, psid, fbResult.reply);
            return;
          }
        }
        await this.safeSend(token, psid, result);
        return;
      }
    }

    const recentOrder =
      !draft && page.orderModeOn
        ? await this.findRecentCustomerOrder(pageId, psid)
        : null;

    // Cancellation is now announced once, proactively, at cancel time
    // (OrderNotificationService.notifyCancelled) — the earlier CANCELLED
    // ORDER block already handles refund follow-up questions, so there's
    // nothing left to intercept here. Removed the duplicate repeat-notice
    // that used to fire again at this later point in the pipeline.

    // ── POST-ORDER FOLLOW-UP (after draft already finalized) ──────────────
    if (recentOrder && intent === 'EDIT_ORDER') {
      await this.handlePostOrderEdit(page, psid, text, recentOrder, null);
      return;
    }

    if (recentOrder && this.isPostOrderCancel(text)) {
      await this.handlePostOrderCancel(page, psid, recentOrder);
      return;
    }

    if (recentOrder && intent === 'CONFIRM') {
      // V20: Only trigger if order is very recent (last 2 hours) to avoid false "Ok" triggers on old orders
      const orderAgeHours =
        (Date.now() - new Date(recentOrder.createdAt).getTime()) / 3_600_000;
      if (orderAgeHours < 2) {
        await this.safeSend(
          token,
          psid,
          'ধন্যবাদ 💖 আপনার order request already received হয়েছে। দরকার হলে "size change", "phone change", "address change" বা "name change" লিখুন।',
        );
        return;
      }
    }

    // ── ORDER INFO detected without active draft (smart field capture) ────
    if (!draft && page.orderModeOn) {
      const parsed = this.draftHandler.parseCustomerInfo(text);
      const hasOrderInfo = !!(
        parsed.phone ||
        (parsed.name && parsed.address) ||
        parsed.address
      );
      if (hasOrderInfo) {
        const contextCode = await this.resolveReferencedProductCode(
          pageId,
          psid,
          message,
        );
        if (contextCode) {
          const product = await this.prisma.product.findFirst({
            where: { pageId, code: contextCode, stockQty: { gt: 0 } },
          });
          if (product) {
            let variantOptions: any[] = [];
            try {
              if (product.variantOptions)
                variantOptions = this.draftHandler.normalizeVariantOptions(
                  JSON.parse(product.variantOptions),
                );
            } catch {}
            const newDraft = this.draftHandler.startDraftFromCodes(
              [contextCode],
              [product as any],
              variantOptions,
            );
            const crmCust = await this.prefillDraftFromCrm(
              pageId,
              psid,
              newDraft,
            );
            if (crmCust?.name && crmCust?.phone && crmCust?.address) {
              newDraft.currentStep = 'confirm_address';
              await this.ctx.saveDraft(pageId, psid, newDraft);
              await this.safeSend(
                token,
                psid,
                `স্বাগতম ফিরে ${crmCust.name}! 🎉\n\nআগের ঠিকানায় পাঠাব?\n📍 *${crmCust.address}*\n\n"হ্যাঁ" বললে যাবে, অথবা নতুন ঠিকানা দিন 💖`,
              );
              return;
            }
            await this.ctx.saveDraft(pageId, psid, newDraft);
            const result = await this.draftHandler.captureField(
              pageId,
              psid,
              text,
              newDraft,
              page,
            );
            if (typeof result === 'string')
              await this.safeSend(token, psid, result);
            return;
          }
        }
        // Has order info but no product context — ask which product
        await this.safeSend(
          token,
          psid,
          'কোন product এর order করবেন? code বা screenshot দিন 💖',
        );
        return;
      }
    }

    // ── DUAL PHOTO MODE ────────────────────────────────────────────────────
    if (intent === 'DUAL_WEARING' || intent === 'DUAL_HOLDING') {
      if (!page.dualPhotoMode) {
        await this.safeSend(
          token,
          psid,
          aiResult.reply ??
            'Dual Photo Mode চালু নেই। Product code বা screenshot দিন 😊',
        );
        return;
      }
      const productId =
        intent === 'DUAL_WEARING'
          ? page.dualWearingProductId
          : page.dualHoldingProductId;
      if (!productId) {
        await this.safeSend(
          token,
          psid,
          aiResult.reply ?? 'Product এখনো set হয়নি।',
        );
        return;
      }
      const dualProduct = await this.prisma.product.findFirst({
        where: { id: Number(productId), pageId, isActive: true },
      });
      if (!dualProduct) {
        await this.safeSend(token, psid, 'Product পাওয়া যায়নি।');
        return;
      }
      if (aiResult.reply) await this.safeSend(token, psid, aiResult.reply);
      await this.ctx.setLastPresentedProducts(pageId, psid, [
        { code: dualProduct.code, price: Number(dualProduct.price) },
      ]);
      // Clear pending dual image (customer has now picked a product)
      const dualDraft = await this.ctx.getActiveDraft(pageId, psid);
      if (dualDraft?.pendingDualImageUrl) {
        dualDraft.pendingDualImageUrl = undefined;
        dualDraft.pendingDualAllImageUrls = undefined;
        await this.ctx.saveDraft(pageId, psid, dualDraft);
      }
      // Send full product card
      await this.productHandler.sendProductInfo(page, psid, dualProduct.code);
      return;
    }

    // ── ORDER INTENT without product code ─────────────────────────────────
    if (intent === 'ORDER_INTENT' && page.orderModeOn) {
      const contextCode = await this.resolveReferencedProductCode(
        pageId,
        psid,
        message,
      );
      if (contextCode) {
        const product = await this.prisma.product.findFirst({
          where: { pageId, code: contextCode },
        });
        if (product && product.stockQty > 0) {
          let variantOptions: CustomFieldDef[] = [];
          if (product.variantOptions) {
            try {
              variantOptions = this.draftHandler.normalizeVariantOptions(
                JSON.parse(product.variantOptions),
              );
            } catch {
              /* ignore */
            }
          }
          const newDraft = this.draftHandler.startDraftFromCodes(
            [contextCode],
            [product as any],
            variantOptions,
          );
          const crmFill = await this.prefillDraftFromCrm(
            pageId,
            psid,
            newDraft,
          );
          if (crmFill?.name && crmFill?.phone && crmFill?.address) {
            newDraft.currentStep = 'confirm_address';
            await this.ctx.saveDraft(pageId, psid, newDraft);
            await this.safeSend(
              token,
              psid,
              `স্বাগতম ফিরে ${crmFill.name}! 🎉\n\nআগের ঠিকানায় পাঠাব?\n📍 *${crmFill.address}*\n\n"হ্যাঁ" বললে যাবে, অথবা নতুন ঠিকানা দিন 💖`,
            );
            return;
          }
          await this.ctx.saveDraft(pageId, psid, newDraft);
          if (variantOptions.length > 0) {
            const firstField = variantOptions[0];
            const opts = firstField.choices?.length
              ? `\n${firstField.choices.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
              : '';
            const returnGreet = crmFill?.totalOrders ? 'স্বাগতম ফিরে! 🎉 ' : '';
            await this.safeSend(
              token,
              psid,
              `${returnGreet}ঠিক আছে 💖 ${contextCode} এর জন্য order নিচ্ছি।\n\n${firstField.label} কোনটা নেবেন?${opts}`,
            );
          } else {
            const returnGreet = crmFill?.totalOrders ? 'স্বাগতম ফিরে! 🎉 ' : '';
            await this.safeSend(
              token,
              psid,
              `${returnGreet}ঠিক আছে! 😊 ${contextCode} order করছি।\n\nপ্রথমে আপনার **নামটা** বলুন।`,
            );
          }
          return;
        }
      }
      await this.safeSend(
        token,
        psid,
        'কোন product এর order করবেন? code বা screenshot দিন 💖',
      );
      return;
    }

    // ── GREETING ───────────────────────────────────────────────────────────
    if (intent === 'GREETING') {
      const greetReply =
        aiResult.reply ?? 'জি বলুন 😊 কীভাবে সাহায্য করতে পারি?';
      await this.safeSend(token, psid, greetReply);
      return;
    }

    // ── CATALOG REQUEST ────────────────────────────────────────────────────
    if (intent === 'CATALOG_REQUEST') {
      if (aiResult.reply) {
        await this.safeSend(token, psid, aiResult.reply);
      }
      await this.sendCatalogFallback(token, psid, page);
      return;
    }

    // ── SOFT HESITATION ────────────────────────────────────────────────────
    if (intent === 'SOFT_HESITATION') {
      const msg = aiResult.reply ?? 'ঠিক আছে 💖 যখন সুবিধা হয় জানাবেন।';
      await this.safeSend(token, psid, msg);
      return;
    }

    // ── KNOWLEDGE BASE FALLBACK ────────────────────────────────────────────
    if (page.infoModeOn) {
      try {
        const learned = await this.botKnowledge.resolveReply(
          pageId,
          text,
          psid,
        );
        if (learned?.reply) {
          void this.walletService.deductUsage(pageId, 'KEYWORD_REPLY');
          const reply = draft
            ? `${learned.reply}\n\n${this.draftHandler.reminder(draft)}`
            : learned.reply;
          await this.safeSend(token, psid, reply);
          return;
        }
      } catch {}
    }

    // ── UNMATCHED — use AI reply (already generated above) or fallback AI ──
    this.logger.log(
      `[Webhook] Unmatched message — psid=${psid} page=${page.pageId} text="${text.slice(0, 80)}"`,
    );

    // If AI already generated a reply for UNKNOWN intent, use it directly (no 2nd API call)
    if (aiResult.reply) {
      const reply = draft
        ? `${aiResult.reply}\n\n${this.draftHandler.reminder(draft)}`
        : aiResult.reply;
      await this.safeSend(token, psid, reply);
      return;
    }

    // AI was unavailable (quota/error) — try fallbackAi as last resort
    if (aiEnabled) {
      const draftSummary = draft
        ? `Customer has an active order draft (step: ${draft.currentStep ?? 'unknown'}, products: ${(draft.items ?? []).map((i: any) => i.code).join(', ') || 'none'})`
        : null;

      const fbResult = await this.fallbackAi.generateReply({
        customerMessage: text,
        reason: 'unmatched_intent',
        businessName: page.businessName ?? undefined,
        draftStep: draft?.currentStep ?? null,
        draftSummary,
      });

      if (fbResult.reply) {
        const reply = draft
          ? `${fbResult.reply}\n\n${this.draftHandler.reminder(draft)}`
          : fbResult.reply;
        await this.safeSend(token, psid, reply);
        return;
      }
    }

    await this.safeSend(
      token,
      psid,
      'দুঃখিত, আমি এটা পুরোপুরি বুঝতে পারিনি 💖\n\nআপনি product code, screenshot, "catalog", বা "order" লিখে আবার পাঠান।',
    );
  }

  // ── Sub-handlers ──────────────────────────────────────────────────────────

  private async handleCancel(
    page: any,
    psid: string,
    draft: DraftSession | null,
    aiReply?: string,
  ): Promise<void> {
    if (draft) {
      await this.ctx.clearDraft(page.id, psid);
    } else {
      const open = await this.prisma.order.findFirst({
        where: {
          pageIdRef: page.id,
          customerPsid: psid,
          status: { in: ['RECEIVED', 'PENDING'] },
        },
        orderBy: { id: 'desc' },
      });
      if (open) {
        await this.prisma.order.update({
          where: { id: open.id },
          data: { status: 'CANCELLED' },
        });
        this.logger.log(
          `[Webhook] order #${open.id} cancelled by customer psid=${psid}`,
        );
        this.telegram
          .notify(
            page.id,
            `❌ Order #${open.id} was cancelled by the customer.`,
          )
          .catch(() => {});
      }
    }
    // Use AI-generated cancel reply if available, else knowledge base
    const reply =
      aiReply ??
      (await this.botKnowledge.resolveSystemReply(page.id, 'order_cancelled', undefined, page.agentType));
    await this.safeSend(page.pageToken, psid, reply);
  }

  private async handleMultiProductPreview(
    page: any,
    psid: string,
    text: string,
    intent: string | null,
    draft: DraftSession,
  ): Promise<void> {
    const pageId = page.id as number;
    const token = page.pageToken as string;
    const codes = draft.pendingMultiPreview as string[];

    if (intent === 'CONFIRM' || intent === 'MULTI_CONFIRM') {
      const products = await this.productHandler.getProductsByCodes(
        pageId,
        codes,
      );
      const newDraft = this.draftHandler.startDraftFromCodes(
        codes,
        products as any[],
      );
      const crmCustomer = await this.prefillDraftFromCrm(
        pageId,
        psid,
        newDraft,
      );
      await this.ctx.saveDraft(pageId, psid, newDraft);
      if (crmCustomer?.name && crmCustomer?.phone && crmCustomer?.address) {
        newDraft.currentStep = 'confirm_address';
        await this.ctx.saveDraft(pageId, psid, newDraft);
        await this.safeSend(
          token,
          psid,
          `স্বাগতম ফিরে ${crmCustomer.name}! 🎉\n\nআগের ঠিকানায় পাঠাব?\n📍 *${crmCustomer.address}*\n\n"হ্যাঁ" বললে যাবে, অথবা নতুন ঠিকানা দিন 💖`,
        );
      } else {
        await this.safeSend(
          token,
          psid,
          `${crmCustomer?.totalOrders ? `স্বাগতম ফিরে! 🎉 ` : ''}ঠিক আছে 💖 আপনার নাম দিন।`,
        );
      }
    } else {
      await this.safeSend(
        token,
        psid,
        'সবগুলো order করতে **confirm** লিখুন, বাতিল করতে **cancel** লিখুন 💖',
      );
    }
  }

  private async handlePendingVisionSelection(
    page: any,
    psid: string,
    text: string,
    draft: DraftSession,
  ): Promise<void> {
    const token = page.pageToken as string;
    const pendingCodes = (draft.pendingVisionMatches || []).map((code) =>
      String(code).toUpperCase(),
    );
    const presented = await this.ctx.getLastPresentedProducts(page.id, psid);
    const shortlist = presented.filter((item) =>
      pendingCodes.includes(String(item.code).toUpperCase()),
    );

    if (!shortlist.length) {
      await this.ctx.clearDraft(page.id, psid);
      await this.safeSend(
        token,
        psid,
        'Shortlist টি আর active নেই 💖 আবার product এর ছবি দিন বা code লিখুন।',
      );
      return;
    }

    const selectedCode = this.resolveVisionSelectionCode(
      text,
      shortlist,
      (page.productCodePrefix as string | undefined) || 'DF',
    );
    if (!selectedCode) {
      const retryCount = (draft.visionSelectionRetryCount || 0) + 1;
      draft.visionSelectionRetryCount = retryCount;
      await this.ctx.saveDraft(page.id, psid, draft);
      await this.visionOps.logSelectionRetry(
        page.id,
        psid,
        `Shortlist selection not understood (attempt ${retryCount})`,
      );

      if (retryCount >= 2) {
        await this.ctx.setAgentHandling(page.id, psid, true);
        await this.visionOps.logHumanHandoff(
          page.id,
          psid,
          'Customer could not clarify shortlist choice after repeated retries',
        );
        await this.safeSend(
          token,
          psid,
          'আপনাকে ভুল product ধরতে চাই না 💖 তাই একজন agent এই shortlist টি দেখে help করবে। চাইলে meanwhile exact code/number লিখে দিতে পারেন।',
        );
        return;
      }

      const options = shortlist
        .map(
          (item, index) =>
            `${index + 1}. ${item.code}${item.name ? ` — ${item.name}` : ''}`,
        )
        .join('\n');
      await this.safeSend(
        token,
        psid,
        `আমি এখনো বুঝতে পারিনি কোনটা নিতে চান 💖\n\n${options}\n\nযেটা নিতে চান তার code বা নম্বর লিখুন। ${retryCount === 1 ? 'অথবা shortlist link খুলে product page-এ "এই Product টা Select করুন" চাপুন।' : 'না পারলে আমি agent-কে notify করব।'}\n${this.buildVisionShortlistUrl(page, pendingCodes)}`,
      );
      return;
    }

    await this.visionOps.markSelection(
      page.id,
      psid,
      selectedCode,
      'Customer confirmed product from shortlist',
    );
    await this.ctx.clearDraft(page.id, psid);
    await this.handleExplicitProductCode(
      page,
      psid,
      `${selectedCode} order করতে চাই`,
      'ORDER_INTENT',
      null,
      {},
      selectedCode,
    );
  }

  private resolveVisionSelectionCode(
    text: string,
    shortlist: Array<{ code: string; price: number; name?: string | null }>,
    prefix = 'DF',
  ): string | null {
    const normalized = text.trim();
    if (!normalized) return null;
    const asciiNormalized = normalized.replace(/[০-৯]/g, (digit) =>
      String('০১২৩৪৫৬৭৮৯'.indexOf(digit)),
    );

    const structured = asciiNormalized.match(
      /SELECT_PRODUCT[:#\s-]*([A-Z0-9-]+)/i,
    );
    if (structured) {
      const code = structured[1].toUpperCase();
      return (
        shortlist.find((item) => item.code.toUpperCase() === code)?.code || null
      );
    }

    const explicitCodes = this.botIntent.extractAllCodes(
      asciiNormalized,
      prefix,
    );
    const byCode = explicitCodes.find((code) =>
      shortlist.some((item) => item.code.toUpperCase() === code.toUpperCase()),
    );
    if (byCode) return byCode.toUpperCase();

    const lowered = asciiNormalized.toLowerCase();
    const byName = shortlist.find((item) => {
      const tokens = String(item.name || '')
        .toLowerCase()
        .split(/[^a-z0-9\u0980-\u09ff]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 4);
      return tokens.some((token) => lowered.includes(token));
    });
    if (byName) return byName.code;

    const ordinalMap: Array<[RegExp, number]> = [
      [/\b(first|1st|prothom|prothomta)\b/i, 0],
      [/\b(second|2nd|ditio|ditiyota|2 no|2 number)\b/i, 1],
      [/\b(third|3rd|tritio|tritiyota|3 no|3 number)\b/i, 2],
      [/\b(fourth|4th|4 no|4 number)\b/i, 3],
      [/\b(last|শেষ|shesh)\b/i, shortlist.length - 1],
    ];
    for (const [pattern, index] of ordinalMap) {
      if (index >= 0 && pattern.test(asciiNormalized) && shortlist[index]) {
        return shortlist[index].code;
      }
    }

    const numMatch = asciiNormalized.match(
      /(?:^|[^\d])([1-9])(?:\s*(?:no|number|num|টা|ta))?(?:[^\d]|$)/i,
    );
    if (numMatch) {
      const index = Number(numMatch[1]) - 1;
      if (shortlist[index]) return shortlist[index].code;
    }

    return null;
  }

  private buildVisionShortlistUrl(page: any, codes: string[]): string {
    const base = (
      process.env.CATALOG_BASE_URL || 'https://flamboyai.com'
    ).replace(/\/$/, '');
    const pageKey = page.catalogSlug || String(page.id);
    return `${base}/catalog/${encodeURIComponent(String(pageKey))}?select=1&codes=${encodeURIComponent(codes.join(','))}`;
  }

  private buildCatalogUrl(page: any): string {
    const websiteUrl = String(page.websiteUrl || '').trim();
    if (websiteUrl) return websiteUrl;
    const base = (
      process.env.CATALOG_BASE_URL || 'https://flamboyai.com'
    ).replace(/\/$/, '');
    const slug = page.catalogSlug || String(page.id);
    return `${base}/catalog/${encodeURIComponent(String(slug))}`;
  }

  // V25: customer shared their location (Messenger location attachment, a
  // Google Maps link, or raw coordinates) — measure against the restaurant
  // pin and quote the exact delivery fee.
  private async replyRestaurantLocationFee(
    page: any,
    psid: string,
    lat: number,
    lng: number,
  ): Promise<void> {
    const token = page.pageToken as string;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const distanceKm =
      Math.round(
        haversineKm(page.restaurantLat, page.restaurantLng, lat, lng) * 100,
      ) / 100;
    const slab = resolveDeliveryFee(parseSlabs(page.deliverySlabsJson), distanceKm);
    const sym = page.currencySymbol || '৳';
    const orderUrl = this.buildCatalogUrl(page);
    if (!slab) {
      await this.safeSend(
        token,
        psid,
        `📍 আপনার লোকেশন পেয়েছি — দূরত্ব ${distanceKm} km।\nদুঃখিত, এটা আমাদের ডেলিভারি এলাকার একটু বাইরে 😔 (আমরা সর্বোচ্চ ${parseSlabs(page.deliverySlabsJson).slice(-1)[0]?.maxKm ?? 0} km পর্যন্ত ডেলিভারি করি)`,
      );
      return;
    }
    await this.safeSend(
      token,
      psid,
      `📍 আপনার লোকেশন পেয়েছি!\n🛵 দূরত্ব: ${distanceKm} km\n💰 Delivery charge: ${sym}${slab.fee}\n\nOrder করতে আমাদের website-এ যান — ম্যাপে এই লোকেশনটাই pin করে দিন:\n${orderUrl} 🍽️`,
    );
  }

  private async sendCatalogFallback(
    token: string,
    psid: string,
    page: any,
  ): Promise<void> {
    const catalogUrl = this.buildCatalogUrl(page);
    const businessName = page.businessName || page.pageName || 'আমাদের';
    const sym = page.currencySymbol || '৳';
    const base = (process.env.CATALOG_BASE_URL || 'https://flamboyai.com').replace(/\/$/, '');
    const slug = page.catalogSlug || String(page.id);

    // Restaurant: lead with the actual menu photo(s) — that's what a food
    // customer wants to see first.
    try {
      const menuImages: string[] = JSON.parse((page as any).menuImagesJson || '[]');
      if (Array.isArray(menuImages) && menuImages.length) {
        for (const u of menuImages.slice(0, 3)) {
          const full = getFullImageUrl(u);
          if (full) await this.messenger.sendImage(token, psid, full);
        }
      }
    } catch { /* no menu images */ }

    // Fetch top active products with stock — trackStock=false food items are
    // always available (BOM is their real inventory), stockQty is meaningless
    const products = await this.prisma.product.findMany({
      where: {
        pageId: page.id,
        isActive: true,
        catalogVisible: true,
        OR: [{ stockQty: { gt: 0 } }, { trackStock: false }],
      },
      select: { code: true, name: true, price: true, originalPrice: true, imageUrl: true, description: true, category: true, priceVariantsJson: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    let logoUrl = getFullImageUrl(page.logoUrl);
    if (!logoUrl) {
      logoUrl = 'https://images.unsplash.com/photo-1557821552-17105176677c?q=80&w=1000&auto=format&fit=crop';
    }

    // Merchant has redirected their storefront to their own website
    // (Page.websiteUrl set) — there's no FlamboyAI-hosted product page to send
    // them to, so "বিস্তারিত দেখুন" should send the description in-chat
    // instead of linking back to our catalog.
    const usesOwnWebsite = !!String(page.websiteUrl || '').trim();

    try {
      if (products.length > 0) {
        // Individual product cards (max 10 for Messenger)
        const elements = products.map((p) => {
          const orig = Number(p.originalPrice) || 0;
          const price = Number(p.price) || 0;
          const hasOffer = orig > price && price > 0;
          const pct = hasOffer ? Math.round((1 - price / orig) * 100) : 0;
          // V25: size/portion pricing → show the range ("৳120 – ৳220")
          const variants = parsePriceVariants((p as any).priceVariantsJson);
          const priceTxt = variants.length
            ? priceRangeText(variants, price, sym)
            : `${sym}${price.toLocaleString()}`;
          // Messenger subtitle is ~80 chars — the offer line takes priority
          // over the description, since the discount is what sells. Never
          // show internal product codes to customers.
          const subtitle = hasOffer
            ? `🔥 আগের দাম ${sym}${orig.toLocaleString()} → এখন ${sym}${price.toLocaleString()} (${pct}% ছাড়)`
            : variants.length
              ? variants.map((v) => `${v.label} ${sym}${v.price}`).join(' / ').slice(0, 80)
              : p.description
                ? p.description.slice(0, 80)
                : (p as any).category || '';
          const productUrl = `${base}/catalog/${encodeURIComponent(slug)}/product/${encodeURIComponent(p.code)}`;
          return {
            title: `${p.name || p.code} — ${priceTxt}${hasOffer ? ' 🔥' : ''}`,
            image_url: getFullImageUrl(p.imageUrl) || logoUrl,
            subtitle,
            buttons: buildProductCardButtons(page, { code: p.code, productUrl }, [
              usesOwnWebsite
                ? {
                    type: 'postback' as const,
                    title: 'বিস্তারিত দেখুন',
                    payload: `DETAILS_${p.code}`,
                  }
                : {
                    type: 'web_url' as const,
                    url: productUrl,
                    title: 'বিস্তারিত দেখুন',
                  },
              {
                type: 'postback' as const,
                title: 'Order করব',
                payload: `ORDER_${p.code}`,
              },
            ]),
          };
        });
        await this.messenger.sendGenericTemplate(token, psid, elements);
      } else {
        // No products — send single catalog card
        await this.messenger.sendGenericTemplate(token, psid, [
          {
            title: `${businessName}-এর Online Catalog`,
            image_url: logoUrl,
            subtitle: `আমাদের সব product দেখুন এবং সহজেই order করুন 💖`,
            buttons: [
              {
                type: 'web_url' as const,
                url: catalogUrl,
                title: 'সব Product দেখুন',
              },
            ],
          },
        ]);
      }
    } catch (err) {
      this.logger.error(`[Webhook] sendCatalogFallback card failed: ${err}`);
    }

    await this.safeSend(
      token,
      psid,
      `🛍️ ${businessName}-এর সব product দেখুন:\n${catalogUrl}\n\nপছন্দের item-এ ক্লিক করে সরাসরি order করুন 💖`,
    );
  }

  private async sendSimpleProductInfo(
    page: any,
    psid: string,
    matches: import('../product-name-match/product-name-match.service').NameMatchResult[],
  ): Promise<void> {
    const token = page.pageToken as string;
    const sym = page.currencySymbol || '৳';

    if (matches.length === 1) {
      const p = matches[0];
      const unit = p.unit || 'pcs';
      const stockText =
        p.stockQty > 0 ? `✅ ${p.stockQty} ${unit} আছে` : '❌ Stock শেষ';
      let msg = `🛍️ *${p.productName}*\n💰 মূল্য: ${sym}${Number(p.price).toLocaleString()}/${unit}\n📦 ${stockText}`;
      if (p.description) msg += `\n\nℹ️ ${p.description}`;
      if (p.orderEnabled && p.stockQty > 0)
        msg += `\n\nOrder করতে চাইলে বলুন 😊`;
      await this.safeSend(token, psid, msg);
    } else {
      // Multiple matches — list them
      const lines = matches
        .slice(0, 6)
        .map((p) => {
          const unit = p.unit || 'pcs';
          const stock = p.stockQty > 0 ? `${p.stockQty} ${unit}` : 'Stock শেষ';
          return `• *${p.productName}* — ${sym}${Number(p.price).toLocaleString()}/${unit} (${stock})`;
        })
        .join('\n');
      await this.safeSend(
        token,
        psid,
        `🛍️ এই ধরনের product আমাদের কাছে আছে:\n\n${lines}\n\nকোনটা সম্পর্কে বিস্তারিত জানতে চাইলে নাম লিখুন।`,
      );
    }
  }

  private async handleExplicitProductCode(
    page: any,
    psid: string,
    text: string,
    intent: string | null,
    draft: DraftSession | null,
    message: any,
    code: string,
  ): Promise<void> {
    const pageId = page.id as number;
    const token = page.pageToken as string;

    // Always show product info first
    await this.productHandler.sendProductInfo(page, psid, code);

    // Create a draft whenever orderMode is on — the product info message already
    // tells the customer to send their name/phone/address, so we should be ready
    // to capture it. Previously we only created a draft when the customer used
    // explicit order words (nibo/lagbe/…) which caused "Limon" sent after seeing
    // product info to be processed with no context.
    if (page.orderModeOn) {
      const pagePrefix = (page.productCodePrefix as string | undefined) || 'DF';
      const qtyMap = this.botIntent.extractQuantityMap(text, pagePrefix);
      const qty = qtyMap.get(code) ?? 1;
      const product = await this.prisma.product.findFirst({
        where: { pageId, code },
      });

      if (!product) {
        this.logger.warn(
          `[Webhook] Product not found: pageId=${pageId} code=${code}`,
        );
        return;
      }
      if (product.stockQty <= 0) {
        this.logger.log(`[Webhook] Stock out: pageId=${pageId} code=${code}`);
        return;
      }

      if (!draft) {
        // Parse product variantOptions (e.g. [{label:"Size",choices:["S","M","L","XL"]}])
        let variantOptions: CustomFieldDef[] = [];
        if (product.variantOptions) {
          try {
            variantOptions = this.draftHandler.normalizeVariantOptions(
              JSON.parse(product.variantOptions),
            );
          } catch {
            /* ignore */
          }
        }
        const newDraft = this.draftHandler.startDraftFromCodes(
          [code],
          [product as any],
          variantOptions,
        );
        newDraft.items[0].qty = qty;

        // Prefill from CRM if returning customer
        const crmCustomer = await this.prisma.customer.findUnique({
          where: { pageId_psid: { pageId, psid } },
          select: { name: true, phone: true, address: true, totalOrders: true },
        });
        if (crmCustomer?.name) newDraft.customerName = crmCustomer.name;
        if (crmCustomer?.phone) newDraft.phone = crmCustomer.phone;
        if (crmCustomer?.address) newDraft.address = crmCustomer.address;

        await this.ctx.saveDraft(pageId, psid, newDraft);

        const returnGreet = crmCustomer?.totalOrders
          ? `স্বাগতম ফিরে! 🎉 আপনার আগের ${crmCustomer.totalOrders}টি order এর তথ্য দিয়ে রেখেছি।\n`
          : '';

        if (variantOptions.length > 0) {
          const firstField = variantOptions[0];
          const opts = firstField.choices?.length
            ? `\n${firstField.choices.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
            : '';
          await this.safeSend(
            token,
            psid,
            `${returnGreet}ঠিক আছে 💖 ${code} এর জন্য order নিচ্ছি।\n\n${firstField.label} কোনটা নেবেন?${opts}`,
          );
        } else if (
          crmCustomer?.name &&
          crmCustomer?.phone &&
          crmCustomer?.address
        ) {
          // All info prefilled — confirm address before going to summary
          // Customer may want to deliver to a different address this time
          newDraft.currentStep = 'confirm_address';
          await this.ctx.saveDraft(pageId, psid, newDraft);
          await this.safeSend(
            token,
            psid,
            `স্বাগতম ফিরে ${crmCustomer.name}! 🎉\n\nআগের ঠিকানায় পাঠাব?\n📍 *${crmCustomer.address}*\n\n"হ্যাঁ" বললে এই ঠিকানায় যাবে, অথবা নতুন ঠিকানা দিন 💖`,
          );
        } else {
          await this.safeSend(
            token,
            psid,
            `${returnGreet}ঠিক আছে! 😊 ${code} order করছি।\n\nপ্রথমে আপনার **নামটা** বলুন।`,
          );
        }
      } else {
        // Adding to existing draft
        const existing = draft.items.find((i) => i.productCode === code);
        if (existing) existing.qty = qty;
        else
          draft.items.push({
            productCode: code,
            qty,
            unitPrice: product.price,
          });
        await this.ctx.saveDraft(pageId, psid, draft);
      }
    }
  }

  private async handleRemoveItem(
    page: any,
    psid: string,
    text: string,
    draft: DraftSession,
  ): Promise<void> {
    const pagePrefix = (page.productCodePrefix as string | undefined) || 'DF';
    const removeCode = this.botIntent.extractRemoveCode?.(text, pagePrefix);
    if (!removeCode) return;

    draft.items = draft.items.filter((i) => i.productCode !== removeCode);

    if (draft.items.length === 0) {
      await this.ctx.clearDraft(page.id, psid);
      await this.safeSend(page.pageToken, psid, '✅ Draft cancel হয়েছে।');
    } else {
      await this.ctx.saveDraft(page.id, psid, draft);
      await this.safeSend(
        page.pageToken,
        psid,
        `✅ ${removeCode} remove হয়েছে।\n\n${this.draftHandler.buildSummary(draft, page)}`,
      );
    }
  }

  private async handleDraftEdit(
    page: any,
    psid: string,
    text: string,
    draft: DraftSession,
  ): Promise<boolean> {
    const t = text.toLowerCase();

    // ── Name change ────────────────────────────────────────────────────────
    if (
      /name|naam|নাম/.test(t) &&
      /change|badla|ভুল|bhul|bul|wrong|thik\s*na|নতুন/i.test(t)
    ) {
      draft.currentStep = 'name';
      await this.ctx.saveDraft(page.id, psid, draft);
      await this.safeSend(page.pageToken, psid, 'নতুন নাম দিন 💖');
      return true;
    }

    // ── Phone change ───────────────────────────────────────────────────────
    if (
      /phone|number|mobile|নম্বর|ফোন/.test(t) &&
      /change|badla|ভুল|bhul|bul|wrong|thik\s*na|নতুন/i.test(t)
    ) {
      draft.currentStep = 'phone';
      await this.ctx.saveDraft(page.id, psid, draft);
      await this.safeSend(page.pageToken, psid, 'নতুন ফোন নাম্বার দিন 💖');
      return true;
    }

    // ── Address change ─────────────────────────────────────────────────────
    if (
      /address|thikana|location|ঠিকানা/.test(t) &&
      /change|badla|ভুল|bhul|bul|wrong|thik\s*na|নতুন/i.test(t)
    ) {
      draft.currentStep = 'address';
      await this.ctx.saveDraft(page.id, psid, draft);
      await this.safeSend(page.pageToken, psid, 'নতুন ঠিকানা দিন 💖');
      return true;
    }

    // ── Variant change (size, color, etc.) ────────────────────────────────
    if (/size|color|colour|rong|সাইজ|কালার|রং/.test(t)) {
      const allVariants = Object.keys(draft.customFieldValues || {});
      // Find which variant they want to change
      const sizeMatch =
        /size|সাইজ/i.test(t) && allVariants.find((k) => /size/i.test(k));
      const colorMatch =
        /color|colour|rong|কালার|রং/i.test(t) &&
        allVariants.find((k) => /color|colour|rong/i.test(k));
      const targetField = sizeMatch || colorMatch || allVariants[0];

      if (targetField) {
        // Re-ask that specific variant field
        draft.currentStep = `cf:${targetField}`;
        // Find field definition to show choices
        const fieldDef = { label: targetField, choices: [] as string[] };
        // Try to get choices from the existing customFieldValues context (not stored — just re-ask)
        await this.ctx.saveDraft(page.id, psid, draft);
        await this.safeSend(
          page.pageToken,
          psid,
          `নতুন ${targetField} বলুন 💖`,
        );
        return true;
      }
    }

    // ── Generic "bhul ache" / "thik nai" — ask which field ────────────────
    if (
      /ভুল|bhul|bul|wrong|thik\s*nai|thik\s*na|ঠিক\s*না|ঠিক\s*নাই/.test(t) &&
      !/phone|number|address|thikana|name|naam|নাম|ফোন|ঠিকানা/.test(t)
    ) {
      await this.safeSend(
        page.pageToken,
        psid,
        'কোনটা ঠিক করতে চান? 💖\n👤 নাম → "name change"\n📞 ফোন → "phone change"\n📍 ঠিকানা → "address change"',
      );
      return true;
    }

    // ── Quantity change ────────────────────────────────────────────────────
    const qtyMap = this.botIntent.extractQuantityMap(
      text,
      (page.productCodePrefix as string | undefined) || 'DF',
    );
    if (qtyMap.size > 0) {
      qtyMap.forEach((qty, code) => {
        const item = draft.items.find((i) => i.productCode === code);
        if (item) item.qty = qty;
      });
      await this.ctx.saveDraft(page.id, psid, draft);
      await this.safeSend(
        page.pageToken,
        psid,
        `✅ Updated!\n\n${this.draftHandler.buildSummary(draft, page)}`,
      );
      return true;
    }

    return false;
  }

  private async findRecentCustomerOrder(pageId: number, psid: string) {
    return this.prisma.order.findFirst({
      where: {
        pageIdRef: pageId,
        customerPsid: psid,
        status: { in: ['RECEIVED', 'PENDING', 'CONFIRMED', 'PACKED', 'SHIPPED'] },
      },
      orderBy: { id: 'desc' },
      select: {
        id: true,
        orderNote: true,
        cancelNote: true,
        status: true,
        createdAt: true,
      },
    });
  }

  private async findCancelledOrder(pageId: number, psid: string) {
    return this.prisma.order.findFirst({
      where: { pageIdRef: pageId, customerPsid: psid, status: 'CANCELLED' },
      orderBy: { id: 'desc' },
      select: {
        id: true,
        cancelNote: true,
        status: true,
        paymentStatus: true,
        phone: true,
        customerName: true,
        collections: { where: { type: 'advance' }, select: { amount: true } },
        returnEntries: { select: { id: true, refundStatus: true } },
      },
    });
  }

  private isAdvanceRefundRequest(text: string): boolean {
    const t = text.toLowerCase();
    return (
      /(tk|taka|টাকা|tk|bdt|payment|pay)/.test(t) &&
      /(back|ফেরত|ferot|ferat|ফিরত|return|refund|daw|dao|den|দাও|দেন|পাঠান|pathan)/.test(t)
    ) || /(advance|অগ্রিম|agrim|deposit).*?(back|ফেরত|ferot|return|refund)/.test(t)
      || /(ফেরত|ferot|refund|back).*?(tk|taka|টাকা|advance|অগ্রিম)/.test(t);
  }

  /** Pulls a BD phone number out of free-form customer text, if present. */
  private extractTrackingPhone(text: string): string | null {
    const converted = text.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
    const match = converted.match(/(?:\+?88)?01[3-9]\d{8}/);
    return match ? normalizePhone(match[0]) : null;
  }

  /**
   * Matches orders by the customer's Facebook PSID (the account they ordered
   * from) OR a phone number they typed in this message — either is enough,
   * since a customer might message from a different FB account than the one
   * used to place the order.
   */
  private async findOrdersForTrackingQuery(
    pageId: number,
    psid: string,
    phone: string | null,
  ) {
    const or: any[] = [{ customerPsid: psid }];
    if (phone) or.push({ phone });
    return this.prisma.order.findMany({
      where: {
        pageIdRef: pageId,
        OR: or,
        status: { in: ['RECEIVED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED'] },
      },
      orderBy: { id: 'desc' },
      take: 5,
      select: {
        id: true,
        status: true,
        createdAt: true,
        items: { select: { productCode: true, qty: true } },
        courierShipment: { select: { trackingId: true, courierName: true, status: true } },
      },
    });
  }

  private isOrderStatusQuery(text: string): boolean {
    const t = text.toLowerCase();
    return /order|oder|অর্ডার/.test(t) &&
      /kothay|status|ki holo|ki khbr|khobor|update|কোথায়|আপডেট|কী হলো|খবর|কি হইলো|delivered|deliver|pack|ship|paini|pai ni|পাইনি|পেলাম না|কবে পাবো|kobe pabo|কখন|kakhn/.test(t);
  }

  /**
   * Builds the reply for an order-status query. When an order has a booked
   * courier shipment, calls the courier's live tracking API for the real
   * current status instead of just the internal Order.status snapshot.
   */
  private async buildOrderStatusReply(
    pageId: number,
    orders: Array<{
      id: number;
      status: string;
      items: { productCode: string; qty: number }[];
      courierShipment: { trackingId: string | null; courierName: string; status: string } | null;
    }>,
  ): Promise<string> {
    if (orders.length === 0) return 'আপনার কোনো active order নেই।';
    const statusLabel: Record<string, string> = {
      RECEIVED: '📥 প্রাপ্ত (প্রসেসিং)',
      CONFIRMED: '✅ কনফার্ম হয়েছে',
      PACKED: '📦 প্যাক হয়েছে',
      SHIPPED: '🚚 পাঠানো হয়েছে',
      DELIVERED: '🎉 ডেলিভারি হয়েছে',
    };
    const courierStatusLabel: Record<string, string> = {
      delivered: '🎉 ডেলিভারি সম্পন্ন হয়েছে',
      in_transit: '🚚 কুরিয়ারে পথে আছে',
      returned: '↩️ রিটার্ন হয়েছে',
    };

    let settings: any = null;
    const lines = await Promise.all(
      orders.map(async (o) => {
        const items = o.items.map((i) => `${i.productCode}×${i.qty}`).join(', ');
        let statusLine = statusLabel[o.status] || o.status;

        const shipment = o.courierShipment;
        if (shipment?.trackingId && shipment.courierName !== 'manual') {
          try {
            if (!settings) {
              settings = this.courier.parseSettings(await this.courier.getSettings(pageId));
            }
            const liveStatus = await this.courier.getLiveStatus(
              shipment.courierName as any,
              settings,
              shipment.trackingId,
            );
            if (liveStatus) {
              statusLine = courierStatusLabel[liveStatus] || `🚚 ${liveStatus}`;
            }
          } catch {
            // live tracking call failed — fall back to the internal status silently
          }
        }
        return `#${o.id} — ${items || '—'}\n   ${statusLine}`;
      }),
    );
    return `আপনার অর্ডারের আপডেট:\n\n${lines.join('\n\n')}`;
  }

  private isPostOrderCancel(text: string): boolean {
    const t = text.toLowerCase().trim();
    return /cancel|বাতিল|নিব না|লাগবে না|দরকার নাই|দরকার নেই|cancel\s*kro|cancel\s*করুন|cancel\s*করো|oder\s*cancel|order\s*cancel/.test(t);
  }

  private async handlePostOrderCancel(
    page: any,
    psid: string,
    order: { id: number; status: string; orderNote: string | null; createdAt: Date },
  ): Promise<void> {
    const orderAgeHours = (Date.now() - new Date(order.createdAt).getTime()) / 3_600_000;
    if (order.status === 'CANCELLED') {
      await this.safeSend(page.pageToken, psid, '❌ আপনার অর্ডারটি আগেই বাতিল হয়েছে।');
      return;
    }
    if (orderAgeHours > 24) {
      await this.safeSend(page.pageToken, psid, '⚠️ এই অর্ডারটি ২৪ ঘণ্টার বেশি পুরনো। বাতিল করতে সরাসরি আমাদের সাথে যোগাযোগ করুন।');
      return;
    }
    const existing = order.orderNote?.trim();
    const cancelNote = '[Customer requested cancel via Messenger]';
    await this.prisma.order.update({
      where: { id: order.id },
      data: { orderNote: existing ? `${existing} | ${cancelNote}` : cancelNote },
    });
    await this.ctx.setAgentHandling(page.id, psid, true);
    await this.safeSend(
      page.pageToken,
      psid,
      `⚠️ আপনার অর্ডার #${order.id} বাতিলের অনুরোধ পাওয়া গেছে। আমাদের টিম শীঘ্রই confirm করবে।`,
    );
    this.telegram
      .notify(
        page.id,
        `❌ <b>Cancel Request — Order #${order.id}</b>\nCustomer নিজে Messenger এ cancel চেয়েছে।`,
      )
      .catch(() => {});
  }

  private isPostOrderAck(text: string): boolean {
    const t = text.toLowerCase().trim();
    return /^(ok|okay|okey|okk|okkk|done|thanks|thank you|thik|thik ache|thik ase|ঠিক|ঠিক আছে|ধন্যবাদ|acha|accha|আচ্ছা)$/.test(
      t,
    );
  }

  private extractPostOrderEditValue(
    text: string,
  ): { field: 'name' | 'phone' | 'address'; value: string } | null {
    const colonMatch = text.match(
      /(?:name|naam|phone|number|mobile|address|thikana)[^:]*[:]\s*(.+)/i,
    );
    if (colonMatch) {
      const value = colonMatch[1].trim();
      const lower = text.toLowerCase();
      if (/name|naam/.test(lower)) return { field: 'name', value };
      if (/phone|number|mobile/.test(lower)) return { field: 'phone', value };
      if (/address|thikana/.test(lower)) return { field: 'address', value };
    }
    const phoneMatch = text.match(/\b01[3-9]\d{8}\b/);
    if (phoneMatch && /phone|number|mobile|change|badla/i.test(text)) {
      return { field: 'phone', value: phoneMatch[0] };
    }
    return null;
  }

  private detectPostOrderEditField(text: string): {
    label: string;
    field: 'name' | 'phone' | 'address' | 'size' | 'color';
  } | null {
    const t = text.toLowerCase();
    if (/name|naam/.test(t) || /\u09A8\u09BE\u09AE/.test(text)) return { label: '\u09A8\u09BE\u09AE', field: 'name' };
    if (/phone|number|mobile/.test(t) || /\u09AB\u09CB\u09A8/.test(text)) return { label: '\u09AB\u09CB\u09A8', field: 'phone' };
    if (/address|thikana|location/.test(t) || /\u09A0\u09BF\u0995\u09BE\u09A8\u09BE/.test(text)) return { label: '\u09A0\u09BF\u0995\u09BE\u09A8\u09BE', field: 'address' };
    if (/size/.test(t) || /\u09B8\u09BE\u0987\u099C/.test(text)) return { label: '\u09B8\u09BE\u0987\u099C', field: 'size' };
    if (/color|colour|rong/.test(t)) return { label: '\u0995\u09BE\u09B2\u09BE\u09B0', field: 'color' };
    return null;
  }

  private async applyOrderFieldUpdate(
    pageId: number,
    orderId: number,
    field: 'name' | 'phone' | 'address',
    value: string,
    fieldLabel: string,
    pageToken: string,
    psid: string,
  ): Promise<void> {
    const patch: Record<string, string> = {};
    patch[field] = value;
    await this.prisma.order.update({ where: { id: orderId }, data: patch });
    await this.safeSend(pageToken, psid, `✅ আপনার ${fieldLabel} আপডেট হয়েছে: "${value}" 💖`);
    this.telegram
      .notify(pageId, `✏️ Order #${orderId} — Customer ${fieldLabel} পরিবর্তন করেছে:\n"${value}"`)
      .catch(() => {});
  }

  private async handlePostOrderEdit(
    page: any,
    psid: string,
    text: string,
    order: { id: number; orderNote: string | null; status: string },
    draft: DraftSession | null,
  ): Promise<void> {
    if (['SHIPPED', 'DELIVERED', 'CANCELLED'].includes(order.status)) {
      await this.safeSend(page.pageToken, psid, 'দুঃখিত 😔 এই পর্যায়ে অর্ডার পরিবর্তন করা সম্ভব নয়।');
      return;
    }

    // ── If we were waiting for a value from previous message ──────────────────
    if (draft?.pendingEditField && ['name', 'phone', 'address'].includes(draft.pendingEditField)) {
      const field = draft.pendingEditField as 'name' | 'phone' | 'address';
      const labels: Record<string, string> = { name: 'নাম', phone: 'ফোন', address: 'ঠিকানা' };
      const value = text.trim();
      if (value.length > 0) {
        draft.pendingEditField = undefined;
        await this.ctx.saveDraft(page.id, psid, draft);
        await this.applyOrderFieldUpdate(page.id, order.id, field, value, labels[field], page.pageToken, psid);
        return;
      }
    }

    // ── Detect which field customer wants to change ───────────────────────────
    const detected = this.detectPostOrderEditField(text);
    if (!detected) {
      await this.safeSend(page.pageToken, psid, 'কোনটা বদলাতে চান? নাম, ফোন নম্বর, নাকি ঠিকানা?');
      return;
    }

    // ── Try to extract new value from same message ────────────────────────────
    const extracted = this.extractPostOrderEditValue(text);
    if (
      extracted &&
      (extracted.field === 'name' || extracted.field === 'phone' || extracted.field === 'address') &&
      (extracted.field as string) === detected.field
    ) {
      await this.applyOrderFieldUpdate(page.id, order.id, extracted.field, extracted.value, detected.label, page.pageToken, psid);
      return;
    }

    // ── Value not in message — ask and save pending state ─────────────────────
    const prompts: Record<string, string> = {
      name: '👤 নতুন নাম লিখুন:',
      phone: '📞 নতুন ফোন নম্বর লিখুন:',
      address: '📍 নতুন ঠিকানা লিখুন (জেলা সহ):',
      size: '📌 নতুন সাইজ লিখুন (S/M/L/XL):',
      color: '🎨 নতুন কালার লিখুন:',
    };

    if (['name', 'phone', 'address'].includes(detected.field)) {
      // Save pending state so next message is treated as the new value
      const currentDraft = draft ?? { items: [], customerName: null, phone: null, address: null, currentStep: 'idle' };
      currentDraft.pendingEditField = detected.field as any;
      await this.ctx.saveDraft(page.id, psid, currentDraft);
    }
    await this.safeSend(page.pageToken, psid, prompts[detected.field] || 'নতুন তথ্য লিখুন 💖');
  }

  private async handlePaymentScreenshot(
    page: any,
    psid: string,
    imageUrl: string,
    draft: DraftSession,
    useGemini = false,
  ): Promise<void> {
    const pageId = page.id as number;
    const token = page.pageToken as string;

    this.logger.log(
      `[PaymentOCR] Processing screenshot for page=${page.pageId} psid=${psid} provider=${useGemini ? 'gemini' : 'tesseract'}`,
    );

    try {
      const rawText = useGemini
        ? await this.ocr.extractTextViaGemini(imageUrl)
        : await this.ocr.extractTextFromImageUrl(imageUrl);
      this.logger.log(`[PaymentOCR] Raw text: ${rawText.slice(0, 200)}`);

      // Try to extract transaction ID from common Bkash/Nagad patterns
      // e.g. "TrxID 8NO3DQXQPR", "Transaction ID: ABC123DEF4", "Ref: XYZ987"
      const txnId = this.extractTransactionId(rawText);

      if (txnId) {
        draft.paymentProof = txnId;
        draft.paymentScreenshotUrl = imageUrl;
        draft.currentStep = 'confirm';
        await this.ctx.saveDraft(pageId, psid, draft);
        const summary = this.draftHandler.buildSummary(draft, page);
        await this.safeSend(
          token,
          psid,
          `✅ Payment পাওয়া গেছে! Transaction ID: *${txnId}*\n\n${summary}`,
        );
      } else {
        // Screenshot not readable — save URL, ask for last 4 digits
        draft.paymentScreenshotUrl = imageUrl;
        await this.ctx.saveDraft(pageId, psid, draft);
        await this.safeSend(
          token,
          psid,
          '📷 Screenshot পেয়েছি, কিন্তু Transaction ID পড়া যাচ্ছে না।\n\nTransaction ID টা লিখে পাঠান, অথবা শেষের ৪টি সংখ্যা দিন 💖',
        );
      }
    } catch (err) {
      this.logger.error(
        `[PaymentOCR] Failed page=${page.pageId} psid=${psid}: ${err}`,
      );
      draft.paymentScreenshotUrl = imageUrl;
      await this.ctx.saveDraft(pageId, psid, draft);
      await this.safeSend(
        token,
        psid,
        '📷 Screenshot পেয়েছি 💖 Transaction ID টাও লিখে পাঠান (অথবা শেষের ৪টি সংখ্যা)।',
      );
    }
  }

  /** Extract transaction ID from Bkash/Nagad OCR text */
  private extractTransactionId(text: string): string | null {
    if (!text) return null;

    // Priority patterns (labeled)
    const labeled = text.match(
      /(?:TrxID|Trx\s*ID|Transaction\s*ID|Trans(?:action)?\s*(?:ID|No\.?)|Ref(?:erence)?(?:\s*No\.?)?|Txn\s*(?:ID|No\.?))[:\s#]+([A-Z0-9]{6,20})/i,
    );
    if (labeled) return labeled[1].toUpperCase();

    // Bkash/Nagad style: 10-char alphanumeric block (uppercase letters + digits)
    const bkashStyle = text.match(/\b([A-Z]{2,}[0-9]{2,}[A-Z0-9]{4,})\b/);
    if (bkashStyle && bkashStyle[1].length >= 8 && bkashStyle[1].length <= 15)
      return bkashStyle[1].toUpperCase();

    return null;
  }

  // ── V19: Image buffer — groups photos sent in quick succession ────────────

  private bufferCustomerImage(
    page: any,
    psid: string,
    imageUrl: string,
    caption?: string,
  ): void {
    const key = `${page.id}:${psid}`;
    const existing = this.imageBuffer.get(key);

    const flush = () => {
      const entry = this.imageBuffer.get(key);
      if (!entry) return;
      this.imageBuffer.delete(key);

      const handleQueueFull = () => {
        void this.apiOcrFallback(entry.page, psid, entry.urls[0]).catch(() => {
          const tok = entry.page.pageToken as string;
          const pid = entry.page.id as number;
          void this.botKnowledge
            .resolveSystemReply(pid, 'ocr_fail', undefined, entry.page.agentType)
            .then((r) => this.safeSend(tok, psid, r))
            .then(() => this.sendCatalogFallback(tok, psid, entry.page))
            .catch(() => {});
        });
      };

      if (entry.urls.length === 1) {
        void this.ocrQueue
          .add(() =>
            this.handleImageAttachment(
              entry.page,
              psid,
              entry.urls[0],
              entry.caption,
            ),
          )
          .then((accepted) => {
            if (!accepted) handleQueueFull();
          });
      } else {
        this.logger.log(
          `[ImageBuffer] Flushing ${entry.urls.length} images for psid=${psid} page=${page.pageId}`,
        );
        void this.ocrQueue
          .add(() =>
            this.handleBatchImages(entry.page, psid, entry.urls, entry.caption),
          )
          .then((accepted) => {
            if (!accepted) handleQueueFull();
          });
      }
    };

    if (existing) {
      clearTimeout(existing.timer);
      existing.urls.push(imageUrl);
      if (caption && !existing.caption) existing.caption = caption;
      existing.timer = setTimeout(flush, this.IMAGE_BUFFER_MS);
    } else {
      this.imageBuffer.set(key, {
        page,
        urls: [imageUrl],
        caption,
        timer: setTimeout(flush, this.IMAGE_BUFFER_MS),
      });
    }
  }

  /** Handles 2+ images sent together: tries OCR on each, then falls back to batch Vision */
  private async handleBatchImages(
    page: any,
    psid: string,
    imageUrls: string[],
    customerText?: string,
  ): Promise<void> {
    const pageId = page.id as number;
    const token = page.pageToken as string;

    await this.ctx.clearPendingVisionMatches(pageId, psid);
    this.logger.log(
      `[BatchImages] Processing ${imageUrls.length} images — page=${page.pageId} psid=${psid}`,
    );

    // ── Simple Dual Photo Mode clarification (batch) ──────────────────────
    if (
      page.dualPhotoMode &&
      page.dualWearingProductId &&
      page.dualHoldingProductId
    ) {
      const activeDraft = await this.ctx.getActiveDraft(pageId, psid);
      const updatedDraft = activeDraft ?? {
        items: [],
        customerName: null,
        phone: null,
        address: null,
        currentStep: 'idle',
      };
      updatedDraft.pendingDualImageUrl = imageUrls[0];
      updatedDraft.pendingDualAllImageUrls = imageUrls;
      await this.ctx.saveDraft(pageId, psid, updatedDraft as any);
      await this.safeSend(
        token,
        psid,
        '📸 এই ছবিতে দুটো পোশাক আছে। আপনি কোনটার ব্যাপারে জানতে চান?\n\n👗 *গায়ে পরা* টার কথা জানতে লিখুন: "গায়েরটা"\n🤲 *হাতে ধরা* টার কথা জানতে লিখুন: "হাতেরটা"',
      );
      return;
    }

    try {
      const pageProducts = await this.prisma.product.findMany({
        where: { pageId, isActive: true },
        select: {
          code: true,
          postCaption: true,
          visionSearchable: true,
          detectionMode: true,
        },
      });

      // Only run OCR if some product is explicitly OCR mode. A product being
      // AI_VISION but not yet embedded (visionSearchable=false) must NOT force
      // the whole page back to slow OCR — go straight to vision instead.
      const hasOcrProducts = pageProducts.some(
        (p) => p.detectionMode === 'OCR',
      );
      const customPrefix =
        (page.productCodePrefix as string | undefined) || 'DF';

      // Try OCR on each image sequentially — stop on first match
      const ocrTexts: string[] = [];
      if (hasOcrProducts) {
        for (const url of imageUrls) {
          const ocrResult = await this.ocr.extractFull(
            url,
            customerText,
            pageProducts,
            customPrefix,
          );
          if (ocrResult.text?.trim()) ocrTexts.push(ocrResult.text.trim());
          const highMedium = ocrResult.verifiedCodes
            .filter((v) => v.confidence === 'HIGH' || v.confidence === 'MEDIUM')
            .map((v) => v.code);
          const lowOnly = ocrResult.verifiedCodes
            .filter((v) => v.confidence === 'LOW')
            .map((v) => v.code);
          const codes = highMedium.length > 0 ? highMedium : lowOnly;

          if (codes.length > 0) {
            this.logger.log(
              `[BatchImages] OCR matched codes [${codes.join(',')}] from url=${url}`,
            );
            await this.walletService.deductUsage(pageId, 'IMAGE_OCR');
            if (codes.length === 1) {
              await this.ctx.setLastPresentedProducts(pageId, psid, [
                { code: codes[0], price: 0 },
              ]);
              await this.productHandler.sendProductInfo(page, psid, codes[0]);
            } else {
              const newDraft = this.draftHandler.emptyDraft();
              newDraft.pendingMultiPreview = codes;
              await this.ctx.saveDraft(pageId, psid, newDraft);
              await this.productHandler.sendMultiProductPreview(
                page,
                psid,
                codes,
              );
            }
            return;
          }
        }

        // No code in any image — the image may still show a product NAME
        // (printed on packaging/label) instead of a code. Try matching the
        // OCR'd text against Product.name before falling back to vision,
        // mirroring the single-photo path in handleImageAttachment below.
        const combinedOcrText = ocrTexts.join('\n').trim();
        if (combinedOcrText) {
          const allProds = await this.prisma.product.findMany({
            where: { pageId, isActive: true },
            select: {
              code: true,
              name: true,
              price: true,
              stockQty: true,
              unit: true,
              orderEnabled: true,
              description: true,
              productType: true,
            },
          });
          const nameMatches = this.productNameMatch.matchProducts(
            combinedOcrText,
            allProds,
          );
          const strong = nameMatches.filter(
            (m) => m.confidence === 'HIGH' || m.confidence === 'MEDIUM',
          );
          if (strong.length > 0) {
            this.logger.log(
              `[NameMatch] Batch OCR text matched product(s): ${strong.map((m) => m.productCode).join(',')}`,
            );
            await this.walletService.deductUsage(pageId, 'IMAGE_OCR');
            await this.sendSimpleProductInfo(page, psid, strong);
            return;
          }
        }
      }

      // No OCR codes or name match in any image — use batch Vision (one AI call for all angles)
      if (!page.imageRecognitionOn) {
        const reply = await this.botKnowledge.resolveSystemReply(
          pageId,
          'ocr_fail',
          undefined,
          page.agentType,
        );
        await this.safeSend(token, psid, reply);
        await this.sendCatalogFallback(token, psid, page);
        return;
      }

      this.logger.log(
        `[BatchImages] OCR found nothing — falling back to batch Vision with ${imageUrls.length} angles`,
      );
      await this.visionProductRecognition(page, psid, imageUrls[0], imageUrls);
    } catch (err: any) {
      this.logger.error(
        `[BatchImages] Uncaught error page=${page.pageId} psid=${psid}: ${err?.message ?? err}`,
      );
      const reply = await this.botKnowledge
        .resolveSystemReply(pageId, 'ocr_fail', undefined, page.agentType)
        .catch(() => 'Sorry, something went wrong.');
      await this.safeSend(token, psid, reply);
      await this.sendCatalogFallback(token, psid, page).catch(() => {});
    }
  }

  /** OCR image processing — runs inside the global OCR queue */
  private async handleImageAttachment(
    page: any,
    psid: string,
    imageUrl: string,
    customerText?: string,
  ): Promise<void> {
    const pageId = page.id as number;
    const token = page.pageToken as string;

    await this.ctx.clearPendingVisionMatches(pageId, psid);

    // ── Live Session matching (new Dual Photo system) ──────────────────────
    const liveMatch = await this.matchLiveSession(pageId, imageUrl);
    if (liveMatch) {
      this.logger.log(
        `[LiveSession] Matched product=${liveMatch.product.code} slot=${liveMatch.slot} conf=${liveMatch.confidence}`,
      );
      await this.ctx.setLastPresentedProducts(pageId, psid, [
        {
          code: liveMatch.product.code,
          price: Number(liveMatch.product.price),
        },
      ]);
      const slotLabel =
        liveMatch.slot === 'worn' ? 'পরা পোশাক' : 'হাতে ধরা পোশাক';
      await this.safeSend(
        token,
        psid,
        `👗 ${slotLabel}: *${liveMatch.product.name}*\n💰 দাম: ৳${Number(liveMatch.product.price).toLocaleString()}\n\nOrder করতে চাইলে বলুন 😊`,
      );
      return;
    }

    // ── Simple Dual Photo Mode clarification ──────────────────────────────
    // If page has dualPhotoMode on with both products configured, ask customer
    // which product they mean before running OCR/Vision
    if (
      page.dualPhotoMode &&
      page.dualWearingProductId &&
      page.dualHoldingProductId
    ) {
      const activeDraft = await this.ctx.getActiveDraft(pageId, psid);
      // Store the image so we can process after customer picks
      const updatedDraft = activeDraft ?? {
        items: [],
        customerName: null,
        phone: null,
        address: null,
        currentStep: 'idle',
      };
      updatedDraft.pendingDualImageUrl = imageUrl;
      await this.ctx.saveDraft(pageId, psid, updatedDraft as any);
      await this.safeSend(
        token,
        psid,
        '📸 এই ছবিতে দুটো পোশাক আছে। আপনি কোনটার ব্যাপারে জানতে চান?\n\n👗 *গায়ে পরা* টার কথা জানতে লিখুন: "গায়েরটা"\n🤲 *হাতে ধরা* টার কথা জানতে লিখুন: "হাতেরটা"',
      );
      return;
    }

    this.logger.log(
      `[OCR] Starting for page=${page.pageId} psid=${psid} hasCustomerText=${Boolean(customerText)}`,
    );

    try {
      // Load all active products with detectionMode
      const pageProducts = await this.prisma.product.findMany({
        where: { pageId, isActive: true },
        select: {
          code: true,
          postCaption: true,
          visionSearchable: true,
          detectionMode: true,
        },
      });

      // Skip OCR unless some product is explicitly OCR mode. A product that is
      // AI_VISION but not yet embedded (visionSearchable=false) must not force
      // the whole page onto slow OCR — go straight to vision instead.
      const hasOcrProducts = pageProducts.some(
        (p) => p.detectionMode === 'OCR',
      );
      if (!hasOcrProducts && page.imageRecognitionOn) {
        this.logger.log(
          `[OCR] All products are AI_VISION mode — skipping OCR, going straight to vision`,
        );
        await this.visionProductRecognition(page, psid, imageUrl);
        return;
      }

      // V8: pass page's custom code prefix to OCR
      const customPrefix =
        (page.productCodePrefix as string | undefined) || 'DF';
      const ocrResult = await this.ocr.extractFull(
        imageUrl,
        customerText,
        pageProducts,
        customPrefix,
      );

      // Use HIGH+MEDIUM verified codes as primary, LOW as fallback
      const highMedium = ocrResult.verifiedCodes
        .filter((v) => v.confidence === 'HIGH' || v.confidence === 'MEDIUM')
        .map((v) => v.code);
      const lowOnly = ocrResult.verifiedCodes
        .filter((v) => v.confidence === 'LOW')
        .map((v) => v.code);

      // Prefer HIGH/MEDIUM; fall back to LOW only if nothing else
      const codes = highMedium.length > 0 ? highMedium : lowOnly;

      // Log confidence breakdown
      if (ocrResult.verifiedCodes.length > 0) {
        this.logger.log(
          `[OCR] Confidence breakdown: ` +
            ocrResult.verifiedCodes
              .map((v) => `${v.code}=${v.confidence}(${v.source})`)
              .join(', '),
        );
      }

      // Save to context so customer can say "eta nibo"
      if (codes.length > 0) {
        await this.ctx.setLastPresentedProducts(
          pageId,
          psid,
          codes.map((c) => ({ code: c, price: 0 })),
        );
      }

      // No codes at all
      if (!codes.length) {
        this.logger.warn(
          `[OCR] No codes — conf=${ocrResult.confidence.toFixed(0)} overall=${ocrResult.ocrConfidence}`,
        );

        // V22: Try name matching on OCR text before falling back to vision
        const ocrText = (ocrResult.text || '').trim();
        if (ocrText) {
          const allProds = await this.prisma.product.findMany({
            where: { pageId, isActive: true },
            select: {
              code: true,
              name: true,
              price: true,
              stockQty: true,
              unit: true,
              orderEnabled: true,
              description: true,
              productType: true,
            },
          });
          const nameMatches = this.productNameMatch.matchProducts(
            ocrText,
            allProds,
          );
          const strong = nameMatches.filter(
            (m) => m.confidence === 'HIGH' || m.confidence === 'MEDIUM',
          );
          if (strong.length > 0) {
            this.logger.log(
              `[NameMatch] OCR text matched product(s): ${strong.map((m) => m.productCode).join(',')}`,
            );
            await this.walletService.deductUsage(pageId, 'IMAGE_OCR');
            await this.sendSimpleProductInfo(page, psid, strong);
            return;
          }
        }

        // V18: Try vision-based product recognition if enabled for this page
        if (page.imageRecognitionOn) {
          await this.visionProductRecognition(page, psid, imageUrl);
          return;
        }

        const isLowConf =
          ocrResult.confidence < 30 && ocrResult.ocrConfidence === 'NONE';
        const key = isLowConf ? 'ocr_low_confidence' : 'ocr_fail';
        const reply = await this.botKnowledge.resolveSystemReply(pageId, key, undefined, page.agentType);
        await this.safeSend(token, psid, reply);
        await this.sendCatalogFallback(token, psid, page);
        return;
      }

      if (codes.length === 1) {
        const vc = ocrResult.verifiedCodes.find((v) => v.code === codes[0]);
        this.logger.log(
          `[OCR] Single code: ${codes[0]} confidence=${vc?.confidence}`,
        );
        // Deduct IMAGE_OCR cost (50%) — OCR matched, no Vision API call needed
        await this.walletService.deductUsage(pageId, 'IMAGE_OCR');
        await this.productHandler.sendProductInfo(page, psid, codes[0]);
        return;
      }

      // Multiple codes → multi-preview
      this.logger.log(`[OCR] Multiple codes: [${codes.join(',')}]`);
      // Deduct IMAGE_OCR cost (50%) for OCR match
      await this.walletService.deductUsage(pageId, 'IMAGE_OCR');
      const newDraft = this.draftHandler.emptyDraft();
      newDraft.pendingMultiPreview = codes;
      await this.ctx.saveDraft(pageId, psid, newDraft);
      await this.productHandler.sendMultiProductPreview(page, psid, codes);
    } catch (err) {
      this.logger.error(
        `[OCR] Uncaught error page=${page.pageId} psid=${psid}: ${err}`,
      );
      const reply = await this.botKnowledge
        .resolveSystemReply(pageId, 'ocr_fail', undefined, page.agentType)
        .catch(() => 'Sorry, something went wrong.');
      await this.safeSend(token, psid, reply);
      await this.sendCatalogFallback(token, psid, page).catch(() => {});
    }
  }

  // ── V18: Vision-based product recognition ────────────────────────────────

  /**
   * Called when OCR finds no product codes AND page.imageRecognitionOn = true.
   * Analyzes the image with the configured AI vision provider, matches products,
   * then routes based on confidence thresholds set per page.
   */
  /**
   * V20: Merge attribute-based matches (Track A) with CLIP embedding matches (Track B).
   * Products appearing in both lists get a boosted combined score.
   */
  private mergeMatchResults(
    attrMatches: ProductMatchResult[],
    embedMatches: ProductMatchResult[],
  ): ProductMatchResult[] {
    if (!embedMatches.length) return attrMatches;
    if (!attrMatches.length) {
      return embedMatches
        .map((m) => ({ ...m, matchScore: m.matchScore * 0.5 }))
        .slice(0, 4);
    }

    const embedMap = new Map(
      embedMatches.map((m) => [m.productCode, m.matchScore]),
    );
    const attrMap = new Map(attrMatches.map((m) => [m.productCode, m]));
    const merged = new Map<string, ProductMatchResult>();

    for (const [code, attrMatch] of attrMap) {
      const embedSim = embedMap.get(code) ?? 0;
      const finalScore =
        embedSim > 0
          ? attrMatch.matchScore * 0.6 + embedSim * 0.4
          : attrMatch.matchScore * 0.85;
      merged.set(code, {
        ...attrMatch,
        matchScore: finalScore,
        matchReasons:
          embedSim > 0
            ? [...attrMatch.matchReasons, 'visual_similarity']
            : attrMatch.matchReasons,
      });
    }

    for (const embedMatch of embedMatches) {
      if (!attrMap.has(embedMatch.productCode)) {
        merged.set(embedMatch.productCode, {
          ...embedMatch,
          matchScore: embedMatch.matchScore * 0.5,
        });
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 4);
  }

  private async visionProductRecognition(
    page: any,
    psid: string,
    imageUrl: string,
    allImageUrls?: string[], // V19: batch mode — multiple angles in one AI call
  ): Promise<void> {
    const pageId = page.id as number;
    const token = page.pageToken as string;

    // Read per-page thresholds (fall back to safe defaults)
    const highThreshold: number =
      typeof page.imageHighConfidence === 'number'
        ? page.imageHighConfidence
        : 0.75;
    const medThreshold: number =
      typeof page.imageMediumConfidence === 'number'
        ? page.imageMediumConfidence
        : 0.45;

    const isBatch = allImageUrls && allImageUrls.length > 1;
    this.logger.log(
      `[VisionRecog] Starting for page=${page.pageId} psid=${psid} ` +
        `angles=${isBatch ? allImageUrls.length : 1} thresholds: high=${highThreshold} med=${medThreshold}`,
    );

    try {
      // Step 0: Check wallet balance
      if (!(await this.walletService.canProcessAi(pageId))) {
        this.logger.warn(
          `[VisionRecog] pageId=${pageId} suspended or insufficient balance`,
        );
        const reply = await this.botKnowledge.resolveSystemReply(
          pageId,
          'ocr_fail',
          undefined,
          page.agentType,
        );
        await this.safeSend(token, psid, reply);
        return;
      }

      // Step 1 & 2: Track A (Gemini vision → attribute match) + Track B (CLIP embedding) in parallel
      // Track B failure NEVER breaks Track A — Promise.allSettled guarantees this
      const [visionSettled, embedSettled] = await Promise.allSettled([
        (isBatch
          ? this.visionAnalysis.analyzeMultiple(allImageUrls)
          : this.visionAnalysis.analyze(imageUrl)
        ).then(async (a) => ({
          attrs: a,
          matches: await this.productMatch.findMatches(pageId, a, 6),
        })),
        this.embeddingService.findSimilar(pageId, imageUrl, 8),
      ]);

      const visionOk = visionSettled.status === 'fulfilled';
      const { attrs, matches: attrMatches } = visionOk
        ? visionSettled.value
        : {
            attrs: {
              category: null,
              color: null,
              pattern: null,
              sleeveType: null,
              gender: null,
              confidence: 0,
              rawDescription: 'Vision analysis failed',
              usedApi: false,
            },
            matches: [] as ProductMatchResult[],
          };

      const embedMatches =
        embedSettled.status === 'fulfilled' ? embedSettled.value : [];

      this.logger.log(
        `[VisionRecog] Track A — cat=${attrs.category} color=${attrs.color} ` +
          `conf=${attrs.confidence.toFixed(2)} matches=${attrMatches.length} | ` +
          `Track B — embed matches=${embedMatches.length}`,
      );

      // Deduct wallet only when Track A successfully called an API
      if (visionOk) {
        await this.walletService.deductUsage(
          pageId,
          attrs.usedApi ? 'IMAGE' : 'IMAGE_LOCAL',
        );
      }

      // V22: Try name matching on vision rawDescription against SIMPLE products first
      if (attrs.rawDescription) {
        const simpleProds = await this.prisma.product.findMany({
          where: { pageId, isActive: true, productType: 'SIMPLE' },
          select: {
            code: true,
            name: true,
            price: true,
            stockQty: true,
            unit: true,
            orderEnabled: true,
            description: true,
            productType: true,
          },
        });
        if (simpleProds.length > 0) {
          const nameMatches = this.productNameMatch.matchProducts(
            attrs.rawDescription,
            simpleProds,
            { simpleOnly: true },
          );
          const strong = nameMatches.filter(
            (m) => m.confidence === 'HIGH' || m.confidence === 'MEDIUM',
          );
          if (strong.length > 0) {
            this.logger.log(
              `[NameMatch] Vision rawDescription matched SIMPLE product(s): ${strong.map((m) => m.productCode).join(',')}`,
            );
            await this.sendSimpleProductInfo(page, psid, strong);
            return;
          }
        }
      }

      // If Track A returned zero confidence AND Track B also found nothing → fallback
      if ((attrs.confidence <= 0 || !attrs.category) && !embedMatches.length) {
        this.logger.warn(
          `[VisionRecog] Both tracks returned nothing — falling back`,
        );
        await this.visionOps.logVisionAttempt({
          pageId,
          psid,
          imageUrl,
          type: 'low_confidence',
          confidence: attrs.confidence,
          note: 'Vision provider zero confidence and no embedding matches',
          attrs,
        });
        await this.visionLowConfidenceFallback(page, psid, attrs, null);
        return;
      }

      // Merge Track A attribute matches + Track B embedding matches
      const matches = this.mergeMatchResults(attrMatches, embedMatches);

      this.logger.log(
        `[VisionRecog] Found ${matches.length} candidate match(es). ` +
          (matches[0]
            ? `Top: ${matches[0].productCode} score=${matches[0].matchScore.toFixed(2)}`
            : 'none'),
      );

      if (!matches.length) {
        // No products matched at all
        await this.visionOps.logVisionAttempt({
          pageId,
          psid,
          imageUrl,
          type: 'low_confidence',
          confidence: attrs.confidence,
          note: 'No products matched extracted attributes',
          attrs,
        });
        await this.visionLowConfidenceFallback(page, psid, attrs, null);
        return;
      }

      const topMatch = matches[0];
      const topScore = topMatch.matchScore;

      // Step 3: Route by confidence
      if (topScore >= highThreshold) {
        // HIGH confidence — proceed as if customer sent the product code directly
        this.logger.log(
          `[VisionRecog] HIGH confidence (${topScore.toFixed(2)}) — auto-proceed with ${topMatch.productCode}`,
        );
        await this.visionOps.logVisionAttempt({
          pageId,
          psid,
          imageUrl,
          type: 'high_confidence',
          confidence: topScore,
          note: 'Exact product info allowed because confidence crossed high threshold',
          attrs,
          matches,
          topMatch,
        });
        await this.ctx.clearPendingVisionMatches(pageId, psid);
        await this.safeSend(
          token,
          psid,
          this.buildVisionHighConfidenceMsg(attrs, topMatch),
        );
        await this.productHandler.sendProductInfo(
          page,
          psid,
          topMatch.productCode,
        );
      } else if (topScore >= medThreshold) {
        // MEDIUM confidence — show 2–4 options, ask customer to pick
        this.logger.log(
          `[VisionRecog] MEDIUM confidence (${topScore.toFixed(2)}) — showing ${matches.length} options`,
        );
        await this.visionOps.logVisionAttempt({
          pageId,
          psid,
          imageUrl,
          type: 'medium_confidence',
          confidence: topScore,
          note: 'Shortlist shown instead of direct final answer',
          attrs,
          matches,
          topMatch,
        });
        await this.ctx.setPendingVisionMatches(
          pageId,
          psid,
          matches.map((m) => m.productCode),
        );
        await this.ctx.setLastPresentedProducts(
          pageId,
          psid,
          matches.map((m) => ({
            code: m.productCode,
            price: m.price,
            name: m.productName,
          })),
        );
        const catLabel = attrs.category ?? 'পণ্য';
        const colorLabel = attrs.color ? ` ${attrs.color}` : '';
        const introMed = `আপনার ছবিটা দেখে মনে হচ্ছে এটা${colorLabel} ${catLabel} টাইপের। এই ধরনের কয়েকটি product পেয়েছি 👇`;
        await this.productHandler.sendVisionMatchCards(
          page,
          psid,
          matches.map((m) => m.productCode),
          introMed,
        );
      } else {
        // LOW confidence
        this.logger.warn(
          `[VisionRecog] LOW confidence (${topScore.toFixed(2)}) — triggering fallback`,
        );
        await this.visionOps.logVisionAttempt({
          pageId,
          psid,
          imageUrl,
          type: 'low_confidence',
          confidence: topScore,
          note: 'Top product score below medium threshold',
          attrs,
          matches,
          topMatch,
        });
        await this.visionLowConfidenceFallback(page, psid, attrs, matches);
      }
    } catch (err: any) {
      this.logger.error(
        `[VisionRecog] Uncaught error page=${page.pageId} psid=${psid}: ${err?.message ?? err}`,
      );
      // Fail gracefully — send a generic helpful reply
      await this.safeSend(
        token,
        psid,
        'ছবিটি বিশ্লেষণ করতে সমস্যা হয়েছে। আপনি কি পণ্যের কোড বা আরও স্পষ্ট ছবি পাঠাতে পারবেন?',
      );
    }
  }

  /** Build reply for high-confidence vision match */
  private buildVisionHighConfidenceMsg(
    attrs: import('../vision-analysis/vision-analysis.interface').VisionAttributes,
    match: ProductMatchResult,
  ): string {
    const catLabel = attrs.category ?? 'পণ্য';
    const colorLabel = attrs.color ? ` ${attrs.color}` : '';
    const patternLabel =
      attrs.pattern && attrs.pattern !== 'plain' ? ` ${attrs.pattern}` : '';
    return (
      `আপনার ছবিটা দেখে মনে হচ্ছে এটা${colorLabel}${patternLabel} ${catLabel} টাইপের। ` +
      `এই পণ্যটি পেয়েছি:\n\nযদি এটা ঠিক না হয়, আরেকটা clear photo বা product code পাঠান 💖`
    );
  }

  /** Build reply for medium-confidence vision match — show options list */

  /**
   * OCR queue overflow fallback: uses AI API to extract product codes from the image,
   * then follows the same product-lookup flow as normal OCR.
   * Billing: IMAGE rate (API used). Falls back to visionProductRecognition if no codes found.
   */
  private async apiOcrFallback(
    page: any,
    psid: string,
    imageUrl: string,
  ): Promise<void> {
    const pageId = page.id as number;
    const token = page.pageToken as string;
    const prefix = (page.productCodePrefix as string | undefined) || 'DF';

    if (!(await this.walletService.canProcessAi(pageId))) {
      const reply = await this.botKnowledge.resolveSystemReply(
        pageId,
        'ocr_fail',
        undefined,
        page.agentType,
      );
      await this.safeSend(token, psid, reply);
      await this.sendCatalogFallback(token, psid, page);
      return;
    }

    const { codes, usedApi } = await this.visionAnalysis.extractProductCodes(
      imageUrl,
      prefix,
    );
    await this.walletService.deductUsage(
      pageId,
      usedApi ? 'IMAGE' : 'IMAGE_OCR',
    );

    if (!codes.length) {
      if (page.imageRecognitionOn) {
        await this.visionProductRecognition(page, psid, imageUrl);
        return;
      }
      const reply = await this.botKnowledge.resolveSystemReply(
        pageId,
        'ocr_fail',
        undefined,
        page.agentType,
      );
      await this.safeSend(token, psid, reply);
      await this.sendCatalogFallback(token, psid, page);
      return;
    }

    await this.ctx.setLastPresentedProducts(
      pageId,
      psid,
      codes.map((c) => ({ code: c, price: 0 })),
    );

    if (codes.length === 1) {
      await this.productHandler.sendProductInfo(page, psid, codes[0]);
      return;
    }

    const newDraft = this.draftHandler.emptyDraft();
    newDraft.pendingMultiPreview = codes;
    await this.ctx.saveDraft(pageId, psid, newDraft);
    await this.productHandler.sendMultiProductPreview(page, psid, codes);
  }

  /**
   * Called when vision confidence is too low to show products.
   * If fallbackAiOn: try AI reply. Otherwise: ask for clearer image.
   */
  private async visionLowConfidenceFallback(
    page: any,
    psid: string,
    attrs: import('../vision-analysis/vision-analysis.interface').VisionAttributes,
    partialMatches: ProductMatchResult[] | null,
  ): Promise<void> {
    const token = page.pageToken as string;
    await this.ctx.clearPendingVisionMatches(page.id, psid);

    // If we have partial matches, show product cards instead of giving up
    if (partialMatches && partialMatches.length > 0) {
      const catLabel = attrs.category ?? 'পণ্য';
      const colorLabel = attrs.color ? ` ${attrs.color}` : '';
      const introLow = `ছবিটা থেকে exact match বুঝতে পারিনি, তবে এই ধরনের${colorLabel} ${catLabel} product গুলো আছে 👇`;
      await this.ctx.setLastPresentedProducts(
        page.id,
        psid,
        partialMatches.map((m) => ({
          code: m.productCode,
          price: m.price,
          name: m.productName,
        })),
      );
      await this.productHandler.sendVisionMatchCards(
        page,
        psid,
        partialMatches.map((m) => m.productCode),
        introLow,
      );
      return;
    }

    if (page.imageFallbackAiOn) {
      const fbResult = await this.fallbackAi.generateReply({
        customerMessage: '',
        reason: 'image_unclear',
        visionDescription: attrs.rawDescription,
        businessName: page.businessName ?? undefined,
      });

      if (fbResult.reply) {
        await this.safeSend(token, psid, fbResult.reply);
        if (fbResult.escalateToAgent) {
          await this.ctx.setAgentHandling(page.id, psid, true);
        }
        return;
      }
    }

    // Default: ask for a clearer image or product code
    await this.safeSend(
      token,
      psid,
      'ছবিটা থেকে exact product বুঝতে পারিনি 💖\n\nভালো match পেতে:\n• একবারে ১টা product-এর photo দিন\n• পুরো product যেন frame-এ থাকে\n• front side / clear light-এ ছবি দিন\n• blur বা collage এড়িয়ে চলুন\n• সাথে color/type লিখলে আরো ভালো match হবে\n\nচাইলে product code-ও পাঠাতে পারেন।',
    );
    await this.sendCatalogFallback(token, psid, page);
  }

  private async resolveReferencedProductCode(
    pageId: number,
    psid: string,
    message: any,
  ): Promise<string | null> {
    for (const field of [
      message?.reply_to?.text,
      message?.reply_to?.payload?.text,
    ]) {
      if (field) {
        const code = this.botIntent.extractSingleCode(String(field));
        if (code) return code;
      }
    }
    const last = await this.ctx.getLastPresentedProducts(pageId, psid);
    return last.length === 1 ? last[0].code : null;
  }

  /** Detect when customer wants 2 products sent to 2 different addresses */
  private isMultiAddressIntent(text: string): boolean {
    const t = text.toLowerCase();
    return /2\s*t[ai]\s*address|2\s*t[ai]\s*jaga|alag\s*address|alada\s*address|আলাদা\s*ঠিকানা|দুই\s*ঠিকানা|2\s*ঠিকানা|different\s*address|split.*order|2.*order.*address|address.*2.*jaga/i.test(
      t,
    );
  }

  /**
   * Called when Facebook sends an echo from a genuine human agent reply
   * (our own bot's echoes are filtered out before this is called — see the
   * is_echo branch above). Three independent ways to pause/resume, checked
   * in this order:
   *   1. text === startAiCommand  → resume immediately (checked first so a
   *      distinct start command always wins even if it were also configured
   *      as the stop command by mistake)
   *   2. text === stopAiCommand   → pause, regardless of the toggle below
   *   3. autoPauseOnHumanTakeover → pause on ANY agent-sent message
   * A pause auto-expires per Page.autoPauseTimeoutMinutes — see
   * ConversationContextService.isAgentHandling().
   */
  private async handleAgentEcho(
    page: any,
    customerPsid: string,
    text: string,
  ): Promise<void> {
    const pageId = page.id as number;
    const trimmed = text.trim();
    const startCmd = String(page.startAiCommand ?? '').trim();
    const stopCmd = String(page.stopAiCommand ?? '').trim();

    if (startCmd && trimmed === startCmd) {
      await this.ctx.setAgentHandling(pageId, customerPsid, false);
      this.logger.log(
        `[AgentEcho] Start command matched — bot resumed for psid=${customerPsid} page=${page.pageId}`,
      );
      return;
    }
    if (stopCmd && trimmed === stopCmd) {
      await this.ctx.setAgentHandling(pageId, customerPsid, true);
      this.logger.log(
        `[AgentEcho] Stop command matched — bot muted for psid=${customerPsid} page=${page.pageId}`,
      );
      return;
    }
    if (page.autoPauseOnHumanTakeover) {
      await this.ctx.setAgentHandling(pageId, customerPsid, true);
      this.logger.log(
        `[AgentEcho] Agent replied — bot muted for psid=${customerPsid} page=${page.pageId}`,
      );
    }
  }

  /**
   * Best-effort extraction of a referenced Facebook post/story id from an
   * inbound Messenger message — used to recognise which product a customer is
   * asking about when they reply to / share one of our posts. Scans the
   * reply_to reference and any attachment URLs for a numeric FB id, which is
   * matched against Product.fbPostId. Returns null if nothing usable is found
   * (then normal handling continues). The raw shapes vary by interaction, so we
   * cover the common ones and log unknowns for later refinement.
   */
  private extractReferencedPostId(message: any): string | null {
    try {
      const candidates: string[] = [];
      const rt = message?.reply_to;
      if (rt?.story?.id) candidates.push(String(rt.story.id));
      if (rt?.story?.url) candidates.push(String(rt.story.url));
      if (rt?.link) candidates.push(String(rt.link));
      for (const a of message?.attachments ?? []) {
        const url = a?.payload?.url;
        if (url) candidates.push(String(url));
        if (a?.payload?.title) candidates.push(String(a.payload.title));
      }
      for (const c of candidates) {
        const m =
          c.match(/(?:posts|photos|videos)\/(?:[^/?]*\/)?(\d{6,})/) ||
          c.match(/(?:story_fbid|fbid|story_id|multi_permalinks)=(\d{6,})/) ||
          c.match(/_(\d{6,})(?:[/?#]|$)/) ||
          c.match(/^(\d{6,})$/);
        if (m) return m[1];
      }
    } catch {
      /* ignore — best effort */
    }
    return null;
  }

  /** Safe sendText — logs error but does not throw */
  private async safeSend(
    token: string,
    psid: string,
    text: string,
  ): Promise<void> {
    try {
      await this.messenger.sendText(token, psid, text);
      const key = this.activeReplyKey.get(psid) ?? psid;
      this.inFlightReply.set(key, text); // track last reply for history
    } catch (err) {
      this.logger.error(`[Webhook] safeSend failed psid=${psid}: ${err}`);
    }
  }

  /**
   * Send a reply as 1–3 short message bubbles (feels more human than one wall
   * of text). The AI marks intended split points with "|||". We cap the number
   * of bubbles and store the FULL reply in inFlightReply so chat history keeps
   * the complete message, not just the last bubble.
   */
  private async sendReplyInChunks(
    token: string,
    psid: string,
    fullText: string,
  ): Promise<void> {
    const text = (fullText ?? '').trim();
    if (!text) return;
    const parts = text
      .split('|||')
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 3);
    const bubbles = parts.length > 0 ? parts : [text];
    for (let i = 0; i < bubbles.length; i++) {
      if (i > 0) {
        // brief pause + typing indicator between bubbles, like a person
        void this.messenger.sendSenderAction(token, psid, 'typing_on');
        await new Promise((r) => setTimeout(r, 700));
      }
      try {
        await this.messenger.sendText(token, psid, bubbles[i]);
      } catch (err) {
        this.logger.error(`[Webhook] chunk send failed psid=${psid}: ${err}`);
      }
    }
    const key = this.activeReplyKey.get(psid) ?? psid;
    this.inFlightReply.set(key, bubbles.join('\n')); // full reply for history
  }

  /**
   * SmartBot page but the AI provider is momentarily unavailable / out of
   * balance. We deliberately do NOT fall back to keyword matching (retired for
   * SmartBot pages) — instead send a short, friendly holding message so the
   * customer never sees silence.
   */
  private async sendSmartBotUnavailable(
    token: string,
    psid: string,
    page: any,
  ): Promise<void> {
    const pageId = page.id as number;
    const fallback = 'একটু ব্যস্ত আছি 😊 একটু পরে আবার লিখুন, আমি সাহায্য করছি।';
    const msg = await this.botKnowledge
      .resolveSystemReply(pageId, 'ai_busy', undefined, page.agentType)
      .catch(() => fallback);
    // resolveSystemReply may return empty for an unregistered key — never send silence
    await this.safeSend(token, psid, msg?.trim() ? msg : fallback);
  }

  // ── Voice message handler (Whisper STT) ────────────────────────────────────

  private async handleAudioMessage(
    page: any,
    psid: string,
    audioUrl: string,
  ): Promise<void> {
    const pageId = page.id as number;
    const token = page.pageToken as string;

    this.logger.log(
      `[Whisper] Audio message from psid=${psid} page=${page.pageId}`,
    );

    // Guard: automation must be on and wallet must have balance
    if (!page.automationOn) return;

    if (!(await this.walletService.canProcessAi(pageId))) {
      this.logger.warn(
        `[Whisper] pageId=${pageId} insufficient balance — skipping audio`,
      );
      return;
    }

    if (!this.whisper.isAvailable()) {
      this.logger.warn('[Whisper] Service unavailable — no OPENAI_API_KEY');
      return;
    }

    // Acknowledge the voice message while transcribing
    const processingMsg = await this.botKnowledge
      .resolveSystemReply(pageId, 'voice_processing', undefined, page.agentType)
      .catch(() => 'আপনার voice message শুনছি... ⏳');
    await this.safeSend(token, psid, processingMsg);

    const transcribed = await this.whisper.transcribe(audioUrl);

    if (!transcribed) {
      this.logger.warn(`[Whisper] Transcription failed for psid=${psid}`);
      const failMsg = await this.botKnowledge
        .resolveSystemReply(pageId, 'voice_fail', undefined, page.agentType)
        .catch(
          () => 'দুঃখিত, আপনার voice message বুঝতে পারিনি। Text-এ লিখে জানান।',
        );
      await this.safeSend(token, psid, failMsg);
      return;
    }

    // Deduct VOICE cost after successful transcription
    await this.walletService.deductUsage(pageId, 'VOICE');

    this.logger.log(
      `[Whisper] Routing transcribed text to bot pipeline: "${transcribed.slice(0, 80)}"`,
    );

    // Route the transcribed text through the normal message pipeline by
    // constructing a synthetic message object and re-calling processMessage
    const syntheticMessage = { text: transcribed };
    await this.processMessage(page, psid, syntheticMessage);
  }

  /**
   * Fetch CRM record for a psid and pre-fill a new draft with name/phone/address.
   * Returns the crmCustomer so callers can decide the greeting message.
   */
  private async prefillDraftFromCrm(
    pageId: number,
    psid: string,
    draft: DraftSession,
  ): Promise<{
    name: string | null;
    phone: string | null;
    address: string | null;
    totalOrders: number;
  } | null> {
    try {
      const crm = await this.prisma.customer.findUnique({
        where: { pageId_psid: { pageId, psid } },
        select: { name: true, phone: true, address: true, totalOrders: true },
      });
      if (!crm) return null;
      if (crm.name) draft.customerName = crm.name;
      if (crm.phone) draft.phone = crm.phone;
      if (crm.address) draft.address = crm.address;
      return crm;
    } catch {
      return null;
    }
  }

  /**
   * Checks active live sessions for this page. If any session has an aiMemo,
   * sends the customer's image to GPT-4o to match against stored visual profiles.
   * Returns the matched product or null (→ falls through to OCR pipeline).
   */
  private async matchLiveSession(
    pageId: number,
    imageUrl: string,
  ): Promise<{
    sessionId: number;
    slot: 'worn' | 'held';
    product: { id: number; code: string; name: string; price: number };
    confidence: number;
  } | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    try {
      // Quick DB check — return null immediately if no active analyzed sessions
      const sessions = await this.prisma.liveSession.findMany({
        where: { pageId, isActive: true, aiMemo: { not: null } },
        include: {
          wornProduct: {
            select: { id: true, code: true, name: true, price: true },
          },
          heldProduct: {
            select: { id: true, code: true, name: true, price: true },
          },
        },
        take: 5,
      });
      if (!sessions.length) return null;

      // Check wallet before making the GPT-4o call
      if (!(await this.walletService.canProcessAi(pageId))) return null;

      const sessionDescs = sessions
        .map((s) => {
          let memo: any = {};
          try {
            memo = JSON.parse(s.aiMemo!);
          } catch {
            /* skip */
          }
          const wornDesc =
            memo.worn?.description ??
            (s.wornProduct ? `${s.wornProduct.name} — worn by model` : null);
          const heldDesc =
            memo.held?.description ??
            (s.heldProduct ? `${s.heldProduct.name} — held in hand` : null);
          const parts: string[] = [];
          if (wornDesc && s.wornProduct)
            parts.push(`  - WORN (${s.wornProduct.code}): ${wornDesc}`);
          if (heldDesc && s.heldProduct)
            parts.push(`  - HELD (${s.heldProduct.code}): ${heldDesc}`);
          return `Session ${s.id}${s.label ? ` "${s.label}"` : ''}:\n${parts.join('\n')}`;
        })
        .join('\n\n');

      const prompt = `A customer sent this screenshot from a Bangladeshi clothing live sale.

Known products visible in live sessions:
${sessionDescs}

Look at the customer's image and identify which product they are referring to.
Return ONLY valid JSON (no markdown):
{
  "matched": true,
  "sessionId": 1,
  "slot": "worn",
  "productCode": "DF-001",
  "confidence": 0.85,
  "reason": "brief explanation"
}

If you cannot match any product with confidence > 0.5, return:
{"matched": false}`;

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 200,
          temperature: 0.1,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: { url: imageUrl, detail: 'high' },
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) return null;
      const data = await res.json();
      const text: string = data.choices?.[0]?.message?.content ?? '';
      let ai: any = {};
      try {
        const m = text.match(/\{[\s\S]*\}/);
        if (m) ai = JSON.parse(m[0]);
      } catch {
        return null;
      }

      if (!ai.matched || ai.confidence < 0.5) return null;

      const session = sessions.find((s) => s.id === ai.sessionId);
      if (!session) return null;

      const slot: 'worn' | 'held' = ai.slot === 'held' ? 'held' : 'worn';
      const product =
        slot === 'worn' ? session.wornProduct : session.heldProduct;
      if (!product) return null;

      void this.walletService.deductUsage(pageId, 'DUAL_PHOTO_AI', {
        photoCount: 1,
      });

      return {
        sessionId: session.id,
        slot,
        product: {
          id: product.id,
          code: product.code,
          name: product.name ?? '',
          price: Number(product.price),
        },
        confidence: ai.confidence ?? 0,
      };
    } catch (err: any) {
      this.logger.warn(`[LiveSession] Match error: ${err?.message}`);
      return null;
    }
  }

  /** Returns false for Basic plan users — AI features are disabled on Basic */
  private async generateBusinessBotReply(
    businessInfo: string,
    customerText: string,
    pageId: number,
    psid: string,
  ): Promise<{ reply: string; charCount: number } | null> {
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    const history = await this.ctx.getHistory(pageId, psid).catch(() => []);
    const historyLines = (history as any[])
      .slice(-6)
      .map((h: any) => `Customer: ${h.customerText}\nBot: ${h.botReply}`)
      .join('\n');

    const systemPrompt = `তুমি একটি business-এর customer service assistant। নিচে এই business সম্পর্কে সব তথ্য দেওয়া আছে। এই তথ্যের ভিত্তিতে customer-এর প্রশ্নের উত্তর দাও।

Business Information:
${businessInfo}

নিয়মাবলী:
- যে ভাষায় customer লিখবে সেই ভাষায় উত্তর দাও (Bengali/Banglish/English)
- সংক্ষিপ্ত ও helpful উত্তর দাও (2-3 বাক্য)
- Customer ইতিমধ্যে এই page-এ message করেই যোগাযোগ করছে — কখনো "আমাদের সাথে যোগাযোগ করুন" বলবে না, এটা circular এবং annoying
- "কীভাবে যোগাযোগ করব?" জিজ্ঞেস করলে বলো: "এই page-এ message করেই কথা বলতে পারেন, আমরা reply দিচ্ছি 😊"
- Business info-এ উত্তর না থাকলে বলো: "এই বিষয়ে আমাদের টিম আপনাকে সাহায্য করবে। একটু বিস্তারিত জানান?"
- "Na", "Aca", "Ok", "Hmm" এর মতো short reply-তে context বুঝে natural ভাবে respond করো
- কোনো link বা placeholder লিখবে না`;

    const userMsg = historyLines
      ? `Previous conversation:\n${historyLines}\n\nCustomer: ${customerText}`
      : customerText;

    // Try Gemini first
    if (geminiKey) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: 'user', parts: [{ text: userMsg }] }],
              // thinkingBudget: 0 — gemini-2.5-flash's default "thinking" mode can
              // eat the whole output budget and truncate the reply mid-sentence.
              generationConfig: { maxOutputTokens: 300, temperature: 0.5, thinkingConfig: { thinkingBudget: 0 } },
            }),
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (res.ok) {
          const data = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (text) return { reply: text, charCount: systemPrompt.length + customerText.length + text.length };
        }
      } catch (e: any) {
        this.logger.warn(`[BusinessBot] Gemini failed: ${e?.message}`);
      }
    }

    // Fallback: OpenAI
    if (openaiKey) {
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 300,
            temperature: 0.5,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMsg },
            ],
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const data = await res.json();
          const text = (data?.choices?.[0]?.message?.content ?? '').trim();
          if (text) return { reply: text, charCount: systemPrompt.length + customerText.length + text.length };
        }
      } catch (e: any) {
        this.logger.warn(`[BusinessBot] OpenAI failed: ${e?.message}`);
      }
    }

    return null;
  }

  private async isAiAllowedForPage(ownerId: string | null): Promise<boolean> {
    if (!ownerId) return true;
    try {
      const sub = await this.billing.getOrCreateSubscription(ownerId);
      return this.billing.canTakeOrders(sub);
    } catch {
      return true;
    }
  }
}
