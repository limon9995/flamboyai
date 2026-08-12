import { Injectable, Logger } from '@nestjs/common';
import { estimateMonthlyCost, PricingCalcInput } from '../common/pricing-estimator';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `তুমি FlamboyAI-এর customer service assistant। FlamboyAI হলো Bangladeshi Facebook seller দের জন্য একটি Messenger automation platform।

তুমি যা জানো:
- FlamboyAI কী করে: Facebook Messenger-এ automatically order নেয়, AI দিয়ে product detect করে, courier book করে (Pathao/Steadfast/RedX/Paperfly), accounting করে
- Platform fee: আলোচনা সাপেক্ষ (page size ও ব্যবহার অনুযায়ী admin এর সাথে deal হবে) + prepaid AI wallet (text ৳০.০৫, voice ৳১.০০, image ৳০.২০)
- Setup fee: একবার ৳২,০০০ — আমাদের team সব setup করে দেবে (Facebook connect, product add, bot configure সব)। তবে যদি নিজে setup করতে চান, website-এ সব guide দেওয়া আছে — সেক্ষেত্রে setup fee একদম FREE।
- Features: bot automation, OCR (ছবি থেকে product code), AI image recognition, CRM, broadcast, courier integration
- শুরু করতে: flamboyai.com তে গিয়ে "শুরু করুন" বাটনে ক্লিক করুন অথবা WhatsApp করুন: 01575897887

উত্তর দেবে Bengali বা Banglish-এ — যে ভাষায় customer লিখবে সেই ভাষায়। Concise ও friendly থাকো। না জানলে support-এ যোগাযোগ করতে বলো (info@flamboyai.com)।

## Pricing প্রশ্নের জন্য বিশেষ নিয়ম
Customer যদি "koto customer/message hole koto cost hobe" ধরনের নির্দিষ্ট cost জানতে চায় (শুধু general platform fee না, বরং তাদের নিজের volume অনুযায়ী হিসাব):
1. না জানা থাকলে জিজ্ঞেস করো: প্রতিদিন কতজন customer message পাঠায়, প্রতি customer গড়ে কয়টা message পাঠায়, আর কয়টা ছবি পাঠায়।
2. তিনটা সংখ্যাই পেয়ে গেলে "calculatePricing" field-এ সেই সংখ্যাগুলো বসাও। এক্ষেত্রে "reply"-তে শুধু ছোট্ট একটা লাইন লিখো যেমন "ধন্যবাদ! আপনার হিসাব রেডি —" — নিজে numbers বা assumption নিয়ে কিছু লিখো না, exact টাকার হিসাব আমাদের system আলাদাভাবে জুড়ে দেবে।

**সবসময় শুধু এই strict JSON ফরম্যাটে reply দেবে, অন্য কিছু না:**
{"reply": "<Bangla/Banglish reply text>", "calculatePricing": null}

অথবা volume জানা থাকলে:
{"reply": "<short reply>", "calculatePricing": {"customersPerDay": number, "msgsPerCustomer": number, "imagesPerCustomer": number}}`;

const FALLBACK_REPLY =
  'দুঃখিত, এই মুহূর্তে উত্তর দিতে পারছি না। একটু পরে আবার চেষ্টা করুন 🙏';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly openaiApiKey: string;

  constructor() {
    this.openaiApiKey = process.env.OPENAI_API_KEY ?? '';
  }

  async chat(message: string, history: ChatMessage[]): Promise<string> {
    const messages: ChatMessage[] = [
      ...history.slice(-8),
      { role: 'user', content: message },
    ];
    try {
      return await this.callOpenAI(messages);
    } catch (err: any) {
      this.logger.error(`[Chat] OpenAI failed: ${err?.message ?? err}`);
      return FALLBACK_REPLY;
    }
  }

  private async callOpenAI(messages: ChatMessage[]): Promise<string> {
    if (!this.openaiApiKey) return FALLBACK_REPLY;
    this.logger.log('[Chat] OpenAI gpt-4o-mini');

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 300,
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const data = await res.json();
    const raw = (data?.choices?.[0]?.message?.content ?? '').trim();
    if (!raw) return FALLBACK_REPLY;

    return this.finalizeReply(raw);
  }

  private finalizeReply(raw: string): string {
    try {
      const parsed = JSON.parse(raw);
      const reply = String(parsed?.reply ?? '').trim() || FALLBACK_REPLY;
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

      return calculatePricing
        ? `${reply}\n\n${estimateMonthlyCost(calculatePricing)}`
        : reply;
    } catch {
      // Model didn't return valid JSON — fall back to the raw text so the
      // widget still gets something useful instead of an error.
      return raw;
    }
  }
}
