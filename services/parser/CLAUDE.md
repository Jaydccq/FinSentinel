This sidecar implements real PDF + DOCX extraction as of 2026-04-21
(P4 of `docs/exec-plans/2026-04-21-rag-quality-next-steps.md`).

- **PDF** — `pdfplumber` with a heading heuristic (ALL-CAPS short
  lines, SEC-style `PART ` / `ITEM `, numbered `1.2` prefixes).
  Extracts tables as Markdown. No OCR for scanned-only PDFs — the
  text layer comes through as empty but the endpoint stays 200.
- **DOCX** — `python-docx` walking `body` in document order. Maps
  Heading 1..6 + Title to Markdown heading levels. Renders tables as
  Markdown pipes.

Unsupported MIME types return 400 with a structured `unsupported_mime`
payload; genuine extractor errors return 422. The API's
representation-enrichment pipeline handles both by skipping the doc
and logging.

Regenerate fixtures with:
  cd services/parser && .venv/bin/python tests/generate_fixtures.py

Follow-up (still open): OCR fallback for scanned-only PDFs. Not
currently required by the eval buckets, but filed as tech debt for
the R5 work thread.
