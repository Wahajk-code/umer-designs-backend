import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ModificationsService } from '@/modules/modifications/modifications.service';
import { ListModificationsQueryDto } from '@/modules/modifications/dto/list-modifications-query.dto';
import { UpdateStatusDto } from '@/modules/modifications/dto/update-status.dto';
import { CreateModificationFileDto } from '@/modules/modifications/dto/create-modification-file.dto';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { UploadSignature } from '@/modules/cloudinary/cloudinary.service';

@ApiTags('admin/modifications')
@ApiBearerAuth()
@Controller('admin/modifications')
@Roles(Role.ADMIN)
export class AdminModificationsController {
  constructor(private readonly modificationsService: ModificationsService) {}

  @Get()
  async list(@Query() query: ListModificationsQueryDto) {
    const { modifications, total } = await this.modificationsService.listAdmin(query);
    return { modifications, total, page: query.page, pageSize: query.pageSize };
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.modificationsService.updateStatus(admin.sub, id, dto.status, dto.comment);
  }

  @Post(':id/upload-signature')
  createUploadSignature(@Param('id') id: string): UploadSignature {
    return this.modificationsService.createUploadSignature(id);
  }

  @Post(':id/files')
  addFile(@Param('id') id: string, @Body() dto: CreateModificationFileDto) {
    return this.modificationsService.addFile(id, dto);
  }

  @Delete(':id/files/:fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeFile(@Param('id') id: string, @Param('fileId') fileId: string): Promise<void> {
    await this.modificationsService.removeFile(id, fileId);
  }
}
