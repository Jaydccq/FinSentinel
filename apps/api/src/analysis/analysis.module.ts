import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentModule } from '../agent/agent.module';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../common/common.module';
import { EventsModule } from '../events/events.module';
import { RagModule } from '../rag/rag.module';
import { QueueModule } from '../queue/queue.module';
import { TradingModule } from '../trading/trading.module';
import { APPROVAL_AUTO_DISPATCH_FLAG_TOKEN } from './analysis-approval.service';

import { AnalysisController } from './analysis.controller';
import { AnalysisRunController } from './analysis-run.controller';
import { AnalysisApprovalController } from './analysis-approval.controller';
import { AnalysisRunService } from './analysis-run.service';
import { AnalysisCheckpointService } from './analysis-checkpoint.service';
import { AnalysisApprovalService } from './analysis-approval.service';
import { ContextComplexityService } from './context-complexity.service';
import { PreflightPlannerService } from './preflight-planner.service';
import { ContextFabricService } from './context-fabric.service';
import { RunOrchestratorService } from './run-orchestrator.service';
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
 *   The session-context adapter is stubbed; ChatCompactionService.augmentPrompt
 *   already prepends summaries in the chat flow, so no re-load is needed here.
 */
@Module({
  imports: [
    forwardRef(() => AgentModule),
    AuthModule,
    CommonModule,
    EventsModule,
    forwardRef(() => RagModule),
    forwardRef(() => QueueModule),
    TradingModule,
  ],
  controllers: [AnalysisController, AnalysisRunController, AnalysisApprovalController],
  providers: [
    AnalysisRunService,
    AnalysisCheckpointService,
    AnalysisApprovalService,
    {
      provide: APPROVAL_AUTO_DISPATCH_FLAG_TOKEN,
      useFactory: (config: ConfigService) => ({
        enabled: config.get<boolean>('APPROVAL_AUTO_DISPATCH_ENABLED', false),
      }),
      inject: [ConfigService],
    },
    ContextComplexityService,
    PreflightPlannerService,
    RunOrchestratorService,
    {
      provide: ContextFabricService,
      useFactory: (
        profile: UserInvestmentProfileService,
        brain: AgentBrainService,
        rag: RagRetrievalService,
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

        // Session: ChatCompactionService is excluded (would create a TS circular
        // import via ChatModule → AgentModule → RagModule → QueueModule → AnalysisModule).
        // The compaction summary is already prepended to the user prompt by
        // ChatCompactionService.augmentPrompt() in the chat flow; re-loading it
        // here is unnecessary for the analysis pipeline.
        const sessionAdapter = {
          load: async (
            _userId: string,
            _sessionId: string | undefined,
          ): Promise<{ summary: string; count: number }> => {
            return { summary: '', count: 0 };
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
        );
      },
      inject: [
        UserInvestmentProfileService,
        AgentBrainService,
        RagRetrievalService,
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
    AnalysisCheckpointService,
    AnalysisApprovalService,
    ContextFabricService,
    PreflightPlannerService,
    RunOrchestratorService,
  ],
})
export class AnalysisModule {}
