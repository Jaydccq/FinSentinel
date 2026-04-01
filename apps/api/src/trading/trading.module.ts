import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { MarketModule } from '../market/market.module';
import { AuthModule } from '../auth/auth.module';
import { OkxModule } from '../okx/okx.module';
import { MarketDataService } from '../market/market-data.service';
import { BrokerRegistry } from './broker-registry.service';
import { UnifiedTradingService } from './unified-trading.service';
import { TradingController } from './trading.controller';

/**
 * Trading module — Phase 5 + Phase 12 controllers.
 *
 * Provides:
 * - BrokerRegistry (Phase 5.3) — resolves IBroker by Contract + TradingMode
 *   Conditionally wires Alpaca, OKX, and CCXT brokers based on config.
 * - UnifiedTradingService (Phase 5.4) — stage/commit/execute lifecycle with atomic Redis ops
 * - TradingController (Phase 12) — REST endpoints for v1 + v2 UTA
 *
 * Note: PaperTradingEngine and PaperBroker are NOT Injectables.
 * They are plain classes instantiated by BrokerRegistry at runtime.
 */
@Module({
  imports: [CommonModule, MarketModule, AuthModule, OkxModule],
  controllers: [TradingController],
  providers: [
    BrokerRegistry,
    UnifiedTradingService,
    {
      provide: 'MarketDataService',
      useExisting: MarketDataService,
    },
  ],
  exports: [BrokerRegistry, UnifiedTradingService],
})
export class TradingModule {}
