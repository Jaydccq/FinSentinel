# High-Quality Strategy Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a v1 high-quality strategy template engine that evaluates the first three Minara-derived strategy templates with typed outputs, fee-drag warnings, tests, and an agent tool entry point.

**Architecture:** Keep v1 deliberately small: add shared strategy contracts, a stateless `StrategyTemplateService` under `apps/api/src/market/`, and one agent tool factory. The service evaluates OHLCV bars against three supported templates using the existing `technicalindicators` dependency and returns structured signals, indicator snapshots, cost warnings, and gating reasons. Later Pine import, replication validation, full backtesting, and persistence consume this typed output rather than replacing it.

**Tech Stack:** TypeScript, NestJS, Zod, Vitest, `technicalindicators`, existing FinSentinel agent tool runtime.

---

## Background

The Minara strategy PRDs identify three strategies that FinSentinel can support first because the current codebase already has the required indicator family:

- `Optimized BTC Mean Reversion`: RSI + Stochastic + EMA trend filter
- `RSI > 70 Buy`: RSI momentum continuation
- `50 & 200 SMA + RSI Average`: long-only trend filter

The first implementation should not build a complete Strategy Studio. It should create a typed, tested strategy-quality layer that later PRDs can reuse.

## Success Criteria

1. The API can evaluate three named high-quality strategy templates from OHLCV bars.
2. Evaluation returns structured data: signal, confidence, reasons, indicator snapshot, cost profile, warnings, and recommended next step.
3. Agent tools expose the evaluator to existing analysis roles without opening an execution path.
4. Tests cover happy paths, insufficient bars, malformed input, fee-drag warnings, and tool error handling.
5. No database migration, broker execution, Pine import, or UI page is introduced in this slice.

## Assumptions

- OHLCV bars arrive as the existing `{ o, h, l, c, v, t }` JSON array returned by `getHistoricalPrices`.
- v1 evaluates current strategy state and quality, not full trade-by-trade backtesting.
- This feature produces analysis signals only; it never stages or executes orders.
- Fee settings are advisory inputs used for warnings, not venue-specific execution guarantees.

## What Already Exists

- `apps/api/src/market/technical-indicators.service.ts`: RSI, EMA, SMA, Stochastic, ADX, ATR, Bollinger, OBV string-format tools.
- `apps/api/src/market/market.module.ts`: exports market services to `AgentModule`.
- `apps/api/src/agent/tool-registry.ts`: central point for exposing tools to agent runs.
- `apps/api/src/agent/tools/__tests__/tools.spec.ts`: verifies tool shape and error contract.
- `packages/shared/src/schemas/index.ts`: shared schema barrel export.
- `docs/product-specs/2026-04-17-minara-strategy-optimization-index.md`: product split and strategy priority.

## NOT In Scope

- Pine Script parsing: deferred to `strategy-source-import-and-normalization`.
- Trade-by-trade replication: deferred to `trade-replication-validator`.
- Full backtesting engine: deferred to `fee-aware-strategy-backtesting`.
- Keltner and SuperTrend templates: deferred until indicator baselines exist.
- Strategy persistence: use analysis artifacts later; v1 stays stateless.
- UI page: agent/API tool surface is enough for this backend-first slice.

## Step 0: Scope Challenge

1. Existing code already solves indicator access and agent tool registration. Reuse those instead of building a parallel strategy runtime.
2. Minimum complete slice is contracts + stateless evaluator + tool + tests. Anything involving DB, UI, or Pine parsing is deferred.
3. Complexity smell check: plan touches 8 files and introduces one service plus one tool factory. This is acceptable because the tool factory is not a service and follows existing tool patterns.
4. Search/library check: existing `technicalindicators` is already installed and used. Layer 1 choice is to reuse it rather than add a new TA package.
5. `TODOS.md` does not exist, so there are no existing deferred items blocking this plan.

## Data Flow

```text
Agent / Analysis role
      |
      | evaluateStrategyTemplate({ barsJson, templateKey, feeProfile })
      v
strategy-template.tool.ts
      |
      v
StrategyTemplateService
      |
      +--> parse + validate OHLCV bars
      +--> compute indicator snapshot
      +--> apply selected template rule set
      +--> compute fee-drag / data-quality warnings
      v
StrategyTemplateEvaluation
      |
      +--> JSON returned to agent
      +--> later can be stored as STRATEGY_ARCHIVE artifact
```

## Planned File Map

