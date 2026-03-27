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
      APP_CRYPTO_NEWS_ENABLED: 'true',
      CRYPTO_NEWS_6551_TOKEN: 'token-123',
      CRYPTO_NEWS_MIN_SCORE: '80',
      APP_TWITTER_6551_ENABLED: 'true',
      TWITTER_6551_TOKEN: 'token-456',
      APP_OKX_ENABLED: 'true',
      OKX_API_KEY: 'okx-key',
      OKX_SECRET_KEY: 'okx-secret',
      OKX_PASSPHRASE: 'okx-pass',
      OKX_SANDBOX: 'true',
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
    });
    expect(result.APP_CRYPTO_NEWS_ENABLED).toBe(true);
    expect(result.APP_TWITTER_6551_ENABLED).toBe(false);
    expect(result.APP_OKX_ENABLED).toBe(true);
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
