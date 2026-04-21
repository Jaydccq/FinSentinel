# Golden Set Labeling SOP (2026-04-21)

Supports phase P1.3 of
`docs/exec-plans/2026-04-21-rag-quality-next-steps.md`.

The goal is to replace the 25-entry synthetic `golden.json` with N ≥ 100
bucket-tagged entries that have valid `expected_chunk_ids` against the
corpus the evaluator actually retrieves from.

## Bucket taxonomy — exactly one per query

| Bucket | Shape | Example |
|---|---|---|
| `exact_lookup` | Literal identifier + year/period | "AAPL Q4 2025 revenue" |
| `factoid` | One-fact answer retrievable from a single chunk | "TSM 2024 capex" |
| `relational` | Joins two entities | "impact of TSM 3 nm delay on AAPL 2025 guidance" |
| `analytical` | Multi-chunk synthesis | "NVDA vs AMD data-center margin trajectory FY23-FY25" |
| `multi_part` | Compound query | "summarize 10-K risk factors AND list CEO changes" |
| `long_doc` | Answer inside one report ≥ 20 k tokens | "Item 1A risk factors in Apple's 2024 10-K" |
| `cross_document` | Requires two or more different documents | "compare Microsoft and Google cloud revenue guidance for 2025" |

Target distribution (total = 100):
`exact_lookup 30 / factoid 20 / relational 15 / analytical 15 /
multi_part 10 / long_doc 5 / cross_document 5`.
±3 per bucket is acceptable.

## Provenance — in order of preference

1. `rag_query_logs.query_preview` (only if
   `RAG_QUERY_LOG_PII_ENABLED=true` was temporarily flipped with legal
   sign-off).
2. `chat_messages` where `role='user'` and `created_at >= now() - interval
   '30 days'`.
3. `agent_events` where `aggregate_type='RAG_QUERY'`.
4. Reverse-engineered from corpus (synthetic, labeled as such in
   `golden.meta.json.provenance_split.reverse_engineered_synthetic`).

### Localhost-only variant (used for P1.3 on 2026-04-21)

When running this plan against localhost without staging data, a
Codex-assisted reverse-engineering pass over
`services/evaluation-runner/datasets/corpus.json` is an acceptable
stand-in. Every query produced this way MUST still carry valid
`expected_chunk_ids` that appear in `corpus.json`, and the entry is
counted in `provenance_split.reverse_engineered_synthetic`. This is
explicitly not "real user queries" — it is "labelled coverage of the
known corpus" and is the correct interim step until staging access
lands.

## Labeler workflow

1. Export candidate queries:

   ```bash
   pnpm --filter @finsentinel/api rag:golden:export \
     --source rag_query_logs \
     --limit 300 \
     --output services/evaluation-runner/datasets/golden.draft.json
   ```

   Fall back to `--source chat_messages` if the first source yields fewer
   than 100 rows.
2. Tag each kept query with exactly one bucket and drop queries with no
   retrievable answer in the current corpus.
3. For every kept query, identify ≤ 5 `expected_chunk_ids` (minimum 1) by
   searching the live corpus — either via `/rag/search` or by grepping
   `services/evaluation-runner/datasets/corpus.json` for the answer
   tokens.
4. Fill `expected_answer` (free text). RAGAS consumes this once its
   evaluator is wired to a real LLM.
5. Second reviewer spot-checks 20 % of tags. Any disagreement → re-label
   both the disputed entry and the next one it was spot-checked against.
6. Write `services/evaluation-runner/datasets/golden.meta.json` with
   `version`, `entry_count`, `labeler_primary`, `labeler_reviewer`,
   `reviewer_sample_pct`, `provenance_split`, and
   `sop_doc: "docs/runbooks/2026-04-21-golden-set-labeling-sop.md"`.

## Verification before commit

```bash
jq '[.entries[].bucket] | group_by(.) | map({bucket: .[0], count: length})' \
  services/evaluation-runner/datasets/golden.json

jq '.entries | all(.expected_chunk_ids | length >= 1)' \
  services/evaluation-runner/datasets/golden.json
```

Expected: distribution within ±3 of SOP target per bucket, total = 100,
`all(length >= 1)` → `true`.
