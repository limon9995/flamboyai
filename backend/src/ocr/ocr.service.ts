import { Injectable, Logger } from '@nestjs/common';
import { ApiKeysService } from '../common/api-keys.service';
import { GeminiKeyRotatorService } from '../common/gemini-key-rotator.service';
import * as Tesseract from 'tesseract.js';
import sharp from 'sharp';
import axios from 'axios';
import https from 'https';

// ── Confidence levels ──────────────────────────────────────────────────────────
export type OcrConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export interface OcrResult {
  text: string;
  codes: string[]; // primary codes (best pass)
  allCodes: string[]; // merged from ALL passes
  confidence: number; // Tesseract confidence 0-100
  method: string;
  captionBoosted: boolean; // customer message text helped
  // Option B fields
  verifiedCodes: VerifiedCode[]; // codes verified against DB postCaption
  ocrConfidence: OcrConfidence; // overall detection confidence level
}

export interface VerifiedCode {
  code: string;
  confidence: OcrConfidence;
  source: 'ocr+caption' | 'ocr_only' | 'caption_only';
  captionMatched: boolean; // DB postCaption confirmed this code
}

// ── In-memory cache — avoids re-running Tesseract on same URL ─────────────────
const ocrCache = new Map<
  string,
  { result: Omit<OcrResult, 'verifiedCodes' | 'ocrConfidence'>; expiry: number }
