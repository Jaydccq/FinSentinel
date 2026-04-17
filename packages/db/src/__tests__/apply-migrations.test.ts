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

  it('listPendingMigrations sorts by version ascending and excludes applied', () => {
    const all = [
      { version: 3, filename: 'V3__x.sql' },
      { version: 12, filename: 'V12__y.sql' },
      { version: 1, filename: 'V1__z.sql' },
    ];
    const applied = new Set([1, 3]);
    const pending = listPendingMigrations(all, applied);
    expect(pending.map(m => m.version)).toEqual([12]);
  });
});
