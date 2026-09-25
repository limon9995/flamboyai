import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { GlobalSettingsService } from '../common/global-settings.service';
import { GenerateCaptionDto } from './dto/generate-caption.dto';
import { GenerateImageDto } from './dto/generate-image.dto';
import { CreateAutoPostDto } from './dto/create-auto-post.dto';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';

const FB_GRAPH = 'https://graph.facebook.com/v21.0';

const STYLE_PROMPTS: Record<string, string> = {
  minimal:   'clean minimal white background, flat lay, soft shadows, simple elegant design',
  vibrant:   'vibrant colorful background, bold colors, eye-catching, lively aesthetic',
  dark:      'dark luxury background, gold accents, premium feel, sophisticated',
  festival:  'festive colorful bokeh background, celebration mood, Eid Puja theme, joyful',
  sale:      'bold red and yellow sale banner, discount urgency, limited time offer, price tag',
  realistic: 'photorealistic product photography, studio lighting, white background, sharp focus',
};

const ASPECT_SIZE: Record<string, string> = {
  '1:1': 'square_hd',
  '4:5': 'portrait_4_5',
  '9:16': 'portrait_16_9',
};

const TONE_PROMPTS: Record<string, string> = {
  casual:       'conversational friendly tone, use simple everyday Bengali, relatable language',
  professional: 'formal professional tone, trust-building, authoritative',
  urgent:       'urgency and scarcity, FOMO, limited time offer, act now messaging',
  story:        'storytelling style, emotional connection, paint a picture with words',
};

const BN_DAYS = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];

@Injectable()
export class AutoPostService {
  private readonly logger = new Logger(AutoPostService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly globalSettings: GlobalSettingsService,
  ) {}

  // ── Caption generation ────────────────────────────────────────────────────────

  async generateCaption(dto: GenerateCaptionDto): Promise<{ caption: string }> {
    const apiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    let shopLink = '';
    if (dto.pageId) {
      const page = await this.prisma.page.findUnique({
        where: { id: dto.pageId },
        select: { websiteUrl: true, catalogSlug: true },
      });
      if (page) {
        const catalogBase = process.env.CATALOG_BASE_URL || 'https://flamboyai.com';
        shopLink = page.websiteUrl?.trim() || (page.catalogSlug ? `${catalogBase}/catalog/${page.catalogSlug}` : '');
      }
    }

    const isBn = (dto.language || 'bn') === 'bn';
    const postTypeLabel =
      dto.postType === 'sale'
        ? isBn ? 'অফার/ডিসকাউন্ট পোস্ট' : 'Sale/Discount Post'
        : dto.postType === 'announcement'
          ? isBn ? 'ঘোষণা পোস্ট' : 'Announcement Post'
          : isBn ? 'প্রোডাক্ট পোস্ট' : 'Product Post';

    const toneInstruction = dto.tone && TONE_PROMPTS[dto.tone]
      ? isBn ? `টোন: ${TONE_PROMPTS[dto.tone]}.` : `Tone: ${TONE_PROMPTS[dto.tone]}.`
      : '';

    const ctaInstruction = isBn
      ? shopLink
        ? `শেষে CTA দাও যেমন "আমাদের ওয়েবসাইট ভিজিট করুন 🌐"। caption-এ কোনো লিংক বা URL লিখবে না — লিংক আলাদাভাবে comment-এ দেওয়া হবে।`
        : `শেষে call-to-action দাও (যেমন: "অর্ডার করতে ইনবক্স করুন 📩")। caption-এ কোনো লিংক বা placeholder লিখবে না।`
      : shopLink
        ? `End with a CTA like "Visit our website 🌐". Do NOT include any link or URL in the caption.`
        : `End with a call-to-action like "Inbox us to order 📩". Do NOT write any link or placeholder in the caption.`;

    const systemPrompt = isBn
      ? `তুমি একজন বাংলাদেশি ই-কমার্স মার্কেটার। Facebook পেজের জন্য আকর্ষণীয় বাংলা ক্যাপশন লেখো। ইমোজি ব্যবহার করো। ৩-৫ লাইনের মধ্যে রাখো। ${toneInstruction} ${ctaInstruction}`
      : `You are a Bangladeshi e-commerce marketer. Write engaging English captions for Facebook pages. Use emojis. Keep it 3-5 lines. ${toneInstruction} ${ctaInstruction}`;

    const userPrompt = isBn
      ? `একটি ${postTypeLabel} লেখো।\nপ্রোডাক্ট: ${dto.productName}\n${dto.price ? `মূল্য: ${dto.price}` : ''}${dto.offer ? `\nঅফার: ${dto.offer}` : ''}${dto.description ? `\nবিবরণ: ${dto.description}` : ''}`
      : `Write a ${postTypeLabel}.\nProduct: ${dto.productName}\n${dto.price ? `Price: ${dto.price}` : ''}${dto.offer ? `\nOffer: ${dto.offer}` : ''}${dto.description ? `\nDescription: ${dto.description}` : ''}`;

    if (apiKey) {
      try {
        const caption = await this.callGemini(apiKey, systemPrompt, userPrompt);
        return { caption };
      } catch (e: any) {
        this.logger.warn(`Gemini failed: ${e.message}, trying OpenAI`);
      }
    }

    if (openaiKey) {
      const caption = await this.callOpenAI(openaiKey, systemPrompt, userPrompt);
      return { caption };
    }

    throw new BadRequestException('GEMINI_API_KEY বা OPENAI_API_KEY .env ফাইলে set করুন');
  }

