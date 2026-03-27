import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtService } from './jwt.service';
import type { CurrentUserPayload } from './decorators/current-user.decorator';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

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
    };

    return true;
  }

  private extractToken(request: Request): string | null {
    // 1. Try Authorization: Bearer <token> header
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    // 2. Try FS_AUTH cookie
    const cookies = request.cookies as Record<string, string> | undefined;
    if (cookies?.['FS_AUTH']) {
      return cookies['FS_AUTH'];
    }

    return null;
  }
}
