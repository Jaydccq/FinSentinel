"""BGE Reranker model wrapper.

Loads BAAI/bge-reranker-v2-m3 at startup and exposes a batch-score method.
"""

import logging
from transformers import AutoModelForSequenceClassification, AutoTokenizer
import torch

logger = logging.getLogger(__name__)


class BGEReranker:
    def __init__(self, model_name: str = "BAAI/bge-reranker-v2-m3"):
        logger.info(f"Loading reranker model: {model_name}")
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModelForSequenceClassification.from_pretrained(model_name)
        self.model.eval()
        logger.info("Reranker model loaded successfully")

    @torch.no_grad()
    def score(self, query: str, passages: list[str]) -> list[float]:
        """Score query-passage pairs. Returns list of relevance scores."""
        if not passages:
            return []

        pairs = [[query, passage] for passage in passages]
        inputs = self.tokenizer(
            pairs,
            padding=True,
            truncation=True,
            max_length=512,
            return_tensors="pt",
        )
        scores = self.model(**inputs, return_dict=True).logits.view(-1).float().tolist()
        return scores
