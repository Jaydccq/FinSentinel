# Query Classifier Rules — Phase 1.5 (vocabulary + targeted regex tightening)

Date: 2026-04-26
Status: Draft — ready for execution
Owner: hongxichen + Claude
Source: phase-1 shadow report `services/evaluation-runner/reports/classifier-shadow-2026-04-26.json`; plan `docs/exec-plans/2026-04-26-query-classifier-shadow-phase1.md`.

## Background

Phase 1 produced data, not a win:

- Rules-only accuracy on golden v2.2 (200 entries, 7 classes): **0.385**
- LLM (`gpt-4o-mini`, rules-as-few-shot, 200 entries): **0.385** — TIE on overall, precision wins on `factoid` (+50pp) and `relational` (+14pp) but heavy `relational→analytical` regression (44 cases)
- Phase-2 runtime shadow gate (≥5pp bucket precision OR ≥2pp overall, no bucket regression > 1pp): **NOT MET**

Two surfaces explain ~half the rule errors:

1. **Vocabulary gap.** Rules emit 6 classes; golden has 7 (the missing
   `numeric` and `summary` cover 28 entries — 14% of the dataset). Rules
   structurally cannot label these. Hard ceiling at `(200-28)/200 = 86%`.
2. **`factoid → exact_lookup` over-firing.** Top 3 confusion pair (14
   cases): the `exact_lookup` regex is too broad — `TICKER_CANDIDATE +
   TIME_ANCHOR + DOC_TYPE_KEYWORDS` triple-gate fires for plain factual
   questions that mention a year (e.g. `"What was Tesla revenue in 2025"`
   matches `\b2[0-9]{3}\b` time anchor, has TSLA whitelisted ticker,
   matches `revenue` doc-type keyword → labelled `exact_lookup`).

Two confusion pairs are NOT addressed in this phase:

- `relational → factoid` (21) — many genuinely-relational queries lack
  the regex cue words. Fixing this without overfitting to 63 golden
  relational examples needs a separate dataset, deferred.
- `relational → analytical` (17) — these are long relational queries
  caught by the `length > 120` analytical heuristic. Fix is to
  re-order the classifier so relational fires BEFORE the length
  fallback, but only when relational confidence is hard (regex hit).

## Goal

Lift the rule classifier's structural ceiling on golden v2.2 from 0.86 to
1.0 (vocabulary closure) and reduce the obvious `factoid→exact_lookup`
over-firing. Re-run shadow eval, capture new numbers, decide whether
item-9 phase 2 is still worth pursuing.

## Scope

In:

- Add `numeric` and `summary` to `QueryClass` union in
  `apps/api/src/rag/query-classifier-rules.ts`.
- Add emission paths for both:
  - `numeric` — fires when query has financial-numeric pattern AND no
    other class fired (e.g. `EPS`, `P/E`, `revenue per share`,
    `revenue $X.XB`, `diluted EPS`, percentage in question).
  - `summary` — fires when query has summary intent without analytical
    keyword (e.g. `summary of`, `give me a quick rundown`, `tldr`,
    `what does X do` for company-overview shape, leading
    `tell me about`).
- Tighten `exact_lookup`:
  - Triple-gate fallback (ticker candidate + time anchor + doc-type
    keyword) currently fires on plain factoid questions that happen to
    mention all three. Change: require the ticker candidate to be
    quoted, OR require an additional anchor (section / item /
    note / part identifier, OR a quoted phrase). Single-gate hits
    (whitelisted ticker + time anchor) stay strict.
- Re-order classifier: move `relational` ahead of length-fallback
  `analytical` so a hard relational regex hit isn't lost to a long
  query.
- Update LLM classifier prompt (`query-classifier-llm.ts` and the
  duplicated copy in `run_classifier_shadow.mjs`) to enumerate all 7
  classes.
- Update `RetrievalPlannerService` routing decisions for the new
  classes:
  - `numeric` routes like `factoid` (skip rewrite, single-stage
    retrieval, prefer literal token match in rerank).
  - `summary` routes like `analytical` (HyDE on, multi-stage
    orchestrate).
