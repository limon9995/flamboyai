import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const MAX_SCAN = 3000;

@Injectable()
export class InboxService {
  constructor(private readonly prisma: PrismaService) {}

  async listConversations(
    pageId: number,
    opts: { platform?: string; search?: string } = {},
  ) {
    const where: any = { pageId };
    if (opts.platform) where.platform = opts.platform;

    const rows = await this.prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: MAX_SCAN,
    });

    const latestByConversation = new Map<string, (typeof rows)[number]>();
    for (const m of rows) {
      const key = `${m.platform}:${m.customerPsid}`;
      if (!latestByConversation.has(key)) latestByConversation.set(key, m);
    }

    const customers = await this.prisma.customer.findMany({ where: { pageId } });
    const customerByKey = new Map(customers.map((c) => [`${c.platform}:${c.psid}`, c]));

    let conversations = Array.from(latestByConversation.values()).map((m) => {
      const customer = customerByKey.get(`${m.platform}:${m.customerPsid}`);
      return {
        psid: m.customerPsid,
        platform: m.platform,
        lastMessage: m.content,
        lastMessageType: m.type,
        lastDirection: m.direction,
        lastMessageAt: m.createdAt,
        customerName: customer?.name ?? null,
        customerPhone: customer?.phone ?? null,
      };
    });

    if (opts.search) {
      const q = opts.search.toLowerCase();
      conversations = conversations.filter(
        (c) =>
          (c.customerName ?? '').toLowerCase().includes(q) ||
          (c.customerPhone ?? '').includes(q) ||
          c.psid.includes(q),
      );
    }

    conversations.sort(
      (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
    );
    return conversations;
  }

  async listMessages(
    pageId: number,
    platform: string,
    psid: string,
    opts: { limit?: number } = {},
  ) {
    return this.prisma.message.findMany({
      where: { pageId, platform, customerPsid: psid },
      orderBy: { createdAt: 'asc' },
      take: opts.limit ?? 300,
    });
  }
}
