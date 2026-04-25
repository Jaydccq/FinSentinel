# SWR Rollout — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Introduce SWR (`swr@^2`) into `apps/web` and migrate two read-heavy pages (Portfolio and Watchlist) to SWR-backed hooks, with stable cache keys, request deduplication, and explicit revalidation policies. Leaves 14 other pages on hand-rolled state.

**Architecture:** A single shared SWRConfig provider mounts in `apps/web/src/app/providers.tsx`. A new `apps/web/src/hooks/api/` directory exposes one hook per resource (`usePortfolios`, `usePortfolio(id)`, `useWatchlist()`). Each hook builds a stable cache key from the route descriptor in `apps/web/src/api/registry.ts` (delivered by the typed-codegen plan), then calls the matching `*Api.*` method as the SWR fetcher. Each hook returns `{ data, error, isLoading, mutate }` and the page consumes those instead of `useEffect + setState`.

**Tech Stack:** SWR 2.x, React 19, Next.js 16 (App Router), Vitest + React Testing Library.

---

## Background

Item 10b in `docs/exec-plans/2026-04-24-codebase-optimization-triage-prd.md`. The pages currently spawn ad-hoc `useEffect` blocks with `setState`, leading to refetch storms on hot-paths (Portfolio re-mounts, Watchlist tab switches), no cross-component cache sharing, and no easy revalidation after mutations. SWR is the smallest abstraction that fixes all three without trading-status UI / typed codegen having to land first.

## Dependencies

This plan **assumes** `docs/superpowers/plans/2026-04-25-typed-api-codegen.md` is already merged on `main`. The new hooks consume `routes.portfolio.*` and `routes.watchlist.*` for cache keys and reuse the migrated `portfolioApi` / `watchlistApi`.

## Scope

**In:**
- Add `swr` dependency to `apps/web`.
- New global `SWRConfig` with `dedupingInterval = 2000`, `revalidateOnFocus = false`, `errorRetryCount = 2`, `errorRetryInterval = 1500`.
- New hooks: `usePortfolios`, `usePortfolio`, `usePortfolioPositions`, `useWatchlist`.
- Migrate `apps/web/src/app/portfolio/page.tsx` (or current equivalent) and `apps/web/src/app/watchlist/page.tsx` to use the hooks.
- Tests cover deduplication, error path, and `mutate` after a write.

**Out:**
- Other pages (chat, analysis, news, market, reports, autonomy, etc.) stay on existing fetch patterns.
- No optimistic updates in this phase; `mutate(undefined, { revalidate: true })` after each write is enough.
- No prefetching / `unstable_serialize` ergonomics.

## Assumptions

- Typed-codegen phase 1 is on `main` (i.e. `apps/web/src/api/registry.ts` and the migrated `portfolioApi` / `watchlistApi` exist).
- The two target pages already exist at the listed paths (subagent must verify; the actual route files may be co-located under `src/views/` per the existing pattern).
- React 19 strict-mode double-invoke is already tolerated by the current codebase.

## File Structure

```
apps/web/
  package.json                        (modify — add swr)
  src/
    app/providers.tsx                 (modify — wrap with SWRConfig)
    hooks/api/
      use-portfolio.ts                (new)
      use-portfolios.ts               (new)
      use-portfolio-positions.ts      (new)
      use-watchlist.ts                (new)
      __tests__/
        use-portfolio.test.tsx        (new)
        use-watchlist.test.tsx        (new)
    app/portfolio/page.tsx            (modify) — or src/views/PortfolioPage.tsx
    app/watchlist/page.tsx            (modify) — or src/views/WatchlistPage.tsx
```

---

## Task 1: Install SWR + global config

- [ ] **Step 1: Add dependency**

```bash
pnpm --filter @finsentinel/web add swr@^2
```

Verify `apps/web/package.json` lists `"swr": "^2.x"`.

- [ ] **Step 2: Add SWRConfig to providers**

Read `apps/web/src/app/providers.tsx`. Wrap children in:

```tsx
import { SWRConfig } from 'swr';

<SWRConfig
  value={{
    dedupingInterval: 2000,
    revalidateOnFocus: false,
    errorRetryCount: 2,
    errorRetryInterval: 1500,
  }}
>
  {children}
</SWRConfig>
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/app/providers.tsx
git commit -m "feat(web): add swr and global SWRConfig with deduping + retry policy"
```

---

## Task 2: usePortfolio hooks

