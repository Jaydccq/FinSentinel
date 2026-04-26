# Local RAG Eval Promotion

## Background

`rag:eval:promote` promotes rows from `rag_query_logs` into the RAG golden eval
set. The local database is being treated as the operator staging target for this
run.

## Goal

Run the local promotion path step by step using repository-owned corpus data and
record whether the path can produce reviewable promoted eval rows.

## Scope

- Inspect the existing corpus and golden-set files.
- Prepare the local Postgres schema and seed the fixture corpus.
- Populate or verify `rag_query_logs` rows suitable for promotion.
- Run `rag:eval:promote` first as a dry-run.
- Write promoted rows only to reviewable output unless the canonical golden-set
  mutation is explicitly accepted.

## Assumptions

- Local Postgres at `postgresql://postgres:postgres@localhost:5432/finsentinel`
  is the staging-equivalent target for this operator run.
- The repository fixture corpus is the allowed document corpus source.
- Synthetic local query logs may prove the promotion pipeline, but they are not
  equivalent to real staging traffic labels.

## Implementation Steps

1. Verify migration and table state.
   Verify: `rag_query_logs`, `documents`, and `document_chunks` exist.
2. Seed the fixture corpus.
   Verify: local DB contains 20 documents and 41 chunks from `corpus.json`.
3. Populate promotion-source query logs.
   Verify: `rag_query_logs` contains rows with `query_preview`,
   `query_class`, and non-empty `result_chunk_ids`.
4. Run promotion dry-run.
   Verify: sampled rows and class balance are printed with
   `Rows without preview : 0`.
5. Write review output.
   Verify: promoted rows are written to an explicit review file, not silently to
   the canonical golden set.

## Verification Approach

- Direct DB counts for seeded documents, chunks, and query logs.
- `rag:eval:promote --dry-run` for pipeline validation.
- JSON parsing of any generated review output.

## Progress Log

- 2026-04-26: Local DB migration initially failed because the database had V9
  recorded but lacked `document_chunks`; replayed V9 DDL and applied V16-V24.
- 2026-04-26: Seeded `services/evaluation-runner/datasets/corpus.json` with
  stub embeddings after updating the local `documents_status_check` constraint
  to accept current document statuses.
- 2026-04-26: Verified local DB has 20 documents, 41 chunks, and 0 query logs
  before promotion-source log population.
- 2026-04-26: Inserted 100 local synthetic `rag_query_logs` rows derived from
  `golden.json` queries and deterministic fixture chunk UUIDs. Class balance:
  factoid=37, relational=12, analytical=10, multi_part=8, summary=23,
  numeric=10.
- 2026-04-26: Ran `rag:eval:promote --dry-run --per-class 10 --since
  2026-04-01T00:00:00Z`; sampled 58 rows with class balance
  summary=10, factoid=10, numeric=10, multi_part=8, analytical=10,
  relational=10 and `Rows without preview : 0`.
- 2026-04-26: Ran live promotion to temporary review output only:
  `/tmp/local-rag-promote-golden.json` and
  `/tmp/local-rag-promote-golden.meta.json`. The review file has 158 entries:
  the original 100 plus 58 `real_user_promoted` rows.

## Key Decisions

- Use temporary promotion output first because promoted rows are intentionally
  `unlabelled` and require review before becoming hard golden labels.
- Treat local synthetic logs as pipeline proof, not as real user eval labels.
- Do not mutate `services/evaluation-runner/datasets/golden.json` from this
  synthetic local run.

## Risks and Blockers

- Real traffic promotion still requires a window where query logging has
  `RAG_QUERY_LOG_PII_ENABLED=true`.
- Local API trace insertion currently failed when the search returned no chunks;
  direct synthetic logs avoid blocking the operator pipeline but do not replace
  real staging traffic.
- The promotion CLI printed complete results but did not naturally exit in this
  local application-context run; the completed process was killed after output.

## Final Outcome

Local staging pipeline proof completed. The corpus is seeded, 100 synthetic
promotion-source logs exist in local Postgres, dry-run sampled 58 valid rows, and
live promotion produced review output under `/tmp`. Canonical golden-set files
were not changed.
