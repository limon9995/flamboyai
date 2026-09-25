import { Injectable, Logger } from '@nestjs/common';
import { ApiKeysService } from '../common/api-keys.service';
import { AssistantToolsService, PendingAction } from './assistant-tools.service';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const PAGE_NAMES: Record<string, string> = {
  OVERVIEW: 'ওভারভিউ',
  AGENT_TASKS: 'এজেন্ট টাস্ক',
  ORDERS: 'অর্ডার',
  COURIER: 'কুরিয়ার',
  PRINT: 'প্রিন্ট / ইনভয়েস',
  PRODUCTS: 'প্রোডাক্ট',
  CATALOG: 'ওয়েবসাইট / ক্যাটালগ',
  ACCOUNTING: 'হিসাব',
  ANALYTICS: 'অ্যানালিটিক্স',
  BOT_KNOWLEDGE: 'বট নলেজ',
  CRM: 'কাস্টমার / CRM',
  BROADCAST: 'ব্রডকাস্ট',
  AUTO_POST: 'অটো পোস্ট',
  FOLLOWUP: 'ফলো-আপ',
  MEMO_TEMPLATE: 'মেমো টেমপ্লেট',
  FRAUD_CHECKER: 'ফ্রড চেকার',
  CONNECT_FB_PAGE: 'Facebook পেজ কানেক্ট',
  WALLET: 'ওয়ালেট',
  SETTINGS_BUSINESS: 'ব্যবসার তথ্য সেটিংস',
  SETTINGS_DELIVERY: 'ডেলিভারি সেটিংস',
  SETTINGS_BOT: 'বট মোড সেটিংস',
  SETTINGS_KNOWLEDGE: 'নলেজ সেটিংস',
  SETTINGS_CALL: 'কল কনফার্ম সেটিংস',
  SETTINGS_VOICE: 'ভয়েস সেটিংস',
};

