import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PaymentLink, Role } from '@prisma/client';
import { PaymentLinksService } from '@/modules/payment-links/payment-links.service';
import { CreatePaymentLinkDto } from '@/modules/payment-links/dto/create-payment-link.dto';
import { ListPaymentLinksQueryDto } from '@/modules/payment-links/dto/list-payment-links-query.dto';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';

@ApiTags('admin/payment-links')
@ApiBearerAuth()
@Controller('admin/payment-links')
@Roles(Role.ADMIN)
export class AdminPaymentLinksController {
  constructor(private readonly paymentLinksService: PaymentLinksService) {}

  @Post()
  create(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() dto: CreatePaymentLinkDto,
  ): Promise<{ paymentLink: PaymentLink; redeemUrl: string }> {
    return this.paymentLinksService.create(admin.sub, dto);
  }

  @Get()
  async list(
    @Query() query: ListPaymentLinksQueryDto,
  ): Promise<{ paymentLinks: PaymentLink[]; total: number; page: number; pageSize: number }> {
    const { paymentLinks, total } = await this.paymentLinksService.listAdmin(query);
    return { paymentLinks, total, page: query.page, pageSize: query.pageSize };
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string): Promise<PaymentLink> {
    return this.paymentLinksService.cancel(id);
  }
}
