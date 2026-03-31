import { Module } from '@nestjs/common';
import { AppConfigModule, DatabaseModule } from './config';
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
import { OpenbbModule } from './openbb/openbb.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
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
    // OpenBB is always imported; its service guards at method level via config.enabled.
    OpenbbModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
