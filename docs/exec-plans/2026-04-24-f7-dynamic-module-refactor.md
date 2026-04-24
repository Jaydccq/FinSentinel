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
| F-7b | OkxModule | `APP_OKX_ENABLED` | pending |
| F-7c | TwitterModule | `APP_TWITTER_6551_ENABLED` | pending |
| F-7d | (News) CryptoNewsModule | `APP_CRYPTO_NEWS_ENABLED` | pending |
| F-7e | QueueModule | (multiple consumers) | pending — most complex |

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

## Progress log

- 2026-04-24: F-7a landed. OpenbbModule now `register({ enabled })`;
  app.module.ts updated. Doc + recipe for F-7b–e drafted here.
