import { Module } from '@nestjs/common';
import { QuantAnalysisService } from './quant-analysis.service';

/**
 * Quant module -- standalone quantitative analysis with no external dependencies.
 *
 * Provides statistical risk calculations (return statistics, VaR, volatility regime)
 * using pure TypeScript math. No database, Redis, or third-party API required.
 */
@Module({
  providers: [QuantAnalysisService],
  exports: [QuantAnalysisService],
})
export class QuantModule {}
