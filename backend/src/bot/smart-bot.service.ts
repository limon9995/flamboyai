import { Injectable, Logger } from '@nestjs/common';
import {
  ConversationContextService,
  CustomFieldDef,
  DraftSession,
} from '../conversation-context/conversation-context.service';
import { queueAiOrderFields } from '../common/order-fields';
import { BotContextService, BusinessContext } from './bot-context.service';
import { BotKnowledgeService } from '../bot-knowledge/bot-knowledge.service';
import { WalletService } from '../wallet/wallet.service';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiKeyRotatorService } from '../common/gemini-key-rotator.service';
import { AgentBehaviorConfig } from '../agents/agent-behavior-config.interface';
import { estimateMonthlyCost, PricingCalcInput } from '../common/pricing-estimator';
import { MessengerService } from '../messenger/messenger.service';
import { isInsideDhakaAddress } from '../webhook/handlers/dhaka-areas';
import { AiUsageService } from '../common/ai-usage.service';
import { ApiKeysService } from '../common/api-keys.service';
import { OrderOwnerMailerService } from '../orders/order-owner-mailer.service';
import {
  formatSlabsBn,
  parsePriceVariants,
  variantsSummaryText,
} from '../common/restaurant-delivery';

// Verbatim defaults — used whenever an agent type has no AgentBehaviorConfig
// personaPrompt/toneRules override, so agentType='commerce' pages (the vast
// majority today) see byte-identical prompts to before this config layer
// existed.
function defaultSmartBotIntro(shop: string): string {
  return `তুমি ${shop}-এর Facebook Messenger sales assistant — একজন real মানুষের মতো কথা বলো, robot-এর মতো না।`;
}
const DEFAULT_SMART_BOT_TONE_BLOCK = `

## কথা বলার ধরন (CRITICAL)
- ছোট, সহজ বাক্য। একটা কাজ একবারে।
- Emoji পরিমিত (প্রতি reply-এ ১-২টা যথেষ্ট, সব লাইনে না)।
- "ধন্যবাদ আপনার আগ্রহের জন্য! আমরা আপনার অর্ডার..." — এই ধরনের corporate ভাষা একদম বন্ধ।
- বাংলা/Banglish — customer যেভাবে লেখে সেভাবে reply করো।
- নাম জানলে নাম ধরে ডাকো।
- "আপনার ফোন নম্বরটি উল্লেখ করলে আমরা আপনার জন্য অর্ডার প্রসেস করতে পারব" — এই ধরনের লম্বা বাক্য নয়। সরাসরি বলো: "ফোন নম্বরটা দিন 😊"
- Customer "Assalamu Alaikum" / "Salam" / "আসসালামু আলাইকুম" / "সালাম" দিয়ে message শুরু করলে reply-ও "ওয়ালাইকুম আসসালাম" দিয়ে শুরু করো, তারপর স্বাভাবিকভাবে বাকি কথা বলো।

⛔ HARD BAN: "আমাদের সাথে যোগাযোগ করুন" / "আরও জানতে যোগাযোগ করুন" — কখনো না।
⛔ HARD BAN: একই কথা দুইবার বলা, unnecessary ব্যাখ্যা, filler বাক্য।`;

export interface IDraftOrderHandler {
  finalizeDraftOrder(
    pageId: number,
    psid: string,
    draft: DraftSession,
    page: any,
  ): Promise<number>;
  buildSummary(draft: DraftSession, page: any): string;
  buildAdvancePrompt(page: any, draft: DraftSession): string;
  promptForCustomField(field: CustomFieldDef): string;
}

export interface SmartBotCollected {
  productCodes?: string[];
  qty?: Record<string, number>;
  customerName?: string | null;
  phone?: string | null;
  address?: string | null;
  paymentProof?: string | null;
}

export interface SmartBotResponse {
  reply: string;
  action: 'CHAT' | 'COLLECT' | 'CONFIRM_ORDER' | 'CANCEL_ORDER' | 'AGENT' | 'ESCALATE' | 'CAPTURE_LEAD' | 'CONFIRM_LEAD' | 'SHOW_CATALOG' | 'SHOW_PRODUCT_IMAGE';
  collected: SmartBotCollected;
  calculatePricing: PricingCalcInput | null;
}

// Returned by handle() when the AI decides to show the product catalog cards.
// The webhook sends `reply` (a short lead-in) then the carousel of products —
// this replaces the old CATALOG_REQUEST keyword match.
export interface SmartBotCatalogResult {
  reply: string;
  showCatalog: true;
}

// Returned by handle() when the AI (in Custom Prompt mode) decides to show
// one specific product's image — distinct from SmartBotCatalogResult, which
// sends the whole catalog. `imageUrl` is null if the product/code wasn't
// found, so the webhook can fall back to a plain text reply.
export interface SmartBotImageResult {
  reply: string;
  showProductImage: true;
  imageUrl: string | null;
}

// Filled in by callGeminiWithKey/callOpenAIApi so the caller knows which
// provider actually answered and what it cost (real tokens, not guesses).
interface AiCallUsage {
  provider?: 'gemini' | 'openai' | 'openrouter';
  model?: string;
  promptTokens?: number;
  outputTokens?: number;
}

const VALID_ACTIONS = new Set([
  'CHAT',
  'COLLECT',
  'CONFIRM_ORDER',
  'CANCEL_ORDER',
  'AGENT',
  'ESCALATE',
  'CAPTURE_LEAD',
  'CONFIRM_LEAD',
  'SHOW_CATALOG',
  'SHOW_PRODUCT_IMAGE',
]);

@Injectable()
export class SmartBotService {
  private readonly logger = new Logger(SmartBotService.name);
  private readonly openAiKey: string;
  private readonly model: string;

  private failCount = 0;
  private readonly MAX_FAILS = 5;
  private cooldownUntil = 0;

  constructor(
    private readonly ctx: ConversationContextService,
    private readonly botContext: BotContextService,
    private readonly botKnowledge: BotKnowledgeService,
    private readonly walletService: WalletService,
    private readonly prisma: PrismaService,
    private readonly geminiRotator: GeminiKeyRotatorService,
    private readonly messenger: MessengerService,
    private readonly aiUsage: AiUsageService,
    private readonly apiKeys: ApiKeysService,
    private readonly orderOwnerMailer: OrderOwnerMailerService,
  ) {
    this.openAiKey = process.env.OPENAI_API_KEY ?? '';
    this.model = process.env.AI_INTENT_MODEL ?? 'gemini-3.5-flash-lite';
  }

  isAvailable(): boolean {
    // The 5-fail circuit breaker (cooldownUntil) exists to stop hammering a
    // provider that's currently broken. It must never block a healthy backup
    // provider, though — if OpenAI/OpenRouter is configured, Gemini having a
    // rough patch (or being on cooldown) should still fall through per-message
    // (see callOpenAI below), not silently degrade straight to keyword replies.
    const geminiUsable = this.geminiRotator.isAvailable() && Date.now() > this.cooldownUntil;
    return geminiUsable || !!this.openAiKey || !!this.apiKeys.getSync('openrouterApiKey');
  }

  /**
   * Returns the reply string to send (WebhookService.safeSend handles it for history tracking).
   * Returns false if AI failed/unavailable → caller should run keyword pipeline.
   */
  async handle(
    page: any,
    psid: string,
    text: string,
    draft: DraftSession | null,
    draftHandler: IDraftOrderHandler,
  ): Promise<string | false | SmartBotCatalogResult | SmartBotImageResult> {
    const pageId = page.id as number;

    if (!this.isAvailable()) {
      this.logger.warn('[SmartBot] Not available (no key or cooldown)');
      return false;
    }

    if (!(await this.walletService.canProcessAi(pageId))) {
      this.logger.warn(`[SmartBot] pageId=${pageId} insufficient balance`);
      return false;
    }

    const businessContext = await this.botContext.buildBusinessContext(pageId);
    const history = await this.ctx.getHistory(pageId, psid);

    const lastOrder = await this.prisma.order.findFirst({
      where: { pageIdRef: pageId, customerPsid: psid },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        createdAt: true,
        address: true,
        items: { select: { productCode: true, qty: true } },
      },
    });

    // If customer sent a specific Order ID (e.g. "#1234" or "1234"), look it up
    let orderById: any = null;
    const orderIdMatch = text.match(/^#?(\d{1,6})\s*$/) || text.match(/অর্ডার\s*#?(\d{1,6})/i);
    if (orderIdMatch) {
      orderById = await this.prisma.order.findFirst({
        where: { id: parseInt(orderIdMatch[1]), pageIdRef: pageId },
        select: {
          id: true,
          status: true,
          createdAt: true,
          items: { select: { productCode: true, qty: true } },
        },
      });
    }

    const agentBehavior = await this.botKnowledge
      .getAgentBehavior(page.agentType || 'commerce')
      .catch(() => ({}) as AgentBehaviorConfig);

    // Returning-customer recognition — so the bot greets known customers by
    // name and never re-asks info it already has on file.
    const crmCustomer = await this.prisma.customer
      .findUnique({
        where: { pageId_psid: { pageId, psid } },
        select: { name: true, totalOrders: true, lastOrderAt: true },
      })
      .catch(() => null);

    // Products the customer just saw / is talking about (e.g. replied to a
    // product post, or a card was just shown) — so "price?" / "eta nibo" is
    // understood without asking "which product?".
    const lastPresented = await this.ctx
      .getLastPresentedProducts(pageId, psid)
      .catch(() => [] as { code: string; price: number; name?: string | null }[]);

    // Name to greet the customer by. Prefer their CRM/order name; otherwise
    // fetch their Facebook first name so the bot can say "প্রিয় <name>" even
    // before they've given an order name.
    let greetName: string | null = crmCustomer?.name ?? null;
    if (!greetName) {
      greetName = await this.messenger
        .getUserFirstName(page.pageToken, psid)
        .catch(() => null);
    }

    const systemPrompt = this.buildSystemPrompt(
      businessContext,
      draft,
      page,
      lastOrder,
      orderById,
      orderIdMatch ? parseInt(orderIdMatch[1]) : null,
      agentBehavior,
      crmCustomer,
      lastPresented,
      greetName,
    );
    const messages: { role: string; content: string }[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: text },
    ];

