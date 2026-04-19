# Strategy Evidence Archive Runtime Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: use `superpowers:executing-plans` or `superpowers:subagent-driven-development` before implementation. This plan was written with `superpowers:writing-plans`, then reviewed through `plan-ceo-review` and `plan-eng-review` lenses.

**Goal:** Make the existing high-quality strategy template evaluator a first-class evidence source in analysis runs by persisting a typed `STRATEGY_ARCHIVE` artifact, feeding it into risk decisions, and surfacing it in the operator console.

**Architecture:** Keep the next slice narrow. Do not build Pine import, full backtesting, or strategy ranking yet. Add one programmatic strategy-evidence layer inside `apps/api/src/analysis/` that uses the existing `StrategyTemplateService`, existing market bars, existing `analysis_artifacts`, and existing `strategyArchivePayload` decision bucket.

**Tech Stack:** TypeScript, NestJS, Zod, Drizzle artifact storage, Vitest, Next.js analysis UI.

---

## Background

The repository already contains the first useful strategy primitive:

- `apps/api/src/market/strategy-template.service.ts` evaluates three Minara-derived templates.
- `apps/api/src/agent/tools/strategy-template.tool.ts` exposes `evaluateStrategyTemplate` to agents.
- `packages/shared/src/schemas/strategy.ts` defines typed template evaluations.
- `packages/shared/src/schemas/analysis.ts` already includes `artifactKindSchema = STRATEGY_ARCHIVE` and `decisionObject.strategyArchivePayload`.
- `packages/db/src/schema/analysis-artifacts.ts` can persist arbitrary artifact payloads.
- `apps/web/src/components/analysis/ArtifactsPanel.tsx` can already display generic artifacts.

The current gap is that strategy evaluation is available as an agent tool, but it is not guaranteed to run, not durably archived, and not propagated into the final decision object. That makes it too easy for the analysis runtime to ignore the strategy layer.

## Product Context

The approved design direction is FinSentinel as a trust ladder for high-concentration self-directed investors. The product should first help users understand what events mean for the book they already own, then expand into ideas and strategies only after earning trust.

This plan supports that direction by making strategy output evidence, not an automatic trade trigger:

- It explains whether a tested strategy template agrees with current market structure.
- It records warnings and reasons in an artifact the operator can inspect.
- It feeds risk decision context without bypassing human approval or execution checks.

## External Landscape Check

The outside references support the same implementation order:

- TradingView Strategy Tester documents strategy performance metrics including net profit, max drawdown, total trades, profit factor, commission paid, and trade-level records: https://www.tradingview.com/support/solutions/43000764138/
- TradingView Pine strategy docs explicitly warn that results are more meaningful when commission and slippage are modeled: https://www.tradingview.com/pine-script-docs/v5/concepts/strategies/
- TradingView strategy properties include commission, slippage, order sizing, margin, and fill-order assumptions as first-class strategy settings: https://www.tradingview.com/support/solutions/43000628599
- QuantConnect walk-forward docs frame parameter performance as time-varying and warn that optimization frequency trades off freshness against overfitting risk: https://www.quantconnect.com/docs/v2/writing-algorithms/optimization/walk-forward-optimization

Implication for this repo: do not treat a point-in-time template signal as a tradable strategy. First make the evidence durable and visible; later slices can add full trade replication, fee-aware backtesting, Pareto ranking, and walk-forward validation.

## CEO Review

### Mode Assumption

Use `SELECTIVE_EXPANSION`: hold implementation scope, but pick the highest-leverage expansion from the existing PRDs. The user asked for a detailed plan, not an interactive mode selection, so this plan records the mode assumption instead of blocking.

### Problem Reframe

The key product problem is not "how do we add more strategy templates?" It is "how does FinSentinel earn trust that its strategy reasoning is inspectable, repeatable, and separate from trade execution?"

The current implementation can evaluate templates, but the result can disappear inside a role output. The next best product move is to make strategy evidence a durable part of the analysis run.

### Options Considered

1. **Prompt-only use of `evaluateStrategyTemplate`**
   - Low code cost.
   - Fails reliability because the LLM may skip the tool or summarize it inconsistently.
   - Rejected.

2. **Programmatic strategy evidence archive**
   - Small enough for one implementation slice.
   - Uses existing strategy evaluator, market bars, artifacts, and final decision schema.
   - Recommended.

