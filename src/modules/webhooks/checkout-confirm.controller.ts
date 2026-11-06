import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, Matches } from 'class-validator';
import { Public } from '@/common/decorators/public.decorator';
import { CheckoutConfirmService } from '@/modules/webhooks/checkout-confirm.service';

class ConfirmCheckoutDto {
  @IsString()
  @Matches(/^cs_test_[A-Za-z0-9]+$/, { message: 'sessionId must be a Stripe test Checkout Session id.' })
  sessionId!: string;
}

/**
 * Local-dev only (404s unless STRIPE_LOCAL_CONFIRM is on in test mode) —
 * see CheckoutConfirmService. Public because pay-by-link customers aren't
 * signed in; safe because the payment is verified against Stripe by id.
 */
@ApiTags('payments')
@Controller('payments')
export class CheckoutConfirmController {
  constructor(private readonly confirmService: CheckoutConfirmService) {}

  @Public()
  @Post('confirm')
  @Throttle({ payment: {} })
  @HttpCode(HttpStatus.OK)
  confirm(@Body() dto: ConfirmCheckoutDto): Promise<{ confirmed: true }> {
    return this.confirmService.confirm(dto.sessionId);
  }
}
