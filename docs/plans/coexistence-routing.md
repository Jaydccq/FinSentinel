# Coexistence Traffic Routing Strategy

> Task 0.6 -- Defines how HTTP traffic is routed between the Java backend (port 8080) and NestJS backend (port 3001) during the strangler migration.

## Key Principle

The frontend's `frontend/src/api/client.ts` hardcodes:

```ts
const BASE = '/api'
```

Every API call flows through `apiFetch()`, which prepends `/api` to all paths. **We never change `client.ts`.** Routing decisions happen entirely at the proxy layer.

## Architecture Overview

```
                       Browser (localhost:5173 in dev)
                              |
                              v
                   +---------------------+
                   |   Vite Dev Server    |   (dev proxy rules)
                   |   OR  Nginx         |   (production)
                   +---------------------+
                      /api/auth/*   |   /api/market/*  ...  /api/*  (catch-all)
                           |                                    |
                           v                                    v
                  +----------------+                   +----------------+
                  | NestJS  :3001  |                   |  Java   :8080  |
                  +----------------+                   +----------------+
                           \                                  /
                            \                                /
                             +--------- Shared -------------+
                             |  PostgreSQL :5432 (pgvector)  |
                             |  Redis      :6379             |
                             +-------------------------------+
```

Both backends connect to the **same** PostgreSQL and Redis instances. There is no data replication or sync layer -- they share state directly. This is safe because:

1. Each endpoint domain is switched atomically (never half-migrated).
2. The NestJS Drizzle schema mirrors the existing JPA schema exactly.
3. Redis key namespaces are identical between implementations.

## Routing Table by Phase

| Phase | What migrated | Routes to NestJS (:3001) | Routes to Java (:8080) |
|-------|--------------|--------------------------|----------------------|
| 0 (scaffold) | health only | `/health` | `/api/**` (everything) |
| 2 (auth) | auth module | `/api/auth/**` | everything else |
| 3 (market) | market + research | `/api/auth/**`, `/api/market/**`, `/api/research/**` | everything else |
| 4-5 (agent + trading) | chat, analysis, trading, OKX | `/api/auth/**`, `/api/market/**`, `/api/research/**`, `/api/chat/**`, `/api/analysis/**`, `/api/trading/**`, `/api/okx/**` | everything else |
| 6-8 (portfolio, news, docs) | portfolio, news, reports, documents | cumulative | shrinking |
| 9-12 (autonomy, events, remaining) | autonomy, events, schedules, heartbeat, settings, OpenBB | cumulative | `/mcp/**` only |
| 13 (frontend) | Next.js replaces Vite | everything including SSE | Java fully retired |
| 14 (cleanup) | all migrated | everything | removed from compose |

### Detailed Path Inventory

These are all paths currently called by the frontend (verified from `frontend/src/api/*.ts`):

| Frontend module | Path prefix | Migration phase |
|----------------|-------------|-----------------|
| `auth.ts` | `/api/auth` | Phase 2 |
| `market.ts` | `/api/market` | Phase 3 |
| `research.ts` | `/api/research` | Phase 3 |
| `chat.ts` | `/api/chat` | Phase 4 |
| `analysis.ts` | `/api/analysis` | Phase 4 |
| `trading.ts` | `/api/trading` | Phase 5 |
| `okx.ts` | `/api/okx` | Phase 5 |
| `portfolio.ts` | `/api/portfolios` | Phase 6 |
| `reports.ts` | `/api/reports` | Phase 6 |
| `news.ts` | `/api/news` | Phase 7 |
| `documents.ts` | `/api/documents` | Phase 7 |
| `autonomy.ts` | `/api/schedules`, `/api/heartbeat` | Phase 8 |
| `events.ts` | `/api/events` | Phase 8 |
| `settings.ts` | `/api/settings` | Phase 8 |

Non-frontend paths (MCP, OpenBB) are migrated last or retired.

## Dev Proxy: Vite Configuration

During development, `frontend/vite.config.ts` controls routing. The current config sends everything to Java:

```ts
// Current (Phase 0) -- all traffic to Java
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:8080',
      changeOrigin: true,
    }
  }
}
```

As each module reaches parity, the proxy config is updated to add NestJS routes **above** the Java catch-all. Vite proxy rules are evaluated top-to-bottom, and the first match wins.

### Phase 2 example (auth migrated)

```ts
server: {
  proxy: {
    // --- NestJS routes (migrated) ---
    '/api/auth': {
      target: 'http://localhost:3001',
      changeOrigin: true,
    },
    // --- Java catch-all (everything else) ---
    '/api': {
      target: 'http://localhost:8080',
      changeOrigin: true,
    },
  }
}
```

### Phase 3 example (auth + market + research migrated)

```ts
server: {
  proxy: {
    '/api/auth': {
      target: 'http://localhost:3001',
      changeOrigin: true,
    },
    '/api/market': {
      target: 'http://localhost:3001',
      changeOrigin: true,
    },
    '/api/research': {
      target: 'http://localhost:3001',
      changeOrigin: true,
    },
    '/api': {
      target: 'http://localhost:8080',
      changeOrigin: true,
    },
  }
}
```

### Phase 14 (all migrated, Java removed)

```ts
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:3001',
      changeOrigin: true,
    },
  }
}
```

## Production Proxy: Nginx Configuration

In Docker Compose production, `frontend/nginx.conf` performs the same routing. The current config:

```nginx
location /api/ {
    proxy_pass http://host.docker.internal:8080;
    ...
}
```

During coexistence, NestJS-specific location blocks are added **before** the Java catch-all:

