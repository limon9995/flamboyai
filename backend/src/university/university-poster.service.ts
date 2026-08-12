import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AutoPostService } from '../auto-post/auto-post.service';
import { GeminiKeyRotatorService } from '../common/gemini-key-rotator.service';
import { ApiKeysService } from '../common/api-keys.service';
import * as cheerio from 'cheerio';

const MAX_POSTS_PER_RUN = 3;

const NOTICE_CATEGORIES: Array<{ keywords: RegExp; emoji: string; labelBn: string; labelEn: string }> = [
  { keywords: /exam|পরীক্ষা|result|ফলাফল|grade|cgpa|routine|রুটিন/i, emoji: '📝', labelBn: 'পরীক্ষা বিজ্ঞপ্তি', labelEn: 'Exam Notice' },
  { keywords: /admission|ভর্তি|apply|application|আবেদন/i, emoji: '🎓', labelBn: 'ভর্তি বিজ্ঞপ্তি', labelEn: 'Admission Notice' },
  { keywords: /holiday|ছুটি|বন্ধ|vacation|leave/i, emoji: '📅', labelBn: 'ছুটির বিজ্ঞপ্তি', labelEn: 'Holiday Notice' },
  { keywords: /seminar|workshop|event|অনুষ্ঠান|উৎসব|festival|cultural|evening|competition|প্রতিযোগিতা/i, emoji: '🎯', labelBn: 'অনুষ্ঠান বিজ্ঞপ্তি', labelEn: 'Event Notice' },
  { keywords: /fee|ফি|payment|টাকা|tuition|বেতন/i, emoji: '💳', labelBn: 'ফি বিজ্ঞপ্তি', labelEn: 'Fee Notice' },
  { keywords: /scholarship|বৃত্তি|waiver|ছাড়/i, emoji: '🏆', labelBn: 'বৃত্তি বিজ্ঞপ্তি', labelEn: 'Scholarship Notice' },
  { keywords: /class|ক্লাস|lecture|course|semester|সেমিস্টার|schedule|সময়সূচি/i, emoji: '📚', labelBn: 'একাডেমিক বিজ্ঞপ্তি', labelEn: 'Academic Notice' },
  { keywords: /job|চাকরি|career|internship|ইন্টার্ন|visit|industry|tour/i, emoji: '💼', labelBn: 'ক্যারিয়ার বিজ্ঞপ্তি', labelEn: 'Career Notice' },
];

function detectCategory(title: string): { emoji: string; labelBn: string; labelEn: string } {
  for (const cat of NOTICE_CATEGORIES) {
    if (cat.keywords.test(title)) return cat;
  }
  return { emoji: '📢', labelBn: 'সাধারণ বিজ্ঞপ্তি', labelEn: 'General Notice' };
}

// Shared prompt for both Gemini and OpenAI
function buildPrompt(title: string, content: string): string {
  return `You are a Bangladeshi university social media manager writing Facebook posts.

Notice Title: "${title}"
${content ? `Notice Content:\n${content.slice(0, 1200)}` : ''}

TASK: Write a Facebook post in Bengali AND English summarizing the key highlights.

CRITICAL RULES:
1. "bn" MUST be in Bengali script (বাংলা ভাষায়) — 3-4 sentences, mention key names/dates/events from the content.
2. "en" must be in English — 3-4 sentences, same key info.
3. NO URLs or web links in either version.
4. End "bn" with: "বিস্তারিত জানতে বিশ্ববিদ্যালয়ের অফিসে যোগাযোগ করুন।"
5. End "en" with: "Contact the university office for more details."

Reply ONLY with valid JSON:
{"bn": "বাংলায় পোস্ট এখানে।", "en": "English post here."}`;
}

