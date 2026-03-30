import { Module } from '@nestjs/common';
import { MarketModule } from '../market/market.module';
import { BrokerRegistry } from './broker-registry.service';

/**
 * Trading module — Phase 5.
 *
 * Provides:
 * - BrokerRegistry (Phase 5.3) — resolves IBroker by Contract + TradingMode
 * - UnifiedTradingService (Phase 5.4 — TODO)
 *
 * Note: PaperTradingEngine and PaperBroker are NOT Injectables.
 * They are plain classes instantiated by BrokerRegistry at runtime.
 */
@Module({
  imports: [MarketModule],
  providers: [BrokerRegistry],
  exports: [BrokerRegistry],
})
export class TradingModule {}
