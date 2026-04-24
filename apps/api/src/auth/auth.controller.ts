import {
  Controller,
  Post,
  Body,
  Res,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { registerRequestSchema, loginRequestSchema } from '@finsentinel/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';
import type { RegisterRequest, LoginRequest } from '@finsentinel/shared';
import type { AuthRuntimeConfig } from '../config/auth.config';

const DESKTOP_CLIENT = 'desktop';

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

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const result = await this.authService.login(body);
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
