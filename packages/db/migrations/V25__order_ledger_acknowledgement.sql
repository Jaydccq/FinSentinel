-- V25: Add operator-acknowledgement metadata to order_ledger.
--
-- Backs the M4 prereq (2) operator surface for the trading state-machine PRD
-- (docs/exec-plans/2026-04-26-order-ledger-unknown-operator-surface.md). When
-- the M3 reconciler can't resolve a row it stamps
-- 'UNKNOWN_REQUIRES_OPERATOR_REVIEW'. Until now, an operator had no in-app way
-- to mark the row as "seen + reasoned about" — they had to drop into SQL.
--
-- Design: ack is metadata only. The row's `status` stays
-- 'UNKNOWN_REQUIRES_OPERATOR_REVIEW' so future analytics can still find these
-- rows; `acknowledged_at IS NOT NULL` is the operator-has-reviewed signal.
-- This keeps the state machine narrow.
--
-- Reversal (additive only — no data loss):
--   ALTER TABLE order_ledger
--     DROP COLUMN IF EXISTS acknowledged_at,
--     DROP COLUMN IF EXISTS acknowledged_by,
--     DROP COLUMN IF EXISTS acknowledgement_note;
--   DROP INDEX IF EXISTS order_ledger_unknown_pending_idx;

ALTER TABLE order_ledger
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS acknowledged_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS acknowledgement_note TEXT NULL;

-- Partial index for the operator-pending list query: only rows that are still
-- in UNKNOWN AND not yet acknowledged. The list endpoint reads this in
-- newest-first order so pages stay bounded.
CREATE INDEX IF NOT EXISTS order_ledger_unknown_pending_idx
  ON order_ledger (user_id, updated_at DESC)
  WHERE status = 'UNKNOWN_REQUIRES_OPERATOR_REVIEW' AND acknowledged_at IS NULL;
