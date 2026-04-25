import { describe, expect, it } from 'vitest';
import { TeamPresetService } from '../team-preset.service';

describe('TeamPresetService', () => {
  const service = new TeamPresetService();

  it('resolves FAST_RISK_CHECK to INTELLIGENCE + RISK only', () => {
    const plan = service.resolve({ preset: 'FAST_RISK_CHECK', researchDepth: 'STANDARD' });
    expect(plan.stageKeys).toEqual(['INTELLIGENCE', 'RISK']);
  });

  it('resolves EXECUTION_READY to full pipeline incl. HUMAN_APPROVAL', () => {
    const plan = service.resolve({ preset: 'EXECUTION_READY', researchDepth: 'STANDARD' });
    expect(plan.stageKeys).toEqual([
      'INTELLIGENCE',
      'THESIS',
      'RISK',
      'EXECUTION_PREP',
      'HUMAN_APPROVAL',
    ]);
  });

  it('increases maxParallelRoles for DEEP research depth', () => {
    const plan = service.resolve({ preset: 'DEEP_THESIS', researchDepth: 'DEEP' });
    expect(plan.maxParallelRoles).toBe(4);
  });
});