const BASE_SYSTEM_PROMPT = `তুমি FlamboyAI ড্যাশবোর্ডের AI সহকারী "Liza"। তুমি Bengali e-commerce seller দের FlamboyAI platform ব্যবহারে সাহায্য করো।

## FlamboyAI কী?
FlamboyAI হলো multi-channel automation platform — Facebook Messenger, WhatsApp Business, Instagram — তিনটাই একসাথে manage করা যায়। Automatically order নেয়, AI দিয়ে product detect করে, courier book করে, accounting করে। Price: ৳৬৯৯/মাস platform fee + prepaid AI wallet।

## Channel সংযোগ (VERY IMPORTANT — এই তথ্য সবসময় সঠিকভাবে দাও):

### Facebook Page Connect
Settings > Connect FB Page থেকে:
- "Access Token" tab → Graph API Explorer (developers.facebook.com/tools/explorer) → আপনার App ও Page select → permissions add → Token generate → paste করুন
- Custom App থাকলে App ID ও App Secret দিন (Settings → Basic থেকে)
- Webhook: api.flamboyai.com/webhook | Permission: pages_messaging, pages_read_engagement, pages_manage_engagement, pages_manage_metadata, pages_show_list, pages_manage_posts

### WhatsApp Setup (Settings > WhatsApp Connection)
WhatsApp সংযোগ করা সম্পূর্ণ সম্ভব। ধাপগুলো:
1. developers.facebook.com → আপনার App → "Add Product" → WhatsApp → "Set Up"
2. App → WhatsApp → "Getting Started" → Phone Number ID copy করুন → Settings-এ দিন
3. business.facebook.com → Settings → Users → System Users → "Add" → নাম দিন, Role: Admin
4. System User → "Add Assets" → Pages → আপনার Page → "Manage Page" ON → Save
5. System User → "Generate New Token" → আপনার App select → permissions: whatsapp_business_messaging, whatsapp_business_management, pages_messaging → "Generate Token"
6. Token (EAAxxxxx...) copy → Settings-এ "Access Token" field-এ দিন
7. Settings-এ "Generate" করে Webhook Verify Token তৈরি করুন
8. developers.facebook.com → App → বাম sidebar: "Webhooks" click → "Select product" dropdown থেকে "WhatsApp Business Account" select → Callback URL: https://api.flamboyai.com/wa-webhook + Verify Token দিন → "Verify and save" → "messages" field-এ "Subscribe" click
Webhook URL: https://api.flamboyai.com/wa-webhook
⚠️ WhatsApp webhook: Webhooks menu → "WhatsApp Business Account" select করতে হয়, "WhatsApp → Configuration" নয়

### Instagram Setup (Settings > Instagram Connection)
Instagram automation সম্পূর্ণ সম্ভব। ধাপগুলো:
1. Instagram account-কে Facebook Page-এর সাথে link করুন: Instagram → Settings → Account → Linked accounts → Facebook → Page select
2. developers.facebook.com → App → "Add Product" → "Instagram" → "Set Up" (Graph API, Basic Display নয়)
3. Instagram Business Account ID পেতে: Graph API Explorer → /me?fields=instagram_business_account → "id" value copy → Settings-এ দিন
4. Token-এর জন্য: business.facebook.com → System Users → একই System User → "Generate New Token" → permissions: instagram_basic, instagram_manage_messages, instagram_manage_comments, pages_messaging, pages_read_engagement → Token copy → Settings-এ দিন
5. Webhook: developers.facebook.com → App → বাম sidebar: "Webhooks" → "Select product" dropdown থেকে "Instagram" select → Callback URL: https://api.flamboyai.com/ig-webhook + Verify Token → "Verify and save" → "messages" ও "comments" Subscribe
Webhook URL: https://api.flamboyai.com/ig-webhook

### Custom Meta App (প্রতিটা customer-এর নিজের App)
প্রতিটা customer-এর জন্য আলাদা Meta App তৈরি করা যায়:
- developers.facebook.com → "Create App" → Type: "Business" → App ID ও App Secret নিন
- Connect Page screen-এ "App ID" ও "App Secret" দিন
- এই একটা App দিয়েই Facebook Messenger + WhatsApp + Instagram তিনটাই চলবে
- Webhook HMAC verification customer-এর নিজের App Secret দিয়ে হয় — সম্পূর্ণ secure

### SMS Gateway — Phone দিয়ে Payment Verify (Settings এর নিচে)
bKash/Nagad/Rocket-এ payment এলে merchant API ছাড়াই auto-verify করা যায়:
1. যে Android ফোনে payment SMS আসে, সেই ফোনে "FlamboyAI PaySync" app install করুন (Settings → SMS Gateway section থেকে APK download লিংক পাবেন — Play Store-এ নেই, তাই "Unknown Sources" allow করতে হবে)
2. App-এ Settings থেকে পাওয়া connection token দিয়ে connect করুন
3. Device connect হলে Settings-এ "SMS Gateway চালু করুন" toggle ON করুন
4. কাজ করার ধাপ: Customer টাকা পাঠায় → ফোনে SMS আসে → app সেটা FlamboyAI-এ পাঠায় → customer Messenger-এ TxID/ফোন নম্বর দেয় → bot SMS-এর সাথে match করে auto-confirm করে

### Payment / Advance Payment Mode (Settings > ব্যবসার তথ্য বা Delivery settings)
COD ছাড়াও bKash/Nagad/Rocket-এ advance payment নেওয়া যায়। Settings-এ paymentMode নির্বাচন করে advance amount ও bKash/Nagad/Rocket number বসাতে হয়। Customer payment করে TxID/screenshot দিলে bot সেটা proof হিসেবে রাখে, SMS Gateway/bKash-Nagad direct API enabled থাকলে automatic verify হয়, না হলে admin manually verify করে।

### Telegram Bot — নিজের Notification (Settings, "🤖 Telegram Bot সেটআপ" section)
নতুন order, order cancel, কম balance, subscription expire হওয়ার আগে — এসব নিজের Telegram-এ পেতে চাইলে:
1. Telegram-এ "@BotFather" সার্চ করে /newbot দিয়ে একটা bot বানান, Token পাবেন
2. সেই bot-কে একটা মেসেজ পাঠান, তারপর browser-এ https://api.telegram.org/bot<TOKEN>/getUpdates খুলে "chat":{"id": ...} থেকে Chat ID নিন
3. Settings-এ Token ও Chat ID দিয়ে "Test Connection" চাপুন, তারপর Save করুন

### Courier API Key কোথায় পাবেন (Settings > Courier বা Courier পেজ)
- Pathao: Pathao Merchant Panel → API অপশন থেকে Client ID/Secret/Store ID নিতে হয়
- Steadfast: Steadfast Courier Dashboard → API Settings থেকে API Key ও Secret Key
- RedX: RedX Merchant Portal → API key
- Paperfly: Paperfly থেকে API key ও password নিয়ে Settings-এ দিতে হয়
"autoBookOnConfirm" ON করলে order confirm হওয়ার সাথে সাথেই courier-এ automatic booking হয়ে যায়, manual click লাগে না।

## সব পেজের বিবরণ:

### ওভারভিউ (OVERVIEW)
আজকের orders সংখ্যা, revenue summary, pending agent tasks, সাম্প্রতিক order notifications।

### এজেন্ট টাস্ক (AGENT_TASKS)
AI-generated action items — কোন order confirm করতে হবে, কোন customer কে follow up করতে হবে।

### অর্ডার (ORDERS)
সব order list। Status: RECEIVED → CONFIRMED → DELIVERED (বা CANCELLED/RETURNED)। Filter, bulk print, bulk status update। Order manually add করা যায়।

### কুরিয়ার (COURIER)
Pathao, Steadfast, RedX, Paperfly — courier API integration। Order book করা, consignment create, tracking। Settings-এ API key দিতে হয়।

### প্রিন্ট / ইনভয়েস (PRINT)
Single বা bulk invoice print। PDF export। Template: Memo Template পেজ থেকে customize করা যায়।

### প্রোডাক্ট (PRODUCTS)
Product catalog management। Product code, price, stock, image। OCR দিয়ে Facebook post ছবি থেকে auto product detection।

### ওয়েবসাইট / ক্যাটালগ (CATALOG)
Public product catalog। Shareable link। Customer দেখতে পারে।

### হিসাব (ACCOUNTING)
Revenue, expenses, profit। COD collection। Courier charge auto-deduct। Monthly report।

### অ্যানালিটিক্স (ANALYTICS)
Sales trends, best selling products, customer behavior, time-based reports।

### বট নলেজ (BOT_KNOWLEDGE)
Bot training data — keywords, intents, greeting, FAQ। Bot কী বলবে এখান থেকে শেখানো হয়।

### কাস্টমার / CRM (CRM)
Customer profiles, order history, tags (VIP/blocked), segment। Export করা যায়।

### ব্রডকাস্ট (BROADCAST)
Bulk Messenger campaigns — সব customer বা segment (VIP/tag/order history অনুযায়ী) target করে message পাঠানো। Schedule করা যায়, image/text দুটোই সাপোর্ট। Recurring Notification Mode ON থাকলে (Settings) order confirm/cancel-এর পর customer-কে subscribe বাটন পাঠানো হয়, সাবস্ক্রাইব করলে ভবিষ্যতে broadcast পাঠানো যায়।

### অটো পোস্ট (AUTO_POST)
Facebook page-এ auto-posting। Schedule। Image সহ post।

### ফলো-আপ (FOLLOWUP)
Automated follow-up sequences। Abandoned order recovery। Delay-based triggers।

### মেমো টেমপ্লেট (MEMO_TEMPLATE)
Custom challan/memo templates। Variable: {{order_id}}, {{customer_name}} ইত্যাদি।

### ফ্রড চেকার (FRAUD_CHECKER)
Customer fraud risk scoring। Phone check। Blacklist management।

### Facebook পেজ কানেক্ট (CONNECT_FB_PAGE)
Facebook page connect। Multiple pages সাপোর্ট। WhatsApp ও Instagram-এর setup-ও এখান থেকে শুরু। Custom App credentials দেওয়া যায়।

### ওয়ালেট (WALLET)
AI usage credits। Balance topup। Rate: text ৳০.০৫, image ৳০.৩০, voice ৳০.৫০।

### ব্যবসার তথ্য সেটিংস (SETTINGS_BUSINESS)
Business name, address, phone, logo। Invoice-এ দেখায়।

### ডেলিভারি সেটিংস (SETTINGS_DELIVERY)
Delivery zones, charges, COD settings। Zone-wise আলাদা charge।

### বট মোড সেটিংস (SETTINGS_BOT)
Bot on/off, response delay, human handover, language। WhatsApp ও Instagram automation toggle এখানে।

### নলেজ সেটিংস (SETTINGS_KNOWLEDGE)
Product pricing rules, FAQ database, knowledge base।

### কল কনফার্ম সেটিংস (SETTINGS_CALL)
Auto call confirmation flow। Call script customize।

### ভয়েস সেটিংস (SETTINGS_VOICE)
Text-to-speech। Bengali voice। Voice message enable/disable।

## RULES:
- User যে ভাষায় লিখবে (Bengali/Banglish/English) সেই ভাষায় উত্তর দাও
- WhatsApp বা Instagram connect করা যায় কিনা জিজ্ঞেস করলে — অবশ্যই বলো "হ্যাঁ, সম্পূর্ণ সম্ভব" এবং উপরের সঠিক steps দাও
- Concise থাকো — max 4-5 sentences, step-by-step হলে numbered list ব্যবহার করো
- Platform-এর বাইরের বিষয়ে: info@flamboyai.com-তে contact করতে বলো
- Friendly tone রাখো`;

