import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PaymentLinkStatus } from '@prisma/client';
import { PaymentLinksService } from '@/modules/payment-links/payment-links.service';
import { StripeService } from '@/modules/payments/stripe.service';
import { AppConfig } from '@/config/configuration';
import { DomainEvent } from '@/common/events/domain-events';

describe('PaymentLinksService', () => {
  let service: PaymentLinksService;
  let prisma: {
    user: { findUnique: jest.Mock };
    paymentLink: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let stripe: jest.Mocked<Pick<StripeService, 'createCheckoutSession'>>;
  let events: jest.Mocked<Pick<EventEmitter2, 'emit'>>;
  let config: ConfigService<AppConfig, true>;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn() },
      paymentLink: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };
    stripe = {
      createCheckoutSession: jest
        .fn()
        .mockResolvedValue({ id: 'cs_pl_1', url: 'https://checkout.stripe.com/cs_pl_1' }),
    };
    events = { emit: jest.fn() };
    config = { get: () => 'https://umerdesigns.example' } as unknown as ConfigService<
      AppConfig,
      true
    >;

    service = new PaymentLinksService(prisma as any, stripe as any, config, events as any);
  });

  describe('create', () => {
    it('links an existing user by email when one exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'client-1' });
      prisma.paymentLink.create.mockImplementation(async (args) => ({
        id: 'link-1',
        ...args.data,
      }));

      const result = await service.create('admin-1', {
        clientEmail: 'client@example.com',
        description: 'Custom quote',
        amountCents: 78000,
        expiresInDays: 7,
      });

      expect(prisma.paymentLink.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ clientId: 'client-1' }) }),
      );
      expect(result.redeemUrl).toMatch(/^https:\/\/umerdesigns\.example\/pay\/[0-9a-f]{64}$/);
    });

    it('leaves clientId unset when no account matches the email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.paymentLink.create.mockImplementation(async (args) => ({
        id: 'link-1',
        ...args.data,
      }));

      await service.create('admin-1', {
        clientEmail: 'nobody@example.com',
        description: 'Custom quote',
        amountCents: 78000,
        expiresInDays: 7,
      });

      expect(prisma.paymentLink.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ clientId: undefined }) }),
      );
    });

    it('never stores the raw token, only its hash', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.paymentLink.create.mockImplementation(async (args) => ({
        id: 'link-1',
        ...args.data,
      }));

      const result = await service.create('admin-1', {
        clientEmail: 'nobody@example.com',
        description: 'Custom quote',
        amountCents: 78000,
        expiresInDays: 7,
      });

      const rawToken = result.redeemUrl.split('/pay/')[1];
      const storedData = prisma.paymentLink.create.mock.calls[0][0].data;
      expect(storedData.tokenHash).not.toBe(rawToken);
      expect(storedData.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('redeem', () => {
    it('throws 404 for a token that does not match any link', async () => {
      prisma.paymentLink.findUnique.mockResolvedValue(null);
      await expect(service.redeem('bogus-token')).rejects.toThrow(NotFoundException);
    });

    it('rejects an already-paid link', async () => {
      prisma.paymentLink.findUnique.mockResolvedValue({
        id: 'link-1',
        status: PaymentLinkStatus.PAID,
        expiresAt: new Date(Date.now() + 100000),
      });
      await expect(service.redeem('token')).rejects.toThrow(ConflictException);
    });

    it('rejects a cancelled link', async () => {
      prisma.paymentLink.findUnique.mockResolvedValue({
        id: 'link-1',
        status: PaymentLinkStatus.CANCELLED,
        expiresAt: new Date(Date.now() + 100000),
      });
      await expect(service.redeem('token')).rejects.toThrow(ConflictException);
    });

    it('rejects and marks EXPIRED a link past its expiry', async () => {
      prisma.paymentLink.findUnique.mockResolvedValue({
        id: 'link-1',
        status: PaymentLinkStatus.OPEN,
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.redeem('token')).rejects.toThrow(ConflictException);
      expect(prisma.paymentLink.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: { status: PaymentLinkStatus.EXPIRED },
      });
    });

    it('creates a Stripe session for the stored amount, never a client-supplied one', async () => {
      prisma.paymentLink.findUnique.mockResolvedValue({
        id: 'link-1',
        status: PaymentLinkStatus.OPEN,
        expiresAt: new Date(Date.now() + 100000),
        amountCents: 78000,
        description: 'Custom quote',
        clientEmail: 'client@example.com',
      });

      const result = await service.redeem('token');

      expect(stripe.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          amountCents: 78000,
          metadata: { kind: 'payment_link', recordId: 'link-1' },
        }),
      );
      expect(result.checkoutUrl).toBe('https://checkout.stripe.com/cs_pl_1');
    });
  });

  describe('handleCheckoutCompleted', () => {
    it('marks the link PAID and emits PAYMENT_LINK_PAID', async () => {
      prisma.paymentLink.findUnique.mockResolvedValue({
        id: 'link-1',
        status: PaymentLinkStatus.OPEN,
        clientId: 'client-1',
        clientEmail: 'client@example.com',
        description: 'Custom quote',
        amountCents: 78000,
      });

      await service.handleCheckoutCompleted('link-1');

      expect(prisma.paymentLink.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: expect.objectContaining({ status: PaymentLinkStatus.PAID }),
      });
      expect(events.emit).toHaveBeenCalledWith(
        DomainEvent.PAYMENT_LINK_PAID,
        expect.objectContaining({ paymentLinkId: 'link-1', clientId: 'client-1' }),
      );
    });

    it('is idempotent for an already-paid link', async () => {
      prisma.paymentLink.findUnique.mockResolvedValue({
        id: 'link-1',
        status: PaymentLinkStatus.PAID,
      });
      await service.handleCheckoutCompleted('link-1');
      expect(prisma.paymentLink.update).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('rejects cancelling an already-paid link', async () => {
      prisma.paymentLink.findUnique.mockResolvedValue({
        id: 'link-1',
        status: PaymentLinkStatus.PAID,
      });
      await expect(service.cancel('link-1')).rejects.toThrow(ConflictException);
    });

    it('cancels an open link', async () => {
      prisma.paymentLink.findUnique.mockResolvedValue({
        id: 'link-1',
        status: PaymentLinkStatus.OPEN,
      });
      prisma.paymentLink.update.mockResolvedValue({
        id: 'link-1',
        status: PaymentLinkStatus.CANCELLED,
      });
      const result = await service.cancel('link-1');
      expect(result.status).toBe(PaymentLinkStatus.CANCELLED);
    });
  });
});
