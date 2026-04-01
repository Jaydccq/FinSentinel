import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { researchConfig } from '../config/research.config';
import type { ResearchDataProvider } from './interfaces/research-data-provider';

/**
 * Registry of all available research-data providers.
 *
 * Accepts a list of providers via DI token, indexes them by name,
 * and exposes O(1) lookups plus a configurable default.
 */
@Injectable()
export class ResearchDataProviderRegistry {
  private readonly logger = new Logger(ResearchDataProviderRegistry.name);
  private readonly providers = new Map<string, ResearchDataProvider>();
  private readonly defaultProviderName: string;

  constructor(
    @Inject('RESEARCH_PROVIDERS') providers: ResearchDataProvider[],
    @Inject(researchConfig.KEY)
    private config: ConfigType<typeof researchConfig>,
  ) {
    for (const p of providers) {
      this.providers.set(p.getName(), p);
      this.logger.log(`Registered research data provider: ${p.getName()}`);
    }

    // Use configured default; fall back to first registered provider
    const configuredDefault = this.config.defaultProvider;
    this.defaultProviderName = this.providers.has(configuredDefault)
      ? configuredDefault
      : (providers[0]?.getName() ?? 'polygon');

    this.logger.log(
      `Default research data provider: ${this.defaultProviderName}`,
    );
  }

  /** O(1) lookup by provider name. */
  getProvider(name: string): ResearchDataProvider | undefined {
    return this.providers.get(name);
  }

  /** Returns the default provider (configured or first registered). */
  getDefaultProvider(): ResearchDataProvider {
    const provider = this.providers.get(this.defaultProviderName);
    if (!provider) {
      throw new Error(
        `Default research data provider '${this.defaultProviderName}' not found. ` +
          `Available: ${this.getRegisteredProviderNames().join(', ')}`,
      );
    }
    return provider;
  }

  /** List all registered provider names. */
  getRegisteredProviderNames(): string[] {
    return [...this.providers.keys()];
  }
}
