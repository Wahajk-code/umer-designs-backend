import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes, createHash, randomUUID } from 'crypto';
import { PaymentLink, PaymentLinkStatus } from '@prisma/client';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { StripeService } from '@/modules/payments/stripe.service';
import { AppConfig } from '@/config/configuration';
import { CreatePaymentLinkDto } from '@/modules/payment-links/dto/create-payment-link.dto';
import { ListPaymentLinksQueryDto } from '@/modules/payment-links/dto/list-payment-links-query.dto';
import { DomainEvent, PaymentLinkPaidPayload } from '@/common/events/domain-events';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class PaymentLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly events: EventEmitter2,
  ) {}

  async create(
    adminUserId: string,
    dto: CreatePaymentLinkDto,
  ): Promise<{ paymentLink: PaymentLink; redeemUrl: string }> {
    const client = await this.prisma.user.findUnique({
      where: { email: dto.clientEmail.toLowerCase() },
    });

    const rawToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + dto.expiresInDays * 24 * 60 * 60 * 1000);

    const paymentLink = await this.prisma.paymentLink.create({
      data: {
        createdByAdminId: adminUserId,
        clientId: client?.id,
        clientEmail: dto.clientEmail.toLowerCase(),
        description: dto.description,
        amountCents: dto.amountCents,
        tokenHash: hashToken(rawToken),
        expiresAt,
      },
    });

    const origin = this.config.get('corsAllowedOrigin', { infer: true });
    return { paymentLink, redeemUrl: `${origin}/pay/${rawToken}` };
  }

  async listAdmin(
    query: ListPaymentLinksQueryDto,
  ): Promise<{ paymentLinks: PaymentLink[]; total: number }> {
    const where = query.status ? { status: query.status } : {};
    const [paymentLinks, total] = await this.prisma.$transaction([
      this.prisma.paymentLink.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.paymentLink.count({ where }),
    ]);
    return { paymentLinks, total };
  }

  async cancel(id: string): Promise<PaymentLink> {
    const link = await this.prisma.paymentLink.findUnique({ where: { id } });
    if (!link) {
      throw new NotFoundException('Payment link not found.');
    }
    if (link.status === PaymentLinkStatus.PAID) {
      throw new ConflictException(
        'This payment link has already been paid — it cannot be cancelled.',
      );
    }
    return this.prisma.paymentLink.update({
      where: { id },
      data: { status: PaymentLinkStatus.CANCELLED },
    });
  }

  /**
   * The only step a raw token unlocks: validate it server-side (hash match,
   * OPEN, not expired) and hand back a Checkout session for the *stored*
   * amount — never a client-supplied one.
   */
  async redeem(rawToken: string): Promise<{ checkoutUrl: string }> {
    const link = await this.prisma.paymentLink.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (!link) {
      throw new NotFoundException('This payment link is invalid.');
    }
    if (link.status === PaymentLinkStatus.PAID) {
      throw new ConflictException('This payment link has already been paid.');
    }
    if (link.status === PaymentLinkStatus.CANCELLED) {
      throw new ConflictException('This payment link has been cancelled.');
    }
    if (link.expiresAt.getTime() < Date.now()) {
      await this.prisma.paymentLink.update({
        where: { id: link.id },
        data: { status: PaymentLinkStatus.EXPIRED },
      });
      throw new ConflictException('This payment link has expired.');
    }

    const origin = this.config.get('corsAllowedOrigin', { infer: true });
    const session = await this.stripe.createCheckoutSession({
      amountCents: link.amountCents,
      productName: link.description,
      customerEmail: link.clientEmail,
      successUrl: `${origin}/pay/${rawToken}?paid=1`,
      cancelUrl: `${origin}/pay/${rawToken}?cancelled=1`,
      metadata: { kind: 'payment_link', recordId: link.id },
      idempotencyKey: `payment-link-${link.id}-${randomUUID()}`,
    });

    await this.prisma.paymentLink.update({
      where: { id: link.id },
      data: { stripeCheckoutSessionId: session.id },
    });

    if (!session.url) {
      throw new ConflictException('Stripe did not return a checkout URL.');
    }
    return { checkoutUrl: session.url };
  }

  /** Called only via the internal webhook-forward route once WebhooksService has confirmed this event is new. */
  async handleCheckoutCompleted(paymentLinkId: string): Promise<void> {
    const link = await this.prisma.paymentLink.findUnique({ where: { id: paymentLinkId } });
    if (!link || link.status === PaymentLinkStatus.PAID) {
      return;
    }

    await this.prisma.paymentLink.update({
      where: { id: paymentLinkId },
      data: { status: PaymentLinkStatus.PAID, paidAt: new Date() },
    });

    const payload: PaymentLinkPaidPayload = {
      paymentLinkId: link.id,
      clientId: link.clientId ?? undefined,
      clientEmail: link.clientEmail,
      description: link.description,
      amountCents: link.amountCents,
    };
    this.events.emit(DomainEvent.PAYMENT_LINK_PAID, payload);
  }

  /** Public preview shown on the redemption page — no sensitive internals, just enough to confirm intent. */
  async getPublicPreview(rawToken: string): Promise<{
    description: string;
    amountCents: number;
    status: PaymentLinkStatus;
    expiresAt: Date;
  }> {
    const link = await this.prisma.paymentLink.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (!link) {
      throw new NotFoundException('This payment link is invalid.');
    }
    return {
      description: link.description,
      amountCents: link.amountCents,
      status: link.status,
      expiresAt: link.expiresAt,
    };
  }
}
