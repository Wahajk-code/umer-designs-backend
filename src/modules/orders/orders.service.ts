import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { Order, OrderStatus } from '@prisma/client';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { StripeService } from '@/modules/payments/stripe.service';
import { CloudinaryService } from '@/modules/cloudinary/cloudinary.service';
import { AppConfig } from '@/config/configuration';
import { DomainEvent, OrderPaidPayload } from '@/common/events/domain-events';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly cloudinary: CloudinaryService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly events: EventEmitter2,
  ) {}

  async createCheckoutSession(
    userId: string,
    userEmail: string,
    designId: string,
  ): Promise<{ checkoutUrl: string }> {
    const design = await this.prisma.design.findUnique({ where: { id: designId } });
    if (!design || design.status !== 'PUBLISHED') {
      throw new NotFoundException('Design not found.');
    }

    let order = await this.prisma.order.findFirst({ where: { userId, designId } });

    if (order?.status === OrderStatus.PAID) {
      throw new ConflictException('You already own this design.');
    }

    if (!order) {
      order = await this.prisma.order.create({
        data: { userId, designId, amountCents: design.basePriceCents, status: OrderStatus.PENDING },
      });
    }

    const origin = this.config.get('corsAllowedOrigin', { infer: true });
    const session = await this.stripe.createCheckoutSession({
      amountCents: design.basePriceCents,
      productName: design.title,
      customerEmail: userEmail,
      successUrl: `${origin}/dashboard?purchased=1`,
      cancelUrl: `${origin}/designs/${design.slug}?checkout=cancelled`,
      metadata: { kind: 'design_order', recordId: order.id },
      // Fresh key per attempt: never reuses a stale Stripe-cached response across separate checkout clicks,
      // while the single `order` row (looked up above) already prevents duplicate DB records / double ownership.
      idempotencyKey: `design-order-${order.id}-${randomUUID()}`,
    });

    await this.prisma.order.update({
      where: { id: order.id },
      data: { stripeCheckoutSessionId: session.id },
    });

    if (!session.url) {
      throw new ConflictException('Stripe did not return a checkout URL.');
    }
    return { checkoutUrl: session.url };
  }

  /** Called only via the internal webhook-forward route — idempotency is enforced one level up by WebhooksService. */
  async handleCheckoutCompleted(
    orderId: string,
    stripePaymentIntentId: string | undefined,
  ): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { design: true },
    });
    if (!order || order.status === OrderStatus.PAID) {
      return;
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.PAID, stripePaymentIntentId, paidAt: new Date() },
    });

    const payload: OrderPaidPayload = {
      orderId: order.id,
      userId: order.userId,
      designId: order.designId,
      designTitle: order.design.title,
      amountCents: order.amountCents,
    };
    this.events.emit(DomainEvent.ORDER_PAID, payload);
  }

  listMine(userId: string): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { userId },
      include: { design: { include: { files: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listAdmin(page: number, pageSize: number): Promise<{ orders: Order[]; total: number }> {
    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        include: {
          design: true,
          user: { select: { email: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count(),
    ]);
    return { orders, total };
  }

  async getSignedDownloadUrl(
    userId: string,
    orderId: string,
    fileId: string,
  ): Promise<{ url: string }> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) {
      throw new NotFoundException('Order not found.');
    }
    if (order.status !== OrderStatus.PAID) {
      throw new ForbiddenException('This order has not been paid yet.');
    }

    const file = await this.prisma.designFile.findFirst({
      where: { id: fileId, designId: order.designId },
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
