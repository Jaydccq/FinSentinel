import { Module, type OnModuleInit, Logger, Inject, type DynamicModule } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { okxConfig } from '../config/okx.config';
import { OkxApiClient } from './okx-api.client';
import { OkxTradingEngine } from './okx-trading.engine';
import { OkxPriceService } from './okx-price.service';
import { OkxAnalysisService } from './okx-analysis.service';
import { OkxController } from './okx.controller';
import { OkxAnalysisController } from './okx-analysis.controller';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../common/common.module';

/**
 * OKX module — F-7b dynamic registration.
 *
 * The static `@Module` decorator keeps the always-on shape (services +
 * factory-provided `OKX_API_CLIENT` / `OKX_TRADING_ENGINE`) so
 * downstream consumers that import `OkxModule` as a bare class
 * (`AgentModule`, `TradingModule`) keep their DI intact. The
 * `register({ enabled })` call in `AppModule` toggles only the HTTP
 * controllers — when disabled, `/api/okx/*` + `/api/okx/analysis/*`
 * routes do not mount.
 *
 * Follow-up (tracked in F-7 exec plan): drop `OkxPriceService` /
 * `OkxAnalysisService` providers entirely when disabled. Requires
 * `@Optional()` at every consumer call site.
 */
@Module({
  imports: [AuthModule, CommonModule],
  providers: [
    OkxPriceService,
    OkxAnalysisService,
    {
      provide: 'OKX_API_CLIENT',
      useFactory: (cfg: ConfigType<typeof okxConfig>): OkxApiClient | null => {
        if (!cfg.enabled || !cfg.apiKey || !cfg.secretKey || !cfg.passphrase) {
          return null;
        }
        return new OkxApiClient(
          cfg.apiKey,
          cfg.secretKey,
          cfg.passphrase,
          cfg.baseUrl,
          cfg.sandbox,
        );
      },
      inject: [okxConfig.KEY],
    },
    {
      provide: 'OKX_TRADING_ENGINE',
      useFactory: (client: OkxApiClient | null): OkxTradingEngine | null => {
        if (!client) return null;
        return new OkxTradingEngine(client);
      },
      inject: ['OKX_API_CLIENT'],
    },
  ],
  exports: [OkxPriceService, OkxAnalysisService, 'OKX_API_CLIENT', 'OKX_TRADING_ENGINE'],
})
export class OkxModule implements OnModuleInit {
  private readonly logger = new Logger(OkxModule.name);

  constructor(
    @Inject(okxConfig.KEY) private readonly cfg: ConfigType<typeof okxConfig>,
    @Inject('OKX_API_CLIENT') private readonly client: OkxApiClient | null,
    private readonly analysisService: OkxAnalysisService,
  ) {}

  static register(cfg: { enabled: boolean }): DynamicModule {
    return cfg.enabled
      ? {
          module: OkxModule,
          controllers: [OkxController, OkxAnalysisController],
        }
      : { module: OkxModule };
  }

  onModuleInit(): void {
    if (!this.cfg.enabled) {
      this.logger.log('OKX module is disabled (APP_OKX_ENABLED=false)');
      return;
    }

    if (!this.client) {
      this.logger.warn(
        'OKX module enabled but missing credentials (OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE)',
      );
      return;
    }

    // Wire the client into the analysis service
    this.analysisService.setClient(this.client);

    this.logger.log(
      `OKX module initialized (sandbox=${this.cfg.sandbox}, baseUrl=${this.cfg.baseUrl})`,
    );
  }
}
