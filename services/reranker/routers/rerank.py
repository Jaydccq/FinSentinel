"""POST /rerank endpoint."""

import time
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

_reranker = None


def set_reranker(reranker):
    global _reranker
    _reranker = reranker


class Candidate(BaseModel):
    id: str
    text: str


class RerankRequest(BaseModel):
    query: str
    candidates: list[Candidate]
    top_k: int = 10


class RerankResult(BaseModel):
    id: str
    score: float
    rank: int


class RerankResponse(BaseModel):
    results: list[RerankResult]
    model_used: str
    latency_ms: float


@router.post("/rerank", response_model=RerankResponse)
async def rerank(request: RerankRequest):
    if _reranker is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    start = time.monotonic()
    passages = [c.text for c in request.candidates]
    scores = _reranker.score(request.query, passages)

    scored = sorted(
        zip(request.candidates, scores),
        key=lambda x: x[1],
        reverse=True,
    )[:request.top_k]

    results = [
        RerankResult(id=candidate.id, score=score, rank=rank + 1)
        for rank, (candidate, score) in enumerate(scored)
    ]

    latency = (time.monotonic() - start) * 1000
    return RerankResponse(
        results=results,
        model_used="bge-reranker-v2-m3",
        latency_ms=round(latency, 2),
    )
