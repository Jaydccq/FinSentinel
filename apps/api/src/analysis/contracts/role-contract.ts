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
  /** Wall-clock duration of the role's LLM invocation, in milliseconds. */
  durationMs: number;
  /**
   * Number of tools made available to this role (scope size), NOT the number
   * of tool invocations the LLM actually made. `generateAgentText` does not
   * currently surface per-call invocation counts; this scope-based proxy is
   * what the UI and role-summary consumers display.
   */
  toolCallCount: number;
}
