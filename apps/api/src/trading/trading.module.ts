import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { MarketModule } from '../market/market.module';
import { MarketDataService } from '../market/market-data.service';
import { BrokerRegistry } from './broker-registry.service';
import { UnifiedTradingService } from './unified-trading.service';

/**
 * Trading module — Phase 5.
 *
 * Provides:
 * - BrokerRegistry (Phase 5.3) — resolves IBroker by Contract + TradingMode
 * - UnifiedTradingService (Phase 5.4) — stage/commit/execute lifecycle with atomic Redis ops
 *
 * Note: PaperTradingEngine and PaperBroker are NOT Injectables.
 * They are plain classes instantiated by BrokerRegistry at runtime.
 */
@Module({
  imports: [CommonModule, MarketModule],
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
