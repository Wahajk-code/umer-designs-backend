import { Injectable } from '@nestjs/common';

/**
 * In-memory nonce store for internal-attestation replay protection. A single
 * Nest instance is assumed for local/dev; for multi-instance production
 * deployments this would move to Redis, but the interface stays the same.
 */
@Injectable()
export class ReplayCacheService {
  private readonly seen = new Map<string, number>();

  /** Returns true if the nonce was already seen (replay). Records it either way. */
  checkAndRecord(nonce: string, expiresAtMs: number): boolean {
    this.sweep();
    if (this.seen.has(nonce)) {
      return true;
    }
    this.seen.set(nonce, expiresAtMs);
    return false;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [nonce, expiresAt] of this.seen) {
      if (expiresAt < now) {
        this.seen.delete(nonce);
      }
    }
  }
}