- Create: `packages/shared/src/schemas/strategy.ts`
- Modify: `packages/shared/src/schemas/index.ts`
- Create: `packages/shared/src/__tests__/strategy-schema.test.ts`
- Create: `apps/api/src/market/strategy-template.service.ts`
- Create: `apps/api/src/market/__tests__/strategy-template.service.spec.ts`
- Modify: `apps/api/src/market/market.module.ts`
- Create: `apps/api/src/agent/tools/strategy-template.tool.ts`
- Modify: `apps/api/src/agent/tools/index.ts`
- Modify: `apps/api/src/agent/tools/__tests__/tools.spec.ts`
- Modify: `apps/api/src/agent/tool-registry.ts`
- Modify: `apps/api/src/analysis/contracts/role-tool-scope.ts`

## Task 1: Shared Strategy Contracts

**Files:**
- Create: `packages/shared/src/schemas/strategy.ts`
- Modify: `packages/shared/src/schemas/index.ts`
- Create: `packages/shared/src/__tests__/strategy-schema.test.ts`

- [x] **Step 1: Write the failing schema tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  strategyTemplateEvaluationSchema,
  strategyTemplateKeySchema,
} from '../schemas/strategy';

describe('strategy schemas', () => {
  it('lists the v1 Minara-derived templates', () => {
    expect(strategyTemplateKeySchema.options.sort()).toEqual(
      [
        'BTC_RSI_STOCH_EMA_MEAN_REVERSION',
        'RSI_70_MOMENTUM_CONTINUATION',
        'SMA_50_200_RSI_LONG_ONLY',
      ].sort(),
    );
  });

  it('parses a complete strategy template evaluation', () => {
    const evaluation = {
      templateKey: 'RSI_70_MOMENTUM_CONTINUATION',
      signal: 'ENTER_LONG',
      confidence: 0.72,
      recommendedNextStep: 'PAPER_ONLY',
      reasons: ['RSI is above 70 and still rising.'],
      warnings: ['Fee drag is high for this expected frequency.'],
      requiredBars: 15,
      receivedBars: 80,
      indicatorSnapshot: {
        close: 125,
        rsi14: 74.2,
        stochasticK14: null,
        stochasticD3: null,
        ema200: null,
        sma50: null,
        sma200: null,
      },
      costProfile: {
        makerFeeBps: 1.5,
        takerFeeBps: 4.5,
        estimatedRoundTripBps: 9,
        expectedAnnualTrades: 220,
        feeDragWarning: true,
      },
    };

    expect(strategyTemplateEvaluationSchema.parse(evaluation)).toMatchObject(evaluation);
  });
});
```

- [x] **Step 2: Run the schema test and verify RED**

Run: `pnpm --filter @finsentinel/shared test -- src/__tests__/strategy-schema.test.ts`

Expected: FAIL because `../schemas/strategy` does not exist.

- [x] **Step 3: Add the shared schema**

```ts
import { z } from 'zod';

export const strategyTemplateKeySchema = z.enum([
  'BTC_RSI_STOCH_EMA_MEAN_REVERSION',
  'RSI_70_MOMENTUM_CONTINUATION',
  'SMA_50_200_RSI_LONG_ONLY',
]);
export type StrategyTemplateKey = z.infer<typeof strategyTemplateKeySchema>;

export const strategySignalSchema = z.enum([
  'ENTER_LONG',
  'EXIT_LONG',
  'HOLD',
  'BLOCKED',
]);
export type StrategySignal = z.infer<typeof strategySignalSchema>;

export const strategyRecommendedNextStepSchema = z.enum([
  'REJECT',
  'PAPER_ONLY',
  'REVIEW_FOR_BACKTEST',
]);
export type StrategyRecommendedNextStep = z.infer<
  typeof strategyRecommendedNextStepSchema
>;

export const strategyIndicatorSnapshotSchema = z.object({
  close: z.number(),
  rsi14: z.number().nullable(),
  stochasticK14: z.number().nullable(),
  stochasticD3: z.number().nullable(),
  ema200: z.number().nullable(),
  sma50: z.number().nullable(),
  sma200: z.number().nullable(),
});
export type StrategyIndicatorSnapshot = z.infer<
  typeof strategyIndicatorSnapshotSchema
>;

export const strategyCostProfileSchema = z.object({
  makerFeeBps: z.number().nonnegative(),
  takerFeeBps: z.number().nonnegative(),
  estimatedRoundTripBps: z.number().nonnegative(),
  expectedAnnualTrades: z.number().int().nonnegative(),
  feeDragWarning: z.boolean(),
});
export type StrategyCostProfile = z.infer<typeof strategyCostProfileSchema>;

