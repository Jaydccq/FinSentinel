import { Module, forwardRef } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { CommonModule } from '../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { QueueModule } from '../queue/queue.module';
import { EventsModule } from '../events/events.module';
import { ChatController } from './chat.controller';
import { ChatCompactionService } from './chat-compaction.service';
import { ChatService } from './chat.service';
import { ChatUpgradePlannerService, chatUpgradeFlagProvider } from './chat-upgrade-planner.service';

/**
 * Chat module — Phase 12.
 *
 * Provides the ChatController with SSE streaming and risk assessment endpoints.
 * Imports AgentModule for access to AgentService.
 *
 * Services:
 * - ChatCompactionService — compresses old chat history into LLM-generated summaries
 * - ChatUpgradePlannerService — gates heavy requests to tracked analysis runs
 *
 * Circular dependency notes:
 * - AnalysisModule imports ChatModule (for ChatCompactionService session context).
 *   We break the cycle with forwardRef() on both sides.
 */
@Module({
  imports: [
    AgentModule,
    CommonModule,
    AuthModule,
    PortfolioModule,
    forwardRef(() => AnalysisModule),
    forwardRef(() => QueueModule),
    EventsModule,
  ],
  controllers: [ChatController],
  providers: [
    ChatCompactionService,
    ChatService,
    ChatUpgradePlannerService,
    chatUpgradeFlagProvider,
  ],
  exports: [ChatCompactionService, ChatService],
})
export class ChatModule {}