3. **Full Strategy Studio now**
   - Would include Pine import, replication, backtesting, Pareto ranking, and walk-forward runtime.
   - Matches long-term product ambition but is too broad for the next change.
   - Deferred.

### 10-Star Direction

The long-term 10-star version is not a screenshot leaderboard. It is a strategy trust ladder:

1. Current template signal is archived with reasons and warnings.
2. Fee-aware trade simulation estimates whether gross edge survives realistic costs.
3. Strategy candidates are ranked by Pareto tradeoffs, not only APR.
4. OOS and walk-forward runtime revalidates archived strategies.
5. Execution remains gated by human approval, order-draft validation, and risk limits.

This plan implements only step 1 while keeping the object model compatible with steps 2-4.

## Engineering Review

### Recommended Shape

Add `StrategyEvidenceService` in `apps/api/src/analysis/`:

```text
Analysis run input
  |
  | ticker
  v
StrategyEvidenceService
  |
  +-- MarketDataService.getHistoricalBars(ticker, 260)
  +-- StrategyTemplateService.evaluate(...) for v1 templates
  +-- classify status: EVALUATED | SKIPPED | DEGRADED
  +-- AnalysisCheckpointService.writeStrategyArchive(...)
  v
STRATEGY_ARCHIVE artifact
  |
  +-- Intelligence structured output includes strategyArchivePayload
  +-- Risk team carries payload into decision object
  +-- Final report assembler falls back to artifact if risk output omits it
  +-- Operator UI shows concise strategy archive summary
```

### Why Programmatic Instead Of Agent-Owned

The LLM should interpret strategy evidence, not own the numeric evaluation. Programmatic generation gives:

- deterministic template coverage
- consistent schema
- testable missing-data behavior
- durable artifact persistence
- less prompt fragility

### Data Contract

Extend shared strategy schemas with an archive payload:

```ts
export const strategyArchiveStatusSchema = z.enum([
  'EVALUATED',
  'SKIPPED',
  'DEGRADED',
]);

export const strategyArchivePayloadSchema = z.object({
  status: strategyArchiveStatusSchema,
  ticker: z.string().optional(),
  generatedAt: z.string(),
  bars: z.object({
    requestedDays: z.number().int().positive(),
    receivedBars: z.number().int().nonnegative(),
    source: z.string(),
  }),
  evaluations: z.array(strategyTemplateEvaluationSchema),
  selectedTemplateKey: strategyTemplateKeySchema.nullable(),
  summary: z.object({
    enterLongCount: z.number().int().nonnegative(),
    blockedCount: z.number().int().nonnegative(),
    warnings: z.array(z.string()),
    recommendedNextStep: strategyRecommendedNextStepSchema.nullable(),
  }),
  skipReason: z.string().optional(),
});
```

Keep `strategyArchivePayload.snapshot` compatibility in `analysis.ts` only if existing tests or persisted rows require it. The preferred direction is for `decisionObject.strategyArchivePayload` to parse this typed payload while still accepting `{ snapshot: {} }` as a fallback during rollout.

### Failure Policy

Strategy archive generation must not fail the full analysis run unless the failure is a programmer error.

- No ticker: write `status: SKIPPED`, `skipReason: "No ticker in run input."`
- Market data unavailable: write `status: DEGRADED`, zero evaluations, warning in summary.
- Too few bars: write `status: EVALUATED` if evaluator returns `BLOCKED`; do not throw.
- One template failure: write `status: DEGRADED`, include successful evaluations and warning.
- Invalid evaluator output: fail the service test path; this is a programmer/schema bug.

### Security And Safety

- Do not connect strategy signals to broker execution.
- Do not auto-stage order drafts from `ENTER_LONG`.
- Treat `ENTER_LONG` as evidence only; execution remains under `EXECUTION_PREP` and `HUMAN_APPROVAL`.
- Avoid storing raw third-party payloads beyond the normalized strategy archive.
- Keep all cost fields advisory and explicit.

### Performance

Use 260 daily bars by default. That is enough for 200-day SMA warmup and avoids excessive API usage. The service should run once per analysis run and store one artifact. Do not call market data separately per template.

### Observability

Use existing artifact persistence as the main audit trail. Event stream can rely on existing stage checkpoint events in this slice. A later slice can add a dedicated `STRATEGY_ARCHIVE_WRITTEN` event if operator timeline evidence needs to be more prominent.

