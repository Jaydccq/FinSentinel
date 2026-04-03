/**
 * Result of executing a pending commit.
 *
 * Result shape returned after executing a pending commit.
 * Contains a human-readable report, the raw commit data, and per-operation results.
 */
export interface ExecuteResult {
  /** Human-readable execution report. */
  report: string;

  /** The commit data that was executed (hash, message, timestamp, operations). */
  commitData: Record<string, unknown>;

  /** Per-operation execution results. */
  results: Record<string, unknown>[];
}
