#!/usr/bin/env python3
"""RAG evaluation runner.

Usage:
  python run_evaluation.py run --dataset datasets/golden.json --output reports/baseline.json
  python run_evaluation.py run --dataset datasets/golden.json --output reports/live.json --config config.yaml
  python run_evaluation.py compare reports/baseline.json reports/experiment.json
"""

import argparse
import json
import os
import sys
import yaml
from datetime import datetime, timezone
from pathlib import Path

from evaluators.topk_evaluator import TopKEvaluator, GoldenEntry, RetrievalResult, RetrievedChunk
from evaluators.corpus_retriever import CorpusRetriever


def check_minimum_metrics(metrics: dict[str, float], minimums: dict[str, float]) -> list[str]:
    """Return list of violation messages, empty if all pass.

    Returns a message for any minimums key not present in metrics (typo guard),
    and a violation message for any key whose value falls below its threshold.
    """
    violations: list[str] = []
    for key, threshold in minimums.items():
        if key not in metrics:
            violations.append(
                f"UNKNOWN_KEY: '{key}' not found in metrics. "
                f"Available keys: {sorted(metrics.keys())}"
            )
        elif metrics[key] < threshold:
            delta = metrics[key] - threshold
            violations.append(
                f"FAIL: {key} = {metrics[key]:.4f} < minimum {threshold:.4f} (delta {delta:+.4f})"
            )
    return violations


def load_golden_set(path: str) -> list[GoldenEntry]:
    with open(path) as f:
        data = json.load(f)
    return [GoldenEntry(**entry) for entry in data["entries"]]


def load_config(path: str | None) -> dict:
    if path is None:
        return {}
    with open(path) as f:
        return yaml.safe_load(f) or {}


def fetch_retrieval_results(
    api_base_url: str,
    endpoint: str,
    golden_set: list[GoldenEntry],
    top_k: int,
    api_token: str | None = None,
    forward_bucket_as_query_class: bool = False,
    timeout_s: float = 30.0,
) -> list[RetrievalResult]:
    """Call the RAG API to get actual retrieval results for each golden entry.

    When ``api_token`` is provided, it is sent as ``Authorization: Bearer <token>``
    on every request. Local unauthenticated dev setups should leave it as ``None``.

    When ``forward_bucket_as_query_class`` is True, each entry's ``tags[0]`` is
    forwarded to the API as ``queryClass``. This lets the retrieval API exercise
    its intent-aware routing on the same buckets the gate evaluates against.
    Entries with no tags send no ``queryClass`` and are handled as before.

    ``timeout_s`` bounds each POST /rag/search call. The default is 30s which
    suits retrieval-only runs; bump to 120+ for runs where RAG_QUERY_REWRITE /
    HyDE are enabled (LLM-driven planner adds ~5-20s per query). Exposed as a
    parameter rather than a global so eval harness authors can choose per-run.
    """
    import httpx

    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_token:
        headers["Authorization"] = f"Bearer {api_token}"

    results = []
    with httpx.Client(timeout=timeout_s) as client:
        for entry in golden_set:
            payload: dict[str, object] = {"query": entry.query, "topK": top_k}
            if forward_bucket_as_query_class and entry.tags:
                payload["queryClass"] = entry.tags[0]
            try:
                resp = client.post(
                    f"{api_base_url}{endpoint}",
                    json=payload,
                    headers=headers,
                )
                resp.raise_for_status()
                data = resp.json()
                chunk_list = data if isinstance(data, list) else data.get(
                    "results", data.get("chunks", [])
                )
                chunks = [_coerce_chunk(c) for c in chunk_list]
                results.append(RetrievalResult(chunks=chunks))
            except Exception as e:
                print(f"  Warning: retrieval failed for '{entry.query[:50]}...': {e}")
                results.append(RetrievalResult(chunks=[]))
    return results


