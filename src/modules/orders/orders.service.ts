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
  ): Promise<{ checkoutUrl: string | null }> {
    const [design, user] = await Promise.all([
      this.prisma.design.findUnique({ where: { id: designId } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ]);
    if (!design || design.status !== 'PUBLISHED') {
      throw new NotFoundException('Design not found.');
    }

    let order = await this.prisma.order.findFirst({ where: { userId, designId } });

    if (order?.status === OrderStatus.PAID) {
      throw new ConflictException('You already own this design.');
    }

    // Recomputed fresh on every attempt against the user's *current* balance —
    // never trust a stale reservation from an earlier, abandoned checkout.
    const creditToApply = Math.min(user.creditBalanceCents, design.basePriceCents);
    const amountDue = design.basePriceCents - creditToApply;

    if (!order) {
      order = await this.prisma.order.create({
        data: {
          userId,
          designId,
          amountCents: amountDue,
          creditAppliedCents: creditToApply,
          status: OrderStatus.PENDING,
        },
      });
    } else {
      order = await this.prisma.order.update({
        where: { id: order.id },
        data: { amountCents: amountDue, creditAppliedCents: creditToApply },
      });
    }

    // Fully covered by credit balance — no Stripe session needed at all. The
    // actual balance deduction happens here too (not just a reservation)
    // since there's no webhook to wait for; this *is* the confirmed payment.
    if (amountDue === 0) {
      await this.markPaidWithCredit(order.id, userId, creditToApply);
      return { checkoutUrl: null };
    }

    const origin = this.config.get('corsAllowedOrigin', { infer: true });
    const session = await this.stripe.createCheckoutSession({
      lineItems: [{ name: design.title, amountCents: amountDue }],
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

  /**
   * Cart checkout: one Stripe Checkout Session pays for several designs at
   * once. Credit is applied greedily in cart order (first item absorbs
   * balance first) — simple and deterministic, good enough at this scale.
   */
  async createCartCheckoutSession(
    userId: string,
    userEmail: string,
    designIds: string[],
  ): Promise<{ checkoutUrl: string | null }> {
    const uniqueIds = Array.from(new Set(designIds));
    if (uniqueIds.length === 0) {
      throw new ConflictException('Your cart is empty.');
    }

    const [designs, user] = await Promise.all([
      this.prisma.design.findMany({ where: { id: { in: uniqueIds }, status: 'PUBLISHED' } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ]);
    if (designs.length !== uniqueIds.length) {
      throw new NotFoundException('One or more designs in your cart could not be found.');
    }

    const alreadyOwned = await this.prisma.order.findMany({
      where: { userId, designId: { in: uniqueIds }, status: OrderStatus.PAID },
    });
    if (alreadyOwned.length > 0) {
      throw new ConflictException('You already own one or more of these designs.');
    }

    let remainingCredit = user.creditBalanceCents;
    const plans = designs.map((design) => {
      const creditApplied = Math.min(remainingCredit, design.basePriceCents);
      remainingCredit -= creditApplied;
      return { design, creditApplied, amountDue: design.basePriceCents - creditApplied };
    });

    const orders: Order[] = [];
    for (const plan of plans) {
      const existing = await this.prisma.order.findFirst({
        where: { userId, designId: plan.design.id },
      });
      const order = existing
        ? await this.prisma.order.update({
            where: { id: existing.id },
            data: { amountCents: plan.amountDue, creditAppliedCents: plan.creditApplied },
          })
        : await this.prisma.order.create({
            data: {
              userId,
              designId: plan.design.id,
              amountCents: plan.amountDue,
              creditAppliedCents: plan.creditApplied,
              status: OrderStatus.PENDING,
            },
          });
      orders.push(order);
    }

    const totalDue = plans.reduce((sum, p) => sum + p.amountDue, 0);

    if (totalDue === 0) {
      for (const order of orders) {
        const plan = plans.find((p) => p.design.id === order.designId)!;
        await this.markPaidWithCredit(order.id, userId, plan.creditApplied);
      }
      return { checkoutUrl: null };
    }

    const origin = this.config.get('corsAllowedOrigin', { infer: true });
    const session = await this.stripe.createCheckoutSession({
      lineItems: plans
        .filter((p) => p.amountDue > 0)
        .map((p) => ({ name: p.design.title, amountCents: p.amountDue })),
      customerEmail: userEmail,
      successUrl: `${origin}/dashboard?purchased=1`,
      cancelUrl: `${origin}/designs?checkout=cancelled`,
      metadata: { kind: 'cart_order', recordIds: orders.map((o) => o.id).join(',') },
      idempotencyKey: `cart-order-${userId}-${randomUUID()}`,
    });

    await this.prisma.order.updateMany({
      where: { id: { in: orders.map((o) => o.id) } },
      data: { stripeCheckoutSessionId: session.id },
    });

    if (!session.url) {
      throw new ConflictException('Stripe did not return a checkout URL.');
    }
    return { checkoutUrl: session.url };
  }

  private async markPaidWithCredit(
    orderId: string,
    userId: string,
    creditAppliedCents: number,
  ): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { design: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.PAID, paidAt: new Date() },
      });
      // Clamp at 0 rather than trusting the reserved amount blindly — guards
      // against a rare double-spend race (two concurrent checkouts both
      // reserving against the same balance before either settles).
      const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const actualDeduction = Math.min(creditAppliedCents, current.creditBalanceCents);
      await tx.user.update({
        where: { id: userId },
        data: { creditBalanceCents: { decrement: actualDeduction } },
      });
    });

    const payload: OrderPaidPayload = {
      orderId: order.id,
      userId: order.userId,
      designId: order.designId,
      designTitle: order.design.title,
      amountCents: order.design.basePriceCents,
    };
    this.events.emit(DomainEvent.ORDER_PAID, payload);
  }

  /** Called only via the internal webhook-forward route — idempotency is enforced one level up by WebhooksService. */
  async handleCheckoutCompleted(
    orderId: string,
    stripePaymentIntentId: string | undefined,
  ): Promise<void> {
    await this.settleOrder(orderId, stripePaymentIntentId);
  }

  /** Cart checkouts share one payment-intent across several orders; settle each independently. */
  async handleCartCheckoutCompleted(
    orderIds: string[],
    stripePaymentIntentId: string | undefined,
  ): Promise<void> {
    for (const orderId of orderIds) {
      await this.settleOrder(orderId, stripePaymentIntentId);
    }
  }

  private async settleOrder(
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

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.PAID, stripePaymentIntentId, paidAt: new Date() },
      });
      if (order.creditAppliedCents > 0) {
        // Only deducted now, on confirmed payment — never at session
        // creation, so an abandoned checkout never costs the user credit.
        const current = await tx.user.findUniqueOrThrow({ where: { id: order.userId } });
        const actualDeduction = Math.min(order.creditAppliedCents, current.creditBalanceCents);
        await tx.user.update({
          where: { id: order.userId },
          data: { creditBalanceCents: { decrement: actualDeduction } },
        });
      }
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
