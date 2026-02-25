# FinSentinel

AI-Powered Investment Risk Assessment & Compliance Agent

## Overview

FinSentinel is a full-stack intelligent investment risk assessment tool built with **Spring AI Agent architecture**. Unlike simple chatbots, the LLM orchestrates tool calls for real-time market data, technical analysis, RAG-based document retrieval, and compliance checks, then synthesizes structured risk reports.

## Architecture

```
                    React 19 + Vite 7 + Tailwind CSS 4
                    +----------------------------------+
                    |   Dashboard | Chat | Portfolio    |
                    |   Analysis | Documents | Reports  |
                    +--------------+-------------------+
                                   | SSE / REST
                    +--------------+-------------------+
                    |     Spring Boot 4.0 + Spring AI   |
                    |                                    |
                    |  +-- JWT Auth --- Rate Limiter --+ |
                    |  |                               | |
                    |  |  AI Agent Orchestrator         | |
                    |  |  +------------------------+   | |
                    |  |  | StockMarketTool        |   | |
                    |  |  | TechnicalIndicatorTool |   | |
                    |  |  | PortfolioAnalysisTool  |   | |
                    |  |  | NewsAnalysisTool       |   | |
                    |  |  | ComplianceCheckTool    |   | |
                    |  |  +------------------------+   | |
                    |  |                               | |
                    |  |  RAG Advisor (pgvector)        | |
                    |  |  Compliance Guardrails         | |
                    |  |  BeanOutputConverter->RiskReport| |
                    |  +-------------------------------+ |
                    +--+------+------+------+----------+
                       |      |      |      |
               +-------++ +--+---+ +-+----+ +-+--------+
               |Postgres| |Redis | |RustFS| |Polygon.io|
               |pgvector| |Cache | |S3    | |Market API|
               +--------+ +------+ +------+ +----------+
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript 5.9, Vite 7, Tailwind CSS 4, Framer Motion, Recharts |
| Backend | Spring Boot 4.0.2, Spring AI 2.0, Java 21 |
| AI Model | Google Gemini 3 Flash (via OpenRouter) |
| Database | PostgreSQL 17 + pgvector (HNSW, cosine, 1536d) |
| Cache | Redis 7 (market data TTL + rate limiting) |
| Storage | RustFS (S3-compatible, document uploads) |
| PDF Export | iText 8 |
| Security | JWT + Spring Security + @RateLimit AOP |

## Quick Start

### Prerequisites

- Docker & Docker Compose
- API keys: [OpenRouter](https://openrouter.ai), [Polygon.io](https://polygon.io)
- Optional OpenBB Public Data integration (run OpenBB API service separately)

### 1. Clone & Configure

```bash
git clone https://github.com/Jaydccq/FinSentinel.git
cd FinSentinel
cp .env.example .env
# Edit .env with your API keys
```

If you want OpenBB public-agency datasets (BLS/FRED/SEC/OECD/IMF/ECB/etc.), also configure:

```bash
APP_OPENBB_ENABLED=true
OPENBB_BASE_URL=http://localhost:6900
OPENBB_API_PREFIX=/api/v1
# Optional provider keys
OPENBB_BLS_API_KEY=
OPENBB_CONGRESS_GOV_API_KEY=
OPENBB_CFTC_APP_TOKEN=
OPENBB_FRED_API_KEY=
OPENBB_POLYGON_API_KEY=
OPENBB_US_EIA_API_KEY=
```

### 2. Start All Services

```bash
docker compose up -d
```

This starts: PostgreSQL + pgvector, Redis, RustFS, Backend (port 8080), Frontend (port 3000).

### 3. Access the App

- **Frontend:** http://localhost:3000
- **API:** http://localhost:8080/api
- **RustFS Console:** http://localhost:9001 (rustfsadmin / rustfsadmin)

### Demo Account

- Username: `demo`
- Password: `demo123`

## Development

### Backend

```bash
./gradlew bootRun          # Run with hot reload
./gradlew test             # Run all tests
./gradlew test --tests "com.example.finsentinel.integration.*"  # Integration tests
```

### Frontend

```bash
cd frontend
npm install
npm run dev                # Vite dev server (port 5173, proxies /api to 8080)
npm run build              # Production build
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login, returns JWT |
| POST | `/api/chat/stream` | SSE streaming AI chat |
| POST | `/api/chat/assess` | Synchronous risk assessment |
| GET | `/api/chat/sessions/{id}` | Chat session history |
| GET | `/api/events` | Typed agent event timeline/replay (`afterSeq`, `limit`) |
| GET/POST/PUT/DELETE | `/api/schedules` | User-managed autonomous cron tasks |
| POST | `/api/schedules/{id}/pause` | Pause one cron task |
| POST | `/api/schedules/{id}/resume` | Resume one cron task |
| GET/PUT | `/api/heartbeat` | Heartbeat wake-up config (interval, threshold) |
| GET/POST/DELETE | `/api/portfolios` | Portfolio CRUD |
| POST/DELETE | `/api/portfolios/{id}/holdings` | Holdings management |
| GET | `/api/portfolios/{id}/reports` | List risk reports |
| GET | `/api/market/quote/{ticker}` | Real-time stock quote |
| GET | `/api/market/history` | Historical price data |
| GET | `/api/openbb/public/providers` | OpenBB public connector status |
| GET | `/api/openbb/public/query` | Proxy query to OpenBB public data routes |
| GET | `/api/openbb/business/macro/us/cpi` | Business API: US CPI |
| GET | `/api/openbb/business/macro/us/unemployment` | Business API: US unemployment rate |
| GET | `/api/openbb/business/macro/us/fed-funds-rate` | Business API: US Fed funds rate |
| POST | `/api/documents/upload` | Upload document for RAG |
| GET | `/api/documents` | List documents |
| GET | `/api/reports/{id}/pdf` | Download PDF risk report |

