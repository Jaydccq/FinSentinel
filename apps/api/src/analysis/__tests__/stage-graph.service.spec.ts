import { describe, expect, it } from 'vitest';
import { StageGraphService } from '../stage-graph.service';
import { TeamPresetService } from '../team-preset.service';

describe('StageGraphService', () => {
  const graph = new StageGraphService(new TeamPresetService());

  it('marks EXECUTION_PREP + HUMAN_APPROVAL skipped for DEEP_THESIS preset', () => {
    const nodes = graph.build({ preset: 'DEEP_THESIS', researchDepth: 'STANDARD' });
    expect(nodes.map((n) => `${n.stageKey}:${n.status}`)).toEqual([
      'INTELLIGENCE:ENABLED',
      'THESIS:ENABLED',
      'RISK:ENABLED',
      'EXECUTION_PREP:SKIPPED',
      'HUMAN_APPROVAL:SKIPPED',
    ]);
  });

  it('honours explicit enabledTeams override', () => {
    const nodes = graph.build({
      preset: 'EXECUTION_READY',
      researchDepth: 'STANDARD',
      enabledTeams: ['INTELLIGENCE', 'RISK'],
    });
    expect(nodes.find((n) => n.stageKey === 'THESIS')?.status).toBe('SKIPPED');
  });

  it('computes nextEnabled past a skipped node', () => {
    const nodes = graph.build({ preset: 'DEEP_THESIS', researchDepth: 'STANDARD' });
    expect(graph.nextEnabled(nodes, 'RISK')).toBeNull();
    expect(graph.nextEnabled(nodes, 'INTELLIGENCE')).toBe('THESIS');
  });
});
