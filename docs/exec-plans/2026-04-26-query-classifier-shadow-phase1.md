# Query Planner Classifier — Shadow Eval Phase 1

Date: 2026-04-26
Status: Draft — ready for execution
Owner: hongxichen + Claude
Source: `docs/exec-plans/2026-04-24-codebase-optimization-triage-prd.md` item 9; `docs/exec-plans/tech-debt-tracker.md` "Query-planner classifier is blocked on labelled RAG eval data"

## Background

Item 9 (query-planner classifier) was blocked on labelled eval data. The user
just shipped golden v2.2 (200 entries, 7 query classes: analytical=23,
exact_lookup=19, factoid=39, multi_part=28, numeric=7, relational=63,
summary=21) — `services/evaluation-runner/datasets/golden.json` line 1.

The current planner uses a rule-only classifier in
`apps/api/src/rag/retrieval-planner.service.ts:245` that emits 6 classes:
`exact_lookup | factoid | relational | analytical | multi_part | colloquial`.
Two structural mismatches with the golden vocabulary surface immediately:

- Rule emits `colloquial`; golden has 0 entries with that label (assumed —
  validated in this plan).
- Golden has `numeric` (7) and `summary` (21); rule has no emission path for
  either. So the rule classifier's ceiling on the new golden is already
  capped at `(200 - 7 - 21) / 200 = 86%` agreement before any other error.

## Goal

Phase 1 — pure offline shadow eval, no runtime change:

1. Extract the rule classifier into a pure module both Nest service and
   offline scripts can import.
2. Implement an LLM-based classifier as a sibling pure module.
3. Build a Node shadow-eval script that reads `golden.json`, runs both
   classifiers against each query, and emits a comparison report (per-class
   precision/recall, confusion matrices, dataset-vs-rule vocabulary delta,
   LLM cost / latency totals).

Phase 2 (separate plan, not in this PR): wire the classifier as a runtime
shadow path under `RAG_QUERY_CLASSIFIER_SHADOW_ENABLED`, log decisions into
`rag_query_logs` (folded into existing `lane_counts.__cls`), then run the
shadow eval against live API traffic.

## Scope

In:

- `apps/api/src/rag/query-classifier-rules.ts` — pure exported function
  `classifyByRules(query): { class: QueryClass, confidence: number }`,
  identical regex semantics to today's `classifyQuery`.
- `apps/api/src/rag/retrieval-planner.service.ts` — refactor
  `classifyQuery` to call `classifyByRules`. Behavior-preserving.
- `apps/api/src/rag/query-classifier-llm.ts` — new
  `LlmQueryClassifierService` with `classify(query): Promise<{ class, confidence, reasoning? }>`.
  Uses the existing OpenRouter chat completion path.
- Tests for both classifiers.
- `services/evaluation-runner/run_classifier_shadow.mjs` — Node script that
  reads `golden.json`, dispatches rules + LLM in parallel per query, writes a
  report to `services/evaluation-runner/reports/classifier-shadow-<date>.json`.
- Update `tech-debt-tracker.md` — close the "blocked on labels" portion of
  the item-9 entry, link the report path.

Out:

- Runtime planner change (phase 2).
- DB migrations or new columns (phase 2).
- LLM cost optimization or caching (phase 2 if cost is a problem).
- Cross-validation against `chat_messages` queries.
- Live API shadow A/B (phase 2).

## Key decisions

1. **Pure-module extraction.** The rule classifier today is a private method
   on `RetrievalPlannerService`; private methods can't be reused offline.
   Move it to a stateless module. Service keeps a thin wrapper for backward
   compat.
2. **Offline eval, not live.** Phase 1 deliberately does NOT hit the API.
   The eval reads golden.queries directly, classifies, compares to
   golden.query_class. Faster iteration; no API/DB dependency.
3. **LLM classifier prompt is rules-as-few-shot.** The LLM gets the same 6
   class definitions as the rule layer plus 5 worked examples. We measure
   whether the LLM helps OR hurts on the same vocabulary; vocabulary
   expansion (numeric / summary) is a separate decision.