## Scope

### In Scope

- Typed strategy archive payload schema.
- Programmatic strategy archive generation for all three existing v1 templates.
- Persistence as `STRATEGY_ARCHIVE` artifact.
- Intelligence stage writes or attaches archive payload.
- Risk stage carries strategy archive into `decisionObject.strategyArchivePayload`.
- Final report assembler can recover strategy archive from artifact/payload if the LLM omits it.
- Operator UI shows a concise strategy archive summary and still lets the user expand raw artifact JSON.
- Focused tests for schema, service behavior, artifact writes, stage propagation, report assembly, and API/UI contract.

### Out Of Scope

- Pine Script import.
- TradingView source-code parsing.
- Full backtesting engine.
- Trade-by-trade replication ledger.
- Keltner or SuperTrend templates.
- OOS / walk-forward runtime.
- Strategy rescue operators.
- Real broker order generation from strategy signals.
- New strategy database tables.
- Public strategy leaderboard.

## Assumptions

- `inputSnapshotJson.ticker` is the canonical run-level ticker for this slice.
- `MarketDataService.getHistoricalBars(ticker, days)` is the best existing bar source.
- Daily bars are acceptable for the current three templates.
- Generic `analysis_artifacts` storage is sufficient; no migration is needed.
- The existing generic `ArtifactsPanel` remains the raw evidence viewer.
- UI summary can be added without a new page.

## Uncertainties

- Need confirm exact `MarketDataService.getHistoricalBars` return shape during implementation.
- Need confirm whether web component tests exist or whether API-level tests are the only established web testing pattern.
- Need confirm if existing persisted decision objects rely on `{ strategyArchivePayload: { snapshot: {} } }`.
- Need confirm if the analysis API currently returns artifacts before or after final report refresh in the operator console polling loop.

## Simplest Viable Path

1. Define typed archive payload in shared schemas while preserving fallback compatibility.
2. Add `StrategyEvidenceService` and test it in isolation.
3. Add `writeStrategyArchive` to checkpoint service.
4. Call evidence generation once from Intelligence stage.
5. Propagate archive into Risk stage and decision assembly.
6. Add a small UI summary in the existing final report surface.
7. Run targeted tests and typecheck.

## Implementation Steps

### Step 1: Shared Strategy Archive Contract

**Files**

- Modify `packages/shared/src/schemas/strategy.ts`
- Modify `packages/shared/src/schemas/analysis.ts`
- Modify `packages/shared/src/__tests__/strategy-schema.test.ts`
- Modify `packages/shared/src/__tests__/analysis-schema.test.ts`

**Changes**

1. Add `strategyArchiveStatusSchema`.
2. Add `strategyArchivePayloadSchema`.
3. Export `StrategyArchivePayload`.
4. Update `decisionObjectSchema.strategyArchivePayload` to accept the typed archive payload.
5. Preserve `{ snapshot: {} }` compatibility with a union only if needed by existing tests.

**Verification**

Run:

```bash
pnpm --filter @finsentinel/shared test -- src/__tests__/strategy-schema.test.ts src/__tests__/analysis-schema.test.ts
pnpm --filter @finsentinel/shared typecheck
```

Expected:

- Archive payload parses valid `EVALUATED`, `SKIPPED`, and `DEGRADED` cases.
- Decision object still parses existing minimal fallback.
- Shared package typecheck passes.

**Progress log**

- 2026-04-18: Worker 1 completed the shared archive contract slice. Added `strategyArchiveStatusSchema`, `strategyArchivePayloadSchema`, and `StrategyArchivePayload`; updated `decisionObjectSchema.strategyArchivePayload` to accept the typed payload while keeping `{ snapshot: {} }` compatibility; added focused tests for `EVALUATED`, `SKIPPED`, and `DEGRADED` archive payloads plus decision-object fallback parsing; verified with shared package tests and typecheck.

### Step 2: Strategy Evidence Service

**Files**

- Create `apps/api/src/analysis/strategy-evidence.service.ts`
- Create `apps/api/src/analysis/__tests__/strategy-evidence.service.spec.ts`
- Modify `apps/api/src/analysis/analysis.module.ts`

**Changes**

1. Inject `MarketDataService` and `StrategyTemplateService`.
2. Add `buildArchive(args)`:

