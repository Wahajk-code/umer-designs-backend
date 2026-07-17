import { IsObject, IsOptional, IsString } from 'class-validator';

/**
 * NOT the raw Stripe event. The BFF verifies the Stripe signature and
 * forwards only this minimal, already-trusted shape over the internal
 * channel — avoids fighting the global whitelist ValidationPipe against
 * Stripe's large, ever-changing event schema.
 */
export class StripeWebhookForwardDto {
  @IsString()
  eventId!: string;

  @IsString()
  eventType!: string;

  @IsOptional()
  @IsString()
  checkoutSessionId?: string;

  @IsOptional()
  @IsString()
  paymentIntentId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;
}
