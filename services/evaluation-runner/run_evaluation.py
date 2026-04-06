#!/usr/bin/env python3
"""RAG evaluation runner.

Usage:
  python run_evaluation.py run --dataset datasets/golden.json --output reports/baseline.json
  python run_evaluation.py compare reports/baseline.json reports/experiment.json
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from evaluators.topk_evaluator import TopKEvaluator, GoldenEntry, RetrievalResult


def load_golden_set(path: str) -> list[GoldenEntry]:
    with open(path) as f:
        data = json.load(f)
    return [GoldenEntry(**entry) for entry in data["entries"]]


def run_evaluation(dataset_path: str, output_path: str) -> None:
    golden_set = load_golden_set(dataset_path)
    print(f"Loaded {len(golden_set)} golden entries from {dataset_path}")

    # TODO: Phase 6 Task 23 will add API calls to actually retrieve results.
    # For now, generate empty results to establish the baseline format.
    retrieval_results = [RetrievalResult(chunks=[]) for _ in golden_set]

    evaluator = TopKEvaluator()
    metrics = evaluator.evaluate(golden_set, retrieval_results)

    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "dataset": dataset_path,
        "entry_count": len(golden_set),
        "metrics": metrics,
    }

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"\nResults saved to {output_path}")
    print("\nMetrics:")
    for name, value in sorted(metrics.items()):
        print(f"  {name}: {value:.4f}")


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
    if regressions > 0:
        print("WARNING: regressions detected (delta < -0.05)")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="RAG Evaluation Runner")
    subparsers = parser.add_subparsers(dest="command")

    run_parser = subparsers.add_parser("run", help="Run evaluation")
    run_parser.add_argument("--dataset", required=True, help="Path to golden set JSON")
    run_parser.add_argument("--output", required=True, help="Path for output report JSON")

    cmp_parser = subparsers.add_parser("compare", help="Compare two reports")
    cmp_parser.add_argument("baseline", help="Baseline report JSON")
    cmp_parser.add_argument("experiment", help="Experiment report JSON")

    args = parser.parse_args()

    if args.command == "run":
        run_evaluation(args.dataset, args.output)
    elif args.command == "compare":
        compare_reports(args.baseline, args.experiment)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