```ts
interface BuildStrategyArchiveArgs {
  ticker?: string;
  requestedDays?: number;
  generatedAt?: Date;
}
```

3. If no ticker, return `SKIPPED`.
4. Fetch bars once with default `requestedDays = 260`.
5. Evaluate all `strategyTemplateKeySchema.options`.
6. Select the best current template conservatively:
   - Prefer `REVIEW_FOR_BACKTEST`.
   - Then `PAPER_ONLY`.
   - Never select `REJECT`.
   - Break ties by higher confidence.
7. Aggregate warnings and counts.
8. Parse the final result through `strategyArchivePayloadSchema`.

**Verification**

Run:

```bash
pnpm --filter @finsentinel/api test -- src/analysis/__tests__/strategy-evidence.service.spec.ts
pnpm --filter @finsentinel/api typecheck
```

Expected tests:

- Missing ticker returns `SKIPPED`.
- Valid ticker evaluates three templates from one bar fetch.
- Insufficient bars returns archive with blocked evaluations, not thrown error.
- Market-data failure returns `DEGRADED`.
- One template exception returns `DEGRADED` with successful evaluations retained.

**Progress log**

- 2026-04-19: Worker 2 completed the strategy evidence service slice. Added `StrategyEvidenceService`, wired `MarketModule` into `AnalysisModule`, converted `MarketBar` string OHLC fields to numeric evaluator bars, and covered skipped, evaluated, market-data failure, and single-template failure paths.
- 2026-04-19: Review follow-up removed the local strategy archive schema mirror from `apps/api/src/analysis/strategy-evidence.service.ts`; the service and spec now import `strategyArchivePayloadSchema` from `@finsentinel/shared`. Verification requires rebuilding workspace dependency packages first: `pnpm --filter @finsentinel/shared build`, `pnpm --filter @finsentinel/db build`, then `pnpm --filter @finsentinel/api exec vitest run src/analysis/__tests__/strategy-evidence.service.spec.ts` and `pnpm --filter @finsentinel/api typecheck`, all passing locally.
- 2026-04-19: Step 2 review findings fixed. Added red coverage for empty `getHistoricalBars()` results and blank OHLC input, then updated `StrategyEvidenceService` to return a single typed `DEGRADED` archive with a non-empty warning when no bars are returned and to validate bar fields before coercion. Verified with `pnpm --filter @finsentinel/shared build`, `pnpm --filter @finsentinel/db build`, `pnpm --filter @finsentinel/api exec vitest run src/analysis/__tests__/strategy-evidence.service.spec.ts`, and `pnpm --filter @finsentinel/api typecheck`.
- 2026-04-19: Worker 4 completed the INTELLIGENCE-stage integration slice. Injected `StrategyEvidenceService` into `IntelligenceTeamService`, generated one archive from the run ticker, persisted it with `checkpoints.writeStrategyArchive({ stageKey: INTELLIGENCE })`, added `strategyArchivePayload` to the committed structured output, and appended a strategy-archive markdown section after the role reports. Updated the market analyst prompt to treat runtime strategy evidence as evidence only, not trade approval. Verified with `pnpm --filter @finsentinel/shared build`, `pnpm --filter @finsentinel/db build`, `pnpm --filter @finsentinel/api exec vitest run src/analysis/__tests__/intelligence-team.service.spec.ts`, and `pnpm --filter @finsentinel/api typecheck`.
- 2026-04-19: Review follow-up moved `checkpoints.writeStrategyArchive(...)` immediately after `strategyEvidence.buildArchive(...)` in `IntelligenceTeamService` so archive persistence happens before context assembly and analyst execution can fail. Added a regression test that forces `roleExecutor.run` to reject after archive generation and asserts the archive write occurred while `commitStage` did not. Verified with `pnpm --filter @finsentinel/shared build`, `pnpm --filter @finsentinel/db build`, `pnpm --filter @finsentinel/api exec vitest run src/analysis/__tests__/intelligence-team.service.spec.ts`, and `pnpm --filter @finsentinel/api typecheck`.
- 2026-04-19: Review follow-up for the final report assembler preserved legacy strategy archive snapshots with non-empty `snapshot` payloads instead of collapsing them to `{ snapshot: {} }`. Added a regression test for `{ snapshot: { legacy: true } }`, updated `parseStrategyArchivePayload()` to keep valid legacy snapshots unchanged, and verified with `pnpm --filter @finsentinel/api exec vitest run src/analysis/__tests__/run-report-assembler.service.spec.ts` and `pnpm --filter @finsentinel/api typecheck`.
- 2026-04-18: Worker 5 completed Step 5. Risk now threads `strategyArchivePayload` from `priorStageOutputs.INTELLIGENCE` into `commonInput.extra`, prefers a valid PM archive on commit, falls back to the intelligence archive, and then to `{ snapshot: {} }` for compatibility. Updated risk prompts to treat the archive as advisory evidence only and to explain contradictions instead of treating `ENTER_LONG` as approval. `RunReportAssembler` now preserves a typed archive payload from risk output while keeping the snapshot fallback. Verified with `pnpm --filter @finsentinel/shared build`, `pnpm --filter @finsentinel/db build`, `pnpm --filter @finsentinel/api exec vitest run src/analysis/__tests__/risk-team.service.spec.ts src/analysis/__tests__/run-report-assembler.service.spec.ts`, and `pnpm --filter @finsentinel/api typecheck`.

