import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhone } from '../crm/phone.util';

export interface SpamResult {
  risk: 'safe' | 'low' | 'medium' | 'high' | 'new' | 'unknown';
  score: number; // 0–100 (higher = riskier)
  totalOrders: number;
  delivered: number;
  cancelled: number;
  successRate: number; // 0–100
  source: string; // which site(s) provided data
  courierBreakdown?: {
    name: string;
    total: number;
    delivered: number;
    successRate: number;
  }[];
}

const UNKNOWN: SpamResult = {
  risk: 'unknown',
  score: 0,
  totalOrders: 0,
  delivered: 0,
  cancelled: 0,
  successRate: 0,
  source: 'none',
};

@Injectable()
export class SpamCheckerService {
  private readonly logger = new Logger(SpamCheckerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Main entry — call this when a customer's phone is known */
  async checkPhone(phone: string, pageId: number): Promise<SpamResult> {
    const normalized = normalizePhone(phone);
    if (!normalized) return UNKNOWN;

    // Always run internal DB check (fast)
    const internalPromise = this.checkInternalDB(normalized);

    // External: waterfall — stop at first success
    const externalPromise = this.checkExternalWaterfall(normalized);

    const [internal, external] = await Promise.all([
      internalPromise,
      externalPromise,
    ]);

    const result = this.combineResults(external, internal);

    // Persist log (fire-and-forget, don't await)
    this.saveLog(pageId, normalized, result).catch(() => {});

    return result;
  }

  /** Manual check endpoint — also saves log */
  async manualCheck(phone: string, pageId: number): Promise<SpamResult> {
    return this.checkPhone(phone, pageId);
  }

  /** Get recent check history for a page */
  async getRecentLogs(pageId: number, limit = 20) {
    return this.prisma.spamCheckLog.findMany({
      where: { pageId },
      orderBy: { checkedAt: 'desc' },
      take: limit,
    });
  }

  // ── Internal DB check ──────────────────────────────────────────────────────

  private async checkInternalDB(phone: string): Promise<SpamResult | null> {
    try {
      const orders = await this.prisma.order.findMany({
        where: { phone },
        select: {
          status: true,
          courierShipment: { select: { status: true } },
        },
      });

      if (!orders.length) return null;

      const total = orders.length;
      let delivered = 0;
      let cancelled = 0;

      for (const o of orders) {
        const shipStatus = o.courierShipment?.status ?? '';
        if (o.status === 'CONFIRMED' || shipStatus === 'delivered') delivered++;
        if (o.status === 'CANCELLED' || shipStatus === 'returned') cancelled++;
      }

      const successRate = total > 0 ? (delivered / total) * 100 : 0;
      const { risk, score } = this.riskFromRate(successRate, total);

      return {
        risk,
        score,
        totalOrders: total,
        delivered,
        cancelled,
        successRate,
        source: 'internal',
      };
    } catch (err: any) {
      this.logger.warn(
        `[SpamChecker] Internal DB check failed: ${err?.message}`,
      );
      return null;
    }
  }

  // ── External waterfall ─────────────────────────────────────────────────────

  private async checkExternalWaterfall(
    phone: string,
  ): Promise<SpamResult | null> {
    const scrapers = [
      () => this.checkElitemart(phone),
      () => this.checkFraudshield(phone),
      () => this.checkBdcommerce(phone),
    ];

    for (const scraper of scrapers) {
      try {
        const result = await scraper();
        if (result && result.totalOrders >= 0) {
          return result;
        }
      } catch {
        // try next
      }
    }
    return null;
  }

  // ── Source 1: elitemart.com.bd ─────────────────────────────────────────────

  private async checkElitemart(phone: string): Promise<SpamResult | null> {
    try {
      // Step 1: GET page → session cookie + CSRF token
      const getRes = await axios.get('https://elitemart.com.bd/fraud-check', {
        timeout: 5000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FlamboyAIBot/1.0)' },
        maxRedirects: 5,
      });

      const html: string = getRes.data;
      const tokenMatch = html.match(
        /name=["']_token["']\s+value=["']([^"']+)["']/,
      );
      if (!tokenMatch) return null;
      const token = tokenMatch[1];

      const cookieHeader = (getRes.headers['set-cookie'] ?? [])
        .map((c: string) => c.split(';')[0])
        .join('; ');

      // Step 2: POST with phone
      const postRes = await axios.post(
        'https://elitemart.com.bd/fraud-check',
        new URLSearchParams({ _token: token, phone }),
        {
          timeout: 5000,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Cookie: cookieHeader,
            'User-Agent': 'Mozilla/5.0 (compatible; FlamboyAIBot/1.0)',
            Referer: 'https://elitemart.com.bd/fraud-check',
          },
          maxRedirects: 5,
        },
      );

      const resHtml: string = postRes.data;

      // Parse data attributes
      const pctMatch = resHtml.match(/data-percentage=["']([0-9.]+)/);
      const totalMatch = resHtml.match(/data-total-orders=["']([0-9]+)/);
      if (!pctMatch || !totalMatch) return null;

      const successRate = parseFloat(pctMatch[1]);
      const totalOrders = parseInt(totalMatch[1], 10);
      const delivered = Math.round((successRate / 100) * totalOrders);
      const cancelled = totalOrders - delivered;

      // Parse per-courier table
      const courierBreakdown = this.parseCourierTable(resHtml);

      const { risk, score } = this.riskFromRate(successRate, totalOrders);

      this.logger.log(
        `[SpamChecker] elitemart OK — phone=${phone} rate=${successRate.toFixed(1)}% total=${totalOrders}`,
      );

      return {
        risk,
        score,
        totalOrders,
        delivered,
        cancelled,
        successRate,
        source: 'elitemart',
        courierBreakdown,
      };
    } catch (err: any) {
      this.logger.debug(`[SpamChecker] elitemart failed: ${err?.message}`);
      return null;
    }
  }

  // ── Source 2: fraudshield.bd ───────────────────────────────────────────────

  private async checkFraudshield(phone: string): Promise<SpamResult | null> {
    try {
      const getRes = await axios.get('https://fraudshield.bd/', {
        timeout: 6000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FlamboyAIBot/1.0)' },
        maxRedirects: 5,
      });

      const html: string = getRes.data;
      const tokenMatch =
        html.match(/name=["']csrf-token["']\s+content=["']([^"']+)["']/) ||
        html.match(/content=["']([^"']+)["']\s+name=["']csrf-token["']/);
      if (!tokenMatch) return null;
      const csrfToken = tokenMatch[1];

      const cookieHeader = (getRes.headers['set-cookie'] ?? [])
        .map((c: string) => c.split(';')[0])
        .join('; ');

      // Try common Inertia/Laravel POST endpoints
      const endpoints = [
        '/check',
        '/fraud-check',
        '/customer/check',
        '/api/check',
      ];
      for (const ep of endpoints) {
        try {
          const postRes = await axios.post(
            `https://fraudshield.bd${ep}`,
            { phone },
            {
              timeout: 6000,
              headers: {
                'X-CSRF-TOKEN': csrfToken,
                'X-Requested-With': 'XMLHttpRequest',
                Cookie: cookieHeader,
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (compatible; FlamboyAIBot/1.0)',
                Referer: 'https://fraudshield.bd/',
              },
              validateStatus: (s) => s < 500,
            },
          );
          if (postRes.status === 200 && postRes.data) {
            return this.parseFraudshieldResponse(postRes.data, phone);
          }
        } catch {
          /* try next endpoint */
        }
      }
      return null;
    } catch (err: any) {
      this.logger.debug(`[SpamChecker] fraudshield failed: ${err?.message}`);
      return null;
    }
  }

  private parseFraudshieldResponse(
    data: any,
    phone: string,
  ): SpamResult | null {
    try {
      // Handle JSON response
      if (typeof data === 'object') {
        const total = Number(
          data.total_orders ?? data.totalOrders ?? data.total ?? 0,
        );
        const delivered = Number(
          data.successful_deliveries ?? data.delivered ?? data.success ?? 0,
        );
        const cancelled = Number(
          data.returns ?? data.cancelled ?? data.returned ?? 0,
        );
        const successRate = total > 0 ? (delivered / total) * 100 : 0;
        const { risk, score } = this.riskFromRate(successRate, total);
        this.logger.log(
          `[SpamChecker] fraudshield OK — phone=${phone} rate=${successRate.toFixed(1)}%`,
        );
        return {
          risk,
          score,
          totalOrders: total,
          delivered,
          cancelled,
          successRate,
          source: 'fraudshield',
        };
      }
      // Handle HTML response
      if (typeof data === 'string') {
        const totalMatch = data.match(/total[^0-9]*([0-9]+)/i);
        const rateMatch = data.match(/([0-9.]+)\s*%/);
        if (totalMatch && rateMatch) {
          const total = parseInt(totalMatch[1], 10);
          const successRate = parseFloat(rateMatch[1]);
          const delivered = Math.round((successRate / 100) * total);
          const cancelled = total - delivered;
          const { risk, score } = this.riskFromRate(successRate, total);
          return {
            risk,
            score,
            totalOrders: total,
            delivered,
            cancelled,
            successRate,
            source: 'fraudshield',
          };
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  // ── Source 3: bdcommerce.app ───────────────────────────────────────────────

  private async checkBdcommerce(phone: string): Promise<SpamResult | null> {
    try {
      const getRes = await axios.get(
        'https://www.bdcommerce.app/tools/delivery-fraud-check',
        {
          timeout: 7000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FlamboyAIBot/1.0)' },
          maxRedirects: 5,
        },
      );

      const html: string = getRes.data;
      const cookieHeader = (getRes.headers['set-cookie'] ?? [])
        .map((c: string) => c.split(';')[0])
        .join('; ');

      // Extract Next.js buildId for API route discovery
      const buildMatch = html.match(/"buildId"\s*:\s*"([^"]+)"/);
      const buildId = buildMatch?.[1];

      const endpoints = [
        '/api/delivery-fraud-check',
        '/api/fraud-check',
        '/api/check',
        buildId
          ? `/_next/data/${buildId}/tools/delivery-fraud-check.json?userNumber=${encodeURIComponent(phone)}`
          : null,
      ].filter(Boolean) as string[];

      for (const ep of endpoints) {
        try {
          const method = ep.includes('_next/data') ? 'get' : 'post';
          const res = await axios({
            method,
            url: `https://www.bdcommerce.app${ep}`,
            ...(method === 'post' ? { data: { userNumber: phone } } : {}),
            timeout: 7000,
            headers: {
              Cookie: cookieHeader,
              'User-Agent': 'Mozilla/5.0 (compatible; FlamboyAIBot/1.0)',
              Referer: 'https://www.bdcommerce.app/tools/delivery-fraud-check',
              'Content-Type': 'application/json',
            },
            validateStatus: (s) => s < 500,
          });
          if (res.status === 200 && res.data) {
            const parsed = this.parseBdcommerceResponse(res.data, phone);
            if (parsed) return parsed;
          }
        } catch {
          /* try next */
        }
      }
      return null;
    } catch (err: any) {
      this.logger.debug(`[SpamChecker] bdcommerce failed: ${err?.message}`);
      return null;
    }
  }

  private parseBdcommerceResponse(data: any, phone: string): SpamResult | null {
    try {
      const d = typeof data === 'string' ? JSON.parse(data) : data;
      const pageProps = d?.pageProps ?? d;
      const total = Number(
        pageProps?.total ??
          pageProps?.totalOrders ??
          pageProps?.total_orders ??
          0,
      );
      const delivered = Number(pageProps?.delivered ?? pageProps?.success ?? 0);
      const cancelled = Number(
        pageProps?.cancelled ?? pageProps?.returned ?? pageProps?.returns ?? 0,
      );
      if (total === 0 && delivered === 0) return null;
      const successRate = total > 0 ? (delivered / total) * 100 : 0;
      const { risk, score } = this.riskFromRate(successRate, total);
      this.logger.log(
        `[SpamChecker] bdcommerce OK — phone=${phone} rate=${successRate.toFixed(1)}%`,
      );
      return {
        risk,
        score,
        totalOrders: total,
        delivered,
        cancelled,
        successRate,
        source: 'bdcommerce',
      };
    } catch {
      return null;
    }
  }

  // ── Combine results ────────────────────────────────────────────────────────

  private combineResults(
    external: SpamResult | null,
    internal: SpamResult | null,
  ): SpamResult {
    if (!external && !internal) return UNKNOWN;
    if (!external) return internal!;
    if (!internal) return external;

    // Both available — weight 70% external (larger dataset), 30% internal
    const extWeight = external.totalOrders >= 5 ? 0.7 : 0.5;
    const intWeight = 1 - extWeight;

    const combinedScore =
      external.score * extWeight + internal.score * intWeight;
    const combinedRate =
      external.successRate * extWeight + internal.successRate * intWeight;
    const totalOrders = external.totalOrders + internal.totalOrders;
    const delivered = external.delivered + internal.delivered;
    const cancelled = external.cancelled + internal.cancelled;

    const { risk } = this.riskFromRate(combinedRate, totalOrders);

    return {
      risk,
      score: Math.round(combinedScore),
      totalOrders,
      delivered,
      cancelled,
      successRate: Math.round(combinedRate * 10) / 10,
      source: `${external.source}+internal`,
      courierBreakdown: external.courierBreakdown,
    };
  }

  // ── Risk calculation ───────────────────────────────────────────────────────

  private riskFromRate(
    successRate: number,
    total: number,
  ): { risk: SpamResult['risk']; score: number } {
    if (total === 0) return { risk: 'new', score: 50 };
    if (successRate >= 76)
      return { risk: 'safe', score: Math.round((100 - successRate) * 0.4) };
    if (successRate >= 51)
      return { risk: 'low', score: Math.round(30 + (75 - successRate)) };
    if (successRate >= 26)
      return { risk: 'medium', score: Math.round(55 + (50 - successRate)) };
    return {
      risk: 'high',
      score: Math.min(100, Math.round(80 + (25 - successRate))),
    };
  }

  // ── HTML helpers ───────────────────────────────────────────────────────────

  private parseCourierTable(html: string): SpamResult['courierBreakdown'] {
    const rows: SpamResult['courierBreakdown'] = [];
    const tableMatch = html.match(
      /<table[^>]*class=["'][^"']*courier_table[^"']*["'][^>]*>([\s\S]*?)<\/table>/i,
    );
    if (!tableMatch) return rows;

    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    let isFirst = true;

    while ((rowMatch = rowRegex.exec(tableMatch[1])) !== null) {
      if (isFirst) {
        isFirst = false;
        continue;
      } // skip header
      const cells = [
        ...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi),
      ].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
      if (cells.length >= 4) {
        const name = cells[0];
        const total = parseInt(cells[1], 10) || 0;
        const delivered = parseInt(cells[2], 10) || 0;
        const successRate = total > 0 ? (delivered / total) * 100 : 0;
        if (name && total > 0)
          rows.push({
            name,
            total,
            delivered,
            successRate: Math.round(successRate * 10) / 10,
          });
      }
    }
    return rows;
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private async saveLog(pageId: number, phone: string, result: SpamResult) {
    await this.prisma.spamCheckLog.create({
      data: {
        pageId,
        phone,
        risk: result.risk,
        score: result.score,
        totalOrders: result.totalOrders,
        delivered: result.delivered,
        cancelled: result.cancelled,
        successRate: result.successRate,
        source: result.source,
      },
    });
  }
}
