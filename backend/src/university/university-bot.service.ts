import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from '../common/api-keys.service';
import { GeminiKeyRotatorService } from '../common/gemini-key-rotator.service';
import type { Page } from '@prisma/client';

interface GroupLink {
  id: number;
  label: string;
  semester: string | null;
  department: string | null;
  course: string | null;
  linkType: string;
  link: string;
  isActive: boolean;
}

const GROUP_KEYWORDS = ['group', 'গ্রুপ', 'join', 'যোগ', 'add', 'যুক্ত', 'link', 'লিংক'];
const SEMESTER_MAP: Record<string, string[]> = {
  '1': ['1st', '১ম', '১', 'first', 'প্রথম'],
  '2': ['2nd', '২য়', '২', 'second', 'দ্বিতীয়'],
  '3': ['3rd', '৩য়', '৩', 'third', 'তৃতীয়'],
  '4': ['4th', '৪র্থ', '৪', 'fourth', 'চতুর্থ'],
  '5': ['5th', '৫ম', '৫', 'fifth', 'পঞ্চম'],
  '6': ['6th', '৬ষ্ঠ', '৬', 'sixth', 'ষষ্ঠ'],
  '7': ['7th', '৭ম', '৭', 'seventh', 'সপ্তম'],
  '8': ['8th', '৮ম', '৮', 'eighth', 'অষ্টম'],
};

