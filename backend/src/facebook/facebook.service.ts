import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { EncryptionService } from '../common/encryption.service';
import { BillingService } from '../billing/billing.service';
import { TelegramService } from '../common/telegram.service';
import { MailerService } from '../common/mailer.service';

type PendingOAuthResult = {
  userId: string;
  pages: FacebookPageInfo[];
  createdAt: number;
};

type PendingApproval = {
  pageRequestId: number;
  candidates: FacebookPageInfo[];
  createdAt: number;
};

const DEFAULT_PRICING = {
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
};

// Global pricing JSON also carries `creditsPerBdt` (the custom-recharge rate) —
// that's not a Page column, so it's stripped out before this is spread into
// a page.create()/update() call.
function readGlobalPricing(): typeof DEFAULT_PRICING {
  try {
    const file = path.join(process.cwd(), 'storage', 'global-pricing.json');
    if (fs.existsSync(file)) {
      const { creditsPerBdt, ...rest } = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { ...DEFAULT_PRICING, ...rest };
    }
  } catch {}
  return { ...DEFAULT_PRICING };
}

// Reads the same storage/global-config.json file AdminService writes to —
// avoids a circular module dependency (AdminModule already imports FacebookModule).
function readModeratorAccessConfig(): { fbProfileLink: string; email: string } {
  try {
    const file = path.join(process.cwd(), 'storage', 'global-config.json');
    if (fs.existsSync(file)) {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        fbProfileLink: String(cfg?.moderatorAccess?.fbProfileLink || ''),
        email: String(cfg?.moderatorAccess?.email || ''),
      };
    }
  } catch {}
  return { fbProfileLink: '', email: '' };
}

