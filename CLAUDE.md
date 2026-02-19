# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FinSentinel is an AI-powered investment risk assessment agent built with Spring Boot 4.0 and Spring AI 2.0. It uses an **AI Agent pattern** (not simple RAG chatbot) — the LLM orchestrates tool calls for real-time market data, technical analysis, RAG retrieval, and compliance checks, then synthesizes structured risk reports.

The LLM is Google Gemini 3 Flash Preview accessed via OpenRouter's OpenAI-compatible API. Financial calculations (RSI, MACD) use the Ta4j Java library — never the LLM.

## Build & Run Commands

```bash
./gradlew compileJava          # Compile only
./gradlew build                # Full build with tests
./gradlew bootRun              # Run the application
./gradlew test                 # Run all tests
./gradlew test --tests "com.example.finsentinel.service.AuthServiceTest"  # Single test class
```

Gradle 9.3.0, Java 21, Spring AI BOM managed via `spring-ai-bom:2.0.0-M2` (milestone repo required).

## Architecture

### Backend (`src/main/java/com/example/finsentinel/`)

```
config/        → @Configuration beans + @ConfigurationProperties (JwtProperties, PolygonProperties, etc.)
security/      → JWT auth filter chain: JwtTokenProvider → JwtAuthenticationFilter → CustomUserDetailsService
model/         → JPA entities (User, Portfolio, Holding, Document, RiskReportEntity, ChatMessage)
model/enums/   → RiskLevel, RiskCategory, DocumentType (SEC_FILING, RESEARCH_REPORT, NEWS, REGULATION, OTHER), DocumentStatus
dto/           → Java records organized by domain: auth/, chat/, portfolio/, risk/
repository/    → Spring Data JPA interfaces
service/       → Business logic (AuthService, etc.)
service/scraper/ → Web scrapers: SecEdgarScraper, PolygonNewsScraper, InvestopediaScraper, FirecrawlClient, KnowledgeBaseScraperService
service/rag/   → RAG pipeline: RagRetrievalService (semantic search with metadata + temporal filtering), DocumentChunkingService
service/document/ → DocumentParseService (Tika), DocumentUploadService
service/storage/  → RustfsStorageService (S3-compatible object storage via RustFS)
stream/        → Redis Streams: VectorizeStreamProducer/Consumer for async document vectorization
util/          → SectorMapper (ticker→sector mapping), MarkdownToPdfConverter
agent/tool/    → Spring AI Function Calling tools (StockMarketTool, TechnicalIndicatorTool, NewsAnalysisTool, etc.)
agent/advisor/ → Spring AI advisors (RAG retrieval, compliance guardrails)
agent/output/  → BeanOutputConverter for structured output (RiskReport record)
controller/    → REST endpoints + SSE streaming + GlobalExceptionHandler
```

### AI Agent Flow

User query → Intent Recognition → Tool Selection → parallel execution of:
- `StockMarketTool` (Polygon.io real-time data)
- `TechnicalIndicatorTool` (Ta4j RSI/MACD/Bollinger)
- `PortfolioAnalysisTool` (DB holdings + allocation)
- `NewsAnalysisTool` (sentiment analysis)

→ RAG Retrieval (pgvector with metadata filters: doc_type, sector, region_id, date) → LLM Synthesis → Compliance Guardrails → Structured `RiskReport` output → SSE stream to frontend

### RAG Ingestion Pipeline

Scraper → Document entity (DB) + PDF (RustFS) → `VectorizeStreamProducer.send(docId)` → Redis Stream `stream:vectorize` → `VectorizeStreamConsumer` → Tika parse → chunk (TokenTextSplitter) → OpenAI embed (1536d) → pgvector store

**Scrapers** (all use deduplication via `DocumentRepository.existsByOriginalFileName()`):
- `SecEdgarScraper`: SEC EDGAR full-text search API → Firecrawl for content → PDF. Dynamic 6-month date range.
- `PolygonNewsScraper`: Polygon.io news API → Firecrawl for full article (falls back to description) → PDF.
- `InvestopediaScraper`: Firecrawl dictionary index → scrape individual term pages → PDF. Classified as `RESEARCH_REPORT`.
- `KnowledgeBaseScraperService`: Orchestrates all 3 scrapers in parallel via `CompletableFuture`.

**RAG Retrieval** (`RagRetrievalService`):
- Semantic search with cosine similarity threshold 0.65
- Metadata filters: `doc_type`, `sector`, `region_id`, `date` (temporal filtering with `>=`)
- `NewsAnalysisTool.searchKnowledgeBase()` uses topK=8 with optional `afterDate` parameter

### Key Structured Output

The `RiskReport` record (`dto/risk/RiskReport.java`) is the primary AI output format, enforced via `BeanOutputConverter`:
- `riskScore` (1-100), `riskLevel` (LOW/MEDIUM/HIGH/CRITICAL)
- `List<RiskFactor>` with per-category scores
- `ComplianceNote` with SEC disclaimer and compliance flag

### Infrastructure

All config via environment variables (`.env` file, not committed):
- **PostgreSQL + pgvector**: JPA entities + vector store (HNSW index, cosine distance, 1536 dims)
- **Redis**: Market data caching (TTL-based to respect API rate limits)
- **S3/RustFS**: Document storage for RAG pipeline
- **OpenRouter**: `base-url: https://openrouter.ai/api/v1`, model configured via `AI_MODEL` env var

### Security

JWT-based stateless auth. All endpoints require authentication except `/api/auth/**`. CORS configured for `localhost:5173` (Vite dev server) and `localhost:3000`.

### Frontend (`/frontend`)

React 18 + TypeScript + Vite + Tailwind CSS 4.1. SSE client for streaming AI responses. Recharts for risk radar visualization. Pages: Dashboard, Chat, Portfolio, Documents, Reports, Login/Register. Glassmorphism design with gradient accents.

### Docker

`docker-compose.yml` orchestrates: backend (Java 21), frontend (Nginx + SSE proxy), PostgreSQL + pgvector, Redis, RustFS.

## Conventions

- DTOs are Java records (not classes)
- Entities use Lombok `@Builder` pattern with `@RequiredArgsConstructor` for DI
- `@ConfigurationProperties` for all external config (never raw `@Value`)
- Database JSON columns use `@JdbcTypeCode(SqlTypes.JSON)` with `jsonb` column type
- Financial precision: `BigDecimal` with `precision=15, scale=2` (or `scale=6` for quantities)
- Compliance region is `US` (SEC). Every AI output must include a regulatory disclaimer.
- Shared utilities go in `util/` package (e.g., `SectorMapper.fromTicker()` for ticker→sector mapping)
- Scrapers must: (1) dedup via `existsByOriginalFileName()`, (2) call `VectorizeStreamProducer.send(docId)` after save
- Spring Boot 4.0 uses relocated packages: `org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc` (not `...test.autoconfigure.web.servlet`)
- Integration tests require running infrastructure (PostgreSQL, Redis, RustFS); unit tests use Mockito and run standalone


<claude-mem-context>
# Recent Activity

<!-- This section is auto-generated by claude-mem. Edit content outside the tags. -->

### Feb 15, 2026

| ID | Time | T | Title | Read |
|----|------|---|-------|------|
| #357 | 4:20 AM | 🔵 | Technical Documentation Directory with Spring AI and RAG Implementation Guides | ~760 |
| #295 | 4:03 AM | 🔵 | Minimal Spring Boot Application Scaffold Created | ~284 |
</claude-mem-context>