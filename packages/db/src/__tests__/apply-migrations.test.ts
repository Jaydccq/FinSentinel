import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseMigrationFilename, listPendingMigrations } from '../apply-migrations';

describe('apply-migrations', () => {
  it('parses V-prefixed filenames into version + slug', () => {
    const parsed = parseMigrationFilename('V12__extend_agent_events_check.sql');
    expect(parsed).toEqual({ version: 12, filename: 'V12__extend_agent_events_check.sql' });
  });

  it('rejects non-V-prefixed filenames', () => {
    expect(() => parseMigrationFilename('0000_little_sharon_carter.sql')).toThrow();
  });

  it('listPendingMigrations excludes already-applied versions', () => {
    const all = [
      { version: 3, filename: 'V3__x.sql' },
      { version: 12, filename: 'V12__y.sql' },
      { version: 1, filename: 'V1__z.sql' },
    ];
    const applied = new Set([1, 3]);
    const pending = listPendingMigrations(all, applied);
    expect(pending.map(m => m.version)).toEqual([12]);
  });

  it('V16 migration file contains a ROLLBACK block', () => {
    const migrationsDir = join(__dirname, '../../migrations');
    const sql = readFileSync(
      join(migrationsDir, 'V16__add_rag_chunk_representations.sql'),
      'utf8',
    );
    expect(sql).toContain('-- ROLLBACK:');
    expect(sql).toContain('DROP TABLE IF EXISTS document_chunk_representations');
  });

  it('V17 migration file contains a ROLLBACK block and DROP TABLE for rag_query_logs', () => {
    const migrationsDir = join(__dirname, '../../migrations');
    const sql = readFileSync(
      join(migrationsDir, 'V17__add_rag_query_logs.sql'),
      'utf8',
    );
    expect(sql).toContain('-- ROLLBACK:');
    expect(sql).toContain('DROP TABLE IF EXISTS rag_query_logs');
  });
});
