import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiKeyRotatorService } from '../common/gemini-key-rotator.service';
import * as cheerio from 'cheerio';

const MAX_PAGES = 40;
const MAX_TEXT_PER_PAGE = 3000;
const SKIP_EXTENSIONS = /\.(pdf|jpg|jpeg|png|gif|svg|zip|doc|docx|xls|xlsx|mp4|mp3)(\?|$)/i;
const SKIP_PATHS = /\/(login|logout|cart|checkout|admin|wp-admin|search)\b/i;

interface CrawledPage {
  url: string;
  title: string;
  text: string;
}

@Injectable()
export class UniversityCrawlerService {
  private readonly logger = new Logger(UniversityCrawlerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geminiRotator: GeminiKeyRotatorService,
  ) {}

  async crawlSite(baseUrl: string): Promise<CrawledPage[]> {
    const base = new URL(baseUrl);
    const visited = new Set<string>();
    const queue: string[] = [base.href];
    const results: CrawledPage[] = [];

    while (queue.length > 0 && results.length < MAX_PAGES) {
      const url = queue.shift()!;
      const normalized = url.split('#')[0];
      if (visited.has(normalized)) continue;
      visited.add(normalized);

      try {
        const res = await fetch(normalized, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FlamboyAIBot/1.0)' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) continue;
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('text/html')) continue;

        const html = await res.text();
        const $ = cheerio.load(html);

        // Remove noise elements
        $('script, style, nav, footer, header, .menu, .navbar, .sidebar, .advertisement, .ad, noscript, iframe').remove();

        const title = $('title').text().trim() || $('h1').first().text().trim();

        // Extract meaningful text blocks
        const textParts: string[] = [];
        $('h1, h2, h3, h4, p, li, td, th, .content, article, main, section').each((_, el) => {
          const t = $(el).text().replace(/\s+/g, ' ').trim();
          if (t.length > 20) textParts.push(t);
        });

        const text = [...new Set(textParts)].join('\n').slice(0, MAX_TEXT_PER_PAGE);
        if (text.length > 100) {
          results.push({ url: normalized, title, text });
        }

        // Collect internal links
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href') || '';
          if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
          if (SKIP_EXTENSIONS.test(href)) return;
          try {
            const abs = new URL(href, normalized);
            if (abs.hostname !== base.hostname) return;
            if (SKIP_PATHS.test(abs.pathname)) return;
            const key = abs.href.split('#')[0];
            if (!visited.has(key)) queue.push(key);
          } catch {}
        });