export const strategyTemplateEvaluationSchema = z.object({
  templateKey: strategyTemplateKeySchema,
  signal: strategySignalSchema,
  confidence: z.number().min(0).max(1),
  recommendedNextStep: strategyRecommendedNextStepSchema,
  reasons: z.array(z.string()),
  warnings: z.array(z.string()),
  requiredBars: z.number().int().positive(),
  receivedBars: z.number().int().nonnegative(),
  indicatorSnapshot: strategyIndicatorSnapshotSchema,
  costProfile: strategyCostProfileSchema,
});
export type StrategyTemplateEvaluation = z.infer<
  typeof strategyTemplateEvaluationSchema
>;
```

- [x] **Step 4: Export the schema**

Add this line to `packages/shared/src/schemas/index.ts`:

```ts
export * from './strategy';
```

- [x] **Step 5: Run schema tests and typecheck**

Run: `pnpm --filter @finsentinel/shared test -- src/__tests__/strategy-schema.test.ts`

Expected: PASS.

Run: `pnpm --filter @finsentinel/shared typecheck`

Expected: PASS.

## Task 2: Strategy Template Evaluator Service

**Files:**
- Create: `apps/api/src/market/strategy-template.service.ts`
- Create: `apps/api/src/market/__tests__/strategy-template.service.spec.ts`
- Modify: `apps/api/src/market/market.module.ts`

- [x] **Step 1: Write failing evaluator tests**

```ts
import { describe, expect, it } from 'vitest';
import { StrategyTemplateService } from '../strategy-template.service';

interface Bar {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  t: number;
}

function trendingBars(count: number): Bar[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.5;
    return {
      o: close - 0.2,
      h: close + 0.8,
      l: close - 0.8,
      c: close,
      v: 1_000_000 + index,
      t: 1_700_000_000_000 + index * 86_400_000,
    };
  });
}

function oversoldPullbackBars(): Bar[] {
  const bars = trendingBars(220);
  for (let index = bars.length - 14; index < bars.length; index++) {
    const step = index - (bars.length - 14);
    const close = 212 - step * 2.4;
    bars[index] = {
      o: close + 0.8,
      h: close + 1.2,
      l: close - 1.2,
      c: close,
      v: 1_500_000,
      t: bars[index]!.t,
    };
  }
  return bars;
}

describe('StrategyTemplateService', () => {
  const service = new StrategyTemplateService();

  it('enters long for oversold mean reversion when price remains above EMA200', () => {
    const result = service.evaluate({
      barsJson: JSON.stringify(oversoldPullbackBars()),
      templateKey: 'BTC_RSI_STOCH_EMA_MEAN_REVERSION',
    });

    expect(result.signal).toBe('ENTER_LONG');
    expect(result.recommendedNextStep).toBe('REVIEW_FOR_BACKTEST');
    expect(result.reasons.join(' ')).toMatch(/RSI/i);
  });

  it('enters long for RSI momentum continuation above 70', () => {
    const result = service.evaluate({
      barsJson: JSON.stringify(trendingBars(80)),
      templateKey: 'RSI_70_MOMENTUM_CONTINUATION',
      expectedAnnualTrades: 80,
    });

    expect(result.signal).toBe('ENTER_LONG');
    expect(result.indicatorSnapshot.rsi14).toBeGreaterThanOrEqual(70);
  });

  it('blocks long-only SMA template when SMA200 is unavailable', () => {
    const result = service.evaluate({
      barsJson: JSON.stringify(trendingBars(80)),
      templateKey: 'SMA_50_200_RSI_LONG_ONLY',
    });

    expect(result.signal).toBe('BLOCKED');
    expect(result.warnings.join(' ')).toMatch(/200 bars/i);
  });

  it('flags fee drag for high-frequency strategy settings', () => {
    const result = service.evaluate({
      barsJson: JSON.stringify(trendingBars(80)),
      templateKey: 'RSI_70_MOMENTUM_CONTINUATION',
      expectedAnnualTrades: 240,
      makerFeeBps: 1.5,
      takerFeeBps: 4.5,
    });

    expect(result.costProfile.feeDragWarning).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/fee drag/i);
  });
});
```

- [x] **Step 2: Run the evaluator test and verify RED**

Run: `pnpm --filter @finsentinel/api test -- src/market/__tests__/strategy-template.service.spec.ts`

Expected: FAIL because `StrategyTemplateService` does not exist.

- [x] **Step 3: Implement the stateless evaluator**

```ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { EMA, RSI, SMA, Stochastic } from 'technicalindicators';
import type {
  StrategyCostProfile,
  StrategyIndicatorSnapshot,
  StrategyRecommendedNextStep,
  StrategySignal,
  StrategyTemplateEvaluation,
  StrategyTemplateKey,
} from '@finsentinel/shared';

