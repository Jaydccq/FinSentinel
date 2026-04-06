"""TopK retrieval quality evaluator.

Measures Recall@K, Precision@K, and MRR@K for K in {3, 5, 10}.
"""

from dataclasses import dataclass, field


@dataclass
class GoldenEntry:
    id: str
    query: str
    query_class: str
    expected_chunk_ids: list[str]
    expected_source_docs: list[str]
    expected_answer: str
    expected_entities: list[str]
    difficulty: str
    tags: list[str]
    notes: str = ""


@dataclass
class RetrievedChunk:
    chunk_id: str
    content: str
    score: float


@dataclass
class RetrievalResult:
    chunks: list[RetrievedChunk] = field(default_factory=list)


class TopKEvaluator:
    """Measures retrieval quality: did we find the right chunks?"""

    K_VALUES = (3, 5, 10)

    def evaluate(
        self,
        golden_set: list[GoldenEntry],
        retrieval_results: list[RetrievalResult],
    ) -> dict[str, float]:
        metrics: dict[str, float] = {}

        for k in self.K_VALUES:
            recall_scores: list[float] = []
            precision_scores: list[float] = []
            reciprocal_ranks: list[float] = []

            for entry, result in zip(golden_set, retrieval_results):
                retrieved_ids = [c.chunk_id for c in result.chunks[:k]]
                expected_ids = set(entry.expected_chunk_ids)

                if not expected_ids:
                    recall_scores.append(0.0)
                    precision_scores.append(0.0)
                    reciprocal_ranks.append(0.0)
                    continue

                hits = len(expected_ids & set(retrieved_ids))
                recall_scores.append(hits / len(expected_ids))
                precision_scores.append(hits / k)

                rr = 0.0
                for rank, rid in enumerate(retrieved_ids, 1):
                    if rid in expected_ids:
                        rr = 1.0 / rank
                        break
                reciprocal_ranks.append(rr)

            n = len(golden_set) or 1
            metrics[f"recall@{k}"] = sum(recall_scores) / n
            metrics[f"precision@{k}"] = sum(precision_scores) / n
            metrics[f"mrr@{k}"] = sum(reciprocal_ranks) / n

        return metrics
