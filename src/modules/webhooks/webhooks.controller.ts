import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WebhooksService } from '@/modules/webhooks/webhooks.service';
import { StripeWebhookForwardDto } from '@/modules/webhooks/dto/stripe-webhook-forward.dto';
import { Public } from '@/common/decorators/public.decorator';

/**
 * Reached only by the BFF (`/api/webhooks/stripe` in Next), which verifies
 * the Stripe signature itself before forwarding here. This route is
 * `@Public()` (no user JWT — it's machine-to-machine) but still requires the
 * global InternalAttestationGuard's HMAC header, so nothing else can call it.
 */
@ApiTags('webhooks')
@Controller('webhooks/stripe')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  handle(@Body() dto: StripeWebhookForwardDto): Promise<{ received: true }> {
    return this.webhooksService.processStripeEvent(dto);
  }
}