def _coerce_chunk(c: dict) -> RetrievedChunk:
    """Normalise one API result into a RetrievedChunk.

    When the API has been seeded via `rag:eval:seed-fixture` (the CLI that
    hydrates datasets/corpus.json into document_chunks), each row's `id` is
    a `deterministicChunkUuid(corpus_chunk_id)` and the original corpus
    string is preserved at `metadata.corpus_chunk_id`. The golden set,
    however, carries chunk IDs in their corpus form ("chunk-001"). So if
    we naively use `chunkId`/`id` we get 0% recall on every query against
    a seeded DB — the UUID and the string simply don't match.

    Resolution: when `metadata.corpus_chunk_id` is present, it wins. This
    preserves the corpus-native form and lets the offline evaluator's
    metric comparisons work against live-API results. When the field is
    absent (real production data, not seed-fixture), we fall back to
    `chunkId` / `id` / `chunk_id` in order — unchanged from the prior
    behavior.

    This mapping is the inverse of what the seed CLI does on insert; see
    `apps/api/src/rag/eval/seed-fixture.cli.ts` and
    `deterministicChunkUuid()`.
    """
    metadata = c.get("metadata") or {}
    corpus_id = metadata.get("corpus_chunk_id") if isinstance(metadata, dict) else None
    if isinstance(corpus_id, str) and corpus_id:
        chunk_id = corpus_id
    else:
        chunk_id = c.get("chunkId") or c.get("id") or c.get("chunk_id") or ""
    return RetrievedChunk(
        chunk_id=chunk_id,
        content=c.get("content", ""),
        score=c.get("rankScore") or c.get("fusionScore") or c.get("similarity") or c.get("score", 0),
    )


def run_evaluation(
    dataset_path: str,
    output_path: str,
    config_path: str | None = None,
    corpus_path: str | None = None,
    bucket: str | None = None,
) -> None:
    golden_set = load_golden_set(dataset_path)
    print(f"Loaded {len(golden_set)} golden entries from {dataset_path}")

    config = load_config(config_path)
    retrieval_config = config.get("retrieval", {})
    api_base_url = config.get("api_base_url", "")

    # CLI --corpus flag takes precedence, then config file corpus_path
    effective_corpus_path = corpus_path or config.get("corpus_path", "")

    if effective_corpus_path:
        print(f"Using corpus-based retrieval from {effective_corpus_path}")
        retriever = CorpusRetriever(effective_corpus_path)
        top_k = retrieval_config.get("top_k", 10)
        retrieval_results = [retriever.retrieve(e.query, top_k=top_k) for e in golden_set]
    elif api_base_url:
        endpoint = retrieval_config.get("endpoint", "/api/rag/search")
        top_k = retrieval_config.get("top_k", 10)
        # Auth token: config wins, then env. No token means unauthenticated
        # (fine for localhost dev, required for staging).
        api_token = retrieval_config.get("api_token") or os.environ.get("RAG_API_TOKEN")
        # When true, each golden entry's tags[0] (bucket) is forwarded as
        # queryClass so the API exercises intent-aware routing per bucket.
        forward_bucket = bool(retrieval_config.get("forward_bucket_as_query_class", False))
        # Per-query timeout; bump for runs where RAG_QUERY_REWRITE / HyDE
        # are on (LLM variants add ~5-20s per query to the planner stage).
        timeout_s = float(
            retrieval_config.get("timeout_s")
            or os.environ.get("RAG_EVAL_TIMEOUT_S")
            or 30.0
        )
        auth_note = "authenticated" if api_token else "unauthenticated"
        route_note = "+queryClass" if forward_bucket else ""
        print(
            f"Fetching results from {api_base_url}{endpoint} "
            f"(top_k={top_k}, timeout={timeout_s:.0f}s, {auth_note}{route_note})"
        )
        retrieval_results = fetch_retrieval_results(
            api_base_url,
            endpoint,
            golden_set,
            top_k,
            api_token=api_token,
            forward_bucket_as_query_class=forward_bucket,
            timeout_s=timeout_s,
        )
    else:
        print("No API configured, using empty retrieval results")
        retrieval_results = [RetrievalResult(chunks=[]) for _ in golden_set]

    evaluator = TopKEvaluator()
    metrics = evaluator.evaluate(golden_set, retrieval_results, bucket=bucket)
    minimum_metrics: dict[str, float] = config.get("minimum_metrics", {})
    bucket_minimum_metrics: dict[str, dict[str, float]] = config.get(
        "bucket_minimum_metrics", {}
    )

    # Defensive: `bucket_minimum_metrics:` must be a mapping of
    # `bucket_name -> {metric_key: threshold}`. A common YAML mistake is
    # writing `bucket_minimum_metrics: 0.8` (scalar) or using a flat list,
    # which would raise a cryptic AttributeError on `.items()` below. Surface
    # a readable message that points at the offending key and its type.
    if not isinstance(bucket_minimum_metrics, dict):
        raise TypeError(
            f"bucket_minimum_metrics must be a mapping of "
            f"'bucket_name -> {{metric_key: threshold}}' — got "
            f"{type(bucket_minimum_metrics).__name__}: {bucket_minimum_metrics!r}"
        )
    for _bucket_name, _thresholds in bucket_minimum_metrics.items():
        if not isinstance(_thresholds, dict):
            raise TypeError(
                f"bucket_minimum_metrics['{_bucket_name}'] must be a mapping of "
                f"metric_key -> threshold — got "
                f"{type(_thresholds).__name__}: {_thresholds!r}"
            )

    # Per-bucket metrics: recompute for each bucket named in the gate config.
    # Done regardless of --bucket, because bucket gating evaluates thresholds
    # against bucket-scoped metrics, not the overall filtered set.
    bucket_metrics: dict[str, dict[str, float]] = {}
    for bucket_name in bucket_minimum_metrics:
        bucket_metrics[bucket_name] = evaluator.evaluate(
            golden_set, retrieval_results, bucket=bucket_name
        )

    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "dataset": dataset_path,
        "entry_count": len(golden_set),
        "metrics": metrics,
    }
    if bucket is not None:
        report["bucket"] = bucket
    if minimum_metrics:
        report["minimum_metrics"] = minimum_metrics
    if bucket_minimum_metrics:
        report["bucket_minimum_metrics"] = bucket_minimum_metrics
        report["bucket_metrics"] = bucket_metrics

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"\nResults saved to {output_path}")
    print("\nMetrics:")
    for name, value in sorted(metrics.items()):
        print(f"  {name}: {value:.4f}")

    should_exit_nonzero = False

    if minimum_metrics:
        violations = check_minimum_metrics(metrics, minimum_metrics)
        if violations:
            print("\nminimum_metrics violations:")
            for msg in violations:
                print(f"  {msg}")
            should_exit_nonzero = True

    if bucket_minimum_metrics:
        for bucket_name, thresholds in bucket_minimum_metrics.items():
            violations = check_minimum_metrics(
                bucket_metrics[bucket_name], thresholds
            )
            if violations:
                print(f"\nbucket_minimum_metrics[{bucket_name}] violations:")
                for msg in violations:
                    print(f"  {msg}")
                should_exit_nonzero = True

    if should_exit_nonzero:
        sys.exit(1)