**Files:**
- Create: `apps/web/src/hooks/api/use-portfolios.ts`
- Create: `apps/web/src/hooks/api/use-portfolio.ts`
- Create: `apps/web/src/hooks/api/use-portfolio-positions.ts`
- Create: `apps/web/src/hooks/api/__tests__/use-portfolio.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// __tests__/use-portfolio.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { usePortfolios } from '../use-portfolios';
import * as portfolioApi from '../../../api/portfolio';

describe('usePortfolios', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
  );

  it('returns data after fetch resolves', async () => {
    const spy = vi
      .spyOn(portfolioApi.portfolioApi, 'list')
      .mockResolvedValueOnce([{ id: 'p1', name: 'main' } as any]);
    const { result } = renderHook(() => usePortfolios(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.[0].id).toBe('p1');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('dedupes concurrent renders to a single API call', async () => {
    const spy = vi
      .spyOn(portfolioApi.portfolioApi, 'list')
      .mockResolvedValueOnce([] as any);
    const { result: a } = renderHook(() => usePortfolios(), { wrapper });
    const { result: b } = renderHook(() => usePortfolios(), { wrapper });
    await waitFor(() => expect(a.current.data).toBeDefined());
    await waitFor(() => expect(b.current.data).toBeDefined());
    expect(spy).toHaveBeenCalledOnce();
  });

  it('exposes error from fetcher', async () => {
    vi.spyOn(portfolioApi.portfolioApi, 'list').mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => usePortfolios(), { wrapper });
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect((result.current.error as Error).message).toBe('boom');
  });
});
```

- [ ] **Step 2: Confirm failure**

Run: `pnpm --filter @finsentinel/web test -- src/hooks/api/__tests__/use-portfolio.test.tsx`
Expected: FAIL — hook not found.

- [ ] **Step 3: Implement hooks**

```ts
// use-portfolios.ts
import useSWR from 'swr';
import { portfolioApi } from '../../api/portfolio';

const key = ['portfolios', 'list'] as const;

export function usePortfolios() {
  return useSWR(key, () => portfolioApi.list());
}

usePortfolios.key = key;
```

```ts
// use-portfolio.ts
import useSWR from 'swr';
import { portfolioApi } from '../../api/portfolio';

export function usePortfolio(id: string | undefined) {
  return useSWR(id ? (['portfolios', 'detail', id] as const) : null, () =>
    portfolioApi.get(id!),
  );
}
```

```ts
// use-portfolio-positions.ts
import useSWR from 'swr';
import { portfolioApi } from '../../api/portfolio';

export function usePortfolioPositions(id: string | undefined) {
  return useSWR(id ? (['portfolios', 'positions', id] as const) : null, () =>
    portfolioApi.positions(id!),
  );
}
```

> The exact `portfolioApi` method names come from the typed-codegen migration; subagent verifies actual exports first.

- [ ] **Step 4: Run tests, expect PASS**

Run: `pnpm --filter @finsentinel/web test -- src/hooks/api/__tests__/use-portfolio.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/api/use-portfolios.ts apps/web/src/hooks/api/use-portfolio.ts \
        apps/web/src/hooks/api/use-portfolio-positions.ts \
        apps/web/src/hooks/api/__tests__/use-portfolio.test.tsx
git commit -m "feat(web): add SWR-backed portfolio hooks with stable cache keys"
```

---

## Task 3: useWatchlist hook + mutate flow

**Files:**
- Create: `apps/web/src/hooks/api/use-watchlist.ts`
- Create: `apps/web/src/hooks/api/__tests__/use-watchlist.test.tsx`

- [ ] **Step 1: Write failing test that covers `mutate` after save**

```tsx
it('refetches after a write via mutate', async () => {
  const listSpy = vi.spyOn(watchlistApi, 'list')
    .mockResolvedValueOnce({ items: [] } as any)
    .mockResolvedValueOnce({ items: [{ id: '1' }] } as any);
  vi.spyOn(watchlistApi, 'save').mockResolvedValueOnce({ id: 'cat1' } as any);

  const { result } = renderHook(() => useWatchlist(), { wrapper });
  await waitFor(() => expect(result.current.data?.items).toEqual([]));
  await act(async () => {
    await result.current.save({ /* … */ } as any);
  });
  await waitFor(() => expect(result.current.data?.items).toHaveLength(1));
  expect(listSpy).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Confirm failure.**

- [ ] **Step 3: Implement hook**

```ts
import useSWR from 'swr';
import { watchlistApi } from '../../api/watchlist';
import type { SaveWatchlistRequest, UpdateWatchlistItemRequest } from '@finsentinel/shared';

