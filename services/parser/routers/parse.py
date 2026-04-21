"""Parse endpoint for the FinSentinel Parser Sidecar.

Swaps the P4 stub (fixed Markdown for any upload) for real MIME-dispatched
extractors:
  - application/pdf → pdfplumber via extractors.pdf_extractor
  - .docx / vnd.openxml...wordprocessingml → python-docx via docx_extractor

Unsupported MIME types return a structured 400 so the API layer can
surface a retryable error rather than failing opaquely downstream.

When real extraction raises, we return 422 with a short error string —
the API's representation-enrichment pipeline handles this by skipping
the doc and logging. This mirrors the stub's "always-200" contract
carefully: stubs returned valid placeholder Markdown regardless of
content, so callers never had an error path. Now they do, but only
on genuine extraction failures.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional

from extractors.pdf_extractor import extract_pdf
from extractors.docx_extractor import extract_docx

logger = logging.getLogger(__name__)

router = APIRouter()

PARSER_VERSION = "pdfplumber-1.0+python-docx"


class Heading(BaseModel):
    level: int
    text: str
    pageStart: Optional[int] = None


class ParseMetadata(BaseModel):
    pageCount: int
    headings: List[Heading]
    tableCount: int
    parserVersion: str
    sourceMimeType: str


class ParseResponse(BaseModel):
    markdown: str
    metadata: ParseMetadata


_PDF_MIME_TYPES = frozenset({"application/pdf"})
_DOCX_MIME_TYPES = frozenset({
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",  # .doc legacy — python-docx will often still handle it
})
_PDF_EXTENSIONS = (".pdf",)
_DOCX_EXTENSIONS = (".docx", ".doc")


def _detect_kind(mime: str, filename: str) -> Optional[str]:
    lower = (filename or "").lower()
    if mime in _PDF_MIME_TYPES or lower.endswith(_PDF_EXTENSIONS):
        return "pdf"
    if mime in _DOCX_MIME_TYPES or lower.endswith(_DOCX_EXTENSIONS):
        return "docx"
    return None


@router.post("/parse", response_model=ParseResponse)
async def parse(file: UploadFile = File(...)):
    raw = await file.read()
    mime = file.content_type or ""
    filename = file.filename or ""

    kind = _detect_kind(mime, filename)
    if kind is None:
        return JSONResponse(
            status_code=400,
            content={
                "error": "unsupported_mime",
                "mime": mime,
                "filename": filename,
                "supported": ["application/pdf", ".docx"],
            },
        )

    try:
        if kind == "pdf":
            result = extract_pdf(raw)
        else:
            result = extract_docx(raw)
    except Exception as err:  # noqa: BLE001 — surface real extractor failures as 422
        logger.warning(
            "parse failed: filename=%s mime=%s kind=%s err=%s",
            filename, mime, kind, err,
        )
        return JSONResponse(
            status_code=422,
            content={
                "error": "extraction_failed",
                "kind": kind,
                "detail": str(err),
            },
        )

    return ParseResponse(
        markdown=result.markdown,
        metadata=ParseMetadata(
            pageCount=result.page_count,
            headings=[
                Heading(level=h.level, text=h.text, pageStart=h.pageStart)
                for h in result.headings
            ],
            tableCount=result.table_count,
            parserVersion=PARSER_VERSION,
            sourceMimeType=mime or (
                "application/pdf" if kind == "pdf"
                else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            ),
        ),
    )