interface Bar {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  t: number;
}

interface EvaluateStrategyArgs {
  barsJson: string;
  templateKey: StrategyTemplateKey;
  makerFeeBps?: number;
  takerFeeBps?: number;
  expectedAnnualTrades?: number;
}

@Injectable()
export class StrategyTemplateService {
  evaluate(args: EvaluateStrategyArgs): StrategyTemplateEvaluation {
    const bars = this.parseBars(args.barsJson);
    const snapshot = this.buildSnapshot(bars);
    const costProfile = this.buildCostProfile(args);
    const warnings: string[] = [];

    if (costProfile.feeDragWarning) {
      warnings.push('Fee drag is high for this expected trade frequency.');
    }

    const outcome = this.evaluateTemplate(args.templateKey, snapshot, bars.length, warnings);

    return {
      templateKey: args.templateKey,
      signal: outcome.signal,
      confidence: outcome.confidence,
      recommendedNextStep: this.nextStep(outcome.signal, warnings),
      reasons: outcome.reasons,
      warnings,
      requiredBars: this.requiredBars(args.templateKey),
      receivedBars: bars.length,
      indicatorSnapshot: snapshot,
      costProfile,
    };
  }

  private parseBars(barsJson: string): Bar[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(barsJson);
    } catch (err) {
      throw new BadRequestException(
        `Invalid barsJson: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
    if (!Array.isArray(parsed)) {
      throw new BadRequestException('barsJson must be an array of OHLCV bars');
    }
    return parsed.map((bar, index) => this.parseBar(bar, index));
  }

  private parseBar(value: unknown, index: number): Bar {
    if (typeof value !== 'object' || value === null) {
      throw new BadRequestException(`Bar ${index} must be an object`);
    }
    const bar = value as Record<string, unknown>;
    for (const key of ['o', 'h', 'l', 'c', 'v', 't']) {
      if (typeof bar[key] !== 'number' || !Number.isFinite(bar[key])) {
        throw new BadRequestException(`Bar ${index}.${key} must be a finite number`);
      }
    }
    return bar as unknown as Bar;
  }

  private buildSnapshot(bars: Bar[]): StrategyIndicatorSnapshot {
    if (bars.length === 0) {
      throw new BadRequestException('At least one bar is required');
    }
    const closes = bars.map((bar) => bar.c);
    const highs = bars.map((bar) => bar.h);
    const lows = bars.map((bar) => bar.l);
    const stoch = bars.length >= 17
      ? Stochastic.calculate({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 }).at(-1)
      : undefined;

    return {
      close: closes.at(-1)!,
      rsi14: this.lastOrNull(bars.length >= 15 ? RSI.calculate({ values: closes, period: 14 }) : []),
      stochasticK14: stoch?.k ?? null,
      stochasticD3: stoch?.d ?? null,
      ema200: this.lastOrNull(bars.length >= 200 ? EMA.calculate({ values: closes, period: 200 }) : []),
      sma50: this.lastOrNull(bars.length >= 50 ? SMA.calculate({ values: closes, period: 50 }) : []),
      sma200: this.lastOrNull(bars.length >= 200 ? SMA.calculate({ values: closes, period: 200 }) : []),
    };
  }

  private evaluateTemplate(
    templateKey: StrategyTemplateKey,
    snapshot: StrategyIndicatorSnapshot,
    receivedBars: number,
    warnings: string[],
  ): { signal: StrategySignal; confidence: number; reasons: string[] } {
    switch (templateKey) {
      case 'BTC_RSI_STOCH_EMA_MEAN_REVERSION':
        return this.evaluateMeanReversion(snapshot, receivedBars, warnings);
      case 'RSI_70_MOMENTUM_CONTINUATION':
        return this.evaluateMomentum(snapshot, receivedBars, warnings);
      case 'SMA_50_200_RSI_LONG_ONLY':
        return this.evaluateLongOnlyTrend(snapshot, receivedBars, warnings);
    }
  }

  private evaluateMeanReversion(
    snapshot: StrategyIndicatorSnapshot,
    receivedBars: number,
    warnings: string[],
  ): { signal: StrategySignal; confidence: number; reasons: string[] } {
    if (receivedBars < 200 || snapshot.rsi14 === null || snapshot.stochasticK14 === null || snapshot.ema200 === null) {
      warnings.push('Mean reversion template requires at least 200 bars for EMA200 and oscillator confirmation.');
      return { signal: 'BLOCKED', confidence: 0, reasons: ['Insufficient data for mean reversion template.'] };
    }
    if (snapshot.rsi14 <= 20 && snapshot.stochasticK14 <= 25 && snapshot.close > snapshot.ema200) {
      return { signal: 'ENTER_LONG', confidence: 0.78, reasons: ['RSI is deeply oversold, Stochastic confirms washout, and price remains above EMA200.'] };
    }
    if (snapshot.rsi14 >= 65 || snapshot.close < snapshot.ema200) {
      return { signal: 'EXIT_LONG', confidence: 0.68, reasons: ['Mean reversion exit condition is active.'] };
    }
    return { signal: 'HOLD', confidence: 0.5, reasons: ['Mean reversion setup is incomplete.'] };
  }

  private evaluateMomentum(
    snapshot: StrategyIndicatorSnapshot,
    receivedBars: number,
    warnings: string[],
  ): { signal: StrategySignal; confidence: number; reasons: string[] } {
    if (receivedBars < 15 || snapshot.rsi14 === null) {
      warnings.push('Momentum template requires at least 15 bars for RSI14.');
      return { signal: 'BLOCKED', confidence: 0, reasons: ['Insufficient data for RSI momentum template.'] };
    }
    if (snapshot.rsi14 >= 70) {
      return { signal: 'ENTER_LONG', confidence: 0.7, reasons: ['RSI is above 70, matching the momentum continuation template.'] };
    }
    return { signal: 'EXIT_LONG', confidence: 0.62, reasons: ['RSI is below 70, matching the template exit condition.'] };
  }

  private evaluateLongOnlyTrend(
    snapshot: StrategyIndicatorSnapshot,
    receivedBars: number,
    warnings: string[],
  ): { signal: StrategySignal; confidence: number; reasons: string[] } {
    if (receivedBars < 200 || snapshot.rsi14 === null || snapshot.sma50 === null || snapshot.sma200 === null) {
      warnings.push('Long-only SMA/RSI template requires at least 200 bars.');
      return { signal: 'BLOCKED', confidence: 0, reasons: ['Insufficient data for long-only trend template.'] };
    }
    if (snapshot.close > snapshot.sma50 && snapshot.sma50 > snapshot.sma200 && snapshot.rsi14 >= 50) {
      return { signal: 'ENTER_LONG', confidence: 0.74, reasons: ['Price is above SMA50, SMA50 is above SMA200, and RSI confirms positive momentum.'] };
    }
    if (snapshot.close < snapshot.sma200 || snapshot.rsi14 < 45) {
      return { signal: 'EXIT_LONG', confidence: 0.67, reasons: ['Long-only trend filter failed.'] };
    }
    return { signal: 'HOLD', confidence: 0.52, reasons: ['Long-only trend setup is neutral.'] };
  }

  private buildCostProfile(args: EvaluateStrategyArgs): StrategyCostProfile {
    const makerFeeBps = args.makerFeeBps ?? 1.5;
    const takerFeeBps = args.takerFeeBps ?? 4.5;
    const expectedAnnualTrades = args.expectedAnnualTrades ?? this.defaultAnnualTrades(args.templateKey);
    const estimatedRoundTripBps = makerFeeBps + takerFeeBps;
    return {
      makerFeeBps,
      takerFeeBps,
      estimatedRoundTripBps,
      expectedAnnualTrades,
      feeDragWarning: expectedAnnualTrades > 200 || estimatedRoundTripBps >= 10,
    };
  }

  private requiredBars(templateKey: StrategyTemplateKey): number {
    return templateKey === 'RSI_70_MOMENTUM_CONTINUATION' ? 15 : 200;
  }

  private defaultAnnualTrades(templateKey: StrategyTemplateKey): number {
    if (templateKey === 'SMA_50_200_RSI_LONG_ONLY') return 12;
    if (templateKey === 'BTC_RSI_STOCH_EMA_MEAN_REVERSION') return 48;
    return 80;
  }

  private nextStep(
    signal: StrategySignal,
    warnings: string[],
  ): StrategyRecommendedNextStep {
    if (signal === 'BLOCKED') return 'REJECT';
    if (warnings.some((warning) => warning.toLowerCase().includes('fee drag'))) {
      return 'PAPER_ONLY';
    }
    return 'REVIEW_FOR_BACKTEST';
  }

  private lastOrNull(values: number[]): number | null {
    return values.length > 0 ? values.at(-1)! : null;
  }
}
```

- [x] **Step 4: Register the service in `MarketModule`**

Add the import:

```ts
import { StrategyTemplateService } from './strategy-template.service';
```

Add `StrategyTemplateService` to both `providers` and `exports`.

- [x] **Step 5: Run evaluator tests and API typecheck**

Run: `pnpm --filter @finsentinel/api test -- src/market/__tests__/strategy-template.service.spec.ts`

Expected: PASS.

Run: `pnpm --filter @finsentinel/api typecheck`

Expected: PASS.

## Task 3: Agent Tool Exposure

**Files:**
- Create: `apps/api/src/agent/tools/strategy-template.tool.ts`
- Modify: `apps/api/src/agent/tools/index.ts`
- Modify: `apps/api/src/agent/tools/__tests__/tools.spec.ts`
- Modify: `apps/api/src/agent/tool-registry.ts`
- Modify: `apps/api/src/analysis/contracts/role-tool-scope.ts`

- [x] **Step 1: Write failing tool tests**

Add this import:

```ts
import { createStrategyTemplateTools } from '../strategy-template.tool';
```

Add this test block:

```ts
describe('createStrategyTemplateTools', () => {
  const mockService = {
    evaluate: vi.fn(),
  } as any;

  it('returns the strategy evaluation tool', () => {
    expect(Object.keys(createStrategyTemplateTools(mockService))).toEqual([
      'evaluateStrategyTemplate',
    ]);
  });

  it('tools have correct AI SDK structure', () => {
    assertToolStructure(createStrategyTemplateTools(mockService));
  });

  it('delegates to StrategyTemplateService', async () => {
    mockService.evaluate.mockReturnValue({
      templateKey: 'RSI_70_MOMENTUM_CONTINUATION',
      signal: 'ENTER_LONG',
      confidence: 0.7,
      recommendedNextStep: 'REVIEW_FOR_BACKTEST',
      reasons: ['RSI above 70'],
      warnings: [],
      requiredBars: 15,
      receivedBars: 80,
      indicatorSnapshot: {
        close: 125,
        rsi14: 72,
        stochasticK14: null,
        stochasticD3: null,
        ema200: null,
        sma50: null,
        sma200: null,
      },
      costProfile: {
        makerFeeBps: 1.5,
        takerFeeBps: 4.5,
        estimatedRoundTripBps: 6,
        expectedAnnualTrades: 80,
        feeDragWarning: false,
      },
    });

    const tools = createStrategyTemplateTools(mockService);
    const result = await (tools.evaluateStrategyTemplate as any).execute({
      barsJson: '[]',
      templateKey: 'RSI_70_MOMENTUM_CONTINUATION',
    });

    expect(mockService.evaluate).toHaveBeenCalledWith({
      barsJson: '[]',
      templateKey: 'RSI_70_MOMENTUM_CONTINUATION',
      expectedAnnualTrades: undefined,
      makerFeeBps: undefined,
      takerFeeBps: undefined,
    });
    expect(result).toContain('ENTER_LONG');
  });
});
```

Update the total tool count expectation comment to include one additional tool.

- [x] **Step 2: Run tool tests and verify RED**

Run: `pnpm --filter @finsentinel/api test -- src/agent/tools/__tests__/tools.spec.ts`

Expected: FAIL because `strategy-template.tool.ts` does not exist.

- [x] **Step 3: Implement the tool factory**

```ts
import { defineZodTool as tool } from '@finsentinel/ai-runtime';
import { strategyTemplateKeySchema } from '@finsentinel/shared';
import { z } from 'zod';
import type { StrategyTemplateService } from '../../market/strategy-template.service';

export function createStrategyTemplateTools(
  strategyTemplateService: StrategyTemplateService,
) {
  return {
    evaluateStrategyTemplate: tool({
      description:
        'Evaluate a Minara-inspired high-quality strategy template from OHLCV bars. ' +
        'Returns a structured signal, confidence, indicator snapshot, fee-drag warnings, ' +
        'and whether the strategy should be rejected, paper-tested, or reviewed for backtesting. ' +
        'This tool is analysis-only and never stages or executes orders.',
      inputSchema: z.object({
        barsJson: z
          .string()
          .describe('JSON array of price bars [{o,h,l,c,v,t}, ...]'),
        templateKey: strategyTemplateKeySchema.describe(
          'Strategy template to evaluate',
        ),
        makerFeeBps: z.number().nonnegative().optional(),
        takerFeeBps: z.number().nonnegative().optional(),
        expectedAnnualTrades: z.number().int().nonnegative().optional(),
      }),
      execute: async ({
        barsJson,
        templateKey,
        makerFeeBps,
        takerFeeBps,
        expectedAnnualTrades,
      }) => {
        try {
          return JSON.stringify(
            strategyTemplateService.evaluate({
              barsJson,
              templateKey,
              expectedAnnualTrades,
              makerFeeBps,
              takerFeeBps,
            }),
            null,
            2,
          );
        } catch (e) {
          return `Error evaluating strategy template: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),
  };
}
```

- [x] **Step 4: Export and register the tool**

Add this to `apps/api/src/agent/tools/index.ts`:

```ts
export { createStrategyTemplateTools } from './strategy-template.tool';
```

Update `ToolRegistry`:

```ts
import { StrategyTemplateService } from '../market/strategy-template.service';
```

Add constructor dependency:

```ts
@Optional()
private readonly strategyTemplateService?: StrategyTemplateService,
```

Add to `buildTools` and `buildStockAnalysisTools`:

```ts
...(this.strategyTemplateService
  ? createStrategyTemplateTools(this.strategyTemplateService)
  : {}),
