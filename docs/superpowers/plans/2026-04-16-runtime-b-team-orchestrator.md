# Plan B — Agent Teams Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the four-team orchestration (`Intelligence → Thesis → Risk → Execution Prep → Human Approval`) with structured handoffs, parallel Positive/Negative Thesis roles, a broker-neutral order-draft emitter, and the execution adapter boundary that downstream brokers sit behind.

**Architecture:** Team/role contracts + a `TeamRegistry` keyed by stage → four `*TeamService` classes each owning role execution + checkpoint commit via `AnalysisCheckpointService`. Role execution goes through a shared `RoleExecutorService` that scopes tool sets per role and runs an LLM call per role. The Thesis team runs `Positive ∥ Negative` via `Promise.all()` with a `Thesis Lead` barrier converging. The Execution Prep team emits `orderDrafts` (broker-neutral) into `analysis_artifacts` and hands off to `HumanApprovalGateService`. A new `OrderDraftValidator` + `OrderDraftMapper` pair enforces the broker-neutral boundary and converts post-approval to `UnifiedTradingService`-compatible payloads.

**Tech Stack:** NestJS, Vercel AI SDK (`generateText` / `streamText`), Zod, Vitest.

**Depends on:** Plan A.
**Unblocks:** Plan C, Plan D.

---

## File Structure

### New files

```
apps/api/src/analysis/contracts/team-contract.ts
apps/api/src/analysis/contracts/role-contract.ts
apps/api/src/analysis/contracts/role-tool-scope.ts
apps/api/src/analysis/contracts/prompts/index.ts
apps/api/src/analysis/contracts/prompts/intelligence.prompts.ts
apps/api/src/analysis/contracts/prompts/thesis.prompts.ts
apps/api/src/analysis/contracts/prompts/risk.prompts.ts
apps/api/src/analysis/contracts/prompts/execution-prep.prompts.ts

apps/api/src/analysis/team-registry.ts
apps/api/src/analysis/teams/role-executor.service.ts
apps/api/src/analysis/teams/intelligence-team.service.ts
apps/api/src/analysis/teams/thesis-team.service.ts
apps/api/src/analysis/teams/risk-team.service.ts
apps/api/src/analysis/teams/execution-prep-team.service.ts
apps/api/src/analysis/teams/human-approval-gate.service.ts

apps/api/src/analysis/__tests__/team-registry.spec.ts
apps/api/src/analysis/__tests__/role-executor.service.spec.ts
apps/api/src/analysis/__tests__/intelligence-team.service.spec.ts
apps/api/src/analysis/__tests__/thesis-team.service.spec.ts
apps/api/src/analysis/__tests__/risk-team.service.spec.ts
apps/api/src/analysis/__tests__/execution-prep-team.service.spec.ts
apps/api/src/analysis/__tests__/human-approval-gate.service.spec.ts

apps/api/src/trading/order-draft-validator.service.ts
apps/api/src/trading/order-draft-mapper.service.ts
apps/api/src/trading/__tests__/order-draft-validator.spec.ts
apps/api/src/trading/__tests__/order-draft-mapper.spec.ts
```

### Modified files

```
apps/api/src/analysis/analysis.module.ts        # Register 4 team services + role executor + registry + approval gate
apps/api/src/trading/trading.module.ts          # Register order-draft validator + mapper
apps/api/src/analysis/run-orchestrator.service.ts  # Subscribe to team executors on module init via TeamRegistry
```

Each team lives in its own file — same surface area, different tool/prompt scope. `RoleExecutorService` is the one place where the LLM call happens so tool-scope enforcement is centralized. `TeamRegistry` is a thin wiring layer so `RunOrchestratorService` can call `registerStageExecutor` once per team during bootstrap.

---

## Conventions Enforced

- **Schema validation at every team boundary.** Every team output goes through `stageStructuredOutputSchema.parse()` before `AnalysisCheckpointService.commitStage` writes it.
- **Role tool scope is allow-list only.** `RoleExecutorService` accepts a whitelist of tool names; anything else is filtered out before the LLM call.
- **Deterministic role IDs.** Event emission uses `roleKey` (e.g. `POSITIVE_CASE`), not free-text names, so event log queries stay stable.
- **Thesis parallelism.** Use `Promise.all([positive, negative])`, then invoke Thesis Lead with both outputs as input. Barrier is a hard ordering; no streaming mid-thesis output to downstream teams.
- **Execution Prep never touches a broker.** `orderDrafts` is the last thing the team emits; `OrderDraftMapper` is owned by the Trading module and runs only after approval resolves.

---

## Task 1: Team + Role Contracts

Pure TypeScript types that define the shape of a team and a role. No runtime behavior — these lock the vocabulary used by all subsequent tasks.

**Files:**
- Create: `apps/api/src/analysis/contracts/team-contract.ts`
- Create: `apps/api/src/analysis/contracts/role-contract.ts`
- Create: `apps/api/src/analysis/contracts/role-tool-scope.ts`

- [ ] **Step 1: Write the role contract**

Create `apps/api/src/analysis/contracts/role-contract.ts`:

```ts
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
}
```

- [ ] **Step 2: Write the team contract**

Create `apps/api/src/analysis/contracts/team-contract.ts`:

```ts
import type { AnalysisStageKey } from '@finsentinel/shared';

export interface TeamExecutionArgs {
  runId: string;
  userId: string;
}

export interface TeamService {
  readonly stageKey: AnalysisStageKey;
  execute(args: TeamExecutionArgs): Promise<void>;
}
```

- [ ] **Step 3: Write the tool scope**

Create `apps/api/src/analysis/contracts/role-tool-scope.ts`:

```ts
import type { RoleKey } from './role-contract';

/**
 * v1 tool allow-lists per role. Tool names must match keys in
 * apps/api/src/agent/tools/index.ts.
 */
export const ROLE_TOOL_SCOPE: Record<RoleKey, readonly string[]> = {
  // Intelligence Team: facts only — no staging, committing, or draft generation.
  MARKET_ANALYST: [
    'getStockQuote',
    'getHistoricalPrices',
    'calculateRSI',
    'calculateMACD',
    'calculateBollingerBands',
    'calculateSMA',
    'calculateEMA',
    'calculateATR',
    'calculateStochastic',
    'calculateADX',
    'calculateOBV',
    'checkMarketHours',
  ],
  NEWS_ANALYST: [
    'getRecentNews',
    'getCryptoNews',
    'getCryptoNewsBySignal',
    'searchKnowledgeBase',
    'getTwitterProfile',
    'searchTweets',
    'getUserTweets',
  ],
  FUNDAMENTALS_ANALYST: [
    'searchKnowledgeBase',
    'getUpcomingEarnings',
    'getDividendHistory',
    'getSplitHistory',
    'getInstitutionalHolders',
    'getInsiderTransactions',
    'getShortInterest',
    'getFailsToDeliver',
  ],
  SENTIMENT_ANALYST: [
    'getRecentNews',
    'searchTweets',
    'getKolFollowers',
    'searchKnowledgeBase',
  ],

  // Thesis Team: no direct data tools. Consumes Intelligence outputs from context.
  POSITIVE_CASE: [],
  NEGATIVE_CASE: [],
  THESIS_LEAD: [],

  // Risk Team: portfolio-only tools.
  RISK_REVIEWER: ['analyzePortfolio', 'searchKnowledgeBase'],
  PORTFOLIO_MANAGER: ['analyzePortfolio', 'getPositions', 'getWalletStatus'],

  // Execution Prep Team: draft-generation only. Explicitly NO stage/commit/execute.
  TRADE_PLANNER: ['analyzePortfolio', 'getPositions', 'getStockQuote'],
  EXECUTION_DRAFT_BUILDER: ['getStockQuote', 'checkMarketHours'],
};
```

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm --filter @finsentinel/api typecheck`

```bash
git add apps/api/src/analysis/contracts/
git commit -m "feat(analysis): team/role contracts + v1 tool scope map"
```

---

## Task 2: Role Prompts

Externalized so they can be iterated without touching service code.

**Files:**
- Create: `apps/api/src/analysis/contracts/prompts/intelligence.prompts.ts`
- Create: `apps/api/src/analysis/contracts/prompts/thesis.prompts.ts`
- Create: `apps/api/src/analysis/contracts/prompts/risk.prompts.ts`
- Create: `apps/api/src/analysis/contracts/prompts/execution-prep.prompts.ts`
- Create: `apps/api/src/analysis/contracts/prompts/index.ts`

- [ ] **Step 1: Write Intelligence prompts**

Create `apps/api/src/analysis/contracts/prompts/intelligence.prompts.ts`:

```ts
const COMMON_OUTPUT_INSTRUCTIONS = `
Return your answer as a fenced JSON block with this exact shape:
{
  "summary": "1-3 sentence overview",
  "thesis": "single-sentence claim grounded in the evidence",
  "risks": ["key risk 1", "key risk 2"],
  "openQuestions": ["question 1"],
  "citations": [{ "title": "...", "excerpt": "..." }],
  "confidence": 0.0 to 1.0
}
Never fabricate numbers. If a tool call fails, note it in openQuestions and lower confidence.
`;

export const MARKET_ANALYST_PROMPT = `You are the Market Analyst role inside the Intelligence Team.
Collect price, volatility, and technical indicator evidence only. Do NOT form a final investment thesis.
${COMMON_OUTPUT_INSTRUCTIONS}`;

export const NEWS_ANALYST_PROMPT = `You are the News Analyst role inside the Intelligence Team.
Collect and summarize recent news relevant to the target. Flag catalysts and event risk. Do NOT make a trade recommendation.
${COMMON_OUTPUT_INSTRUCTIONS}`;

export const FUNDAMENTALS_ANALYST_PROMPT = `You are the Fundamentals Analyst role inside the Intelligence Team.
Gather ROE, margins, FCF quality, moat signals, insider transactions, short interest. Cite source.
${COMMON_OUTPUT_INSTRUCTIONS}`;

export const SENTIMENT_ANALYST_PROMPT = `You are the Sentiment Analyst role inside the Intelligence Team.
Assess social + KOL sentiment and positioning. Distinguish retail from institutional signals.
${COMMON_OUTPUT_INSTRUCTIONS}`;
```

- [ ] **Step 2: Write Thesis prompts**

Create `apps/api/src/analysis/contracts/prompts/thesis.prompts.ts`:

```ts
const THESIS_OUTPUT_INSTRUCTIONS = `
Return a fenced JSON block:
{
  "summary": "...",
  "thesis": "BULL|BEAR|WAIT stated as a single sentence",
  "risks": [],
  "openQuestions": [],
  "citations": [],
  "confidence": 0.0 to 1.0
}
`;

