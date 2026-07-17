import { Module } from '@nestjs/common';
import { PaymentLinksService } from '@/modules/payment-links/payment-links.service';
import { PaymentLinksController } from '@/modules/payment-links/payment-links.controller';
import { AdminPaymentLinksController } from '@/modules/payment-links/admin-payment-links.controller';

@Module({
  providers: [PaymentLinksService],
  controllers: [PaymentLinksController, AdminPaymentLinksController],
  exports: [PaymentLinksService],
})
export class PaymentLinksModule {}
