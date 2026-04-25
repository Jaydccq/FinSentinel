import { z } from 'zod';
import {
  AI_PROVIDERS,
  DEFAULT_NVIDIA_EMBEDDING_MODEL,
  DEFAULT_OPENROUTER_EMBEDDING_MODEL,
  DEFAULT_OPENROUTER_TEXT_MODEL,
  type AiProvider,
} from '@finsentinel/ai-runtime';

/**
 * Custom boolean coercion that correctly handles env-var strings.
 * `z.coerce.boolean()` treats any non-empty string (including "false") as true,
 * so we need explicit string→boolean mapping.
 */
const envBoolean = z
  .union([z.boolean(), z.string()])
  .transform((val) => {
    if (typeof val === 'boolean') return val;
    return val === 'true' || val === '1';
  });

const aiProvider = z.enum(AI_PROVIDERS);
const optionalEnvString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().optional(),
);
const optionalAiProvider = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  aiProvider.optional(),
);

function hasValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function addMissingKeyIssue(
  ctx: z.RefinementCtx,
  key: 'OPENROUTER_API_KEY' | 'NVIDIA_API_KEY',
  provider: AiProvider,
  use: 'text' | 'embedding',
) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [key],
    message: `${key} is required when ${use} AI provider is ${provider}`,
  });
}

