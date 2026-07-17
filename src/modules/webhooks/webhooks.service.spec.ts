import { Prisma } from '@prisma/client';
import { WebhooksService } from '@/modules/webhooks/webhooks.service';
import { OrdersService } from '@/modules/orders/orders.service';
import { ModificationsService } from '@/modules/modifications/modifications.service';
import { PaymentLinksService } from '@/modules/payment-links/payment-links.service';

function duplicateKeyError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: '5.0.0',
  });
}

describe('WebhooksService', () => {
  let service: WebhooksService;
  let prisma: { processedStripeEvent: { create: jest.Mock } };
  let ordersService: jest.Mocked<Pick<OrdersService, 'handleCheckoutCompleted'>>;
  let modificationsService: jest.Mocked<Pick<ModificationsService, 'handleCheckoutCompleted'>>;
  let paymentLinksService: jest.Mocked<Pick<PaymentLinksService, 'handleCheckoutCompleted'>>;

  beforeEach(() => {
    prisma = { processedStripeEvent: { create: jest.fn() } };
    ordersService = { handleCheckoutCompleted: jest.fn().mockResolvedValue(undefined) };
    modificationsService = { handleCheckoutCompleted: jest.fn().mockResolvedValue(undefined) };
    paymentLinksService = { handleCheckoutCompleted: jest.fn().mockResolvedValue(undefined) };
    service = new WebhooksService(
      prisma as any,
      ordersService as any,
      modificationsService as any,
      paymentLinksService as any,
    );
  });

  it('routes a checkout.session.completed design_order event to OrdersService', async () => {
    prisma.processedStripeEvent.create.mockResolvedValue({});

    await service.processStripeEvent({
      eventId: 'evt_1',
      eventType: 'checkout.session.completed',
      paymentIntentId: 'pi_1',
      metadata: { kind: 'design_order', recordId: 'order-1' },
    });

    expect(ordersService.handleCheckoutCompleted).toHaveBeenCalledWith('order-1', 'pi_1');
  });

  it('routes a checkout.session.completed modification event to ModificationsService', async () => {
    prisma.processedStripeEvent.create.mockResolvedValue({});
    const metadata = { kind: 'modification', userId: 'u1', designId: 'd1' };

    await service.processStripeEvent({
      eventId: 'evt_mod_1',
      eventType: 'checkout.session.completed',
      paymentIntentId: 'pi_mod_1',
      metadata,
    });

    expect(modificationsService.handleCheckoutCompleted).toHaveBeenCalledWith(metadata, 'pi_mod_1');
  });

  it('routes a checkout.session.completed payment_link event to PaymentLinksService', async () => {
    prisma.processedStripeEvent.create.mockResolvedValue({});

    await service.processStripeEvent({
      eventId: 'evt_pl_1',
      eventType: 'checkout.session.completed',
      paymentIntentId: 'pi_pl_1',
      metadata: { kind: 'payment_link', recordId: 'link-1' },
    });

    expect(paymentLinksService.handleCheckoutCompleted).toHaveBeenCalledWith('link-1');
  });

  it('is idempotent: a duplicate event id is skipped without reprocessing', async () => {
    prisma.processedStripeEvent.create.mockRejectedValue(duplicateKeyError());

    await service.processStripeEvent({
      eventId: 'evt_1',
      eventType: 'checkout.session.completed',
      metadata: { kind: 'design_order', recordId: 'order-1' },
    });

    expect(ordersService.handleCheckoutCompleted).not.toHaveBeenCalled();
  });

  it('ignores event types it does not handle', async () => {
    prisma.processedStripeEvent.create.mockResolvedValue({});
    await service.processStripeEvent({ eventId: 'evt_2', eventType: 'payment_intent.created' });
    expect(ordersService.handleCheckoutCompleted).not.toHaveBeenCalled();
  });

  it('ignores checkout.session.completed with no routable metadata', async () => {
    prisma.processedStripeEvent.create.mockResolvedValue({});
    await service.processStripeEvent({ eventId: 'evt_3', eventType: 'checkout.session.completed' });
    expect(ordersService.handleCheckoutCompleted).not.toHaveBeenCalled();
  });

  it('re-throws unexpected database errors instead of silently swallowing them', async () => {
    prisma.processedStripeEvent.create.mockRejectedValue(new Error('connection lost'));
    await expect(
      service.processStripeEvent({ eventId: 'evt_4', eventType: 'checkout.session.completed' }),
    ).rejects.toThrow('connection lost');
  });
});
