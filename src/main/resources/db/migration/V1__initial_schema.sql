-- ============================================================================
-- V1: Initial FinSentinel schema
-- Creates all tables matching JPA entities as of the initial production release.
-- ============================================================================

-- Required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================================
-- 1. users
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username        VARCHAR(50)  NOT NULL UNIQUE,
    email           VARCHAR(255) NOT NULL UNIQUE,
    password        VARCHAR(255) NOT NULL,
    display_name    VARCHAR(100),
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 2. portfolios
-- ============================================================================
CREATE TABLE IF NOT EXISTS portfolios (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100)   NOT NULL,
    description     VARCHAR(255),
    user_id         UUID           NOT NULL REFERENCES users(id),
    total_value     NUMERIC(15,2),
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolios_user_id ON portfolios(user_id);

-- ============================================================================
-- 3. holdings
-- ============================================================================
CREATE TABLE IF NOT EXISTS holdings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    portfolio_id    UUID           NOT NULL REFERENCES portfolios(id),
    symbol          VARCHAR(10)    NOT NULL,
    company_name    VARCHAR(200),
    quantity        NUMERIC(15,6)  NOT NULL,
    average_cost    NUMERIC(15,2)  NOT NULL,
    current_price   NUMERIC(15,2),
    sector          VARCHAR(50),
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_holdings_portfolio_id ON holdings(portfolio_id);

-- ============================================================================
-- 4. documents
-- ============================================================================
CREATE TABLE IF NOT EXISTS documents (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_name           VARCHAR(255) NOT NULL,
    original_file_name  VARCHAR(255) NOT NULL,
    doc_type            VARCHAR(50)  NOT NULL,
    status              VARCHAR(50)  NOT NULL DEFAULT 'PENDING',
    sector              VARCHAR(255),
    region_id           VARCHAR(10)  DEFAULT 'US',
    user_id             UUID         REFERENCES users(id),
    file_size           BIGINT,
    chunk_count         INTEGER,
    storage_key         VARCHAR(255),
    storage_tier        VARCHAR(50)  NOT NULL DEFAULT 'HOT',
    archived_at         TIMESTAMP,
    created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);

-- ============================================================================
-- 5. risk_reports
-- ============================================================================
CREATE TABLE IF NOT EXISTS risk_reports (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    portfolio_id            UUID        NOT NULL REFERENCES portfolios(id),
    risk_score              INTEGER     NOT NULL,
    risk_level              VARCHAR(50) NOT NULL,
    summary                 TEXT,
    factors_json            JSONB,
    advice_json             JSONB,
    disclaimer              TEXT,
    regulatory_framework    VARCHAR(255),
    created_at              TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_reports_portfolio_id ON risk_reports(portfolio_id);

-- ============================================================================
-- 6. chat_messages
-- ============================================================================
CREATE TABLE IF NOT EXISTS chat_messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID        NOT NULL,
    session_id      UUID        NOT NULL,
    role            VARCHAR(20) NOT NULL,
    content         TEXT        NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);

-- ============================================================================
-- 7. news_items
-- ============================================================================
CREATE TABLE IF NOT EXISTS news_items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id       VARCHAR(200) NOT NULL,
    source          VARCHAR(50)  NOT NULL,
    title           VARCHAR(255) NOT NULL,
    summary         TEXT,
    article_url     VARCHAR(255),
    author          VARCHAR(255),
    published_at    TIMESTAMP WITH TIME ZONE NOT NULL,
    tickers         JSONB,
    tags            JSONB,
    sentiment       VARCHAR(255),
    enriched        BOOLEAN NOT NULL DEFAULT FALSE,
    document_id     UUID,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uk_news_source_source_id UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_news_published_at ON news_items(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_enriched ON news_items(enriched);

-- ============================================================================
-- 8. trade_wallets
-- ============================================================================
CREATE TABLE IF NOT EXISTS trade_wallets (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID          NOT NULL UNIQUE REFERENCES users(id),
    initial_capital     NUMERIC(15,2) NOT NULL DEFAULT 100000.00,
    cash_balance        NUMERIC(15,2) NOT NULL DEFAULT 100000.00,
    trading_mode        VARCHAR(10)   NOT NULL DEFAULT 'PAPER',
    positions           JSONB         DEFAULT '[]'::jsonb,
    commit_history      JSONB         DEFAULT '[]'::jsonb,
    created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_wallets_user_id ON trade_wallets(user_id);

-- ============================================================================
-- 9. user_investment_profiles
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_investment_profiles (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL UNIQUE REFERENCES users(id),
    working_memory      TEXT,
    risk_tolerance      VARCHAR(20),
    investment_horizon  VARCHAR(20),
    current_sentiment   VARCHAR(30),
    sentiment_reason    TEXT,
    preferences         JSONB DEFAULT '{}'::jsonb,
    state_history       JSONB DEFAULT '[]'::jsonb,
    created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_investment_profiles_user_id ON user_investment_profiles(user_id);

-- ============================================================================
-- 10. agent_brains
-- ============================================================================
CREATE TABLE IF NOT EXISTS agent_brains (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL UNIQUE REFERENCES users(id),
    frontal_lobe        TEXT NOT NULL DEFAULT '',
    emotion             VARCHAR(20) NOT NULL DEFAULT 'neutral',
    commit_history      JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_brains_user_id ON agent_brains(user_id);
