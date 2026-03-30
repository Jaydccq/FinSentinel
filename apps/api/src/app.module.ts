import { Module } from '@nestjs/common';
import { AppConfigModule } from './config';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { MarketModule } from './market/market.module';
import { AgentModule } from './agent/agent.module';
import { TradingModule } from './trading/trading.module';
import { EventsModule } from './events/events.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { ChatModule } from './chat/chat.module';
import { NewsModule } from './news/news.module';
import { RagModule } from './rag/rag.module';
import { AutonomyModule } from './autonomy/autonomy.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    AppConfigModule,
    AuthModule,
    CommonModule,
    MarketModule,
    AgentModule,
    TradingModule,
    EventsModule,
    PortfolioModule,
    ChatModule,
    NewsModule,
    RagModule,
    AutonomyModule,
    StorageModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
