# Exec Plan: Market Search Provider Abstraction (P1 slice)

> **For agentic workers:** REQUIRED SUB-SKILL — superpowers:executing-plans.

**Source PRD:** `docs/product-specs/2026-04-23-market-search-provider-abstraction.md`
**Branch:** `feat/2026-04-23-market-search-abstraction`
**Goal:** Stop the `MarketDataService.searchTickers` from hard-coupling to Yahoo. Route ticker search through the same provider registry that quote/history use, normalize the cache key.
**Approach:** Add an optional `searchTickers` method to the `MarketDataProvider` interface; move the existing Yahoo search call into the YahooFinance provider; have the registry expose `getSearchProvider()` (default first, then Yahoo fallback); rewrite `MarketDataService.searchTickers` to delegate through the registry with a normalized cache key.

## Out of scope

- Adding new search providers (Polygon, Alpaca search). Provider interface gets the optional method; only Yahoo implements it for now.
- New search response shape — keep `TickerSearchResult` unchanged.

## File Map

| Path                                                        | Role                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| `apps/api/src/market/interfaces/market-data-provider.ts`    | MODIFY — add optional `searchTickers`.                            |
| `apps/api/src/market/providers/yahoo.provider.ts`           | MODIFY — implement `searchTickers` (move from MarketDataService). |
| `apps/api/src/market/market-data-provider.registry.ts`      | MODIFY — add `getSearchProvider()`.                               |
| `apps/api/src/market/market-data.service.ts`                | MODIFY — delegate through registry; normalize cache key (`v2`).   |
| `apps/api/src/market/__tests__/market-data.service.spec.ts` | MODIFY — adjust + add tests for new path.                         |

## Tasks

### Task 1: extend `MarketDataProvider` interface + Yahoo implementation

- [ ] Add optional `searchTickers?(query: string, limit: number): Promise<TickerSearchResult[]>` to the interface.
- [ ] Move the existing `callYahooSearch` body from `market-data.service.ts` into the `YahooFinanceMarketDataProvider` as the `searchTickers` method. Keep the URL builder using `new URL().searchParams` to lock the wire format. Verify with typecheck.
- [ ] Commit: `feat(market): add searchTickers to provider interface + Yahoo impl`.

### Task 2: registry exposes `getSearchProvider()`

- [ ] Add a `getSearchProvider()` method to `MarketDataProviderRegistry` that returns the default provider if it implements `searchTickers`, otherwise falls back to the Yahoo provider, otherwise throws a descriptive error.
- [ ] Add a unit test in the existing `__tests__` folder that constructs a registry with a non-Yahoo default and verifies `getSearchProvider()` falls back correctly.
- [ ] Commit: `feat(market): registry.getSearchProvider() with Yahoo fallback`.

### Task 3: `MarketDataService.searchTickers` delegates + normalizes cache key

- [ ] Replace the body of `MarketDataService.searchTickers`:
  - normalize input: `const normalized = query.trim().toLowerCase()`. Empty → return `[]`.
  - cache key: `market:search:v2:${normalized}:${limit}` (the `v2:` prefix invalidates legacy caches without colliding with them).
  - call `this.registry.getSearchProvider().searchTickers!(normalized, limit)` (the optional chaining is safe: `getSearchProvider` only returns providers with the method).
- [ ] Delete the now-orphaned `callYahooSearch` private method from MarketDataService.
- [ ] Update the existing `searchTickers` test expectations (cache key shape changed; assertion on Yahoo URL moves to the YahooProvider spec or stays mocked at the registry boundary).
- [ ] Add tests:
  - `'AAPL'`, `'aapl'`, `'  AAPL  '` produce the same cache lookup.
  - empty query short-circuits.
  - registry's search provider is called with normalized + limit.
- [ ] Commit: `feat(market): route search through registry + normalize cache key`.

### Task 4: full verification + progress log

- [ ] `pnpm --filter @finsentinel/api typecheck && pnpm --filter @finsentinel/api vitest run -- market-data`.
- [ ] Append `## 8. Implementation Progress Log` to the PRD.
- [ ] Whitelist the exec plan in `.gitignore`.
- [ ] Commit progress log.

## Self-Review

- Spec coverage: §5.1 provider abstraction → Tasks 1+2. §5.2 normalized cache key → Task 3. §5.3 URL hardening (already correct) → reaffirmed in Yahoo provider via `new URL`.
- No placeholders.
- Type consistency: `TickerSearchResult` re-used; interface change additive.
- Verification: every task ends in tests + commit.
- Scope discipline: 4 file edits + 1 spec edit. No new providers, no schema changes.

## Risks

- The `v2` cache prefix invalidates the existing search cache; one cold cache window after deploy. Acceptable for a small surface.
- If a future provider implements `searchTickers` but with subtly different result shape, the registry returns it directly. Document the contract on the interface comment.
