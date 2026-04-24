# Fix Interview Guide PDF

## Background

The user asked to use the PDF tooling and the current project implementation to
fix the original interview guide PDF at:

`/Users/hongxichen/Downloads/interview/autonomous_investment_platform_interview_guide.pdf`

The repository is the source of truth. The closest source document found in the
repository is `docs/technical-guides/autonomous-investment-platform-interview-guide.md`.

## Goal

Revise the original interview guide PDF so its claims match the current
FinSentinel implementation in this repository.

## Scope

- Inspect the current guide PDF and repository guide source.
- Compare guide claims against current implementation, tests, and docs.
- Make the smallest practical correction to the original PDF.
- Preserve enough evidence to reproduce or audit the correction.
- Re-check the RAG section against the current retrieval, ingestion,
  enrichment, rollout, and evaluation implementation before regenerating the
  PDF again.

Out of scope:

- Redesigning the guide layout.
- Rewriting unrelated interview content.
- Adding speculative project claims that are not evidenced in the repository.

## Assumptions

- "原件 pdf" means the file in `/Users/hongxichen/Downloads/interview/` should
  be updated in place, with a timestamped backup kept next to it.
- The repository Markdown guide is the intended durable source for this PDF.
- No dedicated `pdf` skill file is available in this Codex session; PDF work
  will use the bundled workspace PDF dependencies and repository PDF/parser
  implementation as references.
- If the existing PDF differs only by being stale, regenerating the full PDF
  from the corrected Markdown is safer than binary patching individual PDF
  streams.

## Uncertainties

- The PDF generation method used for the current original PDF is not yet known.
- The set of stale claims is not yet known; it must be derived from repository
  evidence.

## Implementation Steps

1. Extract text and metadata from the original PDF.
   Verify: page count and extracted text are readable.
2. Compare the extracted PDF text with the repository Markdown guide.
   Verify: identify whether the PDF is stale, reformatted, or materially
   different.
3. Check high-risk claims against current code/tests/docs.
   Verify: each changed claim links back to repository files or tests.
4. Update the durable Markdown guide if needed.
   Verify: diff only contains source-of-truth corrections.
5. Regenerate or patch the original PDF.
   Verify: corrected PDF text contains the updated claims and the backup exists.
6. Run targeted repository verification.
   Verify: relevant PDF/report/parser tests pass, or failures are documented.

## Verification Approach

- Text extraction before and after PDF changes.
- Focused repository tests around PDF/report/parser behavior where applicable.
- File metadata check for original PDF and backup.

## Progress Log

- 2026-04-21: Confirmed target PDF exists, is PDF 1.7, and has 87 pages.
- 2026-04-21: Found repository guide source at
  `docs/technical-guides/autonomous-investment-platform-interview-guide.md`.
- 2026-04-21: Found repository PDF generation service at
  `apps/api/src/common/services/pdf.service.ts` and real PDF parser sidecar at
  `services/parser/extractors/pdf_extractor.py`.
- 2026-04-21: Extracted the original PDF text with `pdfplumber`. `pypdf`
  reported 40 real pages; the `file` utility reported 87 pages and was not used
  as the authoritative page-count check.
- 2026-04-21: Identified the main PDF defect: the LibreOffice-generated PDF
  continued ordered-list numbering across unrelated lists. Examples included
  "这个项目解决什么问题" starting at 4 and later drill lists reaching 60+.
- 2026-04-21: The repository Markdown source already had correct numbering, so
  no guide content rewrite was needed.
- 2026-04-21: Added
  `docs/technical-guides/autonomous-investment-platform-interview-guide-print.css`
  to make the PDF rendering path reproducible and avoid relying on the stale
  LibreOffice output.
- 2026-04-21: Rendered Markdown to standalone HTML with `pandoc`, then printed
  the HTML to PDF with headless Chrome using `--no-pdf-header-footer`.
- 2026-04-21: Backed up the original PDF to
  `/Users/hongxichen/Downloads/interview/autonomous_investment_platform_interview_guide.backup-20260421-0312.pdf`
  and replaced
  `/Users/hongxichen/Downloads/interview/autonomous_investment_platform_interview_guide.pdf`.
- 2026-04-21: Verified the replacement PDF with `pdfplumber`: 35 pages, no
  Chrome header/footer text, problem list starts at 1, drill answer formula is
  1-3, code-location drill is 1-10, and the bad 60+/63+ numbering is absent.
- 2026-04-21: Verified replacement PDF with `pypdf`: 35 pages and Chrome/Skia
  PDF metadata.
- 2026-04-21: Ran `pnpm --filter @finsentinel/api test -- pdf.service`. Vitest
  executed the API suite; result: 165 test files passed, 1 skipped; 1491 tests
  passed, 1 skipped.
- 2026-04-21: User requested a deeper RAG-design review before correcting the
  PDF content. Re-opened this plan because the prior pass fixed PDF rendering
  only; the RAG content itself also needed to be brought up to date.
