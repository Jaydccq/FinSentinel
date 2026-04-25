import {
  Controller,
  Post,
  Body,
  Res,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { decodeJwt } from 'jose';
import type { Request, Response } from 'express';
import { registerRequestSchema, loginRequestSchema } from '@finsentinel/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { AuthService } from './auth.service';
import { JwtService } from './jwt.service';
import { RefreshService } from './refresh.service';
import { RevocationService } from './revocation.service';
import type { RegisterRequest, LoginRequest } from '@finsentinel/shared';
import type { AuthRuntimeConfig } from '../config/auth.config';

const DESKTOP_CLIENT = 'desktop';
const CSRF_COOKIE_NAME = 'FS_CSRF';
const REFRESH_COOKIE_NAME = 'FS_REFRESH';
const REFRESH_COOKIE_PATH = '/api/auth/refresh';

/** Loopback / RFC-1918 trusted proxy CIDRs — mirrors RateLimitGuard. */
const TRUSTED_PROXY_PATTERNS = [
  /^127\./,
  /^::1$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
];

/**
 * Resolve client IP, preferring `X-Forwarded-For` only when the direct
 * connection is from a trusted proxy. Mirrors the policy used by
 * RateLimitGuard so per-IP rate-limit keys and per-(username, ip) lockout
 * keys identify the same client.
 */
function resolveClientIp(request: Request): string {
  const directIp = request.ip ?? '0.0.0.0';
  const trusted = TRUSTED_PROXY_PATTERNS.some((p) => p.test(directIp));
  if (trusted) {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      const first = forwarded.split(',')[0]!.trim();
      if (first) return first;
    }
  }
  return directIp;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
    private readonly refreshService: RefreshService,
    private readonly revocationService: RevocationService,
    private readonly config: ConfigService,
  ) {}

  private readAuthConfig(): AuthRuntimeConfig {
    return this.config.get<AuthRuntimeConfig>('auth')!;
  }

  private cookieOpts() {
    const cfg = this.readAuthConfig();
    return {
      httpOnly: true,
      secure: cfg.cookie.secure,
      sameSite: cfg.cookie.sameSite,
      maxAge: cfg.cookie.maxAgeMs,
      path: '/',
      ...(cfg.cookie.domain ? { domain: cfg.cookie.domain } : {}),
    };
  }

  /**
   * Cookie options for the access cookie when refresh-tokens are ON.
   * Same attributes, but the maxAge tracks the access TTL so the cookie
   * does not outlive its token (the token would still be unusable past
   * its `exp`, but mirroring lifetimes keeps DevTools sane).
   */
  private accessCookieOpts() {
    const cfg = this.readAuthConfig();
    return {
      httpOnly: true,
      secure: cfg.cookie.secure,
      sameSite: cfg.cookie.sameSite,
      maxAge: cfg.accessTokenTtlMsWhenRefreshOn,
      path: '/',
      ...(cfg.cookie.domain ? { domain: cfg.cookie.domain } : {}),
    };
  }

  /**
   * Refresh cookie. Path-scoped to /api/auth/refresh so the browser does
   * NOT include it on regular API calls — that minimises the blast radius
   * if an XSS payload were to ever bypass the HttpOnly flag (it cannot
   * read the cookie, but it could trigger requests; restricting the path
   * means no requests other than the explicit refresh endpoint can ever
   * carry it).
   */
  private refreshCookieOpts() {
    const cfg = this.readAuthConfig();
    return {
      httpOnly: true,
      secure: cfg.cookie.secure,
      sameSite: cfg.cookie.sameSite,
      maxAge: cfg.refreshTokenTtlMs,
      path: REFRESH_COOKIE_PATH,
      ...(cfg.cookie.domain ? { domain: cfg.cookie.domain } : {}),
    };
  }

  /**
   * CSRF cookie options mirror the auth cookie's secure/sameSite/maxAge so the
   * two cookies have the same lifetime, but `httpOnly` is FALSE so that the
   * frontend JS can read the value out and echo it back in the
   * `X-CSRF-Token` header (double-submit pattern).
   *
   * When refresh tokens are ON, mirror the access-cookie maxAge so CSRF
   * rotates with the access token (matches PRD §2 requirement).
   */
  private csrfCookieOpts() {
    const cfg = this.readAuthConfig();
    const maxAge = cfg.refreshTokensEnabled
      ? cfg.accessTokenTtlMsWhenRefreshOn
      : cfg.cookie.maxAgeMs;
    return {
      httpOnly: false,
      secure: cfg.cookie.secure,
      sameSite: cfg.cookie.sameSite,
      maxAge,
      path: '/',
      ...(cfg.cookie.domain ? { domain: cfg.cookie.domain } : {}),
    };
  }

  private cookieName(): string {
    return this.readAuthConfig().cookie.name;
  }

  /**
   * Generate a new CSRF value and set the FS_CSRF cookie. Called on
   * register/login so each session gets a fresh per-session token.
   */
  private issueCsrfCookie(res: Response): void {
    res.cookie(CSRF_COOKIE_NAME, randomUUID(), this.csrfCookieOpts());
  }

  /**
   * Browser path: cookie is the source of truth, drop the token from the body
   * to shrink the bearer-token blast radius. Desktop / SDK callers opt in to
   * receiving the token by setting `X-Client: desktop`.
   */
  private shapeBody(
    full: { token: string; username: string; email: string },
    headers: Record<string, string | string[] | undefined>,
  ) {
    const raw = headers['x-client'] ?? headers['X-Client'];
    const client = Array.isArray(raw) ? raw[0] : raw;
    if (client === DESKTOP_CLIENT) return full;
    const { token: _drop, ...rest } = full;
    return rest;
  }

  /**
   * Issue access (and, when the flag is on, refresh) cookies after a
   * successful credential check. Returns the access token string so the
   * caller can echo it through `shapeBody` for desktop clients.
   *
   * Default (flag OFF): byte-identical to the previous behavior — uses
   * the legacy generateToken path that AuthService already produced, so
   * this method just sets the FS_AUTH cookie and returns that token.
   *
   * Flag ON: the legacy token from AuthService is discarded; we mint a
   * 15-min access token and a 7-day refresh family here.
   */
  private async setAuthCookies(
    res: Response,
    legacyToken: string,
    username: string,
    userId: string,
  ): Promise<string> {
    const cfg = this.readAuthConfig();

    if (!cfg.refreshTokensEnabled) {
      // ── Default path. Behavior must equal pre-flag main exactly. ──────
      res.cookie(this.cookieName(), legacyToken, this.cookieOpts());
      this.issueCsrfCookie(res);
      return legacyToken;
    }

    // ── Refresh-tokens enabled: mint short access + family-anchored refresh. ─
    const access = await this.jwtService.generateAccessToken(
      username,
      userId,
      cfg.accessTokenTtlMsWhenRefreshOn,
    );
    const refresh = await this.refreshService.issueNewFamily(username, userId);

    res.cookie(this.cookieName(), access.token, this.accessCookieOpts());
    res.cookie(REFRESH_COOKIE_NAME, refresh.token, this.refreshCookieOpts());
    this.issueCsrfCookie(res);
    return access.token;
  }

  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: RegisterRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const result = await this.authService.register(body);
    const tokenForBody = await this.setAuthCookies(
      res,
      result.token,
      result.username,
      // AuthResponse doesn't carry userId today, but AuthService set the
      // token with `created.id` as `uid` — decode it to recover that id
      // without changing the public AuthResponse shape.
      decodeUidFromToken(result.token),
    );
    return this.shapeBody(
      { ...result, token: tokenForBody },
      headers,
    );
  }

  /**
   * Login is the only auth surface protected by:
   *   - per-IP rate limit: 20 attempts / 60s (RateLimitGuard, Redis-backed)
   *   - per-(username, ip) consecutive-failure lockout (LoginProtectionService)
   *
   * Register is intentionally NOT rate-limited here — different threat model
   * (account creation abuse) needs CAPTCHAs / email verification, not throttling.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 20, windowSecs: 60, key: 'auth-login' })
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const clientIp = resolveClientIp(req);
    const result = await this.authService.login(body, clientIp);
    const tokenForBody = await this.setAuthCookies(
      res,
      result.token,
      result.username,
      decodeUidFromToken(result.token),
    );
    return this.shapeBody({ ...result, token: tokenForBody }, headers);
  }

  /**
   * POST /api/auth/refresh — only mounted (logically) when
   * AUTH_REFRESH_TOKENS_ENABLED=true. When the flag is OFF, every call
   * returns 404 so the surface area is exactly equivalent to today's main.
   *
   * Behavior when flag is ON:
   *   1. Read FS_REFRESH cookie. Missing → 401.
   *   2. Verify + rotate. Reuse / expired / missing family → 401.
   *   3. Mint new refresh + access; issue new FS_AUTH, FS_REFRESH, FS_CSRF.
   *   4. Return 204 No Content.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.NO_CONTENT)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const cfg = this.readAuthConfig();
    if (!cfg.refreshTokensEnabled) {
      // Flag OFF → endpoint does not exist. 404 keeps the surface area
      // byte-identical to today's main.
      throw new NotFoundException();
    }

    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
    const rawRefresh = cookies[REFRESH_COOKIE_NAME];
    if (!rawRefresh) {
      throw new UnauthorizedException();
    }

    // Rotate first (this also verifies the token + checks for reuse).
    const newRefresh = await this.refreshService.rotate(rawRefresh);
    if (!newRefresh) {
      throw new UnauthorizedException();
    }

    // peek() re-decodes the OLD raw token to recover the userId/username
    // for issuing the new access token. Safe because validateRefreshToken
    // already accepted it inside rotate().
    const peeked = await this.refreshService.peek(rawRefresh);
    if (!peeked) {
      // Should be unreachable — rotate() succeeded so the token is valid.
      throw new UnauthorizedException();
    }

    const access = await this.jwtService.generateAccessToken(
      peeked.username,
      peeked.userId,
      cfg.accessTokenTtlMsWhenRefreshOn,
    );

    res.cookie(this.cookieName(), access.token, this.accessCookieOpts());
    res.cookie(REFRESH_COOKIE_NAME, newRefresh.token, this.refreshCookieOpts());
    this.issueCsrfCookie(res);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const cfg = this.readAuthConfig();
    const opts = this.cookieOpts();
    const clearOpts = {
      httpOnly: opts.httpOnly,
      secure: opts.secure,
      sameSite: opts.sameSite,
      path: opts.path,
      ...('domain' in opts ? { domain: opts.domain as string } : {}),
    };

    // ── M4: jti revocation ─────────────────────────────────────────────
    // When the flag is ON, decode the existing access cookie (no signature
    // check needed — we already trust we set it) and add its jti to the
    // Redis revocation set with TTL = (exp - now).
    if (cfg.jtiRevocationEnabled) {
      try {
        const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
        const raw = cookies[this.cookieName()];
        if (raw) {
          const claims = decodeJwt(raw);
          const jti = typeof claims.jti === 'string' ? claims.jti : null;
          const exp = typeof claims.exp === 'number' ? claims.exp : null;
          if (jti && exp) {
            const nowSec = Math.floor(Date.now() / 1000);
            const ttl = exp - nowSec;
            if (ttl > 0) {
              await this.revocationService.revoke(jti, ttl);
            }
          }
        }
      } catch {
        // Malformed cookie at logout is benign — clearing the cookie still
        // happens below; we just can't blacklist what we can't parse.
      }
    }

    // ── M3: invalidate refresh family ──────────────────────────────────
    if (cfg.refreshTokensEnabled) {
      try {
        const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
        const rawRefresh = cookies[REFRESH_COOKIE_NAME];
        if (rawRefresh) {
          const peeked = await this.refreshService.peek(rawRefresh);
          if (peeked) {
            await this.refreshService.invalidateFamily(peeked.userId, peeked.familyId);
          }
        }
      } catch {
        // Same logic as above — best-effort cleanup.
      }
    }

    res.clearCookie(this.cookieName(), clearOpts);
    res.clearCookie(CSRF_COOKIE_NAME, { ...clearOpts, httpOnly: false });
    if (cfg.refreshTokensEnabled) {
      const refreshClear = {
        httpOnly: opts.httpOnly,
        secure: opts.secure,
        sameSite: opts.sameSite,
        path: REFRESH_COOKIE_PATH,
        ...('domain' in opts ? { domain: opts.domain as string } : {}),
      };
      res.clearCookie(REFRESH_COOKIE_NAME, refreshClear);
    }
  }
}

/**
 * Recover the `uid` claim from a token we just minted. AuthService's
 * `AuthResponse` does not carry the user id today, but the token's `uid`
 * claim does — decoding the token we just produced is cheap and avoids
 * widening the public AuthResponse contract for an internal need.
 */
function decodeUidFromToken(token: string): string {
  try {
    const claims = decodeJwt(token);
    if (typeof claims.uid === 'string') return claims.uid;
  } catch {
    /* fall through */
  }
  return '';
}
