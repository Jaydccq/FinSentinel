import { describe, it, expect } from 'vitest';
import { envSchema, type EnvConfig } from '../env.validation';

/** Minimal valid config — only required fields, defaults fill the rest */
const validConfig = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a'.repeat(32),
  OPENROUTER_API_KEY: 'sk-or-test',
  POLYGON_API_KEY: 'test-key',
};

describe('envSchema', () => {
  // ── happy path ──────────────────────────────────────────────────────

  it('accepts valid complete config', () => {
    const result = envSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('applies default values', () => {
    const result = envSchema.parse(validConfig);
    expect(result.JWT_EXPIRATION).toBe(86400000);
    expect(result.AI_MODEL).toBe('google/gemini-3-flash-preview');
    expect(result.APP_AGENT_PERSONA).toBe('default');
    expect(result.APP_TRADING_DEFAULT_MODE).toBe('PAPER');
    expect(result.APP_CRYPTO_NEWS_ENABLED).toBe(false);
    expect(result.APP_TWITTER_6551_ENABLED).toBe(false);
    expect(result.APP_OKX_ENABLED).toBe(false);

    // Storage
    expect(result.STORAGE_PROVIDER).toBe('rustfs');
    expect(result.GOOGLE_DRIVE_APPLICATION_NAME).toBe('FinSentinel');

    // Alpaca
    expect(result.ALPACA_ENABLED).toBe(false);
    expect(result.ALPACA_BASE_URL).toBe('https://paper-api.alpaca.markets');

    // OKX extended
    expect(result.OKX_BASE_URL).toBe('https://www.okx.com');
    expect(result.OKX_WEBSOCKET_ENABLED).toBe(true);
    expect(result.OKX_RATE_LIMIT_PER_SECOND).toBe(10);

    // OpenBB / FMP / Yahoo
    expect(result.OPENBB_ENABLED).toBe(false);
    expect(result.OPENBB_BASE_URL).toBe('http://localhost:6900');
    expect(result.OPENBB_API_PREFIX).toBe('/api/v1');
    expect(result.FMP_ENABLED).toBe(false);
    expect(result.FMP_BASE_URL).toBe('https://financialmodelingprep.com/api/v3');
    expect(result.YAHOO_FINANCE_ENABLED).toBe(true);
    expect(result.YAHOO_FINANCE_BASE_URL).toBe('https://query1.finance.yahoo.com');

    // RAG
    expect(result.RAG_CHUNK_SIZE).toBe(500);
    expect(result.RAG_CHUNK_OVERLAP).toBe(50);
    expect(result.RAG_MIN_CHUNK_SIZE_CHARS).toBe(200);
    expect(result.RAG_MAX_NUM_CHUNKS).toBe(10000);
    expect(result.RAG_DEFAULT_TOP_K).toBe(5);
    expect(result.RAG_SIMILARITY_THRESHOLD).toBe(0.65);
    expect(result.RAG_MAX_TOP_K).toBe(20);
    expect(result.RAG_QUERY_REWRITE_ENABLED).toBe(true);
    expect(result.RAG_REINDEX_ENABLED).toBe(true);
    expect(result.RAG_REINDEX_INTERVAL_MS).toBe(900000);
    expect(result.RAG_REINDEX_STARTUP_DELAY_MS).toBe(30000);
    expect(result.RAG_REINDEX_DOCUMENT_BATCH_SIZE).toBe(25);
    expect(result.RAG_REINDEX_NEWS_BATCH_SIZE).toBe(25);
    expect(result.RAG_REINDEX_FORCE).toBe(false);

    // Archival
    expect(result.ARCHIVAL_ENABLED).toBe(false);
    expect(result.ARCHIVAL_RETENTION_DAYS).toBe(7);
    expect(result.ARCHIVAL_CRON).toBe('0 0 2 * * *');
    expect(result.ARCHIVAL_BATCH_SIZE).toBe(50);
    expect(result.NEWS_POLLING_ENABLED).toBe(true);
    expect(result.NEWS_POLL_INTERVAL_MS).toBe(300000);
    expect(result.NEWS_POLL_STARTUP_DELAY_MS).toBe(10000);

    // Chat compaction
    expect(result.CHAT_COMPACTION_ENABLED).toBe(true);
    expect(result.CHAT_COMPACTION_THRESHOLD).toBe(24);
    expect(result.CHAT_COMPACTION_RECENT_WINDOW).toBe(10);
    expect(result.CHAT_COMPACTION_MAX_SUMMARY_CHARS).toBe(1200);

    // Confirmation
    expect(result.CONFIRMATION_TRADE_THRESHOLD).toBe('10000');
    expect(result.CONFIRMATION_BLOCK_LIVE).toBe(true);

    // Firecrawl
    expect(result.FIRECRAWL_BASE_URL).toBe('https://api.firecrawl.dev/v2');

    // MCP
    expect(result.MCP_SERVER_ENABLED).toBe(false);

    // Market / Research
    expect(result.MARKET_DEFAULT_PROVIDER).toBe('polygon');
    expect(result.RESEARCH_DEFAULT_PROVIDER).toBe('polygon');

    // Analysis Runs
    expect(result.ANALYSIS_RUNS_ENABLED).toBe(false);

    // Chat Auto-Upgrade
    expect(result.CHAT_AUTO_UPGRADE_ENABLED).toBe(false);

    // Approval Auto-Dispatch
    expect(result.APPROVAL_AUTO_DISPATCH_ENABLED).toBe(false);
  });

  it('accepts valid complete config with all optional fields', () => {
    const result = envSchema.safeParse({
      ...validConfig,
      JWT_EXPIRATION: '3600000',
      AI_MODEL: 'anthropic/claude-4-sonnet',
      APP_AGENT_PERSONA: 'aggressive',
      APP_TRADING_DEFAULT_MODE: 'LIVE',
      ALPACA_API_KEY: 'ak-test',
      ALPACA_SECRET_KEY: 'sk-test',
      ALPACA_BASE_URL: 'https://paper-api.alpaca.markets',
      ALPACA_ENABLED: 'true',
      APP_CRYPTO_NEWS_ENABLED: 'true',
      CRYPTO_NEWS_6551_TOKEN: 'token-123',
      CRYPTO_NEWS_MIN_SCORE: '80',
      APP_TWITTER_6551_ENABLED: 'true',
      TWITTER_6551_TOKEN: 'token-456',
      APP_OKX_ENABLED: 'true',
      OKX_API_KEY: 'okx-key',
      OKX_SECRET_KEY: 'okx-secret',
      OKX_PASSPHRASE: 'okx-pass',
      OKX_BASE_URL: 'https://www.okx.com',
      OKX_SANDBOX: 'true',
      OKX_WEBSOCKET_ENABLED: 'true',
      OKX_WEBSOCKET_URL: 'wss://ws.okx.com:8443/ws/v5/public',
      OKX_WATCH_PAIRS: 'BTC-USDT,ETH-USDT',
      OKX_RATE_LIMIT_PER_SECOND: '20',
      // Storage
      STORAGE_PROVIDER: 'hybrid',
      STORAGE_ENDPOINT: 'https://s3.example.com',
      STORAGE_ACCESS_KEY: 'access-key',
      STORAGE_SECRET_KEY: 'secret-key',
      STORAGE_BUCKET: 'finsentinel',
      STORAGE_REGION: 'us-east-1',
      GOOGLE_DRIVE_CLIENT_ID: 'gd-client-id',
      GOOGLE_DRIVE_CLIENT_SECRET: 'gd-client-secret',
      GOOGLE_DRIVE_REFRESH_TOKEN: 'gd-refresh-token',
      GOOGLE_DRIVE_APPLICATION_NAME: 'FinSentinel',
      GOOGLE_DRIVE_ROOT_FOLDER_ID: 'gd-folder-id',
      // OpenBB / FMP / Yahoo
      OPENBB_ENABLED: 'true',
      OPENBB_BASE_URL: 'http://localhost:6900',
      OPENBB_API_PREFIX: '/api/v2',
      OPENBB_API_KEY: 'openbb-key',
      FMP_API_KEY: 'fmp-key',
      FMP_BASE_URL: 'https://financialmodelingprep.com/api/v3',
      FMP_ENABLED: 'true',
      YAHOO_FINANCE_BASE_URL: 'https://query1.finance.yahoo.com',
      YAHOO_FINANCE_ENABLED: 'true',
      // RAG
      RAG_CHUNK_SIZE: '1000',
      RAG_CHUNK_OVERLAP: '100',
      RAG_MIN_CHUNK_SIZE_CHARS: '300',
      RAG_MAX_NUM_CHUNKS: '5000',
      RAG_DEFAULT_TOP_K: '10',
      RAG_SIMILARITY_THRESHOLD: '0.7',
      RAG_MAX_TOP_K: '30',
      RAG_QUERY_REWRITE_ENABLED: 'false',
      RAG_REINDEX_ENABLED: 'true',
      RAG_REINDEX_INTERVAL_MS: '600000',
      RAG_REINDEX_STARTUP_DELAY_MS: '5000',
      RAG_REINDEX_DOCUMENT_BATCH_SIZE: '40',
      RAG_REINDEX_NEWS_BATCH_SIZE: '15',
      RAG_REINDEX_FORCE: 'true',
      // Archival
      ARCHIVAL_ENABLED: 'true',
      ARCHIVAL_RETENTION_DAYS: '14',
      ARCHIVAL_CRON: '0 0 3 * * *',
      ARCHIVAL_BATCH_SIZE: '100',
      NEWS_POLLING_ENABLED: 'false',
      NEWS_POLL_INTERVAL_MS: '900000',
      NEWS_POLL_STARTUP_DELAY_MS: '15000',
      // Chat
      CHAT_COMPACTION_ENABLED: 'true',
      CHAT_COMPACTION_THRESHOLD: '30',
      CHAT_COMPACTION_RECENT_WINDOW: '15',
      CHAT_COMPACTION_MAX_SUMMARY_CHARS: '2000',
      CONFIRMATION_TRADE_THRESHOLD: '50000',
      CONFIRMATION_BLOCK_LIVE: 'false',
      // Firecrawl
      FIRECRAWL_API_KEY: 'fc-key',
      FIRECRAWL_BASE_URL: 'https://api.firecrawl.dev/v2',
      // MCP
      MCP_SERVER_ENABLED: 'true',
      MCP_API_KEY: 'mcp-key',
      MCP_USER_ID: 'user-123',
      // Market / Research
      MARKET_DEFAULT_PROVIDER: 'fmp',
      RESEARCH_DEFAULT_PROVIDER: 'fmp',
      // Encryption
      ENCRYPTION_AES_KEY: 'dGVzdC1rZXktMzItYnl0ZXMtYmFzZTY0LWVuY29kZWQ=',
      // Analysis Runs
      ANALYSIS_RUNS_ENABLED: 'true',
      // Chat Auto-Upgrade
      CHAT_AUTO_UPGRADE_ENABLED: 'true',
      // Approval Auto-Dispatch
      APPROVAL_AUTO_DISPATCH_ENABLED: 'true',
    });
    expect(result.success).toBe(true);
  });

  // ── coercion ────────────────────────────────────────────────────────

  it('coerces string numbers to numbers', () => {
    const result = envSchema.parse({
      ...validConfig,
      JWT_EXPIRATION: '7200000',
    });
    expect(result.JWT_EXPIRATION).toBe(7200000);
  });

  it('coerces string booleans to booleans', () => {
    const result = envSchema.parse({
      ...validConfig,
      APP_CRYPTO_NEWS_ENABLED: 'true',
      APP_TWITTER_6551_ENABLED: 'false',
      APP_OKX_ENABLED: 'true',
      ALPACA_ENABLED: 'true',
      OPENBB_ENABLED: 'true',
      FMP_ENABLED: 'true',
      YAHOO_FINANCE_ENABLED: 'false',
      RAG_QUERY_REWRITE_ENABLED: 'false',
      RAG_REINDEX_ENABLED: 'false',
      RAG_REINDEX_FORCE: 'true',
      ARCHIVAL_ENABLED: 'true',
      NEWS_POLLING_ENABLED: 'false',
      CHAT_COMPACTION_ENABLED: 'false',
      CONFIRMATION_BLOCK_LIVE: 'false',
      MCP_SERVER_ENABLED: 'true',
      OKX_WEBSOCKET_ENABLED: 'false',
      ANALYSIS_RUNS_ENABLED: 'true',
      CHAT_AUTO_UPGRADE_ENABLED: 'false',
      APPROVAL_AUTO_DISPATCH_ENABLED: 'true',
    });
    expect(result.APP_CRYPTO_NEWS_ENABLED).toBe(true);
    expect(result.APP_TWITTER_6551_ENABLED).toBe(false);
    expect(result.APP_OKX_ENABLED).toBe(true);
    expect(result.ALPACA_ENABLED).toBe(true);
    expect(result.OPENBB_ENABLED).toBe(true);
    expect(result.FMP_ENABLED).toBe(true);
    expect(result.YAHOO_FINANCE_ENABLED).toBe(false);
    expect(result.RAG_QUERY_REWRITE_ENABLED).toBe(false);
    expect(result.RAG_REINDEX_ENABLED).toBe(false);
    expect(result.RAG_REINDEX_FORCE).toBe(true);
    expect(result.ARCHIVAL_ENABLED).toBe(true);
    expect(result.NEWS_POLLING_ENABLED).toBe(false);
    expect(result.CHAT_COMPACTION_ENABLED).toBe(false);
    expect(result.CONFIRMATION_BLOCK_LIVE).toBe(false);
    expect(result.MCP_SERVER_ENABLED).toBe(true);
    expect(result.OKX_WEBSOCKET_ENABLED).toBe(false);
    expect(result.ANALYSIS_RUNS_ENABLED).toBe(true);
    expect(result.CHAT_AUTO_UPGRADE_ENABLED).toBe(false);
    expect(result.APPROVAL_AUTO_DISPATCH_ENABLED).toBe(true);
  });

  it('coerces new string numbers to numbers', () => {
    const result = envSchema.parse({
      ...validConfig,
      RAG_CHUNK_SIZE: '1000',
      RAG_SIMILARITY_THRESHOLD: '0.8',
      RAG_REINDEX_INTERVAL_MS: '600000',
      RAG_REINDEX_DOCUMENT_BATCH_SIZE: '40',
      ARCHIVAL_RETENTION_DAYS: '14',
      CHAT_COMPACTION_THRESHOLD: '30',
      OKX_RATE_LIMIT_PER_SECOND: '20',
    });
    expect(result.RAG_CHUNK_SIZE).toBe(1000);
    expect(result.RAG_SIMILARITY_THRESHOLD).toBe(0.8);
    expect(result.RAG_REINDEX_INTERVAL_MS).toBe(600000);
    expect(result.RAG_REINDEX_DOCUMENT_BATCH_SIZE).toBe(40);
    expect(result.ARCHIVAL_RETENTION_DAYS).toBe(14);
    expect(result.CHAT_COMPACTION_THRESHOLD).toBe(30);
    expect(result.OKX_RATE_LIMIT_PER_SECOND).toBe(20);
  });

  // ── validation failures ─────────────────────────────────────────────

  it('rejects missing DATABASE_URL', () => {
    const { DATABASE_URL, ...rest } = validConfig;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing REDIS_URL', () => {
    const { REDIS_URL, ...rest } = validConfig;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects JWT_SECRET shorter than 32 chars', () => {
    const result = envSchema.safeParse({
      ...validConfig,
      JWT_SECRET: 'too-short',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing OPENROUTER_API_KEY', () => {
    const { OPENROUTER_API_KEY, ...rest } = validConfig;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing POLYGON_API_KEY', () => {
    const { POLYGON_API_KEY, ...rest } = validConfig;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects invalid DATABASE_URL format', () => {
    const result = envSchema.safeParse({
      ...validConfig,
      DATABASE_URL: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid REDIS_URL format', () => {
    const result = envSchema.safeParse({
      ...validConfig,
      REDIS_URL: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid APP_AGENT_PERSONA value', () => {
    const result = envSchema.safeParse({
      ...validConfig,
      APP_AGENT_PERSONA: 'invalid-persona',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid APP_TRADING_DEFAULT_MODE value', () => {
    const result = envSchema.safeParse({
      ...validConfig,
      APP_TRADING_DEFAULT_MODE: 'DEMO',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid STORAGE_PROVIDER value', () => {
    const result = envSchema.safeParse({
      ...validConfig,
      STORAGE_PROVIDER: 'invalid-provider',
    });
    expect(result.success).toBe(false);
  });

  // ── type inference ──────────────────────────────────────────────────

  it('produces correct TypeScript type shape', () => {
    const result = envSchema.parse(validConfig);

    // type-level check: EnvConfig should be assignable
    const _config: EnvConfig = result;

    // Spot-check key fields exist at runtime
    expect(typeof result.DATABASE_URL).toBe('string');
    expect(typeof result.JWT_EXPIRATION).toBe('number');
    expect(typeof result.APP_CRYPTO_NEWS_ENABLED).toBe('boolean');
  });
});