    const usage: AiCallUsage = {};
    const parsed = await this.callOpenAI(messages, usage);
    if (!parsed) return false;

    this.failCount = 0;
    // Real token usage for the platform profit report (fire-and-forget)
    if (usage.provider && usage.model) {
      void this.aiUsage.record({
        pageId,
        provider: usage.provider,
        model: usage.model,
        usageType: 'SMART_BOT',
        promptTokens: usage.promptTokens,
        outputTokens: usage.outputTokens,
      });
    }
    const charCount = systemPrompt.length + text.length + (parsed.reply?.length ?? 0);
    await this.walletService.deductUsage(pageId, 'SMART_BOT', {
      provider: usage.provider ?? 'gemini',
      charCount,
    });

    // Real arithmetic, not LLM-guessed — model only signals it has gathered
    // enough volume info; the actual numbers always come from our own code.
    if (parsed.calculatePricing) {
      parsed.reply = `${parsed.reply}\n\n${estimateMonthlyCost(parsed.calculatePricing)}`;
    }

    this.logger.log(
      `[SmartBot] action=${parsed.action} reply="${parsed.reply.slice(0, 60)}"`,
    );

    // Snapshot completeness BEFORE merging, so the deterministic next-step
    // message below fires exactly once — on the turn that completes collection.
    const wasComplete = !!(
      draft &&
      !(draft as any).isLead &&
      draft.items.length > 0 &&
      draft.customerName &&
      draft.phone &&
      draft.address
    );
    const hadProof = !!draft?.paymentProof;

    // Merge collected fields into draft and persist
    const updatedDraft = await this.mergeAndSave(
      pageId,
      psid,
      draft,
      parsed.collected,
      businessContext,
      page,
    );