- Tests for new emission paths and the tightened exact_lookup.
- Re-run `services/evaluation-runner/run_classifier_shadow.mjs` and
  commit the new report alongside the old one (allowlist via
  `.gitignore` exception so it lands in-tree).
- Update `tech-debt-tracker.md` item-9 entry with new accuracy numbers.

Out:

- `relational` recall improvement (deferred — needs second dataset).
- Phase-2 runtime shadow flag (still gated on improved metrics).
- Vocabulary expansion to other golden labels we don't see yet.
- LLM prompt redesign or model change.

## Key decisions

1. **Numeric/summary route to existing classes for retrieval.** Adding new
   labels does not require new retrieval lanes. We map at the planner
   boundary, so the rest of the pipeline (RAG search, rerank, lanes)
   doesn't need to learn new classes. Cheap, reversible.
2. **`exact_lookup` tightening is conservative.** We trade some recall for
   precision — if a query loses `exact_lookup` and falls to `factoid`,
   the routing difference is "no rewrite" vs "rewrite" plus rerank query
   choice. The new fallback (rewrite + literal rerank) is acceptable for
   borderline queries.
3. **No phase 2 in this PR.** Same as phase 1 — runtime change deferred
   pending evidence.
4. **Report version bump.** The new shadow report is
   `classifier-shadow-2026-04-26-v2.json`. Both reports stay; the v2
   filename plus the report's `schema_version` tag let comparison
   scripts find both.

## File structure

```
apps/api/src/rag/
  query-classifier-rules.ts                              (modify)
  query-classifier-llm.ts                                (modify — prompt)
  retrieval-planner.service.ts                           (modify — routing for numeric/summary)
  __tests__/
    query-classifier-rules.spec.ts                       (extend)

services/evaluation-runner/
  run_classifier_shadow.mjs                              (modify — duplicated rule logic + prompt)
  reports/classifier-shadow-2026-04-26-v2.json           (new — committed)

docs/exec-plans/
  tech-debt-tracker.md                                   (modify — phase 1.5 numbers)
```

---

## Task 1 — Vocabulary expansion

### 1.1 Type + emission

`apps/api/src/rag/query-classifier-rules.ts`:

```ts
export type QueryClass =
  | 'exact_lookup'
  | 'factoid'
  | 'relational'
  | 'analytical'
  | 'multi_part'
  | 'numeric'
  | 'summary'
  | 'colloquial';
```

Add regex constants:

```ts
const NUMERIC_QUERY = /\b(EPS|earnings per share|P\/?E ratio|diluted EPS|revenue per share|growth rate|operating margin|gross margin|net margin|price target|market cap)\b/i;
const SUMMARY_INTENT = /\b(summary of|give me a (quick )?rundown|tldr|tl;dr|brief overview|short summary|what does .* do\?|tell me about|explain in (one|short))\b/i;
```

Insert in classifier (after exact_lookup/multi_part, before length-analytical to give them priority over the length fallback):

```ts
if (NUMERIC_QUERY.test(query)) return { class: 'numeric', confidence: 1.0, rule: 'numeric' };
if (SUMMARY_INTENT.test(query)) return { class: 'summary', confidence: 1.0, rule: 'summary' };
```

### 1.2 Tests

Add to `query-classifier-rules.spec.ts`:

- 4 numeric cases (EPS / margin / ratio / growth rate) — all return `numeric`.
- 4 summary cases (`summary of …`, `tldr …`, `tell me about …`, `give me a rundown …`) — all return `summary`.
- 1 numeric query that ALSO contains an analytical keyword (`compare EPS`) — must return `numeric` because numeric is checked before analytical_keyword.

### 1.3 Planner routing

`retrieval-planner.service.ts` — wherever `queryClass` switches drive
behavior, add cases:

