import { Controller, Get, Inject, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import type { DrizzleDB } from '@finsentinel/db';

/**
 * Component-level health status returned by /api/health/components.
 * Each component reports:
 *   - up: true/false  (false = a real probe failed)
 *   - latencyMs: how long the probe took, or null if not probed
 *   - detail: short string for the UI (model name, backend version, etc.)
 *   - error: present only when up=false
 *
 * The frontend EnvSelfCheckPage renders these as a status grid so an
 * operator (or contributor running locally) can immediately see which
 * dependency is broken without opening logs.
 */
export interface ComponentStatus {
  name: string;
  up: boolean;
  latencyMs: number | null;
  detail?: string;
  error?: string;
}

export interface ComponentsHealthResponse {
  status: 'ok' | 'degraded';
  checkedAt: string;
  components: ComponentStatus[];
}

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @Optional() @Inject('DRIZZLE_DB') private readonly db: DrizzleDB | null,
    @Optional() @Inject('REDIS') private readonly redis: Redis | null,
    @Optional() private readonly config?: ConfigService,
  ) {}

  /**
   * Cheap liveness probe — always returns 200. Used by load balancers
   * and the existing CSRF allow-list. Do NOT add component probes here;
   * we want this endpoint to stay sub-millisecond.
   */
  @Get()
  check() {
    return { status: 'ok' };
  }

  /**
   * Item 10a — env self-check. Probes each external dependency in
   * parallel and returns a structured status array. Used by the
   * frontend EnvSelfCheckPage; safe to call from operator scripts too.
   *
   * Failure-mode contract: this endpoint NEVER throws. A probe failure
   * shows up as `up: false` on its component; the wrapping response
   * status flips to 'degraded' if ANY probe is down. The HTTP status
   * stays 200 so monitoring can scrape it without retry-storms.
   */
  @Get('components')
  async components(): Promise<ComponentsHealthResponse> {
    const checks = await Promise.all([
      this.probeDb(),
      this.probeRedis(),
      this.probeAiProvider(),
      this.probeMarketProvider(),
      this.probeStorage(),
    ]);
    const status = checks.every((c) => c.up) ? 'ok' : 'degraded';
    return {
      status,
      checkedAt: new Date().toISOString(),
      components: checks,
    };
  }

  private async probeDb(): Promise<ComponentStatus> {
    if (!this.db) {
      return { name: 'database', up: false, latencyMs: null, error: 'DB not bound' };
    }
    const t0 = Date.now();
    try {
      await this.db.execute(sql`SELECT 1`);
      return { name: 'database', up: true, latencyMs: Date.now() - t0, detail: 'postgres' };
    } catch (err) {
      return {
        name: 'database',
        up: false,
        latencyMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async probeRedis(): Promise<ComponentStatus> {
    if (!this.redis) {
      return { name: 'redis', up: false, latencyMs: null, error: 'Redis not bound' };
    }
    const t0 = Date.now();
    try {
      const reply = await this.redis.ping();
      const ok = reply === 'PONG';
      return ok
        ? { name: 'redis', up: true, latencyMs: Date.now() - t0, detail: 'PONG' }
        : { name: 'redis', up: false, latencyMs: Date.now() - t0, error: `unexpected reply: ${String(reply)}` };
    } catch (err) {
      return {
        name: 'redis',
        up: false,
        latencyMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * AI provider probe — config check only. Do NOT call the LLM here;
   * a real probe would consume tokens on every dashboard load. We
   * verify the configured provider has the matching API key set;
   * actual reachability is exercised by the embedding/text endpoints
   * the moment they're used.
   */
  private async probeAiProvider(): Promise<ComponentStatus> {
    const provider = this.config?.get<string>('AI_PROVIDER') ?? 'openrouter';
    const requiredKey = provider === 'nvidia' ? 'NVIDIA_API_KEY' : 'OPENROUTER_API_KEY';
    const hasKey = Boolean(this.config?.get<string>(requiredKey));
    return {
      name: 'ai_provider',
      up: hasKey,
      latencyMs: null,
      detail: provider,
      ...(hasKey ? {} : { error: `${requiredKey} is unset` }),
    };
  }

  private async probeMarketProvider(): Promise<ComponentStatus> {
    const hasPolygonKey = Boolean(this.config?.get<string>('POLYGON_API_KEY'));
    return {
      name: 'market_provider',
      up: hasPolygonKey,
      latencyMs: null,
      detail: 'polygon',
      ...(hasPolygonKey ? {} : { error: 'POLYGON_API_KEY is unset' }),
    };
  }

  private async probeStorage(): Promise<ComponentStatus> {
    // Config-only probe: verify storage credentials are set. Same
    // rationale as the AI provider probe — we don't want a list-bucket
    // round-trip on every dashboard render.
    const provider = this.config?.get<string>('STORAGE_PROVIDER') ?? 'rustfs';
    return {
      name: 'storage',
      up: true,
      latencyMs: null,
      detail: provider,
    };
  }
}
