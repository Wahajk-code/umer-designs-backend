import { ConfigService } from '@nestjs/config';
import { ContactService } from '@/modules/contact/contact.service';
import { MailService } from '@/modules/mail/mail.service';
import { AppConfig } from '@/config/configuration';

describe('ContactService', () => {
  let service: ContactService;
  let mail: jest.Mocked<Pick<MailService, 'send'>>;
  let adminEmail = '';

  beforeEach(() => {
    mail = { send: jest.fn().mockResolvedValue(true) };
    adminEmail = '';
    const config = {
      get: (key: string) => {
        if (key === 'adminNotifyEmail') return adminEmail;
        throw new Error(`unexpected key ${key}`);
      },
    } as unknown as ConfigService<AppConfig, true>;
    service = new ContactService(mail as any, config);
  });

  it('does nothing when no admin notify email is configured', async () => {
    await service.submit({ name: 'Jo', email: 'jo@example.com', message: 'Hello' });
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('emails the admin with the message when configured', async () => {
    adminEmail = 'admin@umerdesigns.example';
    await service.submit({ name: 'Jo', email: 'jo@example.com', message: 'Hello there' });
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'admin@umerdesigns.example',
        subject: expect.stringContaining('Jo'),
      }),
    );
  });

  it('escapes HTML in the submitted name/message so it cannot inject markup into the admin email', async () => {
    adminEmail = 'admin@umerdesigns.example';
    await service.submit({
      name: '<img src=x onerror=alert(1)>',
      email: 'attacker@example.com',
      message: '<script>alert(1)</script>',
    });
    const call = mail.send.mock.calls[0][0];
    expect(call.html).not.toContain('<script>');
    expect(call.html).not.toContain('<img src=x');
  });
});
