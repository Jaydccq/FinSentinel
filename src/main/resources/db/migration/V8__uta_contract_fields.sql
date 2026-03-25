-- V8: Add UTA contract fields to existing wallet position entries
-- Existing positions are assumed to be STOCK type on SMART exchange with USD currency
-- JSONB is flexible — no schema change needed, just enrich existing data
-- COALESCE handles per-element defaults: positions that already have secType keep their value

UPDATE trade_wallets
SET positions = (
    SELECT jsonb_agg(
        pos || jsonb_build_object(
            'secType', COALESCE(pos->>'secType', 'STOCK'),
            'exchange', COALESCE(pos->>'exchange', 'SMART'),
            'currency', COALESCE(pos->>'currency', 'USD')
        )
    )
    FROM jsonb_array_elements(positions::jsonb) AS pos
)
WHERE positions IS NOT NULL
  AND positions::text != '[]'
  AND jsonb_array_length(positions::jsonb) > 0;