def compare_reports(path_a: str, path_b: str) -> None:
    with open(path_a) as f:
        report_a = json.load(f)
    with open(path_b) as f:
        report_b = json.load(f)

    metrics_a = report_a["metrics"]
    metrics_b = report_b["metrics"]
    all_keys = sorted(set(metrics_a.keys()) | set(metrics_b.keys()))

    regressions = 0
    improvements = 0

    print(f"\n{'Metric':<25} {'Baseline':>10} {'Experiment':>10} {'Delta':>10}")
    print("-" * 57)

    for key in all_keys:
        val_a = metrics_a.get(key, 0.0)
        val_b = metrics_b.get(key, 0.0)
        delta = val_b - val_a
        arrow = "^" if delta > 0 else ("v" if delta < 0 else "-")

        if delta < -0.05:
            regressions += 1
        elif delta > 0.01:
            improvements += 1

        print(f"  {key:<23} {val_a:>10.4f} {val_b:>10.4f} {delta:>+9.4f} {arrow}")

    print(f"\n{improvements} improved, {regressions} regressed.")
    should_exit_nonzero = False
    if regressions > 0:
        print("WARNING: regressions detected (delta < -0.05)")
        should_exit_nonzero = True

    minimum_metrics: dict[str, float] = report_b.get("minimum_metrics", {})
    if minimum_metrics:
        violations = check_minimum_metrics(metrics_b, minimum_metrics)
        if violations:
            print("\nminimum_metrics violations in experiment report:")
            for msg in violations:
                print(f"  {msg}")
            should_exit_nonzero = True

    if should_exit_nonzero:
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="RAG Evaluation Runner")
    subparsers = parser.add_subparsers(dest="command")

    run_parser = subparsers.add_parser("run", help="Run evaluation")
    run_parser.add_argument("--dataset", required=True, help="Path to golden set JSON")
    run_parser.add_argument("--output", required=True, help="Path for output report JSON")
    run_parser.add_argument("--config", default=None, help="Path to config YAML")
    run_parser.add_argument("--corpus", default=None, help="Path to corpus JSON for offline retrieval")
    run_parser.add_argument(
        "--bucket",
        default=None,
        help=(
            "Only score entries tagged with this bucket label (e.g. exact_lookup, "
            "colloquial). Scopes the overall metrics block only; does NOT disable "
            "bucket_minimum_metrics gates, which are always evaluated per-bucket."
        ),
    )

    cmp_parser = subparsers.add_parser("compare", help="Compare two reports")
    cmp_parser.add_argument("baseline", help="Baseline report JSON")
    cmp_parser.add_argument("experiment", help="Experiment report JSON")

    args = parser.parse_args()

    if args.command == "run":
        run_evaluation(args.dataset, args.output, args.config, args.corpus, args.bucket)
    elif args.command == "compare":
        compare_reports(args.baseline, args.experiment)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