4. **Vocabulary mismatch is reported, not patched.** The eval report lists
   golden classes the rules can't produce. We do NOT extend the rule
   vocabulary in this plan — that's a deliberate planner change requiring
   product input.
5. **No default-on routing.** Phase 1 ends at "we have data". Default
   routing remains rules-only. Tracker entry closure is contingent on the
   shadow report showing the LLM has a real, measurable improvement on at
   least one bucket.

## File structure

```
apps/api/src/rag/
  query-classifier-rules.ts                     (new — pure module)
  query-classifier-llm.ts                       (new — LLM classifier)
  retrieval-planner.service.ts                  (modify — call rules module)
  __tests__/
    query-classifier-rules.spec.ts              (new)
    query-classifier-llm.spec.ts                (new)

services/evaluation-runner/
  run_classifier_shadow.mjs                     (new — offline eval)
  reports/classifier-shadow-2026-04-26.json     (output, gitignored)

docs/exec-plans/
  tech-debt-tracker.md                          (modify — link report)
```

---

## Task 1 — Extract rule classifier

### 1.1 New module

`apps/api/src/rag/query-classifier-rules.ts`:

```ts
import { isKnownTicker } from './ticker-whitelist';

export type QueryClass =
  | 'exact_lookup'
  | 'factoid'
  | 'relational'
  | 'analytical'
  | 'multi_part'
  | 'colloquial';

export interface RuleClassification {
  class: QueryClass;
  /** 1.0 for hard regex hits, 0.5 for length-heuristic, 0.4 default fallback. */
  confidence: number;
  /** Which rule fired, for traceability. */
  rule: string;
}

const RELATION_CUES = /\b(competitor|supplier|partner|acquired|subsidiary|related|connected|supply chain|board member|invested in|CEO of)\b/i;
const GRAPH_QUERY_PATTERNS = /\b(who|which companies|what companies|competitors of|suppliers of|partners of|how .* connected|how .* related)\b/i;
const ANALYTICAL_KEYWORDS = /\b(compare|analyze|analyse|explain|summarize|summarise|impact|risk|driver|outlook)\b/i;
const ANALYTICAL_LENGTH_THRESHOLD = 120;
const COLLOQUIAL_OPENERS = /^(hey|hi|hello|so,?|btw|just|um|uh|like)\b/i;
const SECTION_IDENTIFIER = /\b(item|section|note|part)\s*\d+/i;
const NUMERIC_IDENTIFIER = /\b(ISIN|CUSIP|EPS|P\/?E)\b/i;
const QUOTED_PHRASE = /"[^"]{3,}"/;
const TIME_ANCHOR = /\b(Q[1-4]|FY|H[12]|fiscal|annual|quarterly|2[0-9]{3})\b/i;
const TICKER_CANDIDATE = /\b[A-Z]{2,5}\b/g;
const DOC_TYPE_KEYWORDS = /\b(10-K|10-Q|8-K|filing|earnings|revenue|guidance|disclosure)\b/i;

export function classifyByRules(query: string): RuleClassification {
  if (isExactLookup(query)) return { class: 'exact_lookup', confidence: 1.0, rule: 'exact_lookup' };
  if (isMultiPart(query)) return { class: 'multi_part', confidence: 1.0, rule: 'multi_part' };
  if (query.length > ANALYTICAL_LENGTH_THRESHOLD) {
    return { class: 'analytical', confidence: 0.5, rule: 'analytical_length' };
  }
  if (ANALYTICAL_KEYWORDS.test(query)) return { class: 'analytical', confidence: 1.0, rule: 'analytical_keyword' };
  if (RELATION_CUES.test(query) || GRAPH_QUERY_PATTERNS.test(query)) {
    return { class: 'relational', confidence: 1.0, rule: 'relational' };
  }
  if (COLLOQUIAL_OPENERS.test(query)) return { class: 'colloquial', confidence: 1.0, rule: 'colloquial' };
  return { class: 'factoid', confidence: 0.4, rule: 'fallback' };
}

function isExactLookup(query: string): boolean { /* …same as planner… */ }
function isMultiPart(query: string): boolean { /* …same as planner… */ }
```

