import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { AppConfig } from '@/config/configuration';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Wraps nodemailer/SMTP. Unlike Cloudinary/Stripe, an unconfigured mailer
 * does NOT block the feature that triggered it — the in-app notification
 * still gets created; email is a best-effort delivery channel on top of it.
 * Failures are logged, never thrown, so a flaky SMTP provider can't break
 * checkout/status-update/etc. request flows.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService<AppConfig, true>) {
    const smtp = config.get('smtp', { infer: true });
    this.from = smtp.from;
    this.transporter =
      smtp.host && smtp.user && smtp.pass
        ? createTransport({
            host: smtp.host,
            port: smtp.port,
            secure: smtp.port === 465,
            auth: { user: smtp.user, pass: smtp.pass },
          })
        : null;
  }

  isConfigured(): boolean {
    return this.transporter !== null;
  }

  async send(input: SendEmailInput): Promise<boolean> {
    if (!this.transporter) {
      this.logger.debug(`SMTP not configured — skipping email "${input.subject}" to ${input.to}`);
      return false;
    }
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      this.logger.error(`Failed to send email "${input.subject}" to ${input.to}: ${message}`);
      return false;
    }
  }
}
