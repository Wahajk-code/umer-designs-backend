import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ReferralsService } from '@/modules/referrals/referrals.service';
import { DomainEvent, OrderPaidPayload } from '@/common/events/domain-events';

@Injectable()
export class ReferralsListener {
  constructor(private readonly referralsService: ReferralsService) {}

  @OnEvent(DomainEvent.ORDER_PAID)
  async onOrderPaid(payload: OrderPaidPayload): Promise<void> {
    await this.referralsService.checkAndRewardFirstPurchase(payload.userId);
  }
}
