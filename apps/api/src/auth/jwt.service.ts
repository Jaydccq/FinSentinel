import { Injectable, Inject } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { jwtConfig } from '../config/jwt.config';

/**
 * Runtime-validated JWT payload shape. We do NOT trust the decoded payload's
 * TypeScript types — `jose` returns `JWTPayload` with `[key: string]: unknown`,
 * so a malformed-but-signature-valid token (e.g. crafted by an attacker who
 * gained brief access to a signing key, or a legacy token) could otherwise
 * pass through with `userId` as `undefined`.
 *
 * All claims are required so downstream code can rely on their presence:
 *  - `sub`  username
 *  - `uid`  user id (UUID)
 *  - `iss`/`aud`  enforced again by jwtVerify but re-validated for shape
 *  - `jti`  per-token id, prep for the future revocation layer
 */
export const jwtPayloadSchema = z.object({
  sub: z.string().min(1),
  uid: z.string().uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
  iss: z.string().min(1),
  aud: z.union([z.string(), z.array(z.string())]),
  jti: z.string().uuid(),
});

export type JwtPayload = z.infer<typeof jwtPayloadSchema>;

/**
 * Refresh-token payload. Structurally identical to access tokens except
 * `aud` is fixed to `REFRESH_TOKEN_AUDIENCE` and there is a custom `fid`
 * (family id) claim used for rolling-rotation reuse detection.
 */
export const refreshTokenPayloadSchema = jwtPayloadSchema.extend({
  fid: z.string().uuid(),
});

export type RefreshTokenPayload = z.infer<typeof refreshTokenPayloadSchema>;

@Injectable()
export class JwtService {
  private readonly secret: Uint8Array;

  constructor(@Inject(jwtConfig.KEY) private readonly config: ConfigType<typeof jwtConfig>) {
    this.secret = new TextEncoder().encode(config.secret);
  }

  /**
   * Legacy single-token path. Used when `AUTH_REFRESH_TOKENS_ENABLED=false`
   * (the default). Emits a token with the standard access audience and the
   * full `JWT_EXPIRATION` lifetime. DO NOT change this signature — keeping
   * it stable preserves byte-identical default behavior.
   */
  async generateToken(username: string, userId: string): Promise<string> {
    return new SignJWT({ uid: userId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(username)
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + this.config.expiration / 1000)
      .sign(this.secret);
  }

  /**
   * Short-lived access token. Used when `AUTH_REFRESH_TOKENS_ENABLED=true`.
   * Identical claim shape to `generateToken` but with a caller-supplied
   * lifetime (typically 15 minutes) and an optional caller-supplied jti so
   * that callers that pre-generate the jti for tracking can pass it through.
   */
  async generateAccessToken(
    username: string,
    userId: string,
    ttlMs: number,
    jti: string = randomUUID(),
  ): Promise<{ token: string; jti: string; expSeconds: number }> {
    const expSeconds = Math.floor(Date.now() / 1000) + Math.floor(ttlMs / 1000);
    const token = await new SignJWT({ uid: userId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(username)
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(expSeconds)
      .sign(this.secret);
    return { token, jti, expSeconds };
  }

  /**
   * Long-lived refresh token. The `aud` is fixed to the dedicated
   * REFRESH_TOKEN_AUDIENCE so JwtGuard (which verifies with the access
   * audience) cannot accidentally admit a refresh token on a protected
   * route. The `fid` family-id claim is the rolling-rotation anchor.
   */
  async generateRefreshToken(
    username: string,
    userId: string,
    familyId: string,
    ttlMs: number,
    jti: string = randomUUID(),
  ): Promise<{ token: string; jti: string; familyId: string; expSeconds: number }> {
    const expSeconds = Math.floor(Date.now() / 1000) + Math.floor(ttlMs / 1000);
    const token = await new SignJWT({ uid: userId, fid: familyId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(username)
      .setIssuer(this.config.issuer)
      .setAudience(this.config.refreshAudience)
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(expSeconds)
      .sign(this.secret);
    return { token, jti, familyId, expSeconds };
  }

  async validateToken(
    token: string,
  ): Promise<{ username: string; userId: string; jti: string } | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: this.config.issuer,
        audience: this.config.audience,
      });
      const parsed = jwtPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        return null;
      }
      return {
        username: parsed.data.sub,
        userId: parsed.data.uid,
        jti: parsed.data.jti,
      };
    } catch {
      return null;
    }
  }

  /**
   * Verify a refresh token. Uses the dedicated refresh audience so an
   * access token cannot be replayed here either. Returns the parsed
   * family id + jti + user id on success.
   */
  async validateRefreshToken(token: string): Promise<{
    username: string;
    userId: string;
    jti: string;
    familyId: string;
    expSeconds: number;
  } | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: this.config.issuer,
        audience: this.config.refreshAudience,
      });
      const parsed = refreshTokenPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        return null;
      }
      return {
        username: parsed.data.sub,
        userId: parsed.data.uid,
        jti: parsed.data.jti,
        familyId: parsed.data.fid,
        expSeconds: parsed.data.exp,
      };
    } catch {
      return null;
    }
  }
}
