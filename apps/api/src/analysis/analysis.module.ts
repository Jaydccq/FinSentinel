import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentModule } from '../agent/agent.module';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../common/common.module';
import { EventsModule } from '../events/events.module';
import { RagModule } from '../rag/rag.module';
import { QueueModule } from '../queue/queue.module';
import { MarketModule } from '../market/market.module';
import { TradingModule } from '../trading/trading.module';
import { APPROVAL_AUTO_DISPATCH_FLAG_TOKEN } from './analysis-approval.service';
import type { DrizzleDB } from '@finsentinel/db';
import { chatSessionMemories, eq, and } from '@finsentinel/db';

import { AnalysisController } from './analysis.controller';
import { AnalysisRunController } from './analysis-run.controller';
import { AnalysisStreamController } from './analysis-stream.controller';
import { AnalysisApprovalController } from './analysis-approval.controller';
import { AnalysisRunService } from './analysis-run.service';
import { AnalysisCheckpointService } from './analysis-checkpoint.service';
import { AnalysisApprovalService } from './analysis-approval.service';
import { ContextComplexityService } from './context-complexity.service';
import { PreflightPlannerService } from './preflight-planner.service';
import { ContextFabricService } from './context-fabric.service';
import { ContextJournalService } from './context-journal.service';
import { RuntimeControlService } from './runtime-control.service';
import { RunReportAssembler } from './run-report-assembler.service';
import { RunOrchestratorService } from './run-orchestrator.service';
import { StrategyEvidenceService } from './strategy-evidence.service';
import { TeamRegistry } from './team-registry';
import { RoleExecutorService } from './teams/role-executor.service';
import { IntelligenceTeamService } from './teams/intelligence-team.service';
import { ThesisTeamService } from './teams/thesis-team.service';
import { RiskTeamService } from './teams/risk-team.service';
import { ExecutionPrepTeamService } from './teams/execution-prep-team.service';
import { HumanApprovalGateService } from './teams/human-approval-gate.service';

import { UserInvestmentProfileService } from '../agent/user-investment-profile.service';
import { AgentBrainService } from '../agent/agent-brain.service';
import { RagRetrievalService } from '../rag/rag-retrieval.service';

/**
 * Analysis module — Plan A runtime wiring.
 *
 * Registers all Plan A services and exposes them for consumption by
 * QueueModule (AnalysisRunConsumer → RunOrchestratorService) and by future
 * Plan B stage-executor modules.
 *
 * Circular-dependency notes:
 * - QueueModule ↔ AnalysisModule: bilateral forwardRef pair.
 * - AgentModule → RagModule → QueueModule → AnalysisModule: one-directional;
 *   AnalysisModule therefore uses a plain import of AgentModule and RagModule.
 *   ChatModule is intentionally excluded to avoid a TS-level circular import
 *   (ChatModule → AgentModule → RagModule → QueueModule → AnalysisModule).
 *   Session context is loaded via a direct Drizzle read against chat_session_memories,
 *   bypassing ChatCompactionService entirely.
 */
@Module({
  imports: [
    forwardRef(() => AgentModule),
    AuthModule,
    CommonModule,
    EventsModule,
    forwardRef(() => RagModule),
    forwardRef(() => QueueModule),
    MarketModule,
    TradingModule,
  ],
  controllers: [
    AnalysisController,
    AnalysisRunController,
    AnalysisStreamController,
    AnalysisApprovalController,
  ],
  providers: [
    AnalysisRunService,
    RuntimeControlService,
    RunReportAssembler,
    AnalysisCheckpointService,
    AnalysisApprovalService,
    StrategyEvidenceService,
    {
      provide: APPROVAL_AUTO_DISPATCH_FLAG_TOKEN,
      useFactory: (config: ConfigService) => ({
        enabled: config.get<boolean>('APPROVAL_AUTO_DISPATCH_ENABLED', false),
      }),
      inject: [ConfigService],
    },
    ContextComplexityService,
    ContextJournalService,
    PreflightPlannerService,
    RunOrchestratorService,
    {
      provide: ContextFabricService,
      useFactory: (
        db: DrizzleDB,
        profile: UserInvestmentProfileService,
        brain: AgentBrainService,
        rag: RagRetrievalService,
        journal: ContextJournalService,
      ) => {
        // Long-term: user investment profile summary (risk tolerance, sentiment, prefs).
        const longAdapter = {
          load: async (userId: string): Promise<string> => {
            return profile.getProfileSummary(userId);
          },
        };

        // Mid-term: agent brain frontal lobe (persisted trading strategy).
        const midAdapter = {
          load: async (userId: string, _portfolioId?: string): Promise<string> => {
            return brain.getFrontalLobe(userId);
          },
        };

        // Session: read directly from chat_session_memories via Drizzle.
        // Avoids the ChatModule circular dependency while still surfacing
        // compaction summaries for analysis runs that originate from a chat session.
        const sessionAdapter = {
          load: async (
            userId: string,
            sessionId: string | undefined,
          ): Promise<{ summary: string; count: number }> => {
            if (!sessionId) return { summary: '', count: 0 };
            const [row] = await db
              .select()
              .from(chatSessionMemories)
              .where(
                and(
                  eq(chatSessionMemories.userId, userId),
                  eq(chatSessionMemories.sessionId, sessionId),
                ),
              )
              .limit(1);
            if (!row) return { summary: '', count: 0 };
            return {
              summary: row.summaryText ?? '',
              count: row.compactedMessageCount ?? 0,
            };
          },
        };

        // Retrieval: delegate to RagRetrievalService.search().
        // Maps RagSearchResult[] → { id, snippet }[].
        const ragAdapter = {
          retrieve: async (
            query: string,
            args: { userId: string; limit?: number },
          ): Promise<Array<{ id: string; snippet: string }>> => {
            const results = await rag.search(query, args.limit ?? 8);
            return results.map((r, idx) => ({
              id: String(r.metadata['sourceId'] ?? r.metadata['id'] ?? idx),
              snippet: r.content,
            }));
          },
        };

        return new ContextFabricService(
          longAdapter,
          midAdapter,
          sessionAdapter,
          ragAdapter,
          journal,
        );
      },
      inject: [
        'DRIZZLE_DB',
        UserInvestmentProfileService,
        AgentBrainService,
        RagRetrievalService,
        ContextJournalService,
      ],
    },
    RoleExecutorService,
    IntelligenceTeamService,
    ThesisTeamService,
    RiskTeamService,
    ExecutionPrepTeamService,
    HumanApprovalGateService,
    TeamRegistry,
  ],
  exports: [
    AnalysisRunService,
    RuntimeControlService,
    RunReportAssembler,
    AnalysisCheckpointService,
    AnalysisApprovalService,
    StrategyEvidenceService,
    ContextFabricService,
    ContextJournalService,
    PreflightPlannerService,
    RunOrchestratorService,
  ],
})
export class AnalysisModule {}
