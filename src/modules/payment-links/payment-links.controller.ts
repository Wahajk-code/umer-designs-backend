import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PaymentLinksService } from '@/modules/payment-links/payment-links.service';
import { Public } from '@/common/decorators/public.decorator';

/**
 * Public because a payment link can target someone with no account at all —
 * gated entirely by possession of the unguessable token, not a session.
 */
@ApiTags('payment-links')
@Controller('payment-links')
export class PaymentLinksController {
  constructor(private readonly paymentLinksService: PaymentLinksService) {}

  @Public()
  @Get(':token')
  preview(@Param('token') token: string) {
    return this.paymentLinksService.getPublicPreview(token);
  }

  @Public()
  @Post(':token/redeem')
  @Throttle({ payment: {} })
  redeem(@Param('token') token: string): Promise<{ checkoutUrl: string }> {
    return this.paymentLinksService.redeem(token);
  }
}
