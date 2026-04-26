import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// Each CLI is a heavy transitive-import surface (NestFactory + decorators +
// drizzle + bullmq + ai-runtime). Per-import wall clock under full-suite
// worker load measured at 5–6.6s — exceeds vitest's default 5s testTimeout.
// Splitting into per-module cases gives each CLI its own budget AND points
// the failure at the exact module if a regression ever lands; the bumped
// 15s per-case timeout absorbs the transitive-import cost without hiding a
// real hang (the longest observed import is 6.6s and isolated runs finish
// in <1s — so 15s is "twice the worst observed plus headroom").
const CLI_MODULES: ReadonlyArray<readonly [name: string, load: () => Promise<unknown>]> = [
  ['admin/rag-backfill-chunk-issuer-tickers', () => import('../admin/rag-backfill-chunk-issuer-tickers.cli')],
  ['admin/rag-backfill-representation-sparse', () => import('../admin/rag-backfill-representation-sparse.cli')],
  ['admin/rag-backfill-representations', () => import('../admin/rag-backfill-representations.cli')],
  ['admin/rag-reindex-by-doctype', () => import('../admin/rag-reindex-by-doctype.cli')],
  ['admin/rag-repr-reindex', () => import('../admin/rag-repr-reindex.cli')],
  ['eval/golden-candidates', () => import('../eval/golden-candidates.cli')],
  ['eval/seed-fixture', () => import('../eval/seed-fixture.cli')],
];

describe('RAG CLI module imports', () => {
  let exitSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    clearRuntimeEnv();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
      code?: string | number | null,
    ) => {
      throw new Error(`process.exit(${String(code)}) during CLI import`);
    }) as typeof process.exit);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreRuntimeEnv();
  });

  it.each(CLI_MODULES)(
    'imports %s without bootstrapping config or calling process.exit',
    async (_name, loadCliModule) => {
      await expect(loadCliModule()).resolves.toBeDefined();
      expect(exitSpy).not.toHaveBeenCalled();
    },
    15_000,
  );
});
