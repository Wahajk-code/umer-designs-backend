import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Order } from '@prisma/client';
import { OrdersService } from '@/modules/orders/orders.service';
import { CreateCheckoutSessionDto } from '@/modules/orders/dto/create-checkout-session.dto';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('checkout')
  @Throttle({ payment: {} })
  createCheckoutSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCheckoutSessionDto,
  ): Promise<{ checkoutUrl: string }> {
    return this.ordersService.createCheckoutSession(user.sub, user.email, dto.designId);
  }

  @Get('me')
  listMine(@CurrentUser() user: AuthenticatedUser): Promise<Order[]> {
    return this.ordersService.listMine(user.sub);
  }

  @Get(':id/download/:fileId')
  getSignedDownloadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ): Promise<{ url: string }> {
    return this.ordersService.getSignedDownloadUrl(user.sub, id, fileId);
  }
}
