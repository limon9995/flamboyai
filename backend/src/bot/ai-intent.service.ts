import { Injectable, Logger } from '@nestjs/common';
import { GlobalSettingsService } from '../common/global-settings.service';
import { ApiKeysService } from '../common/api-keys.service';
import { WalletService } from '../wallet/wallet.service';
import { BusinessContext } from './bot-context.service';
import { GeminiKeyRotatorService } from '../common/gemini-key-rotator.service';
import { BotKnowledgeService } from '../bot-knowledge/bot-knowledge.service';
import { AgentBehaviorConfig } from '../agents/agent-behavior-config.interface';
import { AiCallUsage, AiUsageService } from '../common/ai-usage.service';
import {
  formatSlabsBn,
  parsePriceVariants,
  variantsSummaryText,
} from '../common/restaurant-delivery';

export interface AiIntentResult {
  intent: string | null; // null = use keyword fallback
  reply: string | null; // AI-generated natural reply (always set when AI succeeds)
}

export interface DraftStepReviewResult {
  action: 'CAPTURE' | 'RETRY' | 'EXIT_DRAFT' | 'CONFIRM' | 'CANCEL' | 'EDIT';
  reply: string | null;
  normalizedValue: string | null;
}

const VALID_INTENTS = new Set([
  'GREETING',
  'ORDER_INTENT',
  'CANCEL',
  'CONFIRM',
  'EDIT_ORDER',
  'NEGOTIATION',
  'SIZE_REQUEST',
  'PHOTO_REQUEST',
  'DELIVERY_TIME',
  'DELIVERY_FEE',
  'FABRIC_TYPE',
  'CATALOG_REQUEST',
  'SOFT_HESITATION',
  'MULTI_CONFIRM',
  'UNKNOWN',
  'DUAL_WEARING',
  'DUAL_HOLDING',
]);

// Intents where AI reply replaces the hardcoded template
// Now includes knowledge-based intents that require business-specific answers
const AI_REPLY_INTENTS = new Set([
  'GREETING',
  'CANCEL',
  'SOFT_HESITATION',
  'NEGOTIATION',
  'UNKNOWN',
  'SIZE_REQUEST', // AI answers from knowledgeText
  'DELIVERY_TIME', // AI uses real deliveryTime from DB
  'DELIVERY_FEE', // AI uses real inside/outside fee from DB
  'FABRIC_TYPE', // AI answers from knowledgeText
  'CATALOG_REQUEST', // AI lists real products from DB
  'PHOTO_REQUEST', // AI explains photo process
  'DUAL_WEARING', // AI describes the dress model is wearing
  'DUAL_HOLDING', // AI describes the dress model is holding
]);

const STEP_LABELS: Record<string, string> = {
  name: 'নাম',
  phone: 'ফোন নম্বর',
  address: 'পুরো ঠিকানা',
  confirm: 'order confirm করতে হ্যাঁ/না বলুন',
  advance_payment: 'advance payment-এর transaction ID বা screenshot',
};

// Verbatim default persona/tone opener — used whenever an agent type has no
// AgentBehaviorConfig.personaPrompt override, so agentType='commerce' pages
// (the vast majority today) see byte-identical prompts to before this config
// layer existed.
function defaultPersonaOpener(shop: string): string {
  return `তুমি ${shop}-এর Facebook Messenger chatbot। Tone: warm, conversational Bangla/Banglish — template-এর মতো না, স্বাভাবিকভাবে কথা বলো। 💖 emoji মাঝে মাঝে।`;
}

@Injectable()
export class AiIntentService {
  private readonly logger = new Logger(AiIntentService.name);
  private readonly apiKey: string;
  private readonly geminiApiKey: string;
  private readonly provider: 'openai' | 'gemini';
  private readonly model: string;
  private readonly ollamaBaseUrl: string;
  private readonly ollamaModel: string;

  private failCount = 0;
  private readonly MAX_FAILS = 5;
  private cooldownUntil = 0;
  private ollamaBusy = false; // true while an Ollama request is in-flight

