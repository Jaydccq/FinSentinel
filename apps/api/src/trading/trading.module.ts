import { Module } from '@nestjs/common';

/**
 * Trading module — skeleton for Phase 5.
 *
 * Will be populated with:
 * - BrokerRegistry (Phase 5.3)
 * - UnifiedTradingService (Phase 5.4)
 * - Paper/Alpaca/OKX broker adapters
 *
 * Note: PaperTradingEngine is NOT an Injectable. It is a plain class
 * instantiated by BrokerRegistry at runtime.
 */
@Module({
  imports: [],
  providers: [],
  exports: [],
})
export class TradingModule {}
