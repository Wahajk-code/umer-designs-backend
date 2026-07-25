import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '@/common/decorators/public.decorator';
import { SkipInternalAttestation } from '@/common/decorators/skip-internal-attestation.decorator';

interface HealthResponse {
  status: 'ok';
  service: string;
  timestamp: string;
}

/**
 * The one endpoint reachable directly, without the internal HMAC signature
 * or a user JWT — a hosting platform's own uptime/health pinger hits this
 * at the bare base URL, and it can never carry either of those. Returns
 * nothing beyond "the process is up", so this is a deliberate, narrow
 * exception to the API's otherwise default-closed posture.
 */
@Public()
@SkipInternalAttestation()
@SkipThrottle()
@Controller()
export class HealthController {
  @Get()
  root(): HealthResponse {
    return this.status();
  }

  @Get('health')
  health(): HealthResponse {
    return this.status();
  }

  private status(): HealthResponse {
    return {
      status: 'ok',
      service: 'umer-designs-backend',
      timestamp: new Date().toISOString(),
    };
  }
}
