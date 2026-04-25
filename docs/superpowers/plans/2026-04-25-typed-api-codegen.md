# Typed API Codegen — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a typed-fetch wrapper that validates API responses against shared Zod schemas at runtime, with a route registry that pairs each `(path, method)` to its request/response schema. Migrate 3 representative client modules (`watchlist`, `auth`, `portfolio`) to prove the wrapper end-to-end.

**Architecture:** A new helper `apps/web/src/api/typed-client.ts` re-uses the existing `apiFetch` for transport, then layers Zod parsing on top. A registry `apps/web/src/api/registry.ts` maps route descriptors to schemas exported from `@finsentinel/shared`. Existing per-domain client files (`watchlist.ts`, `auth.ts`, `portfolio.ts`) get rewritten to call `typedApi.<route>(input)` instead of crafting `apiFetch` calls by hand. Every other client module keeps working unchanged — this is additive, not a forced migration.

**Tech Stack:** TypeScript 5, Zod 3, Vitest, Next.js 16 client (browser/Tauri).

---

## Background

The current frontend imports types like `WatchlistOverviewResponse` from `@finsentinel/shared` and calls `apiFetch<WatchlistOverviewResponse>('/watchlist')`. This gives compile-time types but no runtime validation: when the API drifts (extra/missing/renamed fields, decimal-as-number vs string, null vs undefined) the client silently consumes broken JSON until something downstream blows up.

Item 10b in `docs/exec-plans/2026-04-24-codebase-optimization-triage-prd.md` calls this out as the first surface to harden before SWR rollout (otherwise SWR caches type-incoherent data) and before trading-status UI (which must trust money-shaped responses).

## Scope

**In:**
- `apps/web/src/api/typed-client.ts` — `typedFetch<TReq, TRes>(...)` and a `defineRoute(...)` factory
- `apps/web/src/api/registry.ts` — route registry; only watchlist/auth/portfolio routes wired in this phase
- Migrate `apps/web/src/api/watchlist.ts`, `apps/web/src/api/auth.ts`, `apps/web/src/api/portfolio.ts`
- Vitest unit + integration coverage for the helper, the registry, and the three migrated modules
- Track remaining 16 client modules in tech-debt tracker as follow-up

**Out:**
- Generating from OpenAPI (deferred — requires `@nestjs/swagger` decorators on all controllers; not blocking)
- Migrating every client file in this PR (trades review surface area for slow-walked rollout)
- Adding new endpoints

## Assumptions

- The shared schemas already exported from `@finsentinel/shared` accurately describe the live API responses for watchlist/auth/portfolio. Where they don't, the test will fail and we fix the schema (do **not** loosen validation to make the test pass).
- Decimal-string fields stay strings on the wire — we are not changing serialization.
- `apiFetch` keeps its current contract (CSRF header, silent refresh, 401 handling). The wrapper composes around it.

## File Structure

```
apps/web/src/api/
  client.ts              (unchanged — apiFetch, ApiError)
  typed-client.ts        (new — typedFetch + defineRoute)
  registry.ts            (new — route registry for migrated endpoints)
  watchlist.ts           (rewritten to use registry)
  auth.ts                (rewritten to use registry)
  portfolio.ts           (rewritten to use registry)
  __tests__/
    typed-client.test.ts (new — Zod validation, error mapping)
    registry.test.ts     (new — route lookup, schema parity)
    watchlist.test.ts    (extended — runtime validation cases)
```

---

## Task 1: typedFetch helper

**Files:**
- Create: `apps/web/src/api/typed-client.ts`
- Test: `apps/web/src/api/__tests__/typed-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/api/__tests__/typed-client.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { typedFetch, ResponseValidationError } from '../typed-client';

describe('typedFetch', () => {
  const fetchMock = vi.fn();
  const originalFetch = global.fetch;
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('parses response against the response schema', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'a', name: 'x' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await typedFetch({
      path: '/thing',
      method: 'GET',
      responseSchema: z.object({ id: z.string(), name: z.string() }),
    });
    expect(result).toEqual({ id: 'a', name: 'x' });
  });

  it('throws ResponseValidationError when response shape drifts', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 1, name: 'x' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(
      typedFetch({
        path: '/thing',
        method: 'GET',
        responseSchema: z.object({ id: z.string(), name: z.string() }),
      }),
    ).rejects.toBeInstanceOf(ResponseValidationError);
  });

  it('serializes request body and validates it when requestSchema is provided', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await typedFetch({
      path: '/thing',
      method: 'POST',
      requestSchema: z.object({ qty: z.number().int() }),
      responseSchema: z.object({ ok: z.boolean() }),
      body: { qty: 3 },
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ qty: 3 }));
  });
});
```