```ts
// Rewrite gating: numeric joins exact_lookup in skipping rewrite.
const shouldRewrite =
  this.rewriteEnabled && queryClass !== 'exact_lookup' && queryClass !== 'numeric' && query.trim().length > 0;

// Rerank query selection: numeric like exact_lookup (literal tokens matter).
private selectRerankQuery(qc, original, rewritten) {
  if (qc === 'exact_lookup' || qc === 'numeric') return original;
  return rewritten || original;
}

// HyDE gating: summary joins analytical.
if ((queryClass === 'analytical' || queryClass === 'summary') && this.hydeEnabled) { ... }
```

### 1.4 Verify

- `pnpm --filter @finsentinel/api typecheck` PASS
- `pnpm --filter @finsentinel/api test src/rag/__tests__` PASS

### 1.5 Commit

```bash
git commit -m "feat(rag): add numeric and summary classes to QueryClass with planner routing"
```

---

## Task 2 — `exact_lookup` tightening

### 2.1 Logic change

In `query-classifier-rules.ts`, find the triple-gate fallback inside
`isExactLookup`. Current:

```ts
// Triple-gate fallback: any ticker candidate + doc-type keyword.
return DOC_TYPE_KEYWORDS.test(query);
```

Replace with the conservative tightening:

```ts
// Tightened triple-gate fallback (phase 1.5):
// Long-tail tickers (not in whitelist) need either (a) a quoted phrase
// (definitely a literal lookup) OR (b) a section/item/note identifier
// (filings reference). Plain "ticker + year + doc-type-keyword" no longer
// fires — that's how factoid questions like "What was Tesla revenue in
// 2025" leaked into exact_lookup.
return SECTION_IDENTIFIER.test(query) || QUOTED_PHRASE.test(query);
```

### 2.2 Tests

Add to `query-classifier-rules.spec.ts`:

- `"What was Tesla revenue in 2025"` — must NOT be `exact_lookup`
  (currently is). New expected: `factoid`.
- `"AAPL section 4 in the FY2024 10-K"` — must STILL be `exact_lookup`
  (whitelisted ticker + section identifier).
- `"Apple section 7 fiscal 2024 filings"` (long-tail name proxy) — must
  STILL be `exact_lookup` via SECTION_IDENTIFIER fallback.
- Whitelisted-ticker single-gate cases unchanged.

Confirm pre-existing `exact_lookup` tests still pass (no regression on
true literal-lookup queries).

### 2.3 Commit

```bash
git commit -m "fix(rag): tighten exact_lookup triple-gate to require section or quoted phrase"
```

---

## Task 3 — Reorder relational vs length-analytical

In `classifyByRules`, the `relational` check currently fires AFTER
`analytical_keyword` and AFTER length>120. Move it ahead of the length
heuristic so a hard relational regex hit is not lost to long-query
fallback:

```ts
if (isExactLookup(query)) return { class: 'exact_lookup', confidence: 1.0, rule: 'exact_lookup' };
if (isMultiPart(query)) return { class: 'multi_part', confidence: 1.0, rule: 'multi_part' };
if (NUMERIC_QUERY.test(query)) return { class: 'numeric', confidence: 1.0, rule: 'numeric' };
if (SUMMARY_INTENT.test(query)) return { class: 'summary', confidence: 1.0, rule: 'summary' };
if (RELATION_CUES.test(query) || GRAPH_QUERY_PATTERNS.test(query)) {
  return { class: 'relational', confidence: 1.0, rule: 'relational' };
}
if (ANALYTICAL_KEYWORDS.test(query)) return { class: 'analytical', confidence: 1.0, rule: 'analytical_keyword' };
if (query.length > ANALYTICAL_LENGTH_THRESHOLD) {
  return { class: 'analytical', confidence: 0.5, rule: 'analytical_length' };
}
if (COLLOQUIAL_OPENERS.test(query)) return { class: 'colloquial', confidence: 1.0, rule: 'colloquial' };
return { class: 'factoid', confidence: 0.4, rule: 'fallback' };
```

### 3.1 Test

Add: `"How is Tesla's supply chain in China connected to recent tariff policy and what does that mean for margins"` — long enough to trigger length-analytical, but contains `connected` (RELATION_CUE). Must classify as `relational`, not `analytical`.

### 3.2 Commit

```bash
git commit -m "fix(rag): hard relational hit beats length-analytical fallback"
```