export const POSITIVE_CASE_PROMPT = `You are the Positive Case Analyst.
You ONLY argue the bull case. Build the strongest plausible long thesis using the Intelligence evidence.
Do not hedge. Do not simulate the bear case — that role is handled separately.
${THESIS_OUTPUT_INSTRUCTIONS}`;

export const NEGATIVE_CASE_PROMPT = `You are the Negative Case Analyst.
You ONLY argue the bear case. Build the strongest plausible short/avoid thesis using the Intelligence evidence.
Do not hedge. Do not simulate the bull case — that role is handled separately.
${THESIS_OUTPUT_INSTRUCTIONS}`;

export const THESIS_LEAD_PROMPT = `You are the Thesis Lead. You have been given:
- positive case JSON output
- negative case JSON output
- shared context

Converge into one thesis. Identify decisive evidence on each side, name key uncertainties,
and pick one of BULL | BEAR | WAIT. Keep the JSON schema above.`;
```

- [ ] **Step 3: Write Risk prompts**

Create `apps/api/src/analysis/contracts/prompts/risk.prompts.ts`:

```ts
const RISK_OUTPUT_INSTRUCTIONS = `
Return a fenced JSON block extending the standard shape with:
"portfolioDecision": "BUY|HOLD|SELL|HEDGE",
"allocationGuidance": { "notes": "...", "targets": [{ "symbol": "AAPL", "targetPercent": 5 }] },
"riskLimits": { "maxDrawdownPct": 10, "stopLossTriggers": ["close < 150"] },
"alertTriggers": [{ "condition": "price < 140", "channel": "email" }],
"evidenceRefs": ["artifact-id-..."]
`;

export const RISK_REVIEWER_PROMPT = `You are the Risk Reviewer. Evaluate the Thesis Team output against
portfolio concentration, drawdown tolerance, and macro liquidity conditions. Output must enumerate
the specific risk categories affected and propose risk limits. Never approve an execution implicitly.
${RISK_OUTPUT_INSTRUCTIONS}`;

export const PORTFOLIO_MANAGER_PROMPT = `You are the Portfolio Manager. Given the Risk Reviewer's output,
commit to the final system-primary decision object: portfolio decision, allocation guidance, risk limits,
alert triggers, and evidence references. This is the single source of truth downstream.
${RISK_OUTPUT_INSTRUCTIONS}`;
```

- [ ] **Step 4: Write Execution Prep prompts**

Create `apps/api/src/analysis/contracts/prompts/execution-prep.prompts.ts`:

```ts
export const TRADE_PLANNER_PROMPT = `You are the Trade Planner. Convert the Risk Team's decision object
into candidate orders. Stay broker-neutral — never reference Alpaca / OKX / CCXT fields. Quantity can be
SHARES, NOTIONAL_USD, PERCENT_NAV, or CONTRACTS. Always set approvalRequired=true.`;

export const EXECUTION_DRAFT_BUILDER_PROMPT = `You are the Execution Draft Builder. Given the planner output,
produce final broker-neutral orderDrafts matching the v1 schema. Return exactly:
\`\`\`json
{ "orderDrafts": [ {...}, ... ] }
\`\`\`
Every draft MUST include draftId, portfolioIntent, assetType, symbol, side, quantity, orderType, timeInForce,
thesisRef, riskRef, maxSlippageBps, maxPositionPercent, brokerConstraints, approvalRequired: true, warnings.`;
```

- [ ] **Step 5: Write the barrel export**

Create `apps/api/src/analysis/contracts/prompts/index.ts`:

```ts
export * from './intelligence.prompts';
export * from './thesis.prompts';
export * from './risk.prompts';
export * from './execution-prep.prompts';
```

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter @finsentinel/api typecheck
git add apps/api/src/analysis/contracts/prompts/
git commit -m "feat(analysis): v1 role prompts for intelligence/thesis/risk/execution teams"
```

---

## Task 3: TeamRegistry

Thin map from `AnalysisStageKey` → team service. Its only job is to let `RunOrchestratorService` call `registerStageExecutor` for each team during app bootstrap.

**Files:**
- Create: `apps/api/src/analysis/team-registry.ts`
- Create: `apps/api/src/analysis/__tests__/team-registry.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/analysis/__tests__/team-registry.spec.ts`:

```ts
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
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm --filter @finsentinel/api test -- team-registry`
Expected: FAIL.

- [ ] **Step 3: Implement the registry**

Create `apps/api/src/analysis/team-registry.ts`:

```ts
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
```

- [ ] **Step 4: Run tests + commit** (tests still FAIL — the team imports don't resolve until Tasks 4–8 land. That's fine — move on to Task 4 first; come back and run this test at the end of Task 8.)

```bash
git add apps/api/src/analysis/team-registry.ts apps/api/src/analysis/__tests__/team-registry.spec.ts
git commit -m "feat(analysis): TeamRegistry wires team executors into run orchestrator"
```

---

## Task 4: RoleExecutorService

One-stop LLM + tool invocation with role-scoped tool filtering and deterministic JSON extraction.

**Files:**
- Create: `apps/api/src/analysis/teams/role-executor.service.ts`
- Create: `apps/api/src/analysis/__tests__/role-executor.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/analysis/__tests__/role-executor.service.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoleExecutorService } from '../teams/role-executor.service';
import { ROLE_TOOL_SCOPE } from '../contracts/role-tool-scope';

describe('RoleExecutorService.run', () => {
  let mockStream: ReturnType<typeof vi.fn>;
  let toolRegistry: {
    buildToolSet: ReturnType<typeof vi.fn>;
  };
  let svc: RoleExecutorService;

  beforeEach(() => {
    mockStream = vi.fn().mockResolvedValue({
      text: `\`\`\`json\n{"summary":"s","thesis":"t","risks":[],"openQuestions":[],"citations":[],"confidence":0.7}\n\`\`\``,
    });
    toolRegistry = {
      buildToolSet: vi.fn().mockReturnValue({ getStockQuote: {}, stageOrder: {} }),
    };
    svc = new RoleExecutorService(toolRegistry as never, { generate: mockStream } as never);
  });

  it('filters tools to the role allow-list before calling the LLM', async () => {
    await svc.run({
      roleKey: 'MARKET_ANALYST',
      systemPrompt: 'sys',
      userInput: { prompt: 'x', contextText: 'ctx', priorStageOutputs: {} },
    });
    const invoked = mockStream.mock.calls[0]?.[0]?.tools;
    expect(invoked).toBeDefined();
    expect(Object.keys(invoked)).toContain('getStockQuote');
    expect(Object.keys(invoked)).not.toContain('stageOrder');
    expect(ROLE_TOOL_SCOPE.MARKET_ANALYST.includes('stageOrder' as never)).toBe(false);
  });

  it('parses the JSON block into structured output + retains raw markdown', async () => {
    const out = await svc.run({
      roleKey: 'MARKET_ANALYST',
      systemPrompt: 'sys',
      userInput: { prompt: 'x', contextText: '', priorStageOutputs: {} },
    });
    expect(out.structured).toMatchObject({
      summary: 's',
      thesis: 't',
      confidence: 0.7,
    });
    expect(out.rawMarkdown).toContain('```json');
  });

  it('throws if the LLM response contains no parseable JSON block', async () => {
    mockStream.mockResolvedValue({ text: 'no json here' });
    await expect(
      svc.run({
        roleKey: 'MARKET_ANALYST',
        systemPrompt: 'sys',
        userInput: { prompt: 'x', contextText: '', priorStageOutputs: {} },
      }),
    ).rejects.toThrow(/no JSON block/i);
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm --filter @finsentinel/api test -- role-executor`
Expected: FAIL.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/analysis/teams/role-executor.service.ts`:

```ts
import { Injectable, Inject, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import {
  stageStructuredOutputSchema,
  type StageStructuredOutput,
} from '@finsentinel/shared';
import { aiConfig } from '../../config/ai.config';
import { ToolRegistry } from '../../agent/tool-registry';
import {
  ROLE_TOOL_SCOPE,
} from '../contracts/role-tool-scope';
import type {
  RoleDefinition,
  RoleInput,
  RoleKey,
  RoleOutput,
} from '../contracts/role-contract';

export interface LlmRunner {
  generate(args: {
    model: unknown;
    system: string;
    prompt: string;
    tools: Record<string, unknown>;
  }): Promise<{ text: string }>;
}

@Injectable()
export class RoleExecutorService {
  private readonly logger = new Logger(RoleExecutorService.name);
  private readonly model;

  constructor(
    private readonly toolRegistry: ToolRegistry,
    @Inject('ROLE_EXECUTOR_LLM')
    private readonly llm: LlmRunner | undefined,
    @Inject(aiConfig.KEY) aiCfg?: ConfigType<typeof aiConfig>,
  ) {
    if (aiCfg) {
      const openrouter = createOpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: aiCfg.openrouterApiKey,
      });
      this.model = openrouter(aiCfg.model);
    }
  }

  async run(args: {
    roleKey: RoleKey;
    systemPrompt: string;
    userInput: RoleInput;
  }): Promise<RoleOutput> {
    const scope = ROLE_TOOL_SCOPE[args.roleKey];
    const fullTools =
      (this.toolRegistry as unknown as {
        buildToolSet(): Record<string, unknown>;
      }).buildToolSet?.() ?? {};
    const scopedTools: Record<string, unknown> = {};
    for (const name of scope) {
      if (fullTools[name]) scopedTools[name] = fullTools[name];
    }

    const userPrompt = this.buildUserPrompt(args.userInput);

    const llm = this.llm ?? this.defaultLlm();
    const { text } = await llm.generate({
      model: this.model,
      system: args.systemPrompt,
      prompt: userPrompt,
      tools: scopedTools,
    });

    const structured = this.parseStructured(text);
    return {
      roleKey: args.roleKey,
      structured,
      rawMarkdown: text,
    };
  }

  private buildUserPrompt(input: RoleInput): string {
    const lines = [`Task: ${input.prompt}`, '', '## Shared context', input.contextText];
    const prior = Object.entries(input.priorStageOutputs);
    if (prior.length > 0) {
      lines.push('', '## Prior stage outputs (JSON)');
      for (const [stage, out] of prior) {
        lines.push(`### ${stage}`);
        lines.push('```json');
        lines.push(JSON.stringify(out, null, 2));
        lines.push('```');
      }
    }
    if (input.extra) {
      lines.push('', '## Additional inputs (JSON)', '```json', JSON.stringify(input.extra), '```');
    }
    return lines.join('\n');
  }

  private parseStructured(text: string): StageStructuredOutput {
    const match = text.match(/```json\s*([\s\S]+?)\s*```/);
    if (!match?.[1]) throw new Error('Role output contains no JSON block');
    const obj = JSON.parse(match[1]) as unknown;
    return stageStructuredOutputSchema.parse(obj);
  }

  private defaultLlm(): LlmRunner {
    return {
      generate: async (args) =>
        generateText({
          model: args.model as never,
          system: args.system,
          prompt: args.prompt,
          tools: args.tools as never,
        }),
    };
  }
}

