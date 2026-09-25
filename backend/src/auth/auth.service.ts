import {
  Injectable,
  Logger,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp.service';

export type AuthRole = 'admin' | 'client' | 'agent';

// ── Public user shape returned to callers ─────────────────────────────────────
export interface PublicUser {
  id: string;
  username: string;
  email: string | undefined;
  name: string;
  role: AuthRole;
  pageIds: number[];
  isActive: boolean;
  forcePasswordChange: boolean;
  createdAt: string;
  // Agent (reseller) fields — only meaningful when role === 'agent'
  referralCode?: string;
  commissionPercentRecharge?: number;
  commissionPercentSubscription?: number;
  referredByAgentId?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly sessionDays = 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
  ) {}

  // ── Startup: seed admin from env ─────────────────────────────────────────
  async onModuleInit() {
    await this.ensureAdminSeed();
  }

  // ── Register ──────────────────────────────────────────────────────────────
  async register(body: {
    username?: string;
    email?: string;
    phone?: string;
    password?: string;
    name?: string;
    role?: string;
    pageIds?: number[];
    isActive?: boolean;
    forcePasswordChange?: boolean;
    referralCode?: string; // client: the agent referral code they signed up under
    commissionPercentRecharge?: number; // agent creation only
    commissionPercentSubscription?: number; // agent creation only
    newAgentReferralCode?: string; // agent creation only — auto-generated if omitted
  }) {
    // Phone number can be used as username — normalize it
    const rawIdentifier = body.username || body.phone || body.email || '';
    const username = this.normalizeUsername(rawIdentifier);
    const email = body.email
      ? String(body.email).trim().toLowerCase()
      : undefined;
    const password = String(body.password || '');

    if (!username)
      throw new UnauthorizedException('Username, phone, or email is required');
    if (!password || password.length < 6)
      throw new ForbiddenException('Password must be at least 6 characters');

    // Check uniqueness
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ username }, ...(email ? [{ email }] : [])] },
    });
    if (existing)
      throw new ConflictException('এই username বা email ইতিমধ্যে registered');

    const { salt, passwordHash } = this.hashPassword(password);
    const displayName = body.name?.trim() || username;

    const role = (
      body.role === 'admin' ? 'admin' : body.role === 'agent' ? 'agent' : 'client'
    ) as AuthRole;

    // A new client who signed up via an agent's referral link gets stamped
    // with that agent's id. Invalid/unknown codes are silently ignored —
    // referral attribution should never block signup.
    let referredByAgentId: string | undefined;
    if (role === 'client' && body.referralCode?.trim()) {
      const agent = await this.prisma.user.findFirst({
        where: { referralCode: body.referralCode.trim(), role: 'agent', isActive: true },
        select: { id: true },
      });
      referredByAgentId = agent?.id;
    }

    const agentFields =
      role === 'agent'
        ? {
            referralCode: body.newAgentReferralCode ?? (await this.generateAgentReferralCode()),
            commissionPercentRecharge: body.commissionPercentRecharge ?? null,
            commissionPercentSubscription: body.commissionPercentSubscription ?? null,
          }
        : {};

    const user = await this.prisma.user.create({
      data: {
        username,
        email: email ?? null,
        name: displayName,
        role,
        isActive: body.isActive !== false,
        passwordHash,
        salt,
        forcePasswordChange: body.forcePasswordChange ?? false,
        pageIds: JSON.stringify(this.normalizePageIds(body.pageIds || [])),
        referredByAgentId: referredByAgentId ?? null,
        ...agentFields,
      },
    });

    // Auto-start 7-day trial for new client accounts
    if (role === 'client') {
      try {
        const plan = await this.prisma.plan.findFirst({
          where: { name: 'starter' },
        });
        if (plan) {
          const now = new Date();
          const trialEnd = new Date(now.getTime() + 7 * 86_400_000);
          await this.prisma.subscription.create({
            data: {
              id: crypto.randomUUID(),
              userId: user.id,
              planId: plan.id,
              status: 'trial',
              periodStart: now,
              periodEnd: new Date(now.getTime() + 30 * 86_400_000),
              ordersLimit: plan.ordersLimit,
              trialEndsAt: trialEnd,
              nextPaymentDue: trialEnd,
            },
          });
          this.logger.log(`[Auth] 7-day trial started for user ${user.id}`);
        }
      } catch (e: any) {
        this.logger.warn(
          `[Auth] Could not create trial subscription: ${e.message}`,
        );
      }
    }

    return await this.publicUser(user);
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  async login(body: {
    username?: string;
    identifier?: string;
    email?: string;
    password?: string;
  }) {
    const identifier = this.normalizeLoginIdentifier(body);
    const password = String(body.password || '');

    const user = await this.findByIdentifier(identifier);
    if (!user) throw new UnauthorizedException('Invalid username or password');
    if (!user.isActive) throw new ForbiddenException('Account is inactive');
    if (!this.verifyPassword(password, user.salt, user.passwordHash))
      throw new UnauthorizedException('Invalid username or password');

    const { token, expires } = await this.createSession(user);

    return {
      token,
      user: await this.publicUser(user),
      expiresAt: expires.toISOString(),
      mustChangePassword: user.forcePasswordChange,
    };
  }

  // ── Session minting — shared by password login and Google login ───────────
  private async createSession(user: { id: string; role: string }) {
    // Clean expired sessions for this user
    await this.prisma.session.deleteMany({
      where: { userId: user.id, expiresAt: { lt: new Date() } },
    });

    // Enforce max 10 active sessions per user — delete oldest if exceeded
    const sessions = await this.prisma.session.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    if (sessions.length >= 10) {
      const toDelete = sessions.slice(0, sessions.length - 9).map((s) => s.id);
      await this.prisma.session.deleteMany({ where: { id: { in: toDelete } } });
    }

    const now = new Date();
    const expires = new Date(now.getTime() + this.sessionDays * 86_400_000);
    const token = crypto.randomBytes(32).toString('hex');

    await this.prisma.session.create({
      data: {
        id: crypto.randomUUID(),
        token,
        userId: user.id,
        role: user.role,
        expiresAt: expires,
      },
    });

    return { token, expires };
  }

  // ── Me ────────────────────────────────────────────────────────────────────
  async me(token: string) {
    const session = await this.getValidSession(token);
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
    });
    if (!user) throw new UnauthorizedException('User not found');
    return await this.publicUser(user);
  }

  // ── Logout ────────────────────────────────────────────────────────────────
  async logout(token: string) {
    await this.prisma.session.deleteMany({ where: { token } });
    return { success: true };
  }

  // ── Get auth user by token (used by AuthGuard) ────────────────────────────
  async getAuthUserByToken(token: string): Promise<PublicUser> {
    const session = await this.getValidSession(token);
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
    });
    if (!user) throw new UnauthorizedException('User not found');
    if (!user.isActive) throw new ForbiddenException('Account is inactive');
    return await this.publicUser(user);
  }

  // ── Page access check ─────────────────────────────────────────────────────
  // Deliberately kept synchronous: agents are scoped via the same pageIds
  // array as clients (computed once, in publicUser(), from their referred
  // clients' pages), so no extra async lookup is needed here.
  ensurePageAccess(user: PublicUser, pageId: number) {
    if (user.role === 'admin') return true;
    if (!user.pageIds.includes(pageId))
      throw new ForbiddenException('This page is not assigned to your account');
    return true;
  }

  async addPageToUser(userId: string, pageId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const pageIds = this.normalizePageIds(this.parsePageIds(user.pageIds));
    if (!pageIds.includes(pageId)) {
      pageIds.push(pageId);
      await this.prisma.user.update({
        where: { id: userId },
        data: { pageIds: JSON.stringify(pageIds) },
      });
    }
    return { success: true };
  }

  async removePageFromUser(userId: string, pageId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const pageIds = this.normalizePageIds(
      this.parsePageIds(user.pageIds),
    ).filter((id) => id !== pageId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { pageIds: JSON.stringify(pageIds) },
    });
    return { success: true };
  }

  // ── Change password ───────────────────────────────────────────────────────
  async changePassword(
    userId: string,
    body: { currentPassword?: string; newPassword?: string },
  ) {
    const current = String(body.currentPassword || '');
    const next = String(body.newPassword || '');
    if (!next || next.length < 8)
      throw new ForbiddenException(
        'New password must be at least 8 characters',
      );

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (!this.verifyPassword(current, user.salt, user.passwordHash))
      throw new UnauthorizedException('Current password is incorrect');

    const { salt, passwordHash } = this.hashPassword(next);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        salt,
        passwordHash,
        forcePasswordChange: false,
        updatedAt: new Date(),
      },
    });
    return { success: true, message: 'Password changed successfully' };
  }

  // ── Admin: reset password ─────────────────────────────────────────────────
  async adminResetPassword(userId: string, newPassword: string) {
    if (!newPassword || String(newPassword).length < 8)
      throw new ForbiddenException('Password must be at least 8 characters');

    const { salt, passwordHash } = this.hashPassword(String(newPassword));
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        salt,
        passwordHash,
        forcePasswordChange: true,
        updatedAt: new Date(),
      },
    });
    // Invalidate all sessions for this user
    await this.prisma.session.deleteMany({ where: { userId } });
    return { success: true, message: 'Password reset successfully' };
  }

  // ── Admin: impersonate (log in as) a client ───────────────────────────────
  // Mints a real, short-lived session for the target user so the admin can
  // enter that user's account and see everything exactly as they would.
  // Admins can never be impersonated (no privilege escalation).
  async adminImpersonate(targetUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'admin')
      throw new ForbiddenException('Cannot impersonate an admin account');

    // Short-lived impersonation session (1 day) — separate from the user's
    // own 30-day login sessions, so revoking it never touches the real user.
    const now = new Date();
    const expires = new Date(now.getTime() + 86_400_000);
    const token = crypto.randomBytes(32).toString('hex');
    await this.prisma.session.create({
      data: {
        id: crypto.randomUUID(),
        token,
        userId: user.id,
        role: user.role,
        expiresAt: expires,
      },
    });
    this.logger.warn(
      `[IMPERSONATE] admin logged in as user ${user.id} (${user.username})`,
    );

    return {
      token,
      expiresAt: expires.toISOString(),
      user: await this.publicUser(user),
    };
  }

  // ── Admin: list users ─────────────────────────────────────────────────────
  async adminListUsers(): Promise<PublicUser[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(users.map((u) => this.publicUser(u)));
  }

  // ── Admin: update user ────────────────────────────────────────────────────
  async adminUpdateUser(
    userId: string,
    body: {
      name?: string;
      isActive?: boolean;
      role?: string;
      pageIds?: number[];
      forcePasswordChange?: boolean;
    },
  ) {
    const data: any = { updatedAt: new Date() };
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    if (body.role !== undefined)
      // Only reachable via the @Roles('admin')-guarded admin routes, so an
      // admin explicitly assigning 'agent' here is trusted.
      data.role =
        body.role === 'admin' ? 'admin' : body.role === 'agent' ? 'agent' : 'client';
    if (body.pageIds !== undefined)
      data.pageIds = JSON.stringify(this.normalizePageIds(body.pageIds));
    if (body.forcePasswordChange !== undefined)
      data.forcePasswordChange = Boolean(body.forcePasswordChange);

    const user = await this.prisma.user.update({ where: { id: userId }, data });
    return await this.publicUser(user);
  }

  // ── Admin: delete user ────────────────────────────────────────────────────
  async adminDeleteUser(userId: string) {
    await this.prisma.session.deleteMany({ where: { userId } });
    await this.prisma.user.delete({ where: { id: userId } });
    return { success: true };
  }

  // ── Migration helper: import from JSON file ───────────────────────────────
  async migrateFromJsonFile(
    usersFilePath: string,
  ): Promise<{ imported: number; skipped: number }> {
    const fs = require('fs');
    if (!fs.existsSync(usersFilePath)) return { imported: 0, skipped: 0 };

    let raw: any[] = [];
    try {
      raw = JSON.parse(fs.readFileSync(usersFilePath, 'utf8'));
    } catch {
      return { imported: 0, skipped: 0 };
    }

    let imported = 0,
      skipped = 0;
    for (const u of raw) {
      const username = this.normalizeUsername(
        u.username || u.email || `user_${u.id}`,
      );
      const existing = await this.prisma.user.findFirst({
        where: { OR: [{ username }, ...(u.email ? [{ email: u.email }] : [])] },
      });
      if (existing) {
        skipped++;
        continue;
      }

      await this.prisma.user.create({
        data: {
          id: u.id || crypto.randomUUID(),
          username,
          email: u.email ?? null,
          name: u.name || username,
          role: u.role || 'client',
          isActive: u.isActive !== false,
          passwordHash: u.passwordHash || '',
          salt: u.salt || '',
          forcePasswordChange: u.forcePasswordChange ?? false,
          pageIds: JSON.stringify(Array.isArray(u.pageIds) ? u.pageIds : []),
          createdAt: u.createdAt ? new Date(u.createdAt) : new Date(),
        },
      });
      imported++;
    }
    this.logger.log(
      `[Auth Migration] Imported ${imported}, skipped ${skipped}`,
    );
    return { imported, skipped };
  }

  // ── OTP: send signup verification ────────────────────────────────────────
  async sendSignupOtp(email: string): Promise<{ message: string }> {
    const norm = email.trim().toLowerCase();
    if (!norm.includes('@')) throw new ForbiddenException('Valid email দিন');
    const existing = await this.prisma.user.findFirst({
      where: { email: norm },
    });
    if (existing)
      throw new ConflictException('এই email দিয়ে ইতিমধ্যে account আছে');
    await this.otp.sendOtp(norm, 'signup');
    return { message: 'OTP পাঠানো হয়েছে' };
  }

  // ── OTP: verify signup OTP + create account ───────────────────────────────
  async verifySignupOtp(body: {
    email: string;
    code: string;
    name: string;
    username?: string;
    password: string;
    referralCode?: string;
  }): Promise<PublicUser> {
    const email = body.email.trim().toLowerCase();
    const valid = await this.otp.verifyOtp(email, body.code, 'signup');
    if (!valid) throw new UnauthorizedException('OTP ভুল অথবা মেয়াদ শেষ');
    const username = body.username?.trim() || email;
    return this.register({
      email,
      username,
      password: body.password,
      name: username,
      role: 'client',
      isActive: true,
      referralCode: body.referralCode,
    });
  }

  // ── OTP: send forgot-password OTP ─────────────────────────────────────────
  async sendResetOtp(email: string): Promise<{ message: string }> {
    const norm = email.trim().toLowerCase();
    if (!norm.includes('@')) throw new ForbiddenException('Valid email দিন');
    const user = await this.prisma.user.findFirst({ where: { email: norm } });
    if (!user) throw new NotFoundException('এই email দিয়ে কোনো account নেই');
    await this.otp.sendOtp(norm, 'reset');
    return { message: 'OTP পাঠানো হয়েছে' };
  }

  // ── OTP: reset password via OTP ───────────────────────────────────────────
  async resetPasswordByOtp(body: {
    email: string;
    code: string;
    newPassword: string;
  }): Promise<{ message: string }> {
    const email = body.email.trim().toLowerCase();
    if (!body.newPassword || body.newPassword.length < 6)
      throw new ForbiddenException('Password কমপক্ষে ৬ character হতে হবে');

    const valid = await this.otp.verifyOtp(email, body.code, 'reset');
    if (!valid) throw new UnauthorizedException('OTP ভুল অথবা মেয়াদ শেষ');

    const user = await this.prisma.user.findFirst({ where: { email } });
    if (!user) throw new NotFoundException('User not found');

    const { salt, passwordHash } = this.hashPassword(body.newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        salt,
        passwordHash,
        forcePasswordChange: false,
        updatedAt: new Date(),
      },
    });
    // Invalidate all existing sessions
    await this.prisma.session.deleteMany({ where: { userId: user.id } });
    return { message: 'Password reset সফল হয়েছে' };
  }

  // ── Google OAuth login ──────────────────────────────────────────────────────
  private readonly googleClientId = process.env.GOOGLE_CLIENT_ID || '';
  private readonly googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  private readonly googleRedirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    'http://localhost:3000/auth/google/callback';
  private readonly googleStateSecret =
    process.env.GOOGLE_OAUTH_STATE_SECRET ||
    this.googleClientSecret ||
    'dfbot_google_state_secret';
  private readonly pendingGoogleLogins = new Map<
    string,
    { token: string; user: PublicUser; createdAt: number }
  >();

  getGoogleOAuthUrl(): string {
    if (!this.googleClientId)
      throw new ForbiddenException('GOOGLE_CLIENT_ID not configured');
    const payload = Buffer.from(JSON.stringify({ ts: Date.now() })).toString(
      'base64url',
    );
    const sig = crypto
      .createHmac('sha256', this.googleStateSecret)
      .update(payload)
      .digest('hex');
    const state = `${payload}.${sig}`;
    const scope = encodeURIComponent('openid email profile');
    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${this.googleClientId}&redirect_uri=${encodeURIComponent(this.googleRedirectUri)}&response_type=code&scope=${scope}&state=${encodeURIComponent(state)}&prompt=select_account`;
  }

  private verifyGoogleState(state: string) {
    const [payload, sig] = String(state || '').split('.');
    if (!payload || !sig) throw new ForbiddenException('Invalid OAuth state');
    const expectedSig = crypto
      .createHmac('sha256', this.googleStateSecret)
      .update(payload)
      .digest('hex');
    if (
      sig.length !== expectedSig.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))
    ) {
      throw new ForbiddenException('Invalid OAuth state signature');
    }
    const { ts } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (Date.now() - ts > 15 * 60 * 1000) {
      throw new ForbiddenException('OAuth state expired, please try again');
    }
  }

  async handleGoogleCallback(
    code: string,
    state: string,
  ): Promise<{ resultId: string }> {
    if (!code) throw new ForbiddenException('Missing OAuth code');
    this.verifyGoogleState(state);

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.googleClientId,
        client_secret: this.googleClientSecret,
        redirect_uri: this.googleRedirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      this.logger.error(`[GoogleAuth] Token exchange failed: ${await tokenRes.text()}`);
      throw new ForbiddenException('Google authentication failed');
    }
    const tokenData: any = await tokenRes.json();

    const profileRes = await fetch(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
    );
    if (!profileRes.ok)
      throw new ForbiddenException('Could not fetch Google profile');
    const profile: any = await profileRes.json();

    const user = await this.findOrCreateGoogleUser({
      googleId: profile.sub,
      email: String(profile.email || '').toLowerCase(),
      name: profile.name || profile.email,
    });

    const { token } = await this.createSession(user);
    const resultId = crypto.randomUUID();
    this.pendingGoogleLogins.set(resultId, {
      token,
      user: await this.publicUser(user),
      createdAt: Date.now(),
    });
    this.cleanupPendingGoogleLogins();
    return { resultId };
  }

  getFrontendBaseUrl() {
    const dashboardUrl = String(process.env.DASHBOARD_URL || '').trim();
    if (dashboardUrl) return dashboardUrl.replace(/\/+$/, '');
    const landingUrl = String(process.env.LANDING_PAGE_URL || '').trim();
    if (landingUrl) return landingUrl.replace(/\/+$/, '');
    const storageUrl = String(process.env.STORAGE_PUBLIC_URL || '').trim();
    if (storageUrl)
      return storageUrl.replace(/\/storage\/?$/, '').replace(/\/+$/, '');
    return 'http://localhost:5173';
  }

  consumeGoogleLoginResult(id: string) {
    const item = this.pendingGoogleLogins.get(id);
    if (!item)
      throw new NotFoundException('Login result not found or expired');
    this.pendingGoogleLogins.delete(id);
    return { token: item.token, user: item.user };
  }

  private cleanupPendingGoogleLogins() {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [id, item] of this.pendingGoogleLogins) {
      if (item.createdAt < cutoff) this.pendingGoogleLogins.delete(id);
    }
  }

  private async findOrCreateGoogleUser(profile: {
    googleId: string;
    email: string;
    name: string;
  }) {
    const byGoogleId = await this.prisma.user.findUnique({
      where: { googleId: profile.googleId },
    });
    if (byGoogleId) return byGoogleId;

    if (profile.email) {
      const byEmail = await this.prisma.user.findFirst({
        where: { email: profile.email },
      });
      if (byEmail) {
        return this.prisma.user.update({
          where: { id: byEmail.id },
          data: { googleId: profile.googleId },
        });
      }
    }

    // New account — random unusable password, user always signs in via Google
    const randomPassword = crypto.randomBytes(24).toString('hex');
    const created = await this.register({
      username: profile.email || `google_${profile.googleId}`,
      email: profile.email || undefined,
      password: randomPassword,
      name: profile.name,
      role: 'client',
      isActive: true,
    });
    return this.prisma.user.update({
      where: { id: created.id },
      data: { googleId: profile.googleId },
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async getValidSession(token: string) {
    if (!token) throw new UnauthorizedException('Missing token');
    // Single DB query — no file I/O, no race condition
    const session = await this.prisma.session.findUnique({
      where: { token },
    });
    if (!session) throw new UnauthorizedException('Invalid or expired token');
    if (session.expiresAt < new Date()) {
      // Lazy cleanup — delete expired session
      await this.prisma.session.delete({ where: { token } }).catch(() => {});
      throw new UnauthorizedException('Session expired — please log in again');
    }
    return session;
  }

  private async findByIdentifier(identifier: string) {
    return this.prisma.user.findFirst({
      where: {
        OR: [{ username: identifier }, { email: identifier }],
      },
    });
  }

  private async ensureAdminSeed() {
    const adminEmail = String(process.env.AUTH_ADMIN_EMAIL || '')
      .trim()
      .toLowerCase();
    const adminUsername = this.normalizeUsername(
      process.env.AUTH_ADMIN_USERNAME || adminEmail || 'admin',
    );
    const adminPassword = String(process.env.AUTH_ADMIN_PASSWORD || '').trim();
    if (!adminUsername || !adminPassword) return;

    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: adminUsername },
          ...(adminEmail ? [{ email: adminEmail }] : []),
        ],
      },
    });
    if (existing) return;

    const { salt, passwordHash } = this.hashPassword(adminPassword);
    await this.prisma.user.create({
      data: {
        username: adminUsername,
        email: adminEmail || null,
        name: 'Admin',
        role: 'admin',
        isActive: true,
        passwordHash,
        salt,
        forcePasswordChange: false,
        pageIds: '[]',
      },
    });
    this.logger.log(`[Auth] Admin user "${adminUsername}" created from env`);
  }

  async publicUser(user: any): Promise<PublicUser> {
    // Agents aren't scoped via the pageIds column (that's a client-only
    // concept) — instead their accessible pages are computed on the fly from
    // whichever clients signed up via their referral link, so the existing
    // ensurePageAccess()/pageIds-based checks throughout the app work for
    // agents automatically with no changes to those call sites.
    const pageIds =
      user.role === 'agent'
        ? await this.getAgentPageIds(user.id)
        : this.parsePageIds(user.pageIds);

    return {
      id: user.id,
      username: user.username,
      email: user.email ?? undefined,
      name: user.name || user.username,
      role: user.role as AuthRole,
      pageIds,
      isActive: user.isActive,
      forcePasswordChange: Boolean(user.forcePasswordChange),
      createdAt:
        user.createdAt instanceof Date
          ? user.createdAt.toISOString()
          : String(user.createdAt),
      referralCode: user.referralCode ?? undefined,
      commissionPercentRecharge: user.commissionPercentRecharge ?? undefined,
      commissionPercentSubscription:
        user.commissionPercentSubscription ?? undefined,
      referredByAgentId: user.referredByAgentId ?? undefined,
    };
  }

  private async getAgentPageIds(agentId: string): Promise<number[]> {
    const pages = await this.prisma.page.findMany({
      where: { owner: { referredByAgentId: agentId } },
      select: { id: true },
    });
    return pages.map((p) => p.id);
  }

  private async generateAgentReferralCode(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = crypto.randomBytes(4).toString('hex');
      const existing = await this.prisma.user.findUnique({
        where: { referralCode: code },
        select: { id: true },
      });
      if (!existing) return code;
    }
    throw new Error('Could not generate a unique agent referral code');
  }

  private hashPassword(password: string) {
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return { salt, passwordHash };
  }

  private verifyPassword(
    password: string,
    salt: string,
    hash: string,
  ): boolean {
    if (!salt || !hash) return false;
    try {
      const derived = crypto.scryptSync(password, salt, 64).toString('hex');
      return crypto.timingSafeEqual(Buffer.from(derived), Buffer.from(hash));
    } catch {
      return false;
    }
  }

  private normalizeUsername(value: any) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');
  }

  private normalizeLoginIdentifier(body: {
    username?: string;
    identifier?: string;
    email?: string;
  }) {
    const raw = body.username || body.identifier || body.email || '';
    const n = String(raw).trim().toLowerCase().replace(/\s+/g, '');
    if (!n) throw new UnauthorizedException('username is required');
    return n;
  }

  private normalizePageIds(input: Array<number | string>) {
    return [
      ...new Set(
        input
          .map((v) => Number(v))
          .filter((n) => Number.isFinite(n) && n > 0)
          .map((n) => Math.floor(n)),
      ),
    ];
  }

  private parsePageIds(raw: string): number[] {
    try {
      return JSON.parse(raw || '[]');
    } catch (err) {
      this.logger.error(`[Auth] Malformed pageIds JSON in DB — defaulting to []. Value: ${raw?.slice(0, 100)} Error: ${err}`);
      return [];
    }
  }
}
