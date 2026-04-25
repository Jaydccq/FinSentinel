# Exec Plan: Watchlist Server-Persistence (P1 slice)

> **For agentic workers:** REQUIRED SUB-SKILL — superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Source PRD:** `docs/product-specs/2026-04-23-watchlist-server-persistence.md`
**Branch:** `feat/2026-04-23-watchlist-server-persistence`
**Goal:** Bridge the existing backend `WatchlistService` to the frontend Dashboard. Stop the localStorage-only watchlist; use the server as the source of truth, with a local-cache fallback for offline / cold-start.
**Approach:** Add a thin `WatchlistController` that exposes the methods the service already implements, register `WatchlistModule` in `app.module.ts`, build a typed `apps/web/src/api/watchlist.ts` client, migrate the Dashboard with auto-import of legacy `localStorage.finsentinel_watchlist`.

## Out of scope (defer)

- Item-level CRUD endpoints (`PATCH /watchlist/items/:id`, `DELETE`). Service doesn't expose them yet; current Dashboard doesn't need them. Add when the UI grows fields beyond ticker.
- Settings page redesign that exposes thesis / notes / priority editing (PRD §5.2 last paragraph).
- Real-time multi-device sync (poll-and-revalidate is fine for V1).

## What we keep

- The single "Dashboard watchlist" UX in V1 — auto-import from legacy localStorage into a category named **"Dashboard"**.

## File Map

| Path                                                            | Role                                                                                                              |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/watchlist/watchlist.controller.ts`                | NEW — REST surface over the existing service.                                                                     |
| `apps/api/src/watchlist/__tests__/watchlist.controller.spec.ts` | NEW — controller spec covering GET / POST.                                                                        |
| `apps/api/src/watchlist/watchlist.module.ts`                    | MODIFY — register the controller.                                                                                 |
| `apps/api/src/app.module.ts`                                    | MODIFY — import `WatchlistModule`.                                                                                |
| `packages/shared/src/schemas/watchlist.ts`                      | MODIFY — add `saveWatchlistRequestSchema` + type.                                                                 |
| `apps/web/src/api/watchlist.ts`                                 | NEW — fetch wrapper for GET / POST.                                                                               |
| `apps/web/src/views/DashboardPage.tsx`                          | MODIFY — read from server, write through, fall back to local cache, auto-import legacy localStorage on first run. |
| `apps/web/src/api/__tests__/watchlist.test.ts`                  | NEW — unit test for the client.                                                                                   |

## Tasks

---

### Task 1: shared `saveWatchlistRequestSchema`

**Files:**

- Modify: `packages/shared/src/schemas/watchlist.ts`

- [ ] **Step 1.1 — Append to the schemas file**

```ts
export const saveWatchlistItemSchema = z.object({
  symbol: z.string().min(1).max(50),
  companyName: z.string().max(255).optional(),
  thesis: z.string().max(4000).optional(),
  notes: z.string().max(4000).optional(),
  priority: z.number().int().min(0).max(1000).optional(),
});

export type SaveWatchlistItemInput = z.infer<typeof saveWatchlistItemSchema>;

export const saveWatchlistRequestSchema = z.object({
  categoryName: z.string().min(1).max(100),
  categoryDescription: z.string().max(1000).optional(),
  categorySummary: z.string().max(2000).optional(),
  items: z.array(saveWatchlistItemSchema).max(500),
});

export type SaveWatchlistRequest = z.infer<typeof saveWatchlistRequestSchema>;
```

- [ ] **Step 1.2 — Verify schemas package builds**

```
pnpm --filter @finsentinel/shared typecheck
pnpm --filter @finsentinel/shared build
```

- [ ] **Step 1.3 — Commit**

```bash
git add packages/shared/src/schemas/watchlist.ts
git commit -m "feat(shared): add saveWatchlistRequestSchema for REST input"
```

---

### Task 2: `WatchlistController` with GET + POST

**Files:**

- Create: `apps/api/src/watchlist/watchlist.controller.ts`
- Create: `apps/api/src/watchlist/__tests__/watchlist.controller.spec.ts`
- Modify: `apps/api/src/watchlist/watchlist.module.ts`

- [ ] **Step 2.1 — Write failing controller spec**

`apps/api/src/watchlist/__tests__/watchlist.controller.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WatchlistController } from '../watchlist.controller';
import { WatchlistService } from '../watchlist.service';

