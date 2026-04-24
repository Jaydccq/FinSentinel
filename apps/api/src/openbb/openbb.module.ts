import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../common/common.module';
import { OpenbbPublicDataService } from './openbb-public.service';
import { OpenbbBusinessDataService } from './openbb-business.service';
import { OpenbbPublicController } from './openbb-public.controller';
import { OpenbbBusinessController } from './openbb-business.controller';

/**
 * OpenBB module — dynamic registration gated on `OPENBB_ENABLED`.
 *
 * F-7a: migrated from always-on imports to a `register({ enabled })`
 * dynamic module. When disabled, the HTTP controllers are not
 * registered — the routes `/api/openbb/public/*` and
 * `/api/openbb/business/*` simply don't exist, so the HTTP surface
 * area matches the advertised feature flag.
 *
 * The services (`OpenbbPublicDataService`, `OpenbbBusinessDataService`)
 * stay in the DI container in both modes via the static `@Module`
 * decorator so that non-controller consumers (`MarketCalendarService`,
 * `OwnershipDataService`) keep their injections. Those services retain
 * the internal `if (!config.enabled) throw` guard as belt-and-braces
 * safety.
 *
 * Followup (tracked in the F-7 exec plan): mark those market-side
 * dependencies `@Optional()` and drop the service providers entirely
 * when disabled. That requires `if (!this.openbb) …` at every call
 * site, which is out of scope for F-7a.
 */
@Module({
  imports: [AuthModule, CommonModule],
  providers: [OpenbbPublicDataService, OpenbbBusinessDataService],
  exports: [OpenbbPublicDataService, OpenbbBusinessDataService],
})
export class OpenbbModule {
  /**
   * Use in `AppModule` to gate the HTTP controllers on the env flag.
   * Non-controller consumers can still import `OpenbbModule` as a bare
   * class — they only need the services, which are always exported.
   */
  static register(cfg: { enabled: boolean }): DynamicModule {
    return cfg.enabled
      ? {
          module: OpenbbModule,
          controllers: [OpenbbPublicController, OpenbbBusinessController],
        }
      : { module: OpenbbModule };
  }
}
