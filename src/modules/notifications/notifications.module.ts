import { Module } from '@nestjs/common';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { NotificationsListener } from '@/modules/notifications/notifications.listener';
import { NotificationsController } from '@/modules/notifications/notifications.controller';

@Module({
  providers: [NotificationsService, NotificationsListener],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
