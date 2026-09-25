import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import type { Response } from 'express';
import { Workbook, type Worksheet } from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { BotKnowledgeService } from '../bot-knowledge/bot-knowledge.service';
import { EncryptionService } from '../common/encryption.service';
import { FacebookService } from '../facebook/facebook.service';
import { TelegramNotificationService } from '../telegram/telegram-notification.service';
import { WaConnectRequestService } from '../whatsapp/wa-connect-request.service';
import { AgentBehaviorConfig } from '../agents/agent-behavior-config.interface';
import { AuthService } from '../auth/auth.service';
import { PartnerService } from '../partner/partner.service';

export interface CallServerConfig {
  id: string;
  name: string;
  icon: string;
  enabled: boolean;
}

export interface AdminPaymentConfig {
  smsGatewayEnabled?: boolean;
  smsGatewayToken?: string;        // secret token for Android SMS forwarder app
  bkashEnabled?: boolean;
  bkashAppKey?: string;
  bkashAppSecret?: string;
  bkashUsername?: string;
  bkashPassword?: string;
  bkashSandbox?: boolean;
  nagadEnabled?: boolean;
  nagadMerchantId?: string;
  nagadMerchantPrivateKey?: string;
  nagadApiBaseUrl?: string;
  manualEnabled?: boolean;         // always true by default
}

export interface GlobalConfig {
  callFeatureEnabled: boolean;
  callServers: CallServerConfig[];
  billingSupport?: {
    label?: string;
    phone?: string;
    whatsappUrl?: string;
    messengerUrl?: string;
    email?: string;
    note?: string;
  };
  adminPayment?: AdminPaymentConfig;
  moderatorAccess?: {
    fbProfileLink?: string;
    email?: string;
  };
}

const DEFAULT_CALL_SERVERS: CallServerConfig[] = [
  { id: 'MANUAL', name: 'Manual Call', icon: '👤', enabled: true },
  { id: 'TWILIO', name: 'Server 1 (Twilio)', icon: '📡', enabled: false },
  {
    id: 'SSLWIRELESS',
    name: 'Server 2 (SSLWireless)',
    icon: '🇧🇩',
    enabled: false,
  },
  { id: 'BDCALLING', name: 'Server 3 (BDCalling)', icon: '📲', enabled: false },
];

