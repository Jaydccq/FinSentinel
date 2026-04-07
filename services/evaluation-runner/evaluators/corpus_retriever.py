"""Corpus-based retriever for offline evaluation.

Loads a synthetic corpus and retrieves chunks using simple keyword matching.
This allows running evaluation without a live API.
"""

import json
import math
import re
from dataclasses import dataclass

from .topk_evaluator import RetrievalResult, RetrievedChunk


@dataclass
class CorpusChunk:
    chunk_id: str
    source_doc: str
    doc_type: str
    sector: str
    content: str


# Common English stop words to filter out for better matching
_STOP_WORDS = frozenset({
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
    "into", "through", "during", "before", "after", "above", "below",
    "between", "under", "again", "further", "then", "once", "here",
    "there", "when", "where", "why", "how", "all", "both", "each",
    "few", "more", "most", "other", "some", "such", "no", "nor", "not",
    "only", "own", "same", "so", "than", "too", "very", "just", "because",
    "but", "and", "or", "if", "while", "about", "up", "out", "off",
    "over", "down", "it", "its", "this", "that", "these", "those",
    "i", "me", "my", "we", "our", "you", "your", "he", "him", "his",
    "she", "her", "they", "them", "their", "what", "which", "who", "whom",
})

_WORD_RE = re.compile(r"[a-z0-9]+(?:\.[0-9]+)*(?:%)?")


def _tokenize(text: str) -> list[str]:
    """Extract lowercased tokens, filtering stop words."""
    return [t for t in _WORD_RE.findall(text.lower()) if t not in _STOP_WORDS]


class CorpusRetriever:
    """Simple keyword-based retriever for offline evaluation.

    Uses TF-IDF-inspired scoring: term frequency in the chunk weighted by
    inverse document frequency across the corpus. This gives better results
    than raw Jaccard overlap for financial document retrieval.
    """

    def __init__(self, corpus_path: str):
        with open(corpus_path) as f:
            data = json.load(f)
        self.chunks = [CorpusChunk(**c) for c in data["chunks"]]

        # Pre-compute token lists and IDF
        self._chunk_tokens: list[list[str]] = []
        self._chunk_token_sets: list[set[str]] = []
        doc_freq: dict[str, int] = {}
        n = len(self.chunks)

        for chunk in self.chunks:
            tokens = _tokenize(chunk.content)
            token_set = set(tokens)
            self._chunk_tokens.append(tokens)
            self._chunk_token_sets.append(token_set)
            for term in token_set:
                doc_freq[term] = doc_freq.get(term, 0) + 1

        # IDF: log(N / df) with smoothing
        self._idf: dict[str, float] = {}
        for term, df in doc_freq.items():
            self._idf[term] = math.log((n + 1) / (df + 1)) + 1.0

    def retrieve(self, query: str, top_k: int = 10) -> RetrievalResult:
        """Score chunks by TF-IDF weighted keyword overlap with query."""
        query_tokens = _tokenize(query)
        if not query_tokens:
            return RetrievalResult(chunks=[])

        query_term_set = set(query_tokens)
        scored: list[tuple[CorpusChunk, float]] = []

        for i, chunk in enumerate(self.chunks):
            token_set = self._chunk_token_sets[i]
            tokens = self._chunk_tokens[i]
            overlap_terms = query_term_set & token_set

            if not overlap_terms:
                continue

            # TF-IDF score: sum of (tf_in_chunk * idf) for matching terms
            score = 0.0
            token_count = len(tokens) or 1
            for term in overlap_terms:
                tf = tokens.count(term) / token_count
                idf = self._idf.get(term, 1.0)
                score += tf * idf

            # Boost by coverage: fraction of query terms found
            coverage = len(overlap_terms) / len(query_term_set)
            score *= (1.0 + coverage)

            scored.append((chunk, score))

        scored.sort(key=lambda x: x[1], reverse=True)

        return RetrievalResult(
            chunks=[
                RetrievedChunk(
                    chunk_id=chunk.chunk_id,
                    content=chunk.content[:200],
                    score=round(score, 6),
                )
                for chunk, score in scored[:top_k]
            ]
        )
