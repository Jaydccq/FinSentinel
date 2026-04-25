/**
 * rag-promote-eval.service.ts
 *
 * Pure helpers for the RAG eval-label promotion CLI. Reads a window of
 * `rag_query_logs` rows (out-of-band, supplied by the caller — see
 * `rag-promote-eval.cli.ts` for the DB read path), stratifies by
 * `query_class`, redacts PII, and emits rows that match the golden-set
 * schema in `services/evaluation-runner/datasets/golden.json`.
 *
 * Schema mapping (real `rag_query_logs` columns):
 *   id              -> source_query_log_id
 *   query_preview   -> query (after PII redaction)
 *   query_class     -> query_class
 *   result_chunk_ids -> expected_chunk_ids
 *
 * NOTE: `query_preview` is only populated when `rag.queryLog.piiEnabled = true`
 * at trace time. The CLI surfaces a clear error if every row in the window has
 * a NULL preview; operators must enable the flag for the target window before
 * promotion is meaningful.
 *
 * This module is dependency-free (no Nest, no Drizzle, no IO) so it is trivial
 * to unit-test. The CLI binds it to a real DB via Drizzle.
 */

// ── Public types ──────────────────────────────────────────────────────────────

export interface QueryLogRow {
  id: string;
  query_preview?: string | null;
  query_class: string;
  result_chunk_ids?: string[];
  user_id?: string | null;
  created_at?: string;
}

export interface SampleOptions {
  perClass: number;
  seed?: number;
}

export interface PromotedRow {
  id: string;
  query: string;
  query_class: string;
  expected_chunk_ids: string[];
  acceptable_chunk_ids: string[];
  expected_source_docs: string[];
  expected_answer: string;
  expected_entities: string[];
  difficulty: string;
  tags: string[];
  provenance_label: 'real_user_promoted';
  source_query_log_id: string;
  promoted_at: string;
  redactions_applied: string[];
}

// ── Stratified sampler ────────────────────────────────────────────────────────

/**
 * Take up to `perClass` rows from each `query_class` bucket. Order preserved
 * within a class (caller controls shuffling / time ordering upstream so the
 * sampler stays deterministic and trivially testable).
 */
export function stratifiedSample(rows: QueryLogRow[], opts: SampleOptions): QueryLogRow[] {
  const buckets = new Map<string, QueryLogRow[]>();
  for (const r of rows) {
    const arr = buckets.get(r.query_class) ?? [];
    arr.push(r);
    buckets.set(r.query_class, arr);
  }
  const out: QueryLogRow[] = [];
  for (const [, arr] of buckets) {
    out.push(...arr.slice(0, opts.perClass));
  }
  return out;
}

// ── PII redaction ─────────────────────────────────────────────────────────────

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Matches common API-key prefixes (sk-, pk-, ghp-, nvapi-) followed by
// >=16 alnum/-_ chars. Keeps the regex intentionally narrow so it does
// not accidentally swallow ticker symbols or normal text.
const APIKEY = /\b(sk|pk|ghp|nvapi)[-_][A-Z0-9_-]{16,}/gi;
// Phone numbers: optional +, then >=8 digits with allowed separators.
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/g;

export interface RedactionResult {
  text: string;
  applied: string[];
}

export function redactPiiWithReport(input: string): RedactionResult {
  const applied: string[] = [];
  let text = input;
  if (EMAIL.test(text)) applied.push('email');
  EMAIL.lastIndex = 0;
  text = text.replace(EMAIL, '[redacted-email]');

  if (APIKEY.test(text)) applied.push('api_key');
  APIKEY.lastIndex = 0;
  text = text.replace(APIKEY, '[redacted-token]');

  if (PHONE.test(text)) applied.push('phone');
  PHONE.lastIndex = 0;
  text = text.replace(PHONE, '[redacted-phone]');

  return { text, applied };
}

export function redactPii(input: string): string {
  return redactPiiWithReport(input).text;
}

// ── Promoted-row builder ──────────────────────────────────────────────────────

export interface BuildPromotedRowContext {
  promotedAt: string;
}

/**
 * Build a golden-set-shaped row from a single query log. Mirrors the field
 * names actually used by `services/evaluation-runner/datasets/golden.json`
 * (verified 2026-04-25 against entry gs-001).
 *
 * `expected_answer`, `expected_entities`, `expected_source_docs`,
 * `difficulty`, `tags` are intentionally left empty/placeholder. A reviewer
 * MUST fill these before the row is used for hard quality evaluation — see
 * the runbook. This is documented as a known limitation (the query log only
 * captures what the system retrieved, not ground-truth labels).
 */
export function buildPromotedRow(
  log: QueryLogRow,
  ctx: BuildPromotedRowContext,
): PromotedRow {
  const rawQuery = log.query_preview ?? '';
  const { text: redactedQuery, applied: redactionsApplied } = redactPiiWithReport(rawQuery);
  return {
    id: `promoted-${log.id}`,
    query: redactedQuery,
    query_class: log.query_class,
    expected_chunk_ids: log.result_chunk_ids ?? [],
    acceptable_chunk_ids: [],
    expected_source_docs: [],
    expected_answer: '',
    expected_entities: [],
    difficulty: 'unlabelled',
    tags: [log.query_class, 'real_user_promoted'],
    provenance_label: 'real_user_promoted',
    source_query_log_id: log.id,
    promoted_at: ctx.promotedAt,
    redactions_applied: redactionsApplied,
  };
}

// ── Append helper ─────────────────────────────────────────────────────────────

export interface GoldenSetFile {
  version: string;
  created_at?: string;
  description?: string;
  entries: Array<Record<string, unknown> & { id?: string }>;
  [key: string]: unknown;
}

export interface AppendResult {
  added: PromotedRow[];
  skipped: Array<{ source_query_log_id: string; reason: 'duplicate' }>;
}

/**
 * Append promoted rows to an existing golden set, skipping any whose
 * `source_query_log_id` matches an existing entry. Pure function — caller
 * handles file IO.
 */
export function appendPromotedRows(
  goldenSet: GoldenSetFile,
  rows: PromotedRow[],
): AppendResult {
  const existing = new Set<string>();
  for (const e of goldenSet.entries) {
    const sid = e['source_query_log_id'];
    if (typeof sid === 'string') existing.add(sid);
  }
  const added: PromotedRow[] = [];
  const skipped: AppendResult['skipped'] = [];
  for (const r of rows) {
    if (existing.has(r.source_query_log_id)) {
      skipped.push({ source_query_log_id: r.source_query_log_id, reason: 'duplicate' });
      continue;
    }
    added.push(r);
    existing.add(r.source_query_log_id);
  }
  goldenSet.entries.push(...added);
  return { added, skipped };
}

// ── Class summary helper ──────────────────────────────────────────────────────

export function summarizeByClass(rows: ReadonlyArray<{ query_class: string }>): {
  classes: Record<string, number>;
  total: number;
} {
  const classes: Record<string, number> = {};
  for (const r of rows) {
    classes[r.query_class] = (classes[r.query_class] ?? 0) + 1;
  }
  return { classes, total: rows.length };
}