describe('WatchlistController', () => {
  let svc: { getWatchlist: ReturnType<typeof vi.fn>; saveWatchlistItems: ReturnType<typeof vi.fn> };
  let ctrl: WatchlistController;

  beforeEach(() => {
    svc = {
      getWatchlist: vi.fn().mockResolvedValue({ categories: [] }),
      saveWatchlistItems: vi.fn().mockResolvedValue({
        id: 'cat-1',
        name: 'Dashboard',
        key: 'dashboard',
        description: '',
        summary: '',
        itemCount: 1,
        items: [],
        createdAt: '2026-04-24T00:00:00.000Z',
        updatedAt: '2026-04-24T00:00:00.000Z',
      }),
    };
    ctrl = new WatchlistController(svc as unknown as WatchlistService);
  });

  it('GET /watchlist proxies to service.getWatchlist for the current user', async () => {
    const out = await ctrl.list({ userId: 'u-1' } as never);
    expect(svc.getWatchlist).toHaveBeenCalledWith('u-1');
    expect(out.categories).toEqual([]);
  });

  it('POST /watchlist creates/updates a category with items', async () => {
    const body = {
      categoryName: 'Dashboard',
      items: [{ symbol: 'AAPL' }],
    };
    const out = await ctrl.save({ userId: 'u-1' } as never, body as never);
    expect(svc.saveWatchlistItems).toHaveBeenCalledWith('u-1', body);
    expect(out.id).toBe('cat-1');
  });
});
```

- [ ] **Step 2.2 — Run, verify FAIL** (controller doesn't exist yet)

```
pnpm --filter @finsentinel/api vitest run src/watchlist/__tests__/watchlist.controller.spec.ts
```

- [ ] **Step 2.3 — Implement the controller**

`apps/api/src/watchlist/watchlist.controller.ts`:

```ts
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  saveWatchlistRequestSchema,
  type SaveWatchlistRequest,
  type WatchlistCategoryResponse,
  type WatchlistOverviewResponse,
} from '@finsentinel/shared';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { WatchlistService } from './watchlist.service';

/**
 * Watchlist controller — exposes the REST surface that the frontend uses to
 * read/write categories and items. The service already implements the logic;
 * this controller is intentionally thin.
 */
@Controller('watchlist')
@UseGuards(JwtGuard)
export class WatchlistController {
  constructor(private readonly service: WatchlistService) {}

  /** GET /watchlist — return all of the current user's categories with items. */
  @Get()
  async list(@CurrentUser() user: CurrentUserPayload): Promise<WatchlistOverviewResponse> {
    return this.service.getWatchlist(user.userId);
  }

  /** POST /watchlist — upsert a category and its items in one call. */
  @Post()
  async save(
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(saveWatchlistRequestSchema)) body: SaveWatchlistRequest,
  ): Promise<WatchlistCategoryResponse> {
    return this.service.saveWatchlistItems(user.userId, body);
  }
}
```

- [ ] **Step 2.4 — Wire the controller into the module**

Edit `apps/api/src/watchlist/watchlist.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { WatchlistService } from './watchlist.service';
import { WatchlistController } from './watchlist.controller';

@Module({
  controllers: [WatchlistController],
  providers: [WatchlistService],
  exports: [WatchlistService],
})
export class WatchlistModule {}
```

- [ ] **Step 2.5 — Register `WatchlistModule` in `app.module.ts`**

Search for the `imports: [` block in `apps/api/src/app.module.ts` and append `WatchlistModule`. Don't drop or reorder anything else.

- [ ] **Step 2.6 — Run, verify PASS**

```
pnpm --filter @finsentinel/api vitest run src/watchlist/__tests__/watchlist.controller.spec.ts
pnpm --filter @finsentinel/api typecheck
```

- [ ] **Step 2.7 — Commit**

```bash
git add apps/api/src/watchlist/watchlist.controller.ts \
        apps/api/src/watchlist/__tests__/watchlist.controller.spec.ts \
        apps/api/src/watchlist/watchlist.module.ts \
        apps/api/src/app.module.ts
git commit -m "feat(watchlist): expose REST controller (GET + POST) and wire module"
```

---

### Task 3: frontend client `apps/web/src/api/watchlist.ts`

**Files:**

- Create: `apps/web/src/api/watchlist.ts`
- Create: `apps/web/src/api/__tests__/watchlist.test.ts`

- [ ] **Step 3.1 — Write failing test**

`apps/web/src/api/__tests__/watchlist.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../client', () => ({
  resolveBase: () => '/api',
  authHeaders: () => ({ Authorization: 'Bearer test' }),
  apiFetch: vi.fn(),
}));

