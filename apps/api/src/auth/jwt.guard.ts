import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { JwtService } from './jwt.service';
import type { CurrentUserPayload } from './decorators/current-user.decorator';
import type { AuthRuntimeConfig } from '../config/auth.config';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
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

    // Attach user to request for @CurrentUser() decorator
    (request as Request & { user: CurrentUserPayload }).user = {
      userId: payload.userId,
      username: payload.username,
      ...(payload.jti ? { jti: payload.jti } : {}),
    };

    return true;
  }

  private extractToken(request: Request): string | null {
    // 1. Try Authorization: Bearer <token> header
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    // 2. Try the configured auth cookie. The name is env-driven via
    // AUTH_COOKIE_NAME (default 'FS_AUTH') so it must mirror what
    // AuthController writes — see apps/api/src/config/auth.config.ts.
    const cookieName = this.config.get<AuthRuntimeConfig>('auth')?.cookie.name ?? 'FS_AUTH';
    const cookies = request.cookies as Record<string, string> | undefined;
    if (cookies?.[cookieName]) {
      return cookies[cookieName];
    }

    return null;
  }
}
