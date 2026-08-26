import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DesignAddOn, Role } from '@prisma/client';
import { DesignAddOnsService } from '@/modules/designs/design-addons.service';
import { CreateDesignAddOnDto } from '@/modules/designs/dto/create-design-addon.dto';
import { UpdateDesignAddOnDto } from '@/modules/designs/dto/update-design-addon.dto';
import { Roles } from '@/common/decorators/roles.decorator';

@ApiTags('admin/designs/add-ons')
@ApiBearerAuth()
@Controller('admin/designs/:designId/add-ons')
@Roles(Role.ADMIN)
export class AdminDesignAddOnsController {
  constructor(private readonly addOnsService: DesignAddOnsService) {}

  @Get()
  list(@Param('designId') designId: string): Promise<DesignAddOn[]> {
    return this.addOnsService.listAll(designId);
  }

  @Post()
  create(
    @Param('designId') designId: string,
    @Body() dto: CreateDesignAddOnDto,
  ): Promise<DesignAddOn> {
    return this.addOnsService.create(designId, dto);
  }

  @Patch(':addOnId')
  update(
    @Param('designId') designId: string,
    @Param('addOnId') addOnId: string,
    @Body() dto: UpdateDesignAddOnDto,
  ): Promise<DesignAddOn> {
    return this.addOnsService.update(designId, addOnId, dto);
  }
}