### 1.2 Refactor planner

`retrieval-planner.service.ts`:

```ts
import { classifyByRules } from './query-classifier-rules';

private classifyQuery(query: string): QueryClass {
  return classifyByRules(query).class;
}
```

Drop the now-redundant private regexes / helpers from the planner file.
Keep the existing public API of `RetrievalPlannerService` unchanged.

### 1.3 Tests

`apps/api/src/rag/__tests__/query-classifier-rules.spec.ts`: copy the
existing planner classifier coverage (table-driven) into the pure module.
Add one regression: any query that classifies to `exact_lookup` must have
`confidence === 1.0`.

### 1.4 Verify

- `pnpm --filter @finsentinel/api typecheck` PASS
- `pnpm --filter @finsentinel/api test src/rag/__tests__` PASS

### 1.5 Commit

```bash
git commit -m "refactor(rag): extract rule classifier into pure query-classifier-rules module"
```

---

## Task 2 — LLM classifier

### 2.1 Service

`apps/api/src/rag/query-classifier-llm.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service'; // or actual chat client
import type { QueryClass } from './query-classifier-rules';

const SYSTEM_PROMPT = `Classify each financial-research query into one of:
- exact_lookup: literal section / ticker+time / quoted phrase / numeric id
- factoid: short factual question with a single answer
- relational: about relationships between companies / entities
- analytical: requires analysis, compare, explain, summarize
- multi_part: contains multiple distinct sub-questions joined with and / ?
- colloquial: chitchat / non-research

Respond with JSON: { "class": "<class>", "confidence": 0..1, "reasoning": "<one short sentence>" }`;

const FEW_SHOT: Array<{ q: string; class: QueryClass }> = [
  { q: 'AAPL 10-K FY2024 revenue', class: 'exact_lookup' },
  { q: 'who are competitors of Tesla?', class: 'relational' },
  { q: 'What is the revenue impact of supply chain risk on AAPL?', class: 'analytical' },
  { q: 'What is Tesla revenue and what is the operating margin?', class: 'multi_part' },
  { q: 'hi can you tell me about Apple', class: 'colloquial' },
];

export interface LlmClassification {
  class: QueryClass;
  confidence: number;
  reasoning?: string;
}

@Injectable()
export class LlmQueryClassifierService {
  private readonly logger = new Logger(LlmQueryClassifierService.name);
  constructor(private readonly llm: LlmService) {}

  async classify(query: string): Promise<LlmClassification> {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...FEW_SHOT.flatMap((s) => [
        { role: 'user' as const, content: s.q },
        { role: 'assistant' as const, content: JSON.stringify({ class: s.class, confidence: 1, reasoning: 'few-shot exemplar' }) },
      ]),
      { role: 'user' as const, content: query },
    ];
    const raw = await this.llm.chatCompletion({ messages, temperature: 0, maxTokens: 200 });
    return parseLlmResponse(raw, query);
  }
}

function parseLlmResponse(raw: string, query: string): LlmClassification {
  try {
    const obj = JSON.parse(raw);
    if (typeof obj.class === 'string') return { class: obj.class, confidence: Number(obj.confidence ?? 0.5), reasoning: obj.reasoning };
  } catch {}
  return { class: 'factoid', confidence: 0, reasoning: `parse_failed for "${query}"` };
}
```

> Subagent must verify the actual LLM service entry point in
> `apps/api/src/agent/` or `apps/api/src/llm/` — the existing OpenRouter
> client name and method signature is the contract; do NOT invent a new
> client.

### 2.2 Tests

`apps/api/src/rag/__tests__/query-classifier-llm.spec.ts`:
- Mock the LLM service. Assert system prompt + few-shot ordering.
- Assert valid JSON response → `{ class, confidence, reasoning }` returned.
- Assert malformed JSON → fallback to `factoid` with `confidence: 0`.
- Assert temperature 0 + maxTokens 200 are passed.

### 2.3 Commit

```bash
git commit -m "feat(rag): add LlmQueryClassifierService with rules-as-few-shot prompt"
```

---

## Task 3 — Offline shadow eval

