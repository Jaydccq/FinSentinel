# Triage Record Cleanup Plan

Date: 2026-04-25
Status: In progress
Owner: Codex

## Background

The 14-axis codebase optimization triage has several stale or thin records:

- Item 5 live-trading guards landed on `main` via merge commit `8544c71`, but
  `2026-04-24-codebase-optimization-triage-prd.md` still describes it as
  branch-only.
- Item 3 M4 has a detailed blocker in
  `2026-04-24-trading-order-ledger-state-machine.md`; the triage PRD should
  point to that source instead of implying the row is self-contained.
- Item 6 has deep RAG context in `tech-debt-tracker.md` and
  `2026-04-21-rag-quality-next-steps.md`.
- Items 9, 10b/c, and 14 are too thin in the triage PRD for future execution.

## Goal

Make the remaining unfinished items independently understandable from
versioned repository artifacts.

## Scope

In scope:

- Update stale triage status for item 5.
- Add a concise step-by-step completion playbook for items 3 M4, 6, 9, 10b/c,
  and 14.
- Add durable records for item 9 and item 10b/c in the technical debt tracker.
- Split item 14 into product-roadmap epics in a product-spec triage document.

Out of scope:

- No production code changes.
- No implementation of the blocked items.
- No broad consolidation of older plan files.

## Assumptions

- `main` is the system of record for shipped status.
- Merge commit `8544c71` means item 5 is no longer branch-only.
- Item 3 M4 remains blocked until state-machine and reconciler soak data exist.
- RAG item 6 and query-planner item 9 must wait for labelled eval data before
  implementation choices are credible.
- UX-heavy frontend work should be split by surface before implementation.

## Implementation Steps

1. Update `2026-04-24-codebase-optimization-triage-prd.md`.
   Verify: `rg` no longer reports "ON A BRANCH, NOT MERGED" for item 5.
2. Add tech-debt tracker entries for item 9 and 10b/c.
   Verify: `rg` finds explicit entries for "query-planner classifier" and
   "SWR rollout".
3. Add product roadmap triage for item 14.
   Verify: the product-loop features are listed as seven independent epics, not a
   single compressed line.
4. Re-read the edited sections.
   Verify: every blocker has a next artifact and a concrete unblocking signal.

## Verification Approach

This is documentation-only. Verification is structural:

- `rg -n` for stale branch-only wording.
- `rg -n` for item 9, item 10b/c, and item 14 durable records.
- `git diff --check` for markdown whitespace issues.

## Progress Log

- 2026-04-25: Read the triage PRD, trading ledger plan, RAG quality plan,
  tech-debt tracker, and deferred follow-ups. Confirmed item 5 is on `main`
  using `git branch --contains 8bf58ce` and `git log --first-parent`.

## Key Decisions

- Keep the triage PRD as the map and push detail into tech-debt/product-spec
  artifacts.
- Do not convert product-loop features into engineering tasks before product
  ordering and acceptance criteria exist.

## Risks and Blockers

- Product-loop roadmap ordering still needs product input.
- RAG/classifier work remains blocked until eval labels can distinguish real
  quality movement from tuning noise.
- Frontend SWR/trading-status work remains blocked on UX state design.

## Final Outcome

Completed 2026-04-25. The triage PRD now marks item 5 as merged to `main`,
links item 10b/c to a tech-debt entry, links item 14 to a product roadmap
triage, and includes a step-by-step playbook for items 3 M4, 6, 9, 10b/c, and
14. The tech-debt tracker now has explicit records for item 9 and item 10b/c.
The product-loop features are split into seven product epics in
`docs/product-specs/2026-04-25-product-loop-roadmap-triage.md`.
