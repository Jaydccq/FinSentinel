import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from routers.parse import router as parse_router

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="FinSentinel Parser Sidecar", lifespan=lifespan)
app.include_router(parse_router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "pdfplumber-1.0+python-docx"}
