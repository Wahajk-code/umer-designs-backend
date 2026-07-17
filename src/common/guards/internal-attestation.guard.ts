import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { AppConfig } from '@/config/configuration';
import { ReplayCacheService } from '@/common/security/replay-cache.service';
import { verifyInternalAttestation } from '@/common/security/internal-signature.util';

/**
 * Global guard, runs before everything else (including @Public() routes):
 * rejects any request that doesn't carry a fresh, validly-signed
 * x-internal-* header set. This is what makes the Nest API unreachable to
 * anyone who merely discovers its address — only the BFF holds the secret.
 */
@Injectable()
export class InternalAttestationGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly replayCache: ReplayCacheService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const internalConfig = this.config.get('internal', { infer: true });

    const result = verifyInternalAttestation(
      {
        timestamp: request.header('x-internal-timestamp'),
        nonce: request.header('x-internal-nonce'),
        signature: request.header('x-internal-signature'),
        method: request.method,
        path: request.originalUrl.split('?')[0],
      },
      internalConfig.hmacSecret,
      internalConfig.windowMs,
      this.replayCache,
    );

    if (!result.ok) {
      throw new UnauthorizedException(result.reason);
    }
    return true;
  }
}
