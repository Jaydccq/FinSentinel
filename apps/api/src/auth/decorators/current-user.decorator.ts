import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface CurrentUserPayload {
  userId: string;
  username: string;
  /**
   * Per-token JWT ID (UUID). Optional today, populated by JwtGuard from the
   * validated payload. Carried through so a future revocation layer (jti
   * blacklist) can short-circuit per-request without re-decoding the token.
   */
  jti?: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return (request as Request & { user: CurrentUserPayload }).user;
  },
);