  // ── Hashtag generation ────────────────────────────────────────────────────────

  async generateHashtags(dto: { pageId: number; productName: string; postType?: string; language?: string }): Promise<{ hashtags: string }> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new BadRequestException('GEMINI_API_KEY .env ফাইলে set করুন');

    const isBn = (dto.language || 'bn') === 'bn';
    const prompt = isBn
      ? `বাংলাদেশি ই-কমার্সের জন্য "${dto.productName}" প্রোডাক্টের ${dto.postType || 'product'} পোস্টের জন্য ৮-১০টি হ্যাশট্যাগ দাও। বাংলা এবং ইংরেজি মিশিয়ে। শুধু হ্যাশট্যাগ দাও, অন্য কিছু লিখবে না। উদাহরণ: #নতুনকালেকশন #onlineshopping #bangladesh`
      : `Give 8-10 hashtags for a ${dto.postType || 'product'} post about "${dto.productName}" for Bangladesh e-commerce. Mix Bengali and English. Only hashtags, nothing else.`;

    const result = await this.callGemini(apiKey, '', prompt);
    return { hashtags: result.trim() };
  }

  private async callGemini(apiKey: string, system: string, user: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: system ? `${system}\n\n${user}` : user }] }],
      // thinkingBudget: 0 — gemini-2.5-flash defaults to "thinking" mode, which can
      // consume the whole maxOutputTokens budget on internal reasoning and truncate
      // the actual caption/hashtag output.
      generationConfig: { temperature: 0.8, maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } },
    });

    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (!res.ok) throw new Error(`Gemini error: ${res.status}`);
    const data: any = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  }

  private async callOpenAI(apiKey: string, system: string, user: string): Promise<string> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: 512,
        temperature: 0.8,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI error: ${res.status}`);
    const data: any = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  }

  // ── Image generation (text prompt) ───────────────────────────────────────────

  async generateImage(dto: GenerateImageDto): Promise<{ imageUrls: string[]; usedProvider?: string }> {
    const geminiKey   = process.env.GEMINI_API_KEY;
    const openaiKey   = process.env.OPENAI_API_KEY;
    const ideogramKey = process.env.IDEOGRAM_API_KEY;
    const falKeys = [
      process.env.FAL_API_KEY,
      process.env.FAL_API_KEY_2,
      process.env.FAL_API_KEY_3,
    ].filter(Boolean) as string[];

    const settings = await this.globalSettings.get();
    const order = settings.imageProviderOrder ?? ['gemini', 'openai', 'fal', 'ideogram'];

    const styleModifier = dto.style && STYLE_PROMPTS[dto.style] ? `, ${STYLE_PROMPTS[dto.style]}` : '';
    const enrichedPrompt = `E-commerce product promotional poster, ${dto.prompt}${styleModifier}, high quality, professional`;
    const imageSize = ASPECT_SIZE[dto.aspectRatio || '1:1'] || 'square_hd';
    const count = Math.min(dto.count || 1, 2);

    let urls: string[] = [];
    let lastError = '';
    let usedProvider = '';

    for (const provider of order) {
      if (urls.length > 0) break;

      if (provider === 'fal' && falKeys.length > 0) {
        for (const key of falKeys) {
          try {
            urls = await this.callFalAi(key, enrichedPrompt, imageSize, count);
            usedProvider = 'fal';
            break;
          } catch (e: any) {
            lastError = e.message;
            this.logger.warn(`fal.ai key failed: ${e.message}`);
          }
        }
      }

      if (provider === 'gemini' && geminiKey && urls.length === 0) {
        try {
          const b64 = await this.callGeminiImagen(geminiKey, enrichedPrompt);
          const saved = await this.saveBase64(b64, 'image/png', dto.pageId);
          urls = [saved];
          usedProvider = 'gemini';
        } catch (e: any) {
          lastError = e.message;
          this.logger.warn(`Gemini Imagen 3 failed: ${e.message}`);
        }
      }

      if (provider === 'openai' && openaiKey && urls.length === 0) {
        try {
          const url = await this.callOpenAIDalle(openaiKey, enrichedPrompt);
          const saved = await this.downloadAndSave(url, dto.pageId);
          urls = [saved];
          usedProvider = 'openai';
        } catch (e: any) {
          lastError = e.message;
          this.logger.warn(`OpenAI DALL-E failed: ${e.message}`);
        }
      }

      if (provider === 'ideogram' && ideogramKey && urls.length === 0) {
        try {
          const url = await this.callIdeogram(ideogramKey, dto.prompt);
          const saved = await this.downloadAndSave(url, dto.pageId);
          urls = [saved];
          usedProvider = 'ideogram';
        } catch (e: any) {
          lastError = e.message;
          this.logger.warn(`Ideogram failed: ${e.message}`);
        }
      }
    }

    if (urls.length === 0) throw new BadRequestException(`Image generation failed: ${lastError}`);

    // Save remote URLs locally if not already local
    const savedUrls: string[] = [];
    for (const u of urls) {
      if (u.startsWith('/storage')) {
        savedUrls.push(u);
      } else {
        savedUrls.push(await this.downloadAndSave(u, dto.pageId));
      }
    }

    return { imageUrls: savedUrls, usedProvider };
  }

  // ── Poster from uploaded product photo (image-to-image) ───────────────────────

  async posterFromPhoto(dto: {
    pageId: number;
    productPhotoUrl: string;
    productName: string;
    price?: string;
    offer?: string;
    style?: string;
    aspectRatio?: string;
  }): Promise<{ imageUrls: string[] }> {
    const falKeys = [
      process.env.FAL_API_KEY,
      process.env.FAL_API_KEY_2,
      process.env.FAL_API_KEY_3,
    ].filter(Boolean) as string[];

    if (falKeys.length === 0) {
      throw new BadRequestException('FAL_API_KEY .env ফাইলে set করুন (image-to-image এর জন্য)');
    }

    const styleModifier = dto.style && STYLE_PROMPTS[dto.style] ? `, ${STYLE_PROMPTS[dto.style]}` : ', professional e-commerce design';
    const priceText = dto.price ? `, price ${dto.price}` : '';
    const offerText = dto.offer ? `, ${dto.offer}` : '';
    const prompt = `Professional Facebook marketing poster for ${dto.productName}${priceText}${offerText}${styleModifier}, vibrant promotional design, Bangladesh online shop, high quality`;
    const imageSize = ASPECT_SIZE[dto.aspectRatio || '1:1'] || 'square_hd';

    // Resolve absolute URL for uploaded photo
    const apiBase = process.env.API_BASE_URL || 'https://api.flamboyai.com';
    const absolutePhotoUrl = dto.productPhotoUrl.startsWith('http')
      ? dto.productPhotoUrl
      : `${apiBase}${dto.productPhotoUrl}`;

    let urls: string[] = [];
    let lastError = '';

    for (const key of falKeys) {
      try {
        urls = await this.callFalAiImg2Img(key, absolutePhotoUrl, prompt, imageSize);
        break;
      } catch (e: any) {
        lastError = e.message;
        this.logger.warn(`fal.ai img2img failed: ${e.message}`);
      }
    }

    if (urls.length === 0) {
      throw new BadRequestException(`Poster generation failed: ${lastError}`);
    }

    const savedUrls: string[] = [];
    for (const u of urls) {
      savedUrls.push(u.startsWith('/storage') ? u : await this.downloadAndSave(u, dto.pageId));
    }
    return { imageUrls: savedUrls };
  }

  // ── Upload product photo ───────────────────────────────────────────────────────

  async saveUploadedPhoto(buffer: Buffer, mime: string, pageId: number): Promise<{ imageUrl: string }> {
    const ext = mime.includes('png') ? 'png' : mime.includes('gif') ? 'gif' : 'jpg';
    const dir = path.join(process.cwd(), 'storage', 'auto-posts');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filename = `ap_photo_${pageId}_${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(dir, filename), buffer);
    return { imageUrl: `/storage/auto-posts/${filename}` };
  }

  // ── Analytics ─────────────────────────────────────────────────────────────────

  async getAnalytics(pageId: number): Promise<{
    totalPosts: number;
    publishedCount: number;
    failedCount: number;
    scheduledCount: number;
    successRate: number;
    topPostType: string;
    topPostingHour: number;
    topPostingDay: string;
    aiInsight: string;
  }> {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const posts = await this.prisma.autoPost.findMany({
      where: { pageId, createdAt: { gte: since } },
      select: { status: true, postType: true, publishedAt: true },
    });

    const totalPosts = posts.length;
    const publishedCount = posts.filter((p) => p.status === 'published').length;
    const failedCount = posts.filter((p) => p.status === 'failed').length;
    const scheduledCount = posts.filter((p) => p.status === 'scheduled').length;
    const successRate = totalPosts > 0 ? Math.round((publishedCount / totalPosts) * 100) : 0;

    // Top post type
    const typeCounts: Record<string, number> = {};
    for (const p of posts) {
      typeCounts[p.postType] = (typeCounts[p.postType] || 0) + 1;
    }
    const topPostType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'product';

    // Top posting hour & day (from published posts)
    const published = posts.filter((p) => p.publishedAt);
    const hourCounts: Record<number, number> = {};
    const dayCounts: Record<number, number> = {};
    for (const p of published) {
      const d = new Date(p.publishedAt!);
      const h = d.getHours();
      const day = d.getDay();
      hourCounts[h] = (hourCounts[h] || 0) + 1;
      dayCounts[day] = (dayCounts[day] || 0) + 1;
    }
    const topPostingHour = published.length > 0
      ? Number(Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 21)
      : 21;
    const topDayIndex = published.length > 0
      ? Number(Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 5)
      : 5;
    const topPostingDay = BN_DAYS[topDayIndex];

    // AI insight via Gemini
    let aiInsight = '';
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && totalPosts > 0) {
      const typeLabels: Record<string, string> = { product: 'প্রোডাক্ট', sale: 'সেল/অফার', announcement: 'ঘোষণা', custom: 'কাস্টম' };
      const statsText = `মোট পোস্ট: ${totalPosts}, প্রকাশিত: ${publishedCount}, ব্যর্থ: ${failedCount}, সফলতার হার: ${successRate}%, সবচেয়ে বেশি ব্যবহৃত পোস্ট টাইপ: ${typeLabels[topPostType] || topPostType}, সবচেয়ে বেশি পোস্ট হয় রাত ${topPostingHour}টায়, ${topPostingDay} দিনে।`;
      try {
        aiInsight = await this.callGemini(
          apiKey,
          'তুমি একজন Facebook মার্কেটিং বিশেষজ্ঞ। নিচের পোস্টিং statistics দেখে সংক্ষেপে ৩-৪ লাইনে বাংলায় insight ও পরামর্শ দাও। সহজ ভাষায় লেখো।',
          statsText,
        );
      } catch (e: any) {
        this.logger.warn(`Analytics insight failed: ${e.message}`);
        aiInsight = `গত ৩০ দিনে ${publishedCount}টি পোস্ট সফলভাবে প্রকাশিত হয়েছে (${successRate}% সফলতার হার)। ${typeLabels[topPostType] || topPostType} পোস্ট সবচেয়ে বেশি করা হয়েছে।`;
      }
    } else if (totalPosts === 0) {
      aiInsight = 'এখনো কোনো পোস্ট করা হয়নি। প্রথম পোস্টটি করুন এবং ফলাফল দেখুন!';
    }

    return { totalPosts, publishedCount, failedCount, scheduledCount, successRate, topPostType, topPostingHour, topPostingDay, aiInsight };
  }

  // ── Best posting time ─────────────────────────────────────────────────────────

  async getBestTime(pageId: number): Promise<{ bestHour: number; basedOn: string; message: string }> {
    const posts = await this.prisma.autoPost.findMany({
      where: { pageId, status: 'published', publishedAt: { not: null } },
      select: { publishedAt: true },
    });

    if (posts.length < 3) {
      // Not enough history — return Bangladesh general best times
      return { bestHour: 21, basedOn: 'general', message: 'রাত ৯টায় পোস্ট করুন (বাংলাদেশে সর্বোচ্চ ব্যবহারকারী সক্রিয় থাকে)' };
    }

    const hourCounts: Record<number, number> = {};
    for (const p of posts) {
      const h = new Date(p.publishedAt!).getHours();
      hourCounts[h] = (hourCounts[h] || 0) + 1;
    }
    const bestHour = Number(Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0][0]);
    const count = hourCounts[bestHour];
    const h12 = bestHour === 0 ? 'রাত ১২টা' : bestHour < 12 ? `সকাল ${bestHour}টা` : bestHour === 12 ? 'দুপুর ১২টা' : bestHour < 17 ? `বিকাল ${bestHour - 12}টা` : bestHour < 20 ? `সন্ধ্যা ${bestHour - 12}টা` : `রাত ${bestHour - 12}টা`;

    return {
      bestHour,
      basedOn: 'history',
      message: `${h12}য় পোস্ট করুন — আপনার ${count}টি সফল পোস্ট এই সময়ে ছিল`,
    };
  }

  // ── fal.ai helpers ────────────────────────────────────────────────────────────

  private async callOpenAIDalle(apiKey: string, prompt: string): Promise<string> {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1024x1024', response_format: 'url' }),
    });
    if (!res.ok) throw new Error(`DALL-E error: ${res.status}`);
    const data: any = await res.json();
    const url = data.data?.[0]?.url;
    if (!url) throw new Error('DALL-E: no image in response');
    return url;
  }

  private async callFalAi(apiKey: string, prompt: string, imageSize: string, count = 1): Promise<string[]> {
    const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` },
      body: JSON.stringify({ prompt, image_size: imageSize, num_inference_steps: 4, num_images: count }),
    });
    if (!res.ok) throw new Error(`fal.ai error: ${res.status}`);
    const data: any = await res.json();
    return (data.images || []).map((img: any) => img.url).filter(Boolean);
  }

  private async callFalAiImg2Img(apiKey: string, imageUrl: string, prompt: string, imageSize: string): Promise<string[]> {
    const res = await fetch('https://fal.run/fal-ai/flux/dev/image-to-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` },
      body: JSON.stringify({ image_url: imageUrl, prompt, strength: 0.75, image_size: imageSize, num_images: 1 }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`fal.ai img2img error: ${res.status} ${err}`);
    }
    const data: any = await res.json();
    return (data.images || []).map((img: any) => img.url).filter(Boolean);
  }

  private async callGeminiImagen(apiKey: string, prompt: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1/models/imagen-3.0-generate-001:predict?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: `E-commerce promotional poster for Bangladesh online shop, ${prompt}, high quality, vibrant colors` }],
        parameters: { sampleCount: 1, aspectRatio: '1:1', safetySetting: 'block_only_high' },
      }),
    });
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Imagen 3 error: ${res.status}`);
    }
    const data: any = await res.json();
    const b64 = data.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) throw new Error('Imagen 3: no image in response');
    return b64;
  }

  private async callIdeogram(apiKey: string, prompt: string): Promise<string> {
    const res = await fetch('https://api.ideogram.ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Api-Key': apiKey },
      body: JSON.stringify({
        image_request: {
          prompt: `${prompt}, professional e-commerce promotional poster, high quality`,
          model: 'V_2',
          aspect_ratio: 'ASPECT_1_1',
          style_type: 'REALISTIC',
        },
      }),
    });
    if (!res.ok) throw new Error(`Ideogram error: ${res.status}`);
    const data: any = await res.json();
    return data.data?.[0]?.url || '';
  }

  // ── File helpers ──────────────────────────────────────────────────────────────

  private async saveBase64(b64: string, mime: string, pageId: number): Promise<string> {
    const dir = path.join(process.cwd(), 'storage', 'auto-posts');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ext = mime.includes('png') ? 'png' : 'jpg';
    const filename = `ap_${pageId}_${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(dir, filename), Buffer.from(b64, 'base64'));
    return `/storage/auto-posts/${filename}`;
  }

  private async downloadAndSave(url: string, pageId: number): Promise<string> {
    const dir = path.join(process.cwd(), 'storage', 'auto-posts');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filename = `ap_${pageId}_${Date.now()}.jpg`;
    const filepath = path.join(dir, filename);

    await new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(filepath);
      https.get(url, (response) => {
        response.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', (err) => { fs.unlink(filepath, () => {}); reject(err); });
    });

    return `/storage/auto-posts/${filename}`;
  }

  // ── Facebook publish ──────────────────────────────────────────────────────────

  private async postLinkComment(fbPostId: string, link: string, token: string): Promise<void> {
    try {
      await fetch(`${FB_GRAPH}/${fbPostId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `🔗 ${link}`, access_token: token }),
      });
    } catch (e: any) {
      this.logger.warn(`Link comment failed: ${e.message}`);
    }
  }

  async publishToFacebook(pageId: number, caption: string, imageUrl?: string): Promise<string> {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { id: true, pageId: true, pageToken: true, websiteUrl: true, catalogSlug: true, isActive: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    if (page.isActive === false) throw new BadRequestException('Account বন্ধ আছে, পোস্ট করা যাবে না');

    const token = this.encryption.decrypt(page.pageToken);
    const fbPageId = page.pageId;
    const catalogBase = process.env.CATALOG_BASE_URL || 'https://flamboyai.com';
    const shopLink = page.websiteUrl?.trim() || (page.catalogSlug ? `${catalogBase}/catalog/${page.catalogSlug}` : '');

    let fbPostId: string;

    if (imageUrl) {
      const absoluteImageUrl = imageUrl.startsWith('http')
        ? imageUrl
        : `${process.env.API_BASE_URL || 'https://api.flamboyai.com'}${imageUrl}`;
      const res = await fetch(`${FB_GRAPH}/${fbPageId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: absoluteImageUrl, caption, access_token: token }),
      });
      const data: any = await res.json();
      if (!res.ok || data.error) throw new BadRequestException(data.error?.message || 'Facebook photo post failed');
      fbPostId = data.post_id || data.id;
    } else {
      const res = await fetch(`${FB_GRAPH}/${fbPageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: caption, access_token: token }),
      });
      const data: any = await res.json();
      if (!res.ok || data.error) throw new BadRequestException(data.error?.message || 'Facebook post failed');
      fbPostId = data.id;
    }

    if (shopLink && fbPostId) await this.postLinkComment(fbPostId, shopLink, token);
    return fbPostId;
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────────

  async create(dto: CreateAutoPostDto) {
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;

    if (!scheduledAt) {
      const record = await this.prisma.autoPost.create({
        data: {
          pageId: dto.pageId, caption: dto.caption, imageUrl: dto.imageUrl,
          imagePrompt: dto.imagePrompt, postType: dto.postType || 'product',
          language: dto.language || 'bn', status: 'publishing',
        },
      });
      try {
        const fbPostId = await this.publishToFacebook(dto.pageId, dto.caption, dto.imageUrl);
        return await this.prisma.autoPost.update({
          where: { id: record.id },
          data: { status: 'published', fbPostId, publishedAt: new Date() },
        });
      } catch (e: any) {
        await this.prisma.autoPost.update({ where: { id: record.id }, data: { status: 'failed', errorMsg: e.message } });
        throw e;
      }
    }

    return this.prisma.autoPost.create({
      data: {
        pageId: dto.pageId, caption: dto.caption, imageUrl: dto.imageUrl,
        imagePrompt: dto.imagePrompt, postType: dto.postType || 'product',
        language: dto.language || 'bn', status: 'scheduled', scheduledAt,
      },
    });
  }

  async list(pageId: number) {
    return this.prisma.autoPost.findMany({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async remove(id: number, pageId: number) {
    const post = await this.prisma.autoPost.findFirst({ where: { id, pageId } });
    if (!post) throw new NotFoundException('Post not found');
    if (post.status === 'publishing') throw new BadRequestException('Publishing চলছে, এখন delete করা যাবে না');
    return this.prisma.autoPost.delete({ where: { id } });
  }

  async retry(id: number, pageId: number) {
    const post = await this.prisma.autoPost.findFirst({ where: { id, pageId } });
    if (!post) throw new NotFoundException('Post not found');
    if (post.status !== 'failed') throw new BadRequestException('শুধুমাত্র failed পোস্ট retry করা যাবে');

    await this.prisma.autoPost.update({ where: { id }, data: { status: 'publishing', errorMsg: null } });
    try {
      const fbPostId = await this.publishToFacebook(post.pageId, post.caption, post.imageUrl ?? undefined);
      return await this.prisma.autoPost.update({
        where: { id },
        data: { status: 'published', fbPostId, publishedAt: new Date() },
      });
    } catch (e: any) {
      await this.prisma.autoPost.update({ where: { id }, data: { status: 'failed', errorMsg: e.message } });
      throw e;
    }
  }

  async processScheduledPosts(): Promise<number> {
    const now = new Date();
    const pending = await this.prisma.autoPost.findMany({
      where: { status: 'scheduled', scheduledAt: { lte: now } },
    });

    let count = 0;
    for (const post of pending) {
      await this.prisma.autoPost.update({ where: { id: post.id }, data: { status: 'publishing' } });
      try {
        const fbPostId = await this.publishToFacebook(post.pageId, post.caption, post.imageUrl ?? undefined);
        await this.prisma.autoPost.update({
          where: { id: post.id },
          data: { status: 'published', fbPostId, publishedAt: new Date() },
        });
        count++;
      } catch (e: any) {
        await this.prisma.autoPost.update({ where: { id: post.id }, data: { status: 'failed', errorMsg: e.message } });
        this.logger.error(`AutoPost ${post.id} failed: ${e.message}`);
      }
    }
    return count;
  }
}
