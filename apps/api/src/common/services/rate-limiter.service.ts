import { Injectable, Inject } from '@nestjs/common';
import type Redis from 'ioredis';

export interface RateLimitCheckParams {
  dimension: 'user' | 'ip';
  identifier: string;
  endpoint: string;
  limit: number;
  windowSecs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Fixed-window rate limiter backed by a Redis Lua script.
 *
 * Redis-backed request throttling for the API.
 * Key format: `rl:{dimension}:{identifier}:{endpoint}`
 */
const LUA_RATE_LIMIT = `
local key = KEYS[1]
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])

local current = redis.call('INCR', key)
if current == 1 then
    redis.call('EXPIRE', key, window)
end

local ttl = redis.call('TTL', key)
local allowed = current <= limit and 1 or 0
local remaining = math.max(0, limit - current)

return {allowed, remaining, ttl * 1000}
`;

@Injectable()
export class RateLimiterService {
  constructor(@Inject('REDIS') private readonly redis: Redis) {}

  /**
   * Execute the atomic Lua rate-limit script against Redis.
   * Uses ioredis redis.eval() to run a Lua script server-side — this is NOT
   * JavaScript eval() and carries no code-injection risk.
   */
  async check(params: RateLimitCheckParams): Promise<RateLimitResult> {
    const { dimension, identifier, endpoint, limit, windowSecs } = params;
    const key = `rl:${dimension}:${identifier}:${endpoint}`;

    // ioredis .eval(script, numKeys, ...keys, ...args)
    const result = (await this.redis.eval(LUA_RATE_LIMIT, 1, key, windowSecs, limit)) as [
      number,
      number,
      number,
    ];

    return {
      allowed: result[0] === 1,
      remaining: result[1],
      retryAfterMs: result[2],
    };
  }
}
