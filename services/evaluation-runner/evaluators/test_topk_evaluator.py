import pytest
from topk_evaluator import TopKEvaluator, GoldenEntry, RetrievalResult, RetrievedChunk


@pytest.fixture
def evaluator():
    return TopKEvaluator()


def _entry(entry_id: str, expected_ids: list[str]) -> GoldenEntry:
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
    assert metrics["recall@5"] == 1.0
    assert metrics["mrr@5"] == 1.0


def test_zero_recall(evaluator: TopKEvaluator):
    entries = [_entry("gs-1", ["x", "y"])]
    results = [_result(["a", "b", "c", "d", "e"])]
    metrics = evaluator.evaluate(entries, results)
    assert metrics["recall@5"] == 0.0
    assert metrics["mrr@5"] == 0.0


def test_partial_recall(evaluator: TopKEvaluator):
    entries = [_entry("gs-1", ["a", "z"])]
    results = [_result(["a", "b", "c", "d", "e"])]
    metrics = evaluator.evaluate(entries, results)
    assert metrics["recall@5"] == 0.5


def test_mrr_ranks_first_hit(evaluator: TopKEvaluator):
    entries = [_entry("gs-1", ["c"])]
    results = [_result(["a", "b", "c", "d", "e"])]
    metrics = evaluator.evaluate(entries, results)
    assert metrics["mrr@5"] == pytest.approx(1.0 / 3)


def test_multiple_k_values(evaluator: TopKEvaluator):
    entries = [_entry("gs-1", ["a"])]
    results = [_result(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"])]
    metrics = evaluator.evaluate(entries, results)
    assert "recall@3" in metrics
    assert "recall@5" in metrics
    assert "recall@10" in metrics
    assert "precision@3" in metrics
    assert "mrr@3" in metrics


def test_empty_expected(evaluator: TopKEvaluator):
    entries = [_entry("gs-1", [])]
    results = [_result(["a", "b", "c"])]
    metrics = evaluator.evaluate(entries, results)
    assert metrics["recall@5"] == 0.0
