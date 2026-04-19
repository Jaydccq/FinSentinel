"""Tests for run_evaluation helpers, focused on check_minimum_metrics.

Also hosts the subprocess-based integration tests for the CLI runner:
  - overall minimum_metrics gate exit code
  - bucket_minimum_metrics gate exit code (pass-overall-fail-bucket and vice versa)
  - --bucket CLI flag end-to-end safety on tagless golden sets

Path bootstrap for `run_evaluation` import lives in conftest.py — no
sys.path.insert(...) inside this module.
"""

import os
import subprocess
import sys

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


# --- bucket_minimum_metrics gate (CLI subprocess integration) ---


def test_bucket_gate_fails_even_when_overall_passes(tmp_path):
    """A report passing overall minimum_metrics but failing a bucket gate exits 1."""
    import json
    import yaml

    runner_dir = os.path.join(os.path.dirname(__file__), "..")

    golden = {
        "version": "1.0",
        "created_at": "2026-01-01",
        "description": "test",
        "entries": [
            {
                "id": "bucket-pass",
                "query": "q1",
                "query_class": "FACTUAL",
                "expected_chunk_ids": ["chunk-a"],
                "acceptable_chunk_ids": [],
                "expected_source_docs": [],
                "expected_answer": "",
                "expected_entities": [],
                "difficulty": "easy",
                "tags": ["colloquial"],
            },
            {
                "id": "bucket-fail",
                "query": "q2",
                "query_class": "FACTUAL",
                "expected_chunk_ids": ["chunk-missing"],
                "acceptable_chunk_ids": [],
                "expected_source_docs": [],
                "expected_answer": "",
                "expected_entities": [],
                "difficulty": "easy",
                "tags": ["exact_lookup"],
            },
        ],
    }
    golden_path = tmp_path / "golden.json"
    golden_path.write_text(json.dumps(golden))

    # Overall has no floor => passes. Bucket exact_lookup floor is 0.99 and
    # the retrieval is empty (no corpus, no api) so strict.recall@5 will be
    # 0.0 — the bucket gate must fail and exit 1.
    config = {
        "minimum_metrics": {},
        "bucket_minimum_metrics": {
            "exact_lookup": {"strict.recall@5": 0.99},
        },
    }
    config_path = tmp_path / "config.yaml"
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
        f"Expected exit 1, got {result.returncode}.\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
    combined = result.stdout + result.stderr
    assert "exact_lookup" in combined
    assert "strict.recall@5" in combined
    assert output_path.exists(), "Report must be written even when bucket gate fails"


def test_overall_gate_fails_even_when_bucket_passes(tmp_path):
    """Vice versa: report passes all buckets but fails overall => exit 1."""
    import json
    import yaml

    runner_dir = os.path.join(os.path.dirname(__file__), "..")

    golden = {
        "version": "1.0",
        "created_at": "2026-01-01",
        "description": "test",
        "entries": [
            {
                "id": "only-entry",
                "query": "q",
                "query_class": "FACTUAL",
                "expected_chunk_ids": ["chunk-missing"],
                "acceptable_chunk_ids": [],
                "expected_source_docs": [],
                "expected_answer": "",
                "expected_entities": [],
                "difficulty": "easy",
                "tags": ["exact_lookup"],
            }
        ],
    }
    golden_path = tmp_path / "golden.json"
    golden_path.write_text(json.dumps(golden))

    # Bucket floor is 0.0 => will pass (nonexistent bucket -> 0.0 matches 0.0).
    # Overall floor is 0.99 => will fail (no retrieval => 0.0).
    config = {
        "minimum_metrics": {
            "strict.recall@5": 0.99,
        },
        "bucket_minimum_metrics": {
            "nonexistent_bucket": {"strict.recall@5": 0.0},
        },
    }
    config_path = tmp_path / "config.yaml"
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
        f"Expected exit 1, got {result.returncode}.\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
    combined = result.stdout + result.stderr
    assert "strict.recall@5" in combined


# --- CLI --bucket flag end-to-end ---


def test_cli_bucket_flag_is_safe_on_tagless_golden(tmp_path):
    """--bucket nonexistent must not crash on a golden set with no matching tags."""
    import json

    runner_dir = os.path.join(os.path.dirname(__file__), "..")

    golden = {
        "version": "1.0",
        "created_at": "2026-01-01",
        "description": "test",
        "entries": [
            {
                "id": "t-001",
                "query": "q",
                "query_class": "FACTUAL",
                "expected_chunk_ids": ["chunk-a"],
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
            "--bucket",
            "nonexistent",
        ],
        cwd=runner_dir,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, (
        f"Expected exit 0, got {result.returncode}.\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
    assert output_path.exists()
