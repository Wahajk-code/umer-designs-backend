import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalAttestationGuard } from '@/common/guards/internal-attestation.guard';
import { ReplayCacheService } from '@/common/security/replay-cache.service';
import { signInternalRequest } from '@/common/security/internal-signature.util';
import { AppConfig } from '@/config/configuration';

const SECRET = 'test-secret-value-that-is-long-enough';

function makeContext(headers: Record<string, string>, method = 'GET', url = '/designs') {
  const request = {
    header: (name: string) => headers[name.toLowerCase()],
    method,
    originalUrl: url,
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('InternalAttestationGuard', () => {
  let guard: InternalAttestationGuard;
  let config: ConfigService<AppConfig, true>;
  let replayCache: ReplayCacheService;

  beforeEach(() => {
    config = {
      get: (key: string) => {
        if (key === 'internal') return { hmacSecret: SECRET, windowMs: 60000 };
        throw new Error(`unexpected config key ${key}`);
      },
    } as unknown as ConfigService<AppConfig, true>;
    replayCache = new ReplayCacheService();
    guard = new InternalAttestationGuard(config, replayCache);
  });

  function sign(timestamp: string, nonce: string, method: string, url: string) {
    return signInternalRequest(SECRET, timestamp, nonce, method, url);
  }

  it('rejects requests with no attestation headers at all', () => {
    expect(() => guard.canActivate(makeContext({}))).toThrow(UnauthorizedException);
  });

  it('accepts a correctly signed, fresh request', () => {
    const timestamp = String(Date.now());
    const nonce = 'nonce-1';
    const signature = sign(timestamp, nonce, 'GET', '/designs');
    const ctx = makeContext({
      'x-internal-timestamp': timestamp,
      'x-internal-nonce': nonce,
      'x-internal-signature': signature,
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects a request signed with the wrong secret', () => {
    const timestamp = String(Date.now());
    const nonce = 'nonce-2';
    const signature = signInternalRequest(
      'wrong-secret-wrong-secret-wrong',
      timestamp,
      nonce,
      'GET',
      '/designs',
    );
    const ctx = makeContext({
      'x-internal-timestamp': timestamp,
      'x-internal-nonce': nonce,
      'x-internal-signature': signature,
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects a stale timestamp outside the freshness window', () => {
    const timestamp = String(Date.now() - 120000);
    const nonce = 'nonce-3';
    const signature = sign(timestamp, nonce, 'GET', '/designs');
    const ctx = makeContext({
      'x-internal-timestamp': timestamp,
      'x-internal-nonce': nonce,
      'x-internal-signature': signature,
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects a replayed nonce on the second use', () => {
    const timestamp = String(Date.now());
    const nonce = 'nonce-4';
    const signature = sign(timestamp, nonce, 'GET', '/designs');
    const ctx = makeContext({
      'x-internal-timestamp': timestamp,
      'x-internal-nonce': nonce,
      'x-internal-signature': signature,
    });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects when the signed path does not match the request path (tampered routing)', () => {
    const timestamp = String(Date.now());
    const nonce = 'nonce-5';
    const signature = sign(timestamp, nonce, 'GET', '/designs');
    const ctx = makeContext(
      {
        'x-internal-timestamp': timestamp,
        'x-internal-nonce': nonce,
        'x-internal-signature': signature,
      },
      'GET',
      '/admin/users',
    );
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