### Step 3: Persist `STRATEGY_ARCHIVE` Artifact

**Files**

- Modify `apps/api/src/analysis/analysis-checkpoint.service.ts`
- Modify `apps/api/src/analysis/__tests__/analysis-checkpoint.service.spec.ts`

**Changes**

Add:

```ts
async writeStrategyArchive(args: {
  userId: string;
  runId: string;
  stageKey: AnalysisStageKey;
  payload: StrategyArchivePayload;
}): Promise<void>
```

Implementation should:

- find the stage by `runId` and `stageKey`
- insert an artifact with:
  - `artifactKind: 'STRATEGY_ARCHIVE'`
  - `artifactName: 'strategy-archive.json'`
  - `mimeType: 'application/json'`
  - typed payload
- avoid mutating stage status

**Verification**

Run:

```bash
pnpm --filter @finsentinel/api test -- src/analysis/__tests__/analysis-checkpoint.service.spec.ts
```

Expected:

- The new method inserts exactly one `STRATEGY_ARCHIVE` artifact.
- Invalid payload is rejected before insert.
- Existing `commitStage` tests still pass.

**Progress log**

- 2026-04-18: Worker 3 completed the checkpoint persistence slice. Added `writeStrategyArchive(...)` to `AnalysisCheckpointService` with shared `strategyArchivePayloadSchema` validation, stage lookup by `(runId, stageKey)`, `STRATEGY_ARCHIVE` artifact insertion, and `NotFoundException` parity with `commitStage`. Added focused tests for successful insert, schema rejection, and missing-stage behavior. Verified with `pnpm --filter @finsentinel/shared build`, `pnpm --filter @finsentinel/db build`, and `pnpm --filter @finsentinel/api exec vitest run src/analysis/__tests__/analysis-checkpoint.service.spec.ts` passing. The exact requested `pnpm --filter @finsentinel/api test -- src/analysis/__tests__/analysis-checkpoint.service.spec.ts` command still fails due unrelated repo-wide integration/environment failures in other suites, while `pnpm --filter @finsentinel/api typecheck` passes.

### Step 4: Attach Strategy Archive To Intelligence Stage

**Files**

- Modify `apps/api/src/analysis/teams/intelligence-team.service.ts`
- Modify `apps/api/src/analysis/contracts/prompts/intelligence.prompts.ts`
- Modify `apps/api/src/analysis/__tests__/intelligence-team.service.spec.ts`

**Changes**

1. Inject `StrategyEvidenceService`.
2. After run input is loaded and before final `commitStage`, build the archive:

```ts
const strategyArchivePayload = await this.strategyEvidence.buildArchive({
  ticker: input.ticker,
});
await this.checkpoints.writeStrategyArchive({
  userId: args.userId,
  runId: args.runId,
  stageKey: this.stageKey,
  payload: strategyArchivePayload,
});
```

3. Add `strategyArchivePayload` to `teamOutput`.
4. Add a markdown section after role reports:

```md
## Strategy Evidence Archive
- Status: ...
- Selected template: ...
- Warnings: ...
```

5. Update `MARKET_ANALYST_PROMPT` to say strategy evidence may be supplied by runtime and must be cited as evidence, not as automatic trade approval.

