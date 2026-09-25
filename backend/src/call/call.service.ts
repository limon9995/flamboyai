import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { TtsService } from './tts.service';
import { CourierService } from '../courier/courier.service';

export type CallResult = {
  success: boolean;
  message: string;
  callAttemptId?: number;
  callProvider?: string;
};

type CallMode = 'MANUAL' | 'AUTO' | 'AUTO_MANUAL' | 'AUTO_AFTER_DELAY';

// In-memory dedup set: prevents two concurrent auto-calls for same order
const pendingAutoCall = new Set<number>();
const scheduledAutoCallTimers = new Map<number, NodeJS.Timeout>();
const pageCallBusyUntil = new Map<number, number>();
const pageFairQueues = new Map<number, Array<() => Promise<void>>>();
const fairQueuePageOrder: number[] = [];
let fairQueueDraining = false;
let globalCallBusyUntil = 0;
const PAGE_CALL_GAP_MS = 2 * 60 * 1000;
const providerCooldownUntil = new Map<string, number>();
const PROVIDER_COOLDOWN_MS = 5 * 60 * 1000;

@Injectable()
export class CallService {
  private readonly logger = new Logger(CallService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tts: TtsService,
    private readonly courier: CourierService,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Called by DraftOrderHandler after order is finalized.
   * AUTO / AUTO_MANUAL → mark pending + fire async (non-blocking).
   * MANUAL             → mark pending only (agent triggers from dashboard).
   */
  async triggerAutoCallIfEnabled(
    pageId: number,
    orderId: number,
  ): Promise<void> {
    const page = await this.prisma.page.findUnique({ where: { id: pageId } });
    if (!page?.callConfirmModeOn) return;

    const mode = ((page as any).callMode || 'MANUAL').toUpperCase() as CallMode;

    // Dedup: skip if already queued
    if (pendingAutoCall.has(orderId)) {
      this.logger.warn(
        `[CALL] order=${orderId} already in auto-call queue — skipping duplicate`,
      );
      return;
    }

    await this.markPending(orderId);

    if (
      mode === 'AUTO' ||
      mode === 'AUTO_MANUAL' ||
      mode === 'AUTO_AFTER_DELAY'
    ) {
      pendingAutoCall.add(orderId);
      const delayMs = this.getInitialAutoCallDelayMs(page as any, mode);
      const runAutoCall = () => {
        this.enqueueFairAutoCall(pageId, async () => {
          try {
            const fresh = await this.prisma.order.findUnique({
              where: { id: orderId },
              select: {
                id: true,
                pageIdRef: true,
                status: true,
                callStatus: true,
                phone: true,
              },
            });
            if (!fresh || fresh.pageIdRef !== pageId) return;
            if (!fresh.phone) return;
            if (['CONFIRMED', 'CANCELLED'].includes(fresh.status)) {
              this.logger.log(
                `[AUTO-CALL] order=${orderId} skipped because status=${fresh.status}`,
              );
              return;
            }

            await this.sendManualCall(pageId, orderId);
          } catch (err) {
            this.logger.error(`[AUTO-CALL] order=${orderId}: ${err}`);
          } finally {
            pendingAutoCall.delete(orderId);
            scheduledAutoCallTimers.delete(orderId);
          }
        });
      };

      if (delayMs > 0) {
        const timer = setTimeout(runAutoCall, delayMs);
        scheduledAutoCallTimers.set(orderId, timer);
        this.logger.log(
          `[CALL] order=${orderId} scheduled after ${Math.round(delayMs / 60000)} minute(s) (mode=${mode})`,
        );
      } else {
        Promise.resolve().then(runAutoCall);
        this.logger.log(`[CALL] order=${orderId} auto-queued (mode=${mode})`);
      }
    } else {
      this.logger.log(`[CALL] order=${orderId} pending for manual trigger`);
    }
  }

  /** Dashboard: agent manually triggers a call */
  async sendManualCall(pageId: number, orderId: number): Promise<CallResult> {
    const { order, page } = await this.loadOrderAndPage(pageId, orderId);
    if (!order.phone) return fail('Phone number নেই');
    return this.initiateCall(page, order);
  }

  /** Dashboard: agent retries a failed/pending call */
  async resendCall(pageId: number, orderId: number): Promise<CallResult> {
    const { order, page } = await this.loadOrderAndPage(pageId, orderId);
    const retries = order.callRetryCount || 0;
    const max = (page as any).maxCallRetries || 3;
    if (retries >= max)
      return fail(`Max retry (${max}) reached. Tried ${retries} times.`);
    return this.initiateCall(page, order);
  }

  /** DTMF webhook callback from call provider */
  async handleDtmfCallback(
    callAttemptId: number,
    dtmfInput: string,
    durationSeconds: number,
  ) {
    const attempt = await this.prisma.callAttempt.findUnique({
      where: { id: callAttemptId },
    });
    if (!attempt) {
      this.logger.warn(`[DTMF] callAttempt #${callAttemptId} not found`);
      return { success: false, message: 'CallAttempt not found' };
    }

    if (['ANSWERED', 'NOT_ANSWERED'].includes(attempt.status)) {
      this.logger.warn(
        `[DTMF] duplicate callback ignored for attempt=${callAttemptId} status=${attempt.status}`,
      );
      const order = await this.prisma.order.findUnique({
        where: { id: attempt.orderId },
        select: { callStatus: true },
      });
      return {
        success: true,
        message: 'Duplicate callback ignored',
        callStatus: order?.callStatus || null,
      };
    }

    const normalizedInput = String(dtmfInput || '').trim();
    const hasValidSelection = ['1', '2', '3'].includes(normalizedInput);
    const attemptStatus = hasValidSelection ? 'ANSWERED' : 'NOT_ANSWERED';

    await this.prisma.callAttempt.update({
      where: { id: callAttemptId },
      data: {
        dtmfInput: normalizedInput || null,
        durationSeconds,
        status: attemptStatus,
      },
    });

    // 1=confirm  2=cancel  3=needs agent  else=no answer / no valid input
    const callStatus =
      normalizedInput === '1'
        ? 'CONFIRMED_BY_CALL'
        : normalizedInput === '2'
          ? 'CANCELLED_BY_CALL'
          : normalizedInput === '3'
            ? 'NEEDS_AGENT'
            : 'NOT_ANSWERED';

    const orderPatch: any = {
      callStatus,
      callResult: normalizedInput ? `DTMF:${normalizedInput}` : 'NO_ANSWER',
    };
    if (normalizedInput === '1') {
      orderPatch.status = 'CONFIRMED';
      orderPatch.confirmedAt = new Date();
    }
    if (normalizedInput === '2') {
      orderPatch.status = 'CANCELLED';
    }

    await this.prisma.order.update({
      where: { id: attempt.orderId },
      data: orderPatch,
    });
    if (orderPatch.status === 'CONFIRMED') {
      void this.courier.autoBookOnConfirm(attempt.pageId, attempt.orderId);
    }

    if (hasValidSelection) {
      this.clearQueuedRetry(attempt.orderId);
    } else {
      await this.scheduleRetryIfEligible(
        attempt.pageId,
        attempt.orderId,
        'no valid DTMF input',
      );
    }

    this.logger.log(
      `[DTMF] attempt=${callAttemptId} digit=${normalizedInput || 'none'} → ${callStatus}`,
    );
    return { success: true, callStatus };
  }

  /** Agent manually confirms (no DTMF) — always page-scoped */
  async confirmByCall(pageId: number, orderId: number): Promise<CallResult> {
    await this.loadOrderAndPage(pageId, orderId);
    this.clearQueuedRetry(orderId);
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        callStatus: 'CONFIRMED_BY_CALL',
        status: 'CONFIRMED',
        confirmedAt: new Date(),
      },
    });
    void this.courier.autoBookOnConfirm(pageId, orderId);
    this.logger.log(`[CALL] order=${orderId} confirmed by agent`);
    return { success: true, message: 'Confirmed by agent' };
  }

  /** Agent manually cancels (no DTMF) — always page-scoped */
  async cancelByCall(pageId: number, orderId: number): Promise<CallResult> {
    await this.loadOrderAndPage(pageId, orderId);
    this.clearQueuedRetry(orderId);
    await this.prisma.order.update({
      where: { id: orderId },
      data: { callStatus: 'CANCELLED_BY_CALL', status: 'CANCELLED' },
    });
    this.logger.log(`[CALL] order=${orderId} cancelled by agent`);
    return { success: true, message: 'Cancelled by agent' };
  }

  // ── Core call initiation ────────────────────────────────────────────────────

  private async initiateCall(page: any, order: any): Promise<CallResult> {
    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        callStatus: 'CALLING',
        lastCallAt: new Date(),
        callRetryCount: { increment: 1 },
      },
    });

    // callProvider = who places the call (Twilio, SSLWireless, etc.)
    // ttsProvider  = who generates the audio (separate concern)
    const preferredProvider = (
      (page.callProvider || 'MANUAL') as string
    ).toUpperCase();

    const attempt = await this.prisma.callAttempt.create({
      data: {
        orderId: order.id,
        pageId: page.id,
        phone: order.phone,
        callProvider: preferredProvider,
        status: 'INITIATED',
      },
    });

    try {
      const voiceUrl = await this.tts.getCallAudioUrl(
        page.id,
        page.callLanguage || 'BN',
      );
      this.logger.log(
        `[CALL] order=${order.id} phone=${order.phone} preferredProvider=${preferredProvider} audio=${voiceUrl ?? 'none'}`,
      );

      const usedProvider = await this.dispatchCallWithFallback(
        preferredProvider,
        {
          phone: order.phone,
          voiceUrl: voiceUrl ?? null,
          callAttemptId: attempt.id,
          page,
          order,
        },
      );

      await this.prisma.callAttempt.update({
        where: { id: attempt.id },
        data: {
          status: usedProvider === 'MANUAL' ? 'PENDING' : 'INITIATED',
          callProvider: usedProvider,
        },
      });

      return {
        success: true,
        message:
          usedProvider === 'MANUAL'
            ? 'Queued for manual call'
            : `Call initiated via ${usedProvider}`,
        callAttemptId: attempt.id,
        callProvider: usedProvider,
      };
    } catch (err) {
      const errMsg = String(err);
      this.logger.error(
        `[CALL] order=${order.id} provider=${preferredProvider} failed: ${errMsg}`,
      );

      await this.prisma.callAttempt.update({
        where: { id: attempt.id },
        data: { status: 'FAILED', errorMsg: errMsg },
      });

      const fresh = await this.prisma.order.findUnique({
        where: { id: order.id },
      });
      const exhausted =
        (fresh?.callRetryCount ?? 0) >= (page.maxCallRetries || 3);
      await this.prisma.order.update({
        where: { id: order.id },
        data: { callStatus: exhausted ? 'CALL_FAILED' : 'PENDING_CALL' },
      });

      if (!exhausted) {
        await this.scheduleRetryIfEligible(
          page.id,
          order.id,
          `provider failure: ${preferredProvider}`,
        );
      } else {
        this.clearQueuedRetry(order.id);
      }

      return { success: false, message: `Call failed: ${errMsg}` };
    }
  }

  // ── Provider dispatch ───────────────────────────────────────────────────────

  /**
   * Dispatch to real provider. Each must eventually POST to:
   *   /call/dtmf/:callAttemptId  with dtmfInput and durationSeconds
   *
   * Required .env vars:
   *   TWILIO:      TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, TWILIO_TWIML_BASE
   *   SSLWIRELESS: SSLWIRELESS_API_KEY, SSLWIRELESS_CALLER_ID, SSLWIRELESS_API_URL
   */
  private async dispatchCall(
    callProvider: string,
    ctx: {
      phone: string;
      voiceUrl: string | null;
      callAttemptId: number;
      page: any;
      order: any;
    },
  ): Promise<void> {
    switch (callProvider) {
      case 'MANUAL':
        return; // agent dials manually

      case 'TWILIO': {
        const sid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
        const token = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
        const from = String(process.env.TWILIO_FROM_NUMBER || '').trim();
        const baseUrl = this.getPublicAppBaseUrl();
        if (!sid || !token || !from) {
          throw new Error(
            'TWILIO credentials missing: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER',
          );
        }
        const dtmfUrl = `${baseUrl}/call/dtmf/${ctx.callAttemptId}`;
        const twimlUrl = `${baseUrl}/call/twiml?audio=${encodeURIComponent(ctx.voiceUrl ?? '')}&cb=${encodeURIComponent(dtmfUrl)}`;
        const body = new URLSearchParams({
          To: this.normalizePhone(ctx.phone),
          From: from,
          Url: twimlUrl,
          Method: 'GET',
        });
        await axios.post(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`,
          body.toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            auth: { username: sid, password: token },
            timeout: 20000,
          },
        );
        return;
      }

      case 'SSLWIRELESS': {
        const apiUrl = String(process.env.SSLWIRELESS_API_URL || '').trim();
        const apiKey = String(process.env.SSLWIRELESS_API_KEY || '').trim();
        const callerId = String(process.env.SSLWIRELESS_CALLER_ID || '').trim();
        if (!apiUrl || !apiKey || !callerId) {
          throw new Error(
            'SSLWIRELESS credentials missing: set SSLWIRELESS_API_URL, SSLWIRELESS_API_KEY, SSLWIRELESS_CALLER_ID',
          );
        }
        await axios.post(
          apiUrl,
          {
            api_key: apiKey,
            caller_id: callerId,
            phone: this.normalizePhone(ctx.phone),
            audio_url: ctx.voiceUrl,
            callback_url: `${this.getPublicAppBaseUrl()}/call/dtmf/${ctx.callAttemptId}`,
            order_id: String(ctx.order.id),
          },
          { timeout: 20000 },
        );
        return;
      }

      case 'BDCALLING': {
        const apiUrl = String(process.env.BDCALLING_API_URL || '').trim();
        const apiKey = String(process.env.BDCALLING_API_KEY || '').trim();
        const callerId = String(process.env.BDCALLING_CALLER_ID || '').trim();
        if (!apiUrl || !apiKey || !callerId) {
          throw new Error(
            'BDCALLING credentials missing: set BDCALLING_API_URL, BDCALLING_API_KEY, BDCALLING_CALLER_ID',
          );
        }
        await axios.post(
          apiUrl,
          {
            apiKey,
            callerId,
            phone: this.normalizePhone(ctx.phone),
            audioUrl: ctx.voiceUrl,
            callbackUrl: `${this.getPublicAppBaseUrl()}/call/dtmf/${ctx.callAttemptId}`,
            reference: String(ctx.order.id),
          },
          { timeout: 20000 },
        );
        return;
      }

      default:
        this.logger.warn(
          `[CALL] Unknown provider "${callProvider}" — treating as MANUAL`,
        );
    }
  }

  private async dispatchCallWithFallback(
    preferredProvider: string,
    ctx: {
      phone: string;
      voiceUrl: string | null;
      callAttemptId: number;
      page: any;
      order: any;
    },
  ): Promise<string> {
    const providers = this.getProviderFallbackChain(preferredProvider);
    const errors: string[] = [];

    for (const provider of providers) {
      if (provider !== 'MANUAL' && this.isProviderCoolingDown(provider)) {
        this.logger.warn(
          `[CALL] provider=${provider} skipped because cooldown is active`,
        );
        continue;
      }

      try {
        await this.dispatchCall(provider, ctx);
        this.clearProviderCooldown(provider);
        return provider;
      } catch (err) {
        const errMsg = String(err);
        errors.push(`${provider}: ${errMsg}`);
        this.markProviderFailed(provider, errMsg);
      }
    }

    throw new Error(errors.join(' | ') || 'No calling provider available');
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private getInitialAutoCallDelayMs(page: any, mode: CallMode): number {
    if (mode !== 'AUTO_AFTER_DELAY') return 0;
    const minutes = Math.max(
      1,
      Number(page?.initialCallDelayMinutes || page?.retryIntervalMinutes || 30),
    );
    return minutes * 60 * 1000;
  }

  private getRetryDelayMs(page: any): number {
    const minutes = Math.max(1, Number(page?.retryIntervalMinutes || 30));
    return minutes * 60 * 1000;
  }

  private getProviderFallbackChain(preferredProvider: string): string[] {
    const preferred = String(preferredProvider || 'MANUAL').toUpperCase();
    if (preferred === 'MANUAL') return ['MANUAL'];

    const pool = ['TWILIO', 'SSLWIRELESS', 'BDCALLING'];
    const ordered = [preferred, ...pool.filter((p) => p !== preferred)];
    return ordered;
  }

  private isProviderCoolingDown(provider: string): boolean {
    const until = providerCooldownUntil.get(provider) || 0;
    return until > Date.now();
  }

  private markProviderFailed(provider: string, reason: string): void {
    if (provider === 'MANUAL') return;
    providerCooldownUntil.set(provider, Date.now() + PROVIDER_COOLDOWN_MS);
    this.logger.warn(
      `[CALL] provider=${provider} moved to cooldown for ${Math.round(PROVIDER_COOLDOWN_MS / 60000)} minute(s): ${reason}`,
    );
  }

  private clearProviderCooldown(provider: string): void {
    providerCooldownUntil.delete(provider);
  }

  private clearQueuedRetry(orderId: number): void {
    const timer = scheduledAutoCallTimers.get(orderId);
    if (timer) {
      clearTimeout(timer);
      scheduledAutoCallTimers.delete(orderId);
    }
    pendingAutoCall.delete(orderId);
  }

  private async scheduleRetryIfEligible(
    pageId: number,
    orderId: number,
    reason: string,
  ): Promise<void> {
    const { order, page } = await this.loadOrderAndPage(pageId, orderId);
    if (!page?.callConfirmModeOn) return;

    const callProvider = String(page.callProvider || 'MANUAL').toUpperCase();
    if (callProvider === 'MANUAL') return;
    if (!order.phone) return;
    if (['CONFIRMED', 'CANCELLED'].includes(order.status)) return;

    const retries = order.callRetryCount || 0;
    const max = (page as any).maxCallRetries || 3;
    if (retries >= max) {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { callStatus: 'CALL_FAILED' },
      });
      this.clearQueuedRetry(orderId);
      return;
    }

    if (scheduledAutoCallTimers.has(orderId) || pendingAutoCall.has(orderId)) {
      this.logger.warn(
        `[CALL] retry already queued for order=${orderId} — skip duplicate (${reason})`,
      );
      return;
    }

    pendingAutoCall.add(orderId);
    const delayMs = this.getRetryDelayMs(page);
    const timer = setTimeout(() => {
      this.enqueueFairAutoCall(pageId, async () => {
        try {
          const fresh = await this.prisma.order.findUnique({
            where: { id: orderId },
            select: {
              id: true,
              pageIdRef: true,
              status: true,
              phone: true,
            },
          });
          if (!fresh || fresh.pageIdRef !== pageId) return;
          if (!fresh.phone) return;
          if (['CONFIRMED', 'CANCELLED'].includes(fresh.status)) {
            this.logger.log(
              `[CALL-RETRY] order=${orderId} skipped because status=${fresh.status}`,
            );
            return;
          }

          await this.sendManualCall(pageId, orderId);
        } catch (err) {
          this.logger.error(`[CALL-RETRY] order=${orderId}: ${err}`);
        } finally {
          pendingAutoCall.delete(orderId);
          scheduledAutoCallTimers.delete(orderId);
        }
      });
    }, delayMs);

    scheduledAutoCallTimers.set(orderId, timer);
    this.logger.log(
      `[CALL] retry scheduled for order=${orderId} after ${Math.round(delayMs / 60000)} minute(s) (${reason})`,
    );
  }

  private enqueueFairAutoCall(pageId: number, task: () => Promise<void>): void {
    const queue = pageFairQueues.get(pageId) || [];
    queue.push(task);
    pageFairQueues.set(pageId, queue);

    if (!fairQueuePageOrder.includes(pageId)) {
      fairQueuePageOrder.push(pageId);
    }

    this.logger.log(
      `[CALL-QUEUE] queued page=${pageId} pending=${queue.length} pages=${fairQueuePageOrder.length}`,
    );
    void this.drainFairAutoCallQueue();
  }

  private async drainFairAutoCallQueue(): Promise<void> {
    if (fairQueueDraining) return;
    fairQueueDraining = true;

    try {
      while (fairQueuePageOrder.length > 0) {
        const pageId = fairQueuePageOrder.shift() as number;
        const queue = pageFairQueues.get(pageId) || [];
        const task = queue.shift();

        if (!task) {
          pageFairQueues.delete(pageId);
          continue;
        }

        if (queue.length > 0) {
          pageFairQueues.set(pageId, queue);
          fairQueuePageOrder.push(pageId);
        } else {
          pageFairQueues.delete(pageId);
        }

        await this.waitForGlobalCallWindow();
        await this.waitForPageCallWindow(pageId);
        this.reserveGlobalCallWindow();
        this.reservePageCallWindow(pageId);

        try {
          await task();
        } catch (err) {
          this.logger.error(
            `[CALL-QUEUE] page=${pageId} task failed: ${String(err)}`,
          );
        }
      }
    } finally {
      fairQueueDraining = false;
      if (fairQueuePageOrder.length > 0) {
        void this.drainFairAutoCallQueue();
      }
    }
  }

  private async waitForPageCallWindow(pageId: number): Promise<void> {
    const busyUntil = pageCallBusyUntil.get(pageId) || 0;
    const waitMs = busyUntil - Date.now();
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  private reservePageCallWindow(pageId: number): void {
    pageCallBusyUntil.set(pageId, Date.now() + PAGE_CALL_GAP_MS);
  }

  private async waitForGlobalCallWindow(): Promise<void> {
    const waitMs = globalCallBusyUntil - Date.now();
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  private reserveGlobalCallWindow(): void {
    globalCallBusyUntil = Date.now() + PAGE_CALL_GAP_MS;
  }

  buildTwimlResponse(audioUrl?: string, callbackUrl?: string): string {
    const safeAudio = this.escapeXml(audioUrl || '');
    const safeCallback = this.escapeXml(callbackUrl || '');
    const gatherAttributes = [
      'input="dtmf"',
      'numDigits="1"',
      'timeout="8"',
      'method="POST"',
      'actionOnEmptyResult="true"',
      safeCallback ? `action="${safeCallback}"` : '',
    ]
      .filter(Boolean)
      .join(' ');

    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Response>',
      `  <Gather ${gatherAttributes}>`,
    ];

    if (safeAudio) {
      lines.push(`    <Play>${safeAudio}</Play>`);
    } else {
      lines.push(
        '    <Say language="en-US">To confirm your order, press 1. To cancel, press 2. To speak with an agent, press 3.</Say>',
      );
    }

    lines.push('  </Gather>');
    lines.push(
      '  <Say language="en-US">No input received. We will try again later.</Say>',
    );
    lines.push('</Response>');
    return lines.join('\n');
  }

  private getPublicAppBaseUrl(): string {
    const explicit = String(process.env.TWILIO_TWIML_BASE || '').trim();
    if (explicit) return explicit.replace(/\/$/, '');
    return String(
      process.env.STORAGE_PUBLIC_URL || 'http://localhost:3000/storage',
    )
      .replace(/\/storage\/?$/, '')
      .replace(/\/$/, '');
  }

  private normalizePhone(phone: string): string {
    const cleaned = String(phone || '').replace(/[^\d+]/g, '');
    if (cleaned.startsWith('+')) return cleaned;
    if (cleaned.startsWith('880')) return `+${cleaned}`;
    if (cleaned.startsWith('0')) return `+88${cleaned}`;
    return cleaned;
  }

  private escapeXml(value: string): string {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private async markPending(orderId: number): Promise<void> {
    await this.prisma.order.update({
      where: { id: orderId },
      data: { callStatus: 'PENDING_CALL' },
    });
  }

  private async loadOrderAndPage(pageId: number, orderId: number) {
    const [order, page] = await Promise.all([
      this.prisma.order.findFirst({
        where: { id: orderId, pageIdRef: pageId },
      }),
      this.prisma.page.findUnique({ where: { id: pageId } }),
    ]);
    if (!order)
      throw new NotFoundException(
        `Order #${orderId} not found for page #${pageId}`,
      );
    if (!page) throw new NotFoundException(`Page #${pageId} not found`);
    return { order, page };
  }
}

function fail(message: string): CallResult {
  return { success: false, message };
}
