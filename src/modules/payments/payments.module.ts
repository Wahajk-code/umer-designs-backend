import { Global, Module } from '@nestjs/common';
import { StripeService } from '@/modules/payments/stripe.service';

@Global()
@Module({
  providers: [StripeService],
  exports: [StripeService],
})
export class PaymentsModule {}