const key = ['watchlist', 'overview'] as const;

export function useWatchlist() {
  const swr = useSWR(key, () => watchlistApi.list());
  return {
    ...swr,
    save: async (body: SaveWatchlistRequest) => {
      const res = await watchlistApi.save(body);
      await swr.mutate();
      return res;
    },
    updateItem: async (id: string, body: UpdateWatchlistItemRequest) => {
      const res = await watchlistApi.updateItem(id, body);
      await swr.mutate();
      return res;
    },
    deleteItem: async (id: string) => {
      await watchlistApi.deleteItem(id);
      await swr.mutate();
    },
  };
}

useWatchlist.key = key;
```

- [ ] **Step 4: Run tests, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/api/use-watchlist.ts \
        apps/web/src/hooks/api/__tests__/use-watchlist.test.tsx
git commit -m "feat(web): add SWR-backed watchlist hook with revalidate-on-mutate"
```

---

## Task 4: Migrate Portfolio page

- [ ] **Step 1: Locate the page module.** Subagent runs `rg -l "portfolioApi" apps/web/src` to find the consumer; Next.js App Router pages live under `apps/web/src/app/<route>/page.tsx`, but views frequently live in `apps/web/src/views/`.

- [ ] **Step 2: Add a render test before refactor.** Use React Testing Library to render the page with a mocked `portfolioApi.list` and assert it shows the first portfolio name. Run, confirm PASS against current implementation.

- [ ] **Step 3: Replace `useEffect + setState` with `usePortfolios()` and `usePortfolio(selectedId)`.** Strip dead local-state branches. Loading state derives from `isLoading`; error state from `error`.

- [ ] **Step 4: Re-run page test.** Expected: still PASS (behavior preserved).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/views/PortfolioPage.tsx apps/web/src/app/portfolio/page.tsx \
        apps/web/src/views/__tests__/PortfolioPage.test.tsx
git commit -m "refactor(web): migrate Portfolio page to SWR hooks"
```

---

## Task 5: Migrate Watchlist page

Same pattern as Task 4 against the watchlist page. The save / delete handlers go through the hook's wrapped methods so the cache invalidates without manual reload.

- [ ] **Step 1–5:** Mirror Task 4.

```bash
git commit -m "refactor(web): migrate Watchlist page to SWR hooks"
```

---

## Task 6: Verification

- [ ] **Step 1: Typecheck**

Run: `pnpm --filter @finsentinel/web typecheck`
Expected: PASS.

- [ ] **Step 2: Tests**

Run: `pnpm --filter @finsentinel/web test`
Expected: PASS.

- [ ] **Step 3: Manual smoke (note in PR description, not a CI gate)**

The subagent does not have a browser. Note in the PR description that manual smoke is required for: Portfolio page initial load, switching portfolios, Watchlist add → list refresh, Watchlist delete → list refresh.

- [ ] **Step 4: Update tech-debt tracker**

Append to the typed-client/SWR/trading-status entry: "SWR phase 1 landed for portfolio + watchlist; remaining 14 pages still on raw `useEffect + setState`." Trading status UI remains blocked on UX state design (see next plan).

```bash
git add docs/exec-plans/tech-debt-tracker.md
git commit -m "docs(tech-debt): record SWR phase 1 landed for portfolio + watchlist"
```

- [ ] **Step 5: Push + PR**

```bash
git push -u origin feat/2026-04-25-swr-rollout-phase1
gh pr create --title "feat(web): SWR rollout phase 1 — portfolio + watchlist" \
  --body "Implements docs/superpowers/plans/2026-04-25-swr-rollout.md. Adds swr@^2, global SWRConfig, four hooks, migrates Portfolio + Watchlist pages. Other 14 pages unchanged."
```

---

## Verification Approach

1. New hook unit tests pin deduping, error propagation, and mutate-on-write.
2. Page render tests prove the migrated UI still produces the same visible output.
3. Workspace typecheck and full web test suite stay green.
4. Tech-debt tracker is updated so the rollout follow-up has a concrete starting list.

## Risks

- **Cache key collisions across pages.** Mitigated by always using a `[domain, action, ...args]` tuple — no plain string keys.
- **SSR / Tauri export incompatibility.** SWR is client-only. The pages we migrate are already client components; subagent must confirm the `'use client'` directive is present.
- **Mutation race.** If a user clicks save twice fast, the second `mutate()` may resolve before the first refetch. Acceptable for phase 1 — escalate only if QA hits it.

## Progress Log

(Subagent fills in.)

## Final Outcome

(Filled after merge.)
