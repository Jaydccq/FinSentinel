import { describe, it, expect, vi } from 'vitest';
import { TeamRegistry } from '../team-registry';
import type { TeamService } from '../contracts/team-contract';

describe('TeamRegistry.onModuleInit', () => {
  it('registers every team with the RunOrchestratorService', () => {
    const orchestrator = { registerStageExecutor: vi.fn() };
    const intelligence: TeamService = { stageKey: 'INTELLIGENCE', execute: vi.fn() };
    const thesis: TeamService = { stageKey: 'THESIS', execute: vi.fn() };
    const risk: TeamService = { stageKey: 'RISK', execute: vi.fn() };
    const execPrep: TeamService = { stageKey: 'EXECUTION_PREP', execute: vi.fn() };
    const approval: TeamService = { stageKey: 'HUMAN_APPROVAL', execute: vi.fn() };

    const registry = new TeamRegistry(
      orchestrator as never,
      intelligence,
      thesis,
      risk,
      execPrep,
      approval,
    );
    registry.onModuleInit();

    expect(orchestrator.registerStageExecutor).toHaveBeenCalledTimes(5);
    expect(orchestrator.registerStageExecutor).toHaveBeenCalledWith(
      'INTELLIGENCE',
      expect.any(Function),
    );
    expect(orchestrator.registerStageExecutor).toHaveBeenCalledWith(
      'HUMAN_APPROVAL',
      expect.any(Function),
    );
  });
});
