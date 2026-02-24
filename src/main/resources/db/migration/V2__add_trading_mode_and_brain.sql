-- ============================================================================
-- V2: Ensure trading_mode column and agent_brains table exist
-- Idempotent — safe to run on databases that already have these from V1.
-- ============================================================================

-- Add trading_mode column to trade_wallets
ALTER TABLE trade_wallets ADD COLUMN IF NOT EXISTS trading_mode VARCHAR(10) NOT NULL DEFAULT 'PAPER';

-- Create agent_brains table
CREATE TABLE IF NOT EXISTS agent_brains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id),
    frontal_lobe TEXT NOT NULL DEFAULT '',
    emotion VARCHAR(20) NOT NULL DEFAULT 'neutral',
    commit_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_brains_user_id ON agent_brains(user_id);
