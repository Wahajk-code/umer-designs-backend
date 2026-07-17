import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ReferralsService } from '@/modules/referrals/referrals.service';
import { ListReferralsQueryDto } from '@/modules/referrals/dto/list-referrals-query.dto';
import { Roles } from '@/common/decorators/roles.decorator';

@ApiTags('admin/referrals')
@ApiBearerAuth()
@Controller('admin/referrals')
@Roles(Role.ADMIN)
export class AdminReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get()
  async list(@Query() query: ListReferralsQueryDto) {
    const result = await this.referralsService.listAdmin(query.page, query.pageSize);
    return { ...result, page: query.page, pageSize: query.pageSize };
  }

  @Get('settings')
  getSettings() {
    return this.referralsService.getSettings();
  }
}