        // Small delay to be polite
        await new Promise((r) => setTimeout(r, 300));
      } catch (err: any) {
        this.logger.warn(`[Crawler] Skip ${normalized}: ${err.message}`);
      }
    }

    this.logger.log(`[Crawler] Crawled ${results.length} pages from ${baseUrl}`);
    return results;
  }

  async runFullCrawlForPage(pageId: number): Promise<{ pagesCrawled: number }> {
    const config = await this.prisma.universityConfig.findUnique({ where: { pageId } });
    if (!config) return { pagesCrawled: 0 };

    const crawlUrl = config.crawlBaseUrl || config.scrapeUrl;
    if (!crawlUrl) return { pagesCrawled: 0 };

    let pages: CrawledPage[] = [];
    try {
      pages = await this.crawlSite(crawlUrl);
    } catch (err: any) {
      this.logger.error(`[Crawler] Page ${pageId} crawl failed: ${err.message}`);
      return { pagesCrawled: 0 };
    }

    // Build knowledge text
    const knowledge = pages
      .map((p) => `### ${p.title}\n${p.url}\n${p.text}`)
      .join('\n\n---\n\n')
      .slice(0, 80_000);

    // Extract structured metadata
    const extractedMeta = await this.extractStructuredMeta(knowledge);

    // Auto-update structured knowledge from important pages (fees, contacts, departments)
    const autoKnowledge = await this.buildAutoKnowledge(crawlUrl, pages);

    await this.prisma.universityConfig.update({
      where: { id: config.id },
      data: {
        scrapedKnowledgeText: knowledge,
        lastFullCrawlAt: new Date(),
        extractedMeta: JSON.stringify(extractedMeta),
        ...(autoKnowledge ? { knowledgeText: autoKnowledge } : {}),
      },
    });

    return { pagesCrawled: pages.length };
  }

  // Finds and fetches important pages (fees, contacts, departments) from the crawled site
  private async buildAutoKnowledge(baseUrl: string, crawledPages: CrawledPage[]): Promise<string | null> {
    const IMPORTANT_KEYWORDS = /fee|tuition|cost|contact|admission|department|faculty|program|scholarship|waiver/i;
    const base = new URL(baseUrl);

    // Collect URLs from crawled pages that match important keywords
    const importantUrls = new Set<string>();

    // Also discover links from the homepage that match keywords
    try {
      const homeRes = await fetch(baseUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FlamboyAIBot/1.0)' },
        signal: AbortSignal.timeout(10_000),
      });
      if (homeRes.ok) {
        const html = await homeRes.text();
        const $ = (await import('cheerio')).load(html);
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href') || '';
          try {
            const abs = new URL(href, baseUrl);
            // Allow same domain AND common subdomains (e.g. cse.uap-bd.edu)
            const sameDomain = abs.hostname === base.hostname ||
              abs.hostname.endsWith('.' + base.hostname);
            if (!sameDomain) return;
            const text = ($(el).text() + ' ' + abs.pathname).toLowerCase();
            if (IMPORTANT_KEYWORDS.test(text) || IMPORTANT_KEYWORDS.test(abs.pathname)) {
              importantUrls.add(abs.href.split('#')[0]);
            }
          } catch {}
        });
      }
    } catch {}

    // Also add already-crawled important pages
    for (const p of crawledPages) {
      if (IMPORTANT_KEYWORDS.test(p.title) || IMPORTANT_KEYWORDS.test(p.url)) {
        importantUrls.add(p.url);
      }
    }

    if (importantUrls.size === 0) return null;

    // Fetch up to 10 important pages
    const sections: string[] = [];
    let fetched = 0;
    for (const url of importantUrls) {
      if (fetched >= 10) break;
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FlamboyAIBot/1.0)' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) continue;
        const html = await res.text();
        const $ = (await import('cheerio')).load(html);
        $('script, style, nav, footer, header, .menu, .navbar, noscript').remove();
        const title = $('title').text().trim() || $('h1').first().text().trim();
        const textParts: string[] = [];
        $('h1, h2, h3, h4, p, li, td, th, table').each((_, el) => {
          const t = $(el).text().replace(/\s+/g, ' ').trim();
          if (t.length > 15) textParts.push(t);
        });
        const text = [...new Set(textParts)].join('\n').slice(0, 4_000);
        if (text.length > 100) {
          sections.push(`=== ${title} ===\n${text}`);
          fetched++;
        }
        await new Promise((r) => setTimeout(r, 300));
      } catch {}
    }

    if (sections.length === 0) return null;

    const result = sections.join('\n\n').slice(0, 30_000);
    this.logger.log(`[Crawler] Auto-knowledge updated: ${sections.length} important pages, ${result.length} chars`);
    return result;
  }

  private async extractStructuredMeta(knowledgeText: string): Promise<{
    departments: string[];
    semesters: string[];
    courses: string[];
  }> {
    const empty = { departments: [], semesters: [], courses: [] };

    // ── 1. Regex-based department extraction ──────────────────────────────────
    const deptSet = new Set<string>();

    // "Department of X" / "Dept. of X"
    const deptOfMatches = knowledgeText.matchAll(/\bDept(?:artment)?\.?\s+of\s+([A-Z][A-Za-z &]+?)(?=[\n,;.()|]|$)/gm);
    for (const m of deptOfMatches) {
      const name = m[1].trim().replace(/\s+/g, ' ');
      if (name.length > 2 && name.length < 60) deptSet.add(name);
    }

    // Known abbreviations appearing as standalone words or in titles
    const abbreviations = ['CSE', 'EEE', 'CE', 'ME', 'IPE', 'BBA', 'MBA', 'LLB', 'LLM'];
    for (const abbr of abbreviations) {
      const re = new RegExp(`\\b(${abbr})\\b`);
      if (re.test(knowledgeText)) deptSet.add(abbr);
    }

    // School of / Faculty of / Program in
    const schoolMatches = knowledgeText.matchAll(/\b(?:School|Faculty|Program)\s+(?:of|in)\s+([A-Z][A-Za-z &]+?)(?=[\n,;.()|]|$)/gm);
    for (const m of schoolMatches) {
      const name = m[1].trim().replace(/\s+/g, ' ');
      if (name.length > 2 && name.length < 60) deptSet.add(name);
    }

    // Clean up: remove too-short, ends with common titles, duplicates of abbreviations
    const deptClean = [...deptSet].filter(d => {
      if (d.length < 3) return false;
      // Short words must be ALL CAPS (proper abbreviations like CSE, EEE)
      if (d.length < 5 && d !== d.toUpperCase()) return false;
      if (/^(Dr|Prof|Mr|Ms|Md|the|and|of)\.?$/i.test(d)) return false;
      if (d.endsWith(' Dr') || d.endsWith(' Prof') || d.endsWith(' Mr')) return false;
      return true;
    });
    const departments = deptClean.slice(0, 30);

    // ── 2. Regex-based semester extraction ────────────────────────────────────
    const semSet = new Set<string>();
    const ordinals = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];

    // "3rd Year 1st semester" or "3rd Year" or "1st semester"
    const semMatches = knowledgeText.matchAll(/\b(\d+(?:st|nd|rd|th))\s+(?:Year|Semester|Sem)\b/gi);
    for (const m of semMatches) semSet.add(m[0].trim());

    // Also add standard ordinals if any year/semester pattern found
    if (semSet.size > 0) {
      for (const ord of ordinals) semSet.add(`${ord} Semester`);
    } else {
      // Default: add standard semesters if none detected
      for (const ord of ordinals) semSet.add(`${ord} Semester`);
    }

    const semesters = [...semSet].slice(0, 20);

    // ── 3. Gemini enhancement for courses (optional) ─────────────────────────
    let courses: string[] = [];
    if (this.geminiRotator.isAvailable()) {
      const key = this.geminiRotator.getKey();
      if (key) {
        const courseLines = knowledgeText.split('\n')
          .filter(l => /course|subject|curriculum|credit/i.test(l))
          .slice(0, 80).join('\n').slice(0, 8_000);

        if (courseLines.length > 200) {
          try {
            const prompt = `From this university content, list course/subject names only (e.g. "Data Structures", "Business Law", "Calculus").
Return ONLY valid JSON: {"courses": ["..."]}
No departments or semesters — only course/subject names.

Content:
${courseLines}`;
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`;
            const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 600, thinkingConfig: { thinkingBudget: 0 } } }),
              signal: AbortSignal.timeout(12_000),
            });
            if (res.ok) {
              const data: any = await res.json();
              const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
              const m = raw.match(/\{[\s\S]*\}/);
              if (m) {
                const parsed = JSON.parse(m[0]);
                courses = Array.isArray(parsed.courses) ? parsed.courses.slice(0, 50) : [];
              }
            }
          } catch {}
        }
      }
    }

    this.logger.log(`[Crawler] Extracted meta: ${departments.length} depts, ${semesters.length} semesters, ${courses.length} courses`);
    return { departments, semesters, courses };
  }
}