  constructor(
    private readonly walletService: WalletService,
    private readonly globalSettings: GlobalSettingsService,
    private readonly apiKeysService: ApiKeysService,
    private readonly geminiRotator: GeminiKeyRotatorService,
    private readonly botKnowledge: BotKnowledgeService,
    private readonly aiUsage: AiUsageService,
  ) {
    this.apiKey = apiKeysService.getSync('openaiApiKey');
    this.geminiApiKey = apiKeysService.getSync('geminiApiKey');
    this.ollamaBaseUrl = (
      apiKeysService.getSync('ollamaBaseUrl') || 'http://localhost:11434'
    ).replace(/\/$/, '');
    this.ollamaModel = apiKeysService.getSync('ollamaChatModel') || 'qwen2:1.5b';

    const providerEnv = (apiKeysService.getSync('aiIntentProvider')).toLowerCase();
    if (providerEnv === 'gemini' || (!providerEnv && this.geminiApiKey)) {
      this.provider = 'gemini';
      this.model = apiKeysService.getSync('aiIntentModel') || 'gemini-3.5-flash-lite';
    } else {
      this.provider = 'openai';
      this.model = apiKeysService.getSync('aiIntentModel') || 'gpt-4o-mini';
    }

    const activeKey =
      this.provider === 'gemini' ? this.geminiApiKey : this.apiKey;
    if (activeKey) {
      this.logger.log(
        `[AiIntent] Enabled — provider=${this.provider} model=${this.model}`,
      );
    } else {
      this.logger.warn(
        `[AiIntent] No API key for provider=${this.provider} — keyword fallback only`,
      );
    }
  }

  isAvailable(): boolean {
    const hasKey = this.geminiRotator.isAvailable() || !!this.apiKey;
    return hasKey && Date.now() > this.cooldownUntil;
  }

  /** Fire-and-forget real token usage for the platform profit report. */
  private recordAiUsage(pageId: number, usage: AiCallUsage): void {
    if (!usage?.provider || !usage.model) return;
    void this.aiUsage.record({
      pageId,
      provider: usage.provider,
      model: usage.model,
      usageType: 'AI_INTENT',
      promptTokens: usage.promptTokens,
      outputTokens: usage.outputTokens,
    });
  }

