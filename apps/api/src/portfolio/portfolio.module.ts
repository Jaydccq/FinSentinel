import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PortfolioService } from './portfolio.service';
import { PortfolioController } from './portfolio.controller';

/**
 * Portfolio module -- Phase 6.
 *
 * Provides CRUD for portfolios and holdings, plus analytics
 * (HHI concentration index, sector allocation, PnL).
 */
@Module({
  imports: [AuthModule],
  controllers: [PortfolioController],
  providers: [PortfolioService],
  exports: [PortfolioService],
})
export class PortfolioModule {}
