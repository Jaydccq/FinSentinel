import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AgentModule } from '../agent/agent.module';
import { PortfolioService } from './portfolio.service';
import { PortfolioInsightsService } from './portfolio-insights.service';
import { PortfolioController } from './portfolio.controller';

/**
 * Portfolio module -- Phase 6.
 *
 * Provides CRUD for portfolios and holdings, plus analytics
 * (HHI concentration index, sector allocation, PnL).
 * Insights endpoint depends on NewsAnalysisService from AgentModule.
 */
@Module({
  imports: [AuthModule, forwardRef(() => AgentModule)],
  controllers: [PortfolioController],
  providers: [PortfolioService, PortfolioInsightsService],
  exports: [PortfolioService],
})
export class PortfolioModule {}