const { apiFetch } = await import('../client');
const { watchlistApi } = await import('../watchlist');

describe('watchlistApi', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('list() GETs /watchlist via apiFetch', async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ categories: [] });
    const out = await watchlistApi.list();
    expect(apiFetch).toHaveBeenCalledWith('/watchlist');
    expect(out).toEqual({ categories: [] });
  });

  it('save() POSTs to /watchlist with the JSON body', async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'cat-1' });
    const body = { categoryName: 'Dashboard', items: [{ symbol: 'AAPL' }] };
    await watchlistApi.save(body);
    const call = (apiFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('/watchlist');
    expect((call[1] as RequestInit).method).toBe('POST');
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual(body);
  });
});
```

- [ ] **Step 3.2 — Implement the client**

`apps/web/src/api/watchlist.ts`:

```ts
import { apiFetch } from './client';
import type {
  SaveWatchlistRequest,
  WatchlistCategoryResponse,
  WatchlistOverviewResponse,
} from '@finsentinel/shared';

export const watchlistApi = {
  list: (): Promise<WatchlistOverviewResponse> => apiFetch('/watchlist'),

  save: (body: SaveWatchlistRequest): Promise<WatchlistCategoryResponse> =>
    apiFetch('/watchlist', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export type { SaveWatchlistRequest, WatchlistOverviewResponse, WatchlistCategoryResponse };
```

- [ ] **Step 3.3 — Run, verify PASS**

```
pnpm --filter @finsentinel/web vitest run src/api/__tests__/watchlist.test.ts
```

- [ ] **Step 3.4 — Commit**

```bash
git add apps/web/src/api/watchlist.ts apps/web/src/api/__tests__/watchlist.test.ts
git commit -m "feat(web): watchlist API client (list + save)"
```

---

### Task 4: Dashboard migration

**Files:**

- Modify: `apps/web/src/views/DashboardPage.tsx`

- [ ] **Step 4.1 — Read current loadWatchlist helpers**

```
sed -n '20,42p' apps/web/src/views/DashboardPage.tsx
```

The current helpers are sync (read localStorage). We replace them with an async server fetch + a local cache as offline fallback.

- [ ] **Step 4.2 — Edit DashboardPage.tsx**

Replace the `LS_KEY`/`loadWatchlist`/`saveWatchlist` helpers with:

```ts
const LS_KEY = 'finsentinel_watchlist';
const SERVER_CATEGORY_NAME = 'Dashboard';

function loadCachedTickers(): string[] {
  try {
    const stored = typeof window !== 'undefined' && window.localStorage.getItem(LS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter((t): t is string => typeof t === 'string');
      }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_TICKERS;
}

function cacheTickers(tickers: string[]) {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(tickers));
  } catch {
    /* ignore */
  }
}
```

In the component, after the current `useState(loadWatchlist)` line, add a `useEffect` that fetches from the server, falling back to the cached value on error:

```tsx
import { watchlistApi } from '../api/watchlist';

// inside Dashboard():
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const overview = await watchlistApi.list();
      if (cancelled) return;
      const dash = overview.categories.find((c) => c.name === SERVER_CATEGORY_NAME);
      if (dash && dash.items.length > 0) {
        const symbols = dash.items.map((i) => i.symbol);
        setWatchlist(symbols);
        cacheTickers(symbols);
        return;
      }
      // Server has no Dashboard category yet — auto-import legacy localStorage
      // contents (or DEFAULT_TICKERS) as a one-time bootstrap.
      const cached = loadCachedTickers();
      if (cached.length > 0) {
        await watchlistApi.save({
          categoryName: SERVER_CATEGORY_NAME,
          items: cached.map((symbol) => ({ symbol })),
        });
      }
    } catch {
      // Offline / unauth / error: fall back to whatever we have cached,
      // which the initial useState already populated.
    }
  })();
  return () => {
    cancelled = true;
  };
}, []);
```

Replace `saveWatchlist(updated)` call sites with a write-through that updates both the server and the cache:

```ts
async function persist(updated: string[]) {
  cacheTickers(updated);
  try {
    await watchlistApi.save({
      categoryName: SERVER_CATEGORY_NAME,
      items: updated.map((symbol) => ({ symbol })),
    });
  } catch {
    // Stay optimistic — cached copy keeps the UI consistent until the
    // network comes back.
  }
}
```

Update the existing `setWatchlist(updated)` + `saveWatchlist(updated)` pairs in `removeTicker` and the add-ticker path to call `persist(updated)` after `setWatchlist(updated)`. Don't change the rendering or quote-fetching code — those still take `watchlist` as the input.

Also rename the unused `saveWatchlist` to `persist` (delete the old function entirely if it's no longer referenced).

- [ ] **Step 4.3 — Verify typecheck + run web tests**

```
pnpm --filter @finsentinel/web typecheck
pnpm --filter @finsentinel/web vitest run
```

- [ ] **Step 4.4 — Commit**

```bash
git add apps/web/src/views/DashboardPage.tsx
git commit -m "feat(web): Dashboard reads watchlist from server + local cache fallback

