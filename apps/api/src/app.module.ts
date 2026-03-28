import { Module } from '@nestjs/common';
import { AppConfigModule } from './config';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { MarketModule } from './market/market.module';
import { AgentModule } from './agent/agent.module';

@Module({
  imports: [AppConfigModule, AuthModule, CommonModule, MarketModule, AgentModule],
  controllers: [HealthController],
})
export class AppModule {}
