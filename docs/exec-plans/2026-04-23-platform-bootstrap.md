# Exec Plan: Platform Bootstrap (P2 slice)

> **For agentic workers:** REQUIRED SUB-SKILL — superpowers:executing-plans.

**Source PRD:** `docs/product-specs/2026-04-23-platform-bootstrap-and-module-scoping.md`
**Branch:** `feat/2026-04-23-platform-bootstrap`
**Goal:** Add three baseline web-stack hygiene pieces — Helmet security headers, response compression, request-id propagation — without breaking SSE / file downloads.
**Approach:** Tiny, additive changes in `main.ts`. Install `helmet` + `compression` (well-known, stable packages); use Node's `crypto.randomUUID` for the request-id middleware (no extra dep).

## Out of scope (defer to a follow-up slice)

- Dynamic `Module.register()` refactor for OpenBB / OKX / Queue / News / Twitter optional integrations. Big surface change; ship as its own PRD.
- Helmet CSP / HSTS — deferred until web + desktop QA passes; this slice ships with both disabled.
- Replacing the built-in NestJS Logger with `nestjs-pino`. Different change-set.

## What we keep

- The env-driven CORS allow-list landed in P0-3.
- The existing `GlobalExceptionFilter` envelope; we just teach it to emit the request-id header + log field.

## File Map

| Path                                                                     | Role                                                                                     |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `apps/api/package.json`                                                  | MODIFY — add `helmet` + `compression` (+ `@types/compression` dev).                      |
| `apps/api/src/common/middleware/request-id.middleware.ts`                | NEW — Express middleware that pulls/generates `x-request-id` and stashes on `req`.       |
| `apps/api/src/common/middleware/__tests__/request-id.middleware.spec.ts` | NEW — pure unit tests.                                                                   |
| `apps/api/src/main.ts`                                                   | MODIFY — wire helmet (minimal config), compression, request-id middleware before routes. |
| `apps/api/src/common/filters/global-exception.filter.ts`                 | MODIFY — copy `req.id` into `X-Request-Id` response header + log line.                   |

## Tasks

### Task 1: Install deps + request-id middleware

- [ ] `pnpm --filter @finsentinel/api add helmet compression`
- [ ] `pnpm --filter @finsentinel/api add -D @types/compression`
- [ ] Create `apps/api/src/common/middleware/request-id.middleware.ts`:

```ts
import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

declare module 'express-serve-static-core' {
  interface Request {
    id?: string;
  }
}

/**
 * Reads `X-Request-Id` from the incoming request (if present) or generates a
 * fresh UUID. The id is stashed on `req.id` and echoed back via response
 * header so callers can correlate logs across services.
 */
export function requestIdMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header(REQUEST_ID_HEADER);
    const id = incoming && incoming.length > 0 ? incoming : randomUUID();
    req.id = id;
    res.setHeader(REQUEST_ID_HEADER, id);
    next();
  };
}
```

- [ ] Create `apps/api/src/common/middleware/__tests__/request-id.middleware.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { requestIdMiddleware, REQUEST_ID_HEADER } from '../request-id.middleware';

describe('requestIdMiddleware', () => {
  it('generates a UUID when no incoming X-Request-Id header is present', () => {
    const setHeader = vi.fn();
    const req = { header: vi.fn().mockReturnValue(undefined) } as never;
    const res = { setHeader } as never;
    const next = vi.fn();

    requestIdMiddleware()(req as never, res, next);

    expect((req as { id: string }).id).toMatch(/^[0-9a-f]{8}-/);
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, (req as { id: string }).id);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('honours an incoming X-Request-Id header verbatim', () => {
    const setHeader = vi.fn();
    const req = { header: vi.fn().mockReturnValue('upstream-trace-42') } as never;
    const res = { setHeader } as never;
    const next = vi.fn();

    requestIdMiddleware()(req as never, res, next);

    expect((req as { id: string }).id).toBe('upstream-trace-42');
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'upstream-trace-42');
  });

  it('treats empty string header as missing → generates fresh UUID', () => {
    const req = { header: vi.fn().mockReturnValue('') } as never;
    const res = { setHeader: vi.fn() } as never;
    const next = vi.fn();

    requestIdMiddleware()(req as never, res, next);

    expect((req as { id: string }).id).toMatch(/^[0-9a-f]{8}-/);
  });
});
```

- [ ] `pnpm --filter @finsentinel/api vitest run src/common/middleware/__tests__/request-id.middleware.spec.ts` — 3 PASS.
- [ ] Commit: `feat(api): request-id middleware + helmet/compression deps`.

### Task 2: Wire helmet + compression + request-id into main.ts

- [ ] Edit `apps/api/src/main.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import type { AuthRuntimeConfig } from './config/auth.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  // Order matters: requestId first so every downstream log/header has it.
  app.use(requestIdMiddleware());
  app.use(
    helmet({
      // CSP + HSTS deferred until web + desktop QA passes — see
      // docs/exec-plans/2026-04-23-platform-bootstrap.md.
      contentSecurityPolicy: false,
      hsts: false,
    }),
  );
  app.use(compression());
  app.use(cookieParser());

  const auth = app.get(ConfigService).get<AuthRuntimeConfig>('auth')!;
  app.enableCors({
    origin: auth.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  app.useGlobalFilters(new GlobalExceptionFilter());

  const port = process.env['PORT'] ?? 3001;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}

bootstrap();
```

- [ ] `pnpm --filter @finsentinel/api typecheck` clean.
- [ ] Commit: `feat(api): wire helmet + compression + request-id into bootstrap`.

### Task 3: GlobalExceptionFilter surfaces request-id

- [ ] Edit `apps/api/src/common/filters/global-exception.filter.ts`:
  - in `catch()`, read `req.id` from `ctx.getRequest()` and set `X-Request-Id` on the response (helmet may have set it via the middleware already — no-op if so).
  - include `requestId` in the unhandled-exception log line.
- [ ] Add a small assertion in an existing or new spec verifying the header propagates.
- [ ] Commit: `feat(api): GlobalExceptionFilter surfaces requestId in header + logs`.

### Task 4: Verification + progress log

- [ ] `pnpm --filter @finsentinel/api typecheck && pnpm --filter @finsentinel/api vitest run`.
- [ ] Append progress log to PRD.
- [ ] Whitelist exec plan in `.gitignore`.
- [ ] Commit progress log.

## Self-Review

- Spec coverage: §5.1 helmet/compression/request-id → Tasks 1-3. §5.2 dynamic-module refactor explicitly out-of-scope. §5.3 GlobalExceptionFilter surfaces requestId → Task 3.
- No placeholders.
- Verification: tests + typecheck before commit.

## Risks

- Helmet's defaults can break SSE; we explicitly disable CSP + HSTS in this slice. Manual QA (browser + Tauri smoke) before turning them on later.
- Compression added unconditionally — SSE responses set their own `Content-Type: text/event-stream`; compression usually skips those, but if a regression appears, exclude via `compression({ filter })`.
