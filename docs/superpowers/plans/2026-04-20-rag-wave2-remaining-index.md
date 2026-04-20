# RAG Wave 2 Remaining Phases — Plan Index

**Date:** 2026-04-20
**Parent plan:** `docs/exec-plans/2026-04-19-rag-wave2-production-rollout-plan.md`
**Runbook:** `docs/runbooks/2026-04-19-rag-wave2-rollout.md`

R1 / R2 / R3 shipped to `main` (merge commits `4b21e9f`, `40f7570`, `2655e5e`). The
four remaining code phases are mutually independent in terms of runtime behaviour
but share the Wave 2 evaluation gate from R1. Each phase is tracked as a
standalone plan so an agent can execute one at a time without loading the other
phases' context.

## Ordering

The recommended sequence is **R4 → R5 → R6 → R7**, but R4 and R5 are fully
parallelisable (R4 touches retrieval-side metadata routing; R5 touches
ingestion-side PDF parsing). R6 depends on R5's `doc_type` signal. R7 is the
capstone and depends on R2/R3/R4/R6 quality being proven on the eval gate.

```
R1/R2/R3 (shipped)
   |
   +-- R4 (Metadata Soft Routing)          # independent; retrieval-side
   |
   +-- R5 (PDF/Word via Markdown Contract) # independent; ingestion-side
   |     |
   |     +-- R6 (Doc-Type-Aware Chunking)  # depends on R5's doc_type signal
   |
   +-- R7 (Shadow -> Canary -> Default)    # capstone
```

## Plan Files

| Phase | Plan | Blast radius |
|-------|------|--------------|
| R4    | [2026-04-20-rag-wave2-r4-metadata-soft-routing.md](2026-04-20-rag-wave2-r4-metadata-soft-routing.md) | Retrieval orchestrator; optional LLM fallback gated by env var |
| R5    | [2026-04-20-rag-wave2-r5-pdf-word-sidecar.md](2026-04-20-rag-wave2-r5-pdf-word-sidecar.md) | Ingestion path; new `services/parser` sidecar |
| R6    | [2026-04-20-rag-wave2-r6-doctype-chunking.md](2026-04-20-rag-wave2-r6-doctype-chunking.md) | Chunking pipeline; reindex CLI required |
| R7    | [2026-04-20-rag-wave2-r7-shadow-canary-rollout.md](2026-04-20-rag-wave2-r7-shadow-canary-rollout.md) | New DB table; runtime traffic-splitting; capstone |

## Human-Gated Prerequisite (R1.1)

Before R4/R6/R7 can **verify** their eval-bucket deltas, the golden set must be
grown from the seeded 5-entry fixture to N>=100 real-labelled queries. See the
master plan's `R1.1` entry and the runbook for the human workflow. Offline
`CorpusRetriever` results remain comparable via R1's baseline freeze, but bucket
deltas stay speculative until R1.1 lands.

## Common Verification Contract

Every phase must pass, before merge:

```bash
pnpm --filter @finsentinel/api typecheck
pnpm --filter @finsentinel/db typecheck
pnpm --filter @finsentinel/api test -- rag
pnpm --filter @finsentinel/api test -- agent     # if the phase touches agent code
pnpm --filter @finsentinel/api cli rag:eval:run --config services/evaluation-runner/configs/ci-offline.yaml
```

Flag-off regression snapshot from T1.A MUST remain byte-identical for every phase.
