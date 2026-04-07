"""Tests for RagasEvaluator (mocked — no LLM calls)."""

from unittest.mock import patch, MagicMock
from ragas_evaluator import RagasEvaluator, RagasInput


def test_evaluator_returns_expected_metric_keys():
    """Verify output shape and keys from RAGAS evaluation."""
    evaluator = RagasEvaluator()

    inputs = [
        RagasInput(
            query="What is Apple revenue?",
            answer="Apple reported $94.8B in Q3 2025.",
            contexts=["Apple Q3 2025 revenue was $94.8 billion."],
            reference="Apple reported $94.8 billion in revenue for Q3 2025.",
        ),
    ]

    mock_df = MagicMock()
    mock_df.mean.return_value = MagicMock(
        to_dict=lambda: {
            "faithfulness": 0.9,
            "answer_relevancy": 0.85,
            "context_precision": 0.8,
            "context_recall": 0.75,
        }
    )
    mock_result = MagicMock()
    mock_result.to_pandas.return_value = mock_df

    with patch("ragas_evaluator.ragas_evaluate", return_value=mock_result):
        metrics = evaluator.run(inputs)

    assert "faithfulness" in metrics
    assert "answer_relevancy" in metrics
    assert "context_precision" in metrics
    assert "context_recall" in metrics
    assert metrics["faithfulness"] == 0.9
