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
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { registerRequestSchema, loginRequestSchema } from '@finsentinel/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { AuthService } from './auth.service';
import type { RegisterRequest, LoginRequest } from '@finsentinel/shared';
import type { AuthRuntimeConfig } from '../config/auth.config';

const DESKTOP_CLIENT = 'desktop';

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

  private cookieName(): string {
    return this.readAuthConfig().cookie.name;
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

  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: RegisterRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const result = await this.authService.register(body);
    res.cookie(this.cookieName(), result.token, this.cookieOpts());
    return this.shapeBody(result, headers);
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
    res.cookie(this.cookieName(), result.token, this.cookieOpts());
    return this.shapeBody(result, headers);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) res: Response) {
    const opts = this.cookieOpts();
    res.clearCookie(this.cookieName(), {
      httpOnly: opts.httpOnly,
      secure: opts.secure,
      sameSite: opts.sameSite,
      path: opts.path,
      ...('domain' in opts ? { domain: opts.domain as string } : {}),
    });
  }
}