- [ ] **Step 2: Run the test to confirm failure**

Run: `pnpm --filter @finsentinel/web test -- src/api/__tests__/typed-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement typed-client**

```ts
// apps/web/src/api/typed-client.ts
import type { ZodTypeAny, z } from 'zod';
import { apiFetch, ApiError } from './client';

export class ResponseValidationError extends Error {
  constructor(
    public readonly path: string,
    public readonly issues: unknown,
  ) {
    super(`Response validation failed for ${path}`);
    this.name = 'ResponseValidationError';
  }
}

export class RequestValidationError extends Error {
  constructor(
    public readonly path: string,
    public readonly issues: unknown,
  ) {
    super(`Request validation failed for ${path}`);
    this.name = 'RequestValidationError';
  }
}

export interface TypedFetchArgs<
  TReqSchema extends ZodTypeAny | undefined,
  TResSchema extends ZodTypeAny,
> {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  responseSchema: TResSchema;
  requestSchema?: TReqSchema;
  body?: TReqSchema extends ZodTypeAny ? z.infer<TReqSchema> : undefined;
  query?: Record<string, string | number | boolean | undefined>;
}

function buildPath(path: string, query?: TypedFetchArgs<ZodTypeAny, ZodTypeAny>['query']): string {
  if (!query) return path;
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) search.set(k, String(v));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

export async function typedFetch<
  TReqSchema extends ZodTypeAny | undefined,
  TResSchema extends ZodTypeAny,
>(args: TypedFetchArgs<TReqSchema, TResSchema>): Promise<z.infer<TResSchema>> {
  const { path, method, responseSchema, requestSchema, body, query } = args;
  if (requestSchema && body !== undefined) {
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) throw new RequestValidationError(path, parsed.error.issues);
  }
  const init: RequestInit = { method };
  if (body !== undefined && method !== 'GET') {
    init.body = JSON.stringify(body);
  }
  const raw = await apiFetch<unknown>(buildPath(path, query), init);
  if (raw === undefined) {
    // 204 / no-content path — schema must accept undefined explicitly.
    const parsed = responseSchema.safeParse(undefined);
    if (!parsed.success) throw new ResponseValidationError(path, parsed.error.issues);
    return parsed.data as z.infer<TResSchema>;
  }
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new ResponseValidationError(path, parsed.error.issues);
  return parsed.data as z.infer<TResSchema>;
}

export { ApiError };
```

- [ ] **Step 4: Re-run tests, expect PASS**

Run: `pnpm --filter @finsentinel/web test -- src/api/__tests__/typed-client.test.ts`
Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/typed-client.ts apps/web/src/api/__tests__/typed-client.test.ts
git commit -m "feat(web): add typedFetch helper with Zod request/response validation"
```

---

## Task 2: Route registry

**Files:**
- Create: `apps/web/src/api/registry.ts`
- Test: `apps/web/src/api/__tests__/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/api/__tests__/registry.test.ts
import { describe, expect, it } from 'vitest';
import { routes } from '../registry';
import {
  watchlistOverviewResponseSchema,
  saveWatchlistRequestSchema,
} from '@finsentinel/shared';

describe('routes registry', () => {
  it('exposes the watchlist list route bound to the overview schema', () => {
    expect(routes.watchlist.list.path).toBe('/watchlist');
    expect(routes.watchlist.list.method).toBe('GET');
    expect(routes.watchlist.list.responseSchema).toBe(watchlistOverviewResponseSchema);
  });

  it('exposes the watchlist save route with both request and response schemas', () => {
    expect(routes.watchlist.save.method).toBe('POST');
    expect(routes.watchlist.save.requestSchema).toBe(saveWatchlistRequestSchema);
  });
});
```

- [ ] **Step 2: Confirm failure**