@Injectable()
export class FacebookService {
  private readonly logger = new Logger(FacebookService.name);
  private readonly appId = process.env.FB_APP_ID || '';
  private readonly appSecret = process.env.FB_APP_SECRET || '';
  private readonly stateSecret =
    process.env.FB_OAUTH_STATE_SECRET || this.appSecret || 'dfbot_state_secret';
  private readonly redirectUri =
    process.env.FB_REDIRECT_URI || 'http://localhost:3000/facebook/callback';
  // pages_manage_engagement and pages_manage_posts are gated behind Meta
  // Business Verification (currently not passing — see devtools_compliance /
  // app_review requirements) and get rejected as "Invalid Scopes" by the
  // OAuth dialog when requested. Dropped for now so login isn't blocked;
  // re-add pages_manage_engagement once verification passes to restore the
  // Facebook comment auto-reply feature (pages_manage_posts is unused).
  private readonly oauthScope =
    'pages_show_list,pages_read_engagement,pages_messaging,pages_manage_metadata';
  private readonly pendingOAuthResults = new Map<string, PendingOAuthResult>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly encryption: EncryptionService,
    private readonly billing: BillingService,
    private readonly telegram: TelegramService,
    private readonly mailer: MailerService,
  ) {}

  private buildSignedState(payload: Record<string, unknown>): string {
    const body = Buffer.from(
      JSON.stringify({ ...payload, ts: Date.now() }),
    ).toString('base64url');
    const sig = crypto.createHmac('sha256', this.stateSecret).update(body).digest('hex');
    return `${body}.${sig}`;
  }

  getOAuthUrl(userId: string): string {
    if (!this.appId) throw new BadRequestException('FB_APP_ID not configured');
    const state = this.buildSignedState({ userId });
    return `https://www.facebook.com/v19.0/dialog/oauth?client_id=${this.appId}&redirect_uri=${encodeURIComponent(this.redirectUri)}&scope=${this.oauthScope}&state=${encodeURIComponent(state)}&response_type=code`;
  }

  // Builds the same OAuth dialog URL, but with state that identifies this as
  // an admin confirming moderator access for a specific PageRequest instead
  // of a client connecting their own page.
  getAdminApproveUrl(pageRequestId: number): string {
    if (!this.appId) throw new BadRequestException('FB_APP_ID not configured');
    const state = this.buildSignedState({
      purpose: 'admin_approve_page_request',
      pageRequestId,
    });
    return `https://www.facebook.com/v19.0/dialog/oauth?client_id=${this.appId}&redirect_uri=${encodeURIComponent(this.redirectUri)}&scope=${this.oauthScope}&state=${encodeURIComponent(state)}&response_type=code`;
  }

  async handleCallback(
    code: string,
    state: string,
  ): Promise<
    | { pages: FacebookPageInfo[]; userId: string; purpose?: undefined }
    | { pages: FacebookPageInfo[]; purpose: 'admin_approve_page_request'; pageRequestId: number }
  > {
    if (!code) throw new BadRequestException('Missing OAuth code');
    const parsed = this.parseSignedState(state);
    const userToken = await this.exchangeCodeForToken(code);
    const pages = await this.getUserPages(userToken);
    if (parsed.purpose === 'admin_approve_page_request') {
      return { pages, purpose: parsed.purpose, pageRequestId: parsed.pageRequestId! };
    }
    return { pages, userId: parsed.userId! };
  }

  createPendingOAuthResult(userId: string, pages: FacebookPageInfo[]): string {
    const id = crypto.randomUUID();
    this.pendingOAuthResults.set(id, {
      userId,
      pages,
      createdAt: Date.now(),
    });
    this.cleanupPendingOAuthResults();
    return id;
  }

  consumePendingOAuthResult(userId: string, id: string) {
    const item = this.pendingOAuthResults.get(id);
    if (!item)
      throw new BadRequestException('OAuth result not found or expired');
    if (item.userId !== userId)
      throw new ForbiddenException('OAuth result does not belong to this user');
    this.pendingOAuthResults.delete(id);
    return { pages: item.pages };
  }

  async connectPage(
    userId: string,
    pageInfo: {
      pageId: string;
      pageName: string;
      pageToken: string;
      verifyToken?: string;
      masterPageId?: number;
      fbAppId?: string;
      fbAppSecret?: string;
    },
  ): Promise<any> {
    const submittedPageId = String(pageInfo.pageId || '').trim();
    const submittedPageName = String(pageInfo.pageName || '').trim();
    const submittedPageToken = String(pageInfo.pageToken || '').trim();

    if (!submittedPageToken) {
      throw new BadRequestException('Facebook page token is required');
    }

    const submittedFbAppId = String(pageInfo.fbAppId || '').trim() || null;
    const rawFbAppSecret = String(pageInfo.fbAppSecret || '').trim();
    const encryptedFbAppSecret = rawFbAppSecret
      ? this.encryption.encryptIfNeeded(rawFbAppSecret)
      : null;

    const verifiedPage = await this.verifyPageToken(submittedPageToken);
    if (submittedPageId && submittedPageId !== verifiedPage.pageId) {
      this.logger.warn(
        `[Facebook] Rejected page connect due to ID mismatch: submitted=${submittedPageId} verified=${verifiedPage.pageId}`,
      );
      throw new BadRequestException(
        `Page ID mismatch. Facebook token belongs to page ${verifiedPage.pageId} (${verifiedPage.pageName}).`,
      );
    }

    const verifyToken =
      pageInfo.verifyToken || `dfbot_${verifiedPage.pageId}_${Date.now()}`;
    // Exchange for a never-expiring permanent page access token
    const permanentToken = await this.exchangeForPermanentPageToken(submittedPageToken, verifiedPage.pageId);
    const encryptedToken = this.encryption.encryptIfNeeded(permanentToken);
    const existing = await this.prisma.page.findUnique({
      where: { pageId: verifiedPage.pageId },
      select: { id: true, ownerId: true, verifyToken: true },
    });

    // Page count is deliberately UNLIMITED for every account: each page has
    // its own wallet, so billing is naturally per-page. Legacy per-plan
    // pagesLimit enforcement (old starter/pro rows) blocked users whose
    // subscription still pointed at a deactivated plan — removed. Ensure the
    // subscription exists so downstream billing keeps working.
    if (!existing || existing.ownerId !== userId) {
      await this.billing.getOrCreateSubscription(userId);
    }

    if (existing?.ownerId && existing.ownerId !== userId) {
      throw new ForbiddenException(
        'This Facebook page is already connected to another account',
      );
    }

    // Validate masterPageId if provided
    const masterPageId = pageInfo.masterPageId
      ? Number(pageInfo.masterPageId)
      : undefined;
    if (masterPageId) {
      const master = await this.prisma.page.findUnique({
        where: { id: masterPageId },
        select: { ownerId: true, masterPageId: true },
      });
      if (!master || master.ownerId !== userId)
        throw new BadRequestException('Master page not found or not yours');
      if (master.masterPageId !== null)
        throw new BadRequestException(
          'Target page is itself a linked page — only standalone pages can be masters',
        );
    }

    const page = existing
      ? await this.prisma.page.update({
          where: { id: existing.id },
          data: {
            pageId: verifiedPage.pageId,
            pageName: verifiedPage.pageName,
            pageToken: encryptedToken,
            ownerId: userId,
            isActive: true,
            verifyToken: existing.verifyToken || verifyToken,
            ...(masterPageId !== undefined ? { masterPageId } : {}),
            ...(pageInfo.fbAppId !== undefined ? { fbAppId: submittedFbAppId } : {}),
            ...(pageInfo.fbAppSecret !== undefined ? { fbAppSecret: encryptedFbAppSecret } : {}),
          },
        })
      : await this.prisma.page.create({
          data: {
            pageId: verifiedPage.pageId,
            pageName: verifiedPage.pageName,
            pageToken: encryptedToken,
            verifyToken,
            ownerId: userId,
            isActive: true,
            automationOn: false,
            fbAppId: submittedFbAppId,
            fbAppSecret: encryptedFbAppSecret,
            ...(masterPageId !== undefined ? { masterPageId } : {}),
            ...readGlobalPricing(),
          },
        });

    await this.authService.addPageToUser(userId, page.id);
    this.logger.log(
      `[Facebook] Page connected: ${page.pageName} (${page.pageId}) → user ${userId}`,
    );

    // Subscribe the page to this app's webhook so Facebook delivers messages
    await this.subscribePageToWebhook(verifiedPage.pageId, permanentToken).catch((err: any) =>
      this.logger.warn(`[Facebook] Webhook subscription failed for ${verifiedPage.pageId}: ${err?.message}`),
    );

    return {
      success: true,
      page: {
        id: page.id,
        pageId: page.pageId,
        pageName: page.pageName,
        verifyToken: page.verifyToken,
        fbAppId: page.fbAppId ?? null,
        hasCustomApp: !!page.fbAppSecret,
      },
      webhookUrl: `${process.env.STORAGE_PUBLIC_URL?.replace('/storage', '') || 'http://localhost:3000'}/webhook`,
      instructions: `Facebook Webhook URL: /webhook | Verify Token: ${page.verifyToken}`,
    };
  }

  async resolvePageIdentity(
    pageUrl: string,
    pageToken: string,
  ): Promise<{
    pageId: string;
    pageName: string;
  }> {
    const submittedPageUrl = String(pageUrl || '').trim();
    const submittedPageToken = String(pageToken || '').trim();

    if (!submittedPageToken) {
      throw new BadRequestException('Facebook page token is required');
    }

    const verifiedPage = await this.verifyPageToken(submittedPageToken);
    const parsedRef = this.parsePageReference(submittedPageUrl);

    if (!parsedRef) {
      return {
        pageId: verifiedPage.pageId,
        pageName: verifiedPage.pageName,
      };
    }

    if (/^\d+$/.test(parsedRef)) {
      if (parsedRef !== verifiedPage.pageId) {
        throw new BadRequestException(
          `Page link mismatch. The link points to ${parsedRef}, but the token belongs to page ${verifiedPage.pageId} (${verifiedPage.pageName}).`,
        );
      }

      return {
        pageId: verifiedPage.pageId,
        pageName: verifiedPage.pageName,
      };
    }

    const resolvedPage = await this.fetchPageIdentityByReference(
      parsedRef,
      submittedPageToken,
    );

    if (resolvedPage.pageId !== verifiedPage.pageId) {
      this.logger.warn(
        `[Facebook] Rejected page resolve due to mismatch: link=${submittedPageUrl} resolved=${resolvedPage.pageId} verified=${verifiedPage.pageId}`,
      );
      throw new BadRequestException(
        `Page link mismatch. Token belongs to page ${verifiedPage.pageId} (${verifiedPage.pageName}).`,
      );
    }

    return {
      pageId: verifiedPage.pageId,
      pageName: verifiedPage.pageName,
    };
  }

  async disconnectPage(
    userId: string,
    pageDbId: number,
  ): Promise<{ success: boolean }> {
    const page = await this.prisma.page.findUnique({ where: { id: pageDbId } });
    if (!page || page.ownerId !== userId)
      throw new BadRequestException('Page not found or not yours');
    await this.prisma.page.update({
      where: { id: pageDbId },
      data: { isActive: false, automationOn: false, pageToken: '' },
    });
    await this.authService.removePageFromUser(userId, pageDbId);
    return { success: true };
  }

  async getMyPages(userId: string) {
    const pages = await this.prisma.page.findMany({
      where: { ownerId: userId },
      select: {
        id: true,
        pageId: true,
        pageName: true,
        isActive: true,
        automationOn: true,
        ocrOn: true,
        masterPageId: true,
        createdAt: true,
        fbAppId: true,
        fbAppSecret: true,
        pageToken: true,
        waEnabled: true,
        waPhoneNumberId: true,
        waToken: true,
        igEnabled: true,
        igBusinessAccountId: true,
        igToken: true,
      },
      orderBy: { id: 'desc' },
    });
    return pages.map(({ fbAppSecret, pageToken, waToken, igToken, ...p }) => ({
      ...p,
      hasCustomApp: !!fbAppSecret,
      isConnected: !!pageToken,
      waConfigured: !!waToken,
      igConfigured: !!igToken,
    }));
  }

  getFrontendBaseUrl() {
    const dashboardUrl = String(process.env.DASHBOARD_URL || '').trim();
    if (dashboardUrl) return dashboardUrl.replace(/\/+$/, '');

    const landingUrl = String(process.env.LANDING_PAGE_URL || '').trim();
    if (landingUrl) return landingUrl.replace(/\/+$/, '');

    const storageUrl = String(process.env.STORAGE_PUBLIC_URL || '').trim();
    if (storageUrl)
      return storageUrl.replace(/\/storage\/?$/, '').replace(/\/+$/, '');

    try {
      return new URL(this.redirectUri).origin;
    } catch {
      return 'http://localhost:3000';
    }
  }

  private cleanupPendingOAuthResults() {
    const now = Date.now();
    for (const [key, value] of this.pendingOAuthResults.entries()) {
      if (now - value.createdAt > 10 * 60 * 1000) {
        this.pendingOAuthResults.delete(key);
      }
    }
  }

  private async exchangeCodeForToken(code: string): Promise<string> {
    const url = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${this.appId}&client_secret=${this.appSecret}&redirect_uri=${encodeURIComponent(this.redirectUri)}&code=${code}`;
    const res = await fetch(url);
    const data: any = await res.json();
    if (!data.access_token)
      throw new BadRequestException(
        `FB token exchange failed: ${data?.error?.message || data?.error?.type || 'unknown error'}`,
      );
    return this.exchangeForLongLivedToken(data.access_token);
  }

  private async exchangeForLongLivedToken(shortLivedToken: string): Promise<string> {
    const url = `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${this.appId}&client_secret=${this.appSecret}&fb_exchange_token=${shortLivedToken}`;
    const res = await fetch(url);
    const data: any = await res.json();
    if (!data.access_token) {
      this.logger.warn(`[Facebook] Long-lived token exchange failed, using short-lived. Error: ${data?.error?.message || data?.error?.type || 'unknown'}`);
      return shortLivedToken;
    }
    this.logger.log('[Facebook] Exchanged for long-lived user token successfully');
    return data.access_token;
  }

  /**
   * Exchange any token for a never-expiring permanent page access token.
   * Steps: short-lived token → long-lived user token → permanent page token.
   * Falls back to the original token if exchange fails (e.g. already a page token).
   */
  async exchangeForPermanentPageToken(token: string, pageId: string): Promise<string> {
    if (!this.appId || !this.appSecret) {
      this.logger.warn('[Facebook] No appId/appSecret — cannot exchange for permanent token');
      return token;
    }
    try {
      // Step 1: exchange for long-lived user token
      const longLivedUrl = `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${this.appId}&client_secret=${this.appSecret}&fb_exchange_token=${token}`;
      const llRes = await fetch(longLivedUrl);
      const llData: any = await llRes.json();
      const userToken = llData.access_token || token;

      // Step 2: fetch the page's own never-expiring page access token
      const pageUrl = `https://graph.facebook.com/v19.0/${pageId}?fields=access_token&access_token=${encodeURIComponent(userToken)}`;
      const pgRes = await fetch(pageUrl);
      const pgData: any = await pgRes.json();
      if (pgData.access_token) {
        this.logger.log(`[Facebook] Obtained permanent page token for page ${pageId}`);
        return pgData.access_token;
      }
      this.logger.warn(`[Facebook] Could not get permanent page token, using long-lived token. ${pgData?.error?.message || ''}`);
      return userToken;
    } catch (err: any) {
      this.logger.warn(`[Facebook] Permanent token exchange error: ${err?.message}`);
      return token;
    }
  }

  private async getUserPages(userToken: string): Promise<FacebookPageInfo[]> {
    const url = `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token&access_token=${userToken}`;
    const res = await fetch(url);
    const data: any = await res.json();
    if (!data.data) throw new BadRequestException('Failed to fetch pages');
    return data.data.map((p: any) => ({
      pageId: p.id,
      pageName: p.name,
      pageToken: p.access_token,
    }));
  }

  async subscribePageToWebhook(pageId: string, pageToken: string): Promise<void> {
    const fields = 'messages,messaging_postbacks,messaging_optins,message_deliveries,message_reads,messaging_referrals,feed';
    const url = `https://graph.facebook.com/v19.0/${pageId}/subscribed_apps?subscribed_fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(pageToken)}`;
    const res = await fetch(url, { method: 'POST' });
    const data: any = await res.json().catch(() => ({}));
    if (!data.success) {
      throw new Error(data?.error?.message || JSON.stringify(data));
    }
    this.logger.log(`[Facebook] Webhook subscribed for page ${pageId}`);
  }

  async verifyPageToken(pageToken: string): Promise<FacebookPageInfo> {
    const url = `https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${encodeURIComponent(pageToken)}`;
    const res = await fetch(url);
    const data: any = await res.json().catch(() => ({}));

    if (!res.ok || !data?.id) {
      const msg =
        data?.error?.message ||
        data?.message ||
        'Failed to verify Facebook page token';
      throw new BadRequestException(
        `Facebook page token verification failed: ${msg}`,
      );
    }

    return {
      pageId: String(data.id),
      pageName: String(data.name || '').trim() || 'Untitled Facebook Page',
      pageToken,
    };
  }

  private async fetchPageIdentityByReference(
    reference: string,
    pageToken: string,
  ): Promise<FacebookPageInfo> {
    const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(reference)}?fields=id,name&access_token=${encodeURIComponent(pageToken)}`;
    const res = await fetch(url);
    const data: any = await res.json().catch(() => ({}));

    if (!res.ok || !data?.id) {
      const msg =
        data?.error?.message ||
        data?.message ||
        'Failed to resolve Facebook page link';
      throw new BadRequestException(
        `Facebook page link resolution failed: ${msg}`,
      );
    }

    return {
      pageId: String(data.id),
      pageName: String(data.name || '').trim() || 'Untitled Facebook Page',
      pageToken,
    };
  }

  private parsePageReference(pageUrl: string): string | null {
    const raw = String(pageUrl || '').trim();
    if (!raw) return null;

    if (/^\d+$/.test(raw)) return raw;

    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

    let url: URL;
    try {
      url = new URL(normalized);
    } catch {
      return null;
    }

    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'facebook.com' && host !== 'm.facebook.com') {
      return null;
    }

    const profileId = url.searchParams.get('id');
    if (profileId && /^\d+$/.test(profileId)) {
      return profileId;
    }

    const segments = url.pathname
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (segments.length === 0) return null;

    if (segments[0] === 'pages' || segments[0] === 'people') {
      const numericTail = [...segments]
        .reverse()
        .find((segment) => /^\d+$/.test(segment));
      if (numericTail) return numericTail;
    }

    if (segments[0] === 'pg' && segments[1]) {
      return segments[1];
    }

    const blockedRoots = new Set([
      'share',
      'watch',
      'reel',
      'story.php',
      'photo',
      'photos',
      'videos',
      'posts',
      'permalink.php',
      'groups',
      'marketplace',
      'login',
      'dialog',
      'plugins',
    ]);

    if (blockedRoots.has(segments[0])) return null;

    return segments[0];
  }

  private parseSignedState(
    state: string,
  ):
    | { userId: string; purpose?: undefined; pageRequestId?: undefined; ts: number }
    | { userId?: undefined; purpose: 'admin_approve_page_request'; pageRequestId: number; ts: number } {
    const [payload, sig] = String(state || '').split('.');
    if (!payload || !sig) throw new BadRequestException('Invalid state');

    const expected = crypto
      .createHmac('sha256', this.stateSecret)
      .update(payload)
      .digest('hex');
    const sigOk =
      sig.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!sigOk) throw new BadRequestException('Invalid state signature');

    let decoded: any;
    try {
      decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid state payload');
    }

    const ts = Number(decoded?.ts || 0);
    if (!ts) throw new BadRequestException('Invalid state payload');
    const ageMs = Date.now() - ts;
    if (ageMs < 0 || ageMs > 15 * 60 * 1000) {
      throw new BadRequestException('OAuth state expired');
    }

    if (decoded?.purpose === 'admin_approve_page_request') {
      const pageRequestId = Number(decoded?.pageRequestId || 0);
      if (!pageRequestId) throw new BadRequestException('Invalid state payload');
      return { purpose: decoded.purpose, pageRequestId, ts };
    }

    const userId = String(decoded?.userId || '').trim();
    if (!userId) throw new BadRequestException('Invalid state payload');

    return { userId, ts };
  }

  // ── Page Access Request (client adds admin as moderator, admin approves) ──

  async submitPageRequest(
    userId: string,
    pageUrl: string,
    fbProfile?: string,
    note?: string,
  ) {
    const url = pageUrl.trim();
    const profile = (fbProfile || '').trim();
    if (!url) throw new BadRequestException('Facebook page link দিন');

    const existing = await this.prisma.pageRequest.findFirst({
      where: { userId, pageUrl: url, status: 'pending' },
    });
    if (existing) {
      return { success: true, request: existing, alreadyPending: true };
    }

    const req = await this.prisma.pageRequest.create({
      data: { userId, pageUrl: url, fbProfile: profile || null, note: note?.trim() || null },
    });
    this.logger.log(`[PageRequest] New request #${req.id} from user ${userId}: ${url}`);

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    void this.telegram.sendMessageWithButtons(
      `📄 <b>নতুন Page Request!</b> #${req.id}\n` +
      `👤 User: ${user?.name || userId} (${user?.email || ''})\n` +
      `🔗 Page URL: ${url}\n` +
      (profile ? `👤 FB Profile: ${profile}\n` : '') +
      (note ? `📝 Note: ${note}\n` : '') +
      `ℹ️ Client জানিয়েছে যে আপনাকে moderator হিসেবে add করা হয়েছে।\n` +
      `🕐 সময়: ${new Date().toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' })}`,
      [[
        { text: '🔗 Login with Facebook & Approve', url: this.getAdminApproveUrl(req.id) },
        { text: '❌ Reject', callback_data: `pagereq_reject_${req.id}` },
      ]],
    );

    return { success: true, request: req };
  }

  async getMyPageRequests(userId: string) {
    return this.prisma.pageRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Client fixes a typo in their own PENDING request (e.g. "Miss happy" →
  // "Mis Happy") so the approve flow can auto-match the page name exactly.
  async updatePageRequest(
    userId: string,
    id: number,
    body: { pageUrl?: string; fbProfile?: string; note?: string },
  ) {
    const req = await this.prisma.pageRequest.findFirst({
      where: { id, userId },
    });
    if (!req) throw new BadRequestException('Request not found');
    if (req.status !== 'pending')
      throw new BadRequestException('শুধু pending request edit করা যায়');

    const url = String(body.pageUrl ?? req.pageUrl).trim();
    if (!url) throw new BadRequestException('Facebook page link দিন');

    const updated = await this.prisma.pageRequest.update({
      where: { id: req.id },
      data: {
        pageUrl: url,
        fbProfile:
          body.fbProfile !== undefined
            ? String(body.fbProfile).trim() || null
            : req.fbProfile,
        note:
          body.note !== undefined
            ? String(body.note).trim() || null
            : req.note,
      },
    });
    this.logger.log(`[PageRequest] #${req.id} edited by user ${userId}: ${url}`);

    // Fresh notification with the approve button so the admin always has a
    // working link for the corrected request.
    void this.telegram.sendMessageWithButtons(
      `✏️ <b>Page Request Updated</b> #${req.id}\n` +
        `🔗 নতুন Page URL: ${url}\n` +
        `🕐 সময়: ${new Date().toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' })}`,
      [[
        { text: '🔗 Login with Facebook & Approve', url: this.getAdminApproveUrl(req.id) },
        { text: '❌ Reject', callback_data: `pagereq_reject_${req.id}` },
      ]],
    );

    return { success: true, request: updated };
  }

  getModeratorAccessInfo(): { fbProfileLink: string; email: string } {
    return readModeratorAccessConfig();
  }

  // Matches the pages an admin moderates/manages (returned by Facebook after
  // login) against the page the client referenced in their request.
  private matchCandidatePages(pageUrl: string, pages: FacebookPageInfo[]): FacebookPageInfo[] {
    // Common case: the admin only moderates one relevant page at that moment.
    if (pages.length === 1) return pages;

    const ref = this.parsePageReference(pageUrl);
    if (!ref) return pages; // can't parse the URL — let the admin pick manually

    if (/^\d+$/.test(ref)) {
      const byId = pages.filter((p) => p.pageId === ref);
      if (byId.length) return byId;
    }

    // URL vanity ("BurgerBhaiDhaka") vs page NAME ("Burger Bhai Dhaka") never
    // matched with a raw === compare. Normalize both (drop spaces/punctuation,
    // keep Bengali letters) before comparing, then try containment.
    const norm = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9ঀ-৿]/g, '');
    const nRef = norm(ref);
    if (nRef) {
      const exact = pages.filter((p) => norm(p.pageName) === nRef);
      if (exact.length) return exact;
      const partial = pages.filter((p) => {
        const nName = norm(p.pageName);
        return nName.includes(nRef) || nRef.includes(nName);
      });
      if (partial.length) return partial;
    }

    // No confident match — surface every page this Facebook login can manage
    // so the admin picks the right one, instead of dead-ending on an error.
    return pages;
  }

  private async finalizeApproval(
    req: { id: number; userId: string; user: { name: string | null; email: string | null } },
    matched: FacebookPageInfo,
  ): Promise<{ status: 'connected'; pageName: string }> {
    const result = await this.connectPage(req.userId, matched);

    await this.prisma.pageRequest.update({
      where: { id: req.id },
      data: { status: 'approved', connectedPageId: result.page.id },
    });

    if (req.user.email) {
      void this.mailer.sendMail(
        req.user.email,
        'আপনার Facebook Page Connect হয়েছে — FlamboyAI',
        `<p>স্বাগতম! আপনার Facebook Page <strong>${result.page.pageName}</strong> সফলভাবে FlamboyAI-এর সাথে connect হয়েছে।</p>`,
      );
    }

    void this.telegram.sendMessage(
      `✅ Page Request #${req.id} approved — <b>${result.page.pageName}</b> connected to ${req.user.name || req.userId}.`,
    );

    return { status: 'connected', pageName: result.page.pageName };
  }

  async approvePageRequestViaFacebookLogin(
    pageRequestId: number,
    pages: FacebookPageInfo[],
  ): Promise<
    | { status: 'connected'; pageName: string }
    | { status: 'no_match' }
    | { status: 'ambiguous'; resultId: string; candidates: FacebookPageInfo[]; requestedUrl?: string }
  > {
    const req = await this.prisma.pageRequest.findUnique({
      where: { id: pageRequestId },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!req) throw new BadRequestException('Page request not found');
    if (req.status !== 'pending') throw new BadRequestException(`Request already ${req.status}`);

    const matches = this.matchCandidatePages(req.pageUrl, pages);

    // Only possible when Facebook returned zero manageable pages — the admin
    // skipped page selection during login or has no access to any page.
    if (matches.length === 0) return { status: 'no_match' };
    if (matches.length === 1) return this.finalizeApproval(req, matches[0]);

    const resultId = crypto.randomUUID();
    this.pendingApprovals.set(resultId, {
      pageRequestId,
      candidates: matches,
      createdAt: Date.now(),
    });
    this.cleanupPendingApprovals();
    return { status: 'ambiguous', resultId, candidates: matches, requestedUrl: req.pageUrl };
  }

  async finalizeAmbiguousApproval(
    resultId: string,
    pageId: string,
  ): Promise<{ status: 'connected'; pageName: string }> {
    const pending = this.pendingApprovals.get(resultId);
    if (!pending) throw new BadRequestException('Approval session not found or expired');
    this.pendingApprovals.delete(resultId);

    const matched = pending.candidates.find((p) => p.pageId === pageId);
    if (!matched) throw new BadRequestException('Selected page is not part of this approval session');

    const req = await this.prisma.pageRequest.findUnique({
      where: { id: pending.pageRequestId },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!req) throw new BadRequestException('Page request not found');
    if (req.status !== 'pending') throw new BadRequestException(`Request already ${req.status}`);

    return this.finalizeApproval(req, matched);
  }

  private cleanupPendingApprovals() {
    const now = Date.now();
    for (const [key, value] of this.pendingApprovals.entries()) {
      if (now - value.createdAt > 10 * 60 * 1000) {
        this.pendingApprovals.delete(key);
      }
    }
  }
}

export interface FacebookPageInfo {
  pageId: string;
  pageName: string;
  pageToken: string;
}