```

Add `evaluateStrategyTemplate` to `MARKET_ANALYST` in `role-tool-scope.ts`.

- [x] **Step 5: Run tool tests and API typecheck**

Run: `pnpm --filter @finsentinel/api test -- src/agent/tools/__tests__/tools.spec.ts`

Expected: PASS.

Run: `pnpm --filter @finsentinel/api typecheck`

Expected: PASS.

## Task 4: Focused Verification

**Files:**
- All files above

- [x] **Step 1: Run the focused package tests**

Run:

```bash
pnpm --filter @finsentinel/shared test -- src/__tests__/strategy-schema.test.ts
pnpm --filter @finsentinel/api test -- src/market/__tests__/strategy-template.service.spec.ts src/agent/tools/__tests__/tools.spec.ts
```

Expected: PASS.

- [x] **Step 2: Run typechecks**

Run:

```bash
pnpm --filter @finsentinel/shared typecheck
pnpm --filter @finsentinel/api typecheck
```

Expected: PASS.

- [x] **Step 3: Update progress log in this plan**

Record:

- tests run
- result
- any deviations from the planned file map
- final outcome

## Test Coverage Diagram

```text
CODE PATH COVERAGE
==================
[+] packages/shared/src/schemas/strategy.ts
    |
    +-- strategyTemplateKeySchema
    |   +-- [DONE] accepts all v1 keys
    |   +-- [DONE] rejects unknown keys
    |
    +-- strategyTemplateEvaluationSchema
        +-- [DONE] parses complete evaluation
        +-- [DONE] rejects invalid signal/confidence

