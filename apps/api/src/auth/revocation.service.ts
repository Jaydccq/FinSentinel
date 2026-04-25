import { Injectable, Inject } from '@nestjs/common';
import type Redis from 'ioredis';

/**
 * Per-jti blacklist for access tokens. Key shape:
 *   `revoked_jti:<jti>` → '1' (value is irrelevant; presence is the signal)
 * TTL: configured to expire at the same time the token does, so the set
 * never grows unbounded.
 */
function revocationKey(jti: string): string {
  return `revoked_jti:${jti}`;
}

@Injectable()
export class RevocationService {
  constructor(@Inject('REDIS') private readonly redis: Redis) {}

  /**
   * Mark a jti as revoked. `ttlSeconds` should be `(token.exp - now)` —
   * once Redis evicts the key the token would also have expired, so the
   * blacklist self-heals.
   */
  async revoke(jti: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    await this.redis.set(revocationKey(jti), '1', 'EX', ttlSeconds);
  }

  /**
   * Returns true iff `jti` has been previously revoked and its TTL has
   * not yet elapsed.
   */
  async isRevoked(jti: string): Promise<boolean> {
    const exists = await this.redis.exists(revocationKey(jti));
    return exists === 1;
  }
}
