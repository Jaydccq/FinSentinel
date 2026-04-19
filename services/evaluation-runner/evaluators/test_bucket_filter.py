"""Tests for per-bucket gating in TopKEvaluator (R1.2).

Bucket filtering isolates a subset of golden entries by `tag` before metrics
are computed. An unknown bucket produces zero-entries metrics (not an error):
the empty-bucket case mirrors the evaluator's existing empty-set handling in
`test_empty_expected`, and it means `--bucket foo` never crashes on a golden
dataset whose tags have not yet been populated.
"""

import pytest

from topk_evaluator import (
    GoldenEntry,
    RetrievalResult,
    RetrievedChunk,
    TopKEvaluator,
)


def _entry(
    entry_id: str,
    expected_ids: list[str],
    tags: list[str] | None = None,
    acceptable_ids: list[str] | None = None,
) -> GoldenEntry:
    return GoldenEntry(
        id=entry_id,
        query="test query",
        query_class="FACTUAL",
        expected_chunk_ids=expected_ids,
        expected_source_docs=[],
        expected_answer="",
        expected_entities=[],
        difficulty="easy",
        tags=tags or [],
        acceptable_chunk_ids=acceptable_ids or [],
    )


def _result(chunk_ids: list[str]) -> RetrievalResult:
    return RetrievalResult(
        chunks=[
            RetrievedChunk(chunk_id=cid, content=f"content-{cid}", score=1.0 - i * 0.1)
            for i, cid in enumerate(chunk_ids)
        ]
    )


# --- happy path ---


def test_bucket_filter_isolates_exact_lookup_metrics():
    """Only entries tagged with the requested bucket contribute to metrics."""
    entries = [
        _entry("g1", ["c1"], tags=["exact_lookup"]),
        _entry("g2", ["c2"], tags=["colloquial"]),
    ]
    results = [_result(["c1"]), _result(["cx"])]  # g2 missed
    ev = TopKEvaluator()
    r = ev.evaluate(entries, results, bucket="exact_lookup")
    assert r["strict.recall@5"] == 1.0  # only g1 counted


# --- edge cases ---


def test_bucket_none_preserves_current_behavior():
    """bucket=None (default) scores all entries — regression guard for T1.B."""
    entries = [
        _entry("g1", ["c1"], tags=["exact_lookup"]),
        _entry("g2", ["c2"], tags=["colloquial"]),
    ]
    results = [_result(["c1"]), _result(["cx"])]  # one hit, one miss
    ev = TopKEvaluator()

    r_default = ev.evaluate(entries, results)
    r_explicit_none = ev.evaluate(entries, results, bucket=None)

    assert r_default == r_explicit_none
    assert r_default["strict.recall@5"] == pytest.approx(0.5)


def test_nonexistent_bucket_returns_zero_metrics():
    """Unknown bucket yields zero-entries metrics (not an exception).

    This keeps `--bucket foo` safe on golden sets whose tags have not yet
    been populated (e.g. the current datasets/golden.json has no Wave 2
    tags). The evaluator already handles `len(golden_set) == 0` by dividing
    by 1, so all metrics are 0.0.
    """
    entries = [
        _entry("g1", ["c1"], tags=["exact_lookup"]),
        _entry("g2", ["c2"], tags=["colloquial"]),
    ]
    results = [_result(["c1"]), _result(["c2"])]  # both would be perfect
    ev = TopKEvaluator()

    r = ev.evaluate(entries, results, bucket="nonexistent")

    # All metrics must exist and be 0.0 — no KeyError, no crash.
    for k in (3, 5, 10):
        assert r[f"strict.recall@{k}"] == 0.0
        assert r[f"lenient.recall@{k}"] == 0.0
        assert r[f"strict.mrr@{k}"] == 0.0
        assert r[f"lenient.mrr@{k}"] == 0.0
        assert r[f"precision@{k}"] == 0.0


def test_bucket_filter_keeps_entry_result_pairing():
    """Filtering must keep each entry paired with its corresponding result."""
    entries = [
        _entry("g1", ["c1"], tags=["colloquial"]),
        _entry("g2", ["c2"], tags=["exact_lookup"]),
        _entry("g3", ["c3"], tags=["exact_lookup"]),
    ]
    # If pairing broke, g2 would appear to miss and g3 would appear to hit
    # an irrelevant chunk.
    results = [_result(["junk"]), _result(["c2"]), _result(["c3"])]
    ev = TopKEvaluator()

    r = ev.evaluate(entries, results, bucket="exact_lookup")
    assert r["strict.recall@5"] == 1.0  # g2 and g3 both hit


# --- bucket_minimum_metrics gate (integration via check_minimum_metrics) ---


def test_bucket_minimum_metrics_unknown_key_produces_violation():
    """A typo in a bucket threshold key must surface, not silently pass."""
    import sys
    import os

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from run_evaluation import check_minimum_metrics

    metrics = {"strict.recall@5": 0.9}
    minimums = {"stirct.recal@5": 0.5}  # obvious typo
    violations = check_minimum_metrics(metrics, minimums)

    assert len(violations) == 1
    assert "UNKNOWN_KEY" in violations[0]
    assert "stirct.recal@5" in violations[0]


def test_bucket_gate_fails_even_when_overall_passes(tmp_path):
    """A report passing overall minimum_metrics but failing a bucket gate exits 1."""
    import subprocess
    import sys as _sys
    import os as _os
    import json
    import yaml

    runner_dir = _os.path.join(_os.path.dirname(__file__), "..")

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
            _sys.executable,
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
    import subprocess
    import sys as _sys
    import os as _os
    import json
    import yaml

    runner_dir = _os.path.join(_os.path.dirname(__file__), "..")

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
            _sys.executable,
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
    import subprocess
    import sys as _sys
    import os as _os
    import json

    runner_dir = _os.path.join(_os.path.dirname(__file__), "..")

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
            _sys.executable,
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
