import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../common/common.module';
import { AnalysisController } from './analysis.controller';

/**
 * Analysis module — AI-powered stock analysis with SSE streaming.
 */
@Module({
  imports: [AgentModule, AuthModule, CommonModule],
  controllers: [AnalysisController],
})
export class AnalysisModule {}
