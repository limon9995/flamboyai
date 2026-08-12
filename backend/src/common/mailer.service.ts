import { Injectable, Logger } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';

// Uses the same Resend HTTP API pattern as OtpService — works even when a
// VPS provider blocks outbound SMTP ports, unlike Gmail SMTP/nodemailer.
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(private readonly apiKeysService: ApiKeysService) {}

  async sendMail(to: string, subject: string, html: string): Promise<void> {
    const apiKey = this.apiKeysService.getSync('resendApiKey');
    const from = this.apiKeysService.getSync('resendFromEmail') || 'FlamboyAI <onboarding@resend.dev>';
    if (!apiKey) {
      this.logger.warn('[Mailer] resendApiKey not configured — skipping email send');
      return;
    }

    try {
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
        this.logger.warn(`[Mailer] Resend API ${res.status}: ${errText.slice(0, 200)}`);
      }
    } catch (e) {
      this.logger.warn(`[Mailer] Send failed: ${(e as Error).message}`);
    }
  }
}
