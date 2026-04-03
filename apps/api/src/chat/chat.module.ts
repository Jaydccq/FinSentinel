import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { CommonModule } from '../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { ChatController } from './chat.controller';
import { ChatCompactionService } from './chat-compaction.service';
import { ChatService } from './chat.service';

/**
 * Chat module — Phase 12.
 *
 * Provides the ChatController with SSE streaming and risk assessment endpoints.
 * Imports AgentModule for access to AgentService.
 *
 * Services:
 * - ChatCompactionService — compresses old chat history into LLM-generated summaries
 */
@Module({
  imports: [AgentModule, CommonModule, AuthModule, PortfolioModule],
  controllers: [ChatController],
  providers: [ChatCompactionService, ChatService],
  exports: [ChatCompactionService, ChatService],
})
export class ChatModule {}
