/**
 * Integration test: AnalysisCheckpointService.startStage idempotency.
 *
 * Uses a real Postgres connection (postgres.js + Drizzle) so that the
 * ON CONFLICT DO UPDATE path is actually exercised — a mock cannot verify this.
 *
 * Requires a running Postgres with the analysis_* tables (V12 migration applied).
 * The test skips automatically when DATABASE_URL is not available.
 *
 * The service is instantiated directly (no NestJS DI) with a real db client
 * and a no-op AgentEventService stub.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '@finsentinel/db';
import { users, analysisStages, analysisRuns } from '@finsentinel/db';
import { AnalysisCheckpointService } from '../analysis-checkpoint.service';

// ── DB URL ────────────────────────────────────────────────────────────────────
// Vitest does not load .env automatically; fall back to the known local URL so
// the test runs when DATABASE_URL is not explicitly exported in the shell.
const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:123456@localhost:5432/finsentinel';

// Test user ID generated per test run — no pre-seeded data required.
let testUserId: string;

// ── Skip guard ────────────────────────────────────────────────────────────────
// Skip when Postgres is definitely unavailable:
//   - explicit opt-out: CI_SKIP_DB_TESTS=1
//   - CI without DATABASE_URL: auto-skip so GitHub Actions doesn't fail on the
//     hardcoded fallback URL. When CI adds a Postgres service container and
//     exports DATABASE_URL, these tests will run automatically.
// Local dev still uses the fallback URL above.
const skipDbTests =
  process.env['CI_SKIP_DB_TESTS'] === '1' ||
  (process.env['CI'] === 'true' && !process.env['DATABASE_URL']);
const maybeDescribe = skipDbTests ? describe.skip : describe;

// ── Test suite ────────────────────────────────────────────────────────────────
maybeDescribe('AnalysisCheckpointService.startStage (idempotent)', () => {
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let svc: AnalysisCheckpointService;
  let runId: string;

  beforeAll(async () => {
    client = postgres(DB_URL, { max: 3 });
    db = drizzle(client, { schema });

    // Stub AgentEventService — startStage does not call it.
    const stubEvents = { append: async () => ({ id: 'stub' }) } as never;
    svc = new AnalysisCheckpointService(db as never, stubEvents);

    // Self-seed a test user so this spec has no dependency on pre-existing DB state.
    testUserId = randomUUID();
    await db.insert(users).values({
      id: testUserId,
      username: `ts-${testUserId.slice(0, 8)}`,
      email: `test-startstage-${testUserId}@finsentinel.test`,
      password: 'test-placeholder-not-used',
      displayName: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, testUserId));
    await client.end();
  });

  beforeEach(async () => {
    runId = randomUUID();
    // Insert a parent analysis_run row. Supply all non-nullable columns explicitly
    // (avoids the Drizzle+postgres.js mixed-default bind bug documented in the
    // service file comments).
    await db.insert(analysisRuns).values({
      id: runId,
      userId: testUserId,
      sourceMode: 'CHAT',
      status: 'QUEUED',
      inputSnapshotJson: {},
      currentStageKey: null,
      complexityScore: null,
      upgradeReason: null,
      parentChatSessionId: null,
      sharedContextJson: null,
      decisionObjectJson: null,
      finalReportMarkdown: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
      archivedAt: null,
    });
  });

  afterEach(async () => {
    await db.delete(analysisStages).where(eq(analysisStages.runId, runId));
    await db.delete(analysisRuns).where(eq(analysisRuns.id, runId));
  });

  it('second call with same (runId, stageKey) does not throw', async () => {
    await svc.startStage(runId, 'INTELLIGENCE');
    await expect(svc.startStage(runId, 'INTELLIGENCE')).resolves.not.toThrow();
  });

  it('second call leaves exactly one row and bumps checkpoint_version', async () => {
    await svc.startStage(runId, 'INTELLIGENCE');
    await svc.startStage(runId, 'INTELLIGENCE');

    const rows = await db.select().from(analysisStages).where(eq(analysisStages.runId, runId));

    expect(rows).toHaveLength(1);
    expect(rows[0].checkpointVersion).toBeGreaterThanOrEqual(1);
    expect(rows[0].status).toBe('RUNNING');
    expect(rows[0].errorJson).toBeNull();
  });
});
