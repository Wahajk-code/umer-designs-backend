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
import { Design, DesignFile, Role } from '@prisma/client';
import { DesignsService } from '@/modules/designs/designs.service';
import { CreateDesignDto } from '@/modules/designs/dto/create-design.dto';
import { UpdateDesignDto } from '@/modules/designs/dto/update-design.dto';
import { ListDesignsQueryDto } from '@/modules/designs/dto/list-designs-query.dto';
import { CreateDesignFileDto } from '@/modules/designs/dto/create-design-file.dto';
import { Roles } from '@/common/decorators/roles.decorator';
import { UploadSignature } from '@/modules/cloudinary/cloudinary.service';

@ApiTags('admin/designs')
@ApiBearerAuth()
@Controller('admin/designs')
@Roles(Role.ADMIN)
export class AdminDesignsController {
  constructor(private readonly designsService: DesignsService) {}

  @Get()
  async list(
    @Query() query: ListDesignsQueryDto,
  ): Promise<{ designs: Design[]; total: number; page: number; pageSize: number }> {
    const { designs, total } = await this.designsService.listAdmin(query);
    return { designs, total, page: query.page, pageSize: query.pageSize };
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.designsService.findByIdAdmin(id);
  }

  @Post()
  create(@Body() dto: CreateDesignDto): Promise<Design> {
    return this.designsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDesignDto): Promise<Design> {
    return this.designsService.update(id, dto);
  }

  @Post(':id/upload-signature')
  createUploadSignature(@Param('id') id: string): UploadSignature {
    return this.designsService.createUploadSignature(id);
  }

  @Post(':id/files')
  addFile(@Param('id') id: string, @Body() dto: CreateDesignFileDto): Promise<DesignFile> {
    return this.designsService.addFile(id, dto);
  }

  @Delete(':id/files/:fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeFile(@Param('id') id: string, @Param('fileId') fileId: string): Promise<void> {
    await this.designsService.removeFile(id, fileId);
  }
}
