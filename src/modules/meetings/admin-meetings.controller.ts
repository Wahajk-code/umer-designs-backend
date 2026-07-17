import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Meeting, Role } from '@prisma/client';
import { MeetingsService } from '@/modules/meetings/meetings.service';
import { ListMeetingsQueryDto } from '@/modules/meetings/dto/list-meetings-query.dto';
import { ConfirmMeetingDto } from '@/modules/meetings/dto/confirm-meeting.dto';
import { Roles } from '@/common/decorators/roles.decorator';

@ApiTags('admin/meetings')
@ApiBearerAuth()
@Controller('admin/meetings')
@Roles(Role.ADMIN)
export class AdminMeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Get()
  async list(@Query() query: ListMeetingsQueryDto) {
    const { meetings, total } = await this.meetingsService.listAdmin(query);
    return { meetings, total, page: query.page, pageSize: query.pageSize };
  }

  @Patch(':id/confirm')
  confirm(@Param('id') id: string, @Body() dto: ConfirmMeetingDto): Promise<Meeting> {
    return this.meetingsService.confirm(id, dto);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string): Promise<Meeting> {
    return this.meetingsService.cancel(id);
  }
}
