import { createHmac, timingSafeEqual } from 'crypto';
import { ReplayCacheService } from '@/common/security/replay-cache.service';

/**
 * Canonical string signed by the BFF and verified here. Deliberately excludes
 * the request body (avoids raw-body-capture/canonicalization mismatches across
 * two separate codebases) — integrity relies on the private network boundary
 * plus TLS; this scheme's job is to prove the caller holds INTERNAL_HMAC_SECRET
 * and to block replay via timestamp + nonce, not to authenticate payload bytes.
 */
export function buildInternalSignaturePayload(
  timestamp: string,
  nonce: string,
  method: string,
  path: string,
): string {
  return `${timestamp}.${nonce}.${method.toUpperCase()}.${path}`;
}

export function signInternalRequest(
  secret: string,
  timestamp: string,
  nonce: string,
  method: string,
  path: string,
): string {
  const payload = buildInternalSignaturePayload(timestamp, nonce, method, path);
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function timingSafeCompareHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export interface InternalAttestationInput {
  timestamp: string | undefined;
  nonce: string | undefined;
  signature: string | undefined;
  method: string;
  path: string;
}

/**
 * Shared by the HTTP InternalAttestationGuard and the WebSocket gateway
 * (which sits outside Nest's HTTP guard pipeline) so both enforce identically:
 * fresh timestamp, unreplayed nonce, valid HMAC signature.
 */
export function verifyInternalAttestation(
  input: InternalAttestationInput,
  secret: string,
  windowMs: number,
  replayCache: ReplayCacheService,
): { ok: true } | { ok: false; reason: string } {
  const { timestamp, nonce, signature, method, path } = input;
  if (!timestamp || !nonce || !signature) {
    return { ok: false, reason: 'Missing internal attestation headers.' };
  }

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, reason: 'Invalid internal attestation timestamp.' };
  }

  const now = Date.now();
  if (Math.abs(now - timestampMs) > windowMs) {
    return { ok: false, reason: 'Internal attestation timestamp outside allowed window.' };
  }

  const expected = signInternalRequest(secret, timestamp, nonce, method, path);
  if (!timingSafeCompareHex(expected, signature)) {
    return { ok: false, reason: 'Invalid internal attestation signature.' };
  }

  if (replayCache.checkAndRecord(nonce, now + windowMs)) {
    return { ok: false, reason: 'Internal attestation nonce already used.' };
  }

  return { ok: true };
}