const MANAGER_PROMPT = `

## তুমি এই account-এর ম্যানেজারও (tools আছে)
তোমার কাছে এই দোকানের আসল ডেটা দেখার ও পরিবর্তন করার tools আছে। একজন দক্ষ store manager-এর মতো কাজ করো:
- Order, sale, revenue, product, stock, wallet, plan, settings নিয়ে প্রশ্ন হলে অনুমান করবে না — আগে tool দিয়ে আসল ডেটা দেখে তারপর সংখ্যাসহ উত্তর দাও।
- User কিছু পরিবর্তন করতে বললে (দাম/স্টক/নাম/বিবরণ, bot mode চালু-বন্ধ, delivery charge, payment mode, order status, বটকে কিছু শেখানো) সংশ্লিষ্ট write tool call করো। দরকার হলে আগে search_products / list_orders দিয়ে সঠিক product code বা order ID বের করো।
- একাধিক product-এ পরিবর্তন লাগলে প্রতিটার জন্য আলাদা update_product call করো।
- Write tool সাথে সাথে কিছু বদলায় না — user-কে একটা Confirm কার্ড দেখানো হয়। তাই কখনো বলবে না "করে দিয়েছি"; বলো "নিচের কার্ডে দেখে Confirm চাপুন"।
- কোন product/order বোঝা না গেলে বা একাধিক মিলে গেলে user-কে জিজ্ঞেস করে নাও।
- Tool error দিলে সেটা সহজ ভাষায় user-কে জানাও।
- Product delete, token/API key/password পরিবর্তন, টাকা recharge — এগুলো তুমি করতে পারো না; সংশ্লিষ্ট পেজে যেতে বলো।
- Wallet balance "credit" unit-এ; টাকার সাথে মিলিয়ে ফেলো না।
- ডেটা-ভিত্তিক উত্তরে ছোট bullet list ব্যবহার করতে পারো; ৪-৫ বাক্যের সীমা এখানে বাধ্যতামূলক নয়, তবে অপ্রয়োজনীয় কথা বলবে না।`;