Auto-imports the legacy localStorage.finsentinel_watchlist into a
'Dashboard' server category on first run. Mutations write through to both
the cache (instant UI) and the server (cross-device truth). Network/auth
failures fall back silently to the cache."
```

---

### Task 5: full verification + progress log

- [ ] **Step 5.1 — Verify suites**

```
pnpm --filter @finsentinel/api typecheck
pnpm --filter @finsentinel/api vitest run -- watchlist
pnpm --filter @finsentinel/web typecheck
pnpm --filter @finsentinel/web vitest run
```

- [ ] **Step 5.2 — Append progress log to PRD**

Append `## 8. Implementation Progress Log` to `docs/product-specs/2026-04-23-watchlist-server-persistence.md`:

```
## 8. Implementation Progress Log

- 2026-04-24: branch `feat/2026-04-23-watchlist-server-persistence` opened.
- 2026-04-24: implemented Tasks 1–4 per `docs/exec-plans/2026-04-23-watchlist-server-persistence.md`.
  - Task 1: `saveWatchlistRequestSchema` (Zod) added to `packages/shared/src/schemas/watchlist.ts`.
  - Task 2: `WatchlistController` exposes `GET /watchlist` and `POST /watchlist`. Module wired into `AppModule`.
  - Task 3: `apps/web/src/api/watchlist.ts` typed client.
  - Task 4: `DashboardPage.tsx` reads from server, write-through to server + cache, auto-imports legacy localStorage.
- Verification: `pnpm --filter @finsentinel/api vitest run -- watchlist` green; web vitest + typecheck green.
- Deferred:
  - Item-level CRUD (`PATCH /watchlist/items/:id`, `DELETE`) — service surface needed first.
  - Settings page redesign exposing thesis/notes/priority editing.
  - Real-time multi-device sync.
```

- [ ] **Step 5.3 — Commit progress log**

```bash
git add docs/product-specs/2026-04-23-watchlist-server-persistence.md
git commit -m "docs(watchlist): log server-persistence implementation progress"
```

---

## Self-Review Checklist

- [x] Spec coverage: §5.1 endpoints (`GET /watchlist`, `POST /watchlist`) → Task 2. §5.2 frontend client + Dashboard migration → Tasks 3+4. §5.3 legacy migration → Task 4. Item CRUD explicitly out-of-scope per the plan header.
- [x] No placeholders: every step has runnable code or a runnable command.
- [x] Type consistency: `SaveWatchlistRequest` defined once in shared and re-imported on both api + web.
- [x] Verification: each task ends in tests + commit.
- [x] Scope discipline: no broadening of `WatchlistService` (only exposes what already exists), no Settings UI, no real-time sync.

## Risks Going In

- The Dashboard migration writes through on every add/remove — if the user spams adds, we'll fire a POST per change. For the V1 scope (low-frequency UI) this is acceptable; if it becomes a problem, debounce the persist call.
- The legacy import only runs once when the server returns no `Dashboard` category. If the user later deletes the category server-side, the next mount would re-import the local cache. Acceptable for V1; flag for future once category-deletion exists.
- POST shape uses `categoryName` rather than ID. The `WatchlistService.upsertCategory` already handles "create or update by name", so this stays idempotent across retries.
