import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '@/modules/mail/mail.service';
import { renderEmail } from '@/modules/mail/email-template';
import { AppConfig } from '@/config/configuration';
import { CreateContactMessageDto } from '@/modules/contact/dto/create-contact-message.dto';

@Injectable()
export class ContactService {
  constructor(
    private readonly mail: MailService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async submit(dto: CreateContactMessageDto): Promise<void> {
    const adminEmail = this.config.get('adminNotifyEmail', { infer: true });
    if (!adminEmail) {
      return;
    }

    const { html, text } = renderEmail({
      heading: 'New contact message',
      body: `From ${dto.name} (${dto.email}):\n\n${dto.message}`,
    });
    await this.mail.send({
      to: adminEmail,
      subject: `Contact form — ${dto.name}`,
      html,
      text,
    });
  }
}
