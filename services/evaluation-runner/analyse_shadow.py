"""Offline analyser for rag_shadow_comparisons (R7.4)."""
import argparse
import os
import statistics
from collections import defaultdict
from typing import Any

try:
    import psycopg
except ImportError as exc:  # pragma: no cover
    raise SystemExit("analyse_shadow.py requires psycopg3 (`pip install 'psycopg[binary]'`)") from exc


def overlap_at_k(a: list[str], b: list[str], k: int) -> float:
    if not a:
        return 0.0
    capped = min(len(a), k)
    return len(set(a[:k]) & set(b[:k])) / capped


def percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    if pct <= 0:
        return min(values)
    if pct >= 100:
        return max(values)
    # statistics.quantiles with method='inclusive' gives Tukey-style quantiles
    idx = int(round(pct / 100 * (len(values) - 1)))
    return sorted(values)[idx]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--db-url', default=os.environ.get('DATABASE_URL'))
    parser.add_argument('--since', default="now() - interval '7 days'",
                        help="SQL expression for the lower bound on created_at (default 7 days)")
    parser.add_argument('--out', default='reports/shadow-analysis.md')
    args = parser.parse_args()

    if not args.db_url:
        raise SystemExit("DATABASE_URL env var or --db-url flag required.")

    with psycopg.connect(args.db_url) as conn:
        rows = conn.execute(f"""
            SELECT query_class,
                   single_stage_chunk_ids,
                   multi_stage_chunk_ids,
                   single_stage_latency_ms,
                   multi_stage_latency_ms,
                   shadow_timed_out,
                   shadow_dropped_backpressure,
                   multi_stage_error
            FROM rag_shadow_comparisons
            WHERE created_at >= {args.since}
            ORDER BY query_class, created_at
        """).fetchall()

    by_class: dict[str, list[Any]] = defaultdict(list)
    for r in rows:
        by_class[r[0]].append(r)

    lines: list[str] = [
        '# Shadow Comparison Report',
        '',
        f'- Total rows: {len(rows)}',
        f'- Window: {args.since}',
        '',
    ]

    if not rows:
        lines.append('_No shadow comparison rows in the window._')
        _write(args.out, lines)
        return

    for cls, entries in sorted(by_class.items()):
        ok = [e for e in entries
              if not e[5] and not e[6] and not e[7]]  # not timed out / dropped / errored
        overlaps_5 = [overlap_at_k(e[1], e[2], 5) for e in ok]
        overlaps_10 = [overlap_at_k(e[1], e[2], 10) for e in ok]
        lat_single = [e[3] for e in ok if e[3] is not None]
        lat_multi = [e[4] for e in ok if e[4] is not None]

        lines += [
            f'## {cls} (n={len(entries)}, successful={len(ok)})',
            '',
            f'- overlap@5 mean  = {statistics.mean(overlaps_5) if overlaps_5 else 0:.3f}',
            f'- overlap@10 mean = {statistics.mean(overlaps_10) if overlaps_10 else 0:.3f}',
            f'- single-stage latency (ms): p50 = {percentile(lat_single, 50)}, p95 = {percentile(lat_single, 95)}',
            f'- multi-stage  latency (ms): p50 = {percentile(lat_multi, 50)}, p95 = {percentile(lat_multi, 95)}',
            f'- timed_out: {sum(1 for e in entries if e[5])}  dropped: {sum(1 for e in entries if e[6])}  errored: {sum(1 for e in entries if e[7])}',
            '',
        ]

    _write(args.out, lines)
    print(f'wrote {args.out}  ({len(rows)} rows summarised)')


def _write(path: str, lines: list[str]) -> None:
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'w') as f:
        f.write('\n'.join(lines))


if __name__ == '__main__':
    main()
