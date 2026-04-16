-- ============================================================================
-- V11: Add analysis runtime tables (runs, stages, artifacts, approvals)
-- ============================================================================

CREATE TABLE IF NOT EXISTS analysis_runs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id),
    source_mode             VARCHAR(20) NOT NULL,
    status                  VARCHAR(24) NOT NULL DEFAULT 'QUEUED',
    current_stage_key       VARCHAR(32),
    complexity_score        NUMERIC(8,2),
    upgrade_reason          VARCHAR(255),
    parent_chat_session_id  UUID,
    input_snapshot_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
    shared_context_json     JSONB,
    decision_object_json    JSONB,
    final_report_markdown   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at            TIMESTAMPTZ,
    archived_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_analysis_runs_user_created
    ON analysis_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_user_status
    ON analysis_runs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_parent_chat_session
    ON analysis_runs(parent_chat_session_id);

CREATE TABLE IF NOT EXISTS analysis_stages (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id                  UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    stage_key               VARCHAR(32) NOT NULL,
    status                  VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    checkpoint_version      INTEGER NOT NULL DEFAULT 0,
    parallel_group_key      VARCHAR(40),
    structured_output_json  JSONB,
    human_report_markdown   TEXT,
    error_json              JSONB,
    started_at              TIMESTAMPTZ,
    completed_at            TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_analysis_stages_run_stage_key
    ON analysis_stages(run_id, stage_key);
CREATE INDEX IF NOT EXISTS idx_analysis_stages_run_status
    ON analysis_stages(run_id, status);

CREATE TABLE IF NOT EXISTS analysis_artifacts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    stage_id        UUID REFERENCES analysis_stages(id) ON DELETE SET NULL,
    artifact_kind   VARCHAR(32) NOT NULL,
    artifact_name   VARCHAR(120) NOT NULL,
    mime_type       VARCHAR(80) NOT NULL DEFAULT 'application/json',
    payload_json    JSONB,
    storage_uri     VARCHAR(512),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analysis_artifacts_run_kind
    ON analysis_artifacts(run_id, artifact_kind);
CREATE INDEX IF NOT EXISTS idx_analysis_artifacts_stage
    ON analysis_artifacts(stage_id);

CREATE TABLE IF NOT EXISTS analysis_approvals (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id                  UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    approval_type           VARCHAR(40) NOT NULL DEFAULT 'EXECUTION_APPROVAL',
    status                  VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    requested_payload_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
    approved_payload_json   JSONB,
    requested_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at             TIMESTAMPTZ,
    resolved_by_user_id     UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_analysis_approvals_run_status
    ON analysis_approvals(run_id, status);