### OpenBB Public Data Usage

1. Start your OpenBB API service (outside FinSentinel).
2. Set `APP_OPENBB_ENABLED=true` and `OPENBB_BASE_URL` in `.env`.
3. Query through FinSentinel:

```bash
# Check connector config status
curl -H "Authorization: Bearer <your-jwt>" \
  http://localhost:8080/api/openbb/public/providers

# Generic public data query
curl -G -H "Authorization: Bearer <your-jwt>" \
  --data-urlencode "path=economy/cpi" \
  --data-urlencode "provider=fred" \
  --data-urlencode "series_id=CPIAUCSL" \
  http://localhost:8080/api/openbb/public/query
```

### OpenBB Business APIs (Macro)

These endpoints wrap common macro datasets so frontend or agent tools don't need
to know OpenBB route path details.

```bash
# US CPI
curl -G -H "Authorization: Bearer <your-jwt>" \
  --data-urlencode "startDate=2019-01-01" \
  --data-urlencode "limit=60" \
  http://localhost:8080/api/openbb/business/macro/us/cpi

# US unemployment rate
curl -G -H "Authorization: Bearer <your-jwt>" \
  --data-urlencode "startDate=2019-01-01" \
  http://localhost:8080/api/openbb/business/macro/us/unemployment

# US fed funds rate
curl -G -H "Authorization: Bearer <your-jwt>" \
  --data-urlencode "startDate=2019-01-01" \
  http://localhost:8080/api/openbb/business/macro/us/fed-funds-rate
```

## Project Structure

```
finsentinel/
├── src/main/java/com/example/finsentinel/
│   ├── config/          # @Configuration + @ConfigurationProperties
│   ├── security/        # JWT filter chain
│   ├── model/           # JPA entities
│   ├── dto/             # Java records (auth, chat, portfolio, risk)
│   ├── repository/      # Spring Data JPA
│   ├── service/         # Business logic
│   ├── agent/tool/      # Spring AI function calling tools
│   ├── agent/advisor/   # RAG + compliance advisors
│   ├── agent/output/    # BeanOutputConverter (RiskReport)
│   ├── controller/      # REST + SSE endpoints
│   ├── mapper/          # MapStruct interfaces
│   └── ratelimit/       # @RateLimit + Redis+Lua
├── frontend/
│   ├── src/
│   │   ├── api/         # API client modules
│   │   ├── components/  # Layout, ProtectedRoute
│   │   ├── context/     # AuthContext
│   │   └── pages/       # 8 page components
│   └── nginx.conf       # Production reverse proxy
├── docker-compose.yml
├── Dockerfile           # Backend multi-stage
└── docs/plans/          # Implementation plans
```

## License

MIT