const baseEnvSchema = z.object({
  // ── Database ──────────────────────────────────────────────────────
  DATABASE_URL: z.string().url(),

  // ── Redis ─────────────────────────────────────────────────────────
  REDIS_URL: z.string().url(),

  // ── JWT ───────────────────────────────────────────────────────────
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRATION: z.coerce.number().default(86400000),
  // Optional issuer/audience claims. Defaults applied in jwt.config.ts so that
  // an unset env still produces tokens with the standard iss/aud values —
  // existing tokens without iss/aud will fail validation by design (forces
  // re-login as part of the security hardening).
  JWT_ISSUER: z.string().optional(),
  JWT_AUDIENCE: z.string().optional(),

  // ── AI / LLM ─────────────────────────────────────────────────────
  AI_PROVIDER: aiProvider.default('openrouter'),
  AI_EMBEDDING_PROVIDER: optionalAiProvider,
  OPENROUTER_API_KEY: optionalEnvString,
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  NVIDIA_API_KEY: optionalEnvString,
  NVIDIA_BASE_URL: z.string().url().default('https://integrate.api.nvidia.com/v1'),
  AI_MODEL: optionalEnvString,
  AI_EMBEDDING_MODEL: optionalEnvString,

  // ── Market Data ──────────────────────────────────────────────────
  POLYGON_API_KEY: z.string().min(1),

  // ── Trading ──────────────────────────────────────────────────────
  APP_TRADING_DEFAULT_MODE: z
    .enum(['PAPER', 'LIVE'])
    .default('PAPER'),

  // Alpaca (optional — US equities broker)
  ALPACA_API_KEY: z.string().optional(),
  ALPACA_SECRET_KEY: z.string().optional(),
  ALPACA_BASE_URL: z.string().url().default('https://paper-api.alpaca.markets'),
  ALPACA_ENABLED: envBoolean.default(false),

  // ── Persona ──────────────────────────────────────────────────────
  APP_AGENT_PERSONA: z
    .enum(['default', 'conservative', 'aggressive'])
    .default('default'),

  // ── Optional: 6551.io Crypto News ─────────────────────────────────
  APP_CRYPTO_NEWS_ENABLED: envBoolean.default(false),
  CRYPTO_NEWS_6551_TOKEN: z.string().optional(),
  CRYPTO_NEWS_MIN_SCORE: z.coerce.number().default(70),

  // ── Optional: 6551.io Twitter ─────────────────────────────────────
  APP_TWITTER_6551_ENABLED: envBoolean.default(false),
  TWITTER_6551_TOKEN: z.string().optional(),
  TWITTER_6551_BASE_URL: z.string().url().default('https://api.6551.io'),

  // ── Optional: OKX Exchange ────────────────────────────────────────
  APP_OKX_ENABLED: envBoolean.default(false),
  OKX_API_KEY: z.string().optional(),
  OKX_SECRET_KEY: z.string().optional(),
  OKX_PASSPHRASE: z.string().optional(),
  OKX_BASE_URL: z.string().url().default('https://www.okx.com'),
  OKX_SANDBOX: envBoolean.default(false),
  OKX_WEBSOCKET_ENABLED: envBoolean.default(true),
  OKX_WEBSOCKET_URL: z.string().optional(),
  OKX_WATCH_PAIRS: z.string().optional(),
  OKX_RATE_LIMIT_PER_SECOND: z.coerce.number().default(10),

  // ── Storage ──────────────────────────────────────────────────────
  STORAGE_PROVIDER: z
    .enum(['rustfs', 'google-drive', 'hybrid'])
    .default('rustfs'),
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_ACCESS_KEY: z.string().optional(),
  STORAGE_SECRET_KEY: z.string().optional(),
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_REGION: z.string().optional(),

  // ── Google Drive (optional cold archival tier) ────────────────────
  GOOGLE_DRIVE_CLIENT_ID: z.string().optional(),
  GOOGLE_DRIVE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_DRIVE_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_DRIVE_APPLICATION_NAME: z.string().default('FinSentinel'),
  GOOGLE_DRIVE_ROOT_FOLDER_ID: z.string().optional(),

  // ── Optional: OpenBB ──────────────────────────────────────────────
  OPENBB_ENABLED: envBoolean.default(false),
  OPENBB_BASE_URL: z.string().url().default('http://localhost:6900'),
  OPENBB_API_PREFIX: z.string().default('/api/v1'),
  OPENBB_API_KEY: z.string().optional(),

  // ── Optional: FMP (Financial Modeling Prep) ───────────────────────
  FMP_API_KEY: z.string().optional(),
  FMP_BASE_URL: z.string().url().default('https://financialmodelingprep.com/api/v3'),
  FMP_ENABLED: envBoolean.default(false),

  // ── Yahoo Finance ─────────────────────────────────────────────────
  YAHOO_FINANCE_BASE_URL: z.string().url().default('https://query1.finance.yahoo.com'),
  YAHOO_FINANCE_ENABLED: envBoolean.default(true),

  // ── RAG Chunking ──────────────────────────────────────────────────
  RAG_CHUNK_SIZE: z.coerce.number().default(500),
  RAG_CHUNK_OVERLAP: z.coerce.number().default(50),
  RAG_MIN_CHUNK_SIZE_CHARS: z.coerce.number().default(200),
  RAG_MAX_NUM_CHUNKS: z.coerce.number().default(10000),

  // ── RAG Retrieval ─────────────────────────────────────────────────
  RAG_DEFAULT_TOP_K: z.coerce.number().default(5),
  RAG_SIMILARITY_THRESHOLD: z.coerce.number().default(0.65),
  RAG_MAX_TOP_K: z.coerce.number().default(20),
  RAG_QUERY_REWRITE_ENABLED: envBoolean.default(true),
  RAG_REINDEX_ENABLED: envBoolean.default(true),
  RAG_REINDEX_INTERVAL_MS: z.coerce.number().default(900000),
  RAG_REINDEX_STARTUP_DELAY_MS: z.coerce.number().default(30000),
  RAG_REINDEX_DOCUMENT_BATCH_SIZE: z.coerce.number().default(25),
  RAG_REINDEX_NEWS_BATCH_SIZE: z.coerce.number().default(25),
  RAG_REINDEX_FORCE: envBoolean.default(false),

  // ── Archival ──────────────────────────────────────────────────────
  ARCHIVAL_ENABLED: envBoolean.default(false),
  ARCHIVAL_RETENTION_DAYS: z.coerce.number().default(7),
  ARCHIVAL_CRON: z.string().default('0 0 2 * * *'),
  ARCHIVAL_BATCH_SIZE: z.coerce.number().default(50),

  // ── News Polling ──────────────────────────────────────────────────
  NEWS_POLLING_ENABLED: envBoolean.default(true),
  NEWS_POLL_INTERVAL_MS: z.coerce.number().default(300000),
  NEWS_POLL_STARTUP_DELAY_MS: z.coerce.number().default(10000),

  // ── Chat Compaction ───────────────────────────────────────────────
  CHAT_COMPACTION_ENABLED: envBoolean.default(true),
  CHAT_COMPACTION_THRESHOLD: z.coerce.number().default(24),
  CHAT_COMPACTION_RECENT_WINDOW: z.coerce.number().default(10),
  CHAT_COMPACTION_MAX_SUMMARY_CHARS: z.coerce.number().default(1200),

  // ── Confirmation ──────────────────────────────────────────────────
  CONFIRMATION_TRADE_THRESHOLD: z.string().default('10000'),
  CONFIRMATION_BLOCK_LIVE: envBoolean.default(true),

  // ── Firecrawl ─────────────────────────────────────────────────────
  FIRECRAWL_API_KEY: z.string().optional(),
  FIRECRAWL_BASE_URL: z.string().url().default('https://api.firecrawl.dev/v2'),

  // ── MCP Server ────────────────────────────────────────────────────
  MCP_SERVER_ENABLED: envBoolean.default(false),
  MCP_API_KEY: z.string().optional(),
  MCP_USER_ID: z.string().optional(),

  // ── Market / Research Providers ───────────────────────────────────
  MARKET_DEFAULT_PROVIDER: z.string().default('polygon'),
  RESEARCH_DEFAULT_PROVIDER: z.string().default('polygon'),

  // ── Encryption ────────────────────────────────────────────────────
  ENCRYPTION_AES_KEY: z.string().optional(),

  // ── Single-user seed (desktop mode) ───────────────────────────────
  // When APP_SEED_LOCAL_USER=true, the API ensures a `local` user
  // exists at startup so desktop/dev clients can auto-login without
  // going through a registration flow. Intended for single-machine
  // desktop deployments; DO NOT enable in multi-tenant production.
  APP_SEED_LOCAL_USER: envBoolean.default(false),
  LOCAL_USER_USERNAME: z.string().default('local'),
  LOCAL_USER_PASSWORD: z.string().optional(),
  LOCAL_USER_EMAIL: z.string().default('local@finsentinel.local'),

  // ── Analysis Runs ────────────────────────────────────────────────────
  ANALYSIS_RUNS_ENABLED: envBoolean.default(false),

  // ── Chat Auto-Upgrade ───────────────────────────────────────────────
  CHAT_AUTO_UPGRADE_ENABLED: envBoolean.default(false),

  // ── Approval Auto-Dispatch ───────────────────────────────────────────
  APPROVAL_AUTO_DISPATCH_ENABLED: envBoolean.default(false),

  // ── Server ────────────────────────────────────────────────────────
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
});