// Helper factories used by team services to avoid re-importing the prompts in each file.
export function roleDefinition(
  roleKey: RoleKey,
  systemPrompt: string,
): RoleDefinition {
  return { roleKey, systemPrompt, allowedToolNames: ROLE_TOOL_SCOPE[roleKey] };
}
```

- [ ] **Step 4: Run tests + commit**

Run: `pnpm --filter @finsentinel/api test -- role-executor`
Expected: PASS.

```bash
git add apps/api/src/analysis/teams/role-executor.service.ts \
        apps/api/src/analysis/__tests__/role-executor.service.spec.ts
git commit -m "feat(analysis): RoleExecutorService with tool-scope enforcement + JSON parse"
```

---

## Task 5: IntelligenceTeamService

Runs the 4 intelligence analysts sequentially (can be parallelized later; v1 sequential is fine). Combines their structured outputs into a team-level `StageStructuredOutput` and commits via `AnalysisCheckpointService`.

**Files:**
- Create: `apps/api/src/analysis/teams/intelligence-team.service.ts`
- Create: `apps/api/src/analysis/__tests__/intelligence-team.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/analysis/__tests__/intelligence-team.service.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntelligenceTeamService } from '../teams/intelligence-team.service';
import { AgentEventType } from '@finsentinel/shared';

describe('IntelligenceTeamService.execute', () => {
  let roleExec: { run: ReturnType<typeof vi.fn> };
  let runs: { getForUser: ReturnType<typeof vi.fn> };
  let checkpoints: { commitStage: ReturnType<typeof vi.fn> };
  let fabric: { assemble: ReturnType<typeof vi.fn>; toPromptReady: ReturnType<typeof vi.fn> };
  let events: { append: ReturnType<typeof vi.fn> };
  let svc: IntelligenceTeamService;

  beforeEach(() => {
    roleExec = {
      run: vi.fn().mockResolvedValue({
        roleKey: 'MARKET_ANALYST',
        structured: {
          summary: 's',
          thesis: 't',
          risks: [],
          openQuestions: [],
          citations: [],
          confidence: 0.8,
        },
        rawMarkdown: '# r',
      }),
    };
    runs = {
      getForUser: vi.fn().mockResolvedValue({
        id: 'r1',
        inputSnapshotJson: { prompt: 'analyze AAPL', ticker: 'AAPL' },
      }),
    };
    checkpoints = { commitStage: vi.fn().mockResolvedValue(undefined) };
    fabric = {
      assemble: vi.fn().mockResolvedValue({
        longTermPreferenceContext: { summary: 'a', sourceIds: [] },
        midTermStrategyContext: { summary: 'b', sourceIds: [] },
        shortTermSessionContext: { summary: 'c', sourceIds: [] },
        retrievalContext: { summary: 'd', sourceIds: [] },
      }),
      toPromptReady: vi.fn().mockReturnValue('ctx-text'),
    };
    events = { append: vi.fn().mockResolvedValue({}) };
    svc = new IntelligenceTeamService(
      roleExec as never,
      runs as never,
      checkpoints as never,
      fabric as never,
      events as never,
    );
  });

  it('emits INTELLIGENCE_TEAM_STARTED, runs 4 analysts, commits checkpoint, emits COMPLETED', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    expect(events.append).toHaveBeenCalledWith(
      'u1',
      expect.any(String),
      'r1',
      AgentEventType.INTELLIGENCE_TEAM_STARTED,
      expect.any(Object),
      null,
    );
    expect(roleExec.run).toHaveBeenCalledTimes(4);
    expect(checkpoints.commitStage).toHaveBeenCalledWith(
      expect.objectContaining({ stageKey: 'INTELLIGENCE', runId: 'r1', userId: 'u1' }),
    );
    expect(events.append).toHaveBeenCalledWith(
      'u1',
      expect.any(String),
      'r1',
      AgentEventType.INTELLIGENCE_TEAM_COMPLETED,
      expect.any(Object),
      null,
    );
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm --filter @finsentinel/api test -- intelligence-team`
Expected: FAIL.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/analysis/teams/intelligence-team.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import {
  AgentEventAggregateType,
  AgentEventType,
  type AnalysisStageKey,
  type StageStructuredOutput,
} from '@finsentinel/shared';
import { AgentEventService } from '../../events/agent-event.service';
import { AnalysisRunService } from '../analysis-run.service';
import { AnalysisCheckpointService } from '../analysis-checkpoint.service';
import { ContextFabricService } from '../context-fabric.service';
import { RoleExecutorService } from './role-executor.service';
import type { TeamService, TeamExecutionArgs } from '../contracts/team-contract';
import type { RoleKey } from '../contracts/role-contract';
import {
  MARKET_ANALYST_PROMPT,
  NEWS_ANALYST_PROMPT,
  FUNDAMENTALS_ANALYST_PROMPT,
  SENTIMENT_ANALYST_PROMPT,
} from '../contracts/prompts';

@Injectable()
export class IntelligenceTeamService implements TeamService {
  readonly stageKey: AnalysisStageKey = 'INTELLIGENCE';

  constructor(
    private readonly roleExecutor: RoleExecutorService,
    private readonly runs: AnalysisRunService,
    private readonly checkpoints: AnalysisCheckpointService,
    private readonly fabric: ContextFabricService,
    private readonly events: AgentEventService,
  ) {}

  async execute(args: TeamExecutionArgs): Promise<void> {
    await this.events.append(
      args.userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      args.runId,
      AgentEventType.INTELLIGENCE_TEAM_STARTED,
      {},
      null,
    );

    const run = await this.runs.getForUser(args.userId, args.runId);
    if (!run) throw new Error(`Run ${args.runId} not found`);
    const input = run.inputSnapshotJson as { prompt: string; ticker?: string };

    const ctx = await this.fabric.assemble({
      userId: args.userId,
      prompt: input.prompt,
    });
    const contextText = this.fabric.toPromptReady(ctx);

    const roles: Array<{ key: RoleKey; prompt: string }> = [
      { key: 'MARKET_ANALYST', prompt: MARKET_ANALYST_PROMPT },
      { key: 'NEWS_ANALYST', prompt: NEWS_ANALYST_PROMPT },
      { key: 'FUNDAMENTALS_ANALYST', prompt: FUNDAMENTALS_ANALYST_PROMPT },
      { key: 'SENTIMENT_ANALYST', prompt: SENTIMENT_ANALYST_PROMPT },
    ];

    const roleOutputs: Record<string, StageStructuredOutput> = {};
    const markdownParts: string[] = [];
    for (const role of roles) {
      const out = await this.roleExecutor.run({
        roleKey: role.key,
        systemPrompt: role.prompt,
        userInput: { prompt: input.prompt, contextText, priorStageOutputs: {} },
      });
      roleOutputs[role.key] = out.structured;
      markdownParts.push(`## ${role.key}\n${out.rawMarkdown}`);
    }

    const teamOutput: StageStructuredOutput = {
      summary: `Intelligence team assembled ${roles.length} analyst reports for ${input.ticker ?? 'subject'}.`,
      thesis: 'Evidence gathered. No thesis formed at this stage.',
      risks: Object.values(roleOutputs).flatMap((o) => o.risks).slice(0, 10),
      openQuestions: Object.values(roleOutputs)
        .flatMap((o) => o.openQuestions)
        .slice(0, 10),
      citations: Object.values(roleOutputs).flatMap((o) => o.citations).slice(0, 20),
      confidence: this.avgConfidence(Object.values(roleOutputs)),
      roleOutputs,
    };

    await this.checkpoints.commitStage({
      userId: args.userId,
      runId: args.runId,
      stageKey: this.stageKey,
      structuredOutput: teamOutput,
      humanReportMarkdown: markdownParts.join('\n\n'),
    });

    await this.events.append(
      args.userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      args.runId,
      AgentEventType.INTELLIGENCE_TEAM_COMPLETED,
      { roleCount: roles.length },
      null,
    );
  }

  private avgConfidence(rows: StageStructuredOutput[]): number {
    if (rows.length === 0) return 0;
    return rows.reduce((s, r) => s + (r.confidence ?? 0), 0) / rows.length;
  }
}
```

- [ ] **Step 4: Run tests + commit**

Run: `pnpm --filter @finsentinel/api test -- intelligence-team`
Expected: PASS.

```bash
git add apps/api/src/analysis/teams/intelligence-team.service.ts \
        apps/api/src/analysis/__tests__/intelligence-team.service.spec.ts
git commit -m "feat(analysis): IntelligenceTeamService runs 4 analysts + commits checkpoint"
```

---

## Task 6: ThesisTeamService (parallel + barrier)

The only v1 team with parallelism. Runs Positive and Negative via `Promise.all`, then runs Thesis Lead with both as input. Each role emits its own event.

**Files:**
- Create: `apps/api/src/analysis/teams/thesis-team.service.ts`
- Create: `apps/api/src/analysis/__tests__/thesis-team.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/analysis/__tests__/thesis-team.service.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThesisTeamService } from '../teams/thesis-team.service';
import { AgentEventType } from '@finsentinel/shared';

function makeRoleOutput(roleKey: string, thesis: string) {
  return {
    roleKey,
    structured: {
      summary: 's',
      thesis,
      risks: [],
      openQuestions: [],
      citations: [],
      confidence: 0.75,
    },
    rawMarkdown: `${roleKey}-md`,
  };
}

