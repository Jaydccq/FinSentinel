import { Injectable, OnModuleInit } from '@nestjs/common';
import { RunOrchestratorService } from './run-orchestrator.service';
import type { TeamService } from './contracts/team-contract';
import { IntelligenceTeamService } from './teams/intelligence-team.service';
import { ThesisTeamService } from './teams/thesis-team.service';
import { RiskTeamService } from './teams/risk-team.service';
import { ExecutionPrepTeamService } from './teams/execution-prep-team.service';
import { HumanApprovalGateService } from './teams/human-approval-gate.service';

@Injectable()
export class TeamRegistry implements OnModuleInit {
  constructor(
    private readonly orchestrator: RunOrchestratorService,
    private readonly intelligence: IntelligenceTeamService,
    private readonly thesis: ThesisTeamService,
    private readonly risk: RiskTeamService,
    private readonly executionPrep: ExecutionPrepTeamService,
    private readonly humanApproval: HumanApprovalGateService,
  ) {}

  onModuleInit(): void {
    for (const team of this.teams()) {
      this.orchestrator.registerStageExecutor(team.stageKey, (args) =>
        team.execute(args),
      );
    }
  }

  private teams(): TeamService[] {
    return [
      this.intelligence,
      this.thesis,
      this.risk,
      this.executionPrep,
      this.humanApproval,
    ];
  }
}
