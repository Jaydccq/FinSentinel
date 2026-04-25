import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import type { CompanyProfile, FinancialMetrics, AnalystConsensus } from '@finsentinel/shared';
import { ResearchDataProviderRegistry } from './research-data-provider.registry';

/** Cache TTLs in seconds. */
const CACHE_TTL = {
  PROFILE: 14400, // 4 hours
  FINANCIALS: 14400, // 4 hours
  CONSENSUS: 14400, // 4 hours
} as const;

/**
 * Public API for company research data.
 * Delegates to the registry's default provider and caches results in Redis.
 *
 * Cache key format: `research:{method}:{ticker}:{provider}`
 */
@Injectable()
export class CompanyResearchService {
  private readonly logger = new Logger(CompanyResearchService.name);

  constructor(
    private readonly registry: ResearchDataProviderRegistry,
    @Inject('REDIS') private readonly redis: Redis,
  ) {}

  // ── Company Profile ────────────────────────────────────────────────────

  async getCompanyProfile(ticker: string, providerName?: string): Promise<CompanyProfile> {
    const provider = providerName
      ? this.registry.getProvider(providerName)
      : this.registry.getDefaultProvider();

    if (!provider) {
      throw new Error(`Research provider '${providerName}' not found`);
    }

    const cacheKey = `research:profile:${ticker.toUpperCase()}:${provider.getName()}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return JSON.parse(cached) as CompanyProfile;
    }

    const profile = await provider.getCompanyProfile(ticker.toUpperCase());
    await this.redis.setex(cacheKey, CACHE_TTL.PROFILE, JSON.stringify(profile));

    return profile;
  }

  // ── Financial Metrics ──────────────────────────────────────────────────

  async getFinancialMetrics(
    ticker: string,
    periods?: number,
    providerName?: string,
  ): Promise<FinancialMetrics[]> {
    const provider = providerName
      ? this.registry.getProvider(providerName)
      : this.registry.getDefaultProvider();

    if (!provider) {
      throw new Error(`Research provider '${providerName}' not found`);
    }

    const cacheKey = `research:financials:${ticker.toUpperCase()}:${provider.getName()}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return JSON.parse(cached) as FinancialMetrics[];
    }

    const metrics = await provider.getFinancialMetrics(ticker.toUpperCase(), periods);
    await this.redis.setex(cacheKey, CACHE_TTL.FINANCIALS, JSON.stringify(metrics));

    return metrics;
  }

  // ── Analyst Consensus ──────────────────────────────────────────────────

  async getAnalystConsensus(ticker: string, providerName?: string): Promise<AnalystConsensus> {
    const provider = providerName
      ? this.registry.getProvider(providerName)
      : this.registry.getDefaultProvider();

    if (!provider) {
      throw new Error(`Research provider '${providerName}' not found`);
    }

    const cacheKey = `research:consensus:${ticker.toUpperCase()}:${provider.getName()}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return JSON.parse(cached) as AnalystConsensus;
    }

    const consensus = await provider.getAnalystConsensus(ticker.toUpperCase());
    await this.redis.setex(cacheKey, CACHE_TTL.CONSENSUS, JSON.stringify(consensus));

    return consensus;
  }

  async getFinancialStatements(ticker: string, periods: number): Promise<FinancialMetrics[]> {
    return this.getFinancialMetrics(ticker, periods);
  }

  async getAnalystRating(ticker: string): Promise<AnalystConsensus> {
    return this.getAnalystConsensus(ticker);
  }
}
