# Trading M4 Readiness Audit

## Background

Item 3 M4 is the planned removal of legacy `wallet.commitHistory` as the
trading execution history / idempotency fallback. Earlier planning explicitly
marked M4 as "do not start" until three prerequisites clear:

1. M2/M3 staging soak with real broker traffic for at least one week.
2. Operator review surface for `UNKNOWN_REQUIRES_OPERATOR_REVIEW` rows.
3. Read-path audit for every production path still reading
   `wallet.commitHistory`.

## Goal

Do not start M4 deletion work. Verify the prerequisite state from the repository
and complete the read-path audit so a later M4 plan has a concrete deletion /
migration checklist.

## Scope

In:

- Search production API / web / shared / DB code for `commitHistory` and
  `commit_history`.
- Verify whether the repository contains staging-soak evidence.
- Verify whether the repository contains operator actions for UNKNOWN rows.
- Record the M4 readiness decision durably.

Out:

- Removing `trade_wallets.commit_history`.
- Migrating history endpoints to `order_ledger`.
- Adding retry / acknowledge operator actions.
- Treating local RAG "staging" work as trading M2/M3 soak evidence.

## Assumptions

- The repository is the only durable system of record.
- No staging credentials or external broker telemetry were available in this
  task.
- Absence of a repository artifact is not proof that an external run never
  happened; it only means the run cannot be relied on for M4 readiness.

## Success Criteria

- Each original M4 prerequisite has a clear status.
- All production `wallet.commitHistory` read/write dependencies are listed.
- The result is linked from the active trading ledger plan / tracker.
- No M4 implementation code is changed.

## Implementation Steps

1. Search repository for `commitHistory`, `commit_history`,
   `UNKNOWN_REQUIRES_OPERATOR_REVIEW`, and trading ledger action paths.
   Verify: grep output identifies every production TS use and separates
   unrelated `agent_brains.commitHistory`.
2. Inspect trading service, controller, web UI, and order ledger service.
   Verify: exact current read paths and missing operator action paths are
   captured below.
3. Update durable docs.
   Verify: this audit file is referenced from the active trading state-machine
   plan and tech-debt tracker.

## Verification Approach

Commands used:

```bash
rg -n "commitHistory" apps packages --glob "*.ts" \
  --glob "!**/*.spec.ts" --glob "!**/__tests__/**" -S
rg -n "commit_history" apps packages --glob "*.ts" \
  --glob "!**/*.spec.ts" --glob "!**/__tests__/**" -S
rg -n "UNKNOWN_REQUIRES_OPERATOR_REVIEW|Acknowledge|Retry|acknowledge|retry" \
  apps/api/src/trading apps/web/src/components/trading apps/web/src/views \
  apps/web/src/api/trading.ts apps/web/src/hooks/api/use-order-ledger.ts -S
rg -n "TRADING_STATE_MACHINE_ENABLED|stateMachineEnabled|staging|soak|UNKNOWN_REQUIRES_OPERATOR_REVIEW" \
  docs/exec-plans docs/runbooks apps/api/src/config apps/api/src/trading -S
```

## Read-Path Audit

The `agent_brains.commitHistory` column is unrelated to M4; it belongs to
`agent_brains`, not `trade_wallets`. The M4 scope is
`trade_wallets.commit_history` / `WalletRow.commitHistory`.

