import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ModificationOption } from '@prisma/client';
import { ModificationsService } from '@/modules/modifications/modifications.service';
import { ModificationOptionsService } from '@/modules/modifications/modification-options.service';
import { CreateModificationCheckoutDto } from '@/modules/modifications/dto/create-modification-checkout.dto';
import { AddCommentDto } from '@/modules/modifications/dto/add-comment.dto';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';

@ApiTags('modifications')
@ApiBearerAuth()
@Controller('modifications')
export class ModificationsController {
  constructor(
    private readonly modificationsService: ModificationsService,
    private readonly optionsService: ModificationOptionsService,
  ) {}

  @Get('options')
  listOptions(): Promise<ModificationOption[]> {
    return this.optionsService.listActive();
  }

  @Post('checkout')
  @Throttle({ payment: {} })
  createCheckoutSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateModificationCheckoutDto,
  ): Promise<{ checkoutUrl: string }> {
    return this.modificationsService.createCheckoutSession(user.sub, user.email, dto);
  }

  @Get('me')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.modificationsService.listMine(user.sub);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.modificationsService.findOne(user.sub, id, user.role === 'ADMIN');
  }

  @Post(':id/comments')
  addComment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddCommentDto,
  ) {
    return this.modificationsService.addComment(user.sub, id, user.role === 'ADMIN', dto.comment);
  }

  @Get(':id/files/:fileId/download')
  getSignedDownloadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ): Promise<{ url: string }> {
    return this.modificationsService.getSignedDownloadUrl(
      user.sub,
      user.role === 'ADMIN',
      id,
      fileId,
    );
  }
}
