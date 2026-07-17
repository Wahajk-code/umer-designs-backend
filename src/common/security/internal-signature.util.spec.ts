import { ReplayCacheService } from '@/common/security/replay-cache.service';
import {
  signInternalRequest,
  verifyInternalAttestation,
} from '@/common/security/internal-signature.util';

const SECRET = 'a-shared-secret-that-is-long-enough';

describe('verifyInternalAttestation', () => {
  let replayCache: ReplayCacheService;

  beforeEach(() => {
    replayCache = new ReplayCacheService();
  });

  function sign(timestamp: string, nonce: string, method: string, path: string) {
    return signInternalRequest(SECRET, timestamp, nonce, method, path);
  }

  it('accepts a valid, fresh, unreplayed signature', () => {
    const timestamp = String(Date.now());
    const nonce = 'n1';
    const signature = sign(timestamp, nonce, 'GET', '/socket.io');
    const result = verifyInternalAttestation(
      { timestamp, nonce, signature, method: 'GET', path: '/socket.io' },
      SECRET,
      60000,
      replayCache,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects missing headers', () => {
    const result = verifyInternalAttestation(
      { timestamp: undefined, nonce: undefined, signature: undefined, method: 'GET', path: '/x' },
      SECRET,
      60000,
      replayCache,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a stale timestamp', () => {
    const timestamp = String(Date.now() - 120000);
    const nonce = 'n2';
    const signature = sign(timestamp, nonce, 'GET', '/socket.io');
    const result = verifyInternalAttestation(
      { timestamp, nonce, signature, method: 'GET', path: '/socket.io' },
      SECRET,
      60000,
      replayCache,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a replayed nonce', () => {
    const timestamp = String(Date.now());
    const nonce = 'n3';
    const signature = sign(timestamp, nonce, 'GET', '/socket.io');
    const input = { timestamp, nonce, signature, method: 'GET', path: '/socket.io' };
    expect(verifyInternalAttestation(input, SECRET, 60000, replayCache).ok).toBe(true);
    expect(verifyInternalAttestation(input, SECRET, 60000, replayCache).ok).toBe(false);
  });

  it('rejects a signature computed for a different path (cannot be replayed cross-channel)', () => {
    const timestamp = String(Date.now());
    const nonce = 'n4';
    const signature = sign(timestamp, nonce, 'GET', '/designs');
    const result = verifyInternalAttestation(
      { timestamp, nonce, signature, method: 'GET', path: '/socket.io' },
      SECRET,
      60000,
      replayCache,
    );
    expect(result.ok).toBe(false);
  });
});
