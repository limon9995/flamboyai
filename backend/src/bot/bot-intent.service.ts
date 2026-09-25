import { Injectable } from '@nestjs/common';

@Injectable()
export class BotIntentService {
  private readonly KW = {
    size: ['size', 'সাইজ', 'body', 'kon size', 'ki size'],
    photo: ['photo', 'pic', 'picture', 'chobi', 'ছবি', 'image'],
    deliveryFee: [
      'delivery charge',
      'delivery fee',
      'charge koto',
      'ডেলিভারি চার্জ',
      'delivery cost',
      'courier charge',
      'dalivary charge',
    ],
    deliveryTime: [
      'delivery kobe',
      'kebe pabo',
      'koto din',
      'delivery time',
      'কবে পাব',
      'কত দিন',
      'koto dine',
      'kobe pabo',
    ],
    // Strong confirm — checked globally (not too generic)
    // NOTE: 'hoy', 'hoi', 'হবে', 'চলবে', 'রাজি' removed — too common in Bengali sentences
    // (e.g. "delivery kobe hoy?" → was triggering CONFIRM). They remain in confirmWeak (awaitingConfirm only).
    confirm: [
      'yes',
      'hea',
      'hum',
      'ji',
      'হ্যাঁ',
      'জি',
      'confirm',
      'done',
      'ok',
      'okay',
      'okey',
      'okk',
      'thik ase',
      'thik ache',
      'hobe confirm',
      'order confirm',
      'ok confirm',
      'ha thik',
      'haa thik',
      'confirmed',
      'agree',
      'accept',
      'approved',
      'chalao',
      'chaliye dao',
      'ready',
      'all ok',
      'all good',
      'ঠিক আছে হ্যাঁ',
      'ঠিক আছে',
      'আচ্ছা',
    ],
    // Weak confirm — only checked when awaitingConfirm=true (order summary shown)
    confirmWeak: [
      'order confirm',
      'confirm korbo',
      'confirm koren',
      'confirm koro',
      'pathao',
      'pathiye den',
      'pathiye daw',
      'order dao',
      'order de',
      'order daw',
      'order pathao',
      'hoye gese',
      'hoye geche',
      'kore dao',
      'kore den',
      'kore daw',
      'অর্ডার কনফার্ম',
      'অর্ডার কনফার্ম করুন',
      'অর্ডার করো',
      'পাঠাও',
      'পাঠান',
    ],
    cancel: [
      'cancel',
      'cancel order',
      'order cancel',
      'cancel kore den',
      'cancel koro',
      'lagbe na',
      'na lagbe na',
      'nibo na',
      'nebe na',
      'nebo na',
      'chai na',
      'chaina',
      'dorkar nai',
      'dorkar nei',
      'bad den',
      'bad koro',
      'bad daw',
      'bad do',
      'sob bad',
      'delete koro',
      'clear koro',
      'eta chai na',
      'oita chai na',
      'rakhe den',
      'বাতিল',
      'বাতিল করুন',
      'বাতিল করো',
      'বাদ',
      'বাদ দিন',
      'বাদ দাও',
      'চাই না',
      'লাগবে না',
      'নেব না',
      'নিব না',
      'ক্যান্সেল',
      'দরকার নেই',
      'দরকার নাই',
      'মাফ করবেন',
      // negated order/buy forms — must catch before 'oder'/'kinbo' hit ORDER_INTENT
      'krbo na',
      'korbo na',
      'krbona',
      'korbona',
      'order na',
      'oder na',
      'kinbo na',
      'kinbona',
      'buy korbo na',
      'buy korbona',
    ],
    order: [
      // Banglish — order intent
      // NOTE: 'nibo' removed — "pore nibo" / "na nibo" were wrongly triggering ORDER
      // NOTE: 'nebo' removed — same issue; compound forms below cover real order intent
      'kinbo',
      'lagbe',
      'order korbo',
      'order korte chai',
      'order korte cai',
      'order dite chai',
      'order dite cai',
      'order nibo',
      'order nite chai',
      'order nite cai',
      'order hobe',
      'order kora jabe',
      'order please',
      // typo variants
      'oder',
      'oder korbo',
      'oder korte cai',
      'oder korte chai',
      'oder dite cai',
      'oder nibo',
      'ordar korbo',
      'ordar korte cai',
      'ordar dite cai',
      'ordar nibo',
      'oda korte cai',
      'oda dite cai',
      'oda nibo',
      // buy/purchase
      'buy korbo',
      'buy korte cai',
      'buy korte chai',
      'purchase korbo',
      'kinte cai',
      'kinte chai',
      // confirm order
      'order confirm',
      'confirm korbo',
      'confirm korte cai',
      'book korbo',
      'booking dibo',
      // Bengali
      'অর্ডার করব',
      'অর্ডার করতে চাই',
      'অর্ডার দেব',
      'অর্ডার নেব',
      'কিনব',
      // NOTE: 'নেব', 'নিব' removed — "পরে নিব"/"না নিব" were wrongly triggering ORDER
      // common short forms
      'need this',
      'want this',
      'eta order korte chai',
      'eta nibo',
      'oita nibo',
    ],
    negotiation: [
      'last price',
      'best price',
      'kom hobe',
      'discount',
      'কম হবে',
      'discount den',
      'final price',
      'price kom',
      'aro kom',
      'ektu kom',
    ],
    edit: [
      // generic
      'change',
      'update',
      'edit',
      'modify',
      'correct',
      'badlao',
      'badla',
      'thik koro',
      'thik koren',
      // field-specific — name
      'name change',
      'naam change',
      'name ta change',
      'naam ta change',
      'name badlao',
      'naam badlao',
      'name ta badlao',
      'নাম বদলাও',
      'নাম পরিবর্তন',
      'নাম চেঞ্জ',
      // field-specific — phone
      'phone change',
      'number change',
      'mobile change',
      'phone ta change',
      'phone number change',
      'number ta change',
      'number badlao',
      'ফোন চেঞ্জ',
      'নম্বর চেঞ্জ',
      'ফোন বদলাও',
      // field-specific — address
      'address change',
      'address ta change',
      'thikana change',
      'thikana badlao',
      'address badlao',
      'location change',
      'নতুন ঠিকানা',
      'ঠিকানা চেঞ্জ',
      'ঠিকানা বদলাও',
      // wrong / incorrect
      'bhul',
      'bul',
      'ভুল',
      'wrong',
      'thik nai',
      'thik na',
      'thik hoi nai',
      'ঠিক না',
      'ঠিক নাই',
      'ভুল আছে',
      'bhul ache',
      'bhul disi',
      'bhul hoise',
      // variant / product options
      'size change',
      'color change',
      'colour change',
      'rong change',
      'onno size',
      'onno color',
      'onno rong',
      'অন্য সাইজ',
      'অন্য কালার',
      'change korte chai',
      'change korte cai',
      'badlate chai',
      'badlate cai',
    ],
    catalogRequest: [
      // Banglish
      'ki ki ase',
      'ki ki ace',
      'ki ki ache',
      'ki ki product',
      'ki ki dress',
      'ki ki item',
      'ki ase',
      'ki ace',
      'ki ache',
      'products ase',
      'products ace',
      'products ache',
      'dress ase',
      'dress ace',
      'dress ache',
      'items ase',
      'items ace',
      'items ache',
      'ki ki available',
      'available products',
      'available dress',
      'sob product',
      'sob item',
      'sob dress',
      'sobar product',
      'product list',
      'dress list',
      'item list',
      'product dekhai',
      'catalog',
      'catalogue',
      'catalog daw',
      'catalog den',
      'catalog dao',
      'product dekhabo',
      'konta ase',
      'konta ace',
      'konta ache',
      'kon product ase',
      'kon product ace',
      'kon product ache',
      'kon dress ase',
      'kon dress ache',
      'ki ki pawa jay',
      'ki ki paben',
      'ki ki newa jay',
      'ki cholche',
      'new arrival',
      'new collection',
      'latest product',
      'sob dekhao',
      'sob dekhan',
      'full list',
      'all product',
      'all dress',
      'website link',
      'website link deo',
      'website link den',
      'website link dao',
      'website er link',
      'shop link',
      'shop er link',
      'link deo',
      'link den',
      'link dao',
      // Bengali
      'কি কি আছে',
      'কী কী আছে',
      'কি আছে',
      'কী আছে',
      'সব প্রোডাক্ট',
      'সব পণ্য',
      'পণ্য তালিকা',
      'ক্যাটালগ',
      'কি কি পাওয়া যায়',
      'কোনটা আছে',
      'নতুন পণ্য',
      'ওয়েবসাইট লিংক',
      'ওয়েবসাইট',
      'লিংক দাও',
      'লিংক দিন',
    ],
    greeting: [
      'assalamu alaikum',
      'assalamualaikum',
      'salam',
      'salaam',
      'aslam',
      'aslam u alaikum',
      'as salam',
      'walaikum assalam',
      'সালাম',
      'আসালামু আলাইকুম',
    ],
    hesitation: [
      'apore janabo',
      'ekhon lagbe na',
      'vhebe dekhi',
      'por e nibo',
      'pore janabo',
      'ektu pore',
      'vebe dekhchi',
    ],
    fabricType: [
      'fabric',
      'kapor',
      'material',
      'কাপড়',
      'kapar',
      'kemon kapar',
    ],
    // FIX: more specific multi-confirm words
    multiConfirm: [
      'sobgulo nibo',
      'duto nibo',
      'tinto nibo',
      'all nibo',
      'sob nibo',
      'duita nibo',
      'tinta nibo',
    ],
  };

