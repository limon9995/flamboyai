import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from '../common/api-keys.service';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeysService: ApiKeysService,
  ) {}

  // Resend sends over HTTPS (port 443) — unlike SMTP, this works even when
  // the VPS provider blocks outbound SMTP ports (a common default block).
  private async sendViaResend(to: string, subject: string, html: string) {
    const apiKey = this.apiKeysService.getSync('resendApiKey');
    const from = this.apiKeysService.getSync('resendFromEmail') || 'FlamboyAI <onboarding@resend.dev>';
    if (!apiKey) throw new Error('RESEND_API_KEY not configured');

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Resend API ${res.status}: ${errText.slice(0, 200)}`);
    }
  }

  /** Generate and send a 6-digit OTP to the given email. */
  async sendOtp(email: string, purpose: 'signup' | 'reset'): Promise<void> {
    // Link to the hosted logo instead of embedding it as base64 — inlining the
    // ~420KB logo pushed the email past Gmail's ~102KB clipping threshold,
    // causing Gmail to hide the body behind "View entire message".
    const storageBase = (this.apiKeysService.getSync('storagePublicUrl') || 'https://api.flamboyai.com/storage').replace(/\/+$/, '');
    const logoUrl = `${storageBase}/logo.png`;

    const code = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Atomically remove old OTPs and insert the new one
    await this.prisma.$transaction([
      this.prisma.otpToken.deleteMany({ where: { email, purpose } }),
      this.prisma.otpToken.create({
        data: { id: crypto.randomUUID(), email, code, purpose, expiresAt },
      }),
    ]);

    const isSignup = purpose === 'signup';
    const subject = isSignup
      ? 'FlamboyAI — Email Verification OTP'
      : 'FlamboyAI — Password Reset OTP';
    const html = `
    <div style="background:#f1f0fb;padding:32px 16px;font-family:'Segoe UI',Arial,sans-serif">
      <div style="max-width:460px;margin:0 auto;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 32px rgba(79,70,229,0.12)">

        <!-- Top accent bar -->
        <div style="height:6px;background:linear-gradient(90deg,#4f46e5,#7c3aed,#ec4899)"></div>

        <div style="padding:36px 32px 32px">
          <div style="text-align:center;margin-bottom:24px">
            <img src="${logoUrl}" width="64" height="64" alt="FlamboyAI" style="width:64px;height:64px;object-fit:cover;border-radius:16px;box-shadow:0 4px 14px rgba(79,70,229,0.25)" />
            <div style="margin-top:12px;font-size:19px;font-weight:800;color:#1e1b2e;letter-spacing:-0.02em">FlamboyAI</div>
          </div>

          <div style="text-align:center;margin-bottom:8px;font-size:15px;font-weight:700;color:#1e1b2e">
            ${isSignup ? 'আপনার Email Verify করুন' : 'Password Reset করুন'}
          </div>
          <p style="text-align:center;color:#6b6478;font-size:13.5px;line-height:1.7;margin:0 0 26px">
            ${
              isSignup
                ? 'FlamboyAI account verify করতে নিচের কোডটি ব্যবহার করুন।'
                : 'আপনার account-এর password reset করতে নিচের কোডটি ব্যবহার করুন।'
            }
          </p>

          <div style="background:linear-gradient(135deg,#f5f3ff,#fdf2f8);border:1.5px solid #ddd6fe;border-radius:16px;padding:26px 16px;text-align:center;margin-bottom:22px">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;color:#8b7ba8;text-transform:uppercase;margin-bottom:10px">Verification Code</div>
            <div style="font-size:32px;font-weight:900;letter-spacing:6px;color:#4f46e5;font-family:'Courier New',monospace;white-space:nowrap">${code}</div>
          </div>

          <div style="text-align:center;margin-bottom:24px">
            <span style="display:inline-block;background:#fff7ed;color:#c2410c;font-size:12px;font-weight:700;padding:6px 14px;border-radius:100px;border:1px solid #fed7aa">⏱ ১০ মিনিটের জন্য valid</span>
          </div>

          <p style="color:#9691a8;font-size:12px;line-height:1.7;text-align:center;margin:0">
            এই কোড কাউকে শেয়ার করবেন না — FlamboyAI কখনো email/message-এ কোড চাইবে না।<br>
            আপনি যদি এই request না করে থাকেন, এই email ignore করুন।
          </p>
        </div>

        <div style="background:#faf9fd;padding:18px 32px;text-align:center;border-top:1px solid #f0edf7">
          <div style="font-size:11px;color:#b3aec4">FlamboyAI — Commerce Automation for Facebook Sellers</div>
        </div>
      </div>
    </div>
      `;
    await this.sendViaResend(email, subject, html);

    this.logger.log(`[OTP] Sent ${purpose} OTP to ${email}`);
  }

  /** Verify the OTP code. Returns true and marks it used if valid. */
  async verifyOtp(
    email: string,
    code: string,
    purpose: 'signup' | 'reset',
  ): Promise<boolean> {
    const token = await this.prisma.otpToken.findFirst({
      where: {
        email,
        code,
        purpose,
        used: false,
        expiresAt: { gt: new Date() },
      },
    });
    if (!token) return false;

    await this.prisma.otpToken.update({
      where: { id: token.id },
      data: { used: true },
    });
    return true;
  }
}
