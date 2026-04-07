"""RAGAS end-to-end evaluation.

Measures faithfulness, answer relevancy, context precision, and context recall.
Requires an LLM API key (OPENROUTER_API_KEY or OPENAI_API_KEY env var).
"""

from dataclasses import dataclass

try:
    from ragas import evaluate as ragas_evaluate
    from ragas import EvaluationDataset, SingleTurnSample
    from ragas.metrics import faithfulness, answer_relevancy, context_precision, context_recall
    RAGAS_AVAILABLE = True
except ImportError:
    RAGAS_AVAILABLE = False


@dataclass
class RagasInput:
    query: str
    answer: str
    contexts: list[str]
    reference: str


class RagasEvaluator:
    """End-to-end RAG quality evaluator using RAGAS framework."""

    def run(self, inputs: list[RagasInput]) -> dict[str, float]:
        if not RAGAS_AVAILABLE:
            raise ImportError(
                "ragas is not installed. Install with: pip install ragas langchain-openai"
            )

        samples = [
            SingleTurnSample(
                user_input=inp.query,
                response=inp.answer,
                retrieved_contexts=inp.contexts,
                reference=inp.reference,
            )
            for inp in inputs
        ]

        dataset = EvaluationDataset(samples=samples)
        result = ragas_evaluate(
            dataset=dataset,
            metrics=[faithfulness, answer_relevancy, context_precision, context_recall],
        )
        return result.to_pandas().mean().to_dict()
