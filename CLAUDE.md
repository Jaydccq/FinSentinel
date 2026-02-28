# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FinSentinel is an AI-powered investment risk assessment agent built with Spring Boot 4.0 and Spring AI 2.0. It uses an **AI Agent pattern** — the LLM orchestrates tool calls for real-time market data, technical analysis, RAG retrieval, trading operations, and compliance checks, then synthesizes structured risk reports.

The LLM is Google Gemini 3 Flash Preview accessed via OpenRouter's OpenAI-compatible API. Financial calculations (RSI, MACD, Bollinger, etc.) use the Ta4j Java library — never the LLM.

## Build & Run Commands

```bash
./gradlew compileJava          # Compile only
./gradlew build                # Full build with tests
./gradlew bootRun              # Run the application
./gradlew test                 # Run all tests
./gradlew test --tests "com.example.finsentinel.service.AuthServiceTest"  # Single test class
```

**Unit tests only** (no infrastructure required):
```bash
./gradlew test --tests "com.example.finsentinel.util.*" \
  --tests "com.example.finsentinel.service.*" \
  --tests "com.example.finsentinel.agent.*" \
  --tests "com.example.finsentinel.controller.*" \
  --tests "com.example.finsentinel.security.*" \
  --tests "com.example.finsentinel.config.*"
```

Gradle 9.3.0, Java 21, Spring AI BOM managed via `spring-ai-bom:2.0.0-M2` (milestone repo at `repo.spring.io/milestone`).

## Architecture

### Core Agent Flow

```
User query → Persona prompt (RISEN framework) → ChatClient with up to 19 tool beans
  → Parallel tool execution (market data, technicals, portfolio, news, compliance)
  → RAG retrieval (pgvector with metadata filters)
  → Compliance guardrails advisor
  → Structured RiskReport output → SSE stream to frontend
```

The agent is configured in `agent/AgentConfig.java` — a single `ChatClient` bean wired with all tools and advisors.

### Backend Package Layout (`src/main/java/com/example/finsentinel/`)

```
config/             → @ConfigurationProperties beans (JwtProperties, PolygonProperties,
                      TradingProperties, AutonomyProperties, McpServerProperties, etc.)
security/           → JWT filter chain + MCP API-key filter chain (dual @Order SecurityFilterChains)
model/              → JPA entities (User, Portfolio, Document, ChatMessage, NewsItem,
                      TradeWallet, AgentBrain, AgentEvent, AgentSchedule, AgentHeartbeatConfig)
dto/                → Java records organized by domain: auth/, chat/, portfolio/, risk/, trading/
service/trading/    → Paper trading (stage→commit→execute), TradingEngine abstraction,
                      Alpaca/CCXT broker engines, AgentBrainService (cognitive state)
service/autonomy/   → Cron scheduling, heartbeat monitoring, event-driven task execution
service/event/      → Append-only AgentEvent sourcing (audit trail)
service/chat/       → ChatContextCompactionService (LLM-summarized history compression)
service/openbb/     → OpenBB Platform integration for macro/calendar/ownership/short-interest data
service/scraper/    → SEC EDGAR, Polygon News, Investopedia scrapers
service/news/       → Real-time news pipeline (Polygon, RSS, X influencers)
service/rag/        → RAG retrieval (pgvector cosine similarity) + document chunking
service/storage/    → Tiered storage: RustFS (hot) → Google Drive (cold) via HybridStorageService
stream/             → Redis Streams: vectorize (doc→embeddings) + news-enrich (article→RAG)
agent/tool/         → up to 19 Spring AI @Tool classes (32 stateless + user-context tools)
agent/advisor/      → RAG retrieval advisor, compliance guardrails, user context injection
controller/         → REST endpoints + SSE streaming + GlobalExceptionHandler
```

### Trading Subsystem

Git-like three-phase workflow inspired by OpenAlice:

```
Stage (Redis staging area, 30-min TTL)
  → Commit (immutable commit with rationale, SHA-256 hash, capped at 100)
  → Execute (simulated or live via TradingEngine)
```

**TradingEngine** interface abstracts broker differences:
- `PaperTradingEngine` — in-memory simulation against live market prices
- `AlpacaTradingEngine` — US equities via Alpaca API (REST)
- `CcxtTradingEngine` — crypto via XChange library (Binance, etc.)

`TradingEngineFactory` selects engine based on config priority. `PaperTradingService` orchestrates the stage→commit→execute lifecycle and emits events.

### Autonomy System

```
AgentScheduleService (CRUD for user cron tasks)
  → AgentScheduleRegistry (runtime TaskScheduler ↔ DB sync, @PostConstruct bootstrap)
  → AgentScheduledTaskExecutor (routes: PORTFOLIO_REVIEW, MARKET_PULSE, BRAIN_REVIEW, HEARTBEAT_WAKEUP)

HeartbeatDispatcher (@Scheduled at configurable interval)
  → AgentHeartbeatService (per-user portfolio health checks, drawdown alerts)
```

All operations emit `AgentEvent` entries to the append-only event log.

### Event Sourcing

`AgentEvent` entity — append-only, immutable (blocks `@PreUpdate`). 28 event types across 7 aggregate types (CHAT_SESSION, TRADE_WALLET, AGENT_BRAIN, SCHEDULE, HEARTBEAT, etc.). Supports idempotent writes via `idempotencyKey` and replay via `replayAfter(userId, afterSeqNo)`.

### MCP Server Integration

When `MCP_SERVER_ENABLED=true`, exposes 32 stateless market-data tools via SSE transport at `/mcp/**`:

