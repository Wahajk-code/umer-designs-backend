import request from 'supertest';
import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { signInternalRequest } from '@/common/security/internal-signature.util';

/**
 * Wraps supertest so every e2e call carries a valid internal attestation
 * header set, exactly as the BFF would produce — the app under test never
 * sees a request that "just discovered" its address.
 */
export function internalRequest(app: INestApplication) {
  const secret = process.env.INTERNAL_HMAC_SECRET as string;

  function attest(method: string, path: string) {
    const timestamp = String(Date.now());
    const nonce = randomUUID();
    const signature = signInternalRequest(secret, timestamp, nonce, method, path);
    return {
      'x-internal-timestamp': timestamp,
      'x-internal-nonce': nonce,
      'x-internal-signature': signature,
    };
  }

  const server = app.getHttpServer();

  return {
    get: (path: string) => request(server).get(path).set(attest('GET', path)),
    post: (path: string) => request(server).post(path).set(attest('POST', path)),
    patch: (path: string) => request(server).patch(path).set(attest('PATCH', path)),
    delete: (path: string) => request(server).delete(path).set(attest('DELETE', path)),
  };
}
