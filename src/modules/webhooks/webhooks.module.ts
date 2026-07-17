import { Module } from '@nestjs/common';
import { WebhooksService } from '@/modules/webhooks/webhooks.service';
import { WebhooksController } from '@/modules/webhooks/webhooks.controller';
import { OrdersModule } from '@/modules/orders/orders.module';
import { ModificationsModule } from '@/modules/modifications/modifications.module';
import { PaymentLinksModule } from '@/modules/payment-links/payment-links.module';

@Module({
  imports: [OrdersModule, ModificationsModule, PaymentLinksModule],
  providers: [WebhooksService],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
