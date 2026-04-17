import { Module, forwardRef } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { MarketModule } from '../market/market.module';
import { ResearchModule } from '../research/research.module';
import { TradingModule } from '../trading/trading.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { AutonomyModule } from '../autonomy/autonomy.module';
import { NewsModule } from '../news/news.module';
import { RagModule } from '../rag/rag.module';
import { TwitterModule } from '../twitter/twitter.module';
import { OkxModule } from '../okx/okx.module';
import { WatchlistModule } from '../watchlist/watchlist.module';
import { AgentService } from './agent.service';
import { AgentBrainService } from './agent-brain.service';
import { StockAnalysisService } from './stock-analysis.service';
import { ToolRegistry } from './tool-registry';
import { UserInvestmentProfileService } from './user-investment-profile.service';
import { NewsAnalysisService } from './news-analysis.service';
import { TwitterToolsService } from './twitter-tools.service';
import { CryptoToolsService } from './crypto-tools.service';

@Module({
  imports: [
    CommonModule,
    MarketModule,
    ResearchModule,
    TradingModule,
    forwardRef(() => PortfolioModule),
    AutonomyModule,
    NewsModule,
    RagModule,
    TwitterModule,
    OkxModule,
    WatchlistModule,
  ],
  providers: [
    ToolRegistry,
    AgentService,
    StockAnalysisService,
    AgentBrainService,
    UserInvestmentProfileService,
    NewsAnalysisService,
    TwitterToolsService,
    CryptoToolsService,
  ],
  exports: [
    AgentService,
    StockAnalysisService,
    AgentBrainService,
    UserInvestmentProfileService,
    NewsAnalysisService,
    TwitterToolsService,
    CryptoToolsService,
    ToolRegistry,
  ],
})
export class AgentModule {}