Run: `pnpm --filter @finsentinel/web test -- src/api/__tests__/registry.test.ts`
Expected: FAIL — registry module not found.

- [ ] **Step 3: Implement registry**

```ts
// apps/web/src/api/registry.ts
import {
  watchlistOverviewResponseSchema,
  watchlistCategoryResponseSchema,
  watchlistItemResponseSchema,
  saveWatchlistRequestSchema,
  updateWatchlistItemRequestSchema,
  updateWatchlistCategoryRequestSchema,
  loginRequestSchema,
  loginResponseSchema,
  registerRequestSchema,
  whoAmIResponseSchema,
  portfolioResponseSchema,
  portfolioPositionResponseSchema,
  createPortfolioRequestSchema,
} from '@finsentinel/shared';
import { z } from 'zod';

export interface RouteDescriptor<TReq extends z.ZodTypeAny | undefined, TRes extends z.ZodTypeAny> {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  requestSchema: TReq;
  responseSchema: TRes;
}

function defineRoute<
  TReq extends z.ZodTypeAny | undefined,
  TRes extends z.ZodTypeAny,
>(d: RouteDescriptor<TReq, TRes>): RouteDescriptor<TReq, TRes> {
  return d;
}

export const routes = {
  watchlist: {
    list: defineRoute({
      path: '/watchlist',
      method: 'GET',
      requestSchema: undefined,
      responseSchema: watchlistOverviewResponseSchema,
    }),
    save: defineRoute({
      path: '/watchlist',
      method: 'POST',
      requestSchema: saveWatchlistRequestSchema,
      responseSchema: watchlistCategoryResponseSchema,
    }),
    updateItem: defineRoute({
      path: '/watchlist/items/:id',
      method: 'PATCH',
      requestSchema: updateWatchlistItemRequestSchema,
      responseSchema: watchlistItemResponseSchema,
    }),
    deleteItem: defineRoute({
      path: '/watchlist/items/:id',
      method: 'DELETE',
      requestSchema: undefined,
      responseSchema: z.undefined(),
    }),
    updateCategory: defineRoute({
      path: '/watchlist/categories/:id',
      method: 'PATCH',
      requestSchema: updateWatchlistCategoryRequestSchema,
      responseSchema: watchlistCategoryResponseSchema,
    }),
    deleteCategory: defineRoute({
      path: '/watchlist/categories/:id',
      method: 'DELETE',
      requestSchema: undefined,
      responseSchema: z.undefined(),
    }),
  },
  auth: {
    login: defineRoute({
      path: '/auth/login',
      method: 'POST',
      requestSchema: loginRequestSchema,
      responseSchema: loginResponseSchema,
    }),
    register: defineRoute({
      path: '/auth/register',
      method: 'POST',
      requestSchema: registerRequestSchema,
      responseSchema: loginResponseSchema,
    }),
    whoami: defineRoute({
      path: '/auth/whoami',
      method: 'GET',
      requestSchema: undefined,
      responseSchema: whoAmIResponseSchema,
    }),
    logout: defineRoute({
      path: '/auth/logout',
      method: 'POST',
      requestSchema: undefined,
      responseSchema: z.undefined(),
    }),
  },
  portfolio: {
    list: defineRoute({
      path: '/portfolios',
      method: 'GET',
      requestSchema: undefined,
      responseSchema: z.array(portfolioResponseSchema),
    }),
    get: defineRoute({
      path: '/portfolios/:id',
      method: 'GET',
      requestSchema: undefined,
      responseSchema: portfolioResponseSchema,
    }),
    positions: defineRoute({
      path: '/portfolios/:id/positions',
      method: 'GET',
      requestSchema: undefined,
      responseSchema: z.array(portfolioPositionResponseSchema),
    }),
    create: defineRoute({
      path: '/portfolios',
      method: 'POST',
      requestSchema: createPortfolioRequestSchema,
      responseSchema: portfolioResponseSchema,
    }),
  },
} as const;
```

> **NOTE:** The exact set of schemas in `@finsentinel/shared` may differ from the imports above; the subagent must inspect `packages/shared/src/schemas/*.ts` and `packages/shared/src/index.ts` for the actual exported names and pick the closest match. If a needed response schema does not exist yet, **add it to the shared package in the same task** — do not invent a frontend-only `z.any()` placeholder.

