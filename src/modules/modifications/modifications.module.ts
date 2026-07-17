import { Module } from '@nestjs/common';
import { ModificationsService } from '@/modules/modifications/modifications.service';
import { ModificationOptionsService } from '@/modules/modifications/modification-options.service';
import { ModificationsController } from '@/modules/modifications/modifications.controller';
import { AdminModificationsController } from '@/modules/modifications/admin-modifications.controller';
import { AdminModificationOptionsController } from '@/modules/modifications/admin-modification-options.controller';

@Module({
  providers: [ModificationsService, ModificationOptionsService],
  controllers: [
    ModificationsController,
    AdminModificationsController,
    AdminModificationOptionsController,
  ],
  exports: [ModificationsService],
})
export class ModificationsModule {}