### 3.1 Script

`services/evaluation-runner/run_classifier_shadow.mjs`:

Inputs:
- `--dataset services/evaluation-runner/datasets/golden.json` (default)
- `--out services/evaluation-runner/reports/classifier-shadow-<ISO date>.json`
- `--llm` (optional flag — when off, runs rules-only and skips LLM)
- `--llm-model openai/gpt-4o-mini` (default)
- `--limit N` (optional cap for cost control)

Behavior:
- For each golden entry: compute rules class via `classifyByRules`; if
  `--llm`, call OpenRouter completions with the same prompt as the Nest
  service (the script imports the prompt via tsx, OR re-encodes it inline
  if shipping as `.mjs`).
- Emit a report:
  ```json
  {
    "dataset": "golden.json",
    "dataset_version": "<from golden.meta.json>",
    "n": 200,
    "rules": {
      "accuracy_overall": 0.x,
      "per_class_precision": { "exact_lookup": 0.x, ... },
      "per_class_recall": { "exact_lookup": 0.x, ... },
      "confusion": { "exact_lookup_to_factoid": 3, ... },
      "vocabulary_gap": { "missing_in_rules": ["numeric", "summary"] }
    },
    "llm": { /* same shape if --llm */ },
    "agreement": { "rules_vs_llm": 0.x },
    "cost_usd_estimate": 0.0,
    "wall_clock_ms": 12345,
    "ran_at": "2026-04-26T..."
  }
  ```
- Print human-readable summary to stdout.

### 3.2 Verify

- `node services/evaluation-runner/run_classifier_shadow.mjs --dataset services/evaluation-runner/datasets/golden.json` (rules-only) — completes < 5s, writes report.
- `node services/evaluation-runner/run_classifier_shadow.mjs --llm --limit 10` — completes against real API, costs < $0.05 for 10 queries.
- Report shape passes `validate_golden_dataset.mjs` style schema check (or a small new schema check inside the script).

### 3.3 Commit

```bash
git commit -m "feat(eval): add offline classifier-shadow runner against golden v2.2"
```

---

## Task 4 — Tech-debt tracker close-out

Update the item-9 entry to:
- Note phase 1 (offline shadow) closed; cite report path.
- Note that runtime shadow path (phase 2) is still open and lists the report-driven gates: must show ≥ 5pp absolute precision improvement on at least one bucket OR ≥ 2pp overall accuracy with no per-bucket regression > 1pp before runtime default.

```bash
git commit -m "docs(tech-debt): close item-9 phase 1 shadow eval; gate phase 2 on report-driven metrics"
```

---

## Verification

- `pnpm --filter @finsentinel/api typecheck` PASS
- `pnpm --filter @finsentinel/api test --run` PASS
- `node services/evaluation-runner/run_classifier_shadow.mjs --dataset services/evaluation-runner/datasets/golden.json` — produces a valid report with non-zero accuracy numbers
- Tracker entry references the produced report path

## Risks

- **LLM cost.** 200 queries × 1 call each at gpt-4o-mini ≈ $0.05–0.10. Negligible. The `--limit` flag exists for paranoid runs.
- **LLM determinism.** Temperature 0 helps but doesn't guarantee identical output across runs. Phase 1 records absolute numbers per run; week-to-week jitter is expected and acceptable.
- **Vocabulary lock-in.** This plan does NOT extend the rule classifier's vocabulary to include `numeric` or `summary`. The eval will surface the cap, and a follow-up product decision can decide whether to add classes.
- **Few-shot exemplars bias the LLM.** Real users submit queries that don't look like the 5 exemplars; LLM may over-fit to exemplar shapes. The eval surfaces this — if LLM agreement with rules is suspiciously high (> 95%), it likely just memorized the rules.

## Progress log

- 2026-04-26: Plan drafted. Golden v2.2 distribution: analytical=23,
  exact_lookup=19, factoid=39, multi_part=28, numeric=7, relational=63,
  summary=21 (200 total). Rule classifier vocabulary structurally caps
  agreement at 86% before any other error.

## Final outcome

(Filled after merge.)
