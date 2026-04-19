import { Injectable } from '@nestjs/common';
import type { AnalysisPreset, AnalysisStageKey, ResearchDepth } from '@finsentinel/shared';

export interface ResolvedPresetPlan {
  stageKeys: AnalysisStageKey[];
  researchDepth: ResearchDepth;
  maxParallelRoles: number;
}

@Injectable()
export class TeamPresetService {
  resolve(input: { preset: AnalysisPreset; researchDepth: ResearchDepth }): ResolvedPresetPlan {
    const base: Record<AnalysisPreset, AnalysisStageKey[]> = {
      FAST_RISK_CHECK: ['INTELLIGENCE', 'RISK'],
      STANDARD_ANALYSIS: ['INTELLIGENCE', 'THESIS', 'RISK'],
      DEEP_THESIS: ['INTELLIGENCE', 'THESIS', 'RISK'],
      EXECUTION_READY: ['INTELLIGENCE', 'THESIS', 'RISK', 'EXECUTION_PREP', 'HUMAN_APPROVAL'],
    };
    return {
      stageKeys: base[input.preset],
      researchDepth: input.researchDepth,
      maxParallelRoles: input.researchDepth === 'DEEP' ? 4 : 2,
    };
  }
}
