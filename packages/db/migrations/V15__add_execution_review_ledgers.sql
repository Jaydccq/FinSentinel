-- ============================================================================
-- V15: Add execution review ledgers
-- Tracks the lifecycle of order drafts through staged, committed, approved,
-- dispatched, executed, rejected, and failed states. FK'd to analysis_runs
-- and analysis_approvals for full audit traceability.
-- ============================================================================

CREATE TABLE IF NOT EXISTS execution_review_ledgers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  approval_id UUID NOT NULL REFERENCES analysis_approvals(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL,
  order_draft_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  staged_operation_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  commit_hash VARCHAR(128),
  execution_result_ref VARCHAR(255),
  rejection_note VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT execution_review_ledgers_status_check CHECK (status IN (
    'DRAFTED','STAGED','COMMITTED','APPROVED','DISPATCHED','EXECUTED','REJECTED','FAILED'
  ))
);

CREATE INDEX IF NOT EXISTS idx_execution_review_ledgers_run
  ON execution_review_ledgers (run_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_review_ledgers_approval
  ON execution_review_ledgers (approval_id);