  private async attemptOllama(
    userText: string,
    draftStep: string | null,
    awaitingConfirm: boolean,
    context?: BusinessContext,
  ): Promise<string | null> {
    if (this.ollamaBusy) {
      this.logger.log('[AiIntent] Ollama busy → OpenAI handles this one');
      return null;
    }
    this.ollamaBusy = true;
    try {
      this.logger.log(`[AiIntent] Ollama (${this.ollamaModel})`);
      const ollamaMessages = [
        {
          role: 'system',
          content: this.buildOllamaPrompt(draftStep, awaitingConfirm, context),
        },
        { role: 'user', content: `Customer: "${userText}"` },
      ];
      const res = await fetch(`${this.ollamaBaseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.ollamaModel,
          stream: false,
          options: { num_predict: 80 },
          messages: ollamaMessages,
        }),
        signal: AbortSignal.timeout(6_000),
      });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      const data = await res.json();
      const content = (data?.message?.content ?? '').trim();
      // Extract JSON object from response (Ollama may add extra text)
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) {
        this.logger.warn(
          `[AiIntent] Ollama no JSON in response: ${content.slice(0, 80)}`,
        );
        return null;
      }
      JSON.parse(match[0]); // validate parseable
      this.logger.log(`[AiIntent] Ollama OK`);
      return match[0];
    } catch (err: any) {
      this.logger.warn(`[AiIntent] Ollama failed: ${err?.message ?? err}`);
      return null;
    } finally {
      this.ollamaBusy = false;
    }
  }

  private async attemptOpenAI(
    messages: { role: string; content: string }[],
    maxTokens: number,
    temperature: number,
    usage: AiCallUsage = {},
  ): Promise<string | null> {
    if (!this.apiKey) return null;
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: maxTokens,
          temperature,
          response_format: { type: 'json_object' },
          messages,
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (res.status === 429 || res.status === 402) {
        this.logger.warn(
          `[AiIntent] OpenAI quota/limit (${res.status}) — keyword fallback`,
        );
        this.enterCooldown();
        return null;
      }
      if (!res.ok) {
        this.logger.error(`[AiIntent] OpenAI error ${res.status}`);
        this.recordFailure();
        return null;
      }
      const data = await res.json();
      usage.provider = 'openai';
      usage.model = this.model;
      usage.promptTokens = data?.usage?.prompt_tokens ?? 0;
      usage.outputTokens = data?.usage?.completion_tokens ?? 0;
      return (data?.choices?.[0]?.message?.content ?? '').trim() || null;
    } catch (err: any) {
      this.logger.warn(
        `[AiIntent] OpenAI network error: ${err?.message ?? err}`,
      );
      this.recordFailure();
      return null;
    }
  }

  private async attemptGemini(
    messages: { role: string; content: string }[],
    maxTokens: number,
    temperature: number,
    usage: AiCallUsage = {},
  ): Promise<string | null> {
    // Try all available Gemini keys in rotation
    while (this.geminiRotator.isAvailable()) {
      const key = this.geminiRotator.getKey();
      if (!key) break;
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
          generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
        };
        if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${key}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(8_000),
        });

        const latency = Date.now() - start;

        if (res.status === 429 || res.status === 402) {
          this.logger.warn(`[AiIntent] Gemini key ...${key.slice(-6)} quota (${res.status}) — trying next`);
          this.geminiRotator.markError(key, res.status);
          continue;
        }
        if (res.status === 500 || res.status === 503 || res.status === 504) {
          this.logger.warn(`[AiIntent] Gemini key ...${key.slice(-6)} server error (${res.status}) — trying next`);
          this.geminiRotator.markError(key, res.status);
          continue;
        }
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          const errText = await res.text();
          this.logger.error(`[AiIntent] Gemini key ...${key.slice(-6)} invalid/permission error (${res.status}): ${errText}`);
          this.geminiRotator.markError(key, res.status, errText);
          continue;
        }
        if (!res.ok) {
          const errText = await res.text();
          this.logger.error(`[AiIntent] Gemini error ${res.status}: ${errText.slice(0, 100)}`);
          this.geminiRotator.markError(key, res.status, errText);
          this.recordFailure();
          continue;
        }
        const data = await res.json();
        this.geminiRotator.markSuccess(key, latency);
        usage.provider = 'gemini';
        usage.model = this.model;
        usage.promptTokens = data?.usageMetadata?.promptTokenCount ?? 0;
        usage.outputTokens = data?.usageMetadata?.candidatesTokenCount ?? 0;
        return (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim() || null;
      } catch (err: any) {
        this.logger.warn(`[AiIntent] Gemini network error: ${err?.message ?? err}`);
        this.geminiRotator.markError(key, 500, err?.message ?? String(err));
        this.recordFailure();
        continue;
      }
    }
    this.logger.warn('[AiIntent] All Gemini keys exhausted — keyword fallback');
    return null;
  }

  private async resolveProvider(
    messages: { role: string; content: string }[],
    maxTokens: number,
    temperature: number,
    label: string,
    ollamaCtx?: {
      userText: string;
      draftStep: string | null;
      awaitingConfirm: boolean;
      context?: BusinessContext;
    },
  ): Promise<{ raw: string; usedProvider: string; usage: AiCallUsage } | null> {
    const { localAiMode } = await this.globalSettings.get();
    const usage: AiCallUsage = {};

    // Try Ollama for bot only when mode is 'all' (generate_only skips bot)
    if (localAiMode === 'all' && this.ollamaBaseUrl && ollamaCtx) {
      const ollamaRaw = await this.attemptOllama(
        ollamaCtx.userText,
        ollamaCtx.draftStep,
        ollamaCtx.awaitingConfirm,
        ollamaCtx.context,
      );
      if (ollamaRaw) {
        this.logger.log(`[AiIntent] ${label} — Ollama OK`);
        return { raw: ollamaRaw, usedProvider: 'local', usage };
      }
    }

    if (this.provider === 'gemini') {
      if (!this.geminiRotator.isAvailable()) {
        this.logger.warn(`[AiIntent] No Gemini key available — keyword fallback`);
        return null;
      }
      this.logger.log(`[AiIntent] ${label} — Gemini rotation (${this.model})`);
      const geminiRaw = await this.attemptGemini(messages, maxTokens, temperature, usage);
      if (geminiRaw) return { raw: geminiRaw, usedProvider: 'gemini', usage };
      // All Gemini keys exhausted — fall through to OpenAI
      this.logger.warn(`[AiIntent] All Gemini keys exhausted — trying OpenAI fallback`);
    }

    if (!this.apiKey) {
      this.logger.warn(`[AiIntent] No OpenAI key — keyword fallback`);
      return null;
    }
    this.logger.log(`[AiIntent] ${label} — OpenAI (${this.model})`);
    const raw = await this.attemptOpenAI(messages, maxTokens, temperature, usage);
    if (!raw) return null;
    return { raw, usedProvider: 'openai', usage };
  }

  async detectIntent(
    pageId: number,
    text: string,
    awaitingConfirm: boolean,
    draftStep: string | null,
    context: BusinessContext,
    chatHistory?: { role: string; content: string }[],
  ): Promise<AiIntentResult> {
    if (!this.isAvailable()) return { intent: null, reply: null };
    if (!(await this.walletService.canProcessAi(pageId))) {
      this.logger.warn(
        `[AiIntent] pageId=${pageId} suspended or insufficient balance`,
      );
      return { intent: null, reply: null };
    }

    // Build messages with conversation history for context-aware replies
    const historyMessages = (chatHistory ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const agentBehavior = await this.botKnowledge
      .getAgentBehavior(context.agentType || 'commerce')
      .catch(() => ({}) as AgentBehaviorConfig);

    const messages = [
      {
        role: 'system',
        content: this.buildSystemPrompt(context, draftStep, agentBehavior),
      },
      ...historyMessages,
      {
        role: 'user',
        content: this.buildUserMessage(text, awaitingConfirm, draftStep, context),
      },
    ];

    const resolved = await this.resolveProvider(
      messages,
      300,
      0.4,
      'detectIntent',
      { userText: text, draftStep, awaitingConfirm, context },
    );
    if (!resolved) return { intent: null, reply: null };

    try {
      let parsed: any;
      try {
        parsed = JSON.parse(resolved.raw);
      } catch {
        this.logger.warn(
          `[AiIntent] JSON parse failed: ${resolved.raw.slice(0, 80)}`,
        );
        this.recordFailure();
        return { intent: null, reply: null };
      }

      const intent = (parsed?.intent ?? '').toUpperCase().trim();
      if (!VALID_INTENTS.has(intent)) {
        this.logger.warn(`[AiIntent] Invalid intent: "${intent}"`);
        return { intent: null, reply: null };
      }

      this.failCount = 0;
      let reply = (parsed?.reply ?? '').trim() || null;

      // Ollama compact prompt always returns reply=null.
      // When intent needs a reply, call the configured AI provider for the actual reply.
      if (
        !reply &&
        AI_REPLY_INTENTS.has(intent) &&
        Date.now() > this.cooldownUntil
      ) {
        this.logger.log(
          `[AiIntent] ${intent} needs reply — ${this.provider} for reply generation`,
        );
        const providerRaw =
          this.provider === 'gemini'
            ? await this.attemptGemini(messages, 250, 0.5)
            : await this.attemptOpenAI(messages, 250, 0.5);
        if (providerRaw) {
          try {
            const parsed2 = JSON.parse(providerRaw);
            reply = (parsed2?.reply ?? '').trim() || null;
          } catch {
            /* ignore */
          }
        }
      }

      const systemPromptText = String(messages[0]?.content ?? '');
      const charCount = systemPromptText.length + text.length + (reply?.length ?? 0);
      await this.walletService.deductUsage(pageId, 'TEXT', { provider: resolved.usedProvider, charCount });
      this.recordAiUsage(pageId, resolved.usage);
      this.logger.log(
        `[AiIntent] intent=${intent} reply="${reply?.slice(0, 60) ?? 'none'}"`,
      );
      return { intent, reply };
    } catch (err: any) {
      this.logger.error(
        `[AiIntent] detectIntent parse error: ${err?.message ?? err}`,
      );
      this.recordFailure();
      return { intent: null, reply: null };
    }
  }

  async reviewDraftStep(
    pageId: number,
    text: string,
    draftStep: string,
    businessName: string | null,
  ): Promise<DraftStepReviewResult | null> {
    if (!this.isAvailable()) return null;
    if (!(await this.walletService.canProcessAi(pageId))) {
      this.logger.warn(
        `[AiIntent] pageId=${pageId} suspended or insufficient balance for draft review`,
      );
      return null;
    }

    const messages = [
      {
        role: 'system',
        content: this.buildDraftReviewPrompt(businessName, draftStep),
      },
      { role: 'user', content: `Customer message: "${text}"` },
    ];

    const resolved = await this.resolveProvider(
      messages,
      180,
      0.2,
      'reviewDraftStep',
    );
    if (!resolved) return null;

    try {
      let parsed: any;
      try {
        parsed = JSON.parse(resolved.raw);
      } catch {
        this.logger.warn(
          `[AiIntent] Draft review JSON parse failed: ${resolved.raw.slice(0, 80)}`,
        );
        this.recordFailure();
        return null;
      }

      const action = String(parsed?.action ?? '')
        .toUpperCase()
        .trim();
      if (
        ![
          'CAPTURE',
          'RETRY',
          'EXIT_DRAFT',
          'CONFIRM',
          'CANCEL',
          'EDIT',
        ].includes(action)
      ) {
        this.logger.warn(`[AiIntent] Invalid draft action: "${action}"`);
        return null;
      }

      this.failCount = 0;
      const replyText = (parsed?.reply ?? '').trim();
      const draftCharCount = String(messages[0]?.content ?? '').length + text.length + replyText.length;
      await this.walletService.deductUsage(pageId, 'TEXT', { provider: resolved.usedProvider, charCount: draftCharCount });
      this.recordAiUsage(pageId, resolved.usage);
      this.logger.log(`[AiIntent] draft action=${action}`);
      return {
        action: action as DraftStepReviewResult['action'],
        reply: replyText || null,
        normalizedValue: (parsed?.normalizedValue ?? '').trim() || null,
      };
    } catch (err: any) {
      this.logger.error(
        `[AiIntent] reviewDraftStep parse error: ${err?.message ?? err}`,
      );
      this.recordFailure();
      return null;
    }
  }

  shouldUseAiReply(intent: string): boolean {
    return AI_REPLY_INTENTS.has(intent);
  }

  private buildOllamaPrompt(
    draftStep: string | null,
    awaitingConfirm: boolean,
    context?: BusinessContext,
  ): string {
    const stepNote = draftStep
      ? `\nCurrent step: collecting "${STEP_LABELS[draftStep] ?? draftStep}".`
      : '';
    const confirmNote = awaitingConfirm
      ? '\nawaitingConfirm=true means "ok/haa/yes" → CONFIRM.'
      : '';
    const dualNote = context?.dualPhotoMode
      ? `\nDUAL PHOTO MODE active: "hate thaka/holding/hand dress" → DUAL_HOLDING; "pore ache/gaye/wearing dress" → DUAL_WEARING.`
      : '';
    const dualIntents = context?.dualPhotoMode
      ? ', DUAL_WEARING, DUAL_HOLDING'
      : '';
    return `You are a Bangladeshi e-commerce chatbot. Classify the customer message.
Return ONLY valid JSON: {"intent":"INTENT","reply":null}${stepNote}${confirmNote}${dualNote}

Intents: GREETING, ORDER_INTENT, CANCEL, CONFIRM, EDIT_ORDER, NEGOTIATION, SIZE_REQUEST, PHOTO_REQUEST, DELIVERY_TIME, DELIVERY_FEE, FABRIC_TYPE, CATALOG_REQUEST, SOFT_HESITATION, MULTI_CONFIRM, UNKNOWN${dualIntents}

Rules:
- "nibo na"/"lagbe na"/"cancel"/"bad den" → CANCEL
- "lagbe"/"kinbo"/"order" (without "na") → ORDER_INTENT
- "ok"/"haa"/"theek ache"/"send koren"/"pathaan"/"nibo"/"chai" after bot showed a product → ORDER_INTENT
- "ok"/"haa"/"theek ache" inside a draft step → CONFIRM
- "ok" as casual acknowledgment with no product context → UNKNOWN (reply warmly)
- "ki ki ache"/"product list"/"catalog" → CATALOG_REQUEST
- "valo asen"/"kemon achen"/"how are you"/"hi"/"hello"/"salam" → GREETING
- Doubt → UNKNOWN
- Always set reply=null`;
  }

  private buildSystemPrompt(
    context: BusinessContext,
    draftStep: string | null,
    agentBehavior: AgentBehaviorConfig = {},
  ): string {
    const shop = context.businessName
      ? `"${context.businessName}" নামের Bangladeshi e-commerce shop`
      : 'একটি Bangladeshi fashion e-commerce shop';

    const stepLabels = agentBehavior.coreFields?.length
      ? { ...STEP_LABELS, ...Object.fromEntries(agentBehavior.coreFields.map((f) => [f.key, f.label])) }
      : STEP_LABELS;

    const stepCtx = draftStep
      ? `\nএখন bot customer-এর কাছ থেকে "${stepLabels[draftStep] ?? draftStep}" চাইছে।`
      : '';

    // Build product catalog context (max 25 products)
    const offerNote = (p: any) => {
      const orig = Number(p.originalPrice) || 0;
      const price = Number(p.price) || 0;
      if (!orig || orig <= price) return '';
      const pct = Math.round((1 - price / orig) * 100);
      return ` | 🔥 OFFER: আগের দাম ৳${orig}, এখন ৳${price} (${pct}% ছাড়) — দাম বলার সময় এই was/now গল্পটা বলো`;
    };
    const productLines = context.products
      .slice(0, 25)
      .map((p) => {
        // V25: size/portion prices when present ("5 pcs ৳120 / 10 pcs ৳220")
        const variants = parsePriceVariants((p as any).priceVariantsJson);
        const priceTxt = variants.length
          ? variantsSummaryText(variants, '৳')
          : `৳${p.price}`;
        const inStock = (p as any).trackStock === false || p.stockQty > 0;
        const desc = String((p as any).description || '').trim();
        const descLine = desc ? ` | বিবরণ: ${desc}` : '';
        return `- ${p.name}: ${priceTxt} | ${inStock ? 'Stock আছে' : 'Stock নেই'}${offerNote(p)}${descLine}`;
      })
      .join('\n');
    const productCtx =
      context.products.length > 0
        ? `\n\nProducts (${context.products.length} টি):\n${productLines}`
        : '';

    // Delivery and payment context
    // V24: Restaurant pages use distance-slab rates, not Dhaka zones
    const deliveryCtx = context.restaurantMode
      ? `\n\nDelivery (Restaurant — নিজস্ব ডেলিভারি):
- দূরত্ব অনুযায়ী: ${formatSlabsBn(context.deliverySlabs, '৳')}
- সময়: ${context.deliveryTime}
- ঢাকার ভিতরে/বাইরে flat rate প্রযোজ্য না — exact charge website-এ ম্যাপে pin করলে দেখাবে`
      : `\n\nDelivery:
- ঢাকার ভিতরে: ৳${context.deliveryInsideFee}
- ঢাকার বাইরে: ৳${context.deliveryOutsideFee}
- সময়: ${context.deliveryTime}`;

    const paymentRules = context.paymentRules as any;
    const paymentCtx = paymentRules
      ? `\n\nPayment:
- COD: ${paymentRules.codEnabled !== false ? 'আছে' : 'নেই'}
- Advance (inside Dhaka): ${paymentRules.insideDhakaAdvanceEnabled ? `৳${paymentRules.insideDhakaAdvanceAmount ?? 100}` : 'লাগবে না'}
- Advance (outside Dhaka): ${paymentRules.outsideDhakaAdvanceEnabled ? `৳${paymentRules.outsideDhakaAdvanceAmount ?? 100}` : 'লাগবে না'}`
      : '';

    const knowledgeCtx = context.knowledgeText
      ? `\n\nBusiness Knowledge (FAQ/Policy):\n${context.knowledgeText}`
      : '';

    let dualCtx = '';
    if (
      context.dualPhotoMode &&
      (context.dualWearingProduct || context.dualHoldingProduct)
    ) {
      dualCtx = `\n\n## DUAL PHOTO MODE চালু আছে\nএই মুহূর্তে দুটো product active:\n`;
      if (context.dualWearingProduct)
        dualCtx += `- মডেল **পরে আছে** (গায়ে): ${context.dualWearingProduct.name} — code: ${context.dualWearingProduct.code}, ৳${context.dualWearingProduct.price}\n`;
      if (context.dualHoldingProduct)
        dualCtx += `- **হাতে ধরা** আছে: ${context.dualHoldingProduct.name} — code: ${context.dualHoldingProduct.code}, ৳${context.dualHoldingProduct.price}\n`;
      dualCtx += `\nCustomer গায়ে পরা/wearing dress জিজ্ঞেস করলে → intent: "DUAL_WEARING"\nCustomer হাতে ধরা/holding dress জিজ্ঞেস করলে → intent: "DUAL_HOLDING"\nreply-তে product name ও price উল্লেখ করো।\n`;
    }

    const customPersona = String(context.customPersonaPrompt || '').trim();
    const opener = customPersona
      ? customPersona.replace(/\{\{\s*shop\s*\}\}/g, shop)
      : agentBehavior.personaPrompt
        ? agentBehavior.personaPrompt.replace(/\{\{\s*shop\s*\}\}/g, shop)
        : defaultPersonaOpener(shop);

    return `${opener}${stepCtx}${deliveryCtx}${paymentCtx}${productCtx}${knowledgeCtx}${dualCtx}

Customer-এর message দেখে JSON return করো:
{ "intent": "<INTENT>", "reply": "<natural reply>" }

━━ INTENT LIST ━━
- GREETING — "hi/hello/salam/valo asen/kemon achen/how are you" জাতীয় কথা
- ORDER_INTENT — কিনতে বা order করতে চায়
- CANCEL — order বাতিল ("nibo na", "lagbe na", "chai na", "cancel", "বাতিল")
- CONFIRM — order confirm করছে (yes/haa/confirm — awaitingConfirm=true হলে)
- EDIT_ORDER — কিছু change করতে চায় (নাম/ফোন/ঠিকানা/size)
- NEGOTIATION — দাম কমাতে চায় ("kom hobe", "discount", "last price", "best price")
- SIZE_REQUEST — size জিজ্ঞেস করছে
- PHOTO_REQUEST — ছবি/photo চাইছে
- DELIVERY_TIME — delivery কবে হবে
- DELIVERY_FEE — delivery charge কত
- FABRIC_TYPE — কাপড়ের quality/material
- CATALOG_REQUEST — product list চাইছে ("ki ki ache", "ki ache", "catalog", "sob product")
- SOFT_HESITATION — পরে দেখবে, এখন না
- MULTI_CONFIRM — একসাথে সব order দিতে চায়
- DUAL_WEARING — (only when dualPhotoMode) customer গায়ে পরা dress সম্পর্কে জিজ্ঞেস করছে
- DUAL_HOLDING — (only when dualPhotoMode) customer হাতে ধরা dress সম্পর্কে জিজ্ঞেস করছে
- UNKNOWN — অন্য সব

━━ CLASSIFICATION RULES (এগুলো কখনো ভুল করো না) ━━
1. CANCEL: "na/nibo na/lagbe na/chai na/bad den/cancel/বাতিল/দরকার নেই" → CANCEL। price question-এ na থাকলে CANCEL নয়।
2. ORDER_INTENT: "lagbe/kinbo/order korbo/nibo" (না ছাড়া) → ORDER_INTENT।
3. NEGOTIATION: শুধু তখন যখন customer explicitly দাম কমাতে চাইছে — "kom hobe?", "discount diben?", "last price?", "X taka te diben?" এই ধরনের। "ki ki ache?" কোনোভাবেই NEGOTIATION না।
4. CATALOG_REQUEST: "ki ki ache/ki ache/product list/catalog/sob dekhao/konta ache" → সবসময় CATALOG_REQUEST, NEGOTIATION না।
5. GREETING: "valo asen/kemon achen/hi/hello/salam" → GREETING। price বা product-এর কথা নেই।
6. "Ok/Thik/send koren/pathao/nibo/chai" + [সর্বশেষ দেখানো product] context আছে → ORDER_INTENT।
7. "Ok/Thik" একা + no product shown + no draft → UNKNOWN (warmly reply)।
8. "Ok/haa/yes" + awaitingConfirm=true বা draft step=confirm → CONFIRM।
9. সন্দেহ হলে ORDER-এর চেয়ে CANCEL বেছে নাও।

━━ REPLY RULES — কোন তথ্য কোথা থেকে নেবে ━━

GREETING reply:
  • "valo asen / kemon achen / how are you" → নিজের কথা বলো ("আলহামদুলিল্লাহ, ভালো আছি 😊 আপনি কেমন আছেন?"), তারপর help offer করো। Products/code একদম mention করো না।
  • "hi / hello / salam / assalamu alaikum" → warmly greet, shop-এর নাম বলো, কীভাবে help করতে পারো জিজ্ঞেস করো। Product list দিও না।

DELIVERY_FEE reply:
  → উপরের Delivery section থেকে EXACT fee নাও। ঢাকার ভিতরে: ৳{insideFee}, বাইরে: ৳{outsideFee}। নিজে থেকে fee বানাবে না।

DELIVERY_TIME reply:
  → উপরের Delivery section-এর "সময়" থেকে নাও। নিজে থেকে সময় বানাবে না।

SIZE_REQUEST / FABRIC_TYPE reply:
  → Business Knowledge (FAQ/Policy) section থেকে তথ্য নাও। না থাকলে বলো "কোন product-এর size জানতে চান?" — কিছু বানাবে না।

NEGOTIATION reply:
  → Payment section-এর pricing policy দেখো। Sympathetic থাকো কিন্তু policy মেনে চলো।

CATALOG_REQUEST reply:
  → Products list থেকে top 5টি নাম ও দাম বলো (bullet: "• নাম — ৳দাম")। শেষে বলো "আরও আছে, সব দেখতে catalog link-এ যান"।

CANCEL reply → warmly acknowledge, কোনো সমস্যা নেই।
SOFT_HESITATION reply → বুঝলাম, যখন সুবিধা জানাবেন।
PHOTO_REQUEST reply → বলো photo পাঠানো হবে বা page-এ দেখুন।
DUAL_WEARING reply → DUAL PHOTO MODE section থেকে "পরে আছে" product-এর name ও price বলো। শেষে বলো "নিতে চাইলে বলুন 💖"।
DUAL_HOLDING reply → DUAL PHOTO MODE section থেকে "হাতে ধরা" product-এর name ও price বলো। শেষে বলো "নিতে চাইলে বলুন 💖"।
UNKNOWN + draft চলছে → draft reminder দিয়ে warmly redirect।
UNKNOWN + no draft → তারা কী বলতে চাইছে acknowledge করো, suggest করো (product code/screenshot দিতে বলো অথবা delivery/size/payment নিয়ে জিজ্ঞেস করতে পারেন বলো)।
অন্য সব intent → reply=null

⛔ STRICTLY FORBIDDEN in reply: "আমাদের সাথে যোগাযোগ করুন" / "আরও জানতে যোগাযোগ করুন" — customer ইতিমধ্যে message করছে, এটা বলা circular এবং useless। কখনো বলবে না।`;
  }

  private buildUserMessage(
    text: string,
    awaitingConfirm: boolean,
    draftStep: string | null,
    context?: BusinessContext,
  ): string {
    let ctx = '';
    if (draftStep) ctx += ` | draft_step="${draftStep}"`;
    if (awaitingConfirm) ctx += ' | awaiting_confirm=true';

    // Inject last bot reply and shown products so AI understands "ok"/soft replies
    const extraLines: string[] = [];
    if (context?.lastBotReply) {
      extraLines.push(`[Bot এর আগের reply: "${context.lastBotReply.slice(0, 200)}"]`);
    }
    if (context?.lastPresentedProducts?.length) {
      const shown = context.lastPresentedProducts
        .map((p) => `${p.name ?? p.code} (${p.code})${p.price ? ` ৳${p.price}` : ''}`)
        .join(', ');
      extraLines.push(`[সর্বশেষ দেখানো product: ${shown}]`);
    }
    const prefix = extraLines.length ? extraLines.join('\n') + '\n' : '';
    return `${prefix}Customer: "${text}"${ctx}`;
  }

  private buildDraftReviewPrompt(
    businessName: string | null,
    draftStep: string,
  ): string {
    const shop = businessName
      ? `"${businessName}" নামের Bangladeshi e-commerce shop`
      : 'একটি Bangladeshi e-commerce shop';

    const stepLabel = STEP_LABELS[draftStep] ?? draftStep;

    return `তুমি ${shop}-এর Messenger order flow monitor করছ।
Bot এখন customer-এর কাছ থেকে "${stepLabel}" চাইছে।

Customer message দেখে strict JSON return করো:
{ "action": "<ACTION>", "normalizedValue": "<value or null>", "reply": "<reply or null>" }

Allowed ACTION:
- CAPTURE: customer requested info-টাই দিয়েছে; normalizedValue-এ clean value দাও
- RETRY: customer flow-তেই আছে কিন্তু expected answer দেয়নি/invalid দিয়েছে; reply-তে same step gently re-ask করো
- EXIT_DRAFT: customer clearly off-topic / topic change / normal chat / unrelated question; reply-তে normal conversational উত্তর দাও, order flow continue করবে না
- CONFIRM: confirm/yes দিয়েছে
- CANCEL: cancel/not interested দিয়েছে
- EDIT: change করতে চায়

Rules:
1. step=name হলে শুধু মানুষের নাম হলে CAPTURE। greeting, প্রশ্ন, product query, address-like text, long sentence, phone number, negotiation text name না।
2. step=phone হলে valid Bangladeshi phone number থাকলে CAPTURE। Valid formats: 01XXXXXXXXX, 8801XXXXXXXXX, +8801XXXXXXXXX — সবই valid। শুধু phone number আছে এমন message → CAPTURE। অন্য কিছু RETRY বা EXIT_DRAFT।
3. step=address হলে full location/address-like text হলে CAPTURE। ছোট chat message address না।
4. step=confirm হলে confirm/cancel/edit আলাদা action দাও। unrelated হলে RETRY বা EXIT_DRAFT।
5. step=confirm_address হলে "হ্যাঁ/ঠিক আছে" টাইপ হলে CONFIRM, নতুন address হলে CAPTURE।
6. step=advance_payment হলে valid transaction id / payment proof হলে CAPTURE। সমস্যা/agent/help চাইলে RETRY with helpful guidance, clear cancel হলে CANCEL।
7. step=cf:... হলে only direct option/value হলে CAPTURE। unrelated হলে RETRY বা EXIT_DRAFT।
8. User যদি order context ছেড়ে অন্য topic-এ চলে যায়, EXIT_DRAFT বেছে নাও।
9. reply field RETRY বা EXIT_DRAFT হলে সবসময় দাও। CAPTURE/CONFIRM/CANCEL/EDIT হলে reply=null।
10. normalizedValue-এ শুধু clean user value দাও; না থাকলে null।`;
  }

  private recordFailure(): void {
    this.failCount++;
    if (this.failCount >= this.MAX_FAILS) {
      this.logger.warn(`[AiIntent] ${this.MAX_FAILS} failures — cooldown 5min`);
      this.enterCooldown();
    }
  }

  private enterCooldown(): void {
    this.cooldownUntil = Date.now() + 5 * 60 * 1000;
    this.failCount = 0;
  }
}
