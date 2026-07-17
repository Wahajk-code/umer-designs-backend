import { Module } from '@nestjs/common';
import { ReferralsService } from '@/modules/referrals/referrals.service';
import { ReferralsListener } from '@/modules/referrals/referrals.listener';
import { ReferralsController } from '@/modules/referrals/referrals.controller';
import { AdminReferralsController } from '@/modules/referrals/admin-referrals.controller';

@Module({
  providers: [ReferralsService, ReferralsListener],
  controllers: [ReferralsController, AdminReferralsController],
  exports: [ReferralsService],
})
export class ReferralsModule {}