  detectIntent(text: string, awaitingConfirm: boolean): string | null {
    const t = (text || '').toLowerCase().trim();
    if (!t) return null;
    if (this.includesAny(t, this.KW.greeting)) return 'GREETING';
    if (this.includesAny(t, this.KW.catalogRequest)) return 'CATALOG_REQUEST';

    // CANCEL: keyword list first, then regex negation catch-all
    // Regex catches: "oder krbo na", "order korbo na", "kinbo na", "buy korbo na", etc.
    // — must run BEFORE ORDER_INTENT so negated forms don't fall through
    if (this.includesAny(t, this.KW.cancel)) return 'CANCEL';
    if (this.isNegatedOrderIntent(t)) return 'CANCEL';

    if (this.includesAny(t, this.KW.negotiation) || this.looksLikeOffer(t))
      return 'NEGOTIATION';
    if (this.includesAny(t, this.KW.edit)) return 'EDIT_ORDER';
    if (this.includesAny(t, this.KW.hesitation)) return 'SOFT_HESITATION';
    if (this.includesAny(t, this.KW.order)) return 'ORDER_INTENT';
    if (this.includesAny(t, this.KW.size)) return 'SIZE_REQUEST';
    if (this.includesAny(t, this.KW.photo)) return 'PHOTO_REQUEST';
    if (this.includesAny(t, this.KW.deliveryTime)) return 'DELIVERY_TIME';
    if (this.includesAny(t, this.KW.deliveryFee)) return 'DELIVERY_FEE';
    if (this.includesAny(t, this.KW.fabricType)) return 'FABRIC_TYPE';
    if (this.extractRemoveCode(t)) return 'ORDER_REMOVE_ITEM';
    if (awaitingConfirm && this.includesAny(t, this.KW.multiConfirm))
      return 'MULTI_CONFIRM';
    // "ok" / "okay" / "thik" — only CONFIRM when bot is awaiting order confirmation.
    // Standalone "ok" during field capture (name/phone/address step) → null → treated as field input.
    if (awaitingConfirm && this.includesAny(t, this.KW.confirm))
      return 'CONFIRM';
    if (awaitingConfirm && this.includesAny(t, this.KW.confirmWeak))
      return 'CONFIRM';
    return null;
  }

