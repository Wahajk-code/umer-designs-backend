import { Module } from '@nestjs/common';
import { MeetingsService } from '@/modules/meetings/meetings.service';
import { MeetingsController } from '@/modules/meetings/meetings.controller';
import { AdminMeetingsController } from '@/modules/meetings/admin-meetings.controller';

@Module({
  providers: [MeetingsService],
  controllers: [MeetingsController, AdminMeetingsController],
  exports: [MeetingsService],
})
export class MeetingsModule {}
