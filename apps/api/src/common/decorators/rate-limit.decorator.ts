import { SetMetadata } from '@nestjs/common';

export interface RateLimitOptions {
  /** Max requests per window (default 60) */
  limit?: number;
  /** Window duration in seconds (default 60) */
  windowSecs?: number;
  /** Custom key suffix — when empty, auto-derived from METHOD:route_path */
  key?: string;
}

export const RATE_LIMIT_KEY = 'rateLimit';

export const RateLimit = (options: RateLimitOptions = {}) =>
  SetMetadata(RATE_LIMIT_KEY, {
    limit: 60,
    windowSecs: 60,
    key: '',
    ...options,
  });
