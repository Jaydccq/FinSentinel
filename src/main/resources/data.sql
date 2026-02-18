-- FinSentinel Seed Data: demo user, 2 portfolios, 8 holdings
-- All inserts are idempotent via WHERE NOT EXISTS checks

-- 1. Demo user (password: demo123)
INSERT INTO users (id, username, email, password, display_name, created_at, updated_at)
SELECT 'a0000000-0000-0000-0000-000000000001'::uuid,
       'demo',
       'demo@finsentinel.com',
       '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
       'Demo User',
       NOW(),
       NOW()
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = 'a0000000-0000-0000-0000-000000000001'::uuid);

-- 2a. Tech Growth Portfolio
INSERT INTO portfolios (id, name, description, user_id, total_value, created_at, updated_at)
SELECT 'b0000000-0000-0000-0000-000000000001'::uuid,
       'Tech Growth Portfolio',
       'High-growth technology stocks focused on AI and cloud computing',
       'a0000000-0000-0000-0000-000000000001'::uuid,
       125000.00,
       NOW(),
       NOW()
WHERE NOT EXISTS (SELECT 1 FROM portfolios WHERE id = 'b0000000-0000-0000-0000-000000000001'::uuid);

-- 2b. Balanced Income Portfolio
INSERT INTO portfolios (id, name, description, user_id, total_value, created_at, updated_at)
SELECT 'b0000000-0000-0000-0000-000000000002'::uuid,
       'Balanced Income Portfolio',
       'Diversified portfolio balancing growth and dividend income',
       'a0000000-0000-0000-0000-000000000001'::uuid,
       95000.00,
       NOW(),
       NOW()
WHERE NOT EXISTS (SELECT 1 FROM portfolios WHERE id = 'b0000000-0000-0000-0000-000000000002'::uuid);

-- 3a. Tech Growth Portfolio holdings
INSERT INTO holdings (id, portfolio_id, symbol, company_name, quantity, average_cost, current_price, sector, created_at, updated_at)
SELECT 'c0000000-0000-0000-0000-000000000001'::uuid,
       'b0000000-0000-0000-0000-000000000001'::uuid,
       'AAPL', 'Apple Inc.', 150.000000, 178.50, 192.30, 'Technology',
       NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM holdings WHERE id = 'c0000000-0000-0000-0000-000000000001'::uuid);

INSERT INTO holdings (id, portfolio_id, symbol, company_name, quantity, average_cost, current_price, sector, created_at, updated_at)
SELECT 'c0000000-0000-0000-0000-000000000002'::uuid,
       'b0000000-0000-0000-0000-000000000001'::uuid,
       'NVDA', 'NVIDIA Corporation', 80.000000, 450.25, 520.80, 'Technology',
       NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM holdings WHERE id = 'c0000000-0000-0000-0000-000000000002'::uuid);

INSERT INTO holdings (id, portfolio_id, symbol, company_name, quantity, average_cost, current_price, sector, created_at, updated_at)
SELECT 'c0000000-0000-0000-0000-000000000003'::uuid,
       'b0000000-0000-0000-0000-000000000001'::uuid,
       'MSFT', 'Microsoft Corporation', 100.000000, 380.00, 415.60, 'Technology',
       NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM holdings WHERE id = 'c0000000-0000-0000-0000-000000000003'::uuid);

INSERT INTO holdings (id, portfolio_id, symbol, company_name, quantity, average_cost, current_price, sector, created_at, updated_at)
SELECT 'c0000000-0000-0000-0000-000000000004'::uuid,
       'b0000000-0000-0000-0000-000000000001'::uuid,
       'GOOGL', 'Alphabet Inc.', 120.000000, 140.75, 165.20, 'Technology',
       NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM holdings WHERE id = 'c0000000-0000-0000-0000-000000000004'::uuid);

-- 3b. Balanced Income Portfolio holdings
INSERT INTO holdings (id, portfolio_id, symbol, company_name, quantity, average_cost, current_price, sector, created_at, updated_at)
SELECT 'c0000000-0000-0000-0000-000000000005'::uuid,
       'b0000000-0000-0000-0000-000000000002'::uuid,
       'JNJ', 'Johnson & Johnson', 200.000000, 155.30, 162.45, 'Healthcare',
       NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM holdings WHERE id = 'c0000000-0000-0000-0000-000000000005'::uuid);

INSERT INTO holdings (id, portfolio_id, symbol, company_name, quantity, average_cost, current_price, sector, created_at, updated_at)
SELECT 'c0000000-0000-0000-0000-000000000006'::uuid,
       'b0000000-0000-0000-0000-000000000002'::uuid,
       'PG', 'Procter & Gamble Co.', 175.000000, 148.60, 158.90, 'Consumer Staples',
       NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM holdings WHERE id = 'c0000000-0000-0000-0000-000000000006'::uuid);

INSERT INTO holdings (id, portfolio_id, symbol, company_name, quantity, average_cost, current_price, sector, created_at, updated_at)
SELECT 'c0000000-0000-0000-0000-000000000007'::uuid,
       'b0000000-0000-0000-0000-000000000002'::uuid,
       'TSLA', 'Tesla Inc.', 50.000000, 245.00, 268.75, 'Consumer Discretionary',
       NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM holdings WHERE id = 'c0000000-0000-0000-0000-000000000007'::uuid);

INSERT INTO holdings (id, portfolio_id, symbol, company_name, quantity, average_cost, current_price, sector, created_at, updated_at)
SELECT 'c0000000-0000-0000-0000-000000000008'::uuid,
       'b0000000-0000-0000-0000-000000000002'::uuid,
       'AMZN', 'Amazon.com Inc.', 90.000000, 175.40, 195.30, 'Consumer Discretionary',
       NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM holdings WHERE id = 'c0000000-0000-0000-0000-000000000008'::uuid);
