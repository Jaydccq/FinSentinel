-- V23: order_ledger — persistent per-operation execution log for the
-- trading subsystem. M1 of the trading-order-ledger-state-machine PRD
-- (docs/exec-plans/2026-04-24-trading-order-ledger-state-machine.md).
--
-- Today the unified-trading service consumes pending commits via Redis
-- GETDEL and stores execution outcomes only inside the wallet's
-- commitHistory JSONB blob. If a worker crashes between the GETDEL and
-- the wallet write, the commit is lost from Redis with no durable
-- record of what happened. This table is the durable counterpart.
--
-- M1 scope (this migration): additive only. The table is dual-written
-- by the unified-trading service in EXECUTED/FAILED/PARTIALLY_FAILED
-- states; no state machine flip yet. M2 lands the full state machine.

CREATE TABLE IF NOT EXISTS order_ledger (
  id                UUID PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  commit_hash       VARCHAR(64) NOT NULL,
  idempotency_key   VARCHAR(128),
  status            VARCHAR(32) NOT NULL CHECK (status IN (
                      'STAGED',
                      'COMMITTED',
                      'EXECUTING',
                      'EXECUTED',
                      'PARTIALLY_FAILED',
                      'FAILED',
                      'CANCELLED'
                    )),
  symbol            VARCHAR(64) NOT NULL,
  side              VARCHAR(8)  NOT NULL,
  qty               VARCHAR(64),
  amount            VARCHAR(64),
  price             VARCHAR(64),
  broker            VARCHAR(32) NOT NULL,
  broker_order_id   VARCHAR(128),
  broker_request    JSONB NOT NULL DEFAULT '{}'::jsonb,
  broker_response   JSONB,
  error_reason      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS order_ledger_user_created_idx
  ON order_ledger (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS order_ledger_commit_hash_idx
  ON order_ledger (commit_hash);

CREATE INDEX IF NOT EXISTS order_ledger_idempotency_idx
  ON order_ledger (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS order_ledger_broker_status_idx
  ON order_ledger (broker, status);
