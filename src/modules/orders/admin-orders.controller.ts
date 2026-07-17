import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Order, Role } from '@prisma/client';
import { OrdersService } from '@/modules/orders/orders.service';
import { ListOrdersQueryDto } from '@/modules/orders/dto/list-orders-query.dto';
import { Roles } from '@/common/decorators/roles.decorator';

@ApiTags('admin/orders')
@ApiBearerAuth()
@Controller('admin/orders')
@Roles(Role.ADMIN)
export class AdminOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  async list(
    @Query() query: ListOrdersQueryDto,
  ): Promise<{ orders: Order[]; total: number; page: number; pageSize: number }> {
    const { orders, total } = await this.ordersService.listAdmin(query.page, query.pageSize);
    return { orders, total, page: query.page, pageSize: query.pageSize };
  }
}
