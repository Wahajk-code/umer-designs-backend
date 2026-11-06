import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { ModificationStatus, Order, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { StripeService, CheckoutLineItem } from '@/modules/payments/stripe.service';
import { CloudinaryService } from '@/modules/cloudinary/cloudinary.service';
import { AppConfig } from '@/config/configuration';
import {
  DomainEvent,
  ModificationPaidPayload,
  OrderPaidPayload,
} from '@/common/events/domain-events';
import { CartCheckoutItemDto } from '@/modules/orders/dto/create-cart-checkout-session.dto';

/** Stripe rejects Checkout Sessions below this amount (USD). */
const MIN_STRIPE_CHARGE_CENTS = 50;

/** Max plan changes per design in one checkout (keeps Stripe metadata under its 500-char limit). */
const MAX_MODIFICATIONS_PER_DESIGN = 10;

/** Compact "optionId:cents,optionId:cents" form for Stripe metadata. */
function encodeModifications(mods: AddOnSelectionMeta[]): string {
  return mods.map((m) => `${m.addOnId}:${m.priceAtSelectionCents}`).join(',');
}

function decodeModifications(value: string | undefined): AddOnSelectionMeta[] {
  if (!value) return [];
  return value
    .split(',')
    .filter(Boolean)
    .map((part) => {
      const [addOnId, cents] = part.split(':');
      return { addOnId, label: '', priceAtSelectionCents: Number(cents) };
    })
    .filter((m) => m.addOnId && Number.isFinite(m.priceAtSelectionCents));
}

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
    modificationOptionIds: string[] = [],
  ): Promise<{ checkoutUrl: string | null }> {
    const [design, user] = await Promise.all([
      this.prisma.design.findUnique({ where: { id: designId } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ]);
    if (!design || design.status !== 'PUBLISHED') {
      throw new NotFoundException('Design not found.');
    }

    const selections = await this.resolveAddOnSelections(designId, addOnIds);
    const mods = await this.resolveModificationSelections(modificationOptionIds);
    const addOnsTotalCents = selections.reduce((sum, s) => sum + s.priceAtSelectionCents, 0);
    const modsTotalCents = mods.reduce((sum, s) => sum + s.priceAtSelectionCents, 0);
    const totalPriceCents = design.basePriceCents + addOnsTotalCents + modsTotalCents;

    let order = await this.prisma.order.findFirst({ where: { userId, designId } });

    if (order?.status === OrderStatus.PAID) {
      throw new ConflictException('You already own this design.');
    }

    // Recomputed fresh on every attempt against the user's *current* balance —
    // never trust a stale reservation from an earlier, abandoned checkout.
    let creditToApply = Math.min(user.creditBalanceCents, totalPriceCents);
    let amountDue = totalPriceCents - creditToApply;
    // Credit must never leave a sliver Stripe can't charge: keep back enough
    // so the card payment is at least the Stripe minimum (or exactly zero).
    if (amountDue > 0 && amountDue < MIN_STRIPE_CHARGE_CENTS) {
      creditToApply = Math.max(0, totalPriceCents - MIN_STRIPE_CHARGE_CENTS);
      amountDue = totalPriceCents - creditToApply;
    }

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
      await this.markPaidWithCredit(order.id, userId, creditToApply, totalPriceCents, selections, mods);
      return { checkoutUrl: null };
    }

    const lineItems = this.buildLineItems(
      design.title,
      design.basePriceCents,
      [...selections, ...mods.map((m) => ({ ...m, label: `Change: ${m.label}` }))],
      creditToApply,
    );

    const origin = this.config.get('corsAllowedOrigin', { infer: true });
    const session = await this.stripe.createCheckoutSession({
      lineItems,
      customerEmail: userEmail,
      successUrl: `${origin}/dashboard?purchased=1${mods.length > 0 ? '&mods=1' : ''}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/designs/${design.slug}?checkout=cancelled`,
      metadata: {
        kind: 'design_order',
        recordId: order.id,
        addOnSelections: JSON.stringify(selections),
        ...(mods.length > 0 && { modifications: encodeModifications(mods) }),
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
        const item = items.find((i) => i.designId === designId);
        const selections = await this.resolveAddOnSelections(designId, item?.addOnIds ?? []);
        const mods = await this.resolveModificationSelections(item?.modificationOptionIds ?? []);
        const extrasCents = [...selections, ...mods].reduce((sum, s) => sum + s.priceAtSelectionCents, 0);
        return { design, selections, mods, totalPriceCents: design.basePriceCents + extrasCents };
      }),
    );

    let remainingCredit = user.creditBalanceCents;
    const plans = cartPlans.map((p) => {
      const creditApplied = Math.min(remainingCredit, p.totalPriceCents);
      remainingCredit -= creditApplied;
      return { ...p, creditApplied, amountDue: p.totalPriceCents - creditApplied };
    });

    // Same Stripe-minimum rule for the whole cart: give credit back (last item first).
    const cartDue = plans.reduce((sum, p) => sum + p.amountDue, 0);
    if (cartDue > 0 && cartDue < MIN_STRIPE_CHARGE_CENTS) {
      let shortfall = MIN_STRIPE_CHARGE_CENTS - cartDue;
      for (const plan of [...plans].reverse()) {
        const giveBack = Math.min(shortfall, plan.creditApplied);
        plan.creditApplied -= giveBack;
        plan.amountDue += giveBack;
        shortfall -= giveBack;
        if (shortfall === 0) break;
      }
    }

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
          plan.mods,
        );
      }
      return { checkoutUrl: null };
    }

    const lineItems = plans.flatMap((p) =>
      this.buildLineItems(
        p.design.title,
        p.design.basePriceCents,
        [...p.selections, ...p.mods.map((m) => ({ ...m, label: `Change: ${m.label}` }))],
        p.creditApplied,
      ),
    );
    const cartHasMods = plans.some((p) => p.mods.length > 0);
    const modsMetadata: Record<string, string> = {};
    for (const order of orders) {
      const plan = plans.find((p) => p.design.id === order.designId)!;
      if (plan.mods.length > 0) {
        modsMetadata[`m_${order.id}`] = encodeModifications(plan.mods);
      }
    }

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
      successUrl: `${origin}/dashboard?purchased=1${cartHasMods ? '&mods=1' : ''}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/designs?checkout=cancelled`,
      metadata: {
        kind: 'cart_order',
        recordIds: orders.map((o) => o.id).join(','),
        addOnSelectionsByOrder: JSON.stringify(addOnSelectionsByOrder),
        ...modsMetadata,
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
    mods: AddOnSelectionMeta[] = [],
  ): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { design: true },
    });

    let modification: { id: string; totalAmountCents: number } | null = null;
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
      modification = await this.createPurchaseModification(tx, order, mods);
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
    this.emitModificationPaid(modification, order);
  }

  /** Called only via the internal webhook-forward route — idempotency is enforced one level up by WebhooksService. */
  async handleCheckoutCompleted(
    orderId: string,
    stripePaymentIntentId: string | undefined,
    addOnSelectionsJson?: string,
    modificationsCompact?: string,
  ): Promise<void> {
    const selections: AddOnSelectionMeta[] = addOnSelectionsJson
      ? JSON.parse(addOnSelectionsJson)
      : [];
    await this.settleOrder(
      orderId,
      stripePaymentIntentId,
      selections,
      decodeModifications(modificationsCompact),
    );
  }

  /** Cart checkouts share one payment-intent across several orders; settle each independently. */
  async handleCartCheckoutCompleted(
    orderIds: string[],
    stripePaymentIntentId: string | undefined,
    addOnSelectionsByOrderJson?: string,
    metadata: Record<string, string> = {},
  ): Promise<void> {
    const addOnSelectionsByOrder: Record<string, AddOnSelectionMeta[]> = addOnSelectionsByOrderJson
      ? JSON.parse(addOnSelectionsByOrderJson)
      : {};
    for (const orderId of orderIds) {
      await this.settleOrder(
        orderId,
        stripePaymentIntentId,
        addOnSelectionsByOrder[orderId] ?? [],
        decodeModifications(metadata[`m_${orderId}`]),
      );
    }
  }

  private async settleOrder(
    orderId: string,
    stripePaymentIntentId: string | undefined,
    selections: AddOnSelectionMeta[] = [],
    mods: AddOnSelectionMeta[] = [],
  ): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { design: true },
    });
    if (!order || order.status === OrderStatus.PAID) {
      return;
    }

    let modification: { id: string; totalAmountCents: number } | null = null;
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
      modification = await this.createPurchaseModification(tx, order, mods);
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
    this.emitModificationPaid(modification, order);
  }

  /** Validates plan-change options chosen at purchase time; snapshots their current price. */
  private async resolveModificationSelections(optionIds: string[]): Promise<AddOnSelectionMeta[]> {
    const uniqueIds = Array.from(new Set(optionIds));
    if (uniqueIds.length === 0) {
      return [];
    }
    if (uniqueIds.length > MAX_MODIFICATIONS_PER_DESIGN) {
      throw new BadRequestException(
        `Choose at most ${MAX_MODIFICATIONS_PER_DESIGN} changes per design.`,
      );
    }
    const options = await this.prisma.modificationOption.findMany({
      where: { id: { in: uniqueIds } },
    });
    const foundIds = new Set(options.map((o) => o.id));
    const missing = uniqueIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(`Unknown plan change(s): ${missing.join(', ')}`);
    }
    const inactive = options.filter((o) => !o.active);
    if (inactive.length > 0) {
      throw new ConflictException(
        `These changes are no longer available: ${inactive.map((o) => o.label).join(', ')}`,
      );
    }
    return options.map((o) => ({
      addOnId: o.id,
      label: o.label,
      priceAtSelectionCents: o.addedCostCents,
    }));
  }

  /**
   * Changes picked while buying the plan become a tracked modification request
   * the moment the order is paid — in the same transaction, so a paid order
   * can never lose its requested changes (and a replayed event never doubles
   * them, because settlement only runs once per order).
   */
  private async createPurchaseModification(
    tx: Prisma.TransactionClient,
    order: { userId: string; designId: string },
    mods: AddOnSelectionMeta[],
  ): Promise<{ id: string; totalAmountCents: number } | null> {
    if (mods.length === 0) {
      return null;
    }
    const totalAmountCents = mods.reduce((sum, m) => sum + m.priceAtSelectionCents, 0);
    return tx.modification.create({
      data: {
        userId: order.userId,
        designId: order.designId,
        status: ModificationStatus.SUBMITTED,
        basePriceCents: 0,
        totalAmountCents,
        paidAt: new Date(),
        selectedOptions: {
          create: mods.map((m) => ({
            optionId: m.addOnId,
            priceAtSelectionCents: m.priceAtSelectionCents,
          })),
        },
        events: {
          create: {
            kind: 'STATUS_CHANGE',
            toStatus: ModificationStatus.SUBMITTED,
            comment: 'Requested together with the plan purchase.',
          },
        },
      },
      select: { id: true, totalAmountCents: true },
    });
  }

  private emitModificationPaid(
    modification: { id: string; totalAmountCents: number } | null,
    order: { userId: string; designId: string; design: { title: string } },
  ): void {
    if (!modification) return;
    const payload: ModificationPaidPayload = {
      modificationId: modification.id,
      userId: order.userId,
      designId: order.designId,
      designTitle: order.design.title,
      totalAmountCents: modification.totalAmountCents,
    };
    this.events.emit(DomainEvent.MODIFICATION_PAID, payload);
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
