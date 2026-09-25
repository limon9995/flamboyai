import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Official pay-as-you-go rates, USD per 1M tokens.
 * Sources (fetched 2026-07-12):
 *  - https://ai.google.dev/gemini-api/docs/pricing
 *  - https://openai.com/api/pricing
 * Note: if the configured Gemini keys are free-tier, actual spend can be $0
 * up to the free quota — these rates are the paid-tier equivalent, i.e. the
 * worst-case real cost.
 */
// Filled by the provider-calling code so callers know which provider actually
// answered and what it cost (real tokens, not guesses).
export interface AiCallUsage {
  provider?: 'gemini' | 'openai' | 'openrouter';
  model?: string;
  promptTokens?: number;
  outputTokens?: number;
}

const MODEL_PRICING_USD_PER_1M: Record<string, { in: number; out: number }> = {
  'gemini-3.5-flash-lite': { in: 0.1, out: 0.4 },
  'gemini-3.5-flash': { in: 0.3, out: 2.5 },
  'gemini-2.5-flash-lite': { in: 0.1, out: 0.4 },
  'gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'gemini-2.0-flash': { in: 0.1, out: 0.4 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4o': { in: 2.5, out: 10 },
};

// Unknown model → assume the most expensive flash-tier rate so the profit
// report errs on the conservative (pessimistic) side.
const FALLBACK_PRICING = { in: 0.3, out: 2.5 };

export function priceUsd(
  model: string,
  promptTokens: number,
  outputTokens: number,
): number {
  const key = Object.keys(MODEL_PRICING_USD_PER_1M).find((m) =>
    model.toLowerCase().startsWith(m),
  );
  const rate = key ? MODEL_PRICING_USD_PER_1M[key] : FALLBACK_PRICING;
  return (
    (promptTokens / 1_000_000) * rate.in + (outputTokens / 1_000_000) * rate.out
  );
}

@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record one AI call's real token usage. Fire-and-forget from hot paths:
   * `void aiUsage.record(...)` — a stats failure must never break a reply.
   */
  async record(input: {
    pageId?: number | null;
    provider: 'gemini' | 'openai' | 'openrouter';
    model: string;
    usageType: string;
    promptTokens?: number | null;
    outputTokens?: number | null;
  }): Promise<void> {
    const promptTokens = Math.max(0, Math.round(input.promptTokens ?? 0));
    const outputTokens = Math.max(0, Math.round(input.outputTokens ?? 0));
    if (promptTokens === 0 && outputTokens === 0) return; // nothing measured
    try {
      await this.prisma.aiUsage.create({
        data: {
          pageId: input.pageId ?? null,
          provider: input.provider,
          model: input.model,
          usageType: input.usageType,
          promptTokens,
          outputTokens,
          costUsd: priceUsd(input.model, promptTokens, outputTokens),
        },
      });
    } catch (err: any) {
      this.logger.warn(`[AiUsage] record failed: ${err?.message}`);
    }
  }

  /** Aggregate measured cost/tokens for a period (used by the profit report). */
  async summary(from: Date, to: Date) {
    const rows = await this.prisma.aiUsage.groupBy({
      by: ['provider', 'model'],
      where: { createdAt: { gte: from, lt: to } },
      _sum: { promptTokens: true, outputTokens: true, costUsd: true },
      _count: { _all: true },
    });
    const totalCostUsd = rows.reduce((s, r) => s + (r._sum.costUsd ?? 0), 0);
    const totalCalls = rows.reduce((s, r) => s + r._count._all, 0);
    return { rows, totalCostUsd, totalCalls };
  }
}
