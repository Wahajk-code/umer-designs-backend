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
import { StripeService, CheckoutLineItem } from '@/modules/payments/stripe.service';
import { CloudinaryService } from '@/modules/cloudinary/cloudinary.service';
import { AppConfig } from '@/config/configuration';
import { DomainEvent, OrderPaidPayload } from '@/common/events/domain-events';
import { CartCheckoutItemDto } from '@/modules/orders/dto/create-cart-checkout-session.dto';

/** Add-on price snapshot, taken at checkout-session-creation time — never re-priced later. */
interface AddOnSelectionMeta {
  addOnId: string;
  label: string;
  priceAtSelectionCents: number;
}

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
    addOnIds: string[] = [],
  ): Promise<{ checkoutUrl: string | null }> {
    const [design, user] = await Promise.all([
      this.prisma.design.findUnique({ where: { id: designId } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ]);
    if (!design || design.status !== 'PUBLISHED') {
      throw new NotFoundException('Design not found.');
    }

    const selections = await this.resolveAddOnSelections(designId, addOnIds);
    const addOnsTotalCents = selections.reduce((sum, s) => sum + s.priceAtSelectionCents, 0);
    const totalPriceCents = design.basePriceCents + addOnsTotalCents;

    let order = await this.prisma.order.findFirst({ where: { userId, designId } });

    if (order?.status === OrderStatus.PAID) {
      throw new ConflictException('You already own this design.');
    }

    // Recomputed fresh on every attempt against the user's *current* balance —
    // never trust a stale reservation from an earlier, abandoned checkout.
    const creditToApply = Math.min(user.creditBalanceCents, totalPriceCents);
    const amountDue = totalPriceCents - creditToApply;

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
      await this.markPaidWithCredit(order.id, userId, creditToApply, totalPriceCents, selections);
      return { checkoutUrl: null };
    }

    const lineItems = this.buildLineItems(design.title, design.basePriceCents, selections, creditToApply);

    const origin = this.config.get('corsAllowedOrigin', { infer: true });
    const session = await this.stripe.createCheckoutSession({
      lineItems,
      customerEmail: userEmail,
      successUrl: `${origin}/dashboard?purchased=1`,
      cancelUrl: `${origin}/designs/${design.slug}?checkout=cancelled`,
      metadata: {
        kind: 'design_order',
        recordId: order.id,
        addOnSelections: JSON.stringify(selections),
      },
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
    items: CartCheckoutItemDto[],
  ): Promise<{ checkoutUrl: string | null }> {
    const uniqueIds = Array.from(new Set(items.map((i) => i.designId)));
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

    const designsById = new Map(designs.map((d) => [d.id, d]));
    const cartPlans = await Promise.all(
      Array.from(uniqueIds).map(async (designId) => {
        const design = designsById.get(designId)!;
        const selections = await this.resolveAddOnSelections(
          designId,
          items.find((i) => i.designId === designId)?.addOnIds ?? [],
        );
        const addOnsTotalCents = selections.reduce((sum, s) => sum + s.priceAtSelectionCents, 0);
        return { design, selections, totalPriceCents: design.basePriceCents + addOnsTotalCents };
      }),
    );

    let remainingCredit = user.creditBalanceCents;
    const plans = cartPlans.map((p) => {
      const creditApplied = Math.min(remainingCredit, p.totalPriceCents);
      remainingCredit -= creditApplied;
      return { ...p, creditApplied, amountDue: p.totalPriceCents - creditApplied };
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
        await this.markPaidWithCredit(
          order.id,
          userId,
          plan.creditApplied,
          plan.totalPriceCents,
          plan.selections,
        );
      }
      return { checkoutUrl: null };
    }

    const lineItems = plans.flatMap((p) =>
      this.buildLineItems(p.design.title, p.design.basePriceCents, p.selections, p.creditApplied),
    );

    const addOnSelectionsByOrder: Record<string, AddOnSelectionMeta[]> = {};
    for (const order of orders) {
      const plan = plans.find((p) => p.design.id === order.designId)!;
      if (plan.selections.length > 0) {
        addOnSelectionsByOrder[order.id] = plan.selections;
      }
    }

    const origin = this.config.get('corsAllowedOrigin', { infer: true });
    const session = await this.stripe.createCheckoutSession({
      lineItems,
      customerEmail: userEmail,
      successUrl: `${origin}/dashboard?purchased=1`,
      cancelUrl: `${origin}/designs?checkout=cancelled`,
      metadata: {
        kind: 'cart_order',
        recordIds: orders.map((o) => o.id).join(','),
        addOnSelectionsByOrder: JSON.stringify(addOnSelectionsByOrder),
      },
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

  /** Validates the requested add-on ids belong to this design and are active; snapshots their current price. */
  private async resolveAddOnSelections(
    designId: string,
    addOnIds: string[],
  ): Promise<AddOnSelectionMeta[]> {
    const uniqueIds = Array.from(new Set(addOnIds));
    if (uniqueIds.length === 0) {
      return [];
    }

    const addOns = await this.prisma.designAddOn.findMany({
      where: { id: { in: uniqueIds }, designId },
    });
    const foundIds = new Set(addOns.map((a) => a.id));
    const missing = uniqueIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(`Unknown add-on(s) for this design: ${missing.join(', ')}`);
    }
    const inactive = addOns.filter((a) => !a.active);
    if (inactive.length > 0) {
      throw new ConflictException(
        `These add-ons are no longer available: ${inactive.map((a) => a.label).join(', ')}`,
      );
    }

    return addOns.map((a) => ({
      addOnId: a.id,
      label: a.label,
      priceAtSelectionCents: a.addedCostCents,
    }));
  }

  /** Applies credit to the base plan first, then to add-ons in order; drops any resulting zero-amount line items. */
  private buildLineItems(
    designTitle: string,
    basePriceCents: number,
    selections: AddOnSelectionMeta[],
    creditToApply: number,
  ): CheckoutLineItem[] {
    let remainingCredit = creditToApply;
    const items: CheckoutLineItem[] = [];

    const baseCreditApplied = Math.min(remainingCredit, basePriceCents);
    remainingCredit -= baseCreditApplied;
    const baseAmountDue = basePriceCents - baseCreditApplied;
    if (baseAmountDue > 0) {
      items.push({ name: designTitle, amountCents: baseAmountDue });
    }

    for (const selection of selections) {
      const creditApplied = Math.min(remainingCredit, selection.priceAtSelectionCents);
      remainingCredit -= creditApplied;
      const amountDue = selection.priceAtSelectionCents - creditApplied;
      if (amountDue > 0) {
        items.push({ name: `${designTitle} — ${selection.label}`, amountCents: amountDue });
      }
    }

    return items;
  }

  private async markPaidWithCredit(
    orderId: string,
    userId: string,
    creditAppliedCents: number,
    totalPriceCents: number,
    selections: AddOnSelectionMeta[] = [],
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
      if (selections.length > 0) {
        await tx.orderSelectedAddOn.createMany({
          data: selections.map((s) => ({
            orderId,
            addOnId: s.addOnId,
            priceAtSelectionCents: s.priceAtSelectionCents,
          })),
          skipDuplicates: true,
        });
      }
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
      amountCents: totalPriceCents,
    };
    this.events.emit(DomainEvent.ORDER_PAID, payload);
  }

  /** Called only via the internal webhook-forward route — idempotency is enforced one level up by WebhooksService. */
  async handleCheckoutCompleted(
    orderId: string,
    stripePaymentIntentId: string | undefined,
    addOnSelectionsJson?: string,
  ): Promise<void> {
    const selections: AddOnSelectionMeta[] = addOnSelectionsJson
      ? JSON.parse(addOnSelectionsJson)
      : [];
    await this.settleOrder(orderId, stripePaymentIntentId, selections);
  }

  /** Cart checkouts share one payment-intent across several orders; settle each independently. */
  async handleCartCheckoutCompleted(
    orderIds: string[],
    stripePaymentIntentId: string | undefined,
    addOnSelectionsByOrderJson?: string,
  ): Promise<void> {
    const addOnSelectionsByOrder: Record<string, AddOnSelectionMeta[]> = addOnSelectionsByOrderJson
      ? JSON.parse(addOnSelectionsByOrderJson)
      : {};
    for (const orderId of orderIds) {
      await this.settleOrder(orderId, stripePaymentIntentId, addOnSelectionsByOrder[orderId] ?? []);
    }
  }

  private async settleOrder(
    orderId: string,
    stripePaymentIntentId: string | undefined,
    selections: AddOnSelectionMeta[] = [],
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
      if (selections.length > 0) {
        await tx.orderSelectedAddOn.createMany({
          data: selections.map((s) => ({
            orderId,
            addOnId: s.addOnId,
            priceAtSelectionCents: s.priceAtSelectionCents,
          })),
          skipDuplicates: true,
        });
      }
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
      include: { design: { include: { files: true } }, selectedAddOns: { include: { addOn: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listAdmin(page: number, pageSize: number): Promise<{ orders: Order[]; total: number }> {
    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        include: {
          design: true,
          user: { select: { email: true, firstName: true, lastName: true } },
          selectedAddOns: { include: { addOn: true } },
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
