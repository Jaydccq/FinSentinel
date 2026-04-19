"""Tests for per-bucket gating in TopKEvaluator (R1.2).

Bucket filtering isolates a subset of golden entries by `tag` before metrics
are computed. An unknown bucket produces zero-entries metrics (not an error):
the empty-bucket case mirrors the evaluator's existing empty-set handling in
`test_empty_expected`, and it means `--bucket foo` never crashes on a golden
dataset whose tags have not yet been populated.

Scope note: this file holds PURE-evaluator tests only. Subprocess / CLI
integration tests (minimum_metrics, bucket gate exit codes, --bucket flag end
to end) live in `test_run_evaluation.py` so a "what does this file exercise"
answer stays coherent.
"""

import pytest

from topk_evaluator import (
    GoldenEntry,
    RetrievalResult,
    RetrievedChunk,
    TopKEvaluator,
)
from run_evaluation import check_minimum_metrics


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


# --- bucket_minimum_metrics gate (unit-level via check_minimum_metrics) ---


def test_bucket_minimum_metrics_unknown_key_produces_violation():
    """A typo in a bucket threshold key must surface, not silently pass."""
    metrics = {"strict.recall@5": 0.9}
    minimums = {"stirct.recal@5": 0.5}  # obvious typo
    violations = check_minimum_metrics(metrics, minimums)

    assert len(violations) == 1
    assert "UNKNOWN_KEY" in violations[0]
    assert "stirct.recal@5" in violations[0]