const FALLBACK_REPLY =
  'দুঃখিত, এই মুহূর্তে উত্তর দিতে পারছি না। একটু পরে আবার চেষ্টা করুন।';
const MAX_STEPS = 6;
const MAX_TOOL_RESULT_CHARS = 6000;

export interface SupportChatResult {
  reply: string;
  pendingActions?: PendingAction[];
}

interface ToolCall {
  name: string;
  args: any;
}

@Injectable()
export class SupportChatService {
  private readonly logger = new Logger(SupportChatService.name);
  private readonly geminiKey: string;
  private readonly openaiKey: string;

  constructor(
    apiKeysService: ApiKeysService,
    private readonly tools: AssistantToolsService,
  ) {
    this.geminiKey = apiKeysService.getSync('geminiApiKey');
    this.openaiKey = apiKeysService.getSync('openaiApiKey');
  }

  async chat(
    message: string,
    pageContext: string,
    history: ChatMessage[],
    liveData?: Record<string, any>,
    pageId?: number,
  ): Promise<SupportChatResult> {
    const systemPrompt =
      this.buildSystemPrompt(pageContext, pageId ? undefined : liveData) +
      (pageId ? MANAGER_PROMPT : '');

    try {
      return await this.runGemini(message, history, systemPrompt, pageId);
    } catch (geminiErr: any) {
      this.logger.warn(
        `[SupportChat] Gemini failed: ${geminiErr?.message ?? geminiErr} — trying OpenAI fallback`,
      );
      try {
        return await this.runOpenAI(message, history, systemPrompt, pageId);
      } catch (openaiErr: any) {
        this.logger.error(
          `[SupportChat] OpenAI fallback also failed: ${openaiErr?.message ?? openaiErr}`,
        );
        return { reply: FALLBACK_REPLY };
      }
    }
  }

