import { Module } from '@nestjs/common';
import { MarketModule } from '../market/market.module';
import { AgentService } from './agent.service';
import { StockAnalysisService } from './stock-analysis.service';
import { ToolRegistry } from './tool-registry';

@Module({
  imports: [MarketModule],
  providers: [ToolRegistry, AgentService, StockAnalysisService],
  exports: [AgentService, StockAnalysisService],
})
export class AgentModule {}