**Verification**

Run:

```bash
pnpm --filter @finsentinel/api test -- src/analysis/__tests__/intelligence-team.service.spec.ts
```

Expected:

- Intelligence execution writes a `STRATEGY_ARCHIVE` artifact when ticker exists.
- Stage structured output includes `strategyArchivePayload`.
- Missing ticker still completes the stage with a skipped archive.

### Step 5: Carry Archive Through Risk And Decision Object

**Files**

- Modify `apps/api/src/analysis/teams/risk-team.service.ts`
- Modify `apps/api/src/analysis/contracts/prompts/risk.prompts.ts`
- Modify `apps/api/src/analysis/__tests__/risk-team.service.spec.ts`
- Modify `apps/api/src/analysis/run-report-assembler.service.ts`
- Modify `apps/api/src/analysis/__tests__/run-report-assembler.service.spec.ts`

**Changes**

1. Extract `strategyArchivePayload` from `priorStageOutputs.INTELLIGENCE`.
2. Pass it to the risk roles in `commonInput.extra.strategyArchivePayload`.
3. Set `teamOutput.strategyArchivePayload` to:
   - PM structured output value if valid.
   - otherwise prior intelligence archive.
   - otherwise `{ snapshot: {} }` compatibility fallback.
4. Update risk prompt instructions:
   - consider strategy archive as evidence only
   - do not convert `ENTER_LONG` into execution approval
   - explain if risk decision contradicts strategy signal
5. Update `RunReportAssembler` so the decision object preserves typed archive payload from risk output.

**Verification**

Run:

```bash
pnpm --filter @finsentinel/api test -- src/analysis/__tests__/risk-team.service.spec.ts src/analysis/__tests__/run-report-assembler.service.spec.ts
```

Expected:

- Risk team includes strategy archive payload in committed structured output.
- Final decision object includes typed strategy archive.
- If PM omits the archive, assembler still returns a valid decision object with fallback.

### Step 6: Operator Console Summary

**Files**

- Modify `apps/web/src/api/analysis-runs.ts`
- Modify `apps/web/src/components/analysis/FinalReportPanel.tsx`
- Modify or create the closest established web API/component test if available.

**Changes**

1. Add lightweight TypeScript types for strategy archive payload in the web API layer, or import shared types if the existing web build already consumes `@finsentinel/shared`.
2. In `FinalReportPanel`, read:
   - `run.decisionObjectJson.strategyArchivePayload`
   - or the latest `STRATEGY_ARCHIVE` artifact if passed to the component later
3. Render a concise section only when archive payload is present:

```text
Strategy Archive
Status: EVALUATED
Selected: RSI_70_MOMENTUM_CONTINUATION
Signals: 1 enter, 2 blocked
Warnings: ...
```

4. Keep raw artifact inspection in `ArtifactsPanel`; do not duplicate full JSON in the final report card.

**Verification**

Run:

```bash
pnpm --filter @finsentinel/web lint
pnpm --filter @finsentinel/web typecheck
```

If a component test harness exists by implementation time, add one focused test for summary rendering. If not, keep verification to typecheck/lint and manual browser verification in the next QA slice.

### Step 7: Runtime Integration Test

**Files**

- Modify `apps/api/src/analysis/__tests__/runtime-happy-path.integration.spec.ts`

**Changes**

Extend the happy-path integration with a mocked ticker run:

1. Run through the orchestrator.
2. Assert an artifact with `artifactKind === 'STRATEGY_ARCHIVE'`.
3. Assert final decision object includes `strategyArchivePayload`.
4. Assert the execution payload remains separate and does not receive auto-generated orders from strategy signals.

**Verification**

Run:

```bash
pnpm --filter @finsentinel/api test -- src/analysis/__tests__/runtime-happy-path.integration.spec.ts
```

Expected:

- Runtime still completes.
- Strategy archive is present.
- No execution bypass is introduced.

### Step 8: Final Verification

Run targeted checks first:

```bash
pnpm --filter @finsentinel/shared test -- src/__tests__/strategy-schema.test.ts src/__tests__/analysis-schema.test.ts
pnpm --filter @finsentinel/api test -- src/analysis/__tests__/strategy-evidence.service.spec.ts src/analysis/__tests__/analysis-checkpoint.service.spec.ts src/analysis/__tests__/intelligence-team.service.spec.ts src/analysis/__tests__/risk-team.service.spec.ts src/analysis/__tests__/run-report-assembler.service.spec.ts src/analysis/__tests__/runtime-happy-path.integration.spec.ts
pnpm --filter @finsentinel/web lint
pnpm typecheck
```