export interface TutorialsConfig {
  courier: {
    pathao: string;
    steadfast: string;
    redx: string;
    paperfly: string;
  };
  facebookAccessToken: string;
  generalOnboarding: string;
  pageConnect: string;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly botKnowledge: BotKnowledgeService,
    private readonly encryption: EncryptionService,
    private readonly facebook: FacebookService,
    private readonly telegram: TelegramNotificationService,
    private readonly waConnectRequests: WaConnectRequestService,
    private readonly authService: AuthService,
    private readonly partner: PartnerService,
  ) {}

  async overview() {
    const [
      totalPages,
      activePages,
      totalProducts,
      totalOrders,
      todayOrders,
      pendingOrders,
      confirmedOrders,
      totalUsers,
      activeUsers,
      pendingPageRequests,
    ] = await Promise.all([
      this.prisma.page.count().catch(() => 0),
      this.prisma.page
        .count({ where: { isActive: true, automationOn: true } })
        .catch(() => 0),
      this.prisma.product.count().catch(() => 0),
      this.prisma.order.count().catch(() => 0),
      this.prisma.order
        .count({
          where: {
            createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          },
        })
        .catch(() => 0),
      this.prisma.order
        .count({ where: { status: { in: ['RECEIVED', 'PENDING'] } } })
        .catch(() => 0),
      this.prisma.order
        .count({ where: { status: 'CONFIRMED' } })
        .catch(() => 0),
      this.prisma.user.count().catch(() => 0),
      this.prisma.user
        .count({ where: { isActive: true, role: 'client' } })
        .catch(() => 0),
      this.prisma.pageRequest.count({ where: { status: 'pending' } }).catch(() => 0),
    ]);

    // Pages with bot ON vs OFF
    const pagesWithBot = activePages;
    const pagesWithoutBot = totalPages - activePages;

    // Learning log unmatched count
    const learningLog = this.botKnowledge.getLearningLog();
    const unmatchedCount = Array.isArray(learningLog) ? learningLog.length : 0;

    return {
      // System
      totalPages,
      pagesWithBot,
      pagesWithoutBot,
      totalUsers,
      activeUsers,
      // Products
      totalProducts,
      // Orders
      totalOrders,
      todayOrders,
      pendingOrders,
      confirmedOrders,
      // Bot knowledge health
      unmatchedMessages: unmatchedCount,
      // Page access requests
      pendingPageRequests,
      // Meta
      generatedAt: new Date().toISOString(),
    };
  }

  async clients() {
    const users = await this.prisma.user.findMany({
      where: { role: 'client' },
      include: {
        pages: {
          select: {
            id: true,
            pageId: true,
            pageName: true,
            isActive: true,
            automationOn: true,
            masterPageId: true,
            lastReconnectedAt: true,
            previousPageId: true,
            createdAt: true,
            creditBalance: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Total credits used per page = sum of all negative (deduction) wallet
    // transactions. One grouped query, then mapped onto each user's pages —
    // avoids an N+1 query per user.
    const usageRows = await this.prisma.walletTransaction.groupBy({
      by: ['pageId'],
      where: { amountCredit: { lt: 0 } },
      _sum: { amountCredit: true },
    });
    const usedByPage = new Map<number, number>();
    for (const r of usageRows) {
      usedByPage.set(r.pageId, Math.abs(r._sum.amountCredit || 0));
    }

    return users.map((u) => {
      const credits = u.pages.reduce((s, p) => s + (p.creditBalance || 0), 0);
      const creditUsed = u.pages.reduce(
        (s, p) => s + (usedByPage.get(p.id) || 0),
        0,
      );
      return {
        id: u.id,
        username: u.username,
        name: u.name,
        email: u.email,
        isActive: u.isActive,
        createdAt: u.createdAt,
        pages: u.pages,
        pageCount: u.pages.length,
        credits,
        creditUsed,
      };
    });
  }

  async setUserAccountStatus(userId: string, isActive: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');
    await this.prisma.user.update({ where: { id: userId }, data: { isActive } });
    return { success: true, isActive };
  }

  async setPageWebsiteStatus(pageId: number, enabled: boolean) {
    const page = await this.prisma.page.findUnique({ where: { id: pageId } });
    if (!page) throw new Error('Page not found');
    await this.prisma.page.update({ where: { id: pageId }, data: { websiteEnabled: enabled } });
    return { success: true, websiteEnabled: enabled };
  }

  async clientDetails(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { pages: true },
    });
    if (!user || user.role !== 'client')
      throw new NotFoundException('Client not found');
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      pages: user.pages,
    };
  }

  async health() {
    let db = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'error';
    }
    return {
      status: db === 'ok' ? 'ok' : 'degraded',
      database: db,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Admin: read/write page business settings ──────────────────────────────
  async getPageSettings(pageId: number) {
    const page = await this.prisma.page.findUnique({ where: { id: pageId } });
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  async updatePageSettings(pageId: number, body: any) {
    const MODE_ACCESS_MAP: Record<string, string> = {
      automationOn: 'automationAllowed',
      ocrOn: 'ocrAllowed',
      infoModeOn: 'infoModeAllowed',
      orderModeOn: 'orderModeAllowed',
      printModeOn: 'printModeAllowed',
      callConfirmModeOn: 'callConfirmModeAllowed',
      memoSaveModeOn: 'memoSaveModeAllowed',
      memoTemplateModeOn: 'memoTemplateModeAllowed',
      autoMemoDesignModeOn: 'autoMemoDesignModeAllowed',
    };
    const ALLOWED = [
      'businessName',
      'businessPhone',
      'businessAddress',
      'websiteUrl',
      'currencySymbol',
      'codLabel',
      'deliveryFeeInsideDhaka',
      'deliveryFeeOutsideDhaka',
      'deliveryTimeText',
      'productCodePrefix',
      'paymentMode',
      'advanceAmount',
      'advanceBkash',
      'advanceNagad',
      'advanceRocket',
      'advancePaymentMessage',
      'catalogMessengerUrl',
      'catalogSlug',
      'customPersonaPrompt',
      'ocrOn',
      'infoModeOn',
      'orderModeOn',
      'printModeOn',
      'callConfirmModeOn',
      'memoSaveModeOn',
      'memoTemplateModeOn',
      'autoMemoDesignModeOn',
      'automationOn',
      'smartBotOn',
    ];
    const patch: any = {};
    for (const k of ALLOWED) {
      if (!(k in body)) continue;
      const v = body[k];
      if (
        k === 'deliveryFeeInsideDhaka' ||
        k === 'deliveryFeeOutsideDhaka' ||
        k === 'advanceAmount'
      ) {
        patch[k] = Number(v);
      } else if (
        [
          'ocrOn',
          'infoModeOn',
          'orderModeOn',
          'printModeOn',
          'callConfirmModeOn',
          'memoSaveModeOn',
          'memoTemplateModeOn',
          'autoMemoDesignModeOn',
          'automationOn',
          'smartBotOn',
        ].includes(k)
      ) {
        patch[k] = Boolean(v);
        // Only lock the Allowed flag when admin disables — never force-enable it
        if (!Boolean(v) && MODE_ACCESS_MAP[k]) patch[MODE_ACCESS_MAP[k]] = false;
      } else if (k === 'productCodePrefix') {
        const p = String(v || 'DF')
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '');
        if (p.length >= 1 && p.length <= 10) patch[k] = p;
      } else {
        patch[k] = v === '' ? null : v;
      }
    }
    await this.prisma.page.update({ where: { id: pageId }, data: patch });
    return this.prisma.page.findUnique({ where: { id: pageId } });
  }

  // ── Global Bot Knowledge ────────────────────────────────────────────────────
  getGlobalBotKnowledge() {
    return this.botKnowledge.getGlobalConfig();
  }
  updateGlobalBotQuestions(questions: any[]) {
    return this.botKnowledge.updateGlobalQuestions(questions || []);
  }
  updateGlobalBotSystemReplies(replies: any) {
    return this.botKnowledge.updateGlobalSystemReplies(replies || {});
  }
  updateGlobalBotAreas(areas: any[]) {
    return this.botKnowledge.updateGlobalAreas(areas || []);
  }
  updateGlobalBotPricingInfo(pricingInfo: string) {
    return this.botKnowledge.updateGlobalPricingInfo(pricingInfo);
  }
  getBotLearningLog() {
    return this.botKnowledge.getLearningLog();
  }
  createQuestionFromLearning(body: any) {
    return this.botKnowledge.createQuestionFromLearning(body || {});
  }

  // ── Admin: read ANY page's bot-knowledge config ────────────────────────────
  async getClientBotKnowledge(pageId: number) {
    const page = await this.prisma.page.findUnique({ where: { id: pageId } });
    if (!page) throw new NotFoundException('Page not found');
    return this.botKnowledge.getConfig(pageId);
  }

  // ── Admin: push questions to a specific client page ────────────────────────
  async setClientPageQuestions(pageId: number, questions: any[]) {
    const page = await this.prisma.page.findUnique({ where: { id: pageId } });
    if (!page) throw new NotFoundException('Page not found');
    return this.botKnowledge.updateQuestions(pageId, questions || []);
  }

  // ── Admin: push system replies to a specific client page ──────────────────
  async setClientPageSystemReplies(pageId: number, systemReplies: any) {
    const page = await this.prisma.page.findUnique({ where: { id: pageId } });
    if (!page) throw new NotFoundException('Page not found');
    return this.botKnowledge.updateSystemReplies(pageId, systemReplies || {});
  }

  // ── Admin: push a single global question to a client page ─────────────────
  async pushGlobalQuestionToPage(pageId: number, key: string) {
    const page = await this.prisma.page.findUnique({ where: { id: pageId } });
    if (!page) throw new NotFoundException('Page not found');
    return this.botKnowledge.importGlobalQuestion(pageId, key);
  }

  // ── Get all pages with their owner info (for admin knowledge view) ─────────
  async getAllPages() {
    const pages = await this.prisma.page.findMany({
      select: {
        id: true,
        pageId: true,
        pageName: true,
        businessName: true,
        isActive: true,
        automationOn: true,
        ownerId: true,
        masterPageId: true,
        lastReconnectedAt: true,
        previousPageId: true,
        createdAt: true,
        customDomain: true,
        catalogSlug: true,
        fbAppId: true,
        fbAppSecret: true,
        webOrderEnabled: true,
        owner: { select: { id: true, username: true, name: true, isActive: true } },
      },
      orderBy: { id: 'desc' },
    });
    return pages.map(({ fbAppSecret, ...p }) => ({
      ...p,
      hasCustomApp: !!fbAppSecret,
    }));
  }

  async getPageAppCredentials(pageId: number) {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { fbAppId: true, fbAppSecret: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    return { fbAppId: page.fbAppId ?? null, hasCustomAppSecret: !!page.fbAppSecret };
  }

  async setPageAppCredentials(pageId: number, fbAppId?: string, fbAppSecret?: string) {
    const page = await this.prisma.page.findUnique({ where: { id: pageId } });
    if (!page) throw new NotFoundException('Page not found');
    const data: Record<string, string | null> = {};
    if (fbAppId !== undefined) data.fbAppId = fbAppId.trim() || null;
    if (fbAppSecret !== undefined) {
      data.fbAppSecret = fbAppSecret.trim()
        ? this.encryption.encryptIfNeeded(fbAppSecret.trim())
        : null;
    }
    await this.prisma.page.update({ where: { id: pageId }, data });

    // Re-subscribe webhook under the new app so FB delivers messages to this platform
    if (page.pageToken && page.pageId) {
      const rawToken = this.encryption.decrypt(page.pageToken);
      await this.facebook
        .subscribePageToWebhook(page.pageId, rawToken)
        .catch((err: any) =>
          this.logger.warn(
            `[Admin] Webhook re-subscribe failed for page ${page.pageId}: ${err?.message}`,
          ),
        );
    }

    return { success: true, fbAppId: (data.fbAppId ?? page.fbAppId) || null };
  }

  // ── Global Config (callFeatureEnabled, callServers, …) ────────────────────
  private readonly globalConfigFile = path.join(
    process.cwd(),
    'storage',
    'global-config.json',
  );

  private _readGlobalConfig(): GlobalConfig {
    try {
      if (fs.existsSync(this.globalConfigFile)) {
        return JSON.parse(
          fs.readFileSync(this.globalConfigFile, 'utf8'),
        ) as GlobalConfig;
      }
    } catch {}
    return {
      callFeatureEnabled: false,
      callServers: DEFAULT_CALL_SERVERS,
      billingSupport: {
        label: 'Admin Support',
        phone: '',
        whatsappUrl: '',
        messengerUrl: '',
        email: '',
        note: '',
      },
      moderatorAccess: {
        fbProfileLink: '',
        email: '',
      },
    };
  }

  private _writeGlobalConfig(cfg: GlobalConfig): GlobalConfig {
    fs.mkdirSync(path.dirname(this.globalConfigFile), { recursive: true });
    fs.writeFileSync(
      this.globalConfigFile,
      JSON.stringify(cfg, null, 2),
      'utf8',
    );
    return cfg;
  }

  getGlobalConfig(): GlobalConfig {
    return this._readGlobalConfig();
  }

  saveGlobalConfig(input: Partial<GlobalConfig>): GlobalConfig {
    const existing = this._readGlobalConfig();
    const merged: GlobalConfig = {
      callFeatureEnabled:
        typeof input.callFeatureEnabled === 'boolean'
          ? input.callFeatureEnabled
          : existing.callFeatureEnabled,
      callServers: Array.isArray(input.callServers)
        ? input.callServers
        : existing.callServers,
      billingSupport: {
        label: String(
          input.billingSupport?.label ??
            existing.billingSupport?.label ??
            'Admin Support',
        ).trim(),
        phone: String(
          input.billingSupport?.phone ?? existing.billingSupport?.phone ?? '',
        ).trim(),
        whatsappUrl: this._sanitizeUrl(
          input.billingSupport?.whatsappUrl ??
            existing.billingSupport?.whatsappUrl ??
            '',
        ),
        messengerUrl: this._sanitizeUrl(
          input.billingSupport?.messengerUrl ??
            existing.billingSupport?.messengerUrl ??
            '',
        ),
        email: String(
          input.billingSupport?.email ?? existing.billingSupport?.email ?? '',
        ).trim(),
        note: String(
          input.billingSupport?.note ?? existing.billingSupport?.note ?? '',
        ).trim(),
      },
      adminPayment: input.adminPayment !== undefined
        ? { ...existing.adminPayment, ...input.adminPayment }
        : existing.adminPayment,
      moderatorAccess: {
        fbProfileLink: String(
          input.moderatorAccess?.fbProfileLink ??
            existing.moderatorAccess?.fbProfileLink ??
            '',
        ).trim(),
        email: String(
          input.moderatorAccess?.email ?? existing.moderatorAccess?.email ?? '',
        ).trim(),
      },
    };
    return this._writeGlobalConfig(merged);
  }

  // ── Admin SMS Gateway (file-based, no DB migration needed) ───────────────
  private readonly adminSmsFile = path.join(process.cwd(), 'storage', 'admin-sms.json');

  private _readAdminSms(): any[] {
    try {
      if (fs.existsSync(this.adminSmsFile)) return JSON.parse(fs.readFileSync(this.adminSmsFile, 'utf8'));
    } catch {}
    return [];
  }

  saveAdminSms(sms: { method: string; txId?: string; amount?: number; senderPhone?: string; rawText: string; receivedAt: string }): void {
    const list = this._readAdminSms();
    list.unshift({ ...sms, matched: false, id: Date.now() });
    // Keep last 500 SMSes
    fs.mkdirSync(path.dirname(this.adminSmsFile), { recursive: true });
    fs.writeFileSync(this.adminSmsFile, JSON.stringify(list.slice(0, 500), null, 2));
  }

  matchAdminSms(txId: string | null, amount: number): { matched: boolean; sms?: any } {
    const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour window for admin
    const list = this._readAdminSms();
    const idx = list.findIndex(s => {
      if (s.matched) return false;
      if (new Date(s.receivedAt).getTime() < cutoff) return false;
      if (txId && s.txId && s.txId.toUpperCase().includes(txId.toUpperCase())) {
        return !amount || s.amount >= amount - 1;
      }
      return false;
    });
    if (idx === -1) return { matched: false };
    list[idx].matched = true;
    fs.writeFileSync(this.adminSmsFile, JSON.stringify(list, null, 2));
    return { matched: true, sms: list[idx] };
  }

  getRecentAdminSms(): any[] {
    return this._readAdminSms().slice(0, 20);
  }

  parseAdminSms(text: string): { method: string; txId?: string; amount?: number; senderPhone?: string } {
    const bkash = text.match(/You have received Tk\s*([\d,]+\.?\d*)/i);
    const nagad = text.match(/[\d,]+\.?\d*\s*Tk received/i);
    const rocket = text.match(/received BDT\s*([\d,]+\.?\d*)/i);
    const txBkash = text.match(/TrxID\s*([A-Z0-9]+)/i);
    const txNagad = text.match(/Reference[:\s]+([A-Z0-9]+)/i);
    const txRocket = text.match(/Ref[:\s]+([A-Z0-9]+)/i);
    const phone = text.match(/\b(01[3-9]\d{8})\b/);
    const amtStr = (bkash?.[1] || nagad?.[0]?.match(/[\d,]+\.?\d*/)?.[0] || rocket?.[1] || '').replace(/,/g, '');
    const method = bkash ? 'bkash' : nagad ? 'nagad' : rocket ? 'rocket' : 'unknown';
    return {
      method,
      txId: (txBkash?.[1] || txNagad?.[1] || txRocket?.[1])?.toUpperCase(),
      amount: amtStr ? parseFloat(amtStr) : undefined,
      senderPhone: phone?.[1],
    };
  }

  // ── V10: Courier tutorial videos (backward-compat) ────────────────────────
  private readonly courierTutorialFile = path.join(
    process.cwd(),
    'storage',
    'courier-tutorials.json',
  );

  // ── V17: Unified tutorials.json ───────────────────────────────────────────
  private readonly tutorialsFile = path.join(
    process.cwd(),
    'storage',
    'tutorials.json',
  );

  private _readTutorials(): TutorialsConfig {
    try {
      if (fs.existsSync(this.tutorialsFile)) {
        return JSON.parse(
          fs.readFileSync(this.tutorialsFile, 'utf8'),
        ) as TutorialsConfig;
      }
      // Migrate from old courier-tutorials.json if it exists
      if (fs.existsSync(this.courierTutorialFile)) {
        const old = JSON.parse(
          fs.readFileSync(this.courierTutorialFile, 'utf8'),
        );
        return { courier: old, facebookAccessToken: '', generalOnboarding: '', pageConnect: '' };
      }
    } catch {}
    return {
      courier: { pathao: '', steadfast: '', redx: '', paperfly: '' },
      facebookAccessToken: '',
      generalOnboarding: '',
      pageConnect: '',
    };
  }

  private _writeTutorials(cfg: TutorialsConfig): TutorialsConfig {
    fs.mkdirSync(path.dirname(this.tutorialsFile), { recursive: true });
    fs.writeFileSync(this.tutorialsFile, JSON.stringify(cfg, null, 2), 'utf8');
    return cfg;
  }

  getTutorials(): TutorialsConfig {
    return this._readTutorials();
  }

  saveTutorials(input: Partial<TutorialsConfig>): TutorialsConfig {
    const existing = this._readTutorials();
    const merged: TutorialsConfig = {
      courier: {
        pathao: this._sanitizeUrl(
          (input.courier as any)?.pathao ?? existing.courier?.pathao ?? '',
        ),
        steadfast: this._sanitizeUrl(
          (input.courier as any)?.steadfast ??
            existing.courier?.steadfast ??
            '',
        ),
        redx: this._sanitizeUrl(
          (input.courier as any)?.redx ?? existing.courier?.redx ?? '',
        ),
        paperfly: this._sanitizeUrl(
          (input.courier as any)?.paperfly ?? existing.courier?.paperfly ?? '',
        ),
      },
      facebookAccessToken: this._sanitizeUrl(
        input.facebookAccessToken ?? existing.facebookAccessToken ?? '',
      ),
      generalOnboarding: this._sanitizeUrl(
        input.generalOnboarding ?? existing.generalOnboarding ?? '',
      ),
      pageConnect: this._sanitizeUrl(
        input.pageConnect ?? existing.pageConnect ?? '',
      ),
    };
    return this._writeTutorials(merged);
  }

  private _sanitizeUrl(v: unknown): string {
    if (typeof v !== 'string') return '';
    const s = v.trim();
    if (s === '' || s.includes('youtube') || s.includes('youtu.be')) return s;
    return '';
  }

  // ── backward-compat: old /admin/courier-tutorials endpoints ───────────────
  getCourierTutorials(): Record<string, string> {
    return this._readTutorials().courier as Record<string, string>;
  }

  saveCourierTutorials(tutorials: Record<string, string>) {
    const existing = this._readTutorials();
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(tutorials)) {
      clean[k] = this._sanitizeUrl(v);
    }
    const base = existing.courier ?? {
      pathao: '',
      steadfast: '',
      redx: '',
      paperfly: '',
    };
    const courier = {
      pathao: clean['pathao'] ?? base.pathao,
      steadfast: clean['steadfast'] ?? base.steadfast,
      redx: clean['redx'] ?? base.redx,
      paperfly: clean['paperfly'] ?? base.paperfly,
    };
    return this.saveTutorials({ ...existing, courier }).courier;
  }

  // ── Manual Call Queue (Admin) ─────────────────────────────────────────────
  async getAdminCallQueue(pageId?: number) {
    const where: any = {
      status: { in: ['RECEIVED', 'PENDING'] },
      callStatus: { not: 'CONFIRMED_BY_CALL' },
    };
    if (pageId) where.pageIdRef = pageId;

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        items: true,
        page: { select: { id: true, pageName: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });

    return orders;
  }

  async adminLogManualCall(
    orderId: number,
    body: {
      result: 'CONFIRMED' | 'CANCELLED' | 'NOT_ANSWERED' | 'CALLBACK_LATER';
      note?: string;
    },
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, pageIdRef: true, phone: true, callRetryCount: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    const now = new Date();
    const callStatusMap: Record<string, string> = {
      CONFIRMED: 'CONFIRMED_BY_CALL',
      CANCELLED: 'CALL_FAILED',
      NOT_ANSWERED: 'NOT_ANSWERED',
      CALLBACK_LATER: 'PENDING_CALL',
    };
    const orderStatusMap: Record<string, string | null> = {
      CONFIRMED: 'CONFIRMED',
      CANCELLED: 'CANCELLED',
      NOT_ANSWERED: null,
      CALLBACK_LATER: null,
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.callAttempt.create({
        data: {
          orderId,
          pageId: order.pageIdRef,
          phone: order.phone || '',
          callProvider: 'manual',
          status: body.result === 'NOT_ANSWERED' ? 'NOT_ANSWERED' : 'ANSWERED',
          errorMsg: body.note || null,
        },
      });

      const patch: any = {
        callStatus: callStatusMap[body.result],
        lastCallAt: now,
        callRetryCount: { increment: 1 },
      };
      const newOrderStatus = orderStatusMap[body.result];
      if (newOrderStatus) {
        patch.status = newOrderStatus;
        if (newOrderStatus === 'CONFIRMED') patch.confirmedAt = now;
      }
      if (body.note) patch.callResult = body.note;

      await tx.order.update({ where: { id: orderId }, data: patch });
    });

    // Telegram notification for call result
    const callEmoji: Record<string, string> = {
      CONFIRMED: '✅',
      CANCELLED: '❌',
      NOT_ANSWERED: '📵',
      CALLBACK_LATER: '🔄',
    };
    const callLabel: Record<string, string> = {
      CONFIRMED: 'Confirmed by call',
      CANCELLED: 'Cancelled',
      NOT_ANSWERED: 'Not Answered',
      CALLBACK_LATER: 'Callback Later',
    };
    const emoji = callEmoji[body.result] ?? '📞';
    const label = callLabel[body.result] ?? body.result;
    const noteText = body.note ? `\n📝 ${body.note}` : '';
    this.telegram
      .notify(
        order.pageIdRef,
        `${emoji} <b>Call Result — Order #${orderId}</b>\n📞 ${order.phone || '-'} | ${label}${noteText}`,
      )
      .catch(() => {});

    return { success: true, result: body.result };
  }

  // ── Wallet Management ─────────────────────────────────────────────────────

  async getPageWallet(pageId: number) {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: {
        id: true,
        pageId: true,
        pageName: true,
        creditBalance: true,
        costPerKeywordReplyCredit: true,
        costPerVoiceMsgCredit: true,
        costPerImageCredit: true,
        costPerImageLocalCredit: true,
        costPerOcrLocalCredit: true,
        costPerOcrAiCredit: true,
        costPerAnalyzeCredit: true,
        costPerAiGenerateCredit: true,
        costPerBroadcastMsgCredit: true,
        costPerRecurringNotifCredit: true,
        costPerCommentReplyCredit: true,
        costPerMemoPrintCredit: true,
        subscriptionStatus: true,
        nextBillingDate: true,
      },
    });
    if (!page) throw new NotFoundException('Page not found');

    const transactions = await this.prisma.walletTransaction.findMany({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return { page, transactions };
  }

  async rechargePageWallet(
    pageId: number,
    creditAmount: number,
    transactionId: string,
    note?: string,
  ) {
    if (creditAmount <= 0) throw new NotFoundException('Amount must be positive');
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { id: true },
    });
    if (!page) throw new NotFoundException('Page not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.page.update({
        where: { id: pageId },
        data: {
          creditBalance: { increment: creditAmount },
          subscriptionStatus: 'ACTIVE',
        },
      });
      await tx.walletTransaction.create({
        data: {
          pageId,
          type: 'RECHARGE',
          amountCredit: creditAmount,
          description: note
            ? `${note} (Trx: ${transactionId})`
            : `Recharge via Trx: ${transactionId}`,
        },
      });
    });

    return { success: true, creditAmount };
  }

  /**
   * Manual admin balance correction — unlike rechargePageWallet, creditAmount
   * may be negative (to deduct) and this never force-activates the
   * subscription, since an arbitrary adjustment isn't necessarily a paid
   * top-up.
   */
  async adjustPageWallet(pageId: number, creditAmount: number, note?: string) {
    if (!creditAmount) throw new BadRequestException('creditAmount must be non-zero');
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { id: true },
    });
    if (!page) throw new NotFoundException('Page not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.page.update({
        where: { id: pageId },
        data: { creditBalance: { increment: creditAmount } },
      });
      await tx.walletTransaction.create({
        data: {
          pageId,
          type: 'ADMIN_ADJUSTMENT',
          amountCredit: creditAmount,
          description: note || `Manual admin ${creditAmount > 0 ? 'credit' : 'deduction'}`,
        },
      });
    });

    return { success: true, creditAmount };
  }

  async updatePagePricing(
    pageId: number,
    pricing: {
      costPerVoiceMsgCredit?: number;
      costPerImageCredit?: number;
      costPerImageLocalCredit?: number;
      costPerAnalyzeCredit?: number;
      costPerOcrLocalCredit?: number;
      costPerOcrAiCredit?: number;
      costPerRecurringNotifCredit?: number;
      costPerBroadcastMsgCredit?: number;
      costPerKeywordReplyCredit?: number;
      costPerAiGenerateCredit?: number;
      costPerMemoPrintCredit?: number;
      costPerCommentReplyCredit?: number;
    },
  ) {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { id: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    const data: any = {};
    if (pricing.costPerVoiceMsgCredit !== undefined) data.costPerVoiceMsgCredit = pricing.costPerVoiceMsgCredit;
    if (pricing.costPerImageCredit !== undefined) data.costPerImageCredit = pricing.costPerImageCredit;
    if (pricing.costPerImageLocalCredit !== undefined) data.costPerImageLocalCredit = pricing.costPerImageLocalCredit;
    if (pricing.costPerAnalyzeCredit !== undefined) data.costPerAnalyzeCredit = pricing.costPerAnalyzeCredit;
    if (pricing.costPerOcrLocalCredit !== undefined) data.costPerOcrLocalCredit = pricing.costPerOcrLocalCredit;
    if (pricing.costPerOcrAiCredit !== undefined) data.costPerOcrAiCredit = pricing.costPerOcrAiCredit;
    if (pricing.costPerRecurringNotifCredit !== undefined) data.costPerRecurringNotifCredit = pricing.costPerRecurringNotifCredit;
    if (pricing.costPerBroadcastMsgCredit !== undefined) data.costPerBroadcastMsgCredit = pricing.costPerBroadcastMsgCredit;
    if (pricing.costPerKeywordReplyCredit !== undefined) data.costPerKeywordReplyCredit = pricing.costPerKeywordReplyCredit;
    if (pricing.costPerAiGenerateCredit !== undefined) data.costPerAiGenerateCredit = pricing.costPerAiGenerateCredit;
    if (pricing.costPerMemoPrintCredit !== undefined) data.costPerMemoPrintCredit = pricing.costPerMemoPrintCredit;
    if (pricing.costPerCommentReplyCredit !== undefined) data.costPerCommentReplyCredit = pricing.costPerCommentReplyCredit;
    await this.prisma.page.update({ where: { id: pageId }, data });
    return { success: true };
  }

  private readonly globalPricingFile = path.join(
    process.cwd(),
    'storage',
    'global-pricing.json',
  );

  private readonly DEFAULT_GLOBAL_PRICING = {
    costPerKeywordReplyCredit: 1,
    costPerImageCredit: 8,
    costPerImageLocalCredit: 4,
    costPerOcrLocalCredit: 1,
    costPerOcrAiCredit: 2,
    costPerVoiceMsgCredit: 40,
    costPerAnalyzeCredit: 8,
    costPerAiGenerateCredit: 4,
    costPerBroadcastMsgCredit: 2,
    costPerRecurringNotifCredit: 4,
    costPerCommentReplyCredit: 2,
    costPerMemoPrintCredit: 4,
    // Global custom-recharge conversion rate (not a Page column — excluded
    // from updatePagePricing/applyPricingToAll's Page-update loops below).
    creditsPerBdt: 40,
  };

  private _readGlobalPricing(): typeof this.DEFAULT_GLOBAL_PRICING {
    try {
      if (fs.existsSync(this.globalPricingFile)) {
        const saved = JSON.parse(fs.readFileSync(this.globalPricingFile, 'utf8'));
        return { ...this.DEFAULT_GLOBAL_PRICING, ...saved };
      }
    } catch {}
    return { ...this.DEFAULT_GLOBAL_PRICING };
  }

  private _writeGlobalPricing(pricing: Partial<typeof this.DEFAULT_GLOBAL_PRICING>) {
    fs.mkdirSync(path.dirname(this.globalPricingFile), { recursive: true });
    const current = this._readGlobalPricing();
    const updated = { ...current, ...pricing };
    fs.writeFileSync(this.globalPricingFile, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  }

  async getGlobalPricing() {
    return this._readGlobalPricing();
  }

  getDefaultPricing() {
    return { ...this.DEFAULT_GLOBAL_PRICING };
  }

  async saveDefaultPricing(pricing: Partial<typeof this.DEFAULT_GLOBAL_PRICING>) {
    const updated = this._writeGlobalPricing(pricing);
    return { success: true, pricing: updated };
  }

  async applyPricingToAll(pricing: {
    costPerVoiceMsgCredit?: number;
    costPerImageCredit?: number;
    costPerImageLocalCredit?: number;
    costPerAnalyzeCredit?: number;
    costPerAiGenerateCredit?: number;
    costPerOcrLocalCredit?: number;
    costPerOcrAiCredit?: number;
    costPerRecurringNotifCredit?: number;
    costPerBroadcastMsgCredit?: number;
    costPerKeywordReplyCredit?: number;
    costPerMemoPrintCredit?: number;
    costPerCommentReplyCredit?: number;
    creditsPerBdt?: number;
  }) {
    const data: any = {};
    if (pricing.costPerVoiceMsgCredit !== undefined) data.costPerVoiceMsgCredit = pricing.costPerVoiceMsgCredit;
    if (pricing.costPerImageCredit !== undefined) data.costPerImageCredit = pricing.costPerImageCredit;
    if (pricing.costPerImageLocalCredit !== undefined) data.costPerImageLocalCredit = pricing.costPerImageLocalCredit;
    if (pricing.costPerAnalyzeCredit !== undefined) data.costPerAnalyzeCredit = pricing.costPerAnalyzeCredit;
    if (pricing.costPerAiGenerateCredit !== undefined) data.costPerAiGenerateCredit = pricing.costPerAiGenerateCredit;
    if (pricing.costPerOcrLocalCredit !== undefined) data.costPerOcrLocalCredit = pricing.costPerOcrLocalCredit;
    if (pricing.costPerOcrAiCredit !== undefined) data.costPerOcrAiCredit = pricing.costPerOcrAiCredit;
    if (pricing.costPerRecurringNotifCredit !== undefined) data.costPerRecurringNotifCredit = pricing.costPerRecurringNotifCredit;
    if (pricing.costPerBroadcastMsgCredit !== undefined) data.costPerBroadcastMsgCredit = pricing.costPerBroadcastMsgCredit;
    if (pricing.costPerKeywordReplyCredit !== undefined) data.costPerKeywordReplyCredit = pricing.costPerKeywordReplyCredit;
    if (pricing.costPerMemoPrintCredit !== undefined) data.costPerMemoPrintCredit = pricing.costPerMemoPrintCredit;
    if (pricing.costPerCommentReplyCredit !== undefined) data.costPerCommentReplyCredit = pricing.costPerCommentReplyCredit;
    // creditsPerBdt is a global rate, not a Page column — deliberately excluded from `data`.
    if (!Object.keys(data).length) return { success: false, updated: 0 };
    // Save as new global defaults so future pages & UI always show correct values
    this._writeGlobalPricing(pricing as any);
    const result = await this.prisma.page.updateMany({ data });
    return { success: true, updated: result.count };
  }

  async getAllPagesWallet() {
    return this.prisma.page.findMany({
      select: {
        id: true,
        pageId: true,
        pageName: true,
        creditBalance: true,
        subscriptionStatus: true,
        nextBillingDate: true,
        isTestPage: true,
        owner: { select: { id: true, username: true, name: true } },
      },
      orderBy: { creditBalance: 'asc' },
    });
  }

  /** Mark/unmark an admin-owned test page — excluded from the profit report. */
  async setPageTestFlag(pageId: number, isTest: boolean) {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { id: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    await this.prisma.page.update({
      where: { id: pageId },
      data: { isTestPage: isTest },
    });
    return { success: true, pageId, isTestPage: isTest };
  }

  async getAllRechargeRequests(status?: string) {
    return this.prisma.walletRechargeRequest.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        page: {
          select: {
            id: true,
            pageId: true,
            pageName: true,
            owner: { select: { username: true, name: true } },
          },
        },
        package: { select: { id: true, name: true, priceBdt: true, credits: true } },
      },
    });
  }

  async approveRechargeRequest(requestId: number, adminUsername: string) {
    const req = await this.prisma.walletRechargeRequest.findUnique({
      where: { id: requestId },
    });
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== 'pending')
      throw new BadRequestException('Request is not pending');

    await this.prisma.$transaction(async (tx) => {
      await tx.page.update({
        where: { id: req.pageId },
        data: {
          creditBalance: { increment: req.creditsAmount },
          subscriptionStatus: 'ACTIVE',
        },
      });
      await tx.walletTransaction.create({
        data: {
          pageId: req.pageId,
          type: 'RECHARGE',
          amountCredit: req.creditsAmount,
          description: `${req.method.toUpperCase()} Recharge — ৳${req.amountBdt} → ${req.creditsAmount} credit (TrxID: ${req.transactionId})`,
        },
      });
      await tx.walletRechargeRequest.update({
        where: { id: requestId },
        data: {
          status: 'approved',
          approvedAt: new Date(),
          approvedBy: adminUsername,
        },
      });
    });

    // Notify the client on their page Telegram that the balance was added.
    void this.telegram.notify(
      req.pageId,
      `✅ <b>Wallet Recharge Approved</b>\n💰 ${req.creditsAmount} credit আপনার balance-এ যোগ হয়েছে। ধন্যবাদ! 🎉`,
    );

    // Agent commission: no-op unless this page's owner was referred by an agent.
    const rechargedPage = await this.prisma.page.findUnique({
      where: { id: req.pageId },
      select: { ownerId: true },
    });
    if (rechargedPage?.ownerId) {
      void this.partner.recordEarningIfReferred(
        rechargedPage.ownerId,
        'RECHARGE',
        req.amountBdt,
        String(req.id),
        req.pageId,
      );
    }

    return { success: true };
  }

  // ── Credit Packages (admin-managed fixed recharge packages) ────────────────

  async listCreditPackages(includeInactive = false) {
    return this.prisma.creditPackage.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createCreditPackage(data: {
    name?: string;
    priceBdt: number;
    credits: number;
    sortOrder?: number;
  }) {
    if (!data.priceBdt || data.priceBdt <= 0) throw new BadRequestException('priceBdt must be positive');
    if (!data.credits || data.credits <= 0) throw new BadRequestException('credits must be positive');
    return this.prisma.creditPackage.create({
      data: {
        name: data.name,
        priceBdt: data.priceBdt,
        credits: data.credits,
        sortOrder: data.sortOrder ?? 0,
      },
    });
  }

  async updateCreditPackage(
    id: number,
    data: Partial<{ name: string; priceBdt: number; credits: number; isActive: boolean; sortOrder: number }>,
  ) {
    const pkg = await this.prisma.creditPackage.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException('Package not found');
    return this.prisma.creditPackage.update({ where: { id }, data });
  }

  async deleteCreditPackage(id: number) {
    const pkg = await this.prisma.creditPackage.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException('Package not found');
    const usedCount = await this.prisma.walletRechargeRequest.count({ where: { packageId: id } });
    if (usedCount > 0) {
      // Referenced by past recharge requests — soft-deactivate instead of deleting.
      await this.prisma.creditPackage.update({ where: { id }, data: { isActive: false } });
      return { success: true, deactivated: true };
    }
    await this.prisma.creditPackage.delete({ where: { id } });
    return { success: true, deactivated: false };
  }

  async reorderCreditPackages(orderedIds: number[]) {
    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.creditPackage.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );
    return { success: true };
  }

  async rejectRechargeRequest(requestId: number, reason?: string) {
    const req = await this.prisma.walletRechargeRequest.findUnique({
      where: { id: requestId },
    });
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== 'pending')
      throw new BadRequestException('Request is not pending');

    await this.prisma.walletRechargeRequest.update({
      where: { id: requestId },
      data: { status: 'rejected', rejectedReason: reason || null },
    });

    return { success: true };
  }

  // ── Subscription management ────────────────────────────────────────────────

  async getAllPageSubscriptions() {
    return this.prisma.page.findMany({
      select: {
        id: true,
        pageId: true,
        pageName: true,
        isActive: true,
        subscriptionStatus: true,
        nextBillingDate: true,
        owner: { select: { id: true, username: true, name: true } },
      },
      orderBy: { nextBillingDate: 'asc' },
    });
  }

  async updatePageSubscription(
    pageId: number,
    data: {
      subscriptionStatus?: string;
      nextBillingDate?: Date | null;
      daysToAdd?: number;
    },
  ) {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { id: true, nextBillingDate: true, subscriptionStatus: true },
    });
    if (!page) throw new NotFoundException('Page not found');

    const updateData: any = {};

    if (data.subscriptionStatus !== undefined) {
      updateData.subscriptionStatus = data.subscriptionStatus;
    }

    if (data.daysToAdd !== undefined && data.daysToAdd > 0) {
      // Extend from today or from existing nextBillingDate (whichever is later)
      const base =
        page.nextBillingDate && page.nextBillingDate > new Date()
          ? page.nextBillingDate
          : new Date();
      const newExpiry = new Date(base);
      newExpiry.setDate(newExpiry.getDate() + data.daysToAdd);
      updateData.nextBillingDate = newExpiry;
      updateData.subscriptionStatus = 'ACTIVE'; // auto-activate on extend
    } else if (data.nextBillingDate !== undefined) {
      updateData.nextBillingDate = data.nextBillingDate;
      if (data.nextBillingDate && data.nextBillingDate > new Date()) {
        updateData.subscriptionStatus = 'ACTIVE';
      }
    }

    await this.prisma.page.update({ where: { id: pageId }, data: updateData });
    return { success: true, pageId };
  }

  // ── Page Access Requests ──────────────────────────────────────────────────

  async getPageRequests(status?: string) {
    return this.prisma.pageRequest.findMany({
      where: status ? { status } : undefined,
      include: {
        user: { select: { id: true, username: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Approval now always goes through FacebookService.approvePageRequestViaFacebookLogin
  // (admin logs in with Facebook to confirm moderator access and auto-connect the page).
  getPageRequestApproveUrl(id: number) {
    return { url: this.facebook.getAdminApproveUrl(id) };
  }

  async rejectPageRequest(id: number, adminNote?: string) {
    const req = await this.prisma.pageRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== 'pending') throw new BadRequestException('Already processed');
    await this.prisma.pageRequest.update({
      where: { id },
      data: { status: 'rejected', adminNote: adminNote?.trim() || null },
    });
    return { success: true };
  }

  // ── WhatsApp Connection Requests ────────────────────────────────────────

  getWaConnectRequests(status?: string) {
    return this.waConnectRequests.list(status);
  }

  finalizeWaConnectRequest(
    id: number,
    body: { waPhoneNumberId: string; waToken: string; waVerifyToken?: string; adminNote?: string },
  ) {
    return this.waConnectRequests.finalize(id, body);
  }

  rejectWaConnectRequest(id: number, adminNote?: string) {
    return this.waConnectRequests.reject(id, adminNote);
  }

  // ── Bot Agent Catalog ───────────────────────────────────────────────────

  async getBotAgents() {
    return this.prisma.botAgentDefinition.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async createBotAgent(data: {
    agentKey: string;
    name: string;
    description?: string;
    suitableFor?: string;
    personaPrompt?: string;
    toneRules?: string;
  }) {
    const agentKey = data.agentKey?.trim();
    const name = data.name?.trim();
    if (!agentKey) throw new BadRequestException('agentKey is required');
    if (!name) throw new BadRequestException('name is required');

    const personaPrompt = data.personaPrompt?.trim();
    const toneRules = data.toneRules?.trim();
    const behaviorConfig =
      personaPrompt || toneRules
        ? { ...(personaPrompt ? { personaPrompt } : {}), ...(toneRules ? { toneRules } : {}) }
        : undefined;

    return this.prisma.botAgentDefinition.create({
      data: {
        agentKey,
        name,
        description: data.description?.trim() || '',
        suitableFor: data.suitableFor?.trim() || '',
        ...(behaviorConfig ? { behaviorConfig } : {}),
      },
    });
  }

  async updateBotAgent(
    id: number,
    data: Partial<{
      name: string;
      description: string;
      suitableFor: string;
      active: boolean;
      behaviorConfig: AgentBehaviorConfig | null;
    }>,
  ) {
    const existing = await this.prisma.botAgentDefinition.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Agent definition not found');
    return this.prisma.botAgentDefinition.update({
      where: { id },
      data: data as any,
    });
  }

  // ── Custom Agent Requests ───────────────────────────────────────────────

  async getAgentRequests(status?: string) {
    return this.prisma.agentRequest.findMany({
      where: status ? { status } : undefined,
      include: {
        user: { select: { id: true, username: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateAgentRequestStatus(id: number, status: string, adminNote?: string) {
    const req = await this.prisma.agentRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Request not found');
    if (!['pending', 'contacted', 'fulfilled'].includes(status)) {
      throw new BadRequestException('Invalid status');
    }
    return this.prisma.agentRequest.update({
      where: { id },
      data: { status, adminNote: adminNote?.trim() || null },
    });
  }

  async getRegistryEntries(opts: { search?: string; limit: number; offset: number }) {
    const where: any = opts.search
      ? {
          OR: [
            { name: { contains: opts.search, mode: 'insensitive' } },
            { phone: { contains: opts.search, mode: 'insensitive' } },
            { psid: { contains: opts.search, mode: 'insensitive' } },
            { address: { contains: opts.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [total, items] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        select: {
          id: true,
          psid: true,
          name: true,
          phone: true,
          address: true,
          totalOrders: true,
          totalSpent: true,
          createdAt: true,
          page: {
            select: {
              pageName: true,
              pageId: true,
              owner: { select: { username: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: opts.limit,
        skip: opts.offset,
      }),
    ]);
    return { total, items };
  }

  async exportRegistrySnapshot(res: Response) {
    const entries = await this.prisma.customer.findMany({
      select: {
        id: true,
        psid: true,
        name: true,
        phone: true,
        address: true,
        totalOrders: true,
        totalSpent: true,
        createdAt: true,
        page: {
          select: {
            pageName: true,
            owner: { select: { username: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const wb = new Workbook();
    wb.creator = 'FlamboyAI';
    const ws = wb.addWorksheet('Registry');

    ws.columns = [
      { header: '#',           key: 'no',          width: 6 },
      { header: 'Name',        key: 'name',         width: 24 },
      { header: 'Phone',       key: 'phone',        width: 18 },
      { header: 'FB ID (PSID)',key: 'psid',         width: 22 },
      { header: 'Address',     key: 'address',      width: 36 },
      { header: 'Page',        key: 'page',         width: 22 },
      { header: 'Client',      key: 'client',       width: 18 },
      { header: 'Total Orders',key: 'totalOrders',  width: 14 },
      { header: 'Total Spent', key: 'totalSpent',   width: 14 },
      { header: 'Joined Date', key: 'joinedDate',   width: 18 },
    ];

    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF312E81' } };
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    entries.forEach((c, i) => {
      ws.addRow({
        no:          i + 1,
        name:        c.name || '',
        phone:       c.phone || '',
        psid:        c.psid,
        address:     c.address || '',
        page:        c.page?.pageName || '',
        client:      c.page?.owner?.username || '',
        totalOrders: c.totalOrders,
        totalSpent:  c.totalSpent,
        joinedDate:  c.createdAt.toISOString().slice(0, 10),
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="registry-${new Date().toISOString().slice(0,10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  }

  async appendDailyRegistry(): Promise<void> {
    const filePath = path.join(process.cwd(), 'storage', 'sys-registry.xlsx');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const newEntries = await this.prisma.customer.findMany({
      where: { createdAt: { gte: yesterday, lt: today } },
      select: {
        id: true,
        psid: true,
        name: true,
        phone: true,
        address: true,
        totalOrders: true,
        totalSpent: true,
        createdAt: true,
        page: {
          select: {
            pageName: true,
            owner: { select: { username: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (newEntries.length === 0) return;

    const wb = new Workbook();
    const storageDir = path.dirname(filePath);
    if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });

    let ws: Worksheet;
    let startRow: number;

    if (fs.existsSync(filePath)) {
      await wb.xlsx.readFile(filePath);
      ws = wb.getWorksheet('Registry') ?? wb.addWorksheet('Registry');
      startRow = ws.rowCount + 1;
    } else {
      ws = wb.addWorksheet('Registry');
      ws.columns = [
        { header: '#',            key: 'no',          width: 6 },
        { header: 'Name',         key: 'name',         width: 24 },
        { header: 'Phone',        key: 'phone',        width: 18 },
        { header: 'FB ID (PSID)', key: 'psid',         width: 22 },
        { header: 'Address',      key: 'address',      width: 36 },
        { header: 'Page',         key: 'page',         width: 22 },
        { header: 'Client',       key: 'client',       width: 18 },
        { header: 'Total Orders', key: 'totalOrders',  width: 14 },
        { header: 'Total Spent',  key: 'totalSpent',   width: 14 },
        { header: 'Joined Date',  key: 'joinedDate',   width: 18 },
      ];
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF312E81' } };
      startRow = 2;
    }

    for (const c of newEntries) {
      ws.addRow({
        no:          startRow - 1,
        name:        c.name || '',
        phone:       c.phone || '',
        psid:        c.psid,
        address:     c.address || '',
        page:        c.page?.pageName || '',
        client:      c.page?.owner?.username || '',
        totalOrders: c.totalOrders,
        totalSpent:  c.totalSpent,
        joinedDate:  c.createdAt.toISOString().slice(0, 10),
      });
      startRow++;
    }

    await wb.xlsx.writeFile(filePath);
  }

  // ── Custom Domain Setup ──────────────────────────────────────────────────────

  private readonly NGINX_CONF = '/etc/nginx/sites-available/FlamboyAI-custom-domains.conf';
  private readonly NGINX_LINK = '/etc/nginx/sites-enabled/FlamboyAI-custom-domains.conf';
  private readonly ADMIN_EMAIL = 'admin@flamboyai.com';

  private isDomainValid(domain: string): boolean {
    return /^[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?)+$/.test(domain);
  }

  private runCmd(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 120_000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout + (stderr ? '\n' + stderr : ''));
      });
    });
  }

  private buildNginxBlock(domain: string, useSsl: boolean): string {
    const encodedDomain = encodeURIComponent(domain);
    if (useSsl) {
      return `
# Domain: ${domain}
server {
    listen 80;
    server_name ${domain};
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl;
    server_name ${domain};
    ssl_certificate     /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    location / {
        proxy_pass http://localhost:3000/catalog/by-domain?host=${encodedDomain}&path=$request_uri;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}`;
    }
    return `
# Domain: ${domain}
server {
    listen 80;
    server_name ${domain};
    location / {
        proxy_pass http://localhost:3000/catalog/by-domain?host=${encodedDomain}&path=$request_uri;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}`;
  }

  private addOrReplaceDomainBlock(domain: string, newBlock: string): void {
    let content = '';
    if (fs.existsSync(this.NGINX_CONF)) {
      content = fs.readFileSync(this.NGINX_CONF, 'utf8');
      // Remove existing block for this domain
      const marker = `# Domain: ${domain}`;
      const idx = content.indexOf(marker);
      if (idx !== -1) {
        // find the next marker or end of file
        const nextIdx = content.indexOf('\n# Domain:', idx + 1);
        content = (content.slice(0, idx) + (nextIdx !== -1 ? content.slice(nextIdx) : '')).trim();
      }
    }
    fs.writeFileSync(this.NGINX_CONF, (content + '\n' + newBlock).trim() + '\n', 'utf8');
    // Ensure symlink exists
    if (!fs.existsSync(this.NGINX_LINK)) {
      fs.symlinkSync(this.NGINX_CONF, this.NGINX_LINK);
    }
  }

  private removeDomainBlock(domain: string): void {
    if (!fs.existsSync(this.NGINX_CONF)) return;
    let content = fs.readFileSync(this.NGINX_CONF, 'utf8');
    const marker = `# Domain: ${domain}`;
    const idx = content.indexOf(marker);
    if (idx === -1) return;
    const nextIdx = content.indexOf('\n# Domain:', idx + 1);
    content = (content.slice(0, idx) + (nextIdx !== -1 ? content.slice(nextIdx) : '')).trim();
    fs.writeFileSync(this.NGINX_CONF, content + '\n', 'utf8');
  }

  async setupCustomDomain(pageId: number, domain: string, skipSsl: boolean) {
    if (!this.isDomainValid(domain)) {
      throw new BadRequestException('Invalid domain format');
    }

    const page = await this.prisma.page.findUnique({ where: { id: pageId }, select: { id: true } });
    if (!page) throw new NotFoundException('Page not found');

    // Check if domain is already taken by another page
    const existing = await this.prisma.page.findFirst({ where: { customDomain: domain, id: { not: pageId } } });
    if (existing) throw new BadRequestException('এই domain অন্য একটি page-এ already আছে');

    const steps: { step: string; status: 'ok' | 'error' | 'skip'; detail: string }[] = [];

    // Step 1: Write nginx config (without SSL first)
    try {
      this.addOrReplaceDomainBlock(domain, this.buildNginxBlock(domain, false));
      steps.push({ step: 'Nginx config লেখা', status: 'ok', detail: this.NGINX_CONF });
    } catch (e: any) {
      steps.push({ step: 'Nginx config লেখা', status: 'error', detail: e.message });
      return { success: false, steps };
    }

    // Step 2: nginx -t
    try {
      await this.runCmd('nginx', ['-t']);
      steps.push({ step: 'Nginx syntax check', status: 'ok', detail: 'nginx -t passed' });
    } catch (e: any) {
      steps.push({ step: 'Nginx syntax check', status: 'error', detail: e.message });
      return { success: false, steps };
    }

    // Step 3: reload nginx (activates HTTP for certbot challenge)
    try {
      await this.runCmd('systemctl', ['reload', 'nginx']);
      steps.push({ step: 'Nginx reload', status: 'ok', detail: 'HTTP config active' });
    } catch (e: any) {
      steps.push({ step: 'Nginx reload', status: 'error', detail: e.message });
      return { success: false, steps };
    }

    // Step 4: certbot (optional)
    if (skipSsl) {
      steps.push({ step: 'SSL (certbot)', status: 'skip', detail: 'Cloudflare SSL বা skip করা হয়েছে' });
    } else {
      try {
        const out = await this.runCmd('certbot', [
          '--nginx', '-d', domain,
          '--non-interactive', '--agree-tos',
          '-m', this.ADMIN_EMAIL, '--redirect',
        ]);
        steps.push({ step: 'SSL certificate (certbot)', status: 'ok', detail: out.slice(0, 300) });
        // Rewrite config with SSL paths now that certbot has set them
        // certbot --nginx modifies the nginx config automatically, so no manual rewrite needed
      } catch (e: any) {
        steps.push({ step: 'SSL certificate (certbot)', status: 'error', detail: e.message.slice(0, 400) });
        // Continue — domain still works on HTTP
      }
    }

    // Step 5: final reload
    try {
      await this.runCmd('systemctl', ['reload', 'nginx']);
      steps.push({ step: 'Final nginx reload', status: 'ok', detail: 'Done' });
    } catch (e: any) {
      steps.push({ step: 'Final nginx reload', status: 'error', detail: e.message });
    }

    // Step 6: save to DB
    await this.prisma.page.update({ where: { id: pageId }, data: { customDomain: domain } });
    steps.push({ step: 'Database save', status: 'ok', detail: `customDomain = ${domain}` });

    return { success: true, domain, steps };
  }

  async removeCustomDomain(pageId: number) {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { id: true, customDomain: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    const domain = page.customDomain;
    if (!domain) return { success: true, message: 'কোনো domain set ছিল না' };

    this.removeDomainBlock(domain);
    try { await this.runCmd('nginx', ['-t']); } catch {}
    try { await this.runCmd('systemctl', ['reload', 'nginx']); } catch {}
    await this.prisma.page.update({ where: { id: pageId }, data: { customDomain: null } });

    return { success: true, message: `${domain} সরিয়ে দেওয়া হয়েছে` };
  }

  async listCustomDomains() {
    return this.prisma.page.findMany({
      where: { customDomain: { not: null } },
      select: {
        id: true,
        pageName: true,
        businessName: true,
        customDomain: true,
        catalogSlug: true,
        owner: { select: { username: true } },
      },
    });
  }

  async clearAdminSmsDevices(): Promise<void> {
    await (this.prisma as any).smsDevice.deleteMany({ where: { pageId: null } });
  }

  async getRevenueReport(month?: string) {
    const USD_TO_BDT = Number(process.env.USD_TO_BDT) || 130;
    // Wallet ledger amounts are now in credit units, not BDT — convert to real
    // BDT-equivalent using the global rate so revenue/cost stay comparable.
    // Approximate: package-based recharges may have a slightly different
    // effective rate than the global custom-recharge rate.
    const creditsPerBdt = this._readGlobalPricing().creditsPerBdt || 40;

    // Per-type real API cost in USD (per call)
    const PROVIDER_COST_USD: Record<string, Record<string, number>> = {
      // gemini-2.0-flash-lite: TEXT ~$0.000075/1K tokens (avg ~100 token call)
      // gemini-2.0-flash: IMAGE/OCR ~$0.000265/image (265 tokens image input @ $0.001/1K)
      gemini:  { TEXT: 0.0000075, SMART_BOT: 0.000015, IMAGE: 0.000265, IMAGE_OCR: 0.000265, ADMIN_VISION: 0.000265, DUAL_PHOTO_AI: 0.0008, AI_GENERATE: 0.0000075, VOICE: 0, MEMO_PRINT: 0, KEYWORD_REPLY: 0, COMMENT_REPLY: 0, BROADCAST: 0, IMAGE_LOCAL: 0, IMAGE_UNIQUENESS: 0 },
      // gpt-4o: TEXT $0.0025/1K input (avg ~200 token = $0.0005), IMAGE ~$0.00255/image, SMART_BOT uses gpt-4o-mini $0.00015/1K
      openai:  { TEXT: 0.0005,   SMART_BOT: 0.00003,   IMAGE: 0.00255, IMAGE_OCR: 0.00255,  ADMIN_VISION: 0.00255, DUAL_PHOTO_AI: 0.00765, AI_GENERATE: 0.0005,   VOICE: 0, MEMO_PRINT: 0, KEYWORD_REPLY: 0, COMMENT_REPLY: 0, BROADCAST: 0, IMAGE_LOCAL: 0, IMAGE_UNIQUENESS: 0 },
      local:   { TEXT: 0, SMART_BOT: 0, IMAGE: 0, IMAGE_OCR: 0, ADMIN_VISION: 0, DUAL_PHOTO_AI: 0, AI_GENERATE: 0, VOICE: 0, MEMO_PRINT: 0, KEYWORD_REPLY: 0, COMMENT_REPLY: 0, BROADCAST: 0, IMAGE_LOCAL: 0, IMAGE_UNIQUENESS: 0 },
    };

    // Build date filter
    let dateFilter: any = {};
    if (month) {
      const [y, m] = month.split('-').map(Number);
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 1);
      dateFilter = { createdAt: { gte: start, lt: end } };
    }

    // Admin-owned test pages are excluded from the report entirely — their
    // recharges aren't real revenue and their AI usage isn't customer cost.
    const pages = await this.prisma.page.findMany({
      select: {
        id: true,
        pageName: true,
        creditBalance: true,
        subscriptionStatus: true,
        nextBillingDate: true,
        isTestPage: true,
        owner: { select: { username: true } },
      },
    });
    const testPageIds = pages.filter((p) => p.isTestPage).map((p) => p.id);

    const [transactions, aiUsageRows] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where: { ...dateFilter, pageId: { notIn: testPageIds } },
        select: { pageId: true, type: true, amountCredit: true, provider: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      // V26: real measured token usage (SMART_BOT + AI_INTENT capture it),
      // priced with official provider rates at write time. Rows with a null
      // pageId (platform-level calls) are kept.
      this.prisma.aiUsage.groupBy({
        by: ['provider', 'model', 'usageType'],
        where: {
          ...dateFilter,
          OR: [{ pageId: null }, { pageId: { notIn: testPageIds } }],
        },
        _sum: { promptTokens: true, outputTokens: true, costUsd: true },
        _count: { _all: true },
      }),
    ]);

    // ── Global aggregates ──────────────────────────────────────────────────
    let totalRevenueBdt = 0;
    let totalBilledBdt = 0;
    let totalApiCostBdt = 0;

    // Usage breakdown by (type, provider)
    const usageMap: Record<string, { count: number; billedBdt: number; costBdt: number; costUsd: number }> = {};

    // Per-page aggregates
    const pageMap: Record<number, { rechargedBdt: number; billedBdt: number; apiCostBdt: number; apiCallCount: number }> = {};

    // Monthly trend
    const monthMap: Record<string, { revenueBdt: number; apiCostBdt: number }> = {};

    for (const tx of transactions) {
      // Manual balance corrections are neither revenue nor customer usage —
      // counting their negative legs as "billed usage" (or positive legs as
      // recharge) would distort the report.
      if (tx.type === 'ADMIN_ADJUSTMENT') continue;

      const monthKey = tx.createdAt.toISOString().slice(0, 7);
      if (!monthMap[monthKey]) monthMap[monthKey] = { revenueBdt: 0, apiCostBdt: 0 };
      if (!pageMap[tx.pageId]) pageMap[tx.pageId] = { rechargedBdt: 0, billedBdt: 0, apiCostBdt: 0, apiCallCount: 0 };

      if (tx.type === 'RECHARGE') {
        const bdtEquivalent = tx.amountCredit / creditsPerBdt;
        totalRevenueBdt += bdtEquivalent;
        pageMap[tx.pageId].rechargedBdt += bdtEquivalent;
        monthMap[monthKey].revenueBdt += bdtEquivalent;
      } else if (tx.amountCredit < 0) {
        const billed = Math.abs(tx.amountCredit) / creditsPerBdt;
        totalBilledBdt += billed;
        pageMap[tx.pageId].billedBdt += billed;
        pageMap[tx.pageId].apiCallCount += 1;

        // Resolve usage type (strip DEDUCT_ prefix)
        const rawType = tx.type.replace(/^DEDUCT_/, '');
        const provider = tx.provider ?? 'local';
        const mapKey = `${rawType}|${provider}`;
        if (!usageMap[mapKey]) usageMap[mapKey] = { count: 0, billedBdt: 0, costBdt: 0, costUsd: 0 };
        usageMap[mapKey].count += 1;
        usageMap[mapKey].billedBdt += billed;

        const rateUsd = (PROVIDER_COST_USD[provider] ?? PROVIDER_COST_USD.local)[rawType] ?? 0;
        const costBdt = rateUsd * USD_TO_BDT;
        usageMap[mapKey].costBdt += costBdt;
        usageMap[mapKey].costUsd += rateUsd;

        totalApiCostBdt += costBdt;
        pageMap[tx.pageId].apiCostBdt += costBdt;
        monthMap[monthKey].apiCostBdt += costBdt;
      }
    }

    // Build per-page table
    const pageIndex = Object.fromEntries(pages.map(p => [p.id, p]));
    const perPage = Object.entries(pageMap)
      .map(([pageIdStr, agg]) => {
        const p = pageIndex[Number(pageIdStr)];
        return {
          pageId: Number(pageIdStr),
          pageName: p?.pageName ?? '?',
          ownerName: p?.owner?.username ?? '?',
          currentBalanceCredit: p?.creditBalance ?? 0,
          subscriptionStatus: p?.subscriptionStatus ?? '?',
          nextBillingDate: p?.nextBillingDate ?? null,
          ...agg,
          netProfitBdt: agg.rechargedBdt - agg.apiCostBdt,
        };
      })
      .sort((a, b) => b.rechargedBdt - a.rechargedBdt);

    // Build usage breakdown table
    const usageBreakdown = Object.entries(usageMap).map(([key, v]) => {
      const [type, provider] = key.split('|');
      return { type, provider, ...v, profitBdt: v.billedBdt - v.costBdt };
    }).sort((a, b) => b.billedBdt - a.billedBdt);

    // Monthly trend (last 6 months, sorted desc)
    const monthlyTrend = Object.entries(monthMap)
      .map(([m, v]) => ({ month: m, ...v, profitBdt: v.revenueBdt - v.apiCostBdt }))
      .sort((a, b) => b.month.localeCompare(a.month))
      .slice(0, 12);

    // ── V26: measured (token-based) AI cost ────────────────────────────────
    // SMART_BOT and AI_INTENT calls record real tokens in AiUsage. For those
    // usage types the measured figure replaces the flat estimate; every other
    // path keeps its estimate until it also captures tokens.
    const measuredCostUsd = aiUsageRows.reduce((s, r) => s + (r._sum.costUsd ?? 0), 0);
    const measuredCalls = aiUsageRows.reduce((s, r) => s + r._count._all, 0);
    const measuredCostBdt = measuredCostUsd * USD_TO_BDT;
    const measuredByModel = aiUsageRows
      .map((r) => ({
        provider: r.provider,
        model: r.model,
        usageType: r.usageType,
        calls: r._count._all,
        promptTokens: r._sum.promptTokens ?? 0,
        outputTokens: r._sum.outputTokens ?? 0,
        costUsd: r._sum.costUsd ?? 0,
        costBdt: (r._sum.costUsd ?? 0) * USD_TO_BDT,
      }))
      .sort((a, b) => b.costUsd - a.costUsd);
    // Usage types whose cost is now measured — SMART_BOT ledger rows and the
    // ai-intent TEXT rows. Only drop their estimates when measurement exists,
    // so historical months (pre-AiUsage) keep the old estimated totals.
    const MEASURED_TYPES = new Set(['SMART_BOT', 'TEXT']);
    const estimatedForMeasuredTypesBdt = Object.entries(usageMap)
      .filter(([key]) => MEASURED_TYPES.has(key.split('|')[0]))
      .reduce((s, [, v]) => s + v.costBdt, 0);
    const combinedApiCostBdt =
      measuredCalls > 0
        ? totalApiCostBdt - estimatedForMeasuredTypesBdt + measuredCostBdt
        : totalApiCostBdt;

    return {
      usdToBdt: USD_TO_BDT,
      summary: {
        totalRevenueBdt,
        totalBilledBdt,
        totalApiCostBdt,
        totalApiCostUsd: totalApiCostBdt / USD_TO_BDT,
        measuredApiCostBdt: measuredCostBdt,
        measuredApiCostUsd: measuredCostUsd,
        measuredCalls,
        combinedApiCostBdt,
        netProfitBdt: totalRevenueBdt - combinedApiCostBdt,
        profitMarginPct: totalRevenueBdt > 0 ? ((totalRevenueBdt - combinedApiCostBdt) / totalRevenueBdt) * 100 : 0,
      },
      aiUsage: { measuredCalls, measuredCostUsd, measuredCostBdt, byModel: measuredByModel },
      usageBreakdown,
      perPage,
      monthlyTrend,
    };
  }

  // ── Agents (resellers) ────────────────────────────────────────────────────
  // Suspend/reactivate an agent reuses the existing role-agnostic
  // setUserAccountStatus() (PATCH admin/users/:userId/account-status) — no
  // dedicated agent toggle route needed.

  async listAgents() {
    return this.partner.listAgentsWithBalances();
  }

  async createAgent(body: {
    username?: string;
    password?: string;
    name?: string;
    commissionPercentRecharge?: number;
    commissionPercentSubscription?: number;
  }) {
    if (!body.username || !body.password) {
      throw new BadRequestException('username এবং password দিন');
    }
    return this.authService.register({
      username: body.username,
      password: body.password,
      name: body.name,
      role: 'agent',
      isActive: true,
      commissionPercentRecharge: body.commissionPercentRecharge,
      commissionPercentSubscription: body.commissionPercentSubscription,
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
    return this.partner.updateAgent(agentId, data);
  }

  async recordAgentPayout(agentId: string, amountBdt: number, note: string | undefined, adminUsername: string) {
    return this.partner.recordPayout(agentId, amountBdt, note, adminUsername);
  }

  async getAgentEarningsLedger(agentId: string) {
    return this.partner.getAgentEarningsLedger(agentId);
  }
}
