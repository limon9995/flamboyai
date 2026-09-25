import { Injectable, Logger } from '@nestjs/common';
import { ApiKeysService } from '../../common/api-keys.service';
import { GeminiKeyRotatorService } from '../../common/gemini-key-rotator.service';
import axios from 'axios';
import { readFile } from 'fs/promises';
import { join, extname } from 'path';
import {
  VisionAnalysisProvider,
  VisionAttributes,
} from '../vision-analysis.interface';

// Keep in sync with restaurant.service.ts's VALID_UNITS
const MENU_SCAN_VALID_UNITS = ['gm', 'kg', 'pcs', 'ml', 'liter'];

@Injectable()
export class GeminiVisionProvider implements VisionAnalysisProvider {
  private readonly logger = new Logger(GeminiVisionProvider.name);
  private readonly model: string;

  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly rotator: GeminiKeyRotatorService,
  ) {
    this.model = apiKeysService.getSync('visionModel') || 'gemini-3.5-flash';
  }

  private getKey(): string {
    return this.rotator.getKey() ?? this.apiKeysService.getSync('geminiApiKey');
  }

  private buildCodeExtractionPrompt(prefix: string): string {
    return `Look at this image and find any product code or item code text visible.
Product codes look like: "${prefix}-001", "${prefix} 123", "${prefix}.456" — letters followed by numbers.
The prefix is typically "${prefix}" but may vary slightly.
Return ONLY a valid JSON array of codes found. If none, return [].
Examples: ["${prefix}-001"] or ["${prefix}-023", "XY-456"] or []
Respond with ONLY the JSON array — no other text, no markdown.`;
  }

  async extractProductCodes(
    imageUrl: string,
    prefix: string,
  ): Promise<string[]> {
    const apiKey = this.getKey();
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
    const dataUrl = await this.toBase64DataUrl(imageUrl);
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    const mimeType = match?.[1] ?? 'image/jpeg';
    const data = match?.[2] ?? '';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${apiKey}`;
    const t0 = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: this.buildCodeExtractionPrompt(prefix) },
              { inlineData: { mimeType, data } },
            ],
          },
        ],
        // thinkingBudget: 0 — see note in callAPIWithKey; without it, "thinking"
        // tokens can silently eat the whole budget and truncate the output.
        generationConfig: {
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 200,
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const err = await response.text().catch(() => String(response.status));
      this.rotator.markError(apiKey, response.status, err.slice(0, 100));
      throw new Error(
        `Gemini extractCodes error ${response.status}: ${err.slice(0, 100)}`,
      );
    }
    this.rotator.markSuccess(apiKey, Date.now() - t0);
    const resp = await response.json();
    const content: string =
      resp?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
    try {
      const arr = JSON.parse(this.extractJson(content));
      return Array.isArray(arr)
        ? arr.filter((c: any) => typeof c === 'string')
        : [];
    } catch {
      return [];
    }
  }

  private buildPrompt(multi: boolean): string {
    return `You are an expert product analyzer for a Bangladeshi e-commerce store that sells all kinds of products, not just clothing.
${
  multi
    ? 'You are given multiple photos of the SAME product from different angles. Analyze ALL images together and provide a comprehensive description that captures every visible detail.'
    : 'Analyze this product image.'
}
Respond ONLY with a valid JSON object (no markdown, no explanation).

Required JSON format:
{
  "category": "<if this is a clothing item, one of: dress, saree, panjabi, shirt, t-shirt, kurti, tops, lehenga, salwar_kameez, three_piece, other_clothing — if it is NOT clothing, never say 'non_clothing'; instead name the actual product type in 1-2 words, e.g. 'lamp', 'watch', 'handbag', 'mug', 'toy', 'shoes', 'electronics', 'furniture'>",
  "color": "<primary color: black, white, red, blue, green, yellow, orange, pink, purple, maroon, navy, grey, multicolor, beige, cream, golden, silver>",
  "pattern": "<one of: plain, printed, floral, embroidered, striped, checked, geometric, abstract, solid>",
  "sleeveType": "<one of: full, half, three_quarter, sleeveless, null if not visible>",
  "gender": "<one of: women, men, unisex, null if uncertain>",
  "confidence": <number 0.0 to 1.0 — your overall certainty>,
  "rawDescription": "<${
    multi
      ? 'comprehensive 2-3 sentence description covering all visible angles, fabric texture, design details, embellishments, and distinctive visual features'
      : 'one sentence natural description'
  } in English>",
  "visibleText": "<any readable text on the product, label, tag, packaging, or price sticker — copied as accurately as possible, or null if no text is visible>",
  "nameGuess": "<a short product name — use a brand/product name if printed on the item, otherwise a concise descriptive name (e.g. 'Blue Ceramic Table Lamp'), or null if you cannot form a reasonable name>",
  "priceGuess": <number — ONLY if a price is clearly printed/visible on a tag or sticker in the image, else null>,
  "sizeGuess": "<size, dimensions, weight, or volume text if visible (e.g. 'M', '30cm', '500ml', '1kg'), else null>"
}

