import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';

/**
 * Guard that authenticates MCP requests via X-API-Key header.
 *
 * When the key matches the configured `MCP_API_KEY`, a synthetic user
 * is attached to the request so downstream services (ToolRegistry,
 * @CurrentUser decorator) work transparently.
 *
 * Guard for MCP API-key authentication.
 */
@Injectable()
export class McpApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.headers['x-api-key'] as string | undefined;
    const configuredKey = this.config.get<string>('mcp.apiKey');

    if (!configuredKey || apiKey !== configuredKey) {
      throw new UnauthorizedException('Invalid MCP API key');
    }

    // Attach synthetic user for downstream @CurrentUser() decorator
    const syntheticUser: CurrentUserPayload = {
      userId: this.config.get<string>('mcp.userId') ?? 'mcp-default',
      username: 'mcp',
    };
    (request as Request & { user: CurrentUserPayload }).user = syntheticUser;

    return true;
  }
}
