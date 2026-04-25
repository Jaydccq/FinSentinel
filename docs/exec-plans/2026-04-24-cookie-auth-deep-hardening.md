# PRD: Cookie-auth deep hardening (item 2)

Date: 2026-04-24
Status: Draft — awaiting review
Priority: P1 (CSRF, login rate-limit) / P2 (refresh+access split, jti blacklist)

## 1. Problem

JwtGuard now reads the env-driven cookie name (item 1a, landed) and the token payload is Zod-validated with iss/aud/jti (item 1b, landed). Cookie auth is still missing the standard defenses every financial app ships:

1. **CSRF double-submit**: cookie auto-attaches on every same-site request, so write endpoints (trading, portfolio, watchlist, report generation) are vulnerable to CSRF from a compromised or malicious third-party page.
2. **Login rate-limit**: no per-IP, per-username, or combined throttle on `/api/auth/login`. A credential-stuffing bot gets unlimited attempts.
3. **Failure delay / lockout**: wrong password returns fast and predictably — enumeration is trivial.
4. **Refresh vs access**: one JWT holds 24h of lifetime. A stolen cookie is valid for 24h with no revocation.
5. **Logout jti blacklist**: logout clears the cookie but the underlying JWT stays cryptographically valid until exp. Item 1b added jti claims; we now need a revocation store that the guard consults.

## 2. Sub-decisions to lock before implementation

| Q | Options | Default proposal |
|---|---|---|
| CSRF strategy | (a) double-submit cookie + custom header, (b) origin check only, (c) both | **(c) both** — origin header check cheap; double-submit is the backstop |
| CSRF token lifetime | per-session, per-request (hit), per-window | per-session (rotated on login/logout) |
| Refresh token storage | cookie (HttpOnly), localStorage, keychain | cookie (HttpOnly, separate name `FS_REFRESH`), path scoped to `/api/auth/refresh` |
| Refresh token lifetime | 7 / 14 / 30 days | 7 days — forces weekly re-login |
| Access token lifetime (after refresh is added) | 5 / 15 / 60 min | 15 min |
| Revocation store | Redis hash, PG table | Redis (existing infra; revocation flows are hot path) |
| Rate-limit library | `@nestjs/throttler`, hand-rolled, Redis-backed | `@nestjs/throttler` + Redis storage — one dep, battle-tested |
| Login lockout policy | soft delay vs hard lockout | soft delay (exponential: 100ms × 2^fails, cap 5s) + hard lockout at 10 consecutive fails per (username, IP) with 15-min TTL |

## 3. Scope by sub-item

### 3.1 CSRF (P1, S effort)

**Files:**
- New: `apps/api/src/auth/csrf.middleware.ts` — issues `FS_CSRF` cookie (non-HttpOnly) on login/register; for any `POST|PUT|PATCH|DELETE` request checks `X-CSRF-Token` header == cookie value, and checks `Origin` header against `corsOrigins` whitelist.
- New: `apps/api/src/auth/__tests__/csrf.middleware.spec.ts`
- Modify: `apps/api/src/main.ts` — wire middleware after `cookieParser`.
- Modify: frontend `apps/web/src/lib/api/fetch.ts` (or equivalent) — read `FS_CSRF` cookie, set `X-CSRF-Token` header on write requests.
- Allow-list: `/api/auth/login`, `/api/auth/register`, `/api/auth/refresh` (those establish the cookie), `/api/health`.

**Acceptance:**
- Write request without CSRF header → 403.
- Write request with wrong CSRF header → 403.
- Origin not in whitelist → 403 even if CSRF matches.
- Existing GET endpoints unaffected.

