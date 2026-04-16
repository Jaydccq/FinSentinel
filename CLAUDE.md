# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FinSentinel is an AI-assisted investment research and risk platform built as a TypeScript monorepo. The active stack is NestJS for the API, Next.js for the web app, Drizzle for schema management, and shared TypeScript contracts in workspace packages.

The LLM is accessed through OpenRouter/OpenAI-compatible APIs. Financial calculations, trading flows, RAG, and agent orchestration all live in the TypeScript workspace.

## Build & Run Commands

```bash
pnpm --filter @finsentinel/api dev
pnpm --filter @finsentinel/web dev
pnpm typecheck
pnpm test
pnpm build
```

**Targeted checks:**
```bash
pnpm --filter @finsentinel/api test
pnpm --filter @finsentinel/api typecheck
pnpm --filter @finsentinel/web typecheck
pnpm --filter @finsentinel/web lint
```

## Architecture

### Core Agent Flow

```
User query → Persona prompt → tool orchestration
  → Parallel tool execution (market data, technicals, portfolio, news)
  → RAG retrieval (pgvector with metadata filters)
  → Structured RiskReport output → SSE stream to frontend
```

### Backend Package Layout (`apps/api/src/`)

```
agent/              → agent orchestration, tools, personas
auth/               → JWT auth, guards, decorators, controller/service
chat/               → chat APIs and orchestration
common/             → shared modules, filters, guards, services, controllers
config/             → typed runtime configuration
document/           → upload, parsing, chunking, vectorization
market/             → market calendar and market-domain services
news/               → fetchers, enrichment, news APIs
okx/                → OKX integrations
portfolio/          → portfolio APIs and business logic
queue/              → async producers and queue integration
rag/                → retrieval, embeddings, backfill, reindexing
research/           → research providers and APIs
storage/            → RustFS / hybrid storage
trading/            → brokers, engines, unified trading
twitter/            → X/Twitter integrations
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
- `AlpacaTradingEngine` — US equities via Alpaca API
- `CcxtTradingEngine` — crypto via CCXT-compatible integration

The unified trading layer orchestrates the stage→commit→execute lifecycle and emits events.

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

### Persona System

Three personas are maintained directly in the TypeScript code under `apps/api/src/agent/personas/`:
- **default** — balanced quantitative analyst
- **conservative** — capital-preservation focused
- **aggressive** — growth-oriented alpha seeker

### RAG Pipeline

```
Scraper → Document (DB) + PDF (RustFS) → VectorizeStreamProducer → Redis Stream
  → VectorizeStreamConsumer → Tika parse → chunk (TokenTextSplitter) → embed (1536d) → pgvector
```

Retrieval: cosine similarity threshold 0.65, metadata filters (doc_type, sector, region_id, date).

### Chat Compaction

`ChatContextCompactionService` compresses conversation history when it exceeds threshold (default 24 messages). Uses LLM to generate summary, keeps recent window (default 10 messages) uncompacted. Stores summaries in `ChatSessionMemory` entity.

### 6551.io Crypto News & Twitter Integration

Two external data sources from 6551.io platform are integrated as native TypeScript services:

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

All config is supplied via environment variables:
- **PostgreSQL + pgvector**
- **Redis**
- **RustFS**
- **Google Drive** optional cold archival tier
- **OpenRouter / model providers**

### Frontend (`apps/web`)

Next.js App Router frontend with typed API modules, auth/i18n providers, and trading/news/portfolio views.

### Desktop (`apps/desktop`)

Tauri 2.x shell that loads `apps/web` as a static export and adds a Rust-native
private-document indexer (SQLite + sqlite-vec + fastembed-rs, fully offline). Private
documents are indexed locally and never synced to the cloud. Frontend uses
`hybridSearch()` in `apps/web/src/lib/rag/` to merge local and cloud RAG results with
provenance tagging.

Build flag: `NEXT_PUBLIC_TAURI=1` makes `apps/web` emit `output: 'export'` and disables
`rewrites()` (static export is incompatible with rewrites). In browser dev/prod,
`NEXT_PUBLIC_TAURI` is unset and the app uses `output: 'standalone'` with the existing
rewrite to NestJS.

### Docker

`docker-compose.yml` orchestrates the active TypeScript stack: API, web, PostgreSQL, Redis, RustFS, Prometheus, and Grafana.

## Conventions

- Shared contracts belong in `packages/shared`
- Database schema definitions belong in `packages/db`
- Keep controller layers thin and push domain logic into services
- Use typed config modules instead of stringly typed configuration access
- Trading operations must emit `AgentEvent` entries for audit trail
- Integration tests may require local infrastructure; keep unit tests isolated where practical

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

Available skills:
- `/office-hours` — structured office hours sessions
- `/plan-ceo-review` — prepare plans for CEO review
- `/plan-eng-review` — prepare plans for engineering review
- `/plan-design-review` — prepare plans for design review
- `/design-consultation` — design consultation sessions
- `/review` — code review
- `/ship` — ship code to production
- `/land-and-deploy` — land and deploy changes
- `/canary` — canary deployment
- `/benchmark` — performance benchmarking
- `/browse` — headless browser for QA testing and web browsing
- `/qa` — quality assurance testing
- `/qa-only` — QA testing only (no implementation)
- `/design-review` — design review sessions
- `/setup-browser-cookies` — configure browser cookies for testing
- `/setup-deploy` — configure deployment settings
- `/retro` — retrospective sessions
- `/investigate` — investigate issues and incidents
- `/document-release` — document a release
- `/codex` — Codex integration
- `/cso` — chief strategy officer planning
- `/autoplan` — automatic planning
- `/careful` — careful mode for risky operations
- `/freeze` — freeze deployments
- `/guard` — guard against regressions
- `/unfreeze` — unfreeze deployments
- `/gstack-upgrade` — upgrade gstack
