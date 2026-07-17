import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { Modification, ModificationStatus, OrderStatus } from '@prisma/client';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { StripeService } from '@/modules/payments/stripe.service';
import { CloudinaryService } from '@/modules/cloudinary/cloudinary.service';
import { AppConfig } from '@/config/configuration';
import { ModificationOptionsService } from '@/modules/modifications/modification-options.service';
import { CreateModificationCheckoutDto } from '@/modules/modifications/dto/create-modification-checkout.dto';
import { CreateModificationFileDto } from '@/modules/modifications/dto/create-modification-file.dto';
import { ListModificationsQueryDto } from '@/modules/modifications/dto/list-modifications-query.dto';
import {
  DomainEvent,
  ModificationCommentAddedPayload,
  ModificationPaidPayload,
  ModificationStatusChangedPayload,
} from '@/common/events/domain-events';

const VALID_TRANSITIONS: Record<ModificationStatus, ModificationStatus[]> = {
  SUBMITTED: [ModificationStatus.IN_REVIEW],
  IN_REVIEW: [ModificationStatus.IN_PROGRESS],
  IN_PROGRESS: [ModificationStatus.REVISION, ModificationStatus.DELIVERED],
  REVISION: [ModificationStatus.IN_PROGRESS, ModificationStatus.DELIVERED],
  DELIVERED: [],
};

interface StripeSelectionMetadata {
  optionId: string;
  priceAtSelectionCents: number;
}

const modificationInclude = {
  design: true,
  selectedOptions: { include: { option: true } },
  events: { include: { author: true }, orderBy: { createdAt: 'asc' as const } },
  files: true,
};

