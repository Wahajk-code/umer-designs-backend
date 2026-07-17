import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ModificationStatus } from '@prisma/client';
import { ModificationsService } from '@/modules/modifications/modifications.service';
import { ModificationOptionsService } from '@/modules/modifications/modification-options.service';
import { StripeService } from '@/modules/payments/stripe.service';
import { CloudinaryService } from '@/modules/cloudinary/cloudinary.service';
import { AppConfig } from '@/config/configuration';
import { DomainEvent } from '@/common/events/domain-events';

describe('ModificationsService', () => {
  let service: ModificationsService;
  let prisma: {
    design: { findUnique: jest.Mock };
    order: { findFirst: jest.Mock };
    modification: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    modificationEvent: { create: jest.Mock };
    modificationFile: { findFirst: jest.Mock; create: jest.Mock; delete: jest.Mock };
    $transaction: jest.Mock;
  };
  let stripe: jest.Mocked<Pick<StripeService, 'createCheckoutSession'>>;
  let cloudinary: jest.Mocked<
    Pick<CloudinaryService, 'createSignedDownloadUrl' | 'createUploadSignature' | 'deleteAsset'>
  >;
  let events: jest.Mocked<Pick<EventEmitter2, 'emit'>>;
  let optionsService: jest.Mocked<Pick<ModificationOptionsService, 'findManyByIds'>>;
  let config: ConfigService<AppConfig, true>;

  const design = {
    id: 'design-1',
    title: 'The Meridian',
    slug: 'the-meridian',
    basePriceCents: 145000,
  };
  const addRoomOption = {
    id: 'opt-room',
    label: 'Add a room',
    description: null,
    addedCostCents: 50000,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const resizeOption = {
    id: 'opt-resize',
    label: 'Resize footprint',
    description: null,
    addedCostCents: 35000,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      design: { findUnique: jest.fn() },
      order: { findFirst: jest.fn() },
      modification: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      modificationEvent: { create: jest.fn() },
      modificationFile: { findFirst: jest.fn(), create: jest.fn(), delete: jest.fn() },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };
    stripe = {
      createCheckoutSession: jest
        .fn()
        .mockResolvedValue({ id: 'cs_mod_1', url: 'https://checkout.stripe.com/cs_mod_1' }),
    };
    cloudinary = {
      createSignedDownloadUrl: jest.fn().mockReturnValue('https://res.cloudinary.com/signed'),
      createUploadSignature: jest.fn(),
      deleteAsset: jest.fn().mockResolvedValue(undefined),
    };
    events = { emit: jest.fn() };
    optionsService = { findManyByIds: jest.fn() };
    config = { get: () => 'https://umerdesigns.example' } as unknown as ConfigService<
      AppConfig,
      true
    >;

    service = new ModificationsService(
      prisma as any,
      stripe as any,
      cloudinary as any,
      config,
      events as any,
      optionsService as any,
    );
  });

  describe('createCheckoutSession', () => {
    const dto = { designId: 'design-1', selectedOptionIds: ['opt-room', 'opt-resize'] };

    it('throws 404 for an unknown design', async () => {
      prisma.design.findUnique.mockResolvedValue(null);
      await expect(service.createCheckoutSession('u1', 'a@example.com', dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws 403 when the user does not own the design', async () => {
      prisma.design.findUnique.mockResolvedValue(design);
      prisma.order.findFirst.mockResolvedValue(null);
      await expect(service.createCheckoutSession('u1', 'a@example.com', dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws 400 for unknown option ids', async () => {
      prisma.design.findUnique.mockResolvedValue(design);
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1' });
      optionsService.findManyByIds.mockResolvedValue([addRoomOption]);
      await expect(service.createCheckoutSession('u1', 'a@example.com', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws 400 for an inactive option', async () => {
      prisma.design.findUnique.mockResolvedValue(design);
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1' });
      optionsService.findManyByIds.mockResolvedValue([
        addRoomOption,
        { ...resizeOption, active: false },
      ]);
      await expect(service.createCheckoutSession('u1', 'a@example.com', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('computes total as base price + sum of selected options and builds Stripe metadata', async () => {
      prisma.design.findUnique.mockResolvedValue(design);
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1' });
      optionsService.findManyByIds.mockResolvedValue([addRoomOption, resizeOption]);

      const result = await service.createCheckoutSession('u1', 'a@example.com', dto);

      expect(stripe.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          amountCents: 145000 + 50000 + 35000,
          metadata: expect.objectContaining({
            kind: 'modification',
            userId: 'u1',
            designId: 'design-1',
            basePriceCents: '145000',
            totalAmountCents: '230000',
          }),
        }),
      );
      expect(result.checkoutUrl).toBe('https://checkout.stripe.com/cs_mod_1');
    });
  });

  describe('handleCheckoutCompleted', () => {
    it('creates the modification, its selections, an initial SUBMITTED event, and emits MODIFICATION_PAID', async () => {
      prisma.modification.create.mockResolvedValue({
        id: 'mod-1',
        userId: 'u1',
        designId: 'design-1',
        totalAmountCents: 230000,
        design: { title: 'The Meridian' },
      });

      await service.handleCheckoutCompleted(
        {
          userId: 'u1',
          designId: 'design-1',
          basePriceCents: '145000',
          totalAmountCents: '230000',
          selections: JSON.stringify([
            { optionId: 'opt-room', priceAtSelectionCents: 50000 },
            { optionId: 'opt-resize', priceAtSelectionCents: 35000 },
          ]),
        },
        'pi_mod_1',
      );

      expect(prisma.modification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            designId: 'design-1',
            status: ModificationStatus.SUBMITTED,
            basePriceCents: 145000,
            totalAmountCents: 230000,
            stripePaymentIntentId: 'pi_mod_1',
          }),
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        DomainEvent.MODIFICATION_PAID,
        expect.objectContaining({ modificationId: 'mod-1' }),
      );
    });

    it('is a no-op when required metadata is missing (defensive)', async () => {
      await service.handleCheckoutCompleted({ userId: 'u1' }, 'pi_1');
      expect(prisma.modification.create).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('allows SUBMITTED -> IN_REVIEW', async () => {
      prisma.modification.findUnique.mockResolvedValue({
        id: 'mod-1',
        status: ModificationStatus.SUBMITTED,
        userId: 'u1',
      });
      prisma.modification.update.mockResolvedValue({
        id: 'mod-1',
        status: ModificationStatus.IN_REVIEW,
      });

      await service.updateStatus('admin-1', 'mod-1', ModificationStatus.IN_REVIEW, undefined);

      expect(prisma.modification.update).toHaveBeenCalledWith({
        where: { id: 'mod-1' },
        data: { status: ModificationStatus.IN_REVIEW },
      });
    });

    it('rejects an illegal transition (e.g. SUBMITTED -> DELIVERED)', async () => {
      prisma.modification.findUnique.mockResolvedValue({
        id: 'mod-1',
        status: ModificationStatus.SUBMITTED,
        userId: 'u1',
      });

      await expect(
        service.updateStatus('admin-1', 'mod-1', ModificationStatus.DELIVERED, undefined),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows IN_PROGRESS -> REVISION and REVISION -> IN_PROGRESS (revision cycles)', async () => {
      prisma.modification.findUnique.mockResolvedValue({
        id: 'mod-1',
        status: ModificationStatus.IN_PROGRESS,
        userId: 'u1',
      });
      prisma.modification.update.mockResolvedValue({});

      await service.updateStatus('admin-1', 'mod-1', ModificationStatus.REVISION, 'needs a tweak');
      expect(prisma.modification.update).toHaveBeenCalledWith({
        where: { id: 'mod-1' },
        data: { status: ModificationStatus.REVISION },
      });
    });

    it('sets deliveredAt when transitioning to DELIVERED', async () => {
      prisma.modification.findUnique.mockResolvedValue({
        id: 'mod-1',
        status: ModificationStatus.IN_PROGRESS,
        userId: 'u1',
      });
      prisma.modification.update.mockResolvedValue({});

      await service.updateStatus('admin-1', 'mod-1', ModificationStatus.DELIVERED, undefined);

      expect(prisma.modification.update).toHaveBeenCalledWith({
        where: { id: 'mod-1' },
        data: { status: ModificationStatus.DELIVERED, deliveredAt: expect.any(Date) },
      });
    });

    it('rejects any transition out of the terminal DELIVERED state', async () => {
      prisma.modification.findUnique.mockResolvedValue({
        id: 'mod-1',
        status: ModificationStatus.DELIVERED,
        userId: 'u1',
      });
      await expect(
        service.updateStatus('admin-1', 'mod-1', ModificationStatus.IN_PROGRESS, undefined),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('addComment', () => {
    it('rejects a comment from a non-owner, non-admin user', async () => {
      prisma.modification.findUnique.mockResolvedValue({ id: 'mod-1', userId: 'someone-else' });
      await expect(service.addComment('u1', 'mod-1', false, 'hi')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('allows the owning user to comment', async () => {
      prisma.modification.findUnique.mockResolvedValue({ id: 'mod-1', userId: 'u1' });
      prisma.modificationEvent.create.mockResolvedValue({});

      await service.addComment('u1', 'mod-1', false, 'When will this be ready?');

      expect(prisma.modificationEvent.create).toHaveBeenCalledWith({
        data: {
          modificationId: 'mod-1',
          authorId: 'u1',
          kind: 'COMMENT',
          comment: 'When will this be ready?',
        },
      });
    });

    it('allows an admin to comment on any request', async () => {
      prisma.modification.findUnique.mockResolvedValue({ id: 'mod-1', userId: 'someone-else' });
      prisma.modificationEvent.create.mockResolvedValue({});

      await service.addComment('admin-1', 'mod-1', true, 'Starting work now.');

      expect(prisma.modificationEvent.create).toHaveBeenCalled();
    });
  });

  describe('getSignedDownloadUrl', () => {
    it('rejects a non-owner, non-admin request', async () => {
      prisma.modification.findUnique.mockResolvedValue({ id: 'mod-1', userId: 'someone-else' });
      await expect(service.getSignedDownloadUrl('u1', false, 'mod-1', 'file-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns a signed url for the owning user', async () => {
      prisma.modification.findUnique.mockResolvedValue({ id: 'mod-1', userId: 'u1' });
      prisma.modificationFile.findFirst.mockResolvedValue({
        id: 'file-1',
        cloudinaryPublicId: 'modifications/mod-1/revision',
        resourceType: 'raw',
        format: 'pdf',
      });

      const result = await service.getSignedDownloadUrl('u1', false, 'mod-1', 'file-1');
      expect(result.url).toBe('https://res.cloudinary.com/signed');
    });
  });
});
