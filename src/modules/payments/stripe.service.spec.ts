import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StripeService } from '@/modules/payments/stripe.service';
import { AppConfig } from '@/config/configuration';

function makeConfig(secretKey: string): ConfigService<AppConfig, true> {
  return {
    get: (key: string) => {
      if (key === 'stripe') return { secretKey };
      throw new Error(`unexpected key ${key}`);
    },
  } as unknown as ConfigService<AppConfig, true>;
}

describe('StripeService', () => {
  it('reports not configured with no secret key', () => {
    const service = new StripeService(makeConfig(''));
    expect(service.isConfigured()).toBe(false);
  });

  it('reports configured with a secret key', () => {
    const service = new StripeService(makeConfig('sk_test_123'));
    expect(service.isConfigured()).toBe(true);
  });

  it('throws a clear 503 (not a crash) creating a checkout session without a key', async () => {
    const service = new StripeService(makeConfig(''));
    await expect(
      service.createCheckoutSession({
        amountCents: 1000,
        productName: 'Test',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        customerEmail: 'a@example.com',
        metadata: {},
        idempotencyKey: 'key-1',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
