"""Tests for run_evaluation helpers, focused on check_minimum_metrics."""

import sys
import os
import pytest

# run_evaluation.py lives one level up from the evaluators/ package
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from run_evaluation import check_minimum_metrics


def test_no_violations_when_all_pass():
    metrics = {"strict.recall@5": 0.8, "strict.mrr@10": 0.6}
    minimums = {"strict.recall@5": 0.5, "strict.mrr@10": 0.5}
    assert check_minimum_metrics(metrics, minimums) == []


def test_violation_message_contains_metric_name():
    metrics = {"strict.recall@5": 0.2}
    minimums = {"strict.recall@5": 0.5}
    violations = check_minimum_metrics(metrics, minimums)
    assert len(violations) == 1
    assert "strict.recall@5" in violations[0]


def test_violation_message_contains_actual_and_threshold():
    metrics = {"strict.recall@5": 0.20}
    minimums = {"strict.recall@5": 0.50}
    violations = check_minimum_metrics(metrics, minimums)
    assert "0.2000" in violations[0]
    assert "0.5000" in violations[0]


def test_multiple_violations():
    metrics = {"strict.recall@5": 0.1, "strict.mrr@10": 0.1, "lenient.recall@10": 0.9}
    minimums = {"strict.recall@5": 0.5, "strict.mrr@10": 0.5, "lenient.recall@10": 0.8}
    violations = check_minimum_metrics(metrics, minimums)
    assert len(violations) == 2
    names = " ".join(violations)
    assert "strict.recall@5" in names
    assert "strict.mrr@10" in names


def test_unknown_key_produces_violation():
    metrics = {"strict.recall@5": 0.8}
    minimums = {"typo.recal@5": 0.5}
    violations = check_minimum_metrics(metrics, minimums)
    assert len(violations) == 1
    assert "typo.recal@5" in violations[0]
    assert "UNKNOWN_KEY" in violations[0]


def test_unknown_key_lists_available_keys():
    metrics = {"strict.recall@5": 0.8, "strict.mrr@10": 0.6}
    minimums = {"nonexistent": 0.5}
    violations = check_minimum_metrics(metrics, minimums)
    assert "strict.recall@5" in violations[0]
    assert "strict.mrr@10" in violations[0]


def test_exact_threshold_passes():
    """Exact equality should not be a violation."""
    metrics = {"strict.recall@10": 0.45}
    minimums = {"strict.recall@10": 0.45}
    assert check_minimum_metrics(metrics, minimums) == []


def test_empty_minimums_always_passes():
    metrics = {"strict.recall@5": 0.0}
    assert check_minimum_metrics(metrics, {}) == []


def test_minimum_metrics_violation_exits_nonzero(tmp_path):
    """End-to-end: a report whose metrics violate minimums triggers sys.exit(1)."""
    import subprocess
    import json

    runner_dir = os.path.join(os.path.dirname(__file__), "..")

    # Build a minimal golden.json with one entry
    golden = {
        "version": "1.0",
        "created_at": "2026-01-01",
        "description": "test",
        "entries": [
            {
                "id": "t-001",
                "query": "test query",
                "query_class": "FACTUAL",
                "expected_chunk_ids": ["chunk-999"],
                "acceptable_chunk_ids": [],
                "expected_source_docs": [],
                "expected_answer": "",
                "expected_entities": [],
                "difficulty": "easy",
                "tags": [],
            }
        ],
    }
    golden_path = tmp_path / "golden.json"
    golden_path.write_text(json.dumps(golden))

    # Config with a minimum that will definitely fail (no corpus, so 0.0 recall)
    config = {
        "minimum_metrics": {
            "strict.recall@5": 0.99,
        }
    }
    config_path = tmp_path / "config.yaml"
    import yaml
    config_path.write_text(yaml.dump(config))

    output_path = tmp_path / "report.json"

    result = subprocess.run(
        [
            sys.executable,
            "run_evaluation.py",
            "run",
            "--dataset",
            str(golden_path),
            "--output",
            str(output_path),
            "--config",
            str(config_path),
        ],
        cwd=runner_dir,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 1, (
        f"Expected exit 1, got {result.returncode}.\nstdout: {result.stdout}\nstderr: {result.stderr}"
    )
    combined = result.stdout + result.stderr
    assert "strict.recall@5" in combined, (
        f"Expected metric name in output.\nstdout: {result.stdout}"
    )
    # Report must still have been written (write-before-exit ordering)
    assert output_path.exists(), "Report file should be written even when minimum_metrics fails"
