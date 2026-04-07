"""Reranker sidecar - FastAPI entrypoint."""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI

from models.bge_reranker import BGEReranker
from routers.rerank import router as rerank_router, set_reranker

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    reranker = BGEReranker()
    set_reranker(reranker)
    yield


app = FastAPI(title="FinSentinel Reranker Sidecar", lifespan=lifespan)
app.include_router(rerank_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
