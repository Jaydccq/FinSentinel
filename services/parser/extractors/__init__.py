"""Parser extractors — real MIME-dispatched implementations.

Public entry points:
    extract_pdf(data: bytes) -> ExtractorResult
    extract_docx(data: bytes) -> ExtractorResult

Replaces the pre-P4 stub at services/parser/routers/parse.py which
returned fixed Markdown for any input.
"""

from .types import ExtractorResult, Heading
from .pdf_extractor import extract_pdf
from .docx_extractor import extract_docx

__all__ = ["ExtractorResult", "Heading", "extract_pdf", "extract_docx"]
