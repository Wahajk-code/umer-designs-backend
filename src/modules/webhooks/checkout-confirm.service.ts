import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '@/config/configuration';
import { StripeService } from '@/modules/payments/stripe.service';
import { WebhooksService } from '@/modules/webhooks/webhooks.service';

/**
 * LOCAL-DEVELOPMENT STAND-IN for the Stripe webhook.
 *
 * Stripe can't reach localhost, so after a test payment the browser lands on
 * the success URL carrying `session_id`. This asks Stripe directly (using our
 * secret key — never trusting the browser) whether that session was really
 * paid, and if so feeds it through the exact same settlement path the real
 * webhook uses. Settlement is idempotent, so it is also safe if a real webhook
 * later arrives for the same session.
 *
 * Hard-gated: only when STRIPE_LOCAL_CONFIRM=true AND Stripe test mode AND not
 * production (see stripe-config.ts). Otherwise this answers a plain 404 as if it
 * didn't exist, and live-mode sessions are always refused.
 */
@Injectable()
export class CheckoutConfirmService {
  private readonly logger = new Logger(CheckoutConfirmService.name);

  constructor(
    private readonly stripe: StripeService,
    private readonly webhooks: WebhooksService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async confirm(sessionId: string): Promise<{ confirmed: true }> {
    if (!this.config.get('stripe', { infer: true }).localConfirm) {
      throw new NotFoundException();
    }

    const session = await this.stripe.retrieveSession(sessionId);
    if (session.livemode) {
      throw new ForbiddenException('Live-mode payments are only confirmed by the Stripe webhook.');
    }
    if (session.payment_status !== 'paid') {
      throw new ConflictException('This payment has not completed.');
    }

    const paymentIntentId =
      typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;

    await this.webhooks.processStripeEvent({
      eventId: `local_confirm_${session.id}`,
      eventType: 'checkout.session.completed',
      checkoutSessionId: session.id,
      paymentIntentId,
      metadata: session.metadata ?? undefined,
    });
    this.logger.log(`Locally confirmed paid Stripe test session ${session.id}`);
    return { confirmed: true };
  }
}
