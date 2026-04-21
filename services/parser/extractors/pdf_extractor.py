"""PDF extractor backed by pdfplumber.

Design notes (informed by the P4.1 bakeoff rationale):
  - pdfplumber is pip-installable and has no commercial dependency —
    matches the plan's decision criterion.
  - Heading detection is heuristic (ALL-CAPS short lines, numbered
    prefixes like "PART I" / "ITEM 1A."). Good enough for SEC filings
    and most financial reports. Not a replacement for MinerU-quality
    structure extraction; re-evaluate if retrieval quality on real
    10-Ks regresses on the long_doc bucket.
  - Tables are rendered as Markdown tables. Scanned-PDF OCR is NOT in
    scope here; the stub's behavior (return what text layer exists)
    is preserved for image-only pages via `page.extract_text() or ""`.
"""

from __future__ import annotations

import io
from typing import List, Tuple

import pdfplumber

from .types import ExtractorResult, Heading


def extract_pdf(data: bytes) -> ExtractorResult:
    md_parts: List[str] = []
    headings: List[Heading] = []
    table_count = 0
    page_count = 0

    with pdfplumber.open(io.BytesIO(data)) as pdf:
        page_count = len(pdf.pages)
        for page_idx, page in enumerate(pdf.pages, start=1):
            page_md, page_headings, page_tables = _render_page(page, page_idx)
            headings.extend(page_headings)
            table_count += page_tables
            if page_md.strip():
                md_parts.append(page_md)

    return ExtractorResult(
        markdown="\n\n".join(md_parts),
        headings=headings,
        page_count=page_count,
        table_count=table_count,
    )


def _render_page(page, page_idx: int) -> Tuple[str, List[Heading], int]:
    """Render one page to Markdown + collect headings + count tables."""
    md_lines: List[str] = []
    headings: List[Heading] = []

    text = page.extract_text() or ""
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            md_lines.append("")
            continue
        level = _guess_heading_level(stripped)
        if level:
            headings.append(Heading(level=level, text=stripped, pageStart=page_idx))
            md_lines.append(f"{'#' * level} {stripped}")
        else:
            md_lines.append(stripped)

    # Tables (extract after text so they appear at the end of the page section).
    tables = page.extract_tables() or []
    for table in tables:
        rendered = _table_to_markdown(table)
        if rendered:
            md_lines.append("")
            md_lines.append(rendered)

    return "\n".join(md_lines), headings, len(tables)


def _guess_heading_level(line: str) -> int | None:
    """Heuristic heading detector.

    Returns heading level (1..3) or None when the line isn't a heading.
    Balances false positives (random ALL-CAPS financial-term phrases)
    against false negatives (missing genuine section titles).
    """
    if len(line) >= 80:
        return None

    # SEC 10-K structural markers — high-confidence level 2.
    if line.startswith(("PART ", "ITEM ")) and len(line) < 80:
        return 2

    # Single ALL-CAPS line of reasonable length → level 2.
    if line.isupper() and 2 <= line.count(" ") <= 10 and len(line) >= 4:
        return 2

    # Numbered heading like "1.2 FX Exposure" → level 3.
    if _looks_like_numbered_heading(line):
        return 3

    return None


def _looks_like_numbered_heading(line: str) -> bool:
    """True if line matches patterns like '1. Overview', '1.2 Risks'."""
    if not line or not line[0].isdigit():
        return False
    # Walk past digits/dots at the start.
    i = 0
    saw_digit = False
    while i < len(line) and (line[i].isdigit() or line[i] == "."):
        if line[i].isdigit():
            saw_digit = True
        i += 1
    if not saw_digit or i >= len(line):
        return False
    # Require a separator then text.
    if line[i] in (" ", "\t"):
        remainder = line[i + 1:].strip()
        return len(remainder) >= 2
    return False


def _table_to_markdown(table: List[List[str | None]]) -> str:
    """Render a pdfplumber-extracted table as a GitHub-flavored Markdown table."""
    if not table or not table[0]:
        return ""

    def cell(c: str | None) -> str:
        return (c or "").strip().replace("|", "\\|").replace("\n", " ")

    header_cells = [cell(c) for c in table[0]]
    width = len(header_cells)
    header = "| " + " | ".join(header_cells) + " |"
    sep = "| " + " | ".join("---" for _ in range(width)) + " |"

    body_rows: List[str] = []
    for row in table[1:]:
        padded = list(row) + [None] * (width - len(row))
        body_rows.append("| " + " | ".join(cell(c) for c in padded[:width]) + " |")

    return "\n".join([header, sep, *body_rows])
