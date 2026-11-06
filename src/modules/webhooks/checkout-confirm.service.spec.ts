import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CheckoutConfirmService } from '@/modules/webhooks/checkout-confirm.service';

describe('CheckoutConfirmService', () => {
  let stripe: { retrieveSession: jest.Mock };
  let webhooks: { processStripeEvent: jest.Mock };
  let localConfirm: boolean;
  let service: CheckoutConfirmService;

  const paidSession = {
    id: 'cs_test_abc',
    livemode: false,
    payment_status: 'paid',
    payment_intent: 'pi_test_1',
    metadata: { kind: 'design_order', recordId: 'order-1' },
  };

  beforeEach(() => {
    localConfirm = true;
    stripe = { retrieveSession: jest.fn().mockResolvedValue(paidSession) };
    webhooks = { processStripeEvent: jest.fn().mockResolvedValue({ received: true }) };
    const config = { get: jest.fn(() => ({ localConfirm })) };
    service = new CheckoutConfirmService(stripe as any, webhooks as any, config as any);
  });

  it('settles a genuinely paid test session through the normal webhook path', async () => {
    await expect(service.confirm('cs_test_abc')).resolves.toEqual({ confirmed: true });
    expect(webhooks.processStripeEvent).toHaveBeenCalledWith({
      eventId: 'local_confirm_cs_test_abc',
      eventType: 'checkout.session.completed',
      checkoutSessionId: 'cs_test_abc',
      paymentIntentId: 'pi_test_1',
      metadata: { kind: 'design_order', recordId: 'order-1' },
    });
  });

  it('answers 404 and never contacts Stripe when local confirm is disabled', async () => {
    localConfirm = false;
    await expect(service.confirm('cs_test_abc')).rejects.toThrow(NotFoundException);
    expect(stripe.retrieveSession).not.toHaveBeenCalled();
    expect(webhooks.processStripeEvent).not.toHaveBeenCalled();
  });

  it('refuses a session that Stripe says is not paid (e.g. abandoned checkout)', async () => {
    stripe.retrieveSession.mockResolvedValue({ ...paidSession, payment_status: 'unpaid' });
    await expect(service.confirm('cs_test_abc')).rejects.toThrow(ConflictException);
    expect(webhooks.processStripeEvent).not.toHaveBeenCalled();
  });

  it('never confirms a live-mode session', async () => {
    stripe.retrieveSession.mockResolvedValue({ ...paidSession, livemode: true });
    await expect(service.confirm('cs_test_abc')).rejects.toThrow(ForbiddenException);
    expect(webhooks.processStripeEvent).not.toHaveBeenCalled();
  });
});