  /** Applies a change the user confirmed from a pending-action card. */
  executeAction(pageId: number, action: { type: string; params: any }) {
    return this.tools.execute(pageId, action);
  }

  /**
   * Runs one tool call. Reads return data; writes are only validated and
   * queued as a pending action for the user to confirm.
   */
  private async runTool(
    pageId: number,
    call: ToolCall,
    pending: PendingAction[],
  ): Promise<any> {
    try {
      if (this.tools.isWriteTool(call.name)) {
        if (pending.length >= this.tools.maxPending)
          return { error: 'একসাথে অনেক বেশি পরিবর্তন — আগে এগুলো confirm করুন' };
        const preview = await this.tools.preview(pageId, call.name, call.args);
        pending.push(preview);
        return {
          status: 'awaiting_user_confirmation',
          note: 'Not applied yet. The user sees a Confirm card for this change.',
          title: preview.title,
          changes: preview.changes,
        };
      }
      const result = await this.tools.runRead(pageId, call.name, call.args);
      const json = JSON.stringify(result ?? null);
      return json.length > MAX_TOOL_RESULT_CHARS
        ? { truncated: true, data: json.slice(0, MAX_TOOL_RESULT_CHARS) }
        : result;
    } catch (err: any) {
      return { error: err?.response?.message ?? err?.message ?? 'Tool failed' };
    }
  }

  private finish(text: string, pending: PendingAction[]): SupportChatResult {
    const reply =
      text.trim() ||
      (pending.length
        ? 'নিচের পরিবর্তনগুলো দেখে Confirm চাপুন 👇'
        : FALLBACK_REPLY);
    return pending.length ? { reply, pendingActions: pending } : { reply };
  }

  private buildSystemPrompt(
    pageContext: string,
    liveData?: Record<string, any>,
  ): string {
    const pageName = PAGE_NAMES[pageContext] ?? '';
    const contextLine = pageName
      ? `\n\n## বর্তমান পেজ:\nব্যবহারকারী এখন "${pageName}" পেজে আছেন। তবে dashboard-এর যেকোনো পেজ সম্পর্কে প্রশ্ন করলে সেটারও উত্তর দাও।`
      : '';
    const dateLine = `\n\n## আজকের তারিখ: ${new Date().toISOString().slice(0, 10)}`;

    let liveDataLine = '';
    if (liveData) {
      const m = liveData?.metrics ?? {};
      const pageName2 = liveData?.page?.businessName || liveData?.page?.pageName || '';
      const uniqueSenders = liveData?.uniqueSenders ?? 0;
      liveDataLine = `

## লাইভ ড্যাশবোর্ড ডেটা (এই তথ্য সরাসরি ব্যবহার করো):
- ব্যবসার নাম: ${pageName2 || 'অজানা'}
- মোট অর্ডার: ${m.totalOrders ?? 0}
- কনফার্মড অর্ডার: ${m.confirmedOrders ?? 0}
- পেন্ডিং অর্ডার: ${m.pendingOrders ?? 0}
- ইস্যু অর্ডার: ${m.issueOrders ?? 0}
- মোট প্রোডাক্ট: ${m.products ?? 0}
- পেন্ডিং কল: ${m.pendingCalls ?? 0}
- কনফার্মড কল: ${m.confirmedCalls ?? 0}
- ফেইলড কল: ${m.failedCalls ?? 0}
- ইউনিক মেসেঞ্জার: ${uniqueSenders}

এই তথ্য দিয়ে সরাসরি উত্তর দাও। অন্য পেজে যেতে বলো না।`;
    }

    return BASE_SYSTEM_PROMPT + contextLine + dateLine + liveDataLine;
  }