Rules:
- If images are clearly visible and recognizable, confidence should be >= 0.6
- Only set confidence <= 0.1 for extremely blurry images where you cannot make out the subject at all
- For full-body model shots, focus on the clothing details and maintain high confidence if product is clear
- For non-clothing items (bags, shoes, accessories), still analyze and set confidence based on image clarity
- Do NOT guess gender unless clearly evident from the product style
- Be honest about uncertainty but do NOT penalize clear images with low confidence
- visibleText/nameGuess/priceGuess/sizeGuess must be based ONLY on what's actually visible in the image — never invent numbers or text that aren't printed/shown`;
  }

  private extractJson(content: string): string {
    const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) return fenceMatch[1].trim();
    const objMatch = content.match(/\{[\s\S]*\}/);
    if (objMatch) return objMatch[0];
    return content.trim();
  }

  private parseResponse(content: string): VisionAttributes {
    const json = this.extractJson(content);
    const parsed = JSON.parse(json) as Partial<VisionAttributes>;
    return {
      category: parsed.category ?? null,
      color: parsed.color ?? null,
      pattern: parsed.pattern ?? null,
      sleeveType: parsed.sleeveType ?? null,
      gender: parsed.gender ?? null,
      confidence:
        typeof parsed.confidence === 'number'
          ? Math.min(1, Math.max(0, parsed.confidence))
          : 0,
      rawDescription: parsed.rawDescription ?? content,
      visibleText: parsed.visibleText ?? null,
      nameGuess: parsed.nameGuess ?? null,
      priceGuess:
        typeof parsed.priceGuess === 'number' ? parsed.priceGuess : null,
      sizeGuess: parsed.sizeGuess ?? null,
    };
  }

  private extToMime(ext: string): string {
    const map: Record<string, string> = {
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };
    return map[ext.toLowerCase()] ?? 'image/jpeg';
  }

  private async toBase64DataUrl(url: string): Promise<string> {
    const storagePath = url.match(/\/storage\/(.+)$/)?.[1];
    if (storagePath) {
      const abs = join(process.cwd(), 'storage', storagePath);
      try {
        const buffer = await readFile(abs);
        const mime = this.extToMime(extname(abs));
        this.logger.log(`[GeminiVision] Read local file: ${abs}`);
        return `data:${mime};base64,${buffer.toString('base64')}`;
      } catch (e: any) {
        this.logger.warn(
          `[GeminiVision] Local read failed (${e?.message}), falling back to HTTP`,
        );
      }
    }

    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 15_000,
    });
    const mimeRaw = String(response.headers['content-type'] ?? 'image/jpeg')
      .split(';')[0]
      .trim();
    const mime = mimeRaw.startsWith('image/') ? mimeRaw : 'image/jpeg';
    return `data:${mime};base64,${Buffer.from(response.data).toString('base64')}`;
  }

  private async callAPI(imageUrls: string[]): Promise<VisionAttributes> {
    // Retry with different keys on 429
    const maxAttempts = Math.min(this.rotator.getStatus().total || 1, 4);
    let lastError: Error = new Error('No keys available');
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.callAPIWithKey(imageUrls);
      } catch (err: any) {
        lastError = err;
        if (!err.message?.includes('429') && !err.message?.includes('quota'))
          break;
        // 429 — rotator already marked this key; try next
      }
    }
    throw lastError;
  }

  private async callAPIWithKey(imageUrls: string[]): Promise<VisionAttributes> {
    const apiKey = this.getKey();
    const isMulti = imageUrls.length > 1;
    const dataUrls = await Promise.all(
      imageUrls.map((u) => this.toBase64DataUrl(u)),
    );

    // Gemini uses inlineData with raw base64 (no data URL prefix)
    const imageParts = dataUrls.map((dataUrl) => {
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      const mimeType = match?.[1] ?? 'image/jpeg';
      const data = match?.[2] ?? dataUrl;
      return { inlineData: { mimeType, data } };
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${apiKey}`;
    const t0 = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: this.buildPrompt(isMulti) }, ...imageParts],
          },
        ],
        generationConfig: {
          // gemini-2.5-flash spends part of maxOutputTokens on internal "thinking"
          // before writing the actual JSON — without disabling it, a low budget
          // (or a request that makes it "think" more, e.g. more images) can burn
          // the whole budget on thinking and truncate the JSON output mid-string.
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: isMulti ? 900 : 500,
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errText = await response.text();
      const msg = `Gemini API error ${response.status}: ${errText.slice(0, 200)}`;
      this.logger.error(`[GeminiVision] ${msg}`);
      this.rotator.markError(apiKey, response.status, errText.slice(0, 100));
      throw new Error(msg);
    }
    this.rotator.markSuccess(apiKey, Date.now() - t0);

    const data = await response.json();
    const content: string =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    this.logger.log(
      `[GeminiVision] Response (${imageUrls.length} imgs): ${content.slice(0, 300)}`,
    );
    return this.parseResponse(content);
  }

  async analyze(imageUrl: string): Promise<VisionAttributes> {
    if (!this.getKey()) {
      this.logger.warn(
        '[GeminiVision] No Gemini key available — returning zero confidence',
      );
      return this.emptyResult('GEMINI_API_KEY not configured');
    }
    // Let errors propagate so callers can fall back to another provider
    return this.callAPI([imageUrl]);
  }

  async analyzeMultiple(imageUrls: string[]): Promise<VisionAttributes> {
    if (!this.getKey()) {
      this.logger.warn(
        '[GeminiVision] No Gemini key available — returning zero confidence',
      );
      return this.emptyResult('GEMINI_API_KEY not configured');
    }
    if (!imageUrls.length) return this.emptyResult('No images provided');
    if (imageUrls.length === 1) return this.analyze(imageUrls[0]);

    const urls = imageUrls.slice(0, 5);
    this.logger.log(`[GeminiVision] Multi-angle: ${urls.length} images`);
    // Let errors propagate so callers can fall back to another provider
    return this.callAPI(urls);
  }

  private emptyResult(reason: string): VisionAttributes {
    return {
      category: null,
      color: null,
      pattern: null,
      sleeveType: null,
      gender: null,
      confidence: 0,
      rawDescription: reason,
    };
  }

  // ── V25: Restaurant menu-photo import ───────────────────────────────────────

  private buildMenuPrompt(): string {
    return `You are reading a RESTAURANT MENU photo from Bangladesh (text may be Bengali, English, or Banglish — handle all).
Extract EVERY food/drink item you can read with its price(s).
Respond ONLY with a valid JSON object (no markdown, no explanation).

Required JSON format:
{
  "dishes": [
    {
      "name": "<dish name exactly as written, keep the original language>",
      "category": "<menu section heading this item appears under (e.g. 'Burger', 'Momo', 'Drinks', 'Rice'); if no heading, infer a short 1-2 word food category>",
      "description": "<short description printed under the item, or null>",
      "variants": [
        { "label": "<size/portion label, e.g. '5 pcs', 'Regular', 'Mini', 'Full', 'Half'>", "price": <number>, "pieces": <integer piece count if the label states pieces (e.g. '5 pcs' → 5), else null> }
      ],
      "ingredients": [
        { "name": "<generic, common ingredient this dish is typically made of, e.g. 'Bun', 'Chicken Patty', 'Burger Sauce'>", "qty": <typical quantity as a number>, "unit": "<one of: pcs, gm, kg, ml, liter>" }
      ]
    }
  ]
}

Rules:
- A dish with a single price gets ONE variant: {"label": "Regular", "price": <number>, "pieces": null}
- Prices: numbers only — strip currency symbols (৳, Tk, TK, BDT, /-) and thousands separators. Convert Bengali digits (০১২৩৪৫৬৭৮৯) to numbers.
- If an item has multiple printed prices (e.g. "6 pcs 120 / 12 pcs 220" or "S 80 M 120 L 160"), create one variant per price with the printed label.
- SKIP items whose price is unreadable or missing — do not invent prices.
- Do not merge different dishes; each menu line item is its own dish.
- Keep combos/set menus as single dishes with their printed price.
- "ingredients" is a best-guess starter recipe for kitchen stock tracking, based on common preparation of that dish in Bangladesh — 2 to 6 rows, generic names (not brand names). Leave it an empty array [] when you genuinely can't guess (e.g. a bottled drink, an unfamiliar dish name).`;
  }

  /**
   * Extract dishes from restaurant menu photo(s). Returns [] dishes on
   * unreadable input. `usage` carries Gemini token counts for metering.
   */
  async extractMenuItems(imageUrls: string[]): Promise<{
    dishes: {
      name: string;
      category: string | null;
      description: string | null;
      variants: { label: string; price: number; pieces: number | null }[];
      ingredients: { name: string; qty: number; unit: string }[];
    }[];
    usage: { model: string; promptTokens: number; outputTokens: number };
  }> {
    const apiKey = this.getKey();
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
    const urls = imageUrls.slice(0, 5);
    const dataUrls = await Promise.all(
      urls.map((u) => this.toBase64DataUrl(u)),
    );
    const imageParts = dataUrls.map((dataUrl) => {
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      return {
        inlineData: {
          mimeType: match?.[1] ?? 'image/jpeg',
          data: match?.[2] ?? dataUrl,
        },
      };
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${apiKey}`;
    const t0 = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: this.buildMenuPrompt() }, ...imageParts],
          },
        ],
        generationConfig: {
          // see callAPIWithKey note — thinking silently eats the token budget
          thinkingConfig: { thinkingBudget: 0 },
          // menus can be long — give plenty of room for a big dish list
          maxOutputTokens: 8000,
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const errText = await response.text();
      this.rotator.markError(apiKey, response.status, errText.slice(0, 100));
      throw new Error(
        `Gemini menu-scan error ${response.status}: ${errText.slice(0, 200)}`,
      );
    }
    this.rotator.markSuccess(apiKey, Date.now() - t0);

    const data = await response.json();
    const content: string =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    this.logger.log(
      `[GeminiVision] Menu scan (${urls.length} imgs): ${content.slice(0, 200)}`,
    );

    let dishes: any[] = [];
    try {
      const parsed = JSON.parse(this.extractJson(content));
      dishes = Array.isArray(parsed?.dishes) ? parsed.dishes : [];
    } catch {
      dishes = [];
    }
    // Defensive coercion — never trust model output shapes
    const clean = dishes
      .map((d: any) => {
        const variants = (Array.isArray(d?.variants) ? d.variants : [])
          .map((v: any) => ({
            label: String(v?.label ?? 'Regular').trim() || 'Regular',
            price: Number(v?.price),
            pieces:
              Number.isFinite(Number(v?.pieces)) && Number(v.pieces) > 0
                ? Math.round(Number(v.pieces))
                : null,
          }))
          .filter((v: any) => Number.isFinite(v.price) && v.price > 0);
        const ingredients = (Array.isArray(d?.ingredients) ? d.ingredients : [])
          .map((i: any) => ({
            name: String(i?.name ?? '')
              .trim()
              .slice(0, 80),
            qty: Number(i?.qty),
            unit: String(i?.unit ?? '')
              .trim()
              .toLowerCase(),
          }))
          .filter(
            (i: any) =>
              i.name.length > 0 &&
              Number.isFinite(i.qty) &&
              i.qty > 0 &&
              MENU_SCAN_VALID_UNITS.includes(i.unit),
          )
          .slice(0, 8);
        return {
          name: String(d?.name ?? '').trim(),
          category: d?.category ? String(d.category).trim() : null,
          description: d?.description ? String(d.description).trim() : null,
          variants,
          ingredients,
        };
      })
      .filter((d) => d.name.length > 0 && d.variants.length > 0);

    return {
      dishes: clean,
      usage: {
        model: this.model,
        promptTokens: Number(data?.usageMetadata?.promptTokenCount) || 0,
        outputTokens: Number(data?.usageMetadata?.candidatesTokenCount) || 0,
      },
    };
  }
}
