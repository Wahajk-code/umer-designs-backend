import { Global, Module } from '@nestjs/common';
import { ReplayCacheService } from '@/common/security/replay-cache.service';

/**
 * Global so both the HTTP InternalAttestationGuard (wired in AppModule) and
 * the WebSocket gateway (which can't rely on Nest's HTTP guard pipeline) can
 * share one nonce-replay cache.
 */
@Global()
@Module({
  providers: [ReplayCacheService],
  exports: [ReplayCacheService],
})
export class SecurityModule {}
