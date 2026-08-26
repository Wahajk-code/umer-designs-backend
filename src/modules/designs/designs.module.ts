import { Module } from '@nestjs/common';
import { DesignsService } from '@/modules/designs/designs.service';
import { DesignsController } from '@/modules/designs/designs.controller';
import { AdminDesignsController } from '@/modules/designs/admin-designs.controller';
import { DesignAddOnsService } from '@/modules/designs/design-addons.service';
import { AdminDesignAddOnsController } from '@/modules/designs/admin-design-addons.controller';

@Module({
  providers: [DesignsService, DesignAddOnsService],
  controllers: [DesignsController, AdminDesignsController, AdminDesignAddOnsController],
  exports: [DesignsService, DesignAddOnsService],
})
export class DesignsModule {}
