import pytest
from topk_evaluator import TopKEvaluator, GoldenEntry, RetrievalResult, RetrievedChunk


@pytest.fixture
def evaluator():
    return TopKEvaluator()


def _entry(entry_id: str, expected_ids: list[str], acceptable_ids: list[str] | None = None) -> GoldenEntry:
    return GoldenEntry(
        id=entry_id,
        query="test query",
        query_class="FACTUAL",
        expected_chunk_ids=expected_ids,
        expected_source_docs=[],
        expected_answer="",
        expected_entities=[],
        difficulty="easy",
        tags=[],
        acceptable_chunk_ids=acceptable_ids or [],
    )


def _result(chunk_ids: list[str]) -> RetrievalResult:
    return RetrievalResult(
        chunks=[
            RetrievedChunk(chunk_id=cid, content=f"content-{cid}", score=1.0 - i * 0.1)
            for i, cid in enumerate(chunk_ids)
        ]
    )


def test_perfect_recall(evaluator: TopKEvaluator):
    entries = [_entry("gs-1", ["a", "b"])]
    results = [_result(["a", "b", "c", "d", "e"])]
    metrics = evaluator.evaluate(entries, results)
    assert metrics["strict.recall@5"] == 1.0
    assert metrics["strict.mrr@5"] == 1.0


def test_zero_recall(evaluator: TopKEvaluator):
    entries = [_entry("gs-1", ["x", "y"])]
    results = [_result(["a", "b", "c", "d", "e"])]
    metrics = evaluator.evaluate(entries, results)
    assert metrics["strict.recall@5"] == 0.0
    assert metrics["strict.mrr@5"] == 0.0


def test_partial_recall(evaluator: TopKEvaluator):
    entries = [_entry("gs-1", ["a", "z"])]
    results = [_result(["a", "b", "c", "d", "e"])]
    metrics = evaluator.evaluate(entries, results)
    assert metrics["strict.recall@5"] == 0.5


def test_mrr_ranks_first_hit(evaluator: TopKEvaluator):
    entries = [_entry("gs-1", ["c"])]
    results = [_result(["a", "b", "c", "d", "e"])]
    metrics = evaluator.evaluate(entries, results)
    assert metrics["strict.mrr@5"] == pytest.approx(1.0 / 3)


def test_multiple_k_values(evaluator: TopKEvaluator):
    entries = [_entry("gs-1", ["a"])]
    results = [_result(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"])]
    metrics = evaluator.evaluate(entries, results)
    assert "strict.recall@3" in metrics
    assert "strict.recall@5" in metrics
    assert "strict.recall@10" in metrics
    assert "lenient.recall@3" in metrics
    assert "lenient.recall@5" in metrics
    assert "lenient.recall@10" in metrics
    assert "precision@3" in metrics
    assert "strict.mrr@3" in metrics
    assert "lenient.mrr@3" in metrics


def test_empty_expected(evaluator: TopKEvaluator):
    entries = [_entry("gs-1", [])]
    results = [_result(["a", "b", "c"])]
    metrics = evaluator.evaluate(entries, results)
    assert metrics["strict.recall@5"] == 0.0


# --- new tests for strict/lenient split ---

def test_lenient_recall_does_not_hide_strict_miss(evaluator: TopKEvaluator):
    """Acceptable chunk retrieved should not mask that expected chunk was missed."""
    entries = [_entry("gs-1", ["a"], acceptable_ids=["b"])]
    results = [_result(["b", "c", "d", "e", "f"])]
    metrics = evaluator.evaluate(entries, results)
    assert metrics["strict.recall@5"] == 0.0
    assert metrics["lenient.recall@5"] == pytest.approx(0.5)  # b in {a,b}, 1/2 hit


def test_lenient_equals_strict_when_no_acceptable(evaluator: TopKEvaluator):
    """With no acceptable_chunk_ids, lenient == strict for all k."""
    entries = [_entry("gs-1", ["a", "b"])]
    results = [_result(["a", "c", "d", "e", "f", "g", "h", "i", "j", "k"])]
    metrics = evaluator.evaluate(entries, results)
    for k in (3, 5, 10):
        assert metrics[f"strict.recall@{k}"] == metrics[f"lenient.recall@{k}"], (
            f"strict != lenient at k={k} with no acceptable_chunk_ids"
        )
        assert metrics[f"strict.mrr@{k}"] == metrics[f"lenient.mrr@{k}"], (
            f"strict.mrr != lenient.mrr at k={k}"
        )


@pytest.mark.parametrize("expected,acceptable,retrieved", [
    (["a"], [], ["a", "b", "c", "d", "e"]),
    (["a"], ["b"], ["b", "c", "d", "e", "f"]),
    (["a", "b"], ["c"], ["c", "d", "e", "f", "g", "h", "i", "j", "k", "l"]),
    (["x"], ["y"], ["z", "w", "v", "u", "t"]),
    (["a", "b"], ["c", "d"], ["a", "c", "e", "f", "g", "h", "i", "j", "k", "l"]),
])
def test_lenient_never_below_strict(
    evaluator: TopKEvaluator,
    expected: list[str],
    acceptable: list[str],
    retrieved: list[str],
):
    """lenient.recall@k >= strict.recall@k must hold for all k and fixture patterns."""
    entries = [_entry("gs-x", expected, acceptable_ids=acceptable)]
    results = [_result(retrieved)]
    metrics = evaluator.evaluate(entries, results)
    for k in (3, 5, 10):
        assert metrics[f"lenient.recall@{k}"] >= metrics[f"strict.recall@{k}"] - 1e-9, (
            f"lenient.recall@{k} < strict.recall@{k}: "
            f"{metrics[f'lenient.recall@{k}']} < {metrics[f'strict.recall@{k}']}"
        )
