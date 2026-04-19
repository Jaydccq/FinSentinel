import { Injectable } from '@nestjs/common';
import type { AnalysisPreset, AnalysisStageKey, ResearchDepth } from '@finsentinel/shared';
import { TeamPresetService } from './team-preset.service';

export interface StageGraphNode {
  stageKey: AnalysisStageKey;
  status: 'ENABLED' | 'SKIPPED';
}

export interface StageGraphInput {
  preset: AnalysisPreset;
  researchDepth: ResearchDepth;
  enabledTeams?: AnalysisStageKey[];
}

const CANONICAL_ORDER: readonly AnalysisStageKey[] = [
  'INTELLIGENCE',
  'THESIS',
  'RISK',
  'EXECUTION_PREP',
  'HUMAN_APPROVAL',
];

@Injectable()
export class StageGraphService {
  constructor(private readonly presets: TeamPresetService) {}

  build(input: StageGraphInput): StageGraphNode[] {
    const plan = this.presets.resolve({ preset: input.preset, researchDepth: input.researchDepth });
    const presetStages = new Set<AnalysisStageKey>(plan.stageKeys);
    const override = input.enabledTeams?.length ? new Set<AnalysisStageKey>(input.enabledTeams) : null;
    return CANONICAL_ORDER.map((stageKey) => ({
      stageKey,
      status: presetStages.has(stageKey) && (!override || override.has(stageKey)) ? 'ENABLED' : 'SKIPPED',
    }));
  }

  nextEnabled(nodes: StageGraphNode[], from: AnalysisStageKey): AnalysisStageKey | null {
    const idx = nodes.findIndex((n) => n.stageKey === from);
    if (idx < 0) return null;
    for (let i = idx + 1; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (node && node.status === 'ENABLED') return node.stageKey;
    }
    return null;
  }
}