[+] apps/api/src/market/strategy-template.service.ts
    |
    +-- evaluate()
    |   +-- [DONE] malformed JSON -> BadRequestException
    |   +-- [DONE] empty bars -> BadRequestException
    |   +-- [DONE] mean reversion ENTER_LONG
    |   +-- [DONE] momentum ENTER_LONG / EXIT_LONG
    |   +-- [DONE] long-only BLOCKED with <200 bars
    |   +-- [DONE] fee drag warning
    |
    +-- parseBar()
        +-- [DONE] non-object bar
        +-- [DONE] non-finite numeric fields

[+] apps/api/src/agent/tools/strategy-template.tool.ts
    |
    +-- evaluateStrategyTemplate.execute()
        +-- [DONE] delegates to service
        +-- [DONE] returns JSON string
        +-- [DONE] returns error string instead of throwing

USER FLOW COVERAGE
==================
[+] Agent market analysis run
    |
    +-- [DONE] MARKET_ANALYST can call evaluateStrategyTemplate
    +-- [NOT IN SCOPE] UI-driven manual strategy evaluation
    +-- [NOT IN SCOPE] storing strategy archive artifacts

─────────────────────────────────
COVERAGE RESULT: 15/15 planned paths tested after Task 4
E2E: not required for v1; no HTTP/UI surface is introduced
EVAL: not required; no prompt template changes are introduced
─────────────────────────────────
```

## Failure Modes

| Flow | Failure Mode | Planned Handling | Planned Test |
|------|--------------|------------------|--------------|
| `evaluate()` | malformed `barsJson` | `BadRequestException` with clear message | service malformed JSON test |
| `evaluate()` | insufficient bars | structured `BLOCKED` result when possible | service `<200 bars` test |
| `evaluate()` | fee drag too high | warning + `PAPER_ONLY` next step | fee drag test |
| tool execute | service throws | returns error string | tool error contract test |
| agent scope | tool not exposed to market analyst | add to `ROLE_TOOL_SCOPE` | tool registry/role scope check |

## Plan-Eng Review

### Architecture Review

Issue count: 1.

1. **Scope risk: strategy system could expand into backtesting, import, DB, and UI all at once.**
   Recommendation: keep this slice stateless and analysis-only. This follows minimal diff and reduces blast radius while still creating a useful typed foundation.

Resolved direction: use `MarketModule` + stateless `StrategyTemplateService`; defer DB/UI/Pine/backtest.

### Code Quality Review

Issue count: 1.

1. **Potential DRY concern: service computes numeric indicators separately from the string-format `TechnicalIndicatorsService`.**
   Recommendation: accept this in v1 because the existing service is presentation-oriented and parsing its strings would be worse. Extract shared numeric indicator primitives only when adding Keltner/SuperTrend or when two services need identical numeric paths.

Resolved direction: no string parsing; isolate numeric computations in one new service for now.

### Test Review

Gaps identified: 15 planned gaps, all mapped to tests in Tasks 1-3.

Critical gaps: 0 if Task 4 verification passes.

### Performance Review

Issue count: 0.

The evaluator is O(n) over provided bars and only computes a small number of indicators. No DB, network, queue, or cache path is introduced.

## Progress Log

- 2026-04-18 00:00 ET: Plan created from Minara strategy PRDs, current market/agent code, and `plan-eng-review` scope challenge.
- 2026-04-18 21:29 ET: Wrote shared schema tests, verified RED with direct Vitest because local `pnpm` was unavailable, then added `strategy.ts` shared contracts.
- 2026-04-18 21:32 ET: Wrote API evaluator tests, verified RED on missing `StrategyTemplateService`, then implemented the stateless evaluator with three templates, fee-drag warnings, and malformed input handling.
- 2026-04-18 21:35 ET: Added `evaluateStrategyTemplate` agent tool, `ToolRegistry` registration, `MARKET_ANALYST` allow-list access, and persona tool-list documentation.
- 2026-04-18 21:36 ET: Built `@finsentinel/shared` locally before API typecheck because API resolves shared package types from `dist`.
- 2026-04-18 21:37 ET: Verified focused tests and API typecheck after adding role-scope coverage.
- 2026-04-18 21:39 ET: Added remaining boundary assertions for unknown template keys, RSI exit behavior, invalid JSON, empty arrays, non-object bars, and non-finite bar fields.

## Key Decisions

- Implement strategy templates as typed analysis signals, not executable orders.
- Expose the feature through an agent tool first, not a UI page.
- Support only three templates whose indicators are already available.
- Do not add persistence until strategy archive PRD implementation.

## Risks And Blockers

- The service is not a full backtest engine; users must not treat `ENTER_LONG` as execution approval.
- Numeric indicator computation is isolated in the new service; future indicator expansion should consider extracting shared primitives.
- Tests must use deterministic synthetic bars because no fixture provider exists for strategy-specific market regimes.

## Final Outcome

Implemented backend v1 high-quality strategy evaluation:

- Shared strategy schemas now define the three v1 template keys, signal shape, indicator snapshot, fee profile, warnings, and next-step contract.
- `StrategyTemplateService` evaluates RSI/Stochastic/EMA mean reversion, RSI 70 momentum continuation, and SMA50/200 long-only trend templates from OHLCV bars.
- `evaluateStrategyTemplate` is available through agent tools and the `MARKET_ANALYST` role scope as analysis-only output.
- Prompt documentation now lists the new strategy-evaluation tool.

Verification completed:

- `packages/shared`: `strategy-schema.test.ts` passed, 4 tests.
- `apps/api`: strategy service, tool factory, tool registry, and role executor tests passed, 85 tests.
- Typecheck: shared package passed; API passed after rebuilding shared package types.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | scoped | 2 issues resolved in-plan, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | Backend-only slice |

**VERDICT:** ENG REVIEW SCOPED CLEAR — ready to implement backend v1.
