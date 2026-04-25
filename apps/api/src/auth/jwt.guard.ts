import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { JwtService } from './jwt.service';
import { RevocationService } from './revocation.service';
import type { CurrentUserPayload } from './decorators/current-user.decorator';
import type { AuthRuntimeConfig } from '../config/auth.config';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly revocationService: RevocationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException();
    }

    const payload = await this.jwtService.validateToken(token);
    if (!payload) {
      throw new UnauthorizedException();
    }

    // ── M4: jti revocation gate ─────────────────────────────────────────
    // When AUTH_JTI_REVOCATION_ENABLED=true, every authenticated request
    // costs one Redis EXISTS lookup against `revoked_jti:<jti>`. When OFF
    // (the default), this block is fully skipped — byte-identical to the
    // pre-M4 admit-on-signature-valid behavior.
    const cfg = this.config.get<AuthRuntimeConfig>('auth');
    if (cfg?.jtiRevocationEnabled && payload.jti) {
      const revoked = await this.revocationService.isRevoked(payload.jti);
      if (revoked) {
        throw new UnauthorizedException();
      }
    }

    // Attach user to request for @CurrentUser() decorator
    (request as Request & { user: CurrentUserPayload }).user = {
      userId: payload.userId,
      username: payload.username,
      ...(payload.jti ? { jti: payload.jti } : {}),
    };

    return true;
  }

  private extractToken(request: Request): string | null {
    const cookieName = this.config.get<AuthRuntimeConfig>('auth')?.cookie.name ?? 'FS_AUTH';
    const cookies = request.cookies as Record<string, string> | undefined;
    const cookieToken = cookies?.[cookieName];
    const authHeader = request.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

    // Distinguish caller class:
    // - Desktop / SDK (X-Client: desktop): bearer-auth flow. The desktop
    //   client manages its own token lifecycle and may not send a cookie
    //   at all; honor the Authorization header even when a (likely stale)
    //   cookie also happens to be present.
    // - Browser (no X-Client header, or anything else): cookie-auth flow.
    //   The cookie is the canonical, refresh-rotated source. A bearer
    //   header on a browser request would only show up if the web client
    //   carried a stale cached token across a silent refresh — preferring
    //   the cookie there avoids the post-refresh 401-loop.
    const xClientRaw = request.headers['x-client'];
    const xClient = Array.isArray(xClientRaw) ? xClientRaw[0] : xClientRaw;
    const isDesktopCaller = xClient === 'desktop';

    if (isDesktopCaller) {
      // Desktop bearer-auth: prefer Authorization, fall back to cookie.
      if (bearerToken) return bearerToken;
      if (cookieToken) return cookieToken;
      return null;
    }

    // Browser cookie-auth: prefer cookie, fall back to bearer for legacy
    // callers that don't yet send X-Client (e.g. the few internal scripts
    // that hit the API with a raw bearer for debugging).
    if (cookieToken) return cookieToken;
    if (bearerToken) return bearerToken;
    return null;
  }
}
