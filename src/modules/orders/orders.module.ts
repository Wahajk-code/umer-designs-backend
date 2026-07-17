import { Module } from '@nestjs/common';
import { OrdersService } from '@/modules/orders/orders.service';
import { OrdersController } from '@/modules/orders/orders.controller';
import { AdminOrdersController } from '@/modules/orders/admin-orders.controller';

@Module({
  providers: [OrdersService],
  controllers: [OrdersController, AdminOrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}
