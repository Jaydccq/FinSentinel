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

@Injectable()
export class JwtService {
  private readonly secret: Uint8Array;

  constructor(
    @Inject(jwtConfig.KEY) private readonly config: ConfigType<typeof jwtConfig>,
  ) {
    this.secret = new TextEncoder().encode(config.secret);
  }

  async generateToken(username: string, userId: string): Promise<string> {
    return new SignJWT({ uid: userId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(username)
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(
        Math.floor(Date.now() / 1000) + this.config.expiration / 1000,
      )
      .sign(this.secret);
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
}
