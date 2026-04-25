import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { JwtService } from './jwt.service';
import type { AuthRuntimeConfig } from '../config/auth.config';

/**
 * Per-family rolling-rotation store key.
 *
 * Key shape: `refresh:family:<userId>:<familyId>` → currentJti
 * TTL: refresh-token lifetime (default 7d).
 *
 * Reuse detection rule: when a refresh request arrives whose payload.jti
 * does NOT equal the value stored under this key, an OLD refresh has been
 * replayed. We DEL the family key to immediately invalidate every outstanding
 * descendant of that family — the legitimate holder will hit a 401 on its
 * next refresh and must re-login.
 */
function familyKey(userId: string, familyId: string): string {
  return `refresh:family:${userId}:${familyId}`;
}

export interface IssuedRefreshArtifact {
  token: string;
  jti: string;
  familyId: string;
  expSeconds: number;
}

@Injectable()
export class RefreshService {
  private readonly logger = new Logger(RefreshService.name);

  constructor(
    private readonly jwtService: JwtService,
    @Inject('REDIS') private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  private authConfig(): AuthRuntimeConfig {
    return this.config.get<AuthRuntimeConfig>('auth')!;
  }

  /**
   * Issue a brand-new refresh family. Called on register/login when the
   * refresh-tokens flag is on.
   */
  async issueNewFamily(username: string, userId: string): Promise<IssuedRefreshArtifact> {
    const familyId = randomUUID();
    const auth = this.authConfig();
    const issued = await this.jwtService.generateRefreshToken(
      username,
      userId,
      familyId,
      auth.refreshTokenTtlMs,
    );
    await this.redis.set(
      familyKey(userId, familyId),
      issued.jti,
      'PX',
      auth.refreshTokenTtlMs,
    );
    return issued;
  }

  /**
   * Verify + rotate a refresh token. Returns the freshly minted refresh
   * artifact on success, `null` on any failure (including reuse). On reuse
   * detection, the family is DEL'd so every descendant is invalidated.
   */
  async rotate(rawToken: string): Promise<IssuedRefreshArtifact | null> {
    const payload = await this.jwtService.validateRefreshToken(rawToken);
    if (!payload) return null;

    const key = familyKey(payload.userId, payload.familyId);
    const stored = await this.redis.get(key);
    if (!stored) {
      // Family already invalidated — either by previous reuse detection,
      // explicit logout, or natural TTL expiry. Treat as auth failure.
      return null;
    }
    if (stored !== payload.jti) {
      // ── REUSE DETECTED ────────────────────────────────────────────────
      // An OLD jti is being replayed. The legit holder rotated past this
      // jti, so this caller must be an attacker holding a leaked token.
      // Nuke the family.
      await this.redis.del(key);
      this.logger.warn(
        `refresh-reuse-detected user=${payload.userId} family=${payload.familyId} ` +
          `presented_jti=${payload.jti} expected=${stored} — family revoked`,
      );
      return null;
    }

    // Rotation: keep the same family, mint a new jti, replace the stored
    // pointer. TTL is reset to the configured refresh lifetime so an
    // active session does not expire mid-flight.
    const auth = this.authConfig();
    const issued = await this.jwtService.generateRefreshToken(
      payload.username,
      payload.userId,
      payload.familyId,
      auth.refreshTokenTtlMs,
    );
    await this.redis.set(key, issued.jti, 'PX', auth.refreshTokenTtlMs);
    return issued;
  }

  /**
   * Resolve the username/userId/familyId off a refresh token without
   * rotating. Used by /auth/refresh after `rotate()` has succeeded so the
   * controller can also mint a fresh access token tied to the same user.
   */
  async peek(rawToken: string): Promise<{
    username: string;
    userId: string;
    familyId: string;
  } | null> {
    const payload = await this.jwtService.validateRefreshToken(rawToken);
    if (!payload) return null;
    return {
      username: payload.username,
      userId: payload.userId,
      familyId: payload.familyId,
    };
  }

  /**
   * Logout: invalidate the entire family so every outstanding refresh
   * token (in any device the user might still be holding) is dead.
   */
  async invalidateFamily(userId: string, familyId: string): Promise<void> {
    await this.redis.del(familyKey(userId, familyId));
  }
}