### Phase 2 example

```nginx
# --- NestJS routes (migrated) ---
location /api/auth/ {
    proxy_pass http://nestjs:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
    proxy_buffering off;
}

# --- Java catch-all (everything else) ---
location /api/ {
    proxy_pass http://host.docker.internal:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
    proxy_buffering off;
}
```

Nginx selects the longest matching prefix, so `/api/auth/` naturally takes priority over `/api/`.

## SSE Streaming Consideration

The chat and analysis endpoints use Server-Sent Events (SSE). Both the Vite proxy and Nginx config already support SSE through:

- `proxy_buffering off` in Nginx
- Vite's built-in proxy handles streaming natively

No special SSE configuration changes are needed when switching those paths to NestJS, as long as the NestJS implementation also streams SSE responses.

## Routing Rules

1. **`client.ts` BASE (`/api`) never changes.** All routing decisions are made at the proxy layer. The frontend is oblivious to which backend serves a given path.

2. **Routing is handled by Vite proxy (dev) or Nginx (production).** After Phase 13, if Next.js replaces the Vite frontend, Next.js middleware or `proxy.ts` takes over routing. By then, Java is fully retired, so it becomes a simple single-backend proxy.

3. **Both backends share the SAME PostgreSQL and Redis.** No data sync, no event bus between backends. They read and write the same tables and Redis keys. The Drizzle schema in `packages/db` must exactly mirror the JPA entity definitions.

4. **Each endpoint domain is switched atomically.** When `/api/auth` moves to NestJS, ALL auth endpoints move together. There is never a state where `/api/auth/login` goes to NestJS but `/api/auth/register` goes to Java. The unit of migration is the entire path prefix.

5. **One compose file runs both backends, or they run independently with shared infra.** During development, both backends are started manually (`./gradlew bootRun` on 8080, `pnpm --filter api dev` on 3001). In Docker, both are services in `docker-compose.yml` connecting to the same `postgres` and `redis` services.

## Switching Checklist

Before switching a path prefix from Java to NestJS:

- [ ] NestJS module has endpoint parity (same paths, methods, request/response shapes)
- [ ] All translated tests pass (Vitest unit + supertest integration)
- [ ] JSON response payloads match Java responses for representative fixtures
- [ ] SSE streaming works (if applicable to the endpoint)
- [ ] Frontend API module works without modification against NestJS
- [ ] Auth guard/JWT validation produces identical behavior
- [ ] Redis cache keys are compatible (same namespace, same TTL behavior)
- [ ] Update Vite proxy config to route the prefix to `:3001`
- [ ] Update Nginx config for production routing
- [ ] Smoke test the full flow through the frontend
- [ ] Document the switch in the migration tracking table

## Rollback Strategy

If a newly switched endpoint exhibits issues:

1. Revert the proxy config change (one line in Vite, one location block in Nginx).
2. Traffic immediately returns to the Java backend.
3. No data migration is needed because both backends share the same database.
4. Fix the NestJS implementation, re-verify, and switch again.

This is the primary advantage of proxy-layer routing -- rollback is instant and does not require redeployment of either backend.

## Docker Compose During Coexistence

The `docker-compose.yml` gains a `nestjs` service alongside the existing `backend` service:

```yaml
services:
  # ... existing postgres, redis, rustfs services ...

  backend:          # Java (Spring Boot)
    build: .
    ports:
      - "8080:8080"
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
    # ... existing env vars ...

  nestjs:           # TypeScript (NestJS)
    build: ./apps/api
    ports:
      - "3001:3001"
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/finsentinel
      REDIS_HOST: redis
      REDIS_PORT: 6379
      JWT_SECRET: ${JWT_SECRET}
      # ... migrated env vars ...

  frontend:
    build: ./frontend
    ports:
      - "3000:80"
    volumes:
      - ./frontend/nginx.conf:/etc/nginx/conf.d/default.conf:ro
```

The `frontend` Nginx config is the single routing authority in production. Both `backend` and `nestjs` are upstream targets.

## Timeline Summary

```
Phase 0    [NOW]     Java serves everything. NestJS has /health only.
Phase 2              Switch /api/auth to NestJS. First real traffic.
Phase 3              Switch /api/market, /api/research.
Phase 4-5            Switch /api/chat, /api/analysis, /api/trading, /api/okx.
Phase 6-8            Switch remaining CRUD paths.
Phase 9-12           Switch autonomy, events, settings. Java only serves /mcp.
Phase 13             Next.js frontend (optional). Java fully retired.
Phase 14             Remove Java from compose. Single TypeScript stack.
```

## FAQ

**Q: What if NestJS and Java both try to write to the same Redis key?**
A: They do not. Each path prefix is routed to exactly one backend. Only the backend receiving traffic for a given domain writes keys for that domain. Redis key namespaces are per-domain (e.g., `market:cache:*` is only written by whichever backend serves `/api/market`).

**Q: What about JWT tokens?**
A: Both backends use the same `JWT_SECRET` and the same signing algorithm. A token issued by Java is valid in NestJS and vice versa. This is critical for the auth migration -- the user's session survives the switch.

**Q: Do we need a feature flag system?**
A: No. The proxy config IS the feature flag. Routing a path to NestJS enables the new implementation. Routing it back to Java disables it. This is simpler and more reliable than runtime feature flags.

**Q: What about WebSocket or SSE connections that span multiple requests?**
A: SSE connections are long-lived but scoped to a single path (e.g., `/api/chat/stream`). The proxy routes the initial connection to the correct backend, and the stream stays on that backend for its lifetime. There is no mid-stream handoff.
