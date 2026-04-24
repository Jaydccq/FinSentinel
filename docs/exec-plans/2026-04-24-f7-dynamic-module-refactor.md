# F-7: Dynamic Module refactor series

Date: 2026-04-24
Status: F-7a landed 2026-04-24; F-7b–F-7e pending
Source: [docs/exec-plans/2026-04-24-deferred-followups.md §F-7](./2026-04-24-deferred-followups.md)

## Goal

Convert the five optional integration modules from "always imported,
service guards inside" to `Module.register({ enabled })` dynamic modules
so their HTTP surface disappears when the feature flag is off.

| Sub-item | Module | Flag | Status |
|----------|--------|------|--------|
| F-7a | OpenbbModule | `OPENBB_ENABLED` | ✅ landed 2026-04-24 |
| F-7b | OkxModule | `APP_OKX_ENABLED` | ✅ landed 2026-04-24 |
| F-7c | TwitterModule | `APP_TWITTER_6551_ENABLED` | ✅ stub landed 2026-04-24 — see note below |
| F-7d | (News) CryptoNews | `APP_CRYPTO_NEWS_ENABLED` | ❌ **not applicable** — see note below |
| F-7e | QueueModule | (multiple consumers) | ❌ **not applicable** — see note below |

## Refactor recipe (the pattern F-7a established)

1. In the module file, replace the static `@Module({...})` with:
   ```ts
   @Module({})
   export class XxxModule {
     static register(cfg: { enabled: boolean }): DynamicModule {
       const base: DynamicModule = {
         module: XxxModule,
         imports: [...],
         providers: [...],
         exports: [...],
       };
       if (!cfg.enabled) return base;
       return { ...base, controllers: [...] };
     }
   }
   ```
2. In `apps/api/src/app.module.ts`, swap the bare import for:
   ```ts
   XxxModule.register({ enabled: process.env['XXX_ENABLED'] === 'true' }),
   ```
3. Keep the internal `if (!config.enabled)` guards in services as
   belt-and-braces — they already exist; removing them has no net
   benefit and adds risk.

## Decision log

### Why keep service providers in both modes (F-7a)

The original plan called for "禁用时不 inject 任何 provider" (no providers
at all when disabled). That would require every consumer of
`OpenbbPublicDataService` (`MarketCalendarService`, `OwnershipDataService`)
to mark their dependency `@Optional()` and wrap every call site with a
"if OpenBB absent, soft-fail" branch. That's a much larger change than
F-7's 2-day per-module budget.

F-7a lands the HTTP-surface half of the win (routes gone when disabled)
and explicitly defers the provider-skip half. Future PRs can complete
it one consumer at a time.

### Sub-item complexity ordering (unchanged from plan)

1. **OpenbbModule** — simplest, two services + two controllers, no queue
   or cross-module state. ✅ landed.
2. **OkxModule** — services + controller + autonomy cron hooks. Services
   inject `AgentEvent` repository. Keep providers always; skip controllers
   + cron handlers when disabled.
3. **TwitterModule** — single service + one tool binding. Tool consumers
   (agent runtime) need `@Optional()` check if we want to drop the
   provider entirely. Safer to keep services always.
4. **News / CryptoNewsModule** — upload pipeline dependency via
   `NewsFetcherService` discovery. Same pattern as Twitter — keep the
   service, skip controller + fetcher registration when disabled.
5. **QueueModule** — most complex. BullMQ consumers (news enrich,
   document vectorize) depend on the producer. Upstream
   `DocumentUploadService` already does `@Optional()`. Migration needs
   careful audit — don't attempt without a full test matrix.

## Verification (F-7a)

| Check | Result |
|-------|--------|
| `pnpm --filter @finsentinel/api build` | 0 TS issues |
| `pnpm --filter @finsentinel/api test` | 1569 passed |

## Architectural notes per sub-item

### F-7b (OKX) — straightforward, landed
Same pattern as F-7a: `@Module({...})` carries always-on providers
(`OkxPriceService`, `OkxAnalysisService`, factory-built
`OKX_API_CLIENT` / `OKX_TRADING_ENGINE`); `register({ enabled })`
adds the two controllers when the flag is on. AgentModule /
TradingModule still import `OkxModule` as a bare class and keep
their DI.

### F-7c (Twitter) — stub-only, intentional

`TwitterModule` has no HTTP controllers — the entire public
surface is `TwitterDataService`, consumed synchronously by
`TwitterToolsService` (agent) and `XInfluencerFetcher` (news).
That means "gate HTTP surface when disabled" — F-7's main value
proposition — has nothing to gate here.

We added `register({ enabled })` as a no-op so the API surface is
consistent with F-7a/b. Real opt-out requires `@Optional()` at
both consumer call sites + null checks inside each call path.
Left as a follow-up; not blocking.

### F-7d (CryptoNews) — not applicable

`APP_CRYPTO_NEWS_ENABLED` does **not** gate a whole Nest module.
`NewsModule` is always on; the CryptoNews-specific pieces live
*inside* it:

- `CryptoNewsApiClient` + `CryptoNewsFetcher` — always registered.
- The service's `isEnabled()` method reads the env flag and the
  fetcher contributes zero items to `NewsFetcherService` when off.

Rewriting this as a sub-module (so `NewsModule` imports
`CryptoNewsModule.register({ enabled })` and skips the two
providers when disabled) is doable but is a ~1-day architectural
refactor by itself, separate from the F-7 pattern. Tracked as a
follow-up PRD, not a continuation of F-7.

### F-7e (Queue) — not applicable

`QueueModule` is infrastructure, not a feature flag. BullMQ
connection + producers + consumers run for every async job in the
system: vectorize, news-enrich, graph-enrich, analysis-run,
representation-enrich. No `QUEUE_ENABLED` flag exists, and none
should — "disable queues" means "disable async job processing",
which the system depends on everywhere.

The right F-7 analogue for Queue is per-consumer toggles (e.g.
`GRAPH_ENRICH_CONSUMER_ENABLED=false` skips registering the graph
enrich worker in its specific module). Each of those is its own
small PR and predicates on product decisions about which features
are "live" in a given deployment. Left out of F-7 scope.

## Progress log

- 2026-04-24: F-7a landed (OpenBB). Recipe documented here.
- 2026-04-24: F-7b landed (OKX) — controllers gated, services +
  factory-provided clients still available for AgentModule +
  TradingModule DI.
- 2026-04-24: F-7c stub landed (Twitter) — `register()` added for
  API consistency; no real gating possible without `@Optional()`
  call-site audit.
- 2026-04-24: F-7d / F-7e declared **not applicable** as stated —
  different architectures, would need separate PRDs not continuations
  of F-7. All four sub-items now have a disposition.