@Injectable()
export class UniversityBotService {
  private readonly logger = new Logger(UniversityBotService.name);
  private provider: string;
  private model: string;
  private openaiKey: string | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeys: ApiKeysService,
    private readonly geminiRotator: GeminiKeyRotatorService,
  ) {
    this.openaiKey = apiKeys.getSync('openaiApiKey');
    this.provider = apiKeys.getSync('aiIntentProvider') || 'gemini';
    this.model = apiKeys.getSync('aiIntentModel') || 'gemini-3.5-flash-lite';
  }

  async handleMessage(page: Page, psid: string, text: string): Promise<string | null> {
    const config = await this.prisma.universityConfig.findUnique({ where: { pageId: page.id } });
    if (!config) return null;

    const normalized = text.toLowerCase();

    const isGroupRequest = GROUP_KEYWORDS.some((kw) => normalized.includes(kw));
    if (isGroupRequest) {
      const links = await this.prisma.groupLink.findMany({ where: { pageId: page.id, isActive: true } });
      const match = this.findGroupLink(normalized, links);
      if (match) {
        return `✅ এখানে আপনার গ্রুপের লিংক:\n\n${match.label}\n${match.link}`;
      }
      if (links.length > 0) {
        return '📚 কোন সেমিস্টার বা ডিপার্টমেন্টের গ্রুপ লিংক চাইছেন? যেমন: "CSE ৫ম সেমিস্টার গ্রুপ"';
      }
    }

    return this.answerWithAI(config, text);
  }

  findGroupLink(text: string, links: GroupLink[]): GroupLink | null {
    if (!links.length) return null;

    let bestMatch: GroupLink | null = null;
    let bestScore = 0;

    for (const link of links) {
      let score = 0;
      const dept = link.department?.toLowerCase();
      const sem = link.semester;
      const course = link.course?.toLowerCase();

      if (dept && text.includes(dept)) score += 3;
      if (course && text.includes(course)) score += 3;
      if (sem) {
        const aliases = SEMESTER_MAP[sem] || [];
        if (aliases.some((a) => text.includes(a.toLowerCase()))) score += 2;
        if (text.includes(sem)) score += 2;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = link;
      }
    }

    return bestScore >= 2 ? bestMatch : null;
  }

  private async answerWithAI(config: any, question: string): Promise<string | null> {
    // Load FAQs for exact/near match first
    const faqs = await this.prisma.universityFaq.findMany({
      where: { pageId: config.pageId },
      orderBy: { sortOrder: 'asc' },
    });

    // Check for direct FAQ match (simple keyword overlap)
    const qLower = question.toLowerCase();
    for (const faq of faqs) {
      const fqLower = faq.question.toLowerCase();
      const words = fqLower.split(/\s+/).filter((w) => w.length > 3);
      const matchCount = words.filter((w) => qLower.includes(w)).length;
      if (matchCount >= 2 || (words.length <= 3 && matchCount >= 1)) {
        return `${faq.answer}`;
      }
    }

    // Build combined knowledge context
    const faqText = faqs.length
      ? faqs.map((f) => `প্রশ্ন: ${f.question}\nউত্তর: ${f.answer}`).join('\n\n')
      : '';

    // Use scraped knowledge (full site) + manual text + FAQs
    // Strip raw URLs from scraped content so AI doesn't paste them in replies
    const rawScraped = config.scrapedKnowledgeText || '';
    const scrapedKnowledge = rawScraped
      .replace(/https?:\/\/\S+/g, '')          // remove URLs
      .replace(/#{1,4}\s+https?:\/\/\S+/g, '') // remove URL headings
      .replace(/\n{3,}/g, '\n\n')              // collapse blank lines
      .trim();
    const manualKnowledge = config.knowledgeText || '';

    const combinedKnowledge = [
      manualKnowledge ? `=== অতিরিক্ত তথ্য ===\n${manualKnowledge}` : '',
      faqText ? `=== FAQ ===\n${faqText}` : '',
      scrapedKnowledge ? `=== বিশ্ববিদ্যালয়ের তথ্য ===\n${scrapedKnowledge.slice(0, 10_000)}` : '',
    ].filter(Boolean).join('\n\n');

    const systemPrompt = `You are a helpful university assistant bot. Answer student questions clearly and accurately using the knowledge below.

KNOWLEDGE BASE:
${combinedKnowledge || '(No knowledge loaded yet — run Website Crawl in Settings)'}

STRICT RULES:
- Reply in BOTH Bengali and English, Bengali first
- Format: [Bengali answer]\n\n[English answer]
- Keep each answer short: 2–4 sentences max
- Extract actual information from the knowledge (names, fees, dates, departments, procedures)
- NEVER share any URLs or links in your reply
- NEVER make up information not found in the knowledge
- If info not found: reply "এই তথ্য এখন আমার কাছে নেই। সরাসরি বিশ্ববিদ্যালয়ের অফিসে যোগাযোগ করুন। / This information is not available right now. Please contact the university office directly."
- Be friendly and conversational`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: question },
    ];

    try {
      let aiReply: string | null = null;
      // Try Gemini — always attempt even if rotator thinks quota is hit,
      // since university bot has low traffic and may succeed on a fresh try
      const geminiKey = this.geminiRotator.getKey();
      if (geminiKey) {
        aiReply = await this.callGemini(messages);
      }
      if (!aiReply && this.openaiKey) {
        aiReply = await this.callOpenAI(messages);
      }
      if (aiReply) return aiReply;
    } catch (err: any) {
      this.logger.error(`[UniversityBot] AI call failed: ${err.message}`);
    }

    return 'এই মুহূর্তে উত্তর দিতে পারছি না। অনুগ্রহ করে কিছুক্ষণ পরে আবার চেষ্টা করুন।\n\nUnable to answer right now. Please try again shortly.';
  }

  private async callGemini(messages: { role: string; content: string }[]): Promise<string | null> {
    const key = this.geminiRotator.getKey();
    if (!key) return null;
    const systemMsg = messages.find((m) => m.role === 'system');
    const rest = messages.filter((m) => m.role !== 'system');
    const contents = rest.map((m) => ({ role: 'user', parts: [{ text: m.content }] }));
    const body: any = { contents, generationConfig: { temperature: 0.4, maxOutputTokens: 300 } };
    if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      this.logger.error(`[UniversityBot] Gemini error status=${res.status} body=${errText.slice(0, 300)}`);
      return null;
    }
    const data: any = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    this.logger.log(`[UniversityBot] Gemini reply len=${text?.length ?? 0}`);
    return text;
  }

  private async callOpenAI(messages: { role: string; content: string }[]): Promise<string | null> {
    if (!this.openaiKey) return null;
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.openaiKey}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages, max_tokens: 300, temperature: 0.4 }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
  }
}