@Injectable()
export class ModificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly cloudinary: CloudinaryService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly events: EventEmitter2,
    private readonly optionsService: ModificationOptionsService,
  ) {}

  async createCheckoutSession(
    userId: string,
    userEmail: string,
    dto: CreateModificationCheckoutDto,
  ): Promise<{ checkoutUrl: string }> {
    const design = await this.prisma.design.findUnique({ where: { id: dto.designId } });
    if (!design) {
      throw new NotFoundException('Design not found.');
    }

    const ownsDesign = await this.prisma.order.findFirst({
      where: { userId, designId: dto.designId, status: OrderStatus.PAID },
    });
    if (!ownsDesign) {
      throw new ForbiddenException('You can only request modifications on a design you own.');
    }

    const options = await this.optionsService.findManyByIds(dto.selectedOptionIds);
    const foundIds = new Set(options.map((o) => o.id));
    const missing = dto.selectedOptionIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(`Unknown modification option(s): ${missing.join(', ')}`);
    }
    const inactive = options.filter((o) => !o.active);
    if (inactive.length > 0) {
      throw new BadRequestException(
        `These options are no longer available: ${inactive.map((o) => o.label).join(', ')}`,
      );
    }

    const selections: StripeSelectionMetadata[] = options.map((o) => ({
      optionId: o.id,
      priceAtSelectionCents: o.addedCostCents,
    }));
    const optionsTotalCents = selections.reduce((sum, s) => sum + s.priceAtSelectionCents, 0);
    const totalAmountCents = design.basePriceCents + optionsTotalCents;

    const origin = this.config.get('corsAllowedOrigin', { infer: true });
    const session = await this.stripe.createCheckoutSession({
      amountCents: totalAmountCents,
      productName: `${design.title} — modification`,
      customerEmail: userEmail,
      successUrl: `${origin}/dashboard?modification=submitted`,
      cancelUrl: `${origin}/designs/${design.slug}?modification=cancelled`,
      metadata: {
        kind: 'modification',
        userId,
        designId: design.id,
        basePriceCents: String(design.basePriceCents),
        totalAmountCents: String(totalAmountCents),
        selections: JSON.stringify(selections),
      },
      idempotencyKey: `modification-${userId}-${design.id}-${randomUUID()}`,
    });

    if (!session.url) {
      throw new BadRequestException('Stripe did not return a checkout URL.');
    }
    return { checkoutUrl: session.url };
  }

  /** Called only via the internal webhook-forward route once WebhooksService has confirmed this event is new. */
  async handleCheckoutCompleted(
    metadata: Record<string, string>,
    stripePaymentIntentId: string | undefined,
  ): Promise<void> {
    const { userId, designId, basePriceCents, totalAmountCents, selections } = metadata;
    if (!userId || !designId || !basePriceCents || !totalAmountCents || !selections) {
      return;
    }

    const parsedSelections: StripeSelectionMetadata[] = JSON.parse(selections);

    const modification = await this.prisma.modification.create({
      data: {
        userId,
        designId,
        status: ModificationStatus.SUBMITTED,
        basePriceCents: Number(basePriceCents),
        totalAmountCents: Number(totalAmountCents),
        stripePaymentIntentId,
        paidAt: new Date(),
        selectedOptions: {
          create: parsedSelections.map((s) => ({
            optionId: s.optionId,
            priceAtSelectionCents: s.priceAtSelectionCents,
          })),
        },
        events: {
          create: { kind: 'STATUS_CHANGE', toStatus: ModificationStatus.SUBMITTED },
        },
      },
      include: { design: true },
    });

    const payload: ModificationPaidPayload = {
      modificationId: modification.id,
      userId: modification.userId,
      designId: modification.designId,
      designTitle: modification.design.title,
      totalAmountCents: modification.totalAmountCents,
    };
    this.events.emit(DomainEvent.MODIFICATION_PAID, payload);
  }

  listMine(userId: string) {
    return this.prisma.modification.findMany({
      where: { userId },
      include: modificationInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(userId: string, id: string, isAdmin: boolean) {
    const modification = await this.prisma.modification.findUnique({
      where: { id },
      include: modificationInclude,
    });
    if (!modification || (!isAdmin && modification.userId !== userId)) {
      throw new NotFoundException('Modification request not found.');
    }
    return modification;
  }

  async addComment(userId: string, id: string, isAdmin: boolean, comment: string) {
    const modification = await this.prisma.modification.findUnique({ where: { id } });
    if (!modification || (!isAdmin && modification.userId !== userId)) {
      throw new NotFoundException('Modification request not found.');
    }

    await this.prisma.modificationEvent.create({
      data: { modificationId: id, authorId: userId, kind: 'COMMENT', comment },
    });

    const payload: ModificationCommentAddedPayload = {
      modificationId: id,
      userId: modification.userId,
      authorId: userId,
      isAdminAuthor: isAdmin,
      comment,
    };
    this.events.emit(DomainEvent.MODIFICATION_COMMENT_ADDED, payload);

    return this.findOne(userId, id, isAdmin);
  }

  async updateStatus(
    adminUserId: string,
    id: string,
    toStatus: ModificationStatus,
    comment: string | undefined,
  ): Promise<Modification> {
    const modification = await this.prisma.modification.findUnique({ where: { id } });
    if (!modification) {
      throw new NotFoundException('Modification request not found.');
    }

    const allowed = VALID_TRANSITIONS[modification.status];
    if (!allowed.includes(toStatus)) {
      throw new BadRequestException(
        `Cannot move a request from ${modification.status} to ${toStatus}.`,
      );
    }

    const updated = await this.prisma.modification.update({
      where: { id },
      data: {
        status: toStatus,
        ...(toStatus === ModificationStatus.DELIVERED && { deliveredAt: new Date() }),
      },
    });

    await this.prisma.modificationEvent.create({
      data: {
        modificationId: id,
        authorId: adminUserId,
        kind: 'STATUS_CHANGE',
        fromStatus: modification.status,
        toStatus,
        comment,
      },
    });

    const payload: ModificationStatusChangedPayload = {
      modificationId: id,
      userId: modification.userId,
      fromStatus: modification.status,
      toStatus,
      comment,
    };
    this.events.emit(DomainEvent.MODIFICATION_STATUS_CHANGED, payload);

    return updated;
  }

  async listAdmin(query: ListModificationsQueryDto) {
    const where = query.status ? { status: query.status } : {};
    const [modifications, total] = await this.prisma.$transaction([
      this.prisma.modification.findMany({
        where,
        include: {
          design: true,
          user: { select: { email: true, firstName: true, lastName: true } },
          selectedOptions: { include: { option: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.modification.count({ where }),
    ]);
    return { modifications, total };
  }

  createUploadSignature(modificationId: string) {
    return this.cloudinary.createUploadSignature(`modifications/${modificationId}`);
  }

  async addFile(modificationId: string, dto: CreateModificationFileDto) {
    const modification = await this.prisma.modification.findUnique({
      where: { id: modificationId },
    });
    if (!modification) {
      throw new NotFoundException('Modification request not found.');
    }
    return this.prisma.modificationFile.create({
      data: {
        modificationId,
        label: dto.label,
        cloudinaryPublicId: dto.cloudinaryPublicId,
        resourceType: dto.resourceType,
        format: dto.format,
        isFinal: dto.isFinal ?? false,
      },
    });
  }

  async removeFile(modificationId: string, fileId: string): Promise<void> {
    const file = await this.prisma.modificationFile.findFirst({
      where: { id: fileId, modificationId },
    });
    if (!file) {
      throw new NotFoundException('File not found.');
    }
    await this.cloudinary
      .deleteAsset(file.cloudinaryPublicId, file.resourceType)
      .catch(() => undefined);
    await this.prisma.modificationFile.delete({ where: { id: fileId } });
  }

  async getSignedDownloadUrl(
    userId: string,
    isAdmin: boolean,
    modificationId: string,
    fileId: string,
  ): Promise<{ url: string }> {
    const modification = await this.prisma.modification.findUnique({
      where: { id: modificationId },
    });
    if (!modification || (!isAdmin && modification.userId !== userId)) {
      throw new NotFoundException('Modification request not found.');
    }

    const file = await this.prisma.modificationFile.findFirst({
      where: { id: fileId, modificationId },
    });
    if (!file) {
      throw new NotFoundException('File not found.');
    }

    const url = this.cloudinary.createSignedDownloadUrl(
      file.cloudinaryPublicId,
      file.resourceType,
      file.format,
    );
    return { url };
  }
}
