import { ConfigService } from '@nestjs/config';
import { MailService } from '@/modules/mail/mail.service';
import { AppConfig } from '@/config/configuration';

function makeConfig(smtp: Partial<AppConfig['smtp']>): ConfigService<AppConfig, true> {
  return {
    get: (key: string) => {
      if (key === 'smtp') {
        return { host: '', port: 587, user: '', pass: '', from: 'test@example.com', ...smtp };
      }
      throw new Error(`unexpected key ${key}`);
    },
  } as unknown as ConfigService<AppConfig, true>;
}

describe('MailService', () => {
  it('reports not configured when SMTP credentials are missing', () => {
    const service = new MailService(makeConfig({}));
    expect(service.isConfigured()).toBe(false);
  });

  it('reports configured when host/user/pass are all present', () => {
    const service = new MailService(
      makeConfig({ host: 'smtp.example.com', user: 'user', pass: 'pass' }),
    );
    expect(service.isConfigured()).toBe(true);
  });

  it('send() resolves false (not throws) when unconfigured, so callers never crash on a missing SMTP setup', async () => {
    const service = new MailService(makeConfig({}));
    const result = await service.send({
      to: 'a@example.com',
      subject: 'Test',
      html: '<p>hi</p>',
      text: 'hi',
    });
    expect(result).toBe(false);
  });
});