/**
 * Zod schema that validates ALL environment variables at application startup.
 *
 * Required fields fail fast if missing; optional subsystems (crypto news,
 * twitter, OKX) are gated by boolean feature flags that default to false.
 *
 * String→number / string→boolean coercion handles the fact that process.env
 * values are always strings.
 */
export const envSchema = baseEnvSchema
  .superRefine((value, ctx) => {
    const textProvider = value.AI_PROVIDER;
    const embeddingProvider = value.AI_EMBEDDING_PROVIDER ?? textProvider;

    if (textProvider === 'openrouter' && !hasValue(value.OPENROUTER_API_KEY)) {
      addMissingKeyIssue(ctx, 'OPENROUTER_API_KEY', textProvider, 'text');
    }
    if (textProvider === 'nvidia' && !hasValue(value.NVIDIA_API_KEY)) {
      addMissingKeyIssue(ctx, 'NVIDIA_API_KEY', textProvider, 'text');
    }
    if (embeddingProvider === 'openrouter' && !hasValue(value.OPENROUTER_API_KEY)) {
      addMissingKeyIssue(ctx, 'OPENROUTER_API_KEY', embeddingProvider, 'embedding');
    }
    if (embeddingProvider === 'nvidia' && !hasValue(value.NVIDIA_API_KEY)) {
      addMissingKeyIssue(ctx, 'NVIDIA_API_KEY', embeddingProvider, 'embedding');
    }
    if (textProvider === 'nvidia' && !hasValue(value.AI_MODEL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AI_MODEL'],
        message: 'AI_MODEL is required when AI_PROVIDER is nvidia',
      });
    }
  })
  .transform((value) => {
    const embeddingProvider = value.AI_EMBEDDING_PROVIDER ?? value.AI_PROVIDER;

    return {
      ...value,
      AI_MODEL: value.AI_MODEL ?? DEFAULT_OPENROUTER_TEXT_MODEL,
      AI_EMBEDDING_PROVIDER: embeddingProvider,
      AI_EMBEDDING_MODEL:
        value.AI_EMBEDDING_MODEL ??
        (embeddingProvider === 'nvidia'
          ? DEFAULT_NVIDIA_EMBEDDING_MODEL
          : DEFAULT_OPENROUTER_EMBEDDING_MODEL),
    };
  });

/** Inferred TypeScript type for the validated environment. */
export type EnvConfig = z.infer<typeof envSchema>;