### 3.2 Login rate-limit + soft delay (P1, S effort)

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts` — wrap `login()` with `@nestjs/throttler` `@Throttle({ default: { limit: 20, ttl: 60_000 } })` and a per-(username, ip) Redis counter.
- Add exponential soft delay on failure (`setTimeout(100 * 2^fails)` capped at 5s).
- Hard lockout at 10 consecutive fails per (username, ip): 15-min TTL, returns 423 Locked.

**Acceptance:**
- 21st login attempt within 60s from same IP → 429.
- 10 consecutive failed (username, ip) attempts → 11th returns 423 even with correct password.
- Successful login resets the (username, ip) fail counter.

### 3.3 Refresh + access token split (P2, M effort)

**Files:**
- New: `apps/api/src/auth/refresh.service.ts`
- New: endpoint `POST /api/auth/refresh` — rotates the refresh token (rolling refresh) and issues a new access token.
- Modify: `auth.controller.ts` login/register issue both cookies.
- Modify: frontend — add silent refresh on 401 (one retry, then surface).

**Acceptance:**
- Access token lifetime 15 min; expired access → 401 with a specific error code triggering the refresh flow.
- Refresh rotation: old refresh token becomes invalid after use (rolling pattern).
- Refresh reuse → all tokens for the user are revoked (reuse detection).

### 3.4 jti blacklist on logout (P2, M effort)

Depends on refresh-token work — blacklist at the access-token level alone is weak if refresh outlives access.

**Files:**
- New: Redis `revoked_jti:<jti>` with TTL = time-until-exp.
- Modify: `jwt.guard.ts` — after payload parse, check revocation store for `payload.jti`. If present → 401.
- Modify: `auth.controller.ts` `/logout` — add jti to the blacklist before clearing cookies.

**Acceptance:**
- Post-logout, an old captured cookie sent to a protected endpoint → 401 (not 200).
- Non-revoked tokens unaffected (no perf regression in hot path — Redis GET is <1ms).

## 4. Sequencing within the PRD

```
M1 (P1): 3.1 CSRF           — 2–3 days, independent
M2 (P1): 3.2 Rate-limit     — 1–2 days, independent
M3 (P2): 3.3 Refresh/Access — 4–5 days, depends on guard being quiet; M1+M2 first
M4 (P2): 3.4 jti blacklist  — 2 days, depends on M3 (shares Redis keys)
```

## 5. Out of scope

- Device-fingerprint binding (ties a JWT to a specific UA/browser): useful but adds UX friction; revisit after M4.
- WebAuthn / MFA: product decision; separate PRD.
- Session management UI ("log out other devices"): depends on M4.

## 6. Owner

TBD — user-level decisions (token lifetimes, lockout policy) need product + security signoff before M1 starts.

## 7. Progress log

### 2026-04-24 — M1 CSRF double-submit + Origin check (DONE on `feat/2026-04-24-csrf-double-submit`)

Implemented:
- `apps/api/src/auth/csrf.middleware.ts` — Nest middleware; SAFE_METHODS pass through, allow-list (`/api/auth/login`, `/api/auth/register`, `/api/auth/refresh`, `/api/health`) pass through, no-`FS_AUTH`-cookie path passes through (bearer-token / SDK callers), Origin (or Referer fallback) checked against `auth.corsOrigins`, `X-CSRF-Token` header compared to `FS_CSRF` cookie value. Fail paths throw `ForbiddenException` (403) with distinct messages.
- Wired globally via `AppModule.configure()` (`forRoutes('*')`); registered as a provider in `AuthModule` so DI picks up `ConfigService`.
- `apps/api/src/auth/auth.controller.ts` — register/login now also set `FS_CSRF` cookie (`randomUUID()`, `httpOnly: false`, secure/sameSite/maxAge mirror `FS_AUTH`). Logout clears both `FS_AUTH` and `FS_CSRF`.
- `apps/web/src/api/client.ts` — exported `withCsrfHeader(method, headers)` helper that reads `document.cookie` for `FS_CSRF` and stamps `X-CSRF-Token` on POST/PUT/PATCH/DELETE. `apiFetch` calls it automatically; scattered direct-fetch sites (`chat.ts`, `documents.ts`, `analysis.ts`, `okx.ts`, `analysis-approvals.ts`, `analysis-runs.ts`) updated to call it explicitly.

Verification:
- `apps/api/src/auth/__tests__/csrf.middleware.spec.ts` (10 cases incl. GET pass-through, allow-list, no-cookie pass-through, missing/mismatched/bad-origin/bad-token 403s, happy path, Referer fallback). PASS.
- `apps/api/src/auth/__tests__/auth.controller.spec.ts` extended to assert FS_CSRF set on register/login (non-HttpOnly) and cleared on logout. PASS.
- `pnpm exec vitest run src/auth` → 5 files / 43 tests PASS.
- `pnpm exec vitest run src/__tests__/integration` → 3 files / 20 tests PASS (auth-flow, trading-flow, chat-stream all green; integration tests use bearer-token clients via `X-Client: desktop`, so CSRF middleware passes them through unchanged — no setup edits needed).
- `pnpm --filter @finsentinel/api typecheck` → clean.
- `pnpm --filter @finsentinel/web typecheck` → clean.
- `pnpm --filter @finsentinel/web lint` → clean.
- `pnpm --filter @finsentinel/web test -- --run` → 19 files / 85 tests PASS (added `withCsrfHeader` to the `vi.mock('../client', …)` stub in `analysis-runs.test.ts`).

Out of this milestone (deferred at M1 land time):
- M2 rate-limit, M3 refresh/access split, M4 jti blacklist.

### 2026-04-24 — M2 login rate-limit + soft delay + lockout (DONE, commit `3eb6672`, merged via `34f805a`)

Shipped:
- `apps/api/src/auth/login-protection.service.ts` — Redis-backed `(username, ip)` consecutive-failure tracker. `recordFailure` INCRs `login:fails:${u}:${ip}` with 15-min TTL; on count ≥ 10 SETs `login:lock:${u}:${ip}` with 15-min TTL. `checkLocked` EXISTS-checks the lock key. `computeDelayMs(fails)` returns `min(5000, 100 * 2^min(fails,6))`. `resetOnSuccess` DELs both keys.
- `apps/api/src/auth/auth.service.ts` — `login()` now takes `clientIp` second arg. Order: lock check → password check → on fail: `recordFailure` + `await sleep(computeDelayMs)` + throw 401; on success: `resetOnSuccess` then continue. Lock check throws `HttpException(423)`.
- `apps/api/src/auth/auth.controller.ts` — login route guarded by existing `RateLimitGuard` with `@RateLimit({ limit: 20, windowSecs: 60, key: 'auth-login' })`. Client-IP resolution helper mirrors `RateLimitGuard`'s trusted-proxy CIDR list (`127.*`, `::1`, `10.*`, `172.16-31.*`, `192.168.*`) so the per-IP throttle key and the per-(user, ip) lockout key identify the same client.

**Library decision (deviation from PRD §2):** did NOT install `@nestjs/throttler`. The repo already had a Redis-backed `RateLimitGuard` + `RateLimiterService` in `apps/api/src/common` using the same atomic INCR-with-TTL pattern as `@nestjs/throttler-storage-redis`, so reused it via `@RateLimit(...)` decorator. One fewer dep.

Tests:
- `login-protection.service.spec.ts`: 16 cases (INCR/TTL, lockout at fail #10, isolation by `(user, ip)`, reset on success, parametrized delay formula incl. 5s cap).
- Extended `auth.service.spec.ts` (+5) and `auth.controller.spec.ts` (existing 7 still green) to wire `RateLimitGuard` + permissive stubs.
- `auth-flow.integration.spec.ts` (+1): 10 wrong passwords → 11th with correct password returns 423 → manual lock-clear → 200. Real exponential delays patched to 0 in this single test (try/finally) so delay-budget doesn't dominate.
- `test-app.factory.ts` mock Redis gained `exists()` and `EX`-flag-aware `set()`.
- Aggregate: `pnpm exec vitest run src/auth src/common` → 16 files / 118 tests PASS; `src/__tests__/integration` → 3 files / 21 tests PASS; typecheck clean.

Notes:
- `AuthModule` ⇄ `CommonModule` cycle resolved with `forwardRef` on the `imports` array (CommonModule already imported AuthModule for `JwtGuard`).
- `/api/auth/register` intentionally NOT rate-limited here (different threat model — needs CAPTCHA/email-verification, not throttling).

### Deferred (M3 + M4 — in flight on `feat/2026-04-25-trading-state-machine-and-auth-refresh`)

- **M3 refresh + access split**: separate `FS_REFRESH` cookie (HttpOnly, path-scoped to `/api/auth/refresh`), 15-min access lifetime, rolling refresh rotation, refresh-reuse detection revokes all user tokens. Frontend silent-refresh on 401. **Behind feature flag `AUTH_REFRESH_TOKENS_ENABLED`, default OFF** because shorter access lifetime is UX-visible (silent-refresh failures surface as logout).
- **M4 jti blacklist**: Redis `revoked_jti:<jti>` with TTL = exp - now; `JwtGuard` checks the store after Zod parse; logout adds the current jti before clearing cookies. Independent of M3 in code, but value depends on M3 (without short access tokens, blacklist is tiny window). Default OFF behind `AUTH_JTI_REVOCATION_ENABLED`.