Then run broader tests if the targeted set is green:

```bash
pnpm test
pnpm build
```

## Acceptance Criteria

1. Every analysis run with a ticker creates or intentionally skips one `STRATEGY_ARCHIVE` artifact.
2. The archive evaluates all three existing v1 templates when enough market bars are available.
3. Strategy archive payload reaches the final decision object.
4. Risk output treats strategy evidence as advisory and does not bypass human approval.
5. Operator UI can show the archive summary without opening raw JSON.
6. Missing ticker or market-data failure does not fail the analysis run.
7. Targeted schema, API, runtime, and web checks pass.

## Key Decisions

- Use existing `analysis_artifacts`; no new DB table in this slice.
- Generate archive programmatically; do not rely on a role deciding to call the tool.
- Keep strategy signal separate from execution payload.
- Preserve compatibility with existing `{ snapshot: {} }` decision fallback while introducing the typed archive.
- Defer backtesting, source import, Pareto ranking, and walk-forward validation.

## Risks And Blockers

- **Market data shape mismatch:** verify `getHistoricalBars` shape before implementing service mapping.
- **Prompt drift:** mitigate by making archive generation programmatic and prompts interpretive only.
- **Decision schema compatibility:** use a transitional union if current tests or stored rows need old snapshot shape.
- **UI overreach:** keep the first UI summary small; raw details stay in `ArtifactsPanel`.
- **False precision:** clearly label strategy output as evidence and next-step guidance, not a trade recommendation.

## Tech Debt Tracker Updates

If implementation exposes gaps that are not directly fixed in this slice, update `docs/exec-plans/tech-debt-tracker.md` with:

- lack of dedicated strategy archive event type
- lack of full web component test harness, if confirmed
- duplicated strategy template key enums, if still present in tool code after this slice

Do not expand this implementation to fix unrelated debt.

## Progress Log

- 2026-04-19: Audited current strategy, analysis, artifact, run-report, prompt, and UI surfaces.
- 2026-04-19: Reviewed existing Minara strategy PRDs and trust-ladder design doc.
- 2026-04-19: Checked external strategy-validation references for cost, slippage, and walk-forward concerns.
- 2026-04-19: Chose programmatic Strategy Evidence Archive as the next highest-leverage implementation slice.
- 2026-04-19: Wrote this plan. Implementation pending.
- 2026-04-18: Completed the shared archive contract hardening slice. Converted `strategyArchivePayloadSchema` from a flat object to a `status`-discriminated union, enforced `ticker` for `EVALUATED`, `skipReason` plus empty evaluations for `SKIPPED`, and non-empty warnings for `DEGRADED`; added invalid-mix coverage and verified with the requested shared test command and typecheck.
- 2026-04-18: Worker 6 completed the web operator-console summary slice. Added a web-side `StrategyArchivePayload` type alias and guard in `apps/web/src/api/analysis-runs.ts`, rendered a concise `Strategy Archive` summary in `apps/web/src/components/analysis/FinalReportPanel.tsx` only for typed archive payloads, and kept the legacy `{ snapshot: {} }` fallback hidden. Verified with `pnpm --filter @finsentinel/shared build`, `pnpm --filter @finsentinel/web typecheck`, and `pnpm --filter @finsentinel/web test -- src/api/__tests__/analysis-runs.test.ts`; `pnpm --filter @finsentinel/web lint` still fails because of pre-existing errors in `src/context/AuthContext.tsx` and `src/lib/tauri/__tests__/is-tauri.test.ts`.
- 2026-04-18: Review follow-up closed the remaining web-side gap by switching analysis-run validation to shared `strategyArchivePayloadSchema.safeParse`, adding a malformed `SKIPPED` regression test, and redacting only legacy snapshot payloads before raw decision JSON stringify.

## Final Outcome

The strategy archive summary is now visible in the operator console without duplicating raw artifact JSON. The web type boundary and guard are in place, the snapshot fallback remains excluded from the summary, and the shared build plus web typecheck and focused test pass. Web lint still has unrelated pre-existing failures outside this slice.