| Path | Current behavior | M4 implication |
| --- | --- | --- |
| `packages/db/src/schema/trade-wallets.ts:20` | Drizzle schema still maps `trade_wallets.commit_history` to `commitHistory`. | M4 needs a DB migration plus schema removal only after every code path below is migrated. |
| `apps/api/src/trading/unified-trading.service.ts:100-107` | `WalletRow` requires `commitHistory`. | Type must be removed or made unavailable after schema migration. |
| `apps/api/src/trading/unified-trading.service.ts:562-568` | Flag-off execute path checks `wallet.commitHistory` hashes for legacy idempotency. | M4 cannot land while `TRADING_STATE_MACHINE_ENABLED=false` remains a supported production mode. Either make ledger idempotency unconditional or permanently retire the flag-off execute path first. |
| `apps/api/src/trading/unified-trading.service.ts:832-844` | Flag-off execute path appends to `commitHistory`. Flag-on path already skips this write. | M4 must delete the legacy append branch and update tests that assert legacy behavior. |
| `apps/api/src/trading/unified-trading.service.ts:938-948` | New wallets are inserted with `commitHistory: []`. | Remove when the column is removed from the schema. |
| `apps/api/src/trading/unified-trading.service.ts:1054-1068` | `getCommitLog()` builds human-readable history from `commitHistory`. | Must be replaced by an `order_ledger` grouped-by-commit read model before `/trading/history` and the agent `getTradeHistory` tool can survive M4. |
| `apps/api/src/trading/unified-trading.service.ts:1098-1115` | `getCommitLogStructured()` builds `V2CommitResponse[]` from `commitHistory`. | Must be replaced by an `order_ledger` grouped-by-commit read model before `/trading/v2/history` and the Trading page history panel can survive M4. |
| `apps/api/src/trading/unified-trading.service.ts:1177-1184` | `resolveOperationalContract()` scans recent `commitHistory` operations to pick a contract for `checkMarketHours()` and `syncOrders()`. | Needs a replacement source: positions first, then latest `order_ledger.symbol`, then fallback. Otherwise market-hours / sync-orders behavior changes silently. |
| `apps/api/src/trading/trading.controller.ts:132-136` | `GET /trading/history` calls `getCommitLog()`. | Controller can stay only if service is migrated to ledger-backed history. |
| `apps/api/src/trading/trading.controller.ts:216-222` | `GET /trading/v2/history` calls `getCommitLogStructured()`. | Controller can stay only if service is migrated to ledger-backed history. |
| `apps/api/src/agent/tools/unified-trading.tool.ts:123-141` and `apps/api/src/agent/tool-registry.ts:139-140` | Agent `getTradeHistory` calls `getCommitLog()`. | Agent responses change unless M4 preserves the current text contract from `order_ledger`. |
| `apps/web/src/api/trading.ts:123` and `apps/web/src/views/TradingPage.tsx:180-183, 814-965` | Trading page fetches `/trading/v2/history` and renders the legacy commit history panel next to the read-only order ledger. | M4 needs either ledger-backed `/v2/history` parity or a web migration to render grouped `order_ledger` rows as the primary history. |

## Prerequisite Status

| Prerequisite | Status | Evidence |
| --- | --- | --- |
| M2/M3 staging soak with real broker traffic for at least one week | Not satisfied from repository evidence | `docs/exec-plans/2026-04-24-trading-order-ledger-state-machine.md` still records M4 as premature; no runbook/report/metrics artifact records a one-week trading soak or UNKNOWN backlog review. |
| Operator review surface for `UNKNOWN_REQUIRES_OPERATOR_REVIEW` rows | Not satisfied | `apps/api/src/trading/trading.controller.ts:241` says operator actions land with M4; `apps/web/src/components/trading/OrderLedgerCard.tsx:42-80` renders Retry/Acknowledge as disabled; `OrderLedgerService` can set UNKNOWN but has no acknowledge/resolve method. |
| Read-path audit | Completed by this file | The table above is the deletion/migration checklist. |

## Key Decisions

- Do not start M4 implementation from the current repository state.
- Treat this audit as clearing only prerequisite 3.
- The next safe engineering step is an operator-action surface for UNKNOWN rows
  or a staging-soak artifact, not `commitHistory` removal.
- `order_ledger` must provide a grouped commit-history read model before
  `getCommitLog()` / `getCommitLogStructured()` can stop reading
  `commitHistory`.

## Risks and Blockers

- Removing the legacy branch while `TRADING_STATE_MACHINE_ENABLED=false`
  remains valid would break flag-off execution idempotency and history.
- Removing history endpoints before a ledger-backed read model would blank the
  Trading page history panel and agent `getTradeHistory` tool.
- Removing `resolveOperationalContract()` history fallback without replacement
  may change `checkMarketHours()` / `syncOrders()` broker selection for wallets
  with no positions.
- Without operator resolution for UNKNOWN rows, M3 can park rows that no user or
  operator can safely close without SQL.

## Progress Log

- 2026-04-26: Audited production TS references to `wallet.commitHistory` and
  `trade_wallets.commit_history`.
- 2026-04-26: Confirmed repo has read-only UNKNOWN visibility but no enabled
  operator action surface.
- 2026-04-26: Confirmed no repository-owned trading soak artifact exists.

## Final Outcome

M4 remains blocked. Prerequisite 3 is now satisfied by this audit. Prerequisite
1 is unverified/not satisfied from repository evidence, and prerequisite 2 is
not satisfied. Do not remove `wallet.commitHistory` until the operator UNKNOWN
surface exists and the M2/M3 staging soak is recorded in the repository.