---

## Task 4 — Update LLM prompt + offline runner

### 4.1 LLM service prompt

`apps/api/src/rag/query-classifier-llm.ts` — append two more class
definitions and two more few-shot exemplars:

```
- numeric: question about a numeric metric (EPS, P/E, margin, growth rate)
- summary: request for company / topic overview without deep analysis
```

Few-shot additions:

```ts
{ q: 'What is AAPL diluted EPS in FY2024?', class: 'numeric' },
{ q: 'Tell me about Tesla', class: 'summary' },
```

### 4.2 Offline runner

`services/evaluation-runner/run_classifier_shadow.mjs` — sync the
duplicated rule logic AND the LLM prompt with the canonical Nest
implementation. The duplication discipline matters; the planner test
suite is the canonical drift detector.

### 4.3 Commit

```bash
git commit -m "chore(rag): sync LLM prompt and offline runner with new vocabulary"
```

---

## Task 5 — Re-run shadow eval

```bash
node services/evaluation-runner/run_classifier_shadow.mjs \
  --dataset services/evaluation-runner/datasets/golden.json \
  --out services/evaluation-runner/reports/classifier-shadow-2026-04-26-v2.json
```

Then if local OPENROUTER_API_KEY is available:

```bash
node services/evaluation-runner/run_classifier_shadow.mjs \
  --llm --yes --limit 200 \
  --dataset services/evaluation-runner/datasets/golden.json \
  --out services/evaluation-runner/reports/classifier-shadow-2026-04-26-v2.json
```

Both reports get committed (the directory is gitignored except for
explicit allowlist; add `classifier-shadow-2026-04-26*.json` to the
allowlist).

### 5.1 Commit

```bash
git commit -m "data(eval): re-run classifier shadow against golden v2.2 (phase 1.5)"
```

---

## Task 6 — Tracker close-out + decision record

Update `docs/exec-plans/tech-debt-tracker.md` item-9 entry with:
- Phase 1.5 rules-only accuracy (new number).
- Phase 1.5 LLM accuracy if the LLM run completed.
- Verdict on phase 2:
  - If rules ≥ 0.55 and LLM doesn't beat rules by ≥ 5pp on any bucket:
    close item 9 — "rules at <X> is the practical ceiling without ML
    investment; phase 2 deferred indefinitely".
  - If LLM now wins on a bucket: phase 2 unblocked, link the report.
  - If rules < 0.55 and vocabulary is closed: rules need a different
    architecture (e.g., embedding similarity to class anchor queries).
    Open a new tracker entry.

```bash
git commit -m "docs(tech-debt): record item-9 phase 1.5 verdict and item-9 closure decision"
```

---

## Verification

- `pnpm --filter @finsentinel/api typecheck` PASS
- `pnpm --filter @finsentinel/api test --run` PASS (full suite)
- `node services/evaluation-runner/run_classifier_shadow.mjs --dataset services/evaluation-runner/datasets/golden.json` produces a valid v2 report
- v2 report's rules-only accuracy ≥ phase-1's 0.385 (phase 1.5 target: ≥ 0.55)

## Risks

- **Numeric / summary regex over-firing.** The new regexes are narrow but
  could pick off edge cases. Tests pin the obvious shapes; the eval
  surfaces any regressions on previously-correct factoid/analytical
  predictions.
- **`exact_lookup` tightening loses real lookups.** Mitigated by keeping
  whitelisted-ticker single-gate path and adding section / quoted-phrase
  paths. Eval will surface any real loss.
- **Routing semantics for `numeric` and `summary` may be wrong.**
  Defaults are "numeric ≈ factoid", "summary ≈ analytical". If the eval
  shows retrieval quality regression on these classes after phase 1.5,
  routing is wrong and needs a separate planner change.

## Progress log

- 2026-04-26: Phase-1 result reviewed. Vocabulary gap dominates ceiling;
  triple-gate exact_lookup over-fires on factoid+ticker+year. Plan
  scoped to those two surgical changes plus relational reorder.

## Final outcome

(Filled after merge.)
