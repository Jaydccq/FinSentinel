# Resume Technical Guide

## Background

The resume describes FinSentinel as an autonomous investment research and risk
platform with AI-assisted development guardrails, multi-stage RAG, typed tool
orchestration, broker-agnostic execution, SSE chat streaming, compaction,
rate limiting, Prometheus telemetry, and append-only audit events.

Repository rules require durable project knowledge to live in the repository,
so this work creates a versioned technical guide rather than relying on chat.

## Goal

Create a detailed Chinese technical guide that helps explain and defend every
technical claim in the resume against interview follow-up questions.

## Scope

In scope:

- Ground the guide in current repository code, tests, and execution plans.
- Call out mismatches between resume wording and current repository facts.
- Provide interview-ready explanations, diagrams, likely questions, and study
  drills.
- Add the guide under `docs/technical-guides/`.

Out of scope:

- Changing application code.
- Editing the resume itself.
- Rewriting the existing top-level `interview.md`.
- Producing new benchmark data beyond what current tests and instrumentation
  already provide.

## Assumptions

- The requested guide should be in Chinese because the user asked in Chinese.
- The current repository is the source of truth, even where the resume text or
  old interview notes mention earlier implementation details.
- Benchmarked claims can be explained only to the extent that benchmark tests,
  metrics instrumentation, or execution plans exist in this repository.

## Implementation Steps

1. Read relevant repository code, tests, docs, and plans.
   Verify: identify source files for each resume bullet.
2. Create this execution plan.
   Verify: plan exists under `docs/exec-plans/`.
3. Write the technical guide under `docs/technical-guides/`.
   Verify: guide includes all resume bullets and repository evidence.
4. Run documentation verification.
   Verify: `git diff --check` passes.
5. Update this plan with final outcome and verification result.
   Verify: progress log and final outcome are current.

## Verification Approach

- Documentation structure check by reviewing the created Markdown.
- Whitespace sanity check with `git diff --check`.
- No app tests are required because this task does not change executable code.

## Progress Log

- 2026-04-18: Inspected repository layout, existing docs, relevant API modules,
  RAG services, tool registry, trading service, chat services, event log,
  metrics, rate limiter, benchmark tests, and SDK migration plan.
- 2026-04-18: Found a key alignment risk: the current repository mechanically
  blocks direct Vercel AI SDK imports through `pnpm check:no-vercel-ai-sdk`;
  the guide must explain the historical/current runtime distinction.
- 2026-04-18: Created this execution plan.
- 2026-04-18: Wrote the Chinese technical interview guide at
  `docs/technical-guides/autonomous-investment-platform-interview-guide.md`,
  covering repo guardrails, RAG, tool orchestration, trading execution,
  analysis runtime, SSE/compaction, observability, rate limiting, audit logs,
  high-frequency interview questions, and study drills.
- 2026-04-18: Added narrow `.gitignore` exceptions so this plan and the
  technical guide are visible to Git instead of ignored by the broad docs
  ignore rules.
- 2026-04-18: Ran `git diff --check`; it passed with no whitespace errors.
- 2026-04-18: Regenerated the missing project introduction material inside the
  existing guide, adding a front-loaded "项目介绍与技术栈" section with the
  project positioning, user flow, technology stack table, technology choices,
  current repository calibration, and 30-second / 2-minute interview templates.

## Key Decisions

- Keep the detailed guide under `docs/technical-guides/` so top-level files stay
  navigational.
- Do not edit `interview.md`; it is a large existing top-level guide and may be
  stale relative to the current `@finsentinel/ai-runtime` migration.
- Treat latency and throughput numbers as claims that need benchmark or
  Prometheus evidence unless this repository contains a specific benchmark.

## Risks And Blockers

- Some resume numbers are backed by benchmark-style tests using mocks rather
  than production load tests. The guide must distinguish "implemented and
  tested in-process" from "externally load tested."
- RAG sub-300ms latency is instrumented through Prometheus histograms, but a
  dedicated RAG latency benchmark was not found during inspection.

## Final Outcome

Completed. The repository now contains a durable Chinese technical guide for
the resume project and this execution plan records the scope, assumptions,
risks, and verification result. The guide also includes a regenerated project
introduction and technology stack section near the top for easier discovery. No
application code was changed. `.gitignore` was updated only to make these two
documentation artifacts trackable.
