import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import {
  RATE_LIMIT_KEY,
  type RateLimitOptions,
} from '../decorators/rate-limit.decorator';
import { RateLimiterService } from '../services/rate-limiter.service';
import { MetricsService } from '../services/metrics.service';

/** CIDRs considered trusted proxies (loopback + RFC-1918) */
const TRUSTED_PROXY_PATTERNS = [
  /^127\./, // 127.0.0.0/8
  /^::1$/, // IPv6 loopback
  /^10\./, // 10.0.0.0/8
  /^192\.168\./, // 192.168.0.0/16
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
];

function isTrustedProxy(ip: string): boolean {
  return TRUSTED_PROXY_PATTERNS.some((pattern) => pattern.test(ip));
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimiter: RateLimiterService,
    private readonly metrics: MetricsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<RateLimitOptions>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );

    // No @RateLimit decorator on this handler — pass through
    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // ── Resolve dimension + identifier ──────────────────────────────────
    const user = (request as Request & { user?: { username: string } }).user;
    const dimension: 'user' | 'ip' = user ? 'user' : 'ip';
    const identifier = user ? user.username : this.resolveClientIp(request);

    // ── Resolve endpoint key ────────────────────────────────────────────
    const endpoint = options.key || `${request.method}:${request.route?.path ?? request.path}`;

    const endTimer = this.metrics.startHistogramTimer(
      'rate_limit_check_duration_seconds',
      'Duration of Redis rate-limit Lua check in seconds',
      { endpoint },
      [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05],
    );

    const result = await this.rateLimiter.check({
      dimension,
      identifier,
      endpoint,
      limit: options.limit!,
      windowSecs: options.windowSecs!,
    });

    endTimer();

    const outcome = result.allowed ? 'allowed' : 'denied';

    this.metrics.incrementCounter(
      'rate_limit_checks_total',
      'Total rate-limit checks by endpoint and outcome',
      { endpoint, outcome },
    );

    this.metrics.setGauge(
      'rate_limit_remaining',
      'Remaining requests in the current rate-limit window',
      { endpoint, dimension },
      result.remaining,
    );

    // Always set informational headers
    response.setHeader('X-RateLimit-Limit', options.limit!);
    response.setHeader('X-RateLimit-Remaining', result.remaining);

    if (!result.allowed) {
      const retryAfterSecs = Math.ceil(result.retryAfterMs / 1000);
      response.setHeader('Retry-After', retryAfterSecs);

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests',
          retryAfterMs: result.retryAfterMs,
          retryAfterSecs,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /**
   * Resolve client IP, respecting X-Forwarded-For only when the direct
   * connection comes from a trusted proxy.
   */
  private resolveClientIp(request: Request): string {
    const directIp = request.ip ?? '0.0.0.0';

    if (isTrustedProxy(directIp)) {
      const forwarded = request.headers['x-forwarded-for'];
      if (typeof forwarded === 'string') {
        // First entry is the original client IP
        const clientIp = forwarded.split(',')[0]!.trim();
        if (clientIp) return clientIp;
      }
    }

    return directIp;
  }
}
