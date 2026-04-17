/* eslint-disable no-console */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

export interface MigrationFile {
  version: number;
  filename: string;
}

const _dirname =
  typeof __dirname !== 'undefined'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));

const MIGRATIONS_DIR = resolve(_dirname, '../migrations');
const FILENAME_RE = /^V(\d+)__[A-Za-z0-9_]+\.sql$/;

export function parseMigrationFilename(filename: string): MigrationFile {
  const match = FILENAME_RE.exec(filename);
  if (!match) {
    throw new Error(`Invalid migration filename: ${filename} (expected V<N>__<slug>.sql)`);
  }
  return { version: Number(match[1]), filename };
}

export function listAllMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .map(parseMigrationFilename)
    .sort((a, b) => a.version - b.version);
}

export function listPendingMigrations(
  all: MigrationFile[],
  applied: Set<number>,
): MigrationFile[] {
  return all.filter(m => !applied.has(m.version));
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

async function ensureSchemaVersionsTable(sql: postgres.Sql): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'schema_versions'
    ) AS exists
  `;
  return rows[0]!.exists;
}

async function fetchAppliedVersions(sql: postgres.Sql): Promise<Set<number>> {
  const rows = await sql<{ version: number }[]>`SELECT version FROM schema_versions`;
  return new Set(rows.map(r => r.version));
}

async function applyOne(sql: postgres.Sql, mig: MigrationFile): Promise<void> {
  const path = join(MIGRATIONS_DIR, mig.filename);
  const body = readFileSync(path, 'utf8');
  const sum = checksum(body);
  console.log(`[migrate] applying ${mig.filename} (sha256=${sum.slice(0, 12)}...)`);
  await sql.begin(async trx => {
    await trx.unsafe(body);
    await trx`
      INSERT INTO schema_versions (version, filename, checksum)
      VALUES (${mig.version}, ${mig.filename}, ${sum})
    `;
  });
  console.log(`[migrate] ok ${mig.filename}`);
}

export async function runMigrations(opts: { bootstrapFrom?: number } = {}): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  const sql = postgres(url, { max: 1 });
  try {
    const all = listAllMigrations();
    const hasTable = await ensureSchemaVersionsTable(sql);

    if (!hasTable) {
      const v13 = all.find(m => m.version === 13);
      if (!v13) throw new Error('V13 migration (schema_versions) not found');
      console.log('[migrate] schema_versions missing — bootstrapping with V13');
      const v13Body = readFileSync(join(MIGRATIONS_DIR, v13.filename), 'utf8');
      await sql.unsafe(v13Body);
      // schema_versions now exists; self-record V13 so the main loop skips it.
      await sql`
        INSERT INTO schema_versions (version, filename, checksum)
        VALUES (${v13.version}, ${v13.filename}, ${checksum(v13Body)})
        ON CONFLICT (version) DO NOTHING
      `;
    }

    if (opts.bootstrapFrom !== undefined) {
      console.log(`[migrate] bootstrap: marking V1..V${opts.bootstrapFrom} as applied`);
      for (const m of all.filter(x => x.version <= opts.bootstrapFrom!)) {
        const body = readFileSync(join(MIGRATIONS_DIR, m.filename), 'utf8');
        await sql`
          INSERT INTO schema_versions (version, filename, checksum)
          VALUES (${m.version}, ${m.filename}, ${checksum(body)})
          ON CONFLICT (version) DO NOTHING
        `;
      }
    }

    const applied = await fetchAppliedVersions(sql);
    const pending = listPendingMigrations(all, applied);

    if (pending.length === 0) {
      console.log('[migrate] nothing to apply');
      return;
    }

    for (const m of pending) {
      await applyOne(sql, m);
    }
    console.log(`[migrate] done: ${pending.length} applied`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function printStatus(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  const sql = postgres(url, { max: 1 });
  try {
    const all = listAllMigrations();
    const hasTable = await ensureSchemaVersionsTable(sql);
    const applied = hasTable ? await fetchAppliedVersions(sql) : new Set<number>();
    for (const m of all) {
      const status = applied.has(m.version) ? 'APPLIED' : 'PENDING';
      console.log(`  ${status.padEnd(8)} V${m.version} ${m.filename}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (require.main === module) {
  const arg = process.argv[2];
  const bootstrapArg = process.argv.find(a => a.startsWith('--bootstrap-from='));
  let bootstrapFrom: number | undefined;
  if (bootstrapArg !== undefined) {
    const raw = bootstrapArg.split('=')[1];
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
      console.error(`[migrate] --bootstrap-from requires a positive integer; got: ${JSON.stringify(raw)}`);
      process.exit(1);
    }
    bootstrapFrom = n;
  }
  const cmd = arg === 'status' ? printStatus() : runMigrations({ bootstrapFrom });
  cmd.catch(err => {
    console.error('[migrate] FAILED:', err);
    process.exit(1);
  });
}