- `@Order(1)` SecurityFilterChain for `/mcp/**` with `McpApiKeyAuthFilter` (X-API-Key header → synthetic UserPrincipal)
- `@Order(2)` existing JWT chain for `/api/**`
- `McpToolConfig` registers 10 stateless tool classes via `MethodToolCallbackProvider`
- Excluded from MCP: TradingTool, BrainTool, UserProfileTool, AutonomyTool, PortfolioAnalysisTool, ThinkingTool, ConfirmationTool (require user context)

Claude Desktop config: `{"mcpServers":{"finsentinel":{"url":"http://localhost:8080/mcp/sse","headers":{"X-API-Key":"..."}}}}`

### Persona System

Three personas in `src/main/resources/prompts/personas/` (StringTemplate `.st` files):
- **default** — balanced quantitative analyst
- **conservative** — capital-preservation focused, worst-case assumptions
- **aggressive** — growth-oriented alpha seeker, momentum-biased

Selected via `APP_AGENT_PERSONA` env var. All follow RISEN framework (Role, Instructions, Steps, Expectations, Narrowing).

### RAG Pipeline

```
Scraper → Document (DB) + PDF (RustFS) → VectorizeStreamProducer → Redis Stream
  → VectorizeStreamConsumer → Tika parse → chunk (TokenTextSplitter) → embed (1536d) → pgvector
```

Retrieval: cosine similarity threshold 0.65, metadata filters (doc_type, sector, region_id, date).

### Chat Compaction

`ChatContextCompactionService` compresses conversation history when it exceeds threshold (default 24 messages). Uses LLM to generate summary, keeps recent window (default 10 messages) uncompacted. Stores summaries in `ChatSessionMemory` entity.

### 6551.io Crypto News & Twitter Integration

Two external data sources from 6551.io platform, integrated as native Java services:

**Crypto News Pipeline** (gated by `APP_CRYPTO_NEWS_ENABLED=true`):
```
6551 API (POST /open/news_search) → CryptoNewsFetcher (AI score ≥ 70 filter)
  → NewsFetcherService polling → NewsItem DB → NewsEnrichConsumer → RAG vectorization
```

- `CryptoNewsApiClient` — REST client for `ai.6551.io`, Bearer token auth
- `CryptoNewsFetcher` — implements `NewsFetcher` interface, auto-discovered by `NewsFetcherService`
- `CryptoNewsTool` — agent tool for real-time crypto news queries with score/signal filtering
- Only high-quality articles (AI score ≥ 70) enter the pipeline to avoid RAG noise

**Twitter/X Data** (gated by `APP_TWITTER_6551_ENABLED=true`):
- `TwitterDataService` — REST client for 6551 Twitter API (profiles, tweets, KOL tracking)
- `TwitterTool` — agent tool for real-time Twitter queries (no DB storage, query-only)

**News Archival** (gated by `APP_ARCHIVAL_ENABLED=true` + `app.storage.provider=hybrid`):
- `NewsArchivalService` — cron job (default 2 AM daily) moves old enriched news PDFs from RustFS → Google Drive
- Retention: 7 days hot, then cold archived
- pgvector embeddings retained permanently — RAG search works transparently via `HybridStorageService` fallback

**Environment variables:**
- `CRYPTO_NEWS_6551_TOKEN` — 6551.io API token for crypto news
- `TWITTER_6551_TOKEN` — 6551.io API token for Twitter data
- `CRYPTO_NEWS_MIN_SCORE` — minimum AI score threshold (default 70)

### Infrastructure

All config via environment variables (`.env` file, not committed):
- **PostgreSQL + pgvector**: JPA entities + vector store (HNSW index, cosine distance, 1536 dims)
- **Redis**: Market data cache + Streams (`stream:vectorize`, `stream:news-enrich`) + rate limiting (Lua) + trade staging area
- **RustFS**: S3-compatible hot storage for RAG documents
- **Google Drive**: Optional cold archival tier
- **OpenRouter**: `base-url: https://openrouter.ai/api` (Spring AI appends `/v1`)
- **Flyway**: Migrations V1–V5 in `src/main/resources/db/migration/`

### Frontend (`/frontend`)

React 18 + TypeScript + Vite + Tailwind CSS 4.1. SSE client for streaming AI responses and real-time news. Recharts for risk radar visualization. Glassmorphism design.

### Docker

`docker-compose.yml` orchestrates: backend (Java 21), frontend (Nginx + SSE proxy), PostgreSQL + pgvector, Redis, RustFS.

## Conventions

- DTOs are Java records (not classes)
- Entities use Lombok `@Builder` pattern with `@RequiredArgsConstructor` for DI
- `@ConfigurationProperties` for all external config (never raw `@Value`)
- Database JSON columns use `@JdbcTypeCode(SqlTypes.JSON)` with `jsonb` column type
- Financial precision: `BigDecimal` with `precision=15, scale=2` (or `scale=6` for quantities)
- Compliance region is `US` (SEC). Every AI output must include a regulatory disclaimer.
- Shared utilities go in `util/` package (e.g., `SectorMapper.fromTicker()`, `NumberUtils.toBigDecimal()`)
- Scrapers must: (1) dedup via `existsByOriginalFileName()`, (2) call `VectorizeStreamProducer.send(docId)` after save
- News fetchers must: (1) dedup via `existsBySourceAndSourceId()`, (2) return `RawNewsItem` records
- Trading operations must emit `AgentEvent` entries for audit trail
- Spring Boot 4.0 relocated package: `org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc`
- Spring AI 2.0-M2: `MethodToolCallbackProvider` is in `org.springframework.ai.tool.method` (not `org.springframework.ai.tool`)
- Integration tests require running infrastructure; unit tests use Mockito standalone
- Redis Streams use consumer groups: `vectorize-group`, `news-enrich-group`
- `@ConditionalOnProperty` gates optional subsystems (MCP, OpenBB, X scraper, Google Drive)
