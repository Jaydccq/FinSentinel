import type { StageStructuredOutput } from '@finsentinel/shared';

export type RoleKey =
  // Intelligence
  | 'MARKET_ANALYST'
  | 'NEWS_ANALYST'
  | 'FUNDAMENTALS_ANALYST'
  | 'SENTIMENT_ANALYST'
  // Thesis
  | 'POSITIVE_CASE'
  | 'NEGATIVE_CASE'
  | 'THESIS_LEAD'
  // Risk
  | 'RISK_REVIEWER'
  | 'PORTFOLIO_MANAGER'
  // Execution Prep
  | 'TRADE_PLANNER'
  | 'EXECUTION_DRAFT_BUILDER';

export interface RoleDefinition {
  roleKey: RoleKey;
  systemPrompt: string;
  allowedToolNames: readonly string[];
}

export interface RoleInput {
  prompt: string;
  contextText: string;
  priorStageOutputs: Partial<Record<string, StageStructuredOutput>>;
  extra?: Record<string, unknown>;
}

export interface RoleOutput {
  roleKey: RoleKey;
  structured: StageStructuredOutput;
  rawMarkdown: string;
  durationMs: number;
  toolCallCount: number;
}
