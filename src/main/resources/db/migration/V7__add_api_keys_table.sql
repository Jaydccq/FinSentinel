-- ============================================================================
-- V7: Add encrypted API key storage table
-- ============================================================================

CREATE TABLE api_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_name        VARCHAR(64) NOT NULL,
    encrypted_value TEXT NOT NULL,
    iv              TEXT NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE(user_id, key_name)
);

CREATE INDEX idx_api_keys_user ON api_keys(user_id);
