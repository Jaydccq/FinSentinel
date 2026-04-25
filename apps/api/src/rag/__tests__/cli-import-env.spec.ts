import { afterEach, describe, expect, it, vi } from 'vitest';

const REQUIRED_RUNTIME_ENV = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'OPENROUTER_API_KEY',
  'POLYGON_API_KEY',
] as const;

const originalEnv = new Map<string, string | undefined>(
  REQUIRED_RUNTIME_ENV.map((key) => [key, process.env[key]]),
);

function clearRuntimeEnv(): void {
  for (const key of REQUIRED_RUNTIME_ENV) {
    delete process.env[key];
  }
}

function restoreRuntimeEnv(): void {
  for (const [key, value] of originalEnv.entries()) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe('RAG CLI module imports', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    restoreRuntimeEnv();
  });

  it('do not bootstrap config or exit when helper modules are imported without runtime env', async () => {
    clearRuntimeEnv();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
      code?: string | number | null,
    ) => {
      throw new Error(`process.exit(${String(code)}) during CLI import`);
    }) as typeof process.exit);

    const cliModules = [
      () => import('../admin/rag-backfill-chunk-issuer-tickers.cli'),
      () => import('../admin/rag-backfill-representation-sparse.cli'),
      () => import('../admin/rag-backfill-representations.cli'),
      () => import('../admin/rag-reindex-by-doctype.cli'),
      () => import('../admin/rag-repr-reindex.cli'),
      () => import('../eval/golden-candidates.cli'),
      () => import('../eval/seed-fixture.cli'),
    ];

    for (const loadCliModule of cliModules) {
      await expect(loadCliModule()).resolves.toBeDefined();
    }

    expect(exitSpy).not.toHaveBeenCalled();
  });
});
