import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ModificationOption, Role } from '@prisma/client';
import { ModificationOptionsService } from '@/modules/modifications/modification-options.service';
import { CreateModificationOptionDto } from '@/modules/modifications/dto/create-modification-option.dto';
import { UpdateModificationOptionDto } from '@/modules/modifications/dto/update-modification-option.dto';
import { Roles } from '@/common/decorators/roles.decorator';

@ApiTags('admin/modification-options')
@ApiBearerAuth()
@Controller('admin/modification-options')
@Roles(Role.ADMIN)
export class AdminModificationOptionsController {
  constructor(private readonly optionsService: ModificationOptionsService) {}

  @Get()
  list(): Promise<ModificationOption[]> {
    return this.optionsService.listAll();
  }

  @Post()
  create(@Body() dto: CreateModificationOptionDto): Promise<ModificationOption> {
    return this.optionsService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateModificationOptionDto,
  ): Promise<ModificationOption> {
    return this.optionsService.update(id, dto);
  }
}
