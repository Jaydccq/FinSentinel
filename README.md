# FinSentinel

FinSentinel is an AI-assisted investment research and risk platform organized as a TypeScript monorepo.

The active product path is:

- `apps/api`: NestJS API, agent orchestration, trading integrations, document/RAG pipeline
- `apps/web`: Next.js frontend
- `packages/db`, `packages/shared`: shared workspace packages

## App status matrix

| App            | Status       | Notes                                    |
| -------------- | ------------ | ---------------------------------------- |
| `apps/api`     | canonical    | In CI, primary target.                   |
| `apps/web`     | canonical    | In CI, primary target.                   |
| `apps/desktop` | experimental | Smoke CI only, no release artifacts yet. |

## Workspace Layout

```text
.
├── apps/
│   ├── api/
│   └── web/
├── packages/
│   ├── db/
│   └── shared/
├── observability/
└── docs/
```

## Development

Requirements:

- Node.js 22+
- pnpm 10+
- PostgreSQL
- Redis
- Optional object storage for document uploads

Install dependencies:

```bash
pnpm install
```

Run the active apps:

```bash
pnpm --filter @finsentinel/api dev
pnpm --filter @finsentinel/web dev
```

Useful workspace commands:

```bash
pnpm build
pnpm typecheck
pnpm test
```

Useful app commands:

```bash
pnpm --filter @finsentinel/api typecheck
pnpm --filter @finsentinel/api test
pnpm --filter @finsentinel/web typecheck
pnpm --filter @finsentinel/web lint
```

## Docker

Repository-level Docker entrypoints now follow the TypeScript stack:

- `docker-compose.yml`: local TypeScript stack
- `docker-compose.prod.yml`: production-like TypeScript stack

Start the stack with:

```bash
docker compose up --build
```

Default ports:

- Web: `http://localhost:3000`
- API: `http://localhost:3001/api`
- API metrics: `http://localhost:3001/api/metrics`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3002`
- RustFS console: `http://localhost:9001`

Grafana ships with a provisioned `FinSentinel RAG Operations` dashboard backed by Prometheus.

## Environment

Minimum API environment variables:

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `OPENROUTER_API_KEY` when `AI_PROVIDER=openrouter`
- `NVIDIA_API_KEY` when `AI_PROVIDER=nvidia`
- `POLYGON_API_KEY`

Common optional variables:

- `AI_PROVIDER` (`openrouter` by default; set `nvidia` for NVIDIA Build/NIM)
- `AI_MODEL`
- `AI_EMBEDDING_PROVIDER`
- `AI_EMBEDDING_MODEL`
- `ENCRYPTION_AES_KEY`
- `APP_AGENT_PERSONA`
- `APP_TRADING_DEFAULT_MODE`
- `APP_CRYPTO_NEWS_ENABLED`
- `CRYPTO_NEWS_6551_TOKEN`
- `APP_TWITTER_6551_ENABLED`
- `TWITTER_6551_TOKEN`
- `APP_OKX_ENABLED`
- `OKX_API_KEY`
- `OKX_SECRET_KEY`
- `OKX_PASSPHRASE`
- `OPENBB_ENABLED`
- `OPENBB_BASE_URL`
- `RAG_REINDEX_ENABLED`
- `RAG_REINDEX_INTERVAL_MS`
- `RAG_REINDEX_STARTUP_DELAY_MS`
- `RAG_REINDEX_DOCUMENT_BATCH_SIZE`
- `RAG_REINDEX_NEWS_BATCH_SIZE`
- `RAG_REINDEX_FORCE`

NVIDIA Build example:

```bash
AI_PROVIDER=nvidia
NVIDIA_API_KEY=nvapi-your-token
AI_MODEL=nvidia/nemotron-3-super-120b-a12b
AI_EMBEDDING_PROVIDER=nvidia
AI_EMBEDDING_MODEL=nvidia/llama-nemotron-embed-1b-v2
```

Changing `AI_EMBEDDING_MODEL` requires reindexing stored RAG vectors so old and
new embedding dimensions are not mixed.

Storage variables when using RustFS or hybrid storage:

- `STORAGE_PROVIDER`
- `STORAGE_ENDPOINT`
- `STORAGE_ACCESS_KEY`
- `STORAGE_SECRET_KEY`
- `STORAGE_BUCKET`
- `STORAGE_REGION`
