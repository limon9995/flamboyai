import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { SupportChatResult, SupportChatService } from './support-chat.service';

@Controller('support-chat')
@UseGuards(AuthGuard)
@SkipThrottle({ global: true, auth: true })
@Throttle({ chat: { ttl: 60_000, limit: 20 } })
export class SupportChatController {
  constructor(
    private readonly service: SupportChatService,
    private readonly auth: AuthService,
  ) {}

  /** Returns the page id only when the caller may access it; the assistant's data tools are scoped to it. */
  private pageIdFor(req: any, raw: any): number | undefined {
    const pageId = Number(raw);
    if (!Number.isInteger(pageId) || pageId <= 0) return undefined;
    this.auth.ensurePageAccess(req.user || req.authUser, pageId);
    return pageId;
  }

  @Post()
  async chat(@Req() req: any, @Body() body: any): Promise<SupportChatResult> {
    const message = String(body?.message ?? '')
      .trim()
      .slice(0, 1000);
    if (!message) return { reply: 'কিছু লিখুন 😊' };

    const pageContext = String(body?.pageContext ?? '').trim();

    const rawHistory = Array.isArray(body?.history) ? body.history : [];
    const history = rawHistory
      .slice(-10)
      .filter((m: any) => m?.role && m?.content)
      .map((m: any) => ({
        role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: String(m.content).slice(0, 1500),
      }));

    const liveData =
      body?.liveData && typeof body.liveData === 'object'
        ? body.liveData
        : undefined;

    const pageId = this.pageIdFor(req, body?.pageId);
    return this.service.chat(message, pageContext, history, liveData, pageId);
  }

  /** Applies one change the user confirmed from Liza's Confirm card. */
  @Post('execute')
  async execute(@Req() req: any, @Body() body: any): Promise<{ message: string }> {
    const pageId = this.pageIdFor(req, body?.pageId);
    if (!pageId) return { message: 'Page select করা নেই' };
    const message = await this.service.executeAction(pageId, body?.action);
    return { message };
  }
}
