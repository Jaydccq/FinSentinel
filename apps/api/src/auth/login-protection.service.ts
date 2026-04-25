import { Injectable, Inject, Logger } from '@nestjs/common';
import type Redis from 'ioredis';

/**
 * Per-(username, ip) consecutive-failure tracker for the login endpoint.
 *
 * Complements the per-IP rate-limit guard (20 / 60s) with:
 *   - exponential soft delay on each failed attempt (`100ms * 2^fails`, cap 5s)
 *   - hard lockout after 10 consecutive failures (15-minute TTL, returns 423)
 *
 * Both fail counter and lockout key live in Redis, keyed by (username, ip), so
 * lockouts survive process restarts and apply across multiple API replicas.
 */

const FAIL_TTL_SECONDS = 15 * 60; // 15 minutes
const LOCK_TTL_SECONDS = 15 * 60; // 15 minutes
const LOCK_THRESHOLD = 10; // consecutive failures before hard lockout
const SOFT_DELAY_BASE_MS = 100;
const SOFT_DELAY_CAP_MS = 5_000;
const SOFT_DELAY_EXP_CAP = 6; // 100 * 2^6 = 6400, clamped to 5000

export interface RecordFailureResult {
  fails: number;
  lockedUntil?: number; // epoch ms when lock will release, present iff just locked
}

@Injectable()
export class LoginProtectionService {
  private readonly logger = new Logger(LoginProtectionService.name);

  constructor(@Inject('REDIS') private readonly redis: Redis) {}

  private failKey(username: string, ip: string): string {
    return `login:fails:${username}:${ip}`;
  }

  private lockKey(username: string, ip: string): string {
    return `login:lock:${username}:${ip}`;
  }

  /**
   * Returns `true` when (username, ip) is currently locked. The login flow
   * MUST call this BEFORE the password check so the lock takes precedence
   * over even a correct password — this is the "you're locked even if you
   * guessed right" guarantee.
   */
  async checkLocked(username: string, ip: string): Promise<boolean> {
    const exists = await this.redis.exists(this.lockKey(username, ip));
    return exists === 1;
  }

  /**
   * INCRs the per-(username, ip) failure counter and returns the new count.
   * On the first failure we set a 15-min TTL so stale counts don't haunt the
   * key forever. When the counter hits LOCK_THRESHOLD (10), we additionally
   * SET a lock key with a 15-min TTL.
   */
  async recordFailure(username: string, ip: string): Promise<RecordFailureResult> {
    const key = this.failKey(username, ip);
    const fails = await this.redis.incr(key);
    if (fails === 1) {
      await this.redis.expire(key, FAIL_TTL_SECONDS);
    }

    if (fails >= LOCK_THRESHOLD) {
      const lockKey = this.lockKey(username, ip);
      // SET with EX (seconds). Use ioredis's variadic form.
      await this.redis.set(lockKey, '1', 'EX', LOCK_TTL_SECONDS);
      this.logger.warn(`Login locked: username=${username} ip=${ip} fails=${fails}`);
      return { fails, lockedUntil: Date.now() + LOCK_TTL_SECONDS * 1000 };
    }

    return { fails };
  }

  /**
   * Compute the soft-delay duration for a failed attempt.
   *
   * Formula: 100ms * 2^min(fails, 6), capped at 5000ms.
   *   1 fail  → 200ms
   *   2 fails → 400ms
   *   3 fails → 800ms
   *   4 fails → 1600ms
   *   5 fails → 3200ms
   *   6+ fails → 5000ms (cap)
   */
  computeDelayMs(fails: number): number {
    if (fails <= 0) return 0;
    const exp = Math.min(fails, SOFT_DELAY_EXP_CAP);
    return Math.min(SOFT_DELAY_CAP_MS, SOFT_DELAY_BASE_MS * 2 ** exp);
  }

  /**
   * Successful login — clear both the fail counter and the lock key for this
   * (username, ip) pair. Idempotent: safe to call when keys are absent.
   */
  async resetOnSuccess(username: string, ip: string): Promise<void> {
    await Promise.all([
      this.redis.del(this.failKey(username, ip)),
      this.redis.del(this.lockKey(username, ip)),
    ]);
  }
}
