import { z } from 'zod';

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

/**
 * Zod schema that validates ALL environment variables at application startup.
 *
 * Required fields fail fast if missing; optional subsystems (crypto news,
 * twitter, OKX) are gated by boolean feature flags that default to false.
 *
 * String→number / string→boolean coercion handles the fact that process.env
 * values are always strings.
 */
export const envSchema = z.object({
  // ── Database ──────────────────────────────────────────────────────
  DATABASE_URL: z.string().url(),

  // ── Redis ─────────────────────────────────────────────────────────
  REDIS_URL: z.string().url(),

  // ── JWT ───────────────────────────────────────────────────────────
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRATION: z.coerce.number().default(86400000),

  // ── AI / LLM ─────────────────────────────────────────────────────
  OPENROUTER_API_KEY: z.string().min(1),
  AI_MODEL: z.string().default('google/gemini-3-flash-preview'),

  // ── Market Data ──────────────────────────────────────────────────
  POLYGON_API_KEY: z.string().min(1),

  // ── Trading ──────────────────────────────────────────────────────
  APP_TRADING_DEFAULT_MODE: z
    .enum(['PAPER', 'LIVE'])
    .default('PAPER'),

  // Alpaca (optional — US equities broker)
  ALPACA_API_KEY: z.string().optional(),
  ALPACA_SECRET_KEY: z.string().optional(),
  ALPACA_BASE_URL: z.string().url().optional(),

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

  // ── Optional: OKX Exchange ────────────────────────────────────────
  APP_OKX_ENABLED: envBoolean.default(false),
  OKX_API_KEY: z.string().optional(),
  OKX_SECRET_KEY: z.string().optional(),
  OKX_PASSPHRASE: z.string().optional(),
  OKX_SANDBOX: envBoolean.default(false),

  // ── Server ────────────────────────────────────────────────────────
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
});

/** Inferred TypeScript type for the validated environment. */
export type EnvConfig = z.infer<typeof envSchema>;