@Injectable()
export class UniversityPosterService {
  private readonly logger = new Logger(UniversityPosterService.name);
  private openaiKey: string | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly autoPost: AutoPostService,
    private readonly geminiRotator: GeminiKeyRotatorService,
    private readonly apiKeys: ApiKeysService,
  ) {
    this.openaiKey = apiKeys.getSync('openaiApiKey');
  }

  // Fetch notice URL and extract article content
  private async fetchNoticeContent(url: string): Promise<string> {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FlamboyAIBot/1.0)' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return '';
      const html = await res.text();
      const $ = cheerio.load(html);
      $('script, style, nav, footer, header, .menu, .navbar, noscript, iframe').remove();
      const parts: string[] = [];
      $('h1, h2, h3, p, li, td, .content, article, main').each((_, el) => {
        const t = $(el).text().replace(/\s+/g, ' ').trim();
        if (t.length > 30) parts.push(t);
      });
      return [...new Set(parts)].join('\n').slice(0, 2000);
    } catch {
      return '';
    }
  }

  // Try Gemini first, then OpenAI — same prompt for both
  private async generatePost(title: string, content: string): Promise<{ bn: string; en: string } | null> {
    const prompt = buildPrompt(title, content);

    // 1. Try Gemini
    const geminiKey = this.geminiRotator.getKey();
    if (geminiKey) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.5, maxOutputTokens: 700, thinkingConfig: { thinkingBudget: 0 } },
            }),
            signal: AbortSignal.timeout(12_000),
          },
        );
        if (res.ok) {
          const json = (await res.json()) as any;
          const text = (json?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
          const m = text.match(/\{[\s\S]*\}/);
          if (m) {
            const parsed = JSON.parse(m[0]);
            if (parsed.bn && parsed.en && parsed.bn !== parsed.en) {
              this.logger.log(`[Poster] Gemini generated post for notice`);
              return parsed;
            }
          }
        } else {
          const errText = await res.text().catch(() => '');
          this.logger.warn(`[Poster] Gemini failed status=${res.status} — trying OpenAI. ${errText.slice(0, 100)}`);
        }
      } catch (e: any) {
        this.logger.warn(`[Poster] Gemini error: ${e.message} — trying OpenAI`);
      }
    }

    // 2. Fallback: OpenAI
    const openaiKey = this.openaiKey || this.apiKeys.getSync('openaiApiKey');
    if (openaiKey) {
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 700,
            temperature: 0.5,
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (res.ok) {
          const data = (await res.json()) as any;
          const text = (data?.choices?.[0]?.message?.content || '').trim();
          const m = text.match(/\{[\s\S]*\}/);
          if (m) {
            const parsed = JSON.parse(m[0]);
            if (parsed.bn && parsed.en) {
              this.logger.log(`[Poster] OpenAI generated post for notice`);
              return parsed;
            }
          }
        }
      } catch (e: any) {
        this.logger.warn(`[Poster] OpenAI error: ${e.message}`);
      }
    }

    return null;
  }

  async postNewNotices(pageId: number, newNotices: any[]): Promise<void> {
    if (!newNotices.length) return;

    const config = await this.prisma.universityConfig.findUnique({ where: { pageId } });
    if (!config?.autoPostEnabled) return;

    // Only post notices with a real URL (filters out nav/menu items without links)
    // Also skip notices older than 21 days based on publishedAt or createdAt
    const cutoff = Date.now() - 21 * 24 * 60 * 60 * 1000;
    const validNotices = newNotices.filter((n) => {
      if (!n.url || n.title?.length <= 15) return false;
      // Try to parse publishedAt date string
      const dateRef = n.publishedAt || n.createdAt;
      if (dateRef) {
        const parsed = new Date(dateRef);
        if (!isNaN(parsed.getTime()) && parsed.getTime() < cutoff) {
          this.logger.log(`[Poster] Skipping old notice "${n.title}" (${dateRef})`);
          return false;
        }
      }
      return true;
    });
    if (!validNotices.length) {
      this.logger.log(`[Poster] Skipping — no recent notices with valid URLs`);
      return;
    }

    const toPost = validNotices.slice(0, MAX_POSTS_PER_RUN);
    for (const notice of toPost) {
      try {
        const category = detectCategory(notice.title);
        const noticeContent = await this.fetchNoticeContent(notice.url);

        const generated = await this.generatePost(notice.title, noticeContent);

        let bn: string;
        let en: string;
        if (generated) {
          bn = generated.bn;
          en = generated.en;
        } else {
          // Last resort: use title as-is (no AI available)
          bn = notice.title;
          en = notice.title;
          this.logger.warn(`[Poster] No AI available for notice ${notice.id} — using title only`);
        }

        // Format date in Bengali
        const dateStr = (() => {
          if (!notice.publishedAt) return new Date().toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' });
          const d = new Date(notice.publishedAt);
          return isNaN(d.getTime())
            ? notice.publishedAt
            : d.toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' });
        })();

        const divider = '─────────────────────';
        const caption = [
          `${category.emoji} ${category.labelBn} | ${category.labelEn}`,
          divider,
          bn,
          ``,
          divider,
          en,
          divider,
          `📅 ${dateStr}`,
          ``,
          `#নোটিশ #${category.labelEn.replace(/\s+/g, '')} #বিশ্ববিদ্যালয় #UAP`,
        ].join('\n');

        const fbPostId = await this.autoPost.publishToFacebook(pageId, caption);
        await this.prisma.universityNotice.update({
          where: { id: notice.id },
          data: { autoPosted: true, fbPostId },
        });

        this.logger.log(`[Poster] Posted notice ${notice.id} → fbPostId=${fbPostId}`);
        await new Promise((r) => setTimeout(r, 2000));
      } catch (err: any) {
        this.logger.error(`[Poster] Failed to post notice ${notice.id}: ${err.message}`);
        await this.prisma.universityNotice.update({
          where: { id: notice.id },
          data: { postError: err.message?.slice(0, 255) },
        });
      }
    }
  }
}