  extractSingleCode(text: string, prefix = 'DF'): string | null {
    const t = String(text || '').toUpperCase();
    const p = prefix.toUpperCase();
    const match = t.match(new RegExp(`\\b${p}\\s*[-]?\\s*(\\d{1,6})\\b`));
    if (!match) return null;
    return `${p}-${match[1].padStart(4, '0')}`;
  }

  extractAllCodes(text: string, prefix = 'DF'): string[] {
    const t = String(text || '').toUpperCase();
    const p = prefix.toUpperCase();
    const matches = [...t.matchAll(new RegExp(`\\b${p}\\s*[-]?\\s*(\\d{1,6})\\b`, 'g'))];
    return [...new Set(matches.map((m) => `${p}-${m[1].padStart(4, '0')}`))];
  }

  extractQuantityMap(text: string, prefix = 'DF'): Map<string, number> {
    const result = new Map<string, number>();
    const t = String(text || '').toUpperCase();
    const p = prefix.toUpperCase();
    const pattern = new RegExp(
      `\\b${p}\\s*[-]?\\s*(\\d{1,6})\\b\\s*(\\d+)\\s*(?:TA|TI|টা|টি|PCS|X)?`,
      'gi',
    );
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(t)) !== null) {
      const code = `${p}-${match[1].padStart(4, '0')}`;
      const qty = parseInt(match[2], 10);
      if (qty > 0) result.set(code, qty);
    }
    return result;
  }

  extractRemoveCode(text: string, prefix = 'DF'): string | null {
    const t = String(text || '').toLowerCase();
    if (!/\b(bad|lagbe na|remove|bad den)\b/.test(t)) return null;
    return this.extractSingleCode(text, prefix);
  }

  extractOfferedPrice(text: string): number | null {
    const t = String(text || '').toLowerCase();

    // FIX: skip if text contains a product code pattern — avoids DF-0042 → 42 false positive
    if (/\b[a-z]{2,6}[-_]?\d{3,8}\b/i.test(t)) return null;

    // Explicit price patterns with currency markers
    const explicit = t.match(
      /(?:^|\s)(\d{3,6})\s*(?:tk|taka|৳|takar|te dibo|dile nibo|hole nibo|dile|hole|taka dibo)/i,
    );
    if (explicit) {
      const v = Number(explicit[1]);
      return Number.isFinite(v) && v >= 100 && v <= 100000 ? v : null;
    }

    // Offer pattern: "800 te nibo", "600 hole ok"
    const offer = t.match(
      /(\d{3,6})\s*(?:te|hole|theke|teke)\s*(?:nibo|ok|hobe|nile|debe)/i,
    );
    if (offer) {
      const v = Number(offer[1]);
      return Number.isFinite(v) && v >= 100 && v <= 100000 ? v : null;
    }

    return null;
  }

  isSideQuestion(intent: string | null): boolean {
    return [
      'SIZE_REQUEST',
      'PHOTO_REQUEST',
      'DELIVERY_TIME',
      'DELIVERY_FEE',
      'FABRIC_TYPE',
    ].includes(intent || '');
  }

  /**
   * Detects negated order intent — e.g. "oder krbo na", "order korbo na", "kinbo na".
   * Catches cases where an order keyword appears within ~20 chars of a trailing "na"/"না".
   * Runs BEFORE ORDER_INTENT check so positive keywords don't fire on negated sentences.
   */
  private isNegatedOrderIntent(text: string): boolean {
    // Banglish: order/oder/kinbo/buy/purchase + optional words (≤20 chars) + "na"
    if (
      /\b(order|oder|ordar|oda|kinbo|kinte|buy|purchase)\b.{0,20}\bna\b/.test(
        text,
      )
    )
      return true;
    // Bengali: অর্ডার/কিনব/নেব + না
    if (/(অর্ডার|কিনব|নেব|নিব).{0,10}না/.test(text)) return true;
    return false;
  }

  private looksLikeOffer(text: string): boolean {
    return /\d{2,6}\s*(dile|te|hole|taka dile|tk dile)\s*(nibo|hobe|nile|ok)/.test(
      text,
    );
  }

  private includesAny(text: string, keywords: string[]): boolean {
    return keywords.some((k) => text.includes(k));
  }

  // ── AI comment classification (shared by Facebook + Instagram) ───────────

  async classifyComment(
    products: { code: string; name: string | null; price: number; stockQty: number }[],
    comment: string,
  ): Promise<{ productCodes: string[]; intent: string; shouldReply: boolean }> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { productCodes: [], intent: 'other', shouldReply: true };
    const model = process.env.AI_INTENT_MODEL || 'gemini-3.5-flash-lite';

    const productList = products.length > 0
      ? products.map((p, i) => `${i + 1}. ${p.code}: ${p.name ?? p.code} (দাম ${p.price}৳, stock: ${p.stockQty > 0 ? p.stockQty + 'টি' : 'নেই'})`).join('\n')
      : '(কোনো product নেই)';

    const systemPrompt = `You are a Facebook comment handler for a Bengali e-commerce store.
Given a customer comment and a numbered product list, decide:
1. Is this worth replying to?
2. Which product code(s) is the customer asking about?
3. What info do they want?

Return ONLY valid JSON:
{
  "shouldReply": true,
  "productCodes": [],
  "intent": "price"|"stock"|"delivery"|"description"|"all_prices"|"emoji_praise"|"other"
}

Rules:
- shouldReply=true: ALWAYS — reply to every single comment, no exceptions
- productCodes=[]: general question, emoji/praise, or intent is "all_prices"
- productCodes=["X"]: one specific product (identified by name, color, number reference like "৩ নম্বর", or code)
- productCodes=["X","Y"]: customer asks about multiple specific products
- intent="all_prices": user wants prices of ALL products ("সবগুলোর দাম কত?" "price list দাও")
- intent="emoji_praise": pure emojis (❤️🔥😍) or simple praise (nice, wow, সুন্দর, ভালো, great) with no product question
- intent="other": general question not about a specific product info → inbox CTA`;

    try {
      const body = {
        contents: [{ role: 'user', parts: [{ text: `Available products:\n${productList}\n\nCustomer comment: "${comment}"` }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { temperature: 0.1, maxOutputTokens: 150, responseMimeType: 'application/json' },
      };
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) return this._classifyCommentOpenAI(systemPrompt, productList, comment);
      const data = await res.json();
      const parsed = JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}');
      if (!Array.isArray(parsed.productCodes)) {
        parsed.productCodes = parsed.productCode ? [parsed.productCode] : [];
      }
      return parsed;
    } catch {
      return this._classifyCommentOpenAI(systemPrompt, productList, comment);
    }
  }

  private async _classifyCommentOpenAI(
    systemPrompt: string,
    productList: string,
    comment: string,
  ): Promise<{ productCodes: string[]; intent: string; shouldReply: boolean }> {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) return { productCodes: [], intent: 'other', shouldReply: true };
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.1,
          max_tokens: 150,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Available products:\n${productList}\n\nCustomer comment: "${comment}"` },
          ],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { productCodes: [], intent: 'other', shouldReply: true };
      const data = await res.json();
      const parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? '{}');
      if (!Array.isArray(parsed.productCodes)) {
        parsed.productCodes = parsed.productCode ? [parsed.productCode] : [];
      }
      return parsed;
    } catch {
      return { productCodes: [], intent: 'other', shouldReply: true };
    }
  }
}
