import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { OrdersService } from '@/modules/orders/orders.service';
import { ModificationsService } from '@/modules/modifications/modifications.service';
import { PaymentLinksService } from '@/modules/payment-links/payment-links.service';
import { StripeWebhookForwardDto } from '@/modules/webhooks/dto/stripe-webhook-forward.dto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly modificationsService: ModificationsService,
    private readonly paymentLinksService: PaymentLinksService,
  ) {}

  async processStripeEvent(dto: StripeWebhookForwardDto): Promise<{ received: true }> {
    const alreadyProcessed = await this.markProcessedOrSkip(dto.eventId, dto.eventType);
    if (alreadyProcessed) {
      this.logger.debug(`Skipping already-processed Stripe event ${dto.eventId}`);
      return { received: true };
    }

    if (dto.eventType === 'checkout.session.completed') {
      await this.routeCheckoutCompleted(dto);
    }

    return { received: true };
  }

  private async routeCheckoutCompleted(dto: StripeWebhookForwardDto): Promise<void> {
    const kind = dto.metadata?.kind;
    if (!kind) {
      this.logger.warn(
        `checkout.session.completed with no routable metadata (event ${dto.eventId})`,
      );
      return;
    }

    switch (kind) {
      case 'design_order': {
        const recordId = dto.metadata?.recordId;
        if (!recordId) {
          this.logger.warn(`design_order event ${dto.eventId} missing metadata.recordId`);
          return;
        }
        await this.ordersService.handleCheckoutCompleted(recordId, dto.paymentIntentId);
        break;
      }
      case 'modification':
        await this.modificationsService.handleCheckoutCompleted(
          dto.metadata ?? {},
          dto.paymentIntentId,
        );
        break;
      case 'payment_link': {
        const recordId = dto.metadata?.recordId;
        if (!recordId) {
          this.logger.warn(`payment_link event ${dto.eventId} missing metadata.recordId`);
          return;
        }
        await this.paymentLinksService.handleCheckoutCompleted(recordId);
        break;
      }
      default:
        this.logger.warn(`Unknown Stripe metadata.kind "${kind}" on event ${dto.eventId}`);
    }
  }

  /** Returns true if this event was already processed (i.e. this call should be a no-op). */
  private async markProcessedOrSkip(eventId: string, eventType: string): Promise<boolean> {
    try {
      await this.prisma.processedStripeEvent.create({ data: { id: eventId, type: eventType } });
      return false;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return true;
      }
      throw err;
    }
  }
}
