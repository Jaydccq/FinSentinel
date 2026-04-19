"""TopK retrieval quality evaluator.

Measures Recall@K, Precision@K, and MRR@K for K in {3, 5, 10}.

Metrics are split into two namespaces:
  strict.*  — scored against expected_chunk_ids only
  lenient.* — scored against expected_chunk_ids | acceptable_chunk_ids

Precision is kept strict-only (precision against the union would reward
spurious nearby matches).
"""

from dataclasses import dataclass, field
from typing import Optional


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
    acceptable_chunk_ids: list[str] = field(default_factory=list)


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
        bucket: Optional[str] = None,
    ) -> dict[str, float]:
        """Compute retrieval metrics.

        When `bucket` is provided, only golden entries whose `tags` contain
        that label contribute to the metrics. Result pairing is preserved
        (entry[i] with retrieval_results[i]) before filtering. If no entries
        match the bucket, all metrics resolve to 0.0 — intentionally, so
        `--bucket foo` is safe on a dataset where `foo` is not yet populated.
        """
        if bucket is not None:
            filtered = [
                (e, r)
                for e, r in zip(golden_set, retrieval_results)
                if bucket in (e.tags or [])
            ]
            golden_set = [e for e, _ in filtered]
            retrieval_results = [r for _, r in filtered]

        metrics: dict[str, float] = {}

        for k in self.K_VALUES:
            strict_recall: list[float] = []
            lenient_recall: list[float] = []
            precision_scores: list[float] = []
            strict_rr: list[float] = []
            lenient_rr: list[float] = []

            for entry, result in zip(golden_set, retrieval_results):
                retrieved_ids = [c.chunk_id for c in result.chunks[:k]]
                expected_ids = set(entry.expected_chunk_ids)
                lenient_ids = expected_ids | set(entry.acceptable_chunk_ids)

                if not expected_ids:
                    strict_recall.append(0.0)
                    lenient_recall.append(0.0)
                    precision_scores.append(0.0)
                    strict_rr.append(0.0)
                    lenient_rr.append(0.0)
                    continue

                retrieved_set = set(retrieved_ids)

                strict_hits = len(expected_ids & retrieved_set)
                strict_recall.append(strict_hits / len(expected_ids))
                precision_scores.append(strict_hits / k)

                lenient_hits = len(lenient_ids & retrieved_set)
                lenient_recall.append(lenient_hits / len(lenient_ids))

                s_rr = 0.0
                for rank, rid in enumerate(retrieved_ids, 1):
                    if rid in expected_ids:
                        s_rr = 1.0 / rank
                        break
                strict_rr.append(s_rr)

                l_rr = 0.0
                for rank, rid in enumerate(retrieved_ids, 1):
                    if rid in lenient_ids:
                        l_rr = 1.0 / rank
                        break
                lenient_rr.append(l_rr)

            n = len(golden_set) or 1
            metrics[f"strict.recall@{k}"] = sum(strict_recall) / n
            metrics[f"strict.mrr@{k}"] = sum(strict_rr) / n
            metrics[f"lenient.recall@{k}"] = sum(lenient_recall) / n
            metrics[f"lenient.mrr@{k}"] = sum(lenient_rr) / n
            metrics[f"precision@{k}"] = sum(precision_scores) / n

        return metrics
