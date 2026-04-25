export * from './schema';

// Re-export drizzle query helpers to ensure consumers use the same drizzle-orm instance.
// This prevents "two copies of drizzle-orm" type mismatches in monorepo setups.
export {
  eq,
  and,
  or,
  ne,
  gt,
  gte,
  lt,
  lte,
  like,
  ilike,
  inArray,
  notInArray,
  isNull,
  isNotNull,
  sql,
  desc,
  asc,
} from 'drizzle-orm';

// Canonical Drizzle database type for dependency injection across the API.
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from './schema';
export type DrizzleDB = PostgresJsDatabase<typeof schema>;
