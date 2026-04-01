import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { McpApiKeyGuard } from '../mcp-api-key.guard';

/**
 * Creates a minimal ExecutionContext mock for HTTP requests.
 */
function createMockContext(headers: Record<string, string> = {}) {
  const request: Record<string, unknown> = { headers };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    request, // exposed for assertions
  };
}

describe('McpApiKeyGuard', () => {
  let guard: McpApiKeyGuard;
  let configService: ConfigService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        McpApiKeyGuard,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const config: Record<string, string> = {
                'mcp.apiKey': 'test-mcp-key-123',
                'mcp.userId': 'mcp-user-uuid',
              };
              return config[key];
            },
          },
        },
      ],
    }).compile();

    guard = module.get(McpApiKeyGuard);
    configService = module.get(ConfigService);
  });

  it('should allow request with valid API key', () => {
    const ctx = createMockContext({ 'x-api-key': 'test-mcp-key-123' });

    const result = guard.canActivate(ctx as never);

    expect(result).toBe(true);
  });

  it('should set synthetic user on request when key is valid', () => {
    const ctx = createMockContext({ 'x-api-key': 'test-mcp-key-123' });

    guard.canActivate(ctx as never);

    expect(ctx.request['user']).toEqual({
      userId: 'mcp-user-uuid',
      username: 'mcp',
    });
  });

  it('should throw UnauthorizedException when API key is missing', () => {
    const ctx = createMockContext({});

    expect(() => guard.canActivate(ctx as never)).toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException when API key is wrong', () => {
    const ctx = createMockContext({ 'x-api-key': 'wrong-key' });

    expect(() => guard.canActivate(ctx as never)).toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException when configured key is undefined', async () => {
    // Re-build with no configured key
    const module = await Test.createTestingModule({
      providers: [
        McpApiKeyGuard,
        {
          provide: ConfigService,
          useValue: {
            get: () => undefined,
          },
        },
      ],
    }).compile();

    const guardNoKey = module.get(McpApiKeyGuard);
    const ctx = createMockContext({ 'x-api-key': 'some-key' });

    expect(() => guardNoKey.canActivate(ctx as never)).toThrow(
      UnauthorizedException,
    );
  });
});