>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private readonly agent = new https.Agent({
    family: 4,
    rejectUnauthorized: false,
  });

  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly geminiRotator: GeminiKeyRotatorService,
  ) {}

  // ── Public entry point ──────────────────────────────────────────────────────
  async extractTextFromImageUrl(imageUrl: string): Promise<string> {
    const result = await this.extractFull(imageUrl);
    return result.text;
  }

  /**
   * Main OCR method.
   * @param imageUrl      Facebook CDN image URL
   * @param customerText  Optional: text customer sent alongside the image
   * @param pageProducts  Optional: DB products with postCaption for Option B verification
   * @param customPrefix  Optional: page's custom product code prefix (e.g. "SK")
   */
  async extractFull(
    imageUrl: string,
    customerText?: string,
    pageProducts?: Array<{ code: string; postCaption: string | null }>,
    customPrefix?: string,
  ): Promise<OcrResult> {
    // Check cache first (without DB verification — that's applied fresh each time)
    const cached = ocrCache.get(imageUrl);
    const baseResult =
      cached && cached.expiry > Date.now()
        ? (() => {
            this.logger.debug(`[OCR] Cache hit: ${imageUrl}`);
            return cached.result;
          })()
        : await this.runAllPasses(imageUrl, customPrefix);

    // Apply customer text boost (merge codes from customer message)
    const withCustomer = customerText
      ? this.applyCustomerTextBoost(baseResult, customerText, customPrefix)
      : baseResult;

    // Option B: verify codes against DB product postCaptions
    const verifiedCodes = this.verifyCodesAgainstCaptions(
      withCustomer.allCodes,
      withCustomer.text,
      customerText,
      pageProducts ?? [],
    );

    const ocrConfidence = this.computeOverallConfidence(
      verifiedCodes,
      withCustomer,
    );

    this.logger.log(
      `[OCR] allCodes=[${withCustomer.allCodes.join(',')}] ` +
        `verified=[${verifiedCodes.map((v) => `${v.code}:${v.confidence}`).join(',')}] ` +
        `overall=${ocrConfidence}`,
    );

    return { ...withCustomer, verifiedCodes, ocrConfidence };
  }

  // ── Run all preprocessing passes ────────────────────────────────────────────
  private async runAllPasses(
    imageUrl: string,
    customPrefix?: string,
  ): Promise<Omit<OcrResult, 'verifiedCodes' | 'ocrConfidence'>> {
    let rawBuffer: Buffer;
    try {
      rawBuffer = await this.downloadImage(imageUrl);
    } catch (err) {
      this.logger.error(`[OCR] Image download failed: ${imageUrl} — ${err}`);
      return {
        text: '',
        codes: [],
        allCodes: [],
        confidence: 0,
        method: 'download_failed',
        captionBoosted: false,
      };
    }

    const meta = await sharp(rawBuffer)
      .metadata()
      .catch(() => ({ width: 800, height: 800 }));

    // Skip OCR for images that are too small to contain readable text
    if ((meta.width ?? 0) < 50 || (meta.height ?? 0) < 50) {
      this.logger.warn(
        `[OCR] Image too small (${meta.width}x${meta.height}) — skipping`,
      );
      return {
        text: '',
        codes: [],
        allCodes: [],
        confidence: 0,
        method: 'too_small',
        captionBoosted: false,
      };
    }

    const isSmall = (meta.width ?? 800) < 600;

    // ── Tier 1: Fast core passes (run first, exit early if codes found) ──────
    const tier1 = await Promise.allSettled([
      this.runOcr(
        rawBuffer,
        'standard',
        (b) => this.preprocessStandard(b),
        customPrefix,
      ),
      this.runOcr(
        rawBuffer,
        'high-contrast',
        (b) => this.preprocessHighContrast(b),
        customPrefix,
      ),
      this.runOcr(
        rawBuffer,
        'bright-text',
        (b) => this.preprocessBrightText(b),
        customPrefix,
        true,
      ),
      this.runOcr(
        rawBuffer,
        'bottom-crop',
        (b) => this.preprocessBottomCrop(b),
        customPrefix,
        true,
      ),
    ]);

    type PassResult = Omit<OcrResult, 'verifiedCodes' | 'ocrConfidence'> & {
      knownCodes: string[];
    };

    const tier1Results: PassResult[] = [];
    for (const p of tier1) {
      if (p.status === 'fulfilled') tier1Results.push(p.value);
    }

    // Count known-prefix codes across tier 1 (ignore generic for early exit decision)
    const earlyKnown = tier1Results.flatMap((r) => r.knownCodes);
    const earlyVotes = new Map<string, number>();
    for (const c of earlyKnown) earlyVotes.set(c, (earlyVotes.get(c) ?? 0) + 1);
    const earlyTop = [...earlyVotes.entries()].sort((a, b) => b[1] - a[1]);

    // Early exit: even 1 pass finding a known-prefix code is enough — it specifically searched for this prefix
    if (earlyTop.length > 0) {
      this.logger.log(
        `[OCR] Early exit after Tier1 — code=${earlyTop[0][0]} votes=${earlyTop[0][1]}`,
      );
      return this.buildMergedResult(tier1Results);
    }

    // ── Tier 2: Extended passes (only when Tier 1 didn't find clear codes) ───
    const tier2 = await Promise.allSettled([
      this.runOcr(
        rawBuffer,
        'adaptive',
        (b) => this.preprocessAdaptive(b),
        customPrefix,
      ),
      this.runOcr(
        rawBuffer,
        isSmall ? 'large-priority' : 'large',
        (b) => this.preprocessLarge(b),
        customPrefix,
      ),
      this.runOcr(
        rawBuffer,
        'shadow',
        (b) => this.preprocessShadow(b),
        customPrefix,
      ),
      this.runOcr(
        rawBuffer,
        'top-crop',
        (b) => this.preprocessTopCrop(b),
        customPrefix,
        true,
      ),
      this.runOcr(
        rawBuffer,
        'center-crop',
        (b) => this.preprocessCenterCrop(b),
        customPrefix,
        true,
      ),
    ]);

    const tier2Results: PassResult[] = [];
    for (const p of tier2) {
      if (p.status === 'fulfilled') tier2Results.push(p.value);
    }

    const allTier12 = [...tier1Results, ...tier2Results];

    // Check known codes after Tier 2 — exit if any known-prefix code found
    const midKnown = allTier12.flatMap((r) => r.knownCodes);
    if (midKnown.length > 0) {
      this.logger.log(
        `[OCR] Exit after Tier2 — known codes found: ${[...new Set(midKnown)].join(',')}`,
      );
      return this.buildMergedResult(allTier12);
    }

    // ── Tier 3: Deep passes (only when nothing found yet) ────────────────────
    this.logger.log('[OCR] Tier1+2 found nothing — running Tier3 deep passes');
    const tier3 = await Promise.allSettled([
      this.runOcr(
        rawBuffer,
        'invert-light',
        (b) => this.preprocessInvertLight(b),
        customPrefix,
        true,
      ),
      this.runOcr(
        rawBuffer,
        'red-channel',
        (b) => this.preprocessColorChannel(b, 'red'),
        customPrefix,
      ),
      this.runOcr(
        rawBuffer,
        'blue-channel',
        (b) => this.preprocessColorChannel(b, 'blue'),
        customPrefix,
      ),
      this.runOcr(
        rawBuffer,
        'denoised',
        (b) => this.preprocessDenoised(b),
        customPrefix,
      ),
    ]);

    const tier3Results: PassResult[] = [];
    for (const p of tier3) {
      if (p.status === 'fulfilled') tier3Results.push(p.value);
      else this.logger.warn(`[OCR] Pass failed: ${p.reason}`);
    }

    const results = [...allTier12, ...tier3Results];

    if (!results.length) {
      return {
        text: '',
        codes: [],
        allCodes: [],
        confidence: 0,
        method: 'all_failed',
        captionBoosted: false,
      };
    }

    const merged = this.buildMergedResult(results);

    // Store in cache
    ocrCache.set(imageUrl, {
      result: merged,
      expiry: Date.now() + CACHE_TTL_MS,
    });
    if (ocrCache.size > 200) {
      const now = Date.now();
      for (const [k, v] of ocrCache.entries())
        if (v.expiry < now) ocrCache.delete(k);
      // If still over limit after expired cleanup, evict oldest 50 entries
      if (ocrCache.size > 200) {
        const toEvict = [...ocrCache.keys()].slice(0, 50);
        toEvict.forEach((k) => ocrCache.delete(k));
      }
    }

    return merged;
  }

  // ── Merge multiple pass results with vote-based ranking ──────────────────────
  private buildMergedResult(
    results: Array<
      Omit<OcrResult, 'verifiedCodes' | 'ocrConfidence'> & {
        knownCodes: string[];
      }
    >,
  ): Omit<OcrResult, 'verifiedCodes' | 'ocrConfidence'> {
    if (!results.length) {
      return {
        text: '',
        codes: [],
        allCodes: [],
        confidence: 0,
        method: 'no_results',
        captionBoosted: false,
      };
    }

    // Collect ALL known-prefix codes across every pass
    const allKnownAcrossPasses = results.flatMap((r) => r.knownCodes);
    const hasAnyKnown = allKnownAcrossPasses.length > 0;

    // Vote only within the winning tier: known-prefix codes if any exist, else generic
    const codeVotes = new Map<string, number>();
    for (const r of results) {
      // Use knownCodes when available; fall back to generic (codes) only when no known exist globally
      const pool = hasAnyKnown ? r.knownCodes : r.codes;
      for (const c of pool) codeVotes.set(c, (codeVotes.get(c) ?? 0) + 1);
    }

    const allCodes = [...codeVotes.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([code]) => code);

    const topCode = allCodes[0];
    const best = topCode
      ? (results.find((r) =>
          (hasAnyKnown ? r.knownCodes : r.codes).includes(topCode),
        ) ?? results[0])
      : results.sort((a, b) =>
          b.codes.length !== a.codes.length
            ? b.codes.length - a.codes.length
            : b.confidence - a.confidence,
        )[0];

    this.logger.log(
      `[OCR] passes=${results.length} knownPool=${hasAnyKnown} codes=${allCodes.join(',')} votes=${[...codeVotes.entries()].map(([c, v]) => `${c}×${v}`).join(',')}`,
    );

    return { ...best, allCodes, captionBoosted: false };
  }

  // ── Customer text boost (merge codes customer typed alongside image) ────────
  private applyCustomerTextBoost(
    result: Omit<OcrResult, 'verifiedCodes' | 'ocrConfidence'>,
    customerText: string,
    customPrefix?: string,
  ): Omit<OcrResult, 'verifiedCodes' | 'ocrConfidence'> {
    const textCodes = this.extractCodes(customerText, customPrefix);
    if (!textCodes.length) return result;
    const merged = Array.from(new Set([...result.allCodes, ...textCodes]));
    const boosted = merged.length > result.allCodes.length;
    if (boosted)
      this.logger.log(
        `[OCR] Customer text boost: added=[${textCodes.filter((c) => !result.allCodes.includes(c)).join(',')}]`,
      );
    return {
      ...result,
      codes: result.codes.length > 0 ? result.codes : textCodes,
      allCodes: merged,
      captionBoosted: boosted,
    };
  }

  // ── Option B: Verify codes against DB product postCaptions ─────────────────
  /**
   * For each candidate code from OCR:
   *   1. Load that product's postCaption from DB (passed in as pageProducts)
   *   2. Check if OCR text OR customer text contains keywords from that postCaption
   *   3. If yes → HIGH confidence (code + caption agree)
   *   4. If no  → MEDIUM confidence (code found but caption doesn't confirm)
   *
   * Also handles the reverse: caption has code but OCR missed it → LOW confidence.
   */
  private verifyCodesAgainstCaptions(
    candidateCodes: string[],
    ocrText: string,
    customerText: string | undefined,
    pageProducts: Array<{ code: string; postCaption: string | null }>,
  ): VerifiedCode[] {
    const verified: VerifiedCode[] = [];
    const combinedText = `${ocrText} ${customerText || ''}`.toLowerCase();

    for (const code of candidateCodes) {
      const product = pageProducts.find((p) => p.code === code);

      if (!product?.postCaption) {
        // No postCaption set for this product — can only use OCR
        verified.push({
          code,
          confidence: 'MEDIUM',
          source: 'ocr_only',
          captionMatched: false,
        });
        continue;
      }

      // Check if postCaption keywords appear in the OCR text or customer message
      const captionMatched = this.captionMatchesText(
        product.postCaption,
        combinedText,
      );

      if (captionMatched) {
        // Both OCR code AND caption keywords found → HIGH confidence
        verified.push({
          code,
          confidence: 'HIGH',
          source: 'ocr+caption',
          captionMatched: true,
        });
        this.logger.log(`[OCR] Option B: ${code} confirmed by postCaption ✅`);
      } else {
        // OCR found code but caption doesn't match → still usable, MEDIUM
        verified.push({
          code,
          confidence: 'MEDIUM',
          source: 'ocr_only',
          captionMatched: false,
        });
      }
    }

    // Reverse check: any product whose postCaption matches the image text
    // but whose code was NOT found by OCR → add as LOW confidence
    for (const product of pageProducts) {
      if (!product.postCaption) continue;
      if (candidateCodes.includes(product.code)) continue; // already handled above

      const captionMatched = this.captionMatchesText(
        product.postCaption,
        combinedText,
      );
      if (captionMatched) {
        this.logger.log(
          `[OCR] Option B: ${product.code} found via caption reverse-match (OCR missed it)`,
        );
        verified.push({
          code: product.code,
          confidence: 'LOW',
          source: 'caption_only',
          captionMatched: true,
        });
      }
    }

    // Sort: HIGH first, then MEDIUM, then LOW
    const order: Record<OcrConfidence, number> = {
      HIGH: 0,
      MEDIUM: 1,
      LOW: 2,
      NONE: 3,
    };
    return verified.sort((a, b) => order[a.confidence] - order[b.confidence]);
  }

  /**
   * Check if meaningful keywords from postCaption appear in the combined text.
   * Strategy: split caption into words, ignore short/common words,
   * require at least 2 significant words to match.
   */
  private captionMatchesText(postCaption: string, text: string): boolean {
    const STOP_WORDS = new Set([
      'the',
      'a',
      'an',
      'is',
      'in',
      'on',
      'of',
      'for',
      'to',
      'and',
      'or',
      'this',
      'that',
      'are',
      'was',
      'it',
      'be',
      'at',
      'by',
      'as',
      'from',
      'with',
      'আছে',
      'এই',
      'একটি',
      'এটি',
      'হবে',
      'করুন',
      'দিন',
      'আমাদের',
      'নতুন',
      'বিশেষ',
    ]);

    const capWords = postCaption
      .toLowerCase()
      .replace(/[^\w\sঀ-৿]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

    if (!capWords.length) return false;

    const matchCount = capWords.filter((w) => text.includes(w)).length;
    // Need at least 2 matching words, OR 1 matching word if caption is short
    return capWords.length <= 2 ? matchCount >= 1 : matchCount >= 2;
  }

  // ── Overall confidence from verified results ────────────────────────────────
  private computeOverallConfidence(
    verified: VerifiedCode[],
    base: Omit<OcrResult, 'verifiedCodes' | 'ocrConfidence'>,
  ): OcrConfidence {
    if (!verified.length) return 'NONE';
    if (verified.some((v) => v.confidence === 'HIGH')) return 'HIGH';
    if (verified.some((v) => v.confidence === 'MEDIUM')) return 'MEDIUM';
    if (verified.some((v) => v.confidence === 'LOW')) return 'LOW';
    return 'NONE';
  }

  getCacheStats() {
    const now = Date.now();
    let active = 0;
    for (const v of ocrCache.values()) if (v.expiry > now) active++;
    return { total: ocrCache.size, active };
  }

  // ── Download ────────────────────────────────────────────────────────────────
  private async downloadImage(url: string): Promise<Buffer> {
    const resp = await axios.get(url, {
      responseType: 'arraybuffer',
      httpsAgent: this.agent,
      timeout: 25_000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    return Buffer.from(resp.data);
  }

  private async runOcr(
    raw: Buffer,
    method: string,
    preprocess: (b: Buffer) => Promise<Buffer>,
    customPrefix?: string,
    sparseMode = false,
  ): Promise<
    Omit<OcrResult, 'verifiedCodes' | 'ocrConfidence'> & {
      knownCodes: string[];
    }
  > {
    const processed = await preprocess(raw);
    const config: any = { logger: () => {} };
    if (sparseMode) {
      config['tessedit_pageseg_mode'] = '11';
    }
    const result = await Tesseract.recognize(processed, 'eng', config);
    const text = result.data.text || '';
    const confidence = result.data.confidence ?? 0;
    const { known, generic } = this.extractCodesSplit(text, customPrefix);
    // For the pass result, prefer known codes; only use generic if nothing known
    const codes = known.length > 0 ? known : generic;
    return {
      text,
      codes,
      allCodes: codes,
      knownCodes: known,
      confidence,
      method,
      captionBoosted: false,
    };
  }

  // ── Preprocessing strategies ────────────────────────────────────────────────
  private async preprocessStandard(buf: Buffer): Promise<Buffer> {
    return sharp(buf)
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.2, m1: 0.5, m2: 0.5 })
      .resize({ width: 1400, withoutEnlargement: true })
      .toBuffer();
  }

  private async preprocessHighContrast(buf: Buffer): Promise<Buffer> {
    return sharp(buf)
      .grayscale()
      .gamma(2.2)
      .normalize()
      .linear(1.8, -40)
      .threshold(128)
      .resize({ width: 1600, withoutEnlargement: true })
      .toBuffer();
  }

  private async preprocessAdaptive(buf: Buffer): Promise<Buffer> {
    return sharp(buf)
      .grayscale()
      .resize({ width: 1200, withoutEnlargement: true })
      .normalize()
      .sharpen({ sigma: 2.0, m1: 1.0, m2: 1.0 })
      .modulate({ brightness: 1.15, saturation: 0 })
      .toBuffer();
  }

  private async preprocessLarge(buf: Buffer): Promise<Buffer> {
    const meta = await sharp(buf).metadata();
    const w = meta.width ?? 400;
    const targetW = w < 800 ? 1600 : 1800;
    return sharp(buf)
      .grayscale()
      .resize({ width: targetW })
      .normalize()
      .sharpen({ sigma: 1.5 })
      .toBuffer();
  }

  private async preprocessShadow(buf: Buffer): Promise<Buffer> {
    return sharp(buf)
      .grayscale()
      .negate()
      .normalize()
      .sharpen({ sigma: 1.8 })
      .threshold(110)
      .resize({ width: 1400, withoutEnlargement: true })
      .toBuffer();
  }

  /** Pass 6: White/bright text on dark background — e.g. FB Reel / video overlays */
  private async preprocessBrightText(buf: Buffer): Promise<Buffer> {
    return sharp(buf)
      .grayscale()
      .linear(2.0, -80) // softer crush — preserves semi-bright overlay text too
      .threshold(120) // lower threshold catches anti-aliased white text
      .negate() // invert: white text → black text on white bg (Tesseract prefers)
      .resize({ width: 1800, withoutEnlargement: true })
      .sharpen({ sigma: 1.5 })
      .toBuffer();
  }

  /** Pass 7: Crop center — codes placed in center of images */
  private async preprocessCenterCrop(buf: Buffer): Promise<Buffer> {
    const meta = await sharp(buf).metadata();
    const w = meta.width ?? 800;
    const h = meta.height ?? 1000;
    const top = Math.floor(h * 0.25);
    const height = Math.floor(h * 0.5);
    return sharp(buf)
      .extract({ left: 0, top, width: w, height })
      .grayscale()
      .normalize()
      .linear(1.6, -30)
      .sharpen({ sigma: 1.8 })
      .resize({ width: 1600, withoutEnlargement: true })
      .toBuffer();
  }

  /** Pass 8: Bottom strip — product codes often at bottom (price tags, watermarks) */
  private async preprocessBottomCrop(buf: Buffer): Promise<Buffer> {
    const meta = await sharp(buf).metadata();
    const w = meta.width ?? 800;
    const h = meta.height ?? 1000;
    const cropH = Math.floor(h * 0.38);
    const top = h - cropH;
    return sharp(buf)
      .extract({ left: 0, top, width: w, height: cropH })
      .grayscale()
      .normalize()
      .sharpen({ sigma: 2.0, m1: 1.0, m2: 1.0 })
      .linear(1.8, -20)
      .resize({ width: 1800, withoutEnlargement: true })
      .toBuffer();
  }

  /** Pass 9: Top strip — codes placed in header/top of images */
  private async preprocessTopCrop(buf: Buffer): Promise<Buffer> {
    const meta = await sharp(buf).metadata();
    const w = meta.width ?? 800;
    const h = meta.height ?? 1000;
    const cropH = Math.floor(h * 0.3);
    return sharp(buf)
      .extract({ left: 0, top: 0, width: w, height: cropH })
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.8 })
      .linear(1.6, -25)
      .resize({ width: 1800, withoutEnlargement: true })
      .toBuffer();
  }

  /** Pass 10 & 11: Extract individual RGB channel — colored text pops on one channel */
  private async preprocessColorChannel(
    buf: Buffer,
    channel: 'red' | 'green' | 'blue',
  ): Promise<Buffer> {
    const idx = channel === 'red' ? 0 : channel === 'green' ? 1 : 2;
    // Extract single channel via raw pixel manipulation
    const { data, info } = await sharp(buf)
      .resize({ width: 1600, withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    const ch = channels as number;
    const gray = Buffer.alloc(width * height);
    for (let i = 0; i < width * height; i++) {
      gray[i] = data[i * ch + idx] ?? 0;
    }
    return sharp(gray, { raw: { width, height, channels: 1 } })
      .grayscale()
      .normalize()
      .linear(1.8, -30)
      .sharpen({ sigma: 1.5 })
      .png()
      .toBuffer();
  }

  /** Pass 12: Denoised — blur then sharpen, handles grainy/compressed images */
  private async preprocessDenoised(buf: Buffer): Promise<Buffer> {
    return sharp(buf)
      .grayscale()
      .blur(0.8) // gentle blur removes noise
      .normalize()
      .sharpen({ sigma: 2.2, m1: 1.2, m2: 0.8 }) // strong re-sharpen
      .linear(1.5, -20)
      .resize({ width: 1600, withoutEnlargement: true })
      .toBuffer();
  }

  /** Pass extra: Inverted light — light gray text on near-white bg (some watermarks) */
  private async preprocessInvertLight(buf: Buffer): Promise<Buffer> {
    return sharp(buf)
      .grayscale()
      .linear(3.0, -180) // only very bright pixels survive
      .negate()
      .threshold(80)
      .resize({ width: 1600, withoutEnlargement: true })
      .toBuffer();
  }

  // ── Code extraction ──────────────────────────────────────────────────────────
  extractCodes(text: string, customPrefix?: string): string[] {
    const { known, generic } = this.extractCodesSplit(text, customPrefix);
    // Known-prefix codes always win; only fall back to generic if nothing found
    return known.length > 0 ? known : generic;
  }

  /** Split code extraction into known-prefix (high confidence) vs generic fallback (low confidence) */
  extractCodesSplit(
    text: string,
    customPrefix?: string,
  ): { known: string[]; generic: string[] } {
    const known = new Set<string>();
    const generic = new Set<string>();

    const prefix = (customPrefix || 'DF').toUpperCase();
    const t = this.normalizeOcrText(text || '', prefix);

    // Each prefix char can be misread by OCR — build fuzzy version per char
    // e.g. "S" → "[S5]", "K" → "[K]", "D" → "[D0O]", "F" → "[FE]"
    const fuzzyChar = (c: string) => {
      const map: Record<string, string> = {
        D: '[D0O]',
        O: '[O0]',
        F: '[FE]',
        S: '[S5]',
        Z: '[Z2]',
        B: '[B8]',
        G: '[G6]',
        I: '[I1]',
        L: '[L1]',
      };
      return map[c] ?? c;
    };
    const confusedPrefix = prefix.split('').map(fuzzyChar).join('');

    let m: RegExpExecArray | null;

    // 1) Standard: PREFIX[-./_ ]DIGITS (separator optional)
    const re1 = new RegExp(
      `(?:^|[\\s#\\[\\(])${prefix}\\s*[-–—./_ ]?\\s*([0-9OoIlSZ]{1,6})(?=[\\s\\]\\),.]|$)`,
      'gm',
    );
    while ((m = re1.exec(t)) !== null) {
      known.add(
        `${prefix}-${this.fixOcrDigits(m[1]).padStart(4, '0').slice(-4)}`,
      );
    }

    // 2) No separator: PREFIX0001 as single token
    const re2 = new RegExp(`(?:^|\\s)${prefix}([0-9]{2,6})(?=\\s|$)`, 'gm');
    while ((m = re2.exec(t)) !== null) {
      known.add(`${prefix}-${m[1].padStart(4, '0').slice(-4)}`);
    }

    // 3) Fuzzy prefix confusion (e.g. "DE-0001" → "DF-0001", "5K-001" → "SK-001")
    const re3 = new RegExp(
      `(?:^|[\\s#\\[\\(])${confusedPrefix}\\s*[-–—]?\\s*([0-9]{1,6})(?=[\\s\\]\\),.]|$)`,
      'gm',
    );
    while ((m = re3.exec(t)) !== null) {
      known.add(`${prefix}-${m[1].padStart(4, '0').slice(-4)}`);
    }

    // 4) Line-break split: "DF\n001"
    const re4 = new RegExp(`${prefix}[-–—]?\\n\\s*([0-9]{1,6})`, 'g');
    while ((m = re4.exec(text.toUpperCase())) !== null) {
      known.add(`${prefix}-${m[1].padStart(4, '0').slice(-4)}`);
    }

    // 5) Generic fallback: only used when known-prefix patterns found nothing
    //    Requires a real separator (dash) to reduce false positives from UI text
    const SKIP = new Set([
      'THE',
      'AND',
      'FOR',
      'YOU',
      'ARE',
      'WAS',
      'HAS',
      'NOT',
      'BUT',
      'CAN',
      'ALL',
      'NEW',
      'GET',
      'SET',
      'USE',
      'SEE',
      'ADD',
      'EID',
      'AID',
      'AIN',
      'REE',
      'ILS',
      'EAL',
      'HIT',
      'TOP',
      'MAN',
      'SHE',
      'HER',
      'HIM',
      'HIS',
      'ITS',
      'OUR',
      'VIA',
      'NOW',
      'MAY',
      'DAY',
      'WAY',
      'SAY',
      'RUN',
      'PUT',
      'GOT',
      'CUT',
      'OUT',
      'OFF',
      'END',
      'TAX',
      'VAT',
      'NEXT',
      'PREV',
      'MAIN',
      'DONE',
      'LOAD',
      'SAVE',
      'EDIT',
      'LIVE',
      'PLAY',
      'STOP',
      'REEL',
      'ZONE',
      'CHAT',
    ]);
    // Must have a real dash separator — prevents matching bare UI text fragments
    const genRe = /\b([A-Z]{2,5})\s*[-–—]\s*(\d{2,6})\b/g;
    let m2: RegExpExecArray | null;
    while ((m2 = genRe.exec(t)) !== null) {
      if (SKIP.has(m2[1])) continue;
      generic.add(`${m2[1]}-${m2[2].padStart(4, '0').slice(-4)}`);
    }

    return {
      known: [...known].map((c) => this.fixOcrConfusions(c)),
      generic: [...generic].map((c) => this.fixOcrConfusions(c)),
    };
  }

  /** Normalize raw OCR output before code matching.
   *  prefix: the page's product code prefix (e.g. "DF", "SK") — used to fix OCR confusions specific to it.
   */
  private normalizeOcrText(raw: string, prefix = 'DF'): string {
    let t = raw
      .toUpperCase()
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[^\w\s\n\r\-#\[\]().]/g, ' ');

    // Build prefix-specific OCR confusion fixes
    // Each letter of the prefix may have OCR-lookalikes that should be normalized
    const charFixes: Record<string, string[]> = {
      D: ['0', 'O'],
      F: ['E'],
      S: ['5'],
      K: ['X'],
      Z: ['2'],
      B: ['8'],
      G: ['6'],
      I: ['1'],
      L: ['1'],
    };
    // Generate regex to fix "misread prefix + separator + digits" → correct prefix
    const prefixChars = prefix.split('');
    const confusedChars = prefixChars
      .map((c) => {
        const alts = charFixes[c] ?? [];
        return alts.length ? `[${c}${alts.join('')}]` : c;
      })
      .join('');

    if (confusedChars !== prefix) {
      // Replace confused prefix (when followed by separator+digits) with real prefix
      const confRe = new RegExp(
        `\\b${confusedChars}(?=\\s*[-–—./_ ]?\\s*\\d)`,
        'g',
      );
      t = t.replace(confRe, prefix);
    }

    return t;
  }

  /** Fix digit-like OCR confusions in the numeric part of a code */
  private fixOcrDigits(s: string): string {
    return s
      .replace(/[Oo]/g, '0')
      .replace(/[lI|]/g, '1')
      .replace(/[Ss]/g, '5')
      .replace(/[Zz]/g, '2')
      .replace(/[Bb]/g, '8')
      .replace(/[Gg]/g, '6');
  }

  private fixOcrConfusions(code: string): string {
    return code.replace(
      /-([/\dOolISZzBbGg]+)$/,
      (_, digits) => '-' + this.fixOcrDigits(digits),
    );
  }

  // ── Gemini-based OCR fallback (used when local Tesseract queue is full) ────

  /**
   * Extracts raw text from an image using Gemini Flash.
   * Called ONLY as last resort when the local OCR queue is full.
   * Cost: ~$0.00005 per call (Gemini 2.0 Flash).
   */
  async extractTextViaGemini(imageUrl: string): Promise<string> {
    if (!this.geminiRotator.isAvailable()) {
      this.logger.warn('[OCR/Gemini] No Gemini key available — skipping');
      return '';
    }
    const apiKey = this.geminiRotator.getKey();
    if (!apiKey) return '';

    let rawBuffer: Buffer;
    try {
      rawBuffer = await this.downloadImage(imageUrl);
    } catch {
      return '';
    }

    const base64 = rawBuffer.toString('base64');
    const model = this.apiKeysService.getSync('visionModel') || 'gemini-3.5-flash';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const start = Date.now();

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: 'Extract all visible text from this image. Return only the raw text, no formatting, no explanation.' },
              { inlineData: { mimeType: 'image/jpeg', data: base64 } },
            ],
          }],
          // thinkingBudget: 0 — gemini-2.5-flash has "thinking" on by default and
          // can burn the whole maxOutputTokens budget on internal reasoning before
          // writing any actual text, truncating the response mid-word.
          generationConfig: { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 300 },
        }),
        signal: AbortSignal.timeout(15_000),
      });

      const latency = Date.now() - start;

      if (!res.ok) {
        this.logger.warn(`[OCR/Gemini] API error ${res.status}`);
        this.geminiRotator.markError(apiKey, res.status);
        return '';
      }
      const resp = await res.json();
      const text: string = resp?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      this.geminiRotator.markSuccess(apiKey, latency);
      this.logger.log(`[OCR/Gemini] Extracted ${text.length} chars (latency: ${latency}ms)`);
      return text;
    } catch (e: any) {
      this.logger.error(`[OCR/Gemini] Failed: ${e?.message}`);
      this.geminiRotator.markError(apiKey, 500, e?.message ?? String(e));
      return '';
    }
  }
}
