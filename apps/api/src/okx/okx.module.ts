import { Module, type OnModuleInit, Logger, Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { okxConfig } from '../config/okx.config';
import { OkxApiClient } from './okx-api.client';
import { OkxTradingEngine } from './okx-trading.engine';
import { OkxPriceService } from './okx-price.service';
import { OkxAnalysisService } from './okx-analysis.service';

/**
 * OKX module -- conditionally active when APP_OKX_ENABLED=true.
 *
 * Provides:
 * - OkxApiClient — REST client with HMAC-SHA256 auth
 * - OkxTradingEngine — TradingEngine implementation
 * - OkxPriceService — in-memory ticker price cache
 * - OkxAnalysisService — AI-powered crypto derivatives analysis with SSE streaming
 *
 * The module is always imported but guards at service level via config.enabled.
 * OkxApiClient and OkxTradingEngine are created at initialization when enabled.
 */
@Module({
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
  exports: [
    OkxPriceService,
    OkxAnalysisService,
    'OKX_API_CLIENT',
    'OKX_TRADING_ENGINE',
  ],
})
export class OkxModule implements OnModuleInit {
  private readonly logger = new Logger(OkxModule.name);

  constructor(
    @Inject(okxConfig.KEY) private readonly cfg: ConfigType<typeof okxConfig>,
    @Inject('OKX_API_CLIENT') private readonly client: OkxApiClient | null,
    private readonly analysisService: OkxAnalysisService,
  ) {}

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
