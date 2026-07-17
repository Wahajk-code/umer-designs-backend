import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderStatus } from '@prisma/client';
import { OrdersService } from '@/modules/orders/orders.service';
import { StripeService } from '@/modules/payments/stripe.service';
import { CloudinaryService } from '@/modules/cloudinary/cloudinary.service';
import { AppConfig } from '@/config/configuration';
import { DomainEvent } from '@/common/events/domain-events';

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: {
    design: { findUnique: jest.Mock };
    order: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    designFile: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let stripe: jest.Mocked<Pick<StripeService, 'createCheckoutSession'>>;
  let cloudinary: jest.Mocked<Pick<CloudinaryService, 'createSignedDownloadUrl'>>;
  let events: jest.Mocked<Pick<EventEmitter2, 'emit'>>;
  let config: ConfigService<AppConfig, true>;

  const design = {
    id: 'design-1',
    title: 'The Meridian',
    slug: 'the-meridian',
    status: 'PUBLISHED',
    basePriceCents: 145000,
  };

  beforeEach(() => {
    prisma = {
      design: { findUnique: jest.fn() },
      order: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      designFile: { findFirst: jest.fn() },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };
    stripe = {
      createCheckoutSession: jest
        .fn()
        .mockResolvedValue({ id: 'cs_test_1', url: 'https://checkout.stripe.com/cs_test_1' }),
    };
    cloudinary = {
      createSignedDownloadUrl: jest.fn().mockReturnValue('https://res.cloudinary.com/signed'),
    };
    events = { emit: jest.fn() };
    config = { get: () => 'https://umerdesigns.example' } as unknown as ConfigService<
      AppConfig,
      true
    >;

    service = new OrdersService(
      prisma as any,
      stripe as any,
      cloudinary as any,
      config,
      events as any,
    );
  });

  describe('createCheckoutSession', () => {
    it('throws 404 for a design that does not exist', async () => {
      prisma.design.findUnique.mockResolvedValue(null);
      await expect(
        service.createCheckoutSession('u1', 'a@example.com', 'design-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 for a design that is not PUBLISHED (does not leak drafts)', async () => {
      prisma.design.findUnique.mockResolvedValue({ ...design, status: 'DRAFT' });
      await expect(
        service.createCheckoutSession('u1', 'a@example.com', 'design-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a second purchase of a design the user already owns', async () => {
      prisma.design.findUnique.mockResolvedValue(design);
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1', status: OrderStatus.PAID });
      await expect(
        service.createCheckoutSession('u1', 'a@example.com', 'design-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('creates a new order + Stripe session on first purchase attempt', async () => {
      prisma.design.findUnique.mockResolvedValue(design);
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.order.create.mockResolvedValue({ id: 'order-1' });

      const result = await service.createCheckoutSession('u1', 'a@example.com', 'design-1');

      expect(prisma.order.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          designId: 'design-1',
          amountCents: 145000,
          status: OrderStatus.PENDING,
        },
      });
      expect(stripe.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { kind: 'design_order', recordId: 'order-1' } }),
      );
      expect(result.checkoutUrl).toBe('https://checkout.stripe.com/cs_test_1');
    });

    it('reuses the same order row for a retried PENDING purchase (no duplicate order rows)', async () => {
      prisma.design.findUnique.mockResolvedValue(design);
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1', status: OrderStatus.PENDING });

      await service.createCheckoutSession('u1', 'a@example.com', 'design-1');

      expect(prisma.order.create).not.toHaveBeenCalled();
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { stripeCheckoutSessionId: 'cs_test_1' },
      });
    });
  });

  describe('handleCheckoutCompleted', () => {
    it('marks the order paid and emits ORDER_PAID exactly once', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        userId: 'u1',
        designId: 'design-1',
        amountCents: 145000,
        status: OrderStatus.PENDING,
        design: { title: 'The Meridian' },
      });

      await service.handleCheckoutCompleted('order-1', 'pi_123');

      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: expect.objectContaining({
          status: OrderStatus.PAID,
          stripePaymentIntentId: 'pi_123',
        }),
      });
      expect(events.emit).toHaveBeenCalledWith(
        DomainEvent.ORDER_PAID,
        expect.objectContaining({ orderId: 'order-1', userId: 'u1' }),
      );
    });

    it('is a no-op for an order that is already PAID (idempotent)', async () => {
      prisma.order.findUnique.mockResolvedValue({ id: 'order-1', status: OrderStatus.PAID });
      await service.handleCheckoutCompleted('order-1', 'pi_123');
      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('is a no-op for an unknown order id (defensive, does not throw)', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.handleCheckoutCompleted('missing', 'pi_123')).resolves.toBeUndefined();
    });
  });

  describe('getSignedDownloadUrl', () => {
    it('rejects a download for an order that does not belong to the user', async () => {
      prisma.order.findUnique.mockResolvedValue({ id: 'order-1', userId: 'someone-else' });
      await expect(service.getSignedDownloadUrl('u1', 'order-1', 'file-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects a download for an unpaid order', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        userId: 'u1',
        status: OrderStatus.PENDING,
      });
      await expect(service.getSignedDownloadUrl('u1', 'order-1', 'file-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns a signed url for a paid order the user owns', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        userId: 'u1',
        designId: 'design-1',
        status: OrderStatus.PAID,
      });
      prisma.designFile.findFirst.mockResolvedValue({
        id: 'file-1',
        cloudinaryPublicId: 'designs/design-1/plan',
        resourceType: 'raw',
        format: 'pdf',
      });

      const result = await service.getSignedDownloadUrl('u1', 'order-1', 'file-1');

      expect(cloudinary.createSignedDownloadUrl).toHaveBeenCalledWith(
        'designs/design-1/plan',
        'raw',
        'pdf',
      );
      expect(result.url).toBe('https://res.cloudinary.com/signed');
    });
  });
});
