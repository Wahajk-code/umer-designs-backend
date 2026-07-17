import { Module } from '@nestjs/common';
import { DesignsService } from '@/modules/designs/designs.service';
import { DesignsController } from '@/modules/designs/designs.controller';
import { AdminDesignsController } from '@/modules/designs/admin-designs.controller';

@Module({
  providers: [DesignsService],
  controllers: [DesignsController, AdminDesignsController],
  exports: [DesignsService],
})
export class DesignsModule {}
