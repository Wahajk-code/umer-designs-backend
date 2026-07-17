import { Controller, Get, HttpCode, HttpStatus, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Notification } from '@prisma/client';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { ListNotificationsQueryDto } from '@/modules/notifications/dto/list-notifications-query.dto';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('me')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<{
    notifications: Notification[];
    total: number;
    unreadCount: number;
    page: number;
    pageSize: number;
  }> {
    const result = await this.notificationsService.listMine(
      user.sub,
      query.unreadOnly === 'true',
      query.page,
      query.pageSize,
    );
    return { ...result, page: query.page, pageSize: query.pageSize };
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<Notification> {
    return this.notificationsService.markRead(user.sub, id);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAllRead(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.notificationsService.markAllRead(user.sub);
  }
}
