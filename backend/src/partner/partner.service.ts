import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AgentEarningSourceType = 'RECHARGE' | 'SUBSCRIPTION_FEE';

@Injectable()
export class PartnerService {
  private readonly logger = new Logger(PartnerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Called from the 4 money-flow confirmation points (wallet recharge
   * approval/auto-verify, subscription payment confirm/auto-confirm). If the
   * paying client was referred by an agent, snapshots the agent's current
   * rate for this source type and appends an AgentEarning row. No-ops
   * silently (and never throws) if the client has no referring agent, the
   * agent is inactive, or the relevant rate isn't set — commission
   * bookkeeping must never break the underlying money flow.
   */
  async recordEarningIfReferred(
    payingUserId: string,
    sourceType: AgentEarningSourceType,
    grossAmountBdt: number,
    referenceId: string,
    sourcePageId?: number,
  ): Promise<void> {
    try {
      if (!grossAmountBdt || grossAmountBdt <= 0) return;
      const payer = await this.prisma.user.findUnique({
        where: { id: payingUserId },
        select: { referredByAgentId: true },
      });
      if (!payer?.referredByAgentId) return;

      const agent = await this.prisma.user.findUnique({
        where: { id: payer.referredByAgentId },
        select: {
          id: true,
          role: true,
          isActive: true,
          commissionPercentRecharge: true,
          commissionPercentSubscription: true,
        },
      });
      if (!agent || agent.role !== 'agent' || !agent.isActive) return;

      const rate =
        sourceType === 'RECHARGE'
          ? agent.commissionPercentRecharge
          : agent.commissionPercentSubscription;
      if (!rate || rate <= 0) return;

      const commissionAmountBdt = grossAmountBdt * (rate / 100);

      await this.prisma.agentEarning.create({
        data: {
          agentId: agent.id,
          sourceType,
          sourceUserId: payingUserId,
          sourcePageId: sourcePageId ?? null,
          grossAmountBdt,
          commissionPercent: rate,
          commissionAmountBdt,
          referenceId,
        },
      });
    } catch (err: any) {
      this.logger.error(
        `Failed to record agent earning for user ${payingUserId} (${sourceType}): ${err?.message ?? err}`,
      );
    }
  }

  private async getBalances(agentId: string) {
    const [earnings, payouts] = await Promise.all([
      this.prisma.agentEarning.aggregate({
        where: { agentId },
        _sum: { commissionAmountBdt: true },
      }),
      this.prisma.agentPayout.aggregate({
        where: { agentId },
        _sum: { amountBdt: true },
      }),
    ]);
    const lifetimeEarnedBdt = earnings._sum.commissionAmountBdt ?? 0;
    const lifetimePaidBdt = payouts._sum.amountBdt ?? 0;
    return {
      lifetimeEarnedBdt,
      lifetimePaidBdt,
      owedBalanceBdt: lifetimeEarnedBdt - lifetimePaidBdt,
    };
  }

  async getSelfProfile(agentId: string) {
    const agent = await this.prisma.user.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        name: true,
        username: true,
        referralCode: true,
        commissionPercentRecharge: true,
        commissionPercentSubscription: true,
      },
    });
    if (!agent) throw new Error('Agent not found');
    const balances = await this.getBalances(agentId);
    const clientCount = await this.prisma.user.count({
      where: { referredByAgentId: agentId },
    });
    return { ...agent, ...balances, clientCount };
  }

  async getReferredClients(agentId: string) {
    const clients = await this.prisma.user.findMany({
      where: { referredByAgentId: agentId },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        isActive: true,
        createdAt: true,
        pages: {
          select: {
            id: true,
            pageId: true,
            pageName: true,
            isActive: true,
            subscriptionStatus: true,
            creditBalance: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return clients.map((c) => ({ ...c, pageCount: c.pages.length }));
  }

  async getEarnings(agentId: string, page = 1, pageSize = 30) {
    const skip = (Math.max(1, page) - 1) * pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.agentEarning.findMany({
        where: { agentId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.agentEarning.count({ where: { agentId } }),
    ]);
    return { rows, total, page, pageSize };
  }

  async getPayouts(agentId: string, page = 1, pageSize = 30) {
    const skip = (Math.max(1, page) - 1) * pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.agentPayout.findMany({
        where: { agentId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.agentPayout.count({ where: { agentId } }),
    ]);
    return { rows, total, page, pageSize };
  }

  // ── Admin-facing helpers (used by AdminService) ───────────────────────────

  async listAgentsWithBalances() {
    const agents = await this.prisma.user.findMany({
      where: { role: 'agent' },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        isActive: true,
        createdAt: true,
        referralCode: true,
        commissionPercentRecharge: true,
        commissionPercentSubscription: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!agents.length) return [];

    const agentIds = agents.map((a) => a.id);
    const [earningsGrouped, payoutsGrouped, clientCounts] = await Promise.all([
      this.prisma.agentEarning.groupBy({
        by: ['agentId'],
        where: { agentId: { in: agentIds } },
        _sum: { commissionAmountBdt: true },
      }),
      this.prisma.agentPayout.groupBy({
        by: ['agentId'],
        where: { agentId: { in: agentIds } },
        _sum: { amountBdt: true },
      }),
      this.prisma.user.groupBy({
        by: ['referredByAgentId'],
        where: { referredByAgentId: { in: agentIds } },
        _count: { _all: true },
      }),
    ]);
    const earnedMap = new Map(
      earningsGrouped.map((e) => [e.agentId, e._sum.commissionAmountBdt ?? 0]),
    );
    const paidMap = new Map(
      payoutsGrouped.map((p) => [p.agentId, p._sum.amountBdt ?? 0]),
    );
    const clientCountMap = new Map(
      clientCounts.map((c) => [c.referredByAgentId, c._count._all]),
    );

    return agents.map((a) => {
      const lifetimeEarnedBdt = earnedMap.get(a.id) ?? 0;
      const lifetimePaidBdt = paidMap.get(a.id) ?? 0;
      return {
        ...a,
        lifetimeEarnedBdt,
        lifetimePaidBdt,
        owedBalanceBdt: lifetimeEarnedBdt - lifetimePaidBdt,
        clientCount: clientCountMap.get(a.id) ?? 0,
      };
    });
  }

  async updateAgent(
    agentId: string,
    data: Partial<{
      name: string;
      commissionPercentRecharge: number;
      commissionPercentSubscription: number;
    }>,
  ) {
    const agent = await this.prisma.user.findUnique({ where: { id: agentId } });
    if (!agent || agent.role !== 'agent') throw new Error('Agent not found');
    return this.prisma.user.update({ where: { id: agentId }, data });
  }

  async recordPayout(
    agentId: string,
    amountBdt: number,
    note: string | undefined,
    paidByAdminUsername: string,
  ) {
    const agent = await this.prisma.user.findUnique({ where: { id: agentId } });
    if (!agent || agent.role !== 'agent') throw new Error('Agent not found');
    if (!amountBdt || amountBdt <= 0) throw new Error('amountBdt must be positive');
    return this.prisma.agentPayout.create({
      data: { agentId, amountBdt, note, paidByAdminUsername },
    });
  }

  async getAgentEarningsLedger(agentId: string) {
    return this.prisma.agentEarning.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
