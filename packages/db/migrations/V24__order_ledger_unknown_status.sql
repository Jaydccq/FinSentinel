-- V24: extend order_ledger.status CHECK to include
-- 'UNKNOWN_REQUIRES_OPERATOR_REVIEW'.
--
-- M3 reconciler (docs/exec-plans/2026-04-24-trading-order-ledger-state-machine.md
-- §8) needs a terminal-but-not-resolved state for rows where the broker can't
-- give a definitive answer (e.g., no broker_order_id was ever recorded
-- because the process crashed BEFORE the broker call returned, OR the broker
-- returns 'unknown' / 404 for the order id we have on file). Putting these
-- in their own bucket avoids a false EXECUTED that the wallet can't back out
-- of, and avoids a false FAILED that the operator might re-issue.
--
-- The ALTER is idempotent: drop-if-exists then add.

ALTER TABLE order_ledger DROP CONSTRAINT IF EXISTS order_ledger_status_check;

ALTER TABLE order_ledger
  ADD CONSTRAINT order_ledger_status_check CHECK (status IN (
    'STAGED',
    'COMMITTED',
    'EXECUTING',
    'EXECUTED',
    'PARTIALLY_FAILED',
    'FAILED',
    'CANCELLED',
    'UNKNOWN_REQUIRES_OPERATOR_REVIEW'
  ));
