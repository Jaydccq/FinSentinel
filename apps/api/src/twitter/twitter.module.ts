import { Module, type DynamicModule } from '@nestjs/common';
import { TwitterDataService } from './twitter-data.service';

/**
 * Twitter module — 6551.io Twitter data integration.
 *
 * F-7c: exposes `register({ enabled })` for API consistency with the
 * rest of the F-7 series. Unlike OpenBB / OKX, TwitterModule ships no
 * HTTP controllers — the only public surface is `TwitterDataService`,
 * consumed by `TwitterToolsService` and `XInfluencerFetcher`. That
 * means `register(false)` and `register(true)` currently return the
 * same shape; the service's internal guard (checking
 * `APP_TWITTER_6551_ENABLED`) handles runtime no-ops.
 *
 * The register() surface is kept so future work can drop the provider
 * entirely when disabled, once every consumer goes through `@Optional()`.
 */
@Module({
  providers: [TwitterDataService],
  exports: [TwitterDataService],
})
export class TwitterModule {
  static register(_cfg: { enabled: boolean }): DynamicModule {
    // No controllers to toggle; the service is always in DI because
    // `TwitterToolsService` and the news-side `XInfluencerFetcher`
    // inject it synchronously. Returning the module with no overrides
    // keeps behaviour identical to the static decorator.
    return { module: TwitterModule };
  }
}
