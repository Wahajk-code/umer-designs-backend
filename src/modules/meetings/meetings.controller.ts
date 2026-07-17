import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Meeting } from '@prisma/client';
import { MeetingsService } from '@/modules/meetings/meetings.service';
import { CreateMeetingDto } from '@/modules/meetings/dto/create-meeting.dto';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';

@ApiTags('meetings')
@ApiBearerAuth()
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMeetingDto): Promise<Meeting> {
    return this.meetingsService.create(user.sub, dto);
  }

  @Get('me')
  listMine(@CurrentUser() user: AuthenticatedUser): Promise<Meeting[]> {
    return this.meetingsService.listMine(user.sub);
  }
}