- 2026-04-21: Reviewed current RAG retrieval code:
  `rag-retrieval.service.ts`, `retrieval-planner.service.ts`,
  `retrieval-orchestrator.service.ts`, `sparse-search.service.ts`,
  `metadata-pre-filter.service.ts`, `query-entity-extractor.service.ts`,
  `rerank.service.ts`, `context-expander.service.ts`, `context-packer.service.ts`,
  `graph-retrieval.service.ts`, `rag-trace.service.ts`, `rollout-gate.service.ts`,
  and `shadow-runner.service.ts`.
- 2026-04-21: Reviewed current ingestion/enrichment code:
  `document-vector.service.ts`, `document-chunking.service.ts`,
  `document-parse.service.ts`, `parser-sidecar.client.ts`,
  `vectorize.consumer.ts`, `representation-enrich.consumer.ts`,
  `chunk-representation.service.ts`, `graph-enrich.consumer.ts`, and the real
  parser sidecar under `services/parser/`.
- 2026-04-21: Reviewed current evaluation evidence:
  `services/evaluation-runner/configs/wave2-buckets.yaml`,
  `reports/p1-offline-baseline-2026-04-21.json`, and
  `reports/p1-wave2-buckets-verify-2026-04-21.json`. The guide may claim an
  offline quality gate exists, but must not treat it as live API or latency
  evidence.
- 2026-04-21: Identified stale RAG guide content: it described an early
  dense+sparse/RRF design but omitted query classes and variants, exact lookup
  rewrite gating, representation search, sparse representation vectors,
  metadata soft/hard routing with downgrade, parser sidecar behavior,
  context-expansion gating, trace/shadow/canary rollout, and the current
  limitations around graph relations, OCR, sectors/regions, and live-API eval.
- 2026-04-21: Updated
  `docs/technical-guides/autonomous-investment-platform-interview-guide.md` so
  the RAG chapter, system overview, code map, metrics notes, Q&A, and 60-second
  drill now match the current RAG implementation and caveats.
- 2026-04-21: Backed up the current fixed PDF to
  `/Users/hongxichen/Downloads/interview/autonomous_investment_platform_interview_guide.backup-before-rag-correction-20260421-035553.pdf`.
- 2026-04-21: Regenerated the PDF from the updated Markdown with the same
  `pandoc` + headless Chrome print path and replaced
  `/Users/hongxichen/Downloads/interview/autonomous_investment_platform_interview_guide.pdf`.
- 2026-04-21: Verified the regenerated PDF with `pdfjs-dist`: 41 pages,
  49,277 extracted text characters, no Chrome header/footer, all RAG correction
  markers present, and stale early-RAG markers absent. The `file` utility again
  reported an unreliable page count and was not used as authoritative.
- 2026-04-21: Ran
  `pnpm --filter @finsentinel/api test -- src/rag/__tests__/retrieval-planner.service.spec.ts src/rag/__tests__/retrieval-orchestrator.service.spec.ts src/rag/__tests__/sparse-search.service.spec.ts src/rag/__tests__/metadata-pre-filter.service.spec.ts src/rag/__tests__/rag-retrieval.service.spec.ts src/rag/__tests__/context-expander.service.spec.ts src/rag/__tests__/rerank.service.spec.ts src/document/__tests__/parser-sidecar.client.spec.ts src/document/__tests__/document-vector.service.spec.ts src/document/__tests__/document-chunking.service.spec.ts src/queue/__tests__/vectorize.consumer.pdf.spec.ts`.
  Vitest ran the full API suite under the project config; result: 165 test files
  passed, 1 skipped; 1491 tests passed, 1 skipped.

## Key Decisions

- Treat repository evidence as authoritative over any PDF content.
- Prefer full regeneration from repository Markdown if the PDF is stale.
- Do not use `apps/api/src/common/services/pdf.service.ts` for this guide
  export because it is intentionally text-forward and Helvetica-based; it is not
  the right renderer for a Chinese, interview-facing formatted guide.
- Use the current repository Markdown as content source and add a versioned
  print stylesheet so the fixed PDF can be regenerated without LibreOffice list
  auto-numbering behavior.
- Treat RAG Wave 2 implementation and tests as the authoritative design for the
  interview guide. Older design docs are useful background, but the corrected
  PDF must describe current code paths and current caveats.

## Risks and Blockers

- Replacing the original PDF can lose formatting if the original was generated
  by an external editor not represented in the repository.
- The repository PDF service is text-forward and may not preserve rich layout.
  If layout preservation is important, use a local document/PDF rendering path
  instead of the API service renderer.

## Final Outcome

Completed. The original PDF path now contains a regenerated PDF whose RAG
content reflects the current implementation. The earlier original PDF and the
pre-RAG-correction fixed PDF are both preserved as timestamped backups. The
repository contains the corrected Markdown source, the reproducible print
stylesheet, and this execution record.
