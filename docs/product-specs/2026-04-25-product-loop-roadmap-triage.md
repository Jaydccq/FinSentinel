# Product Loop Roadmap Triage

Date: 2026-04-25
Status: Product roadmap input, not an engineering execution plan

## Background

The codebase optimization triage item 14 grouped seven product-loop ideas into one
line:

- watchlist triggers
- portfolio risk dashboard
- citation reports
- "what changed since last"
- trade-from-research
- audit log
- freshness badge

That grouping is too compressed for execution. These are separate product
epics with different users, data dependencies, and safety risks.

## Goal

Turn item 14 into a navigable product roadmap surface without pretending the
features are already engineering-ready.

## Non-goals

- No implementation sequencing is final here.
- No API contract is committed here.
- No feature should move into engineering until it has its own product spec and
  acceptance criteria.

## Triage Principles

- Pick one product loop at a time.
- Prefer features that close an existing workflow over features that add a new
  isolated surface.
- Trading-adjacent features need explicit safety, audit, and rollback behavior
  before engineering starts.

## Epics

### PL-1 Watchlist Triggers

User value: turn a passive watchlist into an actionable monitoring workflow.

Open product questions:

- Which trigger types matter first: price move, news volume, filing event,
  sentiment shift, or custom threshold?
- Should triggers notify, create tasks, start research, or all three?
- Where does the user manage noisy triggers?

Engineering prerequisites:

- Server-side watchlist item CRUD and metadata fields.
- Notification or event surface.
- Rate limits and deduplication rules.

Ready signal:

- A product spec defines trigger types, notification channels, and quieting
  behavior.

### PL-2 Portfolio Risk Dashboard

User value: show current portfolio exposure, concentration, and risk movement in
one operational view.

Open product questions:

- Which risk metrics are first-class: sector concentration, single-name
  exposure, drawdown, beta, VaR-like estimate, or liquidity?
- Is this daily snapshot, intraday, or on-demand?
- What actions should the dashboard enable?

Engineering prerequisites:

- Reliable holdings/positions source.
- Market data freshness indicators.
- Clear calculation definitions.

Ready signal:

- A product spec names the first metric set and expected calculation cadence.

### PL-3 Citation Reports

User value: export research answers with source-backed citations for review or
sharing.

Open product questions:

- Is the report for internal audit, client sharing, or analyst workflow?
- What citation format is required?
- Should reports be immutable snapshots?

Engineering prerequisites:

- Stable RAG citation metadata.
- Report generation surface.
- Artifact storage and retrieval.

Ready signal:

- A product spec defines report format, citation quality bar, and retention.

### PL-4 What Changed Since Last

User value: summarize deltas since the user's previous review of a company,
portfolio, watchlist, or research topic.

Open product questions:

- What is the comparison anchor: last login, last report, last research run, or
  explicit saved checkpoint?
- Which changes count: filings, news, prices, estimates, portfolio exposure,
  model answer changes?
- How should low-confidence changes be displayed?

Engineering prerequisites:

- Durable user/session checkpoint model.
- Source freshness metadata.
- Delta summarization contract.

Ready signal:

- A product spec defines the anchor model and the minimum viable change types.

### PL-5 Trade From Research

User value: convert a research-backed decision into a staged trade without
copying context between tools.

Open product questions:

- What evidence must be shown before a trade can be staged?
- Is the first version paper-only, live-capable, or explicitly research-to-draft
  only?
- What approvals or acknowledgements are required?

Engineering prerequisites:

- Trading ledger/state machine and live-trading guards.
- Citation/evidence snapshot attached to order drafts.
- Clear separation between recommendation, draft, and execution.

Ready signal:

- A product spec defines the safety boundary and whether v1 can touch live
  trading.

### PL-6 Audit Log

User value: make system actions, user actions, and agent decisions traceable.

Open product questions:

- Which actions need audit first: trades, research runs, document ingestion,
  auth/session events, or settings changes?
- Who reads audit logs: user, operator, compliance reviewer?
- What retention and export rules apply?

Engineering prerequisites:

- Event taxonomy.
- Immutable event storage or append-only policy.
- Access-control model.

Ready signal:

- A product spec defines the first audited domains and retention/export needs.

### PL-7 Freshness Badge

User value: make stale data visible before the user trusts a quote, answer,
report, or portfolio metric.

Open product questions:

- Which surfaces need freshness first?
- What thresholds map to fresh, stale, and unknown?
- Is freshness source-specific or global?

Engineering prerequisites:

- Per-source freshness timestamps.
- UI convention for stale/unknown data.
- Tests for missing or delayed data.

Ready signal:

- A product spec defines threshold semantics for the first target surface.

## Recommended Order

1. Freshness badge (PL-7): smallest cross-cutting trust improvement.
2. Audit log (PL-6): creates the accountability base for trading-adjacent work.
3. Citation reports (PL-3): builds on RAG citation work and artifact storage.
4. Watchlist triggers (PL-1): needs notification/dedup decisions.
5. Portfolio risk dashboard (PL-2): needs metric definitions and data freshness.
6. What changed since last (PL-4): needs checkpoint semantics.
7. Trade from research (PL-5): highest safety bar; should wait for audit,
   citations, and live-trading guards to be proven.

## Next Step

Pick one epic and write a normal product spec under `docs/product-specs/` with:

- user story
- in-scope and out-of-scope behavior
- data sources
- acceptance criteria
- safety or trust requirements
- minimal verification plan