describe('ThesisTeamService.execute', () => {
  let roleExec: { run: ReturnType<typeof vi.fn> };
  let runs: { getForUser: ReturnType<typeof vi.fn> };
  let stages: {
    findByStage: ReturnType<typeof vi.fn>;
  };
  let checkpoints: { commitStage: ReturnType<typeof vi.fn> };
  let fabric: { assemble: ReturnType<typeof vi.fn>; toPromptReady: ReturnType<typeof vi.fn> };
  let events: { append: ReturnType<typeof vi.fn> };
  let svc: ThesisTeamService;
  let callOrder: string[];

  beforeEach(() => {
    callOrder = [];
    roleExec = {
      run: vi.fn().mockImplementation(async ({ roleKey }) => {
        callOrder.push(roleKey);
        return makeRoleOutput(roleKey, `${roleKey}-thesis`);
      }),
    };
    runs = {
      getForUser: vi.fn().mockResolvedValue({
        id: 'r1',
        inputSnapshotJson: { prompt: 'analyze AAPL' },
      }),
    };
    stages = {
      findByStage: vi.fn().mockResolvedValue({
        structuredOutputJson: {
          summary: 'intel',
          thesis: 'evidence gathered',
          risks: [],
          openQuestions: [],
          citations: [],
          confidence: 0.7,
        },
      }),
    };
    checkpoints = { commitStage: vi.fn().mockResolvedValue(undefined) };
    fabric = {
      assemble: vi.fn().mockResolvedValue({
        longTermPreferenceContext: { summary: 'a', sourceIds: [] },
        midTermStrategyContext: { summary: 'b', sourceIds: [] },
        shortTermSessionContext: { summary: 'c', sourceIds: [] },
        retrievalContext: { summary: 'd', sourceIds: [] },
      }),
      toPromptReady: vi.fn().mockReturnValue('ctx-text'),
    };
    events = { append: vi.fn().mockResolvedValue({}) };
    svc = new ThesisTeamService(
      roleExec as never,
      runs as never,
      stages as never,
      checkpoints as never,
      fabric as never,
      events as never,
    );
  });

  it('runs POSITIVE and NEGATIVE before THESIS_LEAD (barrier)', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    const leadIdx = callOrder.indexOf('THESIS_LEAD');
    expect(leadIdx).toBeGreaterThan(callOrder.indexOf('POSITIVE_CASE'));
    expect(leadIdx).toBeGreaterThan(callOrder.indexOf('NEGATIVE_CASE'));
  });

  it('emits start/complete events for each role plus team-level events', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    const eventTypes = events.append.mock.calls.map((c) => c[3]);
    expect(eventTypes).toContain(AgentEventType.THESIS_TEAM_STARTED);
    expect(eventTypes).toContain(AgentEventType.POSITIVE_CASE_STARTED);
    expect(eventTypes).toContain(AgentEventType.NEGATIVE_CASE_STARTED);
    expect(eventTypes).toContain(AgentEventType.THESIS_LEAD_COMPLETED);
    expect(eventTypes).toContain(AgentEventType.THESIS_TEAM_COMPLETED);
  });

  it('commits THESIS checkpoint using the lead output', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    expect(checkpoints.commitStage).toHaveBeenCalledWith(
      expect.objectContaining({
        stageKey: 'THESIS',
        structuredOutput: expect.objectContaining({
          thesis: expect.stringContaining('THESIS_LEAD'),
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm --filter @finsentinel/api test -- thesis-team`
Expected: FAIL.

- [ ] **Step 3: Extend AnalysisCheckpointService with a stage-lookup helper**

(Needed for Thesis + Risk teams to read prior stage outputs.) Edit `apps/api/src/analysis/analysis-checkpoint.service.ts` — append a new method to the class:

```ts
  async findByStage(runId: string, stageKey: AnalysisStageKey): Promise<{
    structuredOutputJson: StageStructuredOutput | null;
  } | null> {
    const [row] = await this.db
      .select()
      .from(analysisStages)
      .where(
        and(eq(analysisStages.runId, runId), eq(analysisStages.stageKey, stageKey)),
      )
      .limit(1);
    if (!row) return null;
    return row as { structuredOutputJson: StageStructuredOutput | null };
  }
```

(Ensure the `AnalysisStageKey` import is already present at the top of the file.)

- [ ] **Step 4: Implement the thesis service**

Create `apps/api/src/analysis/teams/thesis-team.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import {
  AgentEventAggregateType,
  AgentEventType,
  type AnalysisStageKey,
  type StageStructuredOutput,
} from '@finsentinel/shared';
import { AgentEventService } from '../../events/agent-event.service';
import { AnalysisRunService } from '../analysis-run.service';
import { AnalysisCheckpointService } from '../analysis-checkpoint.service';
import { ContextFabricService } from '../context-fabric.service';
import { RoleExecutorService } from './role-executor.service';
import type { TeamService, TeamExecutionArgs } from '../contracts/team-contract';
import {
  POSITIVE_CASE_PROMPT,
  NEGATIVE_CASE_PROMPT,
  THESIS_LEAD_PROMPT,
} from '../contracts/prompts';

@Injectable()
export class ThesisTeamService implements TeamService {
  readonly stageKey: AnalysisStageKey = 'THESIS';

  constructor(
    private readonly roleExecutor: RoleExecutorService,
    private readonly runs: AnalysisRunService,
    private readonly checkpoints: AnalysisCheckpointService,
    private readonly checkpointsLookup: AnalysisCheckpointService, // same instance — named for clarity in test
    private readonly fabric: ContextFabricService,
    private readonly events: AgentEventService,
  ) {}

  async execute(args: TeamExecutionArgs): Promise<void> {
    await this.emit(args, AgentEventType.THESIS_TEAM_STARTED, {});

    const run = await this.runs.getForUser(args.userId, args.runId);
    if (!run) throw new Error(`Run ${args.runId} not found`);
    const input = run.inputSnapshotJson as { prompt: string };

    const intelStage = await this.checkpoints.findByStage(args.runId, 'INTELLIGENCE');
    const priorStageOutputs: Record<string, StageStructuredOutput> = {};
    if (intelStage?.structuredOutputJson) {
      priorStageOutputs.INTELLIGENCE = intelStage.structuredOutputJson;
    }

    const ctx = await this.fabric.assemble({
      userId: args.userId,
      prompt: input.prompt,
    });
    const contextText = this.fabric.toPromptReady(ctx);
    const commonInput = { prompt: input.prompt, contextText, priorStageOutputs };

    // ── Parallel: Positive ∥ Negative ────────────────────────────────────────
    await this.emit(args, AgentEventType.POSITIVE_CASE_STARTED, {});
    await this.emit(args, AgentEventType.NEGATIVE_CASE_STARTED, {});

    const [positive, negative] = await Promise.all([
      this.roleExecutor.run({
        roleKey: 'POSITIVE_CASE',
        systemPrompt: POSITIVE_CASE_PROMPT,
        userInput: commonInput,
      }),
      this.roleExecutor.run({
        roleKey: 'NEGATIVE_CASE',
        systemPrompt: NEGATIVE_CASE_PROMPT,
        userInput: commonInput,
      }),
    ]);

    await this.emit(args, AgentEventType.POSITIVE_CASE_COMPLETED, {
      confidence: positive.structured.confidence,
    });
    await this.emit(args, AgentEventType.NEGATIVE_CASE_COMPLETED, {
      confidence: negative.structured.confidence,
    });

    // ── Barrier: Thesis Lead convergence ─────────────────────────────────────
    await this.emit(args, AgentEventType.THESIS_LEAD_STARTED, {});
    const lead = await this.roleExecutor.run({
      roleKey: 'THESIS_LEAD',
      systemPrompt: THESIS_LEAD_PROMPT,
      userInput: {
        prompt: input.prompt,
        contextText,
        priorStageOutputs,
        extra: {
          positiveCase: positive.structured,
          negativeCase: negative.structured,
        },
      },
    });
    await this.emit(args, AgentEventType.THESIS_LEAD_COMPLETED, {
      confidence: lead.structured.confidence,
    });

    const teamOutput: StageStructuredOutput = {
      summary: lead.structured.summary,
      thesis: `THESIS_LEAD: ${lead.structured.thesis}`,
      risks: [...positive.structured.risks, ...negative.structured.risks, ...lead.structured.risks],
      openQuestions: lead.structured.openQuestions,
      citations: [
        ...positive.structured.citations,
        ...negative.structured.citations,
        ...lead.structured.citations,
      ],
      confidence: lead.structured.confidence,
      positiveCase: positive.structured,
      negativeCase: negative.structured,
    };

    await this.checkpoints.commitStage({
      userId: args.userId,
      runId: args.runId,
      stageKey: this.stageKey,
      structuredOutput: teamOutput,
      humanReportMarkdown: [
        '# Thesis Team Report',
        '## Positive Case',
        positive.rawMarkdown,
        '## Negative Case',
        negative.rawMarkdown,
        '## Thesis Lead Convergence',
        lead.rawMarkdown,
      ].join('\n\n'),
    });

    await this.emit(args, AgentEventType.THESIS_TEAM_COMPLETED, {});
  }

  private async emit(
    args: TeamExecutionArgs,
    eventType: AgentEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.events.append(
      args.userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      args.runId,
      eventType,
      payload,
      null,
    );
  }
}
```

- [ ] **Step 5: Run tests + commit**

Run: `pnpm --filter @finsentinel/api test -- thesis-team`
Expected: PASS.

```bash
git add apps/api/src/analysis/teams/thesis-team.service.ts \
        apps/api/src/analysis/analysis-checkpoint.service.ts \
        apps/api/src/analysis/__tests__/thesis-team.service.spec.ts
git commit -m "feat(analysis): ThesisTeamService with parallel Positive||Negative + Lead barrier"
```

---

## Task 7: RiskTeamService

Sequential `Risk Reviewer → Portfolio Manager`. The Portfolio Manager produces the v1 decision object shape used by Execution Prep.

**Files:**
- Create: `apps/api/src/analysis/teams/risk-team.service.ts`
- Create: `apps/api/src/analysis/__tests__/risk-team.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/analysis/__tests__/risk-team.service.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RiskTeamService } from '../teams/risk-team.service';
import { AgentEventType } from '@finsentinel/shared';

describe('RiskTeamService.execute', () => {
  let roleExec: { run: ReturnType<typeof vi.fn> };
  let runs: { getForUser: ReturnType<typeof vi.fn> };
  let checkpoints: {
    findByStage: ReturnType<typeof vi.fn>;
    commitStage: ReturnType<typeof vi.fn>;
  };
  let fabric: { assemble: ReturnType<typeof vi.fn>; toPromptReady: ReturnType<typeof vi.fn> };
  let events: { append: ReturnType<typeof vi.fn> };
  let svc: RiskTeamService;

  beforeEach(() => {
    roleExec = {
      run: vi.fn().mockImplementation(async ({ roleKey }) => ({
        roleKey,
        structured: {
          summary: 's',
          thesis: 't',
          risks: [],
          openQuestions: [],
          citations: [],
          confidence: 0.8,
          portfolioDecision: 'HOLD',
          allocationGuidance: { notes: '', targets: [] },
          riskLimits: { maxDrawdownPct: 10, stopLossTriggers: [] },
          alertTriggers: [],
        },
        rawMarkdown: `${roleKey}-md`,
      })),
    };
    runs = {
      getForUser: vi.fn().mockResolvedValue({
        id: 'r1',
        inputSnapshotJson: { prompt: 'x' },
      }),
    };
    checkpoints = {
      findByStage: vi.fn().mockResolvedValue({ structuredOutputJson: { summary: 'prior' } }),
      commitStage: vi.fn().mockResolvedValue(undefined),
    };
    fabric = {
      assemble: vi.fn().mockResolvedValue({
        longTermPreferenceContext: { summary: '', sourceIds: [] },
        midTermStrategyContext: { summary: '', sourceIds: [] },
        shortTermSessionContext: { summary: '', sourceIds: [] },
        retrievalContext: { summary: '', sourceIds: [] },
      }),
      toPromptReady: vi.fn().mockReturnValue('ctx'),
    };
    events = { append: vi.fn().mockResolvedValue({}) };
    svc = new RiskTeamService(
      roleExec as never,
      runs as never,
      checkpoints as never,
      fabric as never,
      events as never,
    );
  });

  it('runs reviewer then portfolio manager and commits RISK stage', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    const ran = roleExec.run.mock.calls.map((c) => c[0].roleKey);
    expect(ran).toEqual(['RISK_REVIEWER', 'PORTFOLIO_MANAGER']);
    expect(checkpoints.commitStage).toHaveBeenCalledWith(
      expect.objectContaining({ stageKey: 'RISK' }),
    );
    const eventTypes = events.append.mock.calls.map((c) => c[3]);
    expect(eventTypes).toContain(AgentEventType.RISK_TEAM_STARTED);
    expect(eventTypes).toContain(AgentEventType.RISK_TEAM_COMPLETED);
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm --filter @finsentinel/api test -- risk-team`
Expected: FAIL.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/analysis/teams/risk-team.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import {
  AgentEventAggregateType,
  AgentEventType,
  type AnalysisStageKey,
  type StageStructuredOutput,
} from '@finsentinel/shared';
import { AgentEventService } from '../../events/agent-event.service';
import { AnalysisRunService } from '../analysis-run.service';
import { AnalysisCheckpointService } from '../analysis-checkpoint.service';
import { ContextFabricService } from '../context-fabric.service';
import { RoleExecutorService } from './role-executor.service';
import type { TeamService, TeamExecutionArgs } from '../contracts/team-contract';
import {
  RISK_REVIEWER_PROMPT,
  PORTFOLIO_MANAGER_PROMPT,
} from '../contracts/prompts';

@Injectable()
export class RiskTeamService implements TeamService {
  readonly stageKey: AnalysisStageKey = 'RISK';

  constructor(
    private readonly roleExecutor: RoleExecutorService,
    private readonly runs: AnalysisRunService,
    private readonly checkpoints: AnalysisCheckpointService,
    private readonly fabric: ContextFabricService,
    private readonly events: AgentEventService,
  ) {}

  async execute(args: TeamExecutionArgs): Promise<void> {
    await this.emit(args, AgentEventType.RISK_TEAM_STARTED, {});

    const run = await this.runs.getForUser(args.userId, args.runId);
    if (!run) throw new Error(`Run ${args.runId} not found`);
    const input = run.inputSnapshotJson as { prompt: string };

    const priorStageOutputs: Record<string, StageStructuredOutput> = {};
    for (const stageKey of ['INTELLIGENCE', 'THESIS'] as const) {
      const s = await this.checkpoints.findByStage(args.runId, stageKey);
      if (s?.structuredOutputJson) priorStageOutputs[stageKey] = s.structuredOutputJson;
    }

    const ctx = await this.fabric.assemble({ userId: args.userId, prompt: input.prompt });
    const contextText = this.fabric.toPromptReady(ctx);
    const commonInput = { prompt: input.prompt, contextText, priorStageOutputs };

    const reviewer = await this.roleExecutor.run({
      roleKey: 'RISK_REVIEWER',
      systemPrompt: RISK_REVIEWER_PROMPT,
      userInput: commonInput,
    });
    const pm = await this.roleExecutor.run({
      roleKey: 'PORTFOLIO_MANAGER',
      systemPrompt: PORTFOLIO_MANAGER_PROMPT,
      userInput: {
        ...commonInput,
        extra: { riskReviewerOutput: reviewer.structured },
      },
    });

    const teamOutput: StageStructuredOutput = {
      summary: pm.structured.summary,
      thesis: pm.structured.thesis,
      risks: [...reviewer.structured.risks, ...pm.structured.risks],
      openQuestions: pm.structured.openQuestions,
      citations: pm.structured.citations,
      confidence: pm.structured.confidence,
      portfolioDecision: (pm.structured as unknown as { portfolioDecision: string }).portfolioDecision ?? 'HOLD',
      allocationGuidance:
        (pm.structured as unknown as { allocationGuidance: unknown }).allocationGuidance ?? { notes: '', targets: [] },
      riskLimits:
        (pm.structured as unknown as { riskLimits: unknown }).riskLimits ?? {
          maxDrawdownPct: 10,
          stopLossTriggers: [],
        },
      alertTriggers:
        (pm.structured as unknown as { alertTriggers: unknown }).alertTriggers ?? [],
    };

    await this.checkpoints.commitStage({
      userId: args.userId,
      runId: args.runId,
      stageKey: this.stageKey,
      structuredOutput: teamOutput,
      humanReportMarkdown: [
        '# Risk Team Report',
        '## Risk Reviewer',
        reviewer.rawMarkdown,
        '## Portfolio Manager',
        pm.rawMarkdown,
      ].join('\n\n'),
    });

    await this.emit(args, AgentEventType.RISK_TEAM_COMPLETED, {});
  }

  private async emit(
    args: TeamExecutionArgs,
    eventType: AgentEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.events.append(
      args.userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      args.runId,
      eventType,
      payload,
      null,
    );
  }
}
```

- [ ] **Step 4: Run tests + commit**

Run: `pnpm --filter @finsentinel/api test -- risk-team`
Expected: PASS.

```bash
git add apps/api/src/analysis/teams/risk-team.service.ts \
        apps/api/src/analysis/__tests__/risk-team.service.spec.ts
git commit -m "feat(analysis): RiskTeamService sequential reviewer->portfolio manager"
```

---

## Task 8: ExecutionPrepTeamService (emits validated `orderDrafts`)

Produces the broker-neutral `orderDrafts` artifact and requests an approval via `AnalysisApprovalService`. After this runs, the orchestrator transitions status to `WAITING_APPROVAL`.

**Files:**
- Create: `apps/api/src/analysis/teams/execution-prep-team.service.ts`
- Create: `apps/api/src/analysis/__tests__/execution-prep-team.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/analysis/__tests__/execution-prep-team.service.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionPrepTeamService } from '../teams/execution-prep-team.service';
import { AgentEventType } from '@finsentinel/shared';

const validDraft = {
  draftId: '11111111-1111-1111-1111-111111111111',
  portfolioIntent: 'OPEN',
  assetType: 'EQUITY',
  symbol: 'AAPL',
  side: 'BUY',
  quantity: { mode: 'SHARES', value: 100 },
  orderType: 'MARKET',
  limitPrice: null,
  stopPrice: null,
  timeInForce: 'DAY',
  thesisRef: 'artifact-t',
  riskRef: 'artifact-r',
  maxSlippageBps: 50,
  maxPositionPercent: 5,
  brokerConstraints: { allowFractional: false, extendedHours: false },
  approvalRequired: true,
  warnings: [],
};

describe('ExecutionPrepTeamService.execute', () => {
  let roleExec: { run: ReturnType<typeof vi.fn> };
  let runs: { getForUser: ReturnType<typeof vi.fn> };
  let checkpoints: {
    findByStage: ReturnType<typeof vi.fn>;
    commitStage: ReturnType<typeof vi.fn>;
  };
  let artifacts: { writeOrderDrafts: ReturnType<typeof vi.fn> };
  let validator: { validate: ReturnType<typeof vi.fn> };
  let approvals: { request: ReturnType<typeof vi.fn> };
  let fabric: { assemble: ReturnType<typeof vi.fn>; toPromptReady: ReturnType<typeof vi.fn> };
  let events: { append: ReturnType<typeof vi.fn> };
  let runsSvc: { transitionStatus?: unknown };
  let svc: ExecutionPrepTeamService;

  beforeEach(() => {
    roleExec = {
      run: vi
        .fn()
        // TRADE_PLANNER
        .mockResolvedValueOnce({
          roleKey: 'TRADE_PLANNER',
          structured: {
            summary: 's',
            thesis: 't',
            risks: [],
            openQuestions: [],
            citations: [],
            confidence: 0.8,
          },
          rawMarkdown: 'plan',
        })
        // EXECUTION_DRAFT_BUILDER — returns JSON with orderDrafts
        .mockResolvedValueOnce({
          roleKey: 'EXECUTION_DRAFT_BUILDER',
          structured: {
            summary: 's',
            thesis: 't',
            risks: [],
            openQuestions: [],
            citations: [],
            confidence: 0.9,
            orderDrafts: [validDraft],
          },
          rawMarkdown: '```json\n{"orderDrafts":[...]}\n```',
        }),
    };
    runs = {
      getForUser: vi.fn().mockResolvedValue({
        id: 'r1',
        inputSnapshotJson: { prompt: 'x' },
      }),
    };
    checkpoints = {
      findByStage: vi.fn().mockResolvedValue({ structuredOutputJson: { summary: 'risk' } }),
      commitStage: vi.fn().mockResolvedValue(undefined),
    };
    artifacts = { writeOrderDrafts: vi.fn().mockResolvedValue({ id: 'art-1' }) };
    validator = {
      validate: vi.fn().mockImplementation((v) => v),
    };
    approvals = { request: vi.fn().mockResolvedValue({ id: 'appr-1' }) };
    fabric = {
      assemble: vi.fn().mockResolvedValue({
        longTermPreferenceContext: { summary: '', sourceIds: [] },
        midTermStrategyContext: { summary: '', sourceIds: [] },
        shortTermSessionContext: { summary: '', sourceIds: [] },
        retrievalContext: { summary: '', sourceIds: [] },
      }),
      toPromptReady: vi.fn().mockReturnValue('ctx'),
    };
    events = { append: vi.fn().mockResolvedValue({}) };
    runsSvc = {};
    svc = new ExecutionPrepTeamService(
      roleExec as never,
      runs as never,
      checkpoints as never,
      artifacts as never,
      validator as never,
      approvals as never,
      fabric as never,
      events as never,
    );
  });

  it('validates drafts, writes ORDER_DRAFTS artifact, opens approval, commits stage', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    expect(validator.validate).toHaveBeenCalledWith({ orderDrafts: [validDraft] });
    expect(artifacts.writeOrderDrafts).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'r1',
        payload: { orderDrafts: [validDraft] },
      }),
    );
    expect(approvals.request).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'r1', userId: 'u1' }),
    );
    expect(checkpoints.commitStage).toHaveBeenCalledWith(
      expect.objectContaining({ stageKey: 'EXECUTION_PREP' }),
    );
    const eventTypes = events.append.mock.calls.map((c) => c[3]);
    expect(eventTypes).toContain(AgentEventType.EXECUTION_PREP_TEAM_STARTED);
    expect(eventTypes).toContain(AgentEventType.EXECUTION_PREP_TEAM_COMPLETED);
  });

  it('fails loudly when builder output has no orderDrafts', async () => {
    roleExec.run = vi
      .fn()
      .mockResolvedValueOnce({
        roleKey: 'TRADE_PLANNER',
        structured: {
          summary: '', thesis: '', risks: [], openQuestions: [], citations: [], confidence: 0,
        },
        rawMarkdown: '',
      })
      .mockResolvedValueOnce({
        roleKey: 'EXECUTION_DRAFT_BUILDER',
        structured: {
          summary: '', thesis: '', risks: [], openQuestions: [], citations: [], confidence: 0,
        },
        rawMarkdown: '',
      });
    svc = new ExecutionPrepTeamService(
      roleExec as never,
      runs as never,
      checkpoints as never,
      artifacts as never,
      validator as never,
      approvals as never,
      fabric as never,
      events as never,
    );
    await expect(svc.execute({ runId: 'r1', userId: 'u1' })).rejects.toThrow(/orderDrafts/);
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm --filter @finsentinel/api test -- execution-prep-team`
Expected: FAIL.

- [ ] **Step 3: Extend the checkpoint service with an artifact helper** (keep it single-responsibility)

Edit `apps/api/src/analysis/analysis-checkpoint.service.ts` — append inside the class:

```ts
  async writeOrderDrafts(args: {
    runId: string;
    stageId: string | null;
    payload: { orderDrafts: unknown[] };
  }): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(analysisArtifacts)
      .values({
        runId: args.runId,
        stageId: args.stageId ?? undefined,
        artifactKind: 'ORDER_DRAFTS',
        artifactName: 'order-drafts.json',
        mimeType: 'application/json',
        payloadJson: args.payload as Record<string, unknown>,
      })
      .returning();
    return row as { id: string };
  }
```

- [ ] **Step 4: Implement OrderDraftValidator (Task 9 creates the full service; for now just stub its interface)**

Note: Task 9 creates the real `OrderDraftValidator`. For this task's test, we inject a mock. Leave the implementation for Task 9.

- [ ] **Step 5: Implement the execution-prep service**

Create `apps/api/src/analysis/teams/execution-prep-team.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import {
  AgentEventAggregateType,
  AgentEventType,
  type AnalysisStageKey,
  type OrderDraftsPayload,
  type StageStructuredOutput,
} from '@finsentinel/shared';
import { AgentEventService } from '../../events/agent-event.service';
import { AnalysisRunService } from '../analysis-run.service';
import { AnalysisCheckpointService } from '../analysis-checkpoint.service';
import { AnalysisApprovalService } from '../analysis-approval.service';
import { ContextFabricService } from '../context-fabric.service';
import { RoleExecutorService } from './role-executor.service';
import { OrderDraftValidator } from '../../trading/order-draft-validator.service';
import type { TeamService, TeamExecutionArgs } from '../contracts/team-contract';
import {
  TRADE_PLANNER_PROMPT,
  EXECUTION_DRAFT_BUILDER_PROMPT,
} from '../contracts/prompts';

@Injectable()
export class ExecutionPrepTeamService implements TeamService {
  readonly stageKey: AnalysisStageKey = 'EXECUTION_PREP';

  constructor(
    private readonly roleExecutor: RoleExecutorService,
    private readonly runs: AnalysisRunService,
    private readonly checkpoints: AnalysisCheckpointService,
    private readonly artifactsWriter: AnalysisCheckpointService, // same instance, used for writeOrderDrafts
    private readonly validator: OrderDraftValidator,
    private readonly approvals: AnalysisApprovalService,
    private readonly fabric: ContextFabricService,
    private readonly events: AgentEventService,
  ) {}

  async execute(args: TeamExecutionArgs): Promise<void> {
    await this.emit(args, AgentEventType.EXECUTION_PREP_TEAM_STARTED, {});

    const run = await this.runs.getForUser(args.userId, args.runId);
    if (!run) throw new Error(`Run ${args.runId} not found`);
    const input = run.inputSnapshotJson as { prompt: string };

    const priorStageOutputs: Record<string, StageStructuredOutput> = {};
    for (const stageKey of ['INTELLIGENCE', 'THESIS', 'RISK'] as const) {
      const s = await this.checkpoints.findByStage(args.runId, stageKey);
      if (s?.structuredOutputJson) priorStageOutputs[stageKey] = s.structuredOutputJson;
    }

    const ctx = await this.fabric.assemble({ userId: args.userId, prompt: input.prompt });
    const contextText = this.fabric.toPromptReady(ctx);

    const planner = await this.roleExecutor.run({
      roleKey: 'TRADE_PLANNER',
      systemPrompt: TRADE_PLANNER_PROMPT,
      userInput: { prompt: input.prompt, contextText, priorStageOutputs },
    });

    const builder = await this.roleExecutor.run({
      roleKey: 'EXECUTION_DRAFT_BUILDER',
      systemPrompt: EXECUTION_DRAFT_BUILDER_PROMPT,
      userInput: {
        prompt: input.prompt,
        contextText,
        priorStageOutputs,
        extra: { plannerOutput: planner.structured },
      },
    });

    const rawDrafts = (builder.structured as unknown as { orderDrafts?: unknown })
      .orderDrafts;
    if (!rawDrafts || !Array.isArray(rawDrafts) || rawDrafts.length === 0) {
      throw new Error(
        'ExecutionPrepTeam: builder produced no orderDrafts — cannot proceed to approval',
      );
    }

    // Broker-neutral schema validation happens HERE before anything downstream.
    const validated: OrderDraftsPayload = this.validator.validate({
      orderDrafts: rawDrafts as never,
    });

    const artifact = await this.artifactsWriter.writeOrderDrafts({
      runId: args.runId,
      stageId: null,
      payload: validated,
    });

    await this.approvals.request({
      userId: args.userId,
      runId: args.runId,
      payload: validated,
    });

    const teamOutput: StageStructuredOutput = {
      summary: `Generated ${validated.orderDrafts.length} broker-neutral order draft(s). Awaiting approval.`,
      thesis: 'Execution drafts validated and queued for human approval.',
      risks: builder.structured.risks,
      openQuestions: builder.structured.openQuestions,
      citations: builder.structured.citations,
      confidence: builder.structured.confidence,
      orderDraftsArtifactId: artifact.id,
      orderDraftCount: validated.orderDrafts.length,
    };

    await this.checkpoints.commitStage({
      userId: args.userId,
      runId: args.runId,
      stageKey: this.stageKey,
      structuredOutput: teamOutput,
      humanReportMarkdown: [
        '# Execution Prep Team Report',
        '## Plan',
        planner.rawMarkdown,
        '## Builder',
        builder.rawMarkdown,
      ].join('\n\n'),
    });

    await this.emit(args, AgentEventType.EXECUTION_PREP_TEAM_COMPLETED, {
      orderDraftCount: validated.orderDrafts.length,
    });
  }

  private async emit(
    args: TeamExecutionArgs,
    eventType: AgentEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.events.append(
      args.userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      args.runId,
      eventType,
      payload,
      null,
    );
  }
}
```

- [ ] **Step 6: Run tests + commit**

Run: `pnpm --filter @finsentinel/api test -- execution-prep-team`
Expected: PASS.

```bash
git add apps/api/src/analysis/teams/execution-prep-team.service.ts \
        apps/api/src/analysis/analysis-checkpoint.service.ts \
        apps/api/src/analysis/__tests__/execution-prep-team.service.spec.ts
git commit -m "feat(analysis): ExecutionPrepTeamService emits validated broker-neutral drafts"
```

---

## Task 9: OrderDraftValidator + OrderDraftMapper

Owned by the Trading module so the broker-neutral boundary lives where broker code already lives.

**Files:**
- Create: `apps/api/src/trading/order-draft-validator.service.ts`
- Create: `apps/api/src/trading/order-draft-mapper.service.ts`
- Create: `apps/api/src/trading/__tests__/order-draft-validator.spec.ts`
- Create: `apps/api/src/trading/__tests__/order-draft-mapper.spec.ts`

- [ ] **Step 1: Write the validator test**

Create `apps/api/src/trading/__tests__/order-draft-validator.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { OrderDraftValidator } from '../order-draft-validator.service';

const valid = {
  draftId: '22222222-2222-2222-2222-222222222222',
  portfolioIntent: 'OPEN',
  assetType: 'EQUITY',
  symbol: 'AAPL',
  side: 'BUY',
  quantity: { mode: 'SHARES', value: 100 },
  orderType: 'MARKET',
  limitPrice: null,
  stopPrice: null,
  timeInForce: 'DAY',
  thesisRef: 'a',
  riskRef: 'b',
  maxSlippageBps: 50,
  maxPositionPercent: 5,
  brokerConstraints: { allowFractional: false, extendedHours: false },
  approvalRequired: true,
  warnings: [],
};

describe('OrderDraftValidator', () => {
  const v = new OrderDraftValidator();

  it('passes a valid payload through unchanged', () => {
    expect(v.validate({ orderDrafts: [valid] })).toEqual({ orderDrafts: [valid] });
  });

  it('rejects broker-specific leakage via strict mode', () => {
    expect(() =>
      v.validate({ orderDrafts: [{ ...valid, alpacaAccountId: 'x' } as never] }),
    ).toThrow();
  });

  it('rejects missing approvalRequired', () => {
    const bad = { ...valid, approvalRequired: false };
    expect(() => v.validate({ orderDrafts: [bad as never] })).toThrow();
  });
});
```

- [ ] **Step 2: Implement the validator**

Create `apps/api/src/trading/order-draft-validator.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import {
  orderDraftSchema,
  orderDraftsPayloadSchema,
  type OrderDraftsPayload,
} from '@finsentinel/shared';

@Injectable()
export class OrderDraftValidator {
  /**
   * Parses the payload in strict mode — any unknown field on a draft throws.
   * This is how we keep broker-specific fields out of the boundary.
   */
  validate(raw: unknown): OrderDraftsPayload {
    const wrapper = orderDraftsPayloadSchema.parse(raw);
    // Re-run each draft under strict() to block unknown keys at the draft level.
    for (const draft of wrapper.orderDrafts) {
      orderDraftSchema.strict().parse(draft);
    }
    return wrapper;
  }
}
```

- [ ] **Step 3: Write the mapper test**

Create `apps/api/src/trading/__tests__/order-draft-mapper.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { OrderDraftMapper } from '../order-draft-mapper.service';

const draft = {
  draftId: '33333333-3333-3333-3333-333333333333',
  portfolioIntent: 'OPEN',
  assetType: 'EQUITY',
  symbol: 'AAPL',
  side: 'BUY',
  quantity: { mode: 'SHARES', value: 100 },
  orderType: 'MARKET',
  limitPrice: null,
  stopPrice: null,
  timeInForce: 'DAY',
  thesisRef: 't',
  riskRef: 'r',
  maxSlippageBps: 50,
  maxPositionPercent: 5,
  brokerConstraints: { allowFractional: false, extendedHours: false },
  approvalRequired: true,
  warnings: [],
} as const;

describe('OrderDraftMapper.toUnifiedStageRequest', () => {
  const m = new OrderDraftMapper();

  it('maps SHARES quantity to qty string', () => {
    const out = m.toUnifiedStageRequest(draft);
    expect(out).toMatchObject({
      action: 'BUY',
      symbol: 'AAPL',
      qty: '100',
    });
    expect(out.amount).toBeUndefined();
  });

  it('maps NOTIONAL_USD quantity to amount', () => {
    const out = m.toUnifiedStageRequest({
      ...draft,
      quantity: { mode: 'NOTIONAL_USD', value: 1000 },
    });
    expect(out).toMatchObject({ amount: '1000' });
    expect(out.qty).toBeUndefined();
  });

  it('rejects unsupported modes (PERCENT_NAV requires wallet resolution — out of v1)', () => {
    expect(() =>
      m.toUnifiedStageRequest({
        ...draft,
        quantity: { mode: 'PERCENT_NAV', value: 5 },
      }),
    ).toThrow(/PERCENT_NAV/);
  });
});
```

- [ ] **Step 4: Implement the mapper**

Create `apps/api/src/trading/order-draft-mapper.service.ts`:

```ts
import { Injectable, BadRequestException } from '@nestjs/common';
import type { OrderDraft, UnifiedStageRequest } from '@finsentinel/shared';

@Injectable()
export class OrderDraftMapper {
  /**
   * Convert an approved broker-neutral OrderDraft into a
   * UnifiedStageRequest that UnifiedTradingService.stage can consume.
   *
   * PERCENT_NAV and CONTRACTS modes require wallet/product resolution that
   * is out of scope for v1 — if the Execution Prep team emits these we fail
   * loudly so upstream teams are forced to use SHARES or NOTIONAL_USD.
   */
  toUnifiedStageRequest(draft: OrderDraft): UnifiedStageRequest {
    const base: UnifiedStageRequest = {
      action: draft.side,
      symbol: draft.symbol,
    };

    switch (draft.quantity.mode) {
      case 'SHARES':
      case 'CONTRACTS':
        return { ...base, qty: String(draft.quantity.value) };
      case 'NOTIONAL_USD':
        return { ...base, amount: String(draft.quantity.value) };
      case 'PERCENT_NAV':
        throw new BadRequestException(
          'PERCENT_NAV quantity mode is not supported in v1 — resubmit with SHARES or NOTIONAL_USD',
        );
    }
  }
}
```

- [ ] **Step 5: Register in TradingModule**

Edit `apps/api/src/trading/trading.module.ts`. Add to the `providers` and `exports` arrays:

```ts
    OrderDraftValidator,
    OrderDraftMapper,
```

and import at the top:

```ts
import { OrderDraftValidator } from './order-draft-validator.service';
import { OrderDraftMapper } from './order-draft-mapper.service';
```

- [ ] **Step 6: Run tests + commit**

```bash
pnpm --filter @finsentinel/api test -- order-draft-validator order-draft-mapper
git add apps/api/src/trading/order-draft-validator.service.ts \
        apps/api/src/trading/order-draft-mapper.service.ts \
        apps/api/src/trading/__tests__/order-draft-validator.spec.ts \
        apps/api/src/trading/__tests__/order-draft-mapper.spec.ts \
        apps/api/src/trading/trading.module.ts
git commit -m "feat(trading): OrderDraftValidator + OrderDraftMapper enforce broker-neutral boundary"
```

---

## Task 10: HumanApprovalGateService

Runs as the last `executeStage` step. Its `execute()` is deliberately passive — it transitions the run to `WAITING_APPROVAL`, records a final-report artifact, and does NOT advance to the next stage. Resuming past this point happens via `AnalysisApprovalService.resolve()` calling back into the runtime (wired in Plan C).

**Files:**
- Create: `apps/api/src/analysis/teams/human-approval-gate.service.ts`
- Create: `apps/api/src/analysis/__tests__/human-approval-gate.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/analysis/__tests__/human-approval-gate.service.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HumanApprovalGateService } from '../teams/human-approval-gate.service';

describe('HumanApprovalGateService.execute', () => {
  let runs: {
    getForUser: ReturnType<typeof vi.fn>;
    transitionToWaitingApproval: ReturnType<typeof vi.fn>;
  };
  let checkpoints: { commitStage: ReturnType<typeof vi.fn> };
  let events: { append: ReturnType<typeof vi.fn> };
  let svc: HumanApprovalGateService;

  beforeEach(() => {
    runs = {
      getForUser: vi.fn().mockResolvedValue({ id: 'r1' }),
      transitionToWaitingApproval: vi.fn().mockResolvedValue(undefined),
    };
    checkpoints = { commitStage: vi.fn().mockResolvedValue(undefined) };
    events = { append: vi.fn().mockResolvedValue({}) };
    svc = new HumanApprovalGateService(runs as never, checkpoints as never, events as never);
  });

  it('transitions run to WAITING_APPROVAL and commits HUMAN_APPROVAL stage', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    expect(runs.transitionToWaitingApproval).toHaveBeenCalledWith('u1', 'r1');
    expect(checkpoints.commitStage).toHaveBeenCalledWith(
      expect.objectContaining({ stageKey: 'HUMAN_APPROVAL' }),
    );
  });
});
```

- [ ] **Step 2: Extend AnalysisRunService with the transition**

Edit `apps/api/src/analysis/analysis-run.service.ts` — add:

```ts
  async transitionToWaitingApproval(userId: string, runId: string): Promise<void> {
    await this.transitionStatus(userId, runId, 'WAITING_APPROVAL');
    await this.events.append(
      userId,
      AgentEventAggregateType.ANALYSIS_RUN,
      runId,
      AgentEventType.EXECUTION_APPROVAL_REQUIRED,
      {},
      null,
    );
  }
```

- [ ] **Step 3: Implement the gate**

Create `apps/api/src/analysis/teams/human-approval-gate.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { AnalysisStageKey, StageStructuredOutput } from '@finsentinel/shared';
import { AgentEventService } from '../../events/agent-event.service';
import { AnalysisRunService } from '../analysis-run.service';
import { AnalysisCheckpointService } from '../analysis-checkpoint.service';
import type { TeamService, TeamExecutionArgs } from '../contracts/team-contract';

@Injectable()
export class HumanApprovalGateService implements TeamService {
  readonly stageKey: AnalysisStageKey = 'HUMAN_APPROVAL';

  constructor(
    private readonly runs: AnalysisRunService,
    private readonly checkpoints: AnalysisCheckpointService,
    private readonly _events: AgentEventService,
  ) {}

  async execute(args: TeamExecutionArgs): Promise<void> {
    const run = await this.runs.getForUser(args.userId, args.runId);
    if (!run) throw new Error(`Run ${args.runId} not found`);

    const stageOutput: StageStructuredOutput = {
      summary: 'Awaiting human approval on broker-neutral order drafts.',
      thesis: 'Run paused at approval gate.',
      risks: [],
      openQuestions: ['User must approve or reject executionPayload'],
      citations: [],
      confidence: 1,
    };

    await this.checkpoints.commitStage({
      userId: args.userId,
      runId: args.runId,
      stageKey: this.stageKey,
      structuredOutput: stageOutput,
      humanReportMarkdown:
        '# Human Approval Gate\nRun is paused waiting for user approval.',
    });

    // Runtime gate — the orchestrator stops advancing beyond this.
    await this.runs.transitionToWaitingApproval(args.userId, args.runId);
  }
}
```

- [ ] **Step 4: Fix orchestrator so HUMAN_APPROVAL never advances**

Edit `apps/api/src/analysis/run-orchestrator.service.ts` — change `handleExecuteStage` so that when `data.stageKey === 'HUMAN_APPROVAL'` it does NOT call `markCompleted` and does NOT enqueue the next stage. Replace the `const next = this.nextStage(...)` block with:

```ts
      const run = await this.runs.getForUser(data.userId, data.runId);
      if (data.stageKey === 'HUMAN_APPROVAL' || run?.status === 'WAITING_APPROVAL') {
        // Hard stop — approval resolution re-enqueues via AnalysisApprovalService (Plan C).
        return;
      }
      const next = this.nextStage(data.stageKey);
      if (next === null) {
        await this.runs.markCompleted(data.userId, data.runId);
      } else {
        await this.runs.setCurrentStage(data.userId, data.runId, next);
        await this.producer.enqueueExecuteStage({
          runId: data.runId,
          userId: data.userId,
          stageKey: next,
        });
      }
```

- [ ] **Step 5: Run tests + commit**

Run: `pnpm --filter @finsentinel/api test -- human-approval-gate`
Expected: PASS.

```bash
git add apps/api/src/analysis/teams/human-approval-gate.service.ts \
        apps/api/src/analysis/analysis-run.service.ts \
        apps/api/src/analysis/run-orchestrator.service.ts \
        apps/api/src/analysis/__tests__/human-approval-gate.service.spec.ts
git commit -m "feat(analysis): HumanApprovalGateService transitions run to WAITING_APPROVAL"
```

---

## Task 11: Wire Team Services into AnalysisModule

**Files:**
- Modify: `apps/api/src/analysis/analysis.module.ts`

- [ ] **Step 1: Register team services**

Edit `apps/api/src/analysis/analysis.module.ts`. Import:

```ts
import { TradingModule } from '../trading/trading.module';
import { TeamRegistry } from './team-registry';
import { RoleExecutorService } from './teams/role-executor.service';
import { IntelligenceTeamService } from './teams/intelligence-team.service';
import { ThesisTeamService } from './teams/thesis-team.service';
import { RiskTeamService } from './teams/risk-team.service';
import { ExecutionPrepTeamService } from './teams/execution-prep-team.service';
import { HumanApprovalGateService } from './teams/human-approval-gate.service';
```

Add `TradingModule` to `imports`. Append the five team services + registry + executor to `providers`:

```ts
    RoleExecutorService,
    IntelligenceTeamService,
    ThesisTeamService,
    RiskTeamService,
    ExecutionPrepTeamService,
    HumanApprovalGateService,
    TeamRegistry,
    {
      provide: 'ROLE_EXECUTOR_LLM',
      useValue: undefined, // use default Vercel AI generateText
    },
```

- [ ] **Step 2: Typecheck + test + commit**

```bash
pnpm --filter @finsentinel/api typecheck
pnpm --filter @finsentinel/api test -- team-registry intelligence-team thesis-team risk-team execution-prep-team human-approval-gate
git add apps/api/src/analysis/analysis.module.ts
git commit -m "feat(analysis): wire team services + registry into AnalysisModule"
```

---

## Task 12: Approval Resolution → Orchestrator Re-entry

When a user approves, the orchestrator must mark the run completed and emit the approved payload as `EXECUTION_PAYLOAD` artifact. Plan C adds the broker-dispatch path; Plan B stops at artifact emission so B stays broker-agnostic.

**Files:**
- Modify: `apps/api/src/analysis/analysis-approval.service.ts`
- Modify: `apps/api/src/analysis/__tests__/analysis-approval.service.spec.ts`

- [ ] **Step 1: Extend the resolve test**

Append to `apps/api/src/analysis/__tests__/analysis-approval.service.spec.ts`:

```ts
import { OrderDraftMapper } from '../../trading/order-draft-mapper.service';
import { AnalysisRunService } from '../analysis-run.service';
import { AnalysisCheckpointService } from '../analysis-checkpoint.service';

describe('AnalysisApprovalService.resolve(APPROVE) follow-through', () => {
  it('writes EXECUTION_PAYLOAD artifact and marks run COMPLETED', async () => {
    const db = (function mk() {
      const state = {
        row: {
          id: 'appr-1',
          runId: 'r1',
          status: 'PENDING',
          requestedPayloadJson: { orderDrafts: [] },
        } as Record<string, unknown>,
      };
      return {
        insert: () => ({ values: (v: unknown) => ({ returning: async () => [{ id: 'a', ...(v as object) }] }) }),
        select: () => ({ from: () => ({ where: () => ({ limit: async () => [state.row] }) }) }),
        update: () => ({ set: () => ({ where: () => ({ returning: async () => [state.row] }) }) }),
      };
    })();
    const events = { append: vi.fn().mockResolvedValue({}) };
    const runs = { markCompleted: vi.fn().mockResolvedValue(undefined) } as unknown as AnalysisRunService;
    const checkpoints = {
      writeExecutionPayload: vi.fn().mockResolvedValue({ id: 'art' }),
    } as unknown as AnalysisCheckpointService;
    const mapper = new OrderDraftMapper();
    const svc = new (await import('../analysis-approval.service')).AnalysisApprovalService(
      db as never,
      events as never,
      runs,
      checkpoints,
      mapper,
    );

    await svc.resolve({ userId: 'u1', approvalId: 'appr-1', decision: 'APPROVE' });
    expect(checkpoints.writeExecutionPayload).toHaveBeenCalled();
    expect(runs.markCompleted).toHaveBeenCalledWith('u1', 'r1');
  });
});
```

- [ ] **Step 2: Extend AnalysisCheckpointService with executionPayload helper**

Edit `apps/api/src/analysis/analysis-checkpoint.service.ts`. Append:

```ts
  async writeExecutionPayload(args: {
    runId: string;
    payload: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(analysisArtifacts)
      .values({
        runId: args.runId,
        artifactKind: 'EXECUTION_PAYLOAD',
        artifactName: 'execution-payload.json',
        mimeType: 'application/json',
        payloadJson: args.payload,
      })
      .returning();
    return row as { id: string };
  }
```

- [ ] **Step 3: Extend AnalysisApprovalService with post-approve follow-through**

Edit `apps/api/src/analysis/analysis-approval.service.ts`. Change the constructor to also inject `AnalysisRunService`, `AnalysisCheckpointService`, and `OrderDraftMapper`:

```ts
import { AnalysisRunService } from './analysis-run.service';
import { AnalysisCheckpointService } from './analysis-checkpoint.service';
import { OrderDraftMapper } from '../trading/order-draft-mapper.service';

constructor(
  @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
  private readonly events: AgentEventService,
  private readonly runs: AnalysisRunService,
  private readonly checkpoints: AnalysisCheckpointService,
  private readonly mapper: OrderDraftMapper,
) {}
```

In `resolve()`, after appending the event, add:

```ts
    if (args.decision === 'APPROVE') {
      const payload = existing.requestedPayloadJson as { orderDrafts: unknown[] };
      // Compose the downstream execution payload per v1 spec (broker-neutral drafts +
      // pre-mapped UnifiedStageRequests so downstream broker adapters don't re-walk the tree).
      const mappedRequests = (payload.orderDrafts as never[]).map((d) =>
        this.mapper.toUnifiedStageRequest(d as never),
      );
      await this.checkpoints.writeExecutionPayload({
        runId: existing.runId,
        payload: { orderDrafts: payload.orderDrafts, stageRequests: mappedRequests },
      });
      await this.runs.markCompleted(args.userId, existing.runId);
    } else {
      // REJECT: mark the run CANCELED so it remains auditable.
      await this.runs.cancel(args.userId, existing.runId);
    }
```

(Be careful: the reject branch calls `runs.cancel()` which itself throws if status is already `CANCELED`. Since the run is `WAITING_APPROVAL` at this point, that's fine.)

- [ ] **Step 4: Update existing `AnalysisApprovalService` test setup**

The earlier test (Plan A Task 15) constructs `AnalysisApprovalService` with only two args. Update those constructors in Plan A's existing test file to pass stubs:

```ts
const runs = { markCompleted: vi.fn(), cancel: vi.fn() };
const checkpoints = { writeExecutionPayload: vi.fn() };
const mapper = { toUnifiedStageRequest: vi.fn() };
const svc = new AnalysisApprovalService(
  db as never,
  events as never,
  runs as never,
  checkpoints as never,
  mapper as never,
);
```

- [ ] **Step 5: Run tests + commit**

```bash
pnpm --filter @finsentinel/api test -- analysis-approval
git add apps/api/src/analysis/analysis-approval.service.ts \
        apps/api/src/analysis/analysis-checkpoint.service.ts \
        apps/api/src/analysis/__tests__/analysis-approval.service.spec.ts
git commit -m "feat(analysis): approval resolution writes execution payload artifact + completes run"
```

---

## Task 13: Plan B Test Sweep + Typecheck

**Files:** none.

- [ ] **Step 1: Targeted test sweep**

Run:

```bash
pnpm --filter @finsentinel/api test -- \
  team-registry \
  role-executor \
  intelligence-team \
  thesis-team \
  risk-team \
  execution-prep-team \
  human-approval-gate \
  analysis-approval \
  order-draft-validator \
  order-draft-mapper
```
Expected: all green.

- [ ] **Step 2: Full API typecheck**

Run: `pnpm --filter @finsentinel/api typecheck`
Expected: no errors.

- [ ] **Step 3: Boot check**

Run: `pnpm --filter @finsentinel/api dev` briefly. Confirm `TeamRegistry.onModuleInit` logs no errors and 5 `registerStageExecutor` calls happen. Kill with Ctrl-C.

---

## Plan B Exit Criteria

- [ ] Five team services (`Intelligence`, `Thesis`, `Risk`, `ExecutionPrep`, `HumanApproval`) exist and implement `TeamService`.
- [ ] `TeamRegistry.onModuleInit` wires all five stages into `RunOrchestratorService`.
- [ ] `RoleExecutorService` enforces `ROLE_TOOL_SCOPE` via tool filtering and parses JSON blocks into `stageStructuredOutputSchema`.
- [ ] `ThesisTeamService` runs `POSITIVE_CASE` and `NEGATIVE_CASE` in parallel then converges via `THESIS_LEAD`.
- [ ] `ExecutionPrepTeamService` emits a broker-neutral `ORDER_DRAFTS` artifact and requests approval.
- [ ] `OrderDraftValidator.validate` rejects broker-leaked fields and invalid drafts.
- [ ] `OrderDraftMapper` converts approved drafts to `UnifiedStageRequest`.
- [ ] Approving an approval writes `EXECUTION_PAYLOAD` artifact and marks the run `COMPLETED`.
- [ ] Rejecting an approval cancels the run.
- [ ] All targeted tests + API typecheck pass.

When green, move to **Plan C — Entry-Point Integration**.
