import { ExecutionContext, Injectable } from '@nestjs/common';
import {
  ThrottlerGenerateKeyFunction,
  ThrottlerGetTrackerFunction,
  ThrottlerGuard,
  ThrottlerOptions,
} from '@nestjs/throttler';

/** Metadata key @Throttle({ name: … }) writes (@nestjs/throttler's THROTTLER_LIMIT, not exported from the root). */
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';

const IP_PATTERN = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * App-wide rate limiter, with two fixes over the stock ThrottlerGuard:
 *
 * 1. Per END USER, not per caller socket. Every request reaches Nest from
 *    the BFF, so the default tracker (req.ip) is the Next.js server itself —
 *    all visitors would share one bucket. The BFF forwards the visitor's IP
 *    as `x-client-ip`; trusting it is safe because InternalAttestationGuard
 *    runs first, so only HMAC-attested (BFF) requests ever reach here.
 *
 * 2. Named throttlers are OPT-IN. @nestjs/throttler applies every named
 *    throttler to every route, so the strict `auth` (10/min) and `payment`
 *    limits throttled ordinary page loads — after ~10 calls a minute users
 *    got 429s and pages treated them as signed-out. Now `default` applies
 *    everywhere and `auth`/`payment` only where @Throttle({ auth|payment })
 *    is declared on the handler or controller.
 */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const forwarded = req.headers?.['x-client-ip'];
    if (typeof forwarded === 'string' && IP_PATTERN.test(forwarded)) {
      return forwarded;
    }
    return req.ip;
  }

  protected async handleRequest(
    context: ExecutionContext,
    limit: number,
    ttl: number,
    throttler: ThrottlerOptions,
    getTracker: ThrottlerGetTrackerFunction,
    generateKey: ThrottlerGenerateKeyFunction,
  ): Promise<boolean> {
    const name = throttler.name ?? 'default';
    if (name !== 'default') {
      const key = THROTTLER_LIMIT + name;
      const optedIn =
        Reflect.hasMetadata(key, context.getHandler()) || Reflect.hasMetadata(key, context.getClass());
      if (!optedIn) return true;
    }
    return super.handleRequest(context, limit, ttl, throttler, getTracker, generateKey);
  }
}