    // Execute side-effects (state changes), return reply string to caller for sending
    switch (parsed.action) {
      case 'CONFIRM_ORDER': {
        const d = updatedDraft;
        const canFinalize =
          d &&
          d.items.length > 0 &&
          d.customerName &&
          d.phone &&
          d.address &&
          (!this.requiresAdvancePayment(d, page) || d.paymentProof);

        if (!canFinalize) {
          // Don't trust the AI's own wording here — especially in Custom
          // Prompt mode, the model can prematurely say "order confirmed!"
          // before customerName/phone/address are actually collected (seen
          // live: model declares success right after color+qty, backend
          // silently drops it, customer is told "confirmed" with nothing
          // saved). Deterministically ask for whatever is still missing so
          // the customer is never told "confirmed" while nothing was saved.
          const isBangla = /[ঀ-৿]/.test(text);
          if (!d || d.items.length === 0) {
            return isBangla
              ? 'কোন প্রোডাক্টটা অর্ডার করতে চান, নাম/কোডটা বলবেন? 😊'
              : "Which product would you like to order — could you tell me the name/code? 😊";
          }
          if (!d.customerName) {
            return isBangla
              ? 'অর্ডার কনফার্ম করতে আপনার নামটা জানাবেন?'
              : "Could you share your name to confirm the order?";
          }
          if (!d.phone) {
            return isBangla
              ? 'আপনার ফোন নাম্বারটা দিন, প্লিজ।'
              : 'Could you share your phone number, please?';
          }
          if (!d.address) {
            return isBangla
              ? 'ডেলিভারি এড্রেসটা (এলাকা/শহর) দিন, প্লিজ।'
              : 'Could you share your delivery address (area/city), please?';
          }
          if (this.requiresAdvancePayment(d, page) && !d.paymentProof) {
            return isBangla
              ? 'অর্ডার কনফার্ম করতে আগে অ্যাডভান্স পেমেন্ট করে transaction ID/screenshot পাঠান, প্লিজ।'
              : 'To confirm the order, please send the advance payment transaction ID/screenshot first.';
          }
          return parsed.reply;
        }
        try {
          await draftHandler.finalizeDraftOrder(pageId, psid, d, page);
          const orderReply = await this.botKnowledge
            .resolveSystemReply(pageId, 'order_received')
            .catch(() => parsed.reply);
          await this.ctx.clearDraft(pageId, psid);
          await this.ctx.clearHistory(pageId, psid);
          return orderReply;
        } catch (err: any) {
          this.logger.error(
            `[SmartBot] finalizeDraftOrder failed: ${err?.message}`,
          );
          return parsed.reply;
        }
      }

      case 'CANCEL_ORDER': {
        await this.ctx.clearDraft(pageId, psid);
        return parsed.reply;
      }

      case 'AGENT': {
        await this.ctx.setAgentHandling(pageId, psid, true);
        return parsed.reply;
      }

      case 'ESCALATE': {
        // Custom Prompt mode: client's prompt decided this needs human
        // attention (e.g. complaint/refund) — same agent handoff as AGENT,
        // plus an owner email alert. Destination is never influenced by the
        // model/prompt — sendEscalationAlert only ever resolves page.owner.email.
        await this.ctx.setAgentHandling(pageId, psid, true);
        void this.orderOwnerMailer
          .sendEscalationAlert(pageId, psid, parsed.reply)
          .catch(() => {});
        return parsed.reply;
      }

      case 'CAPTURE_LEAD': {
        // Start or continue lead collection — just need name + whatsapp phone
        let leadDraft = updatedDraft;
        if (!leadDraft) {
          leadDraft = this.ctx.emptyDraft('FACEBOOK');
          leadDraft.isLead = true;
          leadDraft.items = [];
        }
        leadDraft.isLead = true;
        if (parsed.collected.customerName) leadDraft.customerName = parsed.collected.customerName;
        if (parsed.collected.phone) {
          leadDraft.phone = parsed.collected.phone;
          leadDraft.whatsappNumber = parsed.collected.phone;
        }
        await this.ctx.saveDraft(pageId, psid, leadDraft);
        return parsed.reply;
      }

      case 'CONFIRM_LEAD': {
        const ld = updatedDraft;
        if (!ld || !ld.customerName || !ld.phone) {
          return parsed.reply; // Still collecting
        }
        try {
          await draftHandler.finalizeDraftOrder(pageId, psid, { ...ld, isLead: true }, page);
          await this.ctx.clearDraft(pageId, psid);
          await this.ctx.clearHistory(pageId, psid);
        } catch (err: any) {
          this.logger.error(`[SmartBot] finalizeLead failed: ${err?.message}`);
        }
        return parsed.reply;
      }

      case 'SHOW_CATALOG': {
        // AI wants to show the product catalog cards. Signal the webhook to send
        // the carousel; parsed.reply is a short lead-in line.
        return { reply: parsed.reply, showCatalog: true };
      }

      case 'SHOW_PRODUCT_IMAGE': {
        // Custom Prompt mode: AI wants to show one specific product's image.
        // The model only ever supplies a product CODE it already saw in
        // productCtx — we look up the real imageUrl ourselves, the model
        // never supplies/invents a URL.
        const code = parsed.collected.productCodes?.[0];
        const product = code
          ? await this.prisma.product.findFirst({
              where: { pageId, code, isActive: true },
              select: { imageUrl: true },
            })
          : null;
        return { reply: parsed.reply, showProductImage: true, imageUrl: product?.imageUrl ?? null };
      }

      default: {
        // CHAT or COLLECT — when this turn just completed the basic order info,
        // don't leave the flow hanging on the model's initiative: append the
        // deterministic next step (advance-payment request or order summary),
        // the same messages the keyword pipeline sends. Without this the bot
        // would say "সব তথ্য পেয়েছি" and then stall, never asking for the
        // outside-Dhaka advance or a confirm.
        const d = updatedDraft;
        const nowComplete = !!(
          d &&
          !(d as any).isLead &&
          d.items.length > 0 &&
          d.customerName &&
          d.phone &&
          d.address
        );
        // Fire when collection just completed, or when the advance payment
        // proof (trxID) just arrived — the customer still needs the summary
        // and a confirm ask, otherwise the flow dies on "অপেক্ষা করছি".
        const proofJustArrived = !!d?.paymentProof && !hadProof;
        if (nowComplete && (!wasComplete || proofJustArrived)) {
          if (d!.currentStep.startsWith('cf:') && d!.pendingCustomFields?.length) {
            return `${parsed.reply}\n\n${draftHandler.promptForCustomField(d!.pendingCustomFields[0])}`;
          }
          if (d!.currentStep === 'advance_payment') {
            return `${parsed.reply}\n\n${draftHandler.buildAdvancePrompt(page, d!)}`;
          }
          if (d!.currentStep === 'confirm') {
            return `${parsed.reply}\n\n${draftHandler.buildSummary(d!, page)}`;
          }
        }
        return parsed.reply;
      }
    }
  }

  private buildCatalogUrl(page: any): string {
    const website = String(page.websiteUrl || '').trim();
    if (website) return website;
    const base = (
      process.env.CATALOG_BASE_URL || 'https://flamboyai.com'
    ).replace(/\/$/, '');
    const slug = page.catalogSlug || String(page.id);
    return `${base}/catalog/${slug}`;
  }

  private buildSystemPrompt(
    ctx: BusinessContext,
    draft: DraftSession | null,
    page: any,
    lastOrder?: any,
    orderById?: any,
    queriedOrderId?: number | null,
    agentBehavior: AgentBehaviorConfig = {},
    crmCustomer?: { name?: string | null; totalOrders?: number | null; lastOrderAt?: Date | null } | null,
    lastPresented?: { code: string; price: number; name?: string | null }[],
    greetName?: string | null,
  ): string {
    const shop = ctx.businessName
      ? `"${ctx.businessName}" নামের Bangladeshi e-commerce shop`
      : 'একটি Bangladeshi fashion e-commerce shop';

    // Product catalog — split coded vs simple
    const codedProducts = ctx.products.filter((p) => (p as any).productType !== 'SIMPLE');
    const simpleProducts = ctx.products.filter((p) => (p as any).productType === 'SIMPLE');

    // V24: per-product discount/offer note — shown only when originalPrice > price.
    const offerNote = (p: any) => {
      const orig = Number(p.originalPrice) || 0;
      const price = Number(p.price) || 0;
      if (!orig || orig <= price) return '';
      const pct = Math.round((1 - price / orig) * 100);
      return ` | 🔥 OFFER: ৳${price} (আগের দাম ৳${orig}, ছাড় ${pct}%)`;
    };

    // V25: size/portion pricing — "5 pcs ৳120 / 10 pcs ৳220" replaces the
    // single price so the bot can answer "3ta momo koto?" correctly.
    const priceText = (p: any, unitSuffix = '') => {
      const variants = parsePriceVariants((p as any).priceVariantsJson);
      if (variants.length)
        return `${variantsSummaryText(variants, '৳')} (দাম size/পরিমাণ অনুযায়ী)`;
      return `৳${p.price}${unitSuffix}`;
    };
    const categoryNote = (p: any) =>
      (p as any).priceVariantsJson && (p as any).category
        ? ` | Category: ${(p as any).category}`
        : '';
    // trackStock=false food items are always orderable while active
    const stockText = (p: any, inText: string) =>
      (p as any).trackStock === false || p.stockQty > 0 ? inText : 'Stock শেষ';

    const codedLines = codedProducts
      .slice(0, 30)
      .map((p) => {
        // V25: never expose the exact stock count to the AI's own output —
        // only in-stock/out-of-stock, so it physically can't leak a number
        // even if a customer asks "koto pis ase".
        const stock = stockText(p, 'Stock আছে');
        const deliveryNote =
          (p as any).deliveryCharge === 'FREE' ? ' | 🚚 Home Delivery FREE' : '';
        const desc = String((p as any).description || '').trim();
        const descLine = desc ? `\n    বিবরণ: ${desc}` : '';
        return `[${p.code}] ${p.name ?? p.code} — ${priceText(p)} | ${stock}${deliveryNote}${categoryNote(p)}${offerNote(p)}${descLine}`;
      })
      .join('\n');

    const simpleLines = simpleProducts
      .map((p) => {
        const unit = (p as any).unit || 'pcs';
        // V25: never expose the exact stock count — see codedLines note above.
        const stock = stockText(p, `Stock আছে (${unit})`);
        const deliveryNote =
          (p as any).deliveryCharge === 'FREE' ? ' | 🚚 Home Delivery FREE' : '';
        const desc = String((p as any).description || '').trim();
        const descLine = desc ? `\n    বিবরণ: ${desc}` : '';
        return `${p.name ?? p.code} — ${priceText(p, `/${unit}`)} | ${stock}${deliveryNote}${categoryNote(p)}${offerNote(p)}${descLine}`;
      })
      .join('\n');

    const productCtx =
      ctx.products.length > 0
        ? `\n\n## Product Catalog\n${codedLines}${simpleLines ? `\n\n### Simple Items\n${simpleLines}` : ''}\n\n(প্রতিটা product-এর "বিবরণ" লাইনে পুরো তথ্য দেওয়া আছে — customer কোনো product সম্পর্কে বিস্তারিত জিজ্ঞেস করলে এখান থেকে উত্তর দাও, কিছু বানিয়ো না।)\n\n⚠️ Customer-এর সাথে কথায় সবসময় product-এর **নাম** ব্যবহার করো — [CODE] গুলো internal, চ্যাটে code বলে customer-কে বিভ্রান্ত করবে না। Customer নিজে code জিজ্ঞেস করলে তখনই শুধু বলবে।\n\n⚠️ "🔥 OFFER" মার্ক করা product-এর কথা উঠলে দাম/উপলব্ধতা জানানোর সাথে স্বাভাবিকভাবে discount-টাও একবার উল্লেখ করো — কিন্তু customer-কে disturb না করে, বারবার বলে জোর করবে না বা pushy sales pitch দেবে না। যতটুকু বলা দরকার ততটুকুই।\n\n⚠️ Customer যদি জিজ্ঞেস করে "কতগুলো/কয় পিস স্টক আছে" ধরনের exact quantity — কখনো সংখ্যা বলবে না (তোমাকে সেটা দেওয়াও হয়নি)। শুধু বলবে "সীমিত সংখ্যায় স্টক আছে" এবং স্বাভাবিকভাবে তাড়াতাড়ি অর্ডার করতে বলবে — pushy না হয়ে।`
        : '\n\n## Product Catalog\n(কোনো product নেই)';

    // Delivery & payment
    // Restaurant mode: distance-slab self-delivery — inside/outside Dhaka
    // rates never apply; exact fee needs the customer's map pin on the website.
    const restaurantWebUrl = this.buildCatalogUrl(page);
    const deliveryCtx = ctx.restaurantMode
      ? `\n\n## Delivery & Payment (Restaurant — নিজস্ব ডেলিভারি)
- আমরা restaurant/food business — নিজেরাই কাছাকাছি এলাকায় delivery করি।
- Delivery fee দূরত্ব অনুযায়ী: ${formatSlabsBn(ctx.deliverySlabs, '৳')}
- Delivery সময়: ${ctx.deliveryTime || '(সেট করা নেই)'}

⚠️ ঢাকার ভিতরে/বাইরে flat rate এই page-এ প্রযোজ্য NA — কখনো "ঢাকার ভিতরে X টাকা, বাইরে Y টাকা" বলবে না।
⚠️ Customer delivery fee জানতে চাইলে উপরের দূরত্ব-অনুযায়ী rate গুলো বলো, এবং বলো exact charge জানতে আমাদের website-এ ম্যাপে location pin করলেই দেখাবে: ${restaurantWebUrl}
⚠️ Customer order করতে চাইলে website link দাও (${restaurantWebUrl}) — সেখানে ম্যাপে exact location pin করে order করলে delivery charge auto হিসাব হবে। Chat-এ address নিয়ে order নেওয়ার চেষ্টা করবে না, কারণ exact location ছাড়া delivery fee ঠিক করা যায় না।`
      : `\n\n## Delivery & Payment
- ঢাকার ভিতরে delivery fee: ৳${ctx.deliveryInsideFee}${ctx.deliveryTimeInside ? ` | সময়: ${ctx.deliveryTimeInside}` : ''}
- ঢাকার বাইরে delivery fee: ৳${ctx.deliveryOutsideFee}${ctx.deliveryTimeOutside ? ` | সময়: ${ctx.deliveryTimeOutside}` : ''}
- Delivery সময়: ${ctx.deliveryTime || (ctx.deliveryTimeInside || ctx.deliveryTimeOutside ? 'zone দেখো' : '(সেট করা নেই)')}

⚠️ Customer-এর address দেখে zone বুঝো: ঢাকার ভেতরে হলে inside row, বাইরে হলে outside row এর সময় বলো।
⚠️ Product Catalog-এ যে product-এর পাশে "🚚 Home Delivery FREE" লেখা আছে, সেই product-এর delivery charge সবসময় ফ্রি — ঢাকার ভিতরে/বাইরে rate এখানে apply হবে না। এই মার্ক না থাকলে উপরের normal rate অনুযায়ী চার্জ বলবে।`;

    // Effective payment rules. The merchant's real setting lives on the Page
    // record (Settings → paymentMode/advanceAmount/codEnabled); the legacy
    // knowledgeConfig paymentRules (never written by the dashboard, defaults
    // to {}) can only ADD an advance requirement. Previously this section read
    // only knowledgeConfig, so a page set to advance_outside was described to
    // the AI as "ঢাকার বাইরে: COD (advance লাগে না)" — and the bot never asked
    // for the advance.
    const paymentRules = (ctx.paymentRules as any) || {};
    const payMode = (page.paymentMode as string) || 'cod';
    const fullAdvance = payMode === 'full_advance';
    const codOn = page.codEnabled !== false && paymentRules.codEnabled !== false;
    const insideAdvOn = fullAdvance || !!paymentRules.insideDhakaAdvanceEnabled;
    const outsideAdvOn =
      fullAdvance ||
      payMode === 'advance_outside' ||
      !!paymentRules.outsideDhakaAdvanceEnabled;
    const fixedAdv = Number(page.advanceAmount) > 0 ? Number(page.advanceAmount) : 0;
    const insideAmtTxt =
      Number(paymentRules.insideDhakaAdvanceAmount) > 0
        ? `৳${paymentRules.insideDhakaAdvanceAmount}`
        : fixedAdv
          ? `৳${fixedAdv}`
          : ctx.restaurantMode
            ? 'delivery fee-র সমান (দূরত্ব অনুযায়ী)'
            : `delivery fee-র সমান (৳${ctx.deliveryInsideFee})`;
    const outsideAmtTxt =
      Number(paymentRules.outsideDhakaAdvanceAmount) > 0
        ? `৳${paymentRules.outsideDhakaAdvanceAmount}`
        : fixedAdv
          ? `৳${fixedAdv}`
          : ctx.restaurantMode
            ? 'delivery fee-র সমান (দূরত্ব অনুযায়ী)'
            : `delivery fee-র সমান (৳${ctx.deliveryOutsideFee})`;
    const advThreshold = Number(page.advanceThresholdAmount) || 0;

    const codLine = codOn
      ? '✅ Cash on Delivery আছে'
      : '❌ COD নেই — সব order-এ advance দিতে হবে';
    const insideAdv = fullAdvance
      ? '⚠️ ঢাকার ভিতরে: পুরো টাকা (product দাম + delivery fee) advance দিতে হবে'
      : insideAdvOn
        ? `⚠️ ঢাকার ভিতরে: Advance payment লাগবে ${insideAmtTxt}`
        : '✅ ঢাকার ভিতরে: Cash on Delivery (advance লাগে না)';
    const outsideAdv = fullAdvance
      ? '⚠️ ঢাকার বাইরে: পুরো টাকা (product দাম + delivery fee) advance দিতে হবে'
      : outsideAdvOn
        ? `⚠️ ঢাকার বাইরে: Advance payment লাগবে ${outsideAmtTxt} — advance পাওয়ার পরেই order confirm হবে`
        : '✅ ঢাকার বাইরে: Cash on Delivery (advance লাগে না)';
    const thresholdLine =
      advThreshold > 0 && (insideAdvOn || outsideAdvOn)
        ? `ℹ️ Order subtotal ৳${advThreshold} পর্যন্ত হলে advance লাগবে না`
        : '';
    const bkash = page.advanceBkash ? `Bkash (Send Money): ${page.advanceBkash}` : '';
    const nagad = page.advanceNagad ? `Nagad (Send Money): ${page.advanceNagad}` : '';
    const rocket = page.advanceRocket ? `Rocket (Send Money): ${page.advanceRocket}` : '';
    const zoneNote =
      insideAdvOn !== outsideAdvOn
        ? `\n⚠️ Zone বুঝতে ঠিকানার জেলা/এলাকা দেখো — ঠিকানায় শুধু "Dhaka" শব্দ থাকলেই ঢাকার ভিতরে না। "Tangail, Dhaka" মানে ঢাকা বিভাগ — এটা ঢাকার **বাইরে**। ঢাকা শহরের এলাকা (Mirpur, Uttara, Dhanmondi, Gulshan...) থাকলে তবেই ভিতরে।`
        : '';
    const paymentCtx = `\n${[codLine, insideAdv, outsideAdv, thresholdLine, bkash, nagad, rocket]
      .filter(Boolean)
      .join('\n')}${zoneNote}`;

    // V24: Pricing/negotiation policy — page-level, with a per-product
    // override applied when a specific product is currently in context
    // (an item already in the draft, or whatever was last shown/discussed).
    const policyProductCode: string | null =
      (!(draft as any)?.isLead && draft?.items?.[0]?.productCode) ||
      lastPresented?.[0]?.code ||
      null;
    const policyProduct = policyProductCode
      ? ctx.products.find((p) => p.code === policyProductCode)
      : undefined;
    const effectivePolicy = this.botKnowledge.resolveEffectivePricingPolicy(
      ctx.pricingPolicy,
      (policyProduct as any)?.pricingPolicyOverride,
    );
    let floorPrice: number | null = null;
    if (policyProduct && effectivePolicy.minNegotiationType !== 'none') {
      const base = Number(policyProduct.price) || 0;
      floorPrice =
        effectivePolicy.minNegotiationType === 'PERCENT'
          ? Math.round(base * (1 - effectivePolicy.minNegotiationValue / 100))
          : Math.max(0, base - effectivePolicy.minNegotiationValue);
    }
    const pricingPolicyCtx = `\n\n## Pricing Policy${policyProduct ? ` (product [${policyProduct.code}])` : ' (shop-wide)'}
${
  effectivePolicy.priceMode === 'FIXED'
    ? `⛔ Fixed price — negotiation/discount করা যাবে না। দর কষাকষি করলে বলো: "${effectivePolicy.fixedPriceReplyText}"`
    : !effectivePolicy.allowCustomerOffer
      ? `⛔ Customer offer allow করা নেই — negotiation mode হলেও discount দেওয়া যাবে না। বলো: "${effectivePolicy.fixedPriceReplyText}"`
      : `✅ Negotiation চালু। ${floorPrice != null ? `সর্বনিম্ন ৳${floorPrice}-এর নিচে যাওয়া যাবে না — এর কম offer এলে ৳${floorPrice}-এ counter করো।` : 'নির্দিষ্ট floor price সেট নেই — যুক্তিসঙ্গত ছাড় দিতে পারো।'} ${effectivePolicy.agentApprovalRequired ? 'চূড়ান্ত confirm করার আগে জানিয়ে দাও যে agent শেষে confirm করবে।' : 'agent approval ছাড়াই সরাসরি accept করতে পারো।'}`
}`;

    // Business knowledge
    const knowledgeCtx = ctx.knowledgeText
      ? `\n\n## Business Knowledge\n${ctx.knowledgeText}`
      : '';

    const pricingCtx = ctx.pricingInfo
      ? `\n\n## Service Pricing (Auto-Updated)\n${ctx.pricingInfo}`
      : '';

    // Catalog link
    const catalogUrl = this.buildCatalogUrl(page);
    const catalogCtx = `\n\n## Product Catalog Link\n${catalogUrl}\n(Customer ছবি/photo চাইলে বা সব product দেখতে চাইলে এই link দাও)`;

    // Current draft state — EXPLICITLY show collected vs missing
    let draftCtx = '\n\n## Current Order Draft\nকোনো active order নেই।';
    const stillNeeded: string[] = [];

    if (draft) {
      // Lead mode — only name + WhatsApp needed
      if ((draft as any).isLead) {
        const collected: string[] = [];
        if (draft.customerName) collected.push(`✅ নাম: ${draft.customerName}`);
        else stillNeeded.push('নাম');
        if (draft.phone) collected.push(`✅ WhatsApp: ${draft.phone}`);
        else stillNeeded.push('WhatsApp নম্বর');

        draftCtx = `\n\n## Current Lead Draft (Trial/Setup Inquiry)\n${collected.join('\n')}`;
        if (stillNeeded.length > 0) {
          draftCtx += `\n\n⚠️ এখনো পাওয়া যায়নি (ONLY এগুলো চাও): ${stillNeeded.join(', ')}`;
        } else {
          draftCtx += `\n\n✅ সব তথ্য আছে — CONFIRM_LEAD action দাও এবং বলো "আমাদের প্রতিনিধি আপনাকে call করবেন"।`;
        }
      } else {
        // Codes of products with FREE home delivery — so the AI never quotes a
        // delivery charge for a product the shop marked free.
        const freeDeliveryCodes = new Set(
          ctx.products
            .filter((p) => (p as any).deliveryCharge === 'FREE')
            .map((p) => p.code),
        );
        const anyFreeInDraft = draft.items.some((i) =>
          freeDeliveryCodes.has(i.productCode),
        );
        const items =
          draft.items.length > 0
            ? draft.items
                .map(
                  (i) =>
                    `[${i.productCode}] x${i.qty} — ৳${i.unitPrice}${freeDeliveryCodes.has(i.productCode) ? ' (🚚 Home Delivery FREE — কোনো delivery charge নেই)' : ''}`,
                )
                .join(', ')
            : null;

        const collected: string[] = [];
        if (items) collected.push(`✅ Products: ${items}`);
        else stillNeeded.push('product code');
        if (draft.customerName) collected.push(`✅ নাম: ${draft.customerName}`);
        else stillNeeded.push('নাম');
        if (draft.phone) collected.push(`✅ ফোন: ${draft.phone}`);
        else stillNeeded.push('ফোন নম্বর');
        if (draft.address) collected.push(`✅ ঠিকানা: ${draft.address}`);
        else stillNeeded.push('পূর্ণ ঠিকানা');
        if (this.requiresAdvancePayment(draft, page)) {
          if (draft.paymentProof)
            collected.push(`✅ Payment: ${draft.paymentProof}`);
          else stillNeeded.push('advance payment proof');
        }

        draftCtx = `\n\n## Current Order Draft (এখন পর্যন্ত collected)\n${collected.join('\n')}`;
        if (anyFreeInDraft) {
          draftCtx += `\n\n🚚 এই order-এর product-এ Home Delivery FREE — customer "delivery fee/charge কত" জিজ্ঞেস করলে স্পষ্ট বলো "এই product-এ ডেলিভারি একদম ফ্রি 🚚, কোনো চার্জ নেই"। ঢাকার ভিতরে/বাইরে rate কখনো বলবে না।`;
        }
        if (stillNeeded.length > 0) {
          draftCtx += `\n\n⚠️ এখনো পাওয়া যায়নি (ONLY এগুলো চাও): ${stillNeeded.join(', ')}`;
          if (stillNeeded.includes('advance payment proof')) {
            draftCtx += `\n💳 Advance payment বাকি — Delivery & Payment section-এর amount আর Bkash/Nagad নম্বর দিয়ে advance পাঠাতে বলো, তারপর Transaction ID (বা screenshot) চাও। Advance না পেলে order confirm হবে না — এটা customer-কে ভদ্রভাবে জানাও।`;
          }
        } else {
          draftCtx += `\n\n✅ সব তথ্য আছে — customer confirm করলেই order হবে। Customer "হ্যাঁ/confirm/ok" বললে CONFIRM_ORDER action দাও। Customer যদি বলে "order nicchen na keno / order koi / নিচ্ছেন না কেন" — সে অভিযোগ করছে যে order আগাচ্ছে না; তাকে order summary দিয়ে confirm করতে বলো, ভুলেও "cancel করতে চান?" জিজ্ঞেস করবে না।`;
        }
      }
    }

    // Last placed order tracking context
    let orderTrackCtx = '';
    if (lastOrder) {
      const statusMap: Record<string, string> = {
        RECEIVED: '✅ অর্ডার পাওয়া হয়েছে — প্রক্রিয়া চলছে',
        CONFIRMED: '✅ অর্ডার কনফার্ম হয়েছে — প্রস্তুত হচ্ছে',
        PACKED: '📦 অর্ডার প্যাক হয়ে গেছে — শীঘ্রই কুরিয়ারে যাবে',
        SHIPPED: '🚚 কুরিয়ারে পাঠানো হয়েছে — পথে আছে',
        DELIVERED: '✅ ডেলিভারি সম্পন্ন হয়েছে',
        CANCELLED: '❌ অর্ডারটি বাতিল হয়েছে',
      };
      const statusBn = statusMap[lastOrder.status] ?? lastOrder.status;
      const products = lastOrder.items
        .map((i: any) => `${i.productCode} x${i.qty}`)
        .join(', ');
      const date = new Date(lastOrder.createdAt).toLocaleDateString('bn-BD');
      orderTrackCtx = `\n\n## Customer-এর সর্বশেষ Order (DB থেকে)\nOrder #${lastOrder.id} — ${date}\nProducts: ${products || '?'}\nStatus: **${statusBn}**\n\n⚠️ এই status **শুধু তখনই** বলবে যখন customer সরাসরি "কবে পাবো / কোথায় আছে / status / order কী হলো" জিজ্ঞেস করে। Customer শুধু "ok / আচ্ছা / ধন্যবাদ / thik ache" বললে status বলবে না — ছোট্ট একটা আন্তরিক reply দাও (যেমন "ধন্যবাদ 😊")। অনুমান করবে না।`;
    }

    // Specific Order ID lookup context
    let orderByIdCtx = '';
    if (orderById) {
      const smMap: Record<string, string> = {
        RECEIVED: '✅ অর্ডার পাওয়া হয়েছে — প্রক্রিয়া চলছে',
        CONFIRMED: '✅ অর্ডার কনফার্ম হয়েছে — প্রস্তুত হচ্ছে',
        PACKED: '📦 অর্ডার প্যাক হয়ে গেছে — শীঘ্রই কুরিয়ারে যাবে',
        SHIPPED: '🚚 কুরিয়ারে পাঠানো হয়েছে — পথে আছে',
        DELIVERED: '🎉 ডেলিভারি সম্পন্ন হয়েছে',
        CANCELLED: '❌ অর্ডারটি বাতিল হয়েছে',
        ISSUE: '⚠️ অর্ডারে সমস্যা আছে',
      };
      const snBn = smMap[orderById.status] ?? orderById.status;
      const snProds = orderById.items.map((i: any) => `${i.productCode} x${i.qty}`).join(', ');
      const snDate = new Date(orderById.createdAt).toLocaleDateString('bn-BD');
      orderByIdCtx = `\n\n## Order ID দিয়ে খোঁজা Order (DB থেকে)\nOrder #${orderById.id} — ${snDate}\nProducts: ${snProds || '?'}\nStatus: **${snBn}**\n\n⚠️ Customer এই specific Order ID টি পাঠিয়েছে। উপরের status দেখে CHAT action দিয়ে reply করো।`;
    } else if (queriedOrderId) {
      orderByIdCtx = `\n\n## Order ID খোঁজার ফলাফল\nএই page-এ Order #${queriedOrderId} পাওয়া যায়নি। Customer-কে জানাও।`;
    }


    // Returning-customer context (from CRM) — greet known customers by name
    let customerCtx = '';
    if (crmCustomer && (crmCustomer.name || (crmCustomer.totalOrders ?? 0) > 0)) {
      const bits: string[] = [];
      if (crmCustomer.name) bits.push(`নাম: ${crmCustomer.name}`);
      if ((crmCustomer.totalOrders ?? 0) > 0)
        bits.push(`আগে ${crmCustomer.totalOrders} বার order দিয়েছে (পুরনো/চেনা customer)`);
      // Plain data only — addressing behaviour is in the task rules, so the weak
      // model does not echo an inline example back to the customer.
      customerCtx = `\n\n## এই Customer (CRM থেকে চেনা)\n${bits.join(' | ')}\nইনি আগে থেকেই চেনা — নতুন করে নাম জিজ্ঞেস করবে না, order নিলে CRM-এর জানা তথ্য কাজে লাগাও।`;
    }

    // Customer's name (Facebook, when we don't already have a CRM name). Kept as
    // plain DATA only — the "how to use it" lives in the task rules — because the
    // weak model would otherwise echo an inline instruction verbatim to the
    // customer ("এখানে প্রিয় (নাম) দিয়েন")।
    let greetingCtx = '';
    if (greetName && !(crmCustomer && crmCustomer.name)) {
      greetingCtx = `\n\n## Customer পরিচিতি\nCustomer-এর নাম: ${greetName} (Facebook profile)।`;
    }

    // Products the customer just saw / is asking about (post reply, shown card)
    let lastPresentedCtx = '';
    if (lastPresented && lastPresented.length > 0) {
      const lines = lastPresented
        .map((p) => `[${p.code}] ${p.name ?? p.code} — ৳${p.price}`)
        .join('\n');
      lastPresentedCtx = `\n\n## Customer এইমাত্র যে product নিয়ে কথা বলছে (post-এ reply বা দেখানো card)\n${lines}\n⚠️ Customer "price / দাম কত / এটা / এটার দাম / নিবো / এই product-টা" বললে এই product-ই বোঝাচ্ছে — সরাসরি এটার দাম/তথ্য দাও, "কোন product?" জিজ্ঞেস করবে না।`;
    }

    // Task rules
    const taskRules = `\n\n## তোমার কাজ
Customer-এর message দেখে **strictly valid JSON** return করো:

{
  "reply": "<Bangla/Banglish natural reply>",
  "action": "<CHAT|COLLECT|CONFIRM_ORDER|CANCEL_ORDER|AGENT|CAPTURE_LEAD|CONFIRM_LEAD|SHOW_CATALOG>",
  "collected": {
    "productCodes": [],
    "qty": {},
    "customerName": null,
    "phone": null,
    "address": null,
    "paymentProof": null
  },
  "calculatePricing": null
}

### calculatePricing (optional — only if Business Knowledge instructs a pricing/volume calculation):
- Leave null unless the Business Knowledge section explicitly tells you to ask for message volume and calculate cost.
- Once you have all three numbers from the customer, set: { "customersPerDay": number, "msgsPerCustomer": number, "imagesPerCustomer": number }. When you set this field, keep "reply" to a short one-line lead-in only (e.g. "ধন্যবাদ! আপনার হিসাব রেডি —") — don't write your own numbers or assumptions, the exact ৳ estimate is computed by our system and appended separately.

### Action:
- CHAT — FAQ, product info, greetings
- COLLECT — customer নতুন order info দিয়েছে
- CONFIRM_ORDER — customer "হ্যাঁ/confirm/ঠিক আছে" বলেছে
- CANCEL_ORDER — customer "lagbe na/cancel/বাতিল" বলেছে
- AGENT — complaint/payment issue → human agent দরকার
- CAPTURE_LEAD — customer free trial / service নিতে আগ্রহী → নাম + WhatsApp নম্বর collect করো
- CONFIRM_LEAD — নাম ও WhatsApp দুটোই পাওয়া গেছে → বলো "আমাদের প্রতিনিধি শীঘ্রই আপনাকে WhatsApp-এ call করবেন 🎉"
- SHOW_CATALOG — customer সব product / ছবি / catalog / collection দেখতে চাইছে ("ki ki ache", "সব দেখাও", "catalog", "photo dao", "collection দেখান") → product card পাঠানো হবে। reply-তে শুধু ছোট এক লাইন lead-in দাও (যেমন "এই যে আমাদের collection 😊"), card গুলো system পাঠাবে।

### CRITICAL RULES:
1. "⚠️ এখনো পাওয়া যায়নি" list দেখো — শুধু সেই fields চাও। ✅ collected fields আর কখনো চাইবে না।
2. collected-এ শুধু এই message-এ নতুন পাওয়া তথ্য রাখো। আগে ✅ collected fields: null দাও।
3. Phone: 01XXXXXXXXX বা +8801XXXXXXXXX দুটোই valid — COLLECT করো।
4. Customer একসাথে নাম+ফোন+ঠিকানা দিলে সব একসাথে collect করো — এমনকি address সংক্ষেপে লেখা হলেও (যেমন: "Mirpur 2,Dhaka" বা "Mirpur2,Dhaka" — কমা দিয়ে বা ছাড়া, স্পেস দিয়ে বা ছাড়া) সেটাকে ঠিকানা হিসেবেই ধরো, আবার ঠিকানা চেয়ো না।
5. reply-এ order summary সহ confirm চাইতে পারো যখন সব ✅ হয়ে যায়।
6. **Photo/ছবি চাইলে**: SHOW_CATALOG action দাও (ছবিসহ product card চলে যাবে) — reply-তে ছোট lead-in দাও (যেমন "এই যে ছবিসহ আমাদের product গুলো 😊")।
7. **"ki ki ache / সব দেখাও / catalog / collection" চাইলে**: SHOW_CATALOG action দাও — reply-তে ছোট lead-in, card system পাঠাবে।
8. **Advance payment**: Customer-এর ঠিকানা দেখে ঢাকার ভিতরে/বাইরে বুঝো, তারপর সেই zone-এর payment rule দেখো। ঢাকার ভিতরে COD হলে advance চাইবে না। Order confirm করার আগে আগে ঠিকানা collect করো। ⚠️ ঠিকানায় "Dhaka" শব্দ থাকলেই ঢাকার ভিতরে ধরবে না — জেলা দেখো (যেমন "Tangail, Dhaka" = টাঙ্গাইল জেলা, ঢাকা বিভাগ = ঢাকার **বাইরে**)। Draft-এর "এখনো পাওয়া যায়নি" list-এ "advance payment proof" থাকলে বুঝবে system হিসাব করে দেখেছে advance লাগবে — তখন advance চাও। Customer advance পাঠিয়ে Transaction ID/নম্বর দিলে সেটা paymentProof হিসেবে COLLECT করো।
9. **Order already confirmed / "ok" বললে**: order নেওয়া হয়ে গেলে বা draft confirm হয়ে গেলে customer "ok / আচ্ছা / ধন্যবাদ / received / thik ache" বললে — শুধু একটা ছোট্ট আন্তরিক reply দাও (যেমন "ধন্যবাদ ভাই 😊" বা "স্বাগতম 💖"), CHAT action দাও। আর order confirm করো না, order status/"প্যাক করা হবে/কনফার্ম হয়েছে" এসব আবার বলবে না — customer জিজ্ঞেস করলে তবেই status বলবে।
10. **Delivery সময় ও fee**: Customer "কবে পাবো / delivery কতদিন / কত তাড়াতাড়ি / koto din" জিজ্ঞেস করলে **শুধু** "Delivery সময়:" লাইন দেখো — সেটা যদি ফাঁকা হয়, বলো "আমাদের সাথে সরাসরি জানতে চাইলে এখানে message করুন, টিম জানিয়ে দেবে 😊"। কখনো delivery FEE (৳80/৳120) দিয়ে delivery TIME-এর প্রশ্নের উত্তর দেবে না। Fee শুধু তখন বলবে যখন customer সরাসরি "delivery charge কত / কত টাকা লাগবে" জিজ্ঞেস করে। ⚠️ Fee বলার আগে দেখো — যে product নিয়ে কথা হচ্ছে বা order-এ আছে তার পাশে Product Catalog-এ "🚚 Home Delivery FREE" লেখা থাকলে বলো "এই product-এ ডেলিভারি একদম ফ্রি 🚚, কোনো চার্জ নেই" — ঢাকার ভিতরে/বাইরে কোনো rate বলবে না। শুধু যেসব product-এ FREE mark নেই সেগুলোর জন্যই normal rate বলবে।
11. **Order status**: Customer "কবে পাবো / parsel kobe pabo / order কোথায় / status কী / কি হলো" জিজ্ঞেস করলে "## Customer-এর সর্বশেষ Order (DB থেকে)" section দেখো এবং নিচের নিয়মে reply করো:
- RECEIVED → "আপনার অর্ডার পাওয়া গেছে, প্রসেস হচ্ছে 📝"
- CONFIRMED → "অর্ডার কনফার্ম হয়েছে, প্যাক করা হবে শীঘ্রই ✅"
- PACKED → "আপনার পণ্য প্যাক করা হয়েছে 📦, কুরিয়ারে দেওয়া হবে শীঘ্রই"
- SHIPPED → "আপনার পণ্য কুরিয়ারে দেওয়া হয়েছে 🚚, রাস্তায় আছে"
- DELIVERED → "আপনার পণ্য ডেলিভারি হয়ে গেছে ✅"
- CANCELLED → "দুঃখিত, অর্ডারটি বাতিল হয়েছে ❌"
status reply-এর পরে, যদি "Delivery সময়:" সেটিং ফাঁকা না হয়, তাহলে সেটা যোগ করো: "সাধারণত [Delivery সময় value] এর মধ্যে পৌঁছে যায়।" — DB status না থাকলে বলো "এই moment এ আপনার কোনো active order পাচ্ছি না।"
12. **Lead capture**: Customer "trial নিতে চাই / setup করতে চাই / দাম কত / কীভাবে শুরু করব / interested / example দাও / demo দেখাও / কীভাবে কাজ করে / ki ki korte paro / example daw / demo দাও / বুঝিয়ে দাও / শুরু করতে চাই" ইত্যাদি বললে CAPTURE_LEAD action দাও। শুধু নাম এবং WhatsApp নম্বর collect করো — address বা product code চাইবে না।
13. **Lead confirm**: Lead draft এ নাম ও WhatsApp দুটোই ✅ হলে CONFIRM_LEAD action দাও এবং বলো "আমাদের প্রতিনিধি শীঘ্রই আপনার WhatsApp-এ যোগাযোগ করবেন। ধন্যবাদ! 🎉"
14. **"কীভাবে যোগাযোগ করব?" / "Kmne jogajog korbo?"**: Customer ইতিমধ্যে এই page-এ message করেই যোগাযোগ করছে। বলো: "এই page-এ message করেই কথা বলতে পারেন, আমরা সবসময় reply দিচ্ছি 😊 কোনো প্রশ্ন থাকলে বলুন।"
15. **Short replies ("Na", "Aca", "Ok", "Hmm")**: Context বুঝে natural reply করো। কোনো active draft না থাকলে এবং customer শুধু acknowledge করছে — CHAT action দিয়ে simple friendly reply করো। কখনো "আমাদের সাথে যোগাযোগ করুন" বলবে না — customer ইতিমধ্যে message করছেই।
16. **নাম চাওয়ার পর confirmation word পেলে**: তুমি নামটা চাওয়ার পর customer যদি "ji/hae/হ্যাঁ/ok/thik ache/nibo/lagbe" এই ধরনের শুধু হ্যাঁ-বোধক শব্দ দেয় (আসল নাম না দিয়ে), সেটাকে customerName হিসেবে collect **করবে না** — এটা শুধু "হ্যাঁ, নিতে চাই" বোঝাচ্ছে, নাম না। reply-তে আবার স্পষ্ট করে নামটা চাও (যেমন: "ঠিক আছে 😊 এখন আপনার নামটা বলুন")।
17. **তুমি/আপনি (সম্বোধন)**: Customer যেভাবে সম্বোধন করে ঠিক সেভাবেই reply করো — "tumi/tui" দিলে informal, "apni" দিলে formal। Customer "আমাকে আপনি বলবেন না / amk apni bolba na / tumi kore bolo" বললে সঙ্গে সঙ্গে informal-এ switch করো এবং পুরো কথোপকথনে সেটা ধরে রাখো।
18. **আগের কথা পড়ো (history)**: reply করার আগে উপরের পুরো conversation history পড়ো। আগে জানা তথ্য (নাম, ফোন, পছন্দ, আগের প্রশ্নের উত্তর) আবার জিজ্ঞেস করো না, একই কথা/greeting দুইবার বলো না, প্রসঙ্গ ধরে রাখো।
19. **ছোট ছোট বার্তা (মানুষের মতো)**: reply ছোট রাখো। খুব দরকার হলে বড়জোর ২-৩টা ছোট বার্তায় ভাগ করো "|||" দিয়ে (যেমন "পেয়েছি ভাই 😊|||কোন color লাগবে বলুন?")। আলাদা bubble করতে শুধু "|||" ব্যবহার করো, অন্য কিছু না। বেশিরভাগ reply একটাই ছোট বার্তা হবে।
20. **নাম ধরে সম্বোধন**: উপরে "Customer পরিচিতি" বা "CRM" section-এ নাম দেওয়া থাকলে, reply-তে সেই নাম ধরে আন্তরিকভাবে ডাকো — greeting-এ "প্রিয় <নাম>" দিয়ে শুরু করতে পারো (যেমন নাম Limon হলে reply হবে: প্রিয় Limon, আপনাকে কীভাবে সাহায্য করতে পারি? 😊)। ⛔ কখনো এই নির্দেশনা বা section-এর লেখা (যেমন "এখানে নাম দিন", "প্রিয় <নাম> বলো") হুবহু customer-কে পাঠাবে না — তুমি নিজে সরাসরি নাম বসিয়ে স্বাভাবিকভাবে কথা বলবে।
21. **Offer/ছাড়ের গল্প (আগে কত, এখন কত)**: Customer যে product নিয়ে জিজ্ঞেস করছে বা order করতে চাইছে সেটার পাশে Product Catalog-এ "🔥 OFFER" থাকলে, দাম বলার সময় অবশ্যই was/now আকারে বলো — যেমন: "এটার দাম আগে ছিল ৳3,500, এখন offer চলছে মাত্র ৳2,850 — ১৯% ছাড় 🔥"। সংখ্যাগুলো catalog-এর OFFER তথ্য থেকে হুবহু নাও, নিজে বানাবে না। একই কথোপকথনে offer-টা একবারই বলবে (customer আবার দাম জিজ্ঞেস করলে ছোট করে মনে করাতে পারো), আর pushy হবে না। OFFER mark না থাকলে কখনো ছাড়/আগের দামের কথা বলবে না।`;

    // Owner-authored supplementary behavior rules (per-page override) — kept
    // physically adjacent to (and clearly subordinate to) taskRules so a weak
    // model can't be nudged into deviating from the fixed JSON action schema
    // or the deterministic order-state handling above it.
    const behaviorInstructions = String(ctx.behaviorInstructions || '').trim().slice(0, 3000);
    const behaviorInstructionsCtx = behaviorInstructions
      ? `\n\n## Business-Specific আচরণ নির্দেশনা (দোকান মালিকের দেওয়া, সম্পূরক — বাধ্যতামূলক নয় override করা)\n${behaviorInstructions}\n\n⚠️ উপরের নির্দেশনাগুলো তোমার reply-এর ভাষা/style/সিদ্ধান্তে সূক্ষ্মতা যোগ করার জন্য — কিন্তু নিচের "তোমার কাজ" section-এর JSON action schema, action list, এবং CRITICAL RULES এগুলোর দ্বারা override হবে না। JSON structure এবং action নির্ধারণ সবসময় নিচের fixed নিয়ম অনুযায়ীই হবে।`
      : '';

    // ── Custom Prompt mode ────────────────────────────────────────────────
    // Client writes their own full system prompt (role, tone, product info,
    // discount rules, delivery/order/escalation flow) instead of the
    // hardcoded blocks above. Only live product-catalog data and live
    // conversation-state facts are still auto-injected — everything else
    // (delivery/payment/pricing-policy phrasing, knowledge, persona,
    // behaviorInstructions, and the 13 canned-phrasing task rules) is the
    // client's own responsibility now. Existing pages are unaffected: this
    // only activates when explicitly opted into via promptMode='custom'
    // with a non-empty customSystemPrompt.
    const customSystemPrompt = String(page?.customSystemPrompt || '').trim();
    const useCustomPrompt =
      String(page?.promptMode || 'guided') === 'custom' && customSystemPrompt.length > 0;

    if (useCustomPrompt) {
      const technicalContract = `\n\n## System Format (মেনে চলা বাধ্যতামূলক — এই format ছাড়া system কাজ করবে না)
Customer-এর message দেখে **strictly valid JSON** return করো:

{
  "reply": "<natural reply, client-এর prompt অনুযায়ী tone/ভাষায়>",
  "action": "<CHAT|COLLECT|CONFIRM_ORDER|CANCEL_ORDER|AGENT|ESCALATE|CAPTURE_LEAD|CONFIRM_LEAD|SHOW_CATALOG|SHOW_PRODUCT_IMAGE>",
  "collected": {
    "productCodes": [],
    "qty": {},
    "customerName": null,
    "phone": null,
    "address": null,
    "paymentProof": null
  },
  "calculatePricing": null
}

### Action:
- CHAT — সাধারণ কথা/তথ্য
- COLLECT — customer order-এর তথ্য দিয়েছে (নাম/ফোন/ঠিকানা/color/qty)
- CONFIRM_ORDER — customer order confirm করেছে
- CANCEL_ORDER — customer order বাতিল করতে চায়
- AGENT — human agent-এর দরকার, conversation চলতে থাকবে
- ESCALATE — client-এর prompt অনুযায়ী escalation দরকার (যেমন complaint/refund) — এরপর conversation বন্ধ হয়ে যাবে, admin জানানো হবে
- CAPTURE_LEAD — নাম + WhatsApp নম্বর collect করার দরকার
- CONFIRM_LEAD — নাম ও WhatsApp দুটোই পাওয়া গেছে
- SHOW_CATALOG — পুরো product list/catalog দেখানোর দরকার (card system পাঠাবে, reply-তে ছোট lead-in দাও)
- SHOW_PRODUCT_IMAGE — একটা নির্দিষ্ট product-এর ছবি দেখানোর দরকার — "collected.productCodes"-এ ঠিক সেই product-এর code দাও (নিচের Product Catalog থেকে), ছবির URL নিজে বানাবে/লিখবে না, system পাঠাবে

### বাধ্যতামূলক নিয়ম:
1. collected-এ শুধু এই message-এ নতুন পাওয়া তথ্য রাখো, আগে ✅ হওয়া field আবার চাইবে না।
2. reply ছোট রাখো, দরকার হলে বড়জোর ২-৩টা ছোট বার্তায় "|||" দিয়ে ভাগ করো (অন্য কোনো split marker না)।
3. reply plain text — কখনো তুমি AI/bot তা বলবে না, system/tool-এর কথা বলবে না।`;

      return `${customSystemPrompt}
${productCtx}${customerCtx}${greetingCtx}${lastPresentedCtx}${draftCtx}${orderTrackCtx}${orderByIdCtx}${technicalContract}`;
    }

    const customPersona = String(page?.customPersonaPrompt || '').trim();
    const intro = customPersona
      ? customPersona.replace(/\{\{\s*shop\s*\}\}/g, shop)
      : agentBehavior.personaPrompt
        ? agentBehavior.personaPrompt.replace(/\{\{\s*shop\s*\}\}/g, shop)
        : defaultSmartBotIntro(shop);
    const toneBlock = agentBehavior.toneRules
      ? `\n\n${agentBehavior.toneRules}`
      : DEFAULT_SMART_BOT_TONE_BLOCK;

    return `${intro}${toneBlock}
${deliveryCtx}${paymentCtx}${productCtx}${pricingPolicyCtx}${knowledgeCtx}${pricingCtx}${catalogCtx}${customerCtx}${greetingCtx}${lastPresentedCtx}${draftCtx}${orderTrackCtx}${orderByIdCtx}${behaviorInstructionsCtx}${taskRules}`;
  }

  // Admin-panel-configurable order in which providers are tried (Settings →
  // API Keys → AI Provider Priority). Falls back to the historical
  // Gemini → OpenAI → OpenRouter order when nothing is configured, and any
  // provider missing from a saved (older/partial) list is appended at the end
  // so a newly-added provider is never silently dropped.
  private getProviderPriority(): Array<'gemini' | 'openai' | 'openrouter'> {
    const DEFAULT: Array<'gemini' | 'openai' | 'openrouter'> = [
      'gemini',
      'openai',
      'openrouter',
    ];
    const raw = this.apiKeys.getSync('aiProviderPriority');
    if (!raw) return DEFAULT;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const valid = parsed.filter((p): p is 'gemini' | 'openai' | 'openrouter' =>
          DEFAULT.includes(p),
        );
        const missing = DEFAULT.filter((p) => !valid.includes(p));
        return [...valid, ...missing];
      }
    } catch {}
    return DEFAULT;
  }

  // Returns the fully-validated response, not just raw text — a provider can
  // return HTTP 200 with a real reply that still isn't valid JSON (a model
  // just chatting in plain text instead of following the schema). That must
  // count as a failure of THIS provider and fall through to the next one
  // (e.g. OpenRouter), not silently end the whole turn — otherwise a
  // healthy-but-noncompliant provider looks identical to "AI unavailable"
  // from the customer's side.
  private async callOpenAI(
    messages: { role: string; content: string }[],
    usage: AiCallUsage = {},
  ): Promise<SmartBotResponse | null> {
    for (const provider of this.getProviderPriority()) {
      if (provider === 'gemini') {
        // Try Gemini keys in rotation until one works or all exhausted. Only
        // ONE malformed-JSON attempt per key — with a single key, retrying
        // the SAME key on invalid output (no cooldown applies, since the API
        // call itself succeeded) would spin forever, so move on to the next
        // provider instead of looping again.
        while (this.geminiRotator.isAvailable()) {
          const key = this.geminiRotator.getKey();
          if (!key) break;
          const result = await this.callGeminiWithKey(key, messages, usage);
          if (
            result === 'QUOTA_EXCEEDED' ||
            result === 'SERVER_ERROR' ||
            result === 'DISABLED' ||
            result === null
          ) {
            continue; // try next key
          }
          const parsed = this.parseResponse(result);
          if (parsed) return parsed;
          this.logger.warn('[SmartBot] Gemini returned non-JSON reply — trying next provider');
          break; // don't hammer the same key forever on malformed output
        }
      } else if (provider === 'openai' && this.openAiKey) {
        this.logger.warn('[SmartBot] Trying OpenAI');
        const result = await this.callOpenAIApi(messages, usage);
        const parsed = result ? this.parseResponse(result) : null;
        if (parsed) return parsed;
      } else if (provider === 'openrouter') {
        const openRouterKey = this.apiKeys.getSync('openrouterApiKey');
        if (openRouterKey) {
          this.logger.warn('[SmartBot] Trying OpenRouter');
          const result = await this.callOpenRouterApi(openRouterKey, messages, usage);
          const parsed = result ? this.parseResponse(result) : null;
          if (parsed) return parsed;
        }
      }
    }
    this.enterCooldown();
    return null;
  }

  private async callGeminiWithKey(
    geminiKey: string,
    messages: { role: string; content: string }[],
    usage: AiCallUsage = {},
  ): Promise<string | null | 'QUOTA_EXCEEDED' | 'SERVER_ERROR' | 'DISABLED'> {
    const start = Date.now();
    try {
      const systemMsg = messages.find((m) => m.role === 'system');
      const rest = messages.filter((m) => m.role !== 'system');

      const contents = rest.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      const body: any = {
        contents,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 500,
          responseMimeType: 'application/json',
        },
      };
      if (systemMsg) {
        body.systemInstruction = { parts: [{ text: systemMsg.content }] };
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${geminiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });

      const latency = Date.now() - start;

      if (res.status === 429 || res.status === 402) {
        this.logger.warn(`[SmartBot] Gemini key ...${geminiKey.slice(-6)} quota/limit (${res.status})`);
        this.geminiRotator.markError(geminiKey, res.status);
        return 'QUOTA_EXCEEDED';
      }
      if (res.status === 500 || res.status === 503 || res.status === 504) {
        this.logger.warn(`[SmartBot] Gemini key ...${geminiKey.slice(-6)} server error (${res.status})`);
        this.geminiRotator.markError(geminiKey, res.status);
        return 'SERVER_ERROR';
      }
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        const errText = await res.text();
        this.logger.error(`[SmartBot] Gemini key ...${geminiKey.slice(-6)} invalid/permission error (${res.status}): ${errText}`);
        this.geminiRotator.markError(geminiKey, res.status, errText);
        return 'DISABLED';
      }
      if (!res.ok) {
        const errText = await res.text();
        this.logger.error(`[SmartBot] Gemini error ${res.status}: ${errText.slice(0, 200)}`);
        this.geminiRotator.markError(geminiKey, res.status, errText);
        this.recordFailure();
        return null;
      }

      const data = await res.json();
      this.geminiRotator.markSuccess(geminiKey, latency);
      usage.provider = 'gemini';
      usage.model = this.model;
      usage.promptTokens = data?.usageMetadata?.promptTokenCount ?? 0;
      usage.outputTokens = data?.usageMetadata?.candidatesTokenCount ?? 0;
      return (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim() || null;
    } catch (err: any) {
      this.logger.warn(`[SmartBot] Gemini network error: ${err?.message ?? err}`);
      this.geminiRotator.markError(geminiKey, 500, err?.message ?? String(err));
      this.recordFailure();
      return null;
    }
  }

  private async callOpenAIApi(
    messages: { role: string; content: string }[],
    usage: AiCallUsage = {},
  ): Promise<string | null> {
    try {
      const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.openAiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.3,
          max_tokens: 500,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (res.status === 429 || res.status === 402) {
        this.logger.warn(`[SmartBot] OpenAI quota/limit (${res.status})`);
        this.enterCooldown();
        return null;
      }
      if (!res.ok) {
        const errText = await res.text();
        this.logger.error(`[SmartBot] OpenAI error ${res.status}: ${errText.slice(0, 200)}`);
        this.recordFailure();
        return null;
      }

      const data = await res.json();
      this.logger.log('[SmartBot] OpenAI fallback used successfully');
      usage.provider = 'openai';
      usage.model = model;
      usage.promptTokens = data?.usage?.prompt_tokens ?? 0;
      usage.outputTokens = data?.usage?.completion_tokens ?? 0;
      return (data?.choices?.[0]?.message?.content ?? '').trim() || null;
    } catch (err: any) {
      this.logger.warn(`[SmartBot] OpenAI network error: ${err?.message ?? err}`);
      this.recordFailure();
      return null;
    }
  }

  private async callOpenRouterApi(
    apiKey: string,
    messages: { role: string; content: string }[],
    usage: AiCallUsage = {},
  ): Promise<string | null> {
    try {
      const model = this.apiKeys.getSync('openrouterModel') || 'openai/gpt-4o-mini';
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://flamboyai.com',
          'X-Title': 'FlamboyAI',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.3,
          max_tokens: 500,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (res.status === 429 || res.status === 402) {
        this.logger.warn(`[SmartBot] OpenRouter quota/limit (${res.status})`);
        return null;
      }
      if (!res.ok) {
        const errText = await res.text();
        this.logger.error(`[SmartBot] OpenRouter error ${res.status}: ${errText.slice(0, 200)}`);
        this.recordFailure();
        return null;
      }

      const data = await res.json();
      this.logger.log('[SmartBot] OpenRouter fallback used successfully');
      usage.provider = 'openrouter';
      usage.model = model;
      usage.promptTokens = data?.usage?.prompt_tokens ?? 0;
      usage.outputTokens = data?.usage?.completion_tokens ?? 0;
      return (data?.choices?.[0]?.message?.content ?? '').trim() || null;
    } catch (err: any) {
      this.logger.warn(`[SmartBot] OpenRouter network error: ${err?.message ?? err}`);
      this.recordFailure();
      return null;
    }
  }

  private parseResponse(raw: string): SmartBotResponse | null {
    try {
      const parsed = JSON.parse(raw);
      const reply = String(parsed?.reply ?? '').trim();
      const action = String(parsed?.action ?? '')
        .toUpperCase()
        .trim();
      if (!reply || !VALID_ACTIONS.has(action)) {
        this.logger.warn(
          `[SmartBot] Invalid response: action="${action}" reply="${reply.slice(0, 60)}" raw="${raw.slice(0, 300)}"`,
        );
        return null;
      }
      const c = parsed?.collected ?? {};
      const cp = parsed?.calculatePricing;
      const calculatePricing: PricingCalcInput | null =
        cp &&
        typeof cp === 'object' &&
        Number(cp.customersPerDay) > 0 &&
        Number(cp.msgsPerCustomer) > 0 &&
        Number(cp.imagesPerCustomer) >= 0
          ? {
              customersPerDay: Number(cp.customersPerDay),
              msgsPerCustomer: Number(cp.msgsPerCustomer),
              imagesPerCustomer: Number(cp.imagesPerCustomer),
            }
          : null;
      return {
        reply,
        action: action as SmartBotResponse['action'],
        calculatePricing,
        collected: {
          productCodes: Array.isArray(c.productCodes)
            ? c.productCodes.filter((x: any) => typeof x === 'string')
            : [],
          qty: c.qty && typeof c.qty === 'object' ? c.qty : {},
          customerName:
            typeof c.customerName === 'string' && c.customerName.trim()
              ? c.customerName.trim()
              : null,
          phone:
            typeof c.phone === 'string' && c.phone.trim()
              ? c.phone.trim()
              : null,
          address:
            typeof c.address === 'string' && c.address.trim()
              ? c.address.trim()
              : null,
          paymentProof:
            typeof c.paymentProof === 'string' && c.paymentProof.trim()
              ? c.paymentProof.trim()
              : null,
        },
      };
    } catch (err: any) {
      this.logger.warn(`[SmartBot] JSON parse failed: ${raw.slice(0, 80)}`);
      this.recordFailure();
      return null;
    }
  }

  async mergeAndSave(
    pageId: number,
    psid: string,
    draft: DraftSession | null,
    collected: SmartBotCollected,
    ctx: BusinessContext,
    page: any = null,
  ): Promise<DraftSession | null> {
    const codes = collected.productCodes ?? [];
    const hasNewProducts = codes.length > 0;
    const hasNewInfo = !!(
      collected.customerName ||
      collected.phone ||
      collected.address ||
      collected.paymentProof
    );

    // Always work with an existing or fresh draft if we have anything to do
    if (!hasNewProducts && !hasNewInfo && !draft) return null;

    const base: DraftSession = draft ?? this.ctx.emptyDraft();

    // CRM pre-fill only when starting a brand new draft with a product
    if (!draft && hasNewProducts) {
      try {
        const crm = await this.prisma.customer.findUnique({
          where: { pageId_psid: { pageId, psid } },
          select: { name: true, phone: true, address: true },
        });
        if (crm?.name) base.customerName = crm.name;
        if (crm?.phone) base.phone = crm.phone;
        if (crm?.address) base.address = crm.address;
      } catch {
        /* ignore */
      }
    }

    // Merge products
    if (hasNewProducts) {
      const priceMap = new Map(ctx.products.map((p) => [p.code, p.price]));
      for (const code of codes) {
        if (!priceMap.has(code)) continue;
        const qty = (collected.qty ?? {})[code] ?? 1;
        const existing = base.items.find((i) => i.productCode === code);
        if (existing) existing.qty = qty;
        else
          base.items.push({
            productCode: code,
            qty,
            unitPrice: priceMap.get(code) ?? 0,
          });
      }
    }

    // Merge contact info — never overwrite with null
    if (collected.customerName) base.customerName = collected.customerName;
    if (collected.phone) base.phone = collected.phone;
    if (collected.address) base.address = collected.address;
    if (collected.paymentProof) base.paymentProof = collected.paymentProof;

    // Determine currentStep based on what's still missing
    if (!base.customerName) base.currentStep = 'name';
    else if (!base.phone) base.currentStep = 'phone';
    else if (!base.address) base.currentStep = 'address';
    // V29: AI-visible order fields — queued once; while a cf:* step is
    // pending the webhook routes replies to the deterministic handler.
    else if (base.currentStep?.startsWith('cf:') && base.pendingCustomFields?.length)
      base.currentStep = `cf:${base.pendingCustomFields[0].label}`;
    else if (queueAiOrderFields(base, page)) {
      /* currentStep now points at the first order field */
    } else if (this.requiresAdvancePayment(base, page) && !base.paymentProof)
      base.currentStep = 'advance_payment';
    else base.currentStep = 'confirm';

    // FIX: save whenever we have any collected info, not just when items exist
    const hasAnything =
      base.items.length > 0 ||
      base.customerName ||
      base.phone ||
      base.address ||
      base.paymentProof;
    if (hasAnything) {
      await this.ctx.saveDraft(pageId, psid, base);
      return base;
    }
    return null;
  }

  requiresAdvancePayment(draft: DraftSession, page: any): boolean {
    if (!page) return false;

    // Zone via the same whitelist the keyword pipeline uses. The old regex
    // here matched the bare word "dhaka", so a division-suffixed address like
    // "Ellenga, Tangail, Dhaka" was wrongly treated as inside Dhaka and the
    // advance_outside rule silently skipped.
    const addr = draft?.address || '';
    const insideDhaka = isInsideDhakaAddress(addr, page);

    // Legacy knowledgeConfig-style rules, honoured only when explicitly enabled
    const paymentRules = page.paymentRules;
    if (
      paymentRules &&
      (paymentRules.insideDhakaAdvanceEnabled ||
        paymentRules.outsideDhakaAdvanceEnabled)
    ) {
      if (!addr) return true; // address unknown: assume advance until it says otherwise
      return insideDhaka
        ? !!paymentRules.insideDhakaAdvanceEnabled
        : !!paymentRules.outsideDhakaAdvanceEnabled;
    }

    // COD entirely disabled by merchant → advance always required
    if (page.codEnabled === false) return true;

    const paymentMode = (page.paymentMode as string) || 'cod';
    if (paymentMode === 'cod') return false;

    // Order-value threshold: skip advance when subtotal is at/under the configured amount
    const threshold = Number(page.advanceThresholdAmount) || 0;
    if (threshold > 0) {
      const subtotal = (draft?.items ?? []).reduce(
        (s, i) => s + i.unitPrice * i.qty,
        0,
      );
      if (subtotal <= threshold) return false;
    }

    if (paymentMode === 'full_advance') return true;
    if (paymentMode === 'advance_outside') {
      // Only outside-Dhaka orders need advance in this mode
      if (!addr) return true;
      return !insideDhaka;
    }
    return false;
  }

  private recordFailure(): void {
    this.failCount++;
    if (this.failCount >= this.MAX_FAILS) {
      this.logger.warn(`[SmartBot] ${this.MAX_FAILS} failures — cooldown 5min`);
      this.enterCooldown();
    }
  }

  private enterCooldown(): void {
    this.cooldownUntil = Date.now() + 5 * 60 * 1000;
    this.failCount = 0;
  }
}
