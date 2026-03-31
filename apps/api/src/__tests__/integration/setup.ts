/**
 * Integration test setup — sets environment variables before any NestJS
 * modules are compiled. This file is loaded by vitest before each test file.
 */

// These env vars satisfy the Zod schema validation in ConfigModule.forRoot()
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
process.env['REDIS_URL'] = 'redis://localhost:6379/0';
process.env['JWT_SECRET'] = 'test-secret-key-that-is-at-least-32-chars-long!!';
process.env['JWT_EXPIRATION'] = '86400000';
process.env['OPENROUTER_API_KEY'] = 'test-openrouter-key';
process.env['AI_MODEL'] = 'test/model';
process.env['POLYGON_API_KEY'] = 'test-polygon-key';
process.env['APP_TRADING_DEFAULT_MODE'] = 'PAPER';
process.env['APP_AGENT_PERSONA'] = 'default';
process.env['APP_CRYPTO_NEWS_ENABLED'] = 'false';
process.env['APP_TWITTER_6551_ENABLED'] = 'false';
process.env['APP_OKX_ENABLED'] = 'false';
process.env['NODE_ENV'] = 'test';
process.env['PORT'] = '0';