  // ── Gemini ────────────────────────────────────────────────────────────────

  /** Gemini's schema dialect: upper-case types, no empty OBJECT properties. */
  private toGeminiSchema(schema: any): any {
    if (!schema || typeof schema !== 'object') return schema;
    const out: any = {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === 'type') out.type = String(v).toUpperCase();
      else if (k === 'properties') {
        out.properties = Object.fromEntries(
          Object.entries(v as any).map(([pk, pv]) => [pk, this.toGeminiSchema(pv)]),
        );
      } else out[k] = v;
    }
    return out;
  }

  private async runGemini(
    message: string,
    history: ChatMessage[],
    systemPrompt: string,
    pageId?: number,
  ): Promise<SupportChatResult> {
    if (!this.geminiKey) throw new Error('No GEMINI_API_KEY');

    const tools = pageId
      ? [
          {
            functionDeclarations: this.tools.declarations().map((d) =>
              Object.keys(d.parameters.properties).length
                ? { name: d.name, description: d.description, parameters: this.toGeminiSchema(d.parameters) }
                : { name: d.name, description: d.description },
            ),
          },
        ]
      : undefined;

    const contents: any[] = [
      ...history.slice(-10).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      { role: 'user', parts: [{ text: message }] },
    ];
    const pending: PendingAction[] = [];

    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${this.geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents,
            ...(tools ? { tools } : {}),
            // thinkingBudget: 0 — avoid "thinking" eating the output budget
            // and truncating the reply.
            generationConfig: { maxOutputTokens: 900, temperature: 0.4, thinkingConfig: { thinkingBudget: 0 } },
          }),
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!res.ok) throw new Error(`Gemini ${res.status}`);
      const data = await res.json();
      const content = data?.candidates?.[0]?.content;
      const parts: any[] = content?.parts ?? [];
      const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
      const text = parts.map((p) => p.text ?? '').join('').trim();

      if (!calls.length || !pageId) {
        if (!text && !pending.length) throw new Error('Gemini returned empty response');
        return this.finish(text, pending);
      }

      // Echo the model turn back unchanged (keeps any thought signatures).
      contents.push(content);
      const responses: any[] = [];
      for (const c of calls) {
        const result = await this.runTool(pageId, { name: c.name, args: c.args ?? {} }, pending);
        responses.push({ functionResponse: { name: c.name, response: { result } } });
      }
      contents.push({ role: 'user', parts: responses });
    }
    return this.finish('', pending);
  }

  // ── OpenAI ────────────────────────────────────────────────────────────────

  private async runOpenAI(
    message: string,
    history: ChatMessage[],
    systemPrompt: string,
    pageId?: number,
  ): Promise<SupportChatResult> {
    if (!this.openaiKey) throw new Error('No OPENAI_API_KEY');

    const tools = pageId
      ? this.tools.declarations().map((d) => ({ type: 'function', function: d }))
      : undefined;
    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];
    const pending: PendingAction[] = [];

    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 900,
          temperature: 0.4,
          messages,
          ...(tools ? { tools } : {}),
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}`);
      const data = await res.json();
      const msg = data?.choices?.[0]?.message;
      const calls: any[] = msg?.tool_calls ?? [];
      const text = String(msg?.content ?? '').trim();

      if (!calls.length || !pageId) {
        if (!text && !pending.length) throw new Error('OpenAI returned empty response');
        return this.finish(text, pending);
      }

      messages.push(msg);
      for (const c of calls) {
        let args: any = {};
        try {
          args = JSON.parse(c.function?.arguments || '{}');
        } catch {
          /* leave empty — the tool will report missing fields */
        }
        const result = await this.runTool(pageId, { name: c.function?.name, args }, pending);
        messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
      }
    }
    return this.finish('', pending);
  }
}
