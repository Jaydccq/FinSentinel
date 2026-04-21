"""Integration tests for the real PDF / DOCX extractors.

Runs against fixtures under tests/fixtures/ which are committed to the
repo. Fixtures are regenerable via tests/generate_fixtures.py from
corpus.json, so ground truth (heading count, table count) is stable.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import app


FIXTURES = Path(__file__).parent / "fixtures"
client = TestClient(app)


# --- raw-bytes extractor tests ----------------------------------------------


def test_extract_pdf_multiheading():
    from extractors.pdf_extractor import extract_pdf
    result = extract_pdf((FIXTURES / "aapl-sample.pdf").read_bytes())
    # Ground truth: PART I + 3 ITEM headings = 4 headings, 1 page.
    heading_texts = {h.text for h in result.headings}
    assert "PART I" in heading_texts
    assert any("ITEM 1" in t for t in heading_texts)
    assert len(result.headings) >= 3
    assert result.page_count >= 1
    assert "Apple" in result.markdown  # body content survived


def test_extract_pdf_with_table():
    from extractors.pdf_extractor import extract_pdf
    result = extract_pdf((FIXTURES / "nvda-table.pdf").read_bytes())
    assert result.table_count >= 1
    # Ground truth: table header "Segment" + "FY2025 $B" + "YoY %"
    assert "Segment" in result.markdown
    assert "Data Center" in result.markdown
    assert result.page_count >= 2  # PageBreak in fixture


def test_extract_docx_headings_and_table():
    from extractors.docx_extractor import extract_docx
    result = extract_docx((FIXTURES / "sample-memo.docx").read_bytes())
    heading_texts = {h.text for h in result.headings}
    assert "Microsoft AI Strategy Memo FY2025" in heading_texts
    assert "Azure Growth" in heading_texts
    assert "Capital Intensity" in heading_texts
    assert result.table_count >= 1
    assert "Azure" in result.markdown


# --- FastAPI endpoint tests -------------------------------------------------


def _upload(path: Path, mime: str):
    with open(path, "rb") as fh:
        return client.post(
            "/parse",
            files={"file": (path.name, fh, mime)},
        )


def test_parse_endpoint_pdf_returns_non_stub_payload():
    resp = _upload(FIXTURES / "aapl-sample.pdf", "application/pdf")
    assert resp.status_code == 200
    body = resp.json()
    assert body["metadata"]["parserVersion"] != "stub-0.1"
    assert len(body["metadata"]["headings"]) >= 3
    assert "Stub parser output" not in body["markdown"]
    assert body["metadata"]["sourceMimeType"] == "application/pdf"


def test_parse_endpoint_docx():
    resp = _upload(
        FIXTURES / "sample-memo.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["metadata"]["tableCount"] >= 1
    assert len(body["metadata"]["headings"]) >= 2
    assert "Azure" in body["markdown"]


def test_parse_endpoint_unsupported_mime_returns_400():
    with open(FIXTURES / "aapl-sample.pdf", "rb") as fh:
        resp = client.post(
            "/parse",
            files={"file": ("random.xyz", fh, "application/x-custom")},
        )
    assert resp.status_code == 400
    body = resp.json()
    assert body["error"] == "unsupported_mime"
    assert "supported" in body


def test_parse_endpoint_malformed_pdf_returns_422():
    resp = client.post(
        "/parse",
        files={"file": ("broken.pdf", b"not a real pdf", "application/pdf")},
    )
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"] == "extraction_failed"


def test_health_endpoint_reports_real_parser_version():
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["version"] != "stub-0.1"
    assert "pdfplumber" in body["version"]
