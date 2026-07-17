import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { AppConfig } from '@/config/configuration';

export interface CreateCheckoutSessionInput {
  amountCents: number;
  productName: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
}

/**
 * Wraps the Stripe SDK. Every Checkout Session we create carries a `kind` +
 * `recordId` in metadata so the webhook handler (Nest side, reached only via
 * the BFF's verified forward — see AppModule/InternalAttestationGuard) can
 * route the event back to the right module without guessing.
 */
@Injectable()
export class StripeService {
  private readonly client: Stripe | null;

  constructor(config: ConfigService<AppConfig, true>) {
    const secretKey = config.get('stripe', { infer: true }).secretKey;
    this.client = secretKey ? new Stripe(secretKey) : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  private assertConfigured(): Stripe {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Payments are not configured yet. Set STRIPE_SECRET_KEY.',
      );
    }
    return this.client;
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<Stripe.Checkout.Session> {
    const client = this.assertConfigured();
    return client.checkout.sessions.create(
      {
        mode: 'payment',
        payment_method_types: ['card'],
        customer_email: input.customerEmail,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: input.amountCents,
              product_data: { name: input.productName },
            },
          },
        ],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey },
    );
  }

  async retrieveSession(sessionId: string): Promise<Stripe.Checkout.Session> {
    const client = this.assertConfigured();
    return client.checkout.sessions.retrieve(sessionId);
  }
}