- [ ] **Step 4: Run tests, expect PASS**

Run: `pnpm --filter @finsentinel/web test -- src/api/__tests__/registry.test.ts`
Expected: 2/2 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/registry.ts apps/web/src/api/__tests__/registry.test.ts
git commit -m "feat(web): add typed-route registry binding paths to shared Zod schemas"
```

---

## Task 3: Migrate watchlist client

**Files:**
- Modify: `apps/web/src/api/watchlist.ts`
- Modify/extend: `apps/web/src/api/__tests__/watchlist.test.ts`

- [ ] **Step 1: Update tests to assert runtime validation**

Add to `watchlist.test.ts`:

```ts
import { ResponseValidationError } from '../typed-client';

it('throws ResponseValidationError when watchlist list returns malformed data', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(
    new Response(JSON.stringify({ items: 'not-an-array' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  await expect(watchlistApi.list()).rejects.toBeInstanceOf(ResponseValidationError);
});
```

- [ ] **Step 2: Confirm new test fails**

Run: `pnpm --filter @finsentinel/web test -- src/api/__tests__/watchlist.test.ts`
Expected: FAIL — current `apiFetch` returns the malformed object without validating.

- [ ] **Step 3: Rewrite `watchlist.ts` to use the registry**

```ts
import { routes } from './registry';
import { typedFetch } from './typed-client';
import type {
  SaveWatchlistRequest,
  UpdateWatchlistCategoryRequest,
  UpdateWatchlistItemRequest,
  WatchlistCategoryResponse,
  WatchlistItemResponse,
  WatchlistOverviewResponse,
} from '@finsentinel/shared';

export const watchlistApi = {
  list: (): Promise<WatchlistOverviewResponse> =>
    typedFetch({ ...routes.watchlist.list }),
  save: (body: SaveWatchlistRequest): Promise<WatchlistCategoryResponse> =>
    typedFetch({ ...routes.watchlist.save, body }),
  updateItem: (id: string, body: UpdateWatchlistItemRequest): Promise<WatchlistItemResponse> =>
    typedFetch({
      ...routes.watchlist.updateItem,
      path: routes.watchlist.updateItem.path.replace(':id', encodeURIComponent(id)),
      body,
    }),
  deleteItem: (id: string): Promise<void> =>
    typedFetch({
      ...routes.watchlist.deleteItem,
      path: routes.watchlist.deleteItem.path.replace(':id', encodeURIComponent(id)),
    }) as Promise<void>,
  updateCategory: (
    id: string,
    body: UpdateWatchlistCategoryRequest,
  ): Promise<WatchlistCategoryResponse> =>
    typedFetch({
      ...routes.watchlist.updateCategory,
      path: routes.watchlist.updateCategory.path.replace(':id', encodeURIComponent(id)),
      body,
    }),
  deleteCategory: (id: string): Promise<void> =>
    typedFetch({
      ...routes.watchlist.deleteCategory,
      path: routes.watchlist.deleteCategory.path.replace(':id', encodeURIComponent(id)),
    }) as Promise<void>,
};

export type {
  SaveWatchlistRequest,
  UpdateWatchlistCategoryRequest,
  UpdateWatchlistItemRequest,
  WatchlistCategoryResponse,
  WatchlistItemResponse,
  WatchlistOverviewResponse,
};
```

- [ ] **Step 4: Run all watchlist tests, expect PASS**

Run: `pnpm --filter @finsentinel/web test -- src/api/__tests__/watchlist.test.ts`
Expected: All PASS, including the new validation case.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/watchlist.ts apps/web/src/api/__tests__/watchlist.test.ts
git commit -m "refactor(web): migrate watchlist client to typed-route registry"
```

---

## Task 4: Migrate auth client

**Files:**
- Modify: `apps/web/src/api/auth.ts`
- Test: `apps/web/src/api/__tests__/auth.test.ts` (create if missing)

Mirror Task 3 against the `auth` namespace of the registry. Cover login success, login validation failure on malformed response, logout 204, whoami unauth (401 path stays handled by `apiFetch`).

- [ ] **Step 1:** Read current `auth.ts` and identify exposed methods.
- [ ] **Step 2:** Add tests asserting runtime response validation against `loginResponseSchema` and `whoAmIResponseSchema`.
- [ ] **Step 3:** Run tests, confirm at least one fails.
- [ ] **Step 4:** Rewrite `auth.ts` to use `typedFetch({ ...routes.auth.login, body })` etc.
- [ ] **Step 5:** Run tests, expect PASS.
- [ ] **Step 6:** Commit.

```bash
git add apps/web/src/api/auth.ts apps/web/src/api/__tests__/auth.test.ts
git commit -m "refactor(web): migrate auth client to typed-route registry"
```

---

## Task 5: Migrate portfolio client

**Files:**
- Modify: `apps/web/src/api/portfolio.ts`
- Test: `apps/web/src/api/__tests__/portfolio.test.ts` (create if missing)

Same pattern as Task 3 against `routes.portfolio`. The portfolio response is the most decimal-heavy surface, so add at least one test that proves a wire-side `number` for `marketValue` (instead of the expected decimal-string) is rejected by `ResponseValidationError`. This is the value-add the wrapper buys us.

- [ ] **Step 1–6:** Mirror Task 4.

```bash
git add apps/web/src/api/portfolio.ts apps/web/src/api/__tests__/portfolio.test.ts
git commit -m "refactor(web): migrate portfolio client to typed-route registry"
```

---

## Task 6: Verification — repo-wide

- [ ] **Step 1: Typecheck the web workspace**

Run: `pnpm --filter @finsentinel/web typecheck`
Expected: PASS, zero new errors.

- [ ] **Step 2: Lint touched files**

Run: `pnpm --filter @finsentinel/web lint -- src/api/`
Expected: PASS for the touched files. Pre-existing violations elsewhere stay as documented in tech-debt-tracker; do not fix them in this PR.

- [ ] **Step 3: Run the full web test suite**

Run: `pnpm --filter @finsentinel/web test`
Expected: PASS, including the new `typed-client`, `registry`, `watchlist`, `auth`, `portfolio` cases.

- [ ] **Step 4: Update tech-debt tracker**

Edit `docs/exec-plans/tech-debt-tracker.md`:
- Replace the "Frontend typed-client/SWR/trading-status rollout is blocked on UX state design" entry's typed-client portion with a "**Typed API codegen — phase 1 landed**" sub-entry that lists the 3 migrated modules and the 16 still on raw `apiFetch`.
- Status: typed-client wrapper landed; 16 modules pending migration; SWR / trading-status remain blocked on UX state design.

```bash
git add docs/exec-plans/tech-debt-tracker.md
git commit -m "docs(tech-debt): record typed API codegen phase 1 landed; rollout follow-up tracked"
```

- [ ] **Step 5: Push branch and open PR**

```bash
git push -u origin feat/2026-04-25-typed-api-codegen
gh pr create --title "feat(web): typed API client phase 1 — Zod runtime validation" \
  --body "Implements docs/superpowers/plans/2026-04-25-typed-api-codegen.md. Phase 1 wraps apiFetch with Zod-validated request/response, introduces a route registry, and migrates watchlist/auth/portfolio. Remaining 16 client modules tracked as follow-up."
```

---

## Verification Approach

1. New unit tests prove the wrapper validates both happy and drift paths.
2. Existing watchlist/auth/portfolio tests stay green; new drift cases prove validation actually fires.
3. Workspace typecheck stays green (catches schema-vs-import mismatches).
4. The follow-up checklist in tech-debt-tracker captures the remaining 16 modules so the next phase has a concrete starting list.

## Risks

- **Existing schemas underspecified:** if `watchlistOverviewResponseSchema` is `z.any()` somewhere, validation buys nothing. Subagent must inspect each schema before relying on it; tighten in-place if shallow.
- **Decimal-string drift:** if any migrated response really did hand back a `number` for a money field, the new validation rejects it. That is the correct behavior — fix the API or the schema, do **not** loosen the schema.
- **Route param interpolation regressions:** `:id` replacement is naive. Subagent must verify all migrated paths render the same final URL the previous client produced (`encodeURIComponent` parity).

## Progress Log

(To be filled in by the subagent during execution.)

## Final Outcome

(To be filled in after merge.)
