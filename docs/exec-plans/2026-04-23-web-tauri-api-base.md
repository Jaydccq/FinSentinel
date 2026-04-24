# Exec Plan: Web / Tauri API Base URL Unification

> **For agentic workers:** REQUIRED SUB-SKILL — superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Source PRD:** `docs/product-specs/2026-04-23-web-tauri-api-base-url-unification.md`
**Branch:** `feat/2026-04-23-web-tauri-api-base`
**Goal:** Unify the browser and Tauri code paths so every fetch resolves the API base via `getApiBaseUrl()` instead of relying on a hardcoded `/api` prefix.
**Approach:** Introduce a single `resolveBase()` helper that combines `getApiBaseUrl()` with the `/api` Nest prefix, route the fetch client and the auto-login helper through it, and wire `providers.tsx` to pass the resolved base into `ensureLocalToken`.
**Tech:** Next.js 16 (custom), TypeScript, vitest. Local dev unchanged (browser + rewrites). Tauri builds get a real origin.

## Out of Scope

- Tauri-runtime base override (UI-driven settings).
- Tauri Playwright smoke (PRD #9).
- Cookie/token secure storage (P0-3 auth/session PRD).

## File Map

| Path | Role |
|------|------|
| `apps/web/src/api/client.ts` | MODIFY — add and use `resolveBase()`; remove `BASE = '/api'` literal. |
| `apps/web/src/api/__tests__/client.test.ts` | NEW — unit tests for `resolveBase()` + a fetch-mocked apiFetch test. |
| `apps/web/src/lib/auth/local-login.ts` | MODIFY — `performLogin` builds login URL via the same shared helper. |
| `apps/web/src/lib/auth/__tests__/local-login.test.ts` | NEW — unit test asserting `performLogin` hits `<base>/api/auth/login`. |
| `apps/web/src/providers.tsx` | MODIFY — `ensureLocalToken(getApiBaseUrl())`. |
| (no new exports) | The shared helper lives in `client.ts` and is also imported by `local-login.ts`. |

## Tasks

---

### Task 1: `resolveBase()` helper + tests

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Create: `apps/web/src/api/__tests__/client.test.ts`

- [ ] **Step 1.1 — Write failing test**

`apps/web/src/api/__tests__/client.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { resolveBase } from '../client';

describe('resolveBase', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it("returns '/api' (relative) when NEXT_PUBLIC_API_BASE_URL is unset (browser default)", () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    expect(resolveBase()).toBe('/api');
  });

  it('prepends a full origin when NEXT_PUBLIC_API_BASE_URL is set (Tauri build)', () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://127.0.0.1:8080';
    expect(resolveBase()).toBe('http://127.0.0.1:8080/api');
  });

  it('strips a trailing slash before joining', () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://127.0.0.1:8080/';
    expect(resolveBase()).toBe('http://127.0.0.1:8080/api');
  });
});
```

- [ ] **Step 1.2 — Run, verify FAIL**

```
pnpm --filter @finsentinel/web test -- client.test
```
Expected: FAIL — `resolveBase` is not exported from `../client`.

- [ ] **Step 1.3 — Implement `resolveBase` and remove the literal**

Replace the `const BASE = '/api'` line and the `BASE` re-export at the bottom of `apps/web/src/api/client.ts` with:

```ts
import { getApiBaseUrl } from '@/lib/api-base-url'

/**
 * Resolve the API URL prefix at call time.
 *
 * Browser dev/prod: NEXT_PUBLIC_API_BASE_URL is unset, returns '/api' so the
 * Next.js rewrites in apps/web/next.config.ts forward to NestJS.
 *
 * Tauri build (NEXT_PUBLIC_TAURI=1): rewrites are disabled because of
 * `output: 'export'`. The build injects a full origin via
 * NEXT_PUBLIC_API_BASE_URL, e.g. http://127.0.0.1:8080. We append /api so
 * the path matches the NestJS global prefix in apps/api/src/main.ts.
 */
export function resolveBase(): string {
  const origin = getApiBaseUrl();
  return origin ? `${origin}/api` : '/api';
}
```

Replace usages of `BASE` (the `${BASE}${path}` template inside `buildRequest`) with `${resolveBase()}${path}`.

Update the bottom export from `export { BASE, authHeaders }` to `export { resolveBase, authHeaders }`.

If any other file in the repo imports `BASE` from this module, fail loudly so you remember to update them — search before editing:

```
grep -rn "from '@/api/client'" apps/web/src --include="*.ts" --include="*.tsx" | grep BASE
```

- [ ] **Step 1.4 — Run, verify PASS**

```
pnpm --filter @finsentinel/web test -- client.test
```
Expected: 3 tests PASS.

- [ ] **Step 1.5 — Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/api/__tests__/client.test.ts
git commit -m "feat(web): resolveBase() unifies fetch base across browser + Tauri"
```

---

### Task 2: Fetch path uses `resolveBase()` end-to-end

**Files:**
- Modify: `apps/web/src/api/__tests__/client.test.ts` (extend with apiFetch test)

- [ ] **Step 2.1 — Add failing apiFetch test**

Append to `apps/web/src/api/__tests__/client.test.ts`:

```ts
import { vi, beforeEach } from 'vitest';
import { apiFetch } from '../client';

describe('apiFetch', () => {
  const original = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ pong: true }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    process.env = { ...original };
    vi.unstubAllGlobals();
  });

  it("hits '/api<path>' under browser (no env override)", async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    await apiFetch('/health');
    expect(fetchSpy).toHaveBeenCalled();
    const url = (fetchSpy.mock.calls[0]![0]) as string;
    expect(url).toBe('/api/health');
  });

  it('hits the full origin under Tauri build (env set)', async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://127.0.0.1:8080';
    await apiFetch('/health');
    const url = (fetchSpy.mock.calls[0]![0]) as string;
    expect(url).toBe('http://127.0.0.1:8080/api/health');
  });
});
```

- [ ] **Step 2.2 — Run, verify behavior**

```
pnpm --filter @finsentinel/web test -- client.test
```

If `apiFetch` already calls `await ensureLocalToken()` and that triggers a real fetch (because the local-login env vars happen to be set in the test process), stub `ensureLocalToken` too. The cleanest stub:

```ts
import * as localLogin from '@/lib/auth/local-login';
beforeEach(() => {
  vi.spyOn(localLogin, 'ensureLocalToken').mockResolvedValue(null);
});
```

Add this to the `apiFetch` describe block as needed to make the test deterministic. Re-run until both new tests PASS.

- [ ] **Step 2.3 — Commit**

```bash
git add apps/web/src/api/__tests__/client.test.ts
git commit -m "test(web): apiFetch URL composition for browser vs Tauri base"
```

---

### Task 3: `performLogin` uses the same base resolver

**Files:**
- Modify: `apps/web/src/lib/auth/local-login.ts`
- Create: `apps/web/src/lib/auth/__tests__/local-login.test.ts`

- [ ] **Step 3.1 — Write failing test**

`apps/web/src/lib/auth/__tests__/local-login.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('local-login performLogin URL composition', () => {
  const original = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 'tok-1' }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchSpy);
    // Local-login is gated on these env vars being present.
    process.env.NEXT_PUBLIC_LOCAL_USER_USERNAME = 'local';
    process.env.NEXT_PUBLIC_LOCAL_USER_PASSWORD = 'localpass1';
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    // Clear any module-level cached token from previous tests.
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...original };
    vi.unstubAllGlobals();
  });

  it("hits '/api/auth/login' (relative) when no API base set", async () => {
    const mod = await import('../local-login');
    mod.clearCachedToken();
    await mod.ensureLocalToken();
    const url = (fetchSpy.mock.calls[0]![0]) as string;
    expect(url).toBe('/api/auth/login');
  });

  it('hits a full origin under Tauri (env set)', async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://127.0.0.1:8080';
    const mod = await import('../local-login');
    mod.clearCachedToken();
    await mod.ensureLocalToken();
    const url = (fetchSpy.mock.calls[0]![0]) as string;
    expect(url).toBe('http://127.0.0.1:8080/api/auth/login');
  });
});
```

- [ ] **Step 3.2 — Run, verify FAIL**

```
pnpm --filter @finsentinel/web test -- local-login.test
```
Expected: 2nd test fails — current `ensureLocalToken()` defaults `apiBase` to `''`, so the URL resolves to `'/api/auth/login'` even when the env is set, because providers (not local-login itself) is responsible for passing the base in. We will fix that contract by making `local-login` resolve its own base from the env.

- [ ] **Step 3.3 — Refactor `local-login.ts`**

Two edits in `apps/web/src/lib/auth/local-login.ts`:

(a) Import the resolver:

```ts
import { getApiBaseUrl } from '../api-base-url'
```

(b) Replace the `performLogin` and `ensureLocalToken` signatures so the helper resolves its own base when none is passed:

```ts
async function performLogin(apiBase: string): Promise<string | null> {
  const username = process.env.NEXT_PUBLIC_LOCAL_USER_USERNAME
  const password = process.env.NEXT_PUBLIC_LOCAL_USER_PASSWORD
  if (!username || !password) return null

  const base = apiBase || getApiBaseUrl()
  const url = base ? `${base}/api/auth/login` : '/api/auth/login'

  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) return null

  const body = (await res.json()) as { token?: string }
  if (!body.token) return null

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(TOKEN_KEY, body.token)
  }
  return body.token
}

export function ensureLocalToken(apiBase?: string): Promise<string | null> {
  if (!isLocalLoginEnabled()) return Promise.resolve(null)

  const cached = getCachedToken()
  if (cached) return Promise.resolve(cached)

  const base = apiBase ?? getApiBaseUrl()
  if (!pendingLogin) {
    pendingLogin = performLogin(base).finally(() => {
      pendingLogin = null
    })
  }
  return pendingLogin
}
```

- [ ] **Step 3.4 — Run, verify PASS**

```
pnpm --filter @finsentinel/web test -- local-login.test
```
Expected: both tests PASS.

- [ ] **Step 3.5 — Commit**

```bash
git add apps/web/src/lib/auth/local-login.ts \
        apps/web/src/lib/auth/__tests__/local-login.test.ts
git commit -m "feat(web): performLogin resolves API base via getApiBaseUrl()"
```

---

### Task 4: `providers.tsx` passes resolved base explicitly

**Files:**
- Modify: `apps/web/src/providers.tsx`

- [ ] **Step 4.1 — Edit**

```tsx
'use client'

import { useEffect } from 'react'
import { AuthProvider } from '@/context/AuthContext'
import { I18nProvider } from '@/context/I18nProvider'
import { ensureLocalToken } from '@/lib/auth/local-login'
import { getApiBaseUrl } from '@/lib/api-base-url'
import Toast from '@/components/Toast'

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void ensureLocalToken(getApiBaseUrl())
  }, [])

  return (
    <I18nProvider>
      <AuthProvider>
        <Toast />
        {children}
      </AuthProvider>
    </I18nProvider>
  )
}
```

(Behaviorally equivalent to Task 3's defaulting, but makes the contract explicit at the call site so reviewers can see the wiring without reading into the helper.)

- [ ] **Step 4.2 — Verify nothing breaks**

```
pnpm --filter @finsentinel/web typecheck
```
Expected: clean.

- [ ] **Step 4.3 — Commit**

```bash
git add apps/web/src/providers.tsx
git commit -m "feat(web): providers passes resolved API base into ensureLocalToken"
```

---

### Task 5: Repository guard against `BASE = '/api'` regressions

**Files:** none. Just a verification step.

- [ ] **Step 5.1 — Verify no leftover hardcoded constant**

```
grep -rn "BASE = '/api'\|const BASE = \"/api\"" apps/web/src --include="*.ts" --include="*.tsx"
```
Expected: no matches.

```
grep -rn "fetch(.*'/api/" apps/web/src --include="*.ts" --include="*.tsx"
```
Expected: no matches outside test files (tests verifying the resolved URL are fine).

If any match shows up outside `__tests__`, route it through `resolveBase()` before continuing. Don't silently allow a single rogue caller — that's the bug we just fixed.

- [ ] **Step 5.2 — No commit needed.**

---

### Task 6: Final verification

- [ ] **Step 6.1 — Web typecheck + full test suite**

```
pnpm --filter @finsentinel/web typecheck
pnpm --filter @finsentinel/web test
```
Expected: green for both. If `vitest` flags a regression in any unrelated test, investigate before continuing — the URL change is small but it touches the auto-login critical path.

- [ ] **Step 6.2 — Confirm browser dev still works**

(Manual.) `pnpm --filter @finsentinel/web dev` — open `http://localhost:3000`, verify a known authenticated request (e.g. `/api/portfolio`) still loads through Next's rewrites. No env override expected for this path.

- [ ] **Step 6.3 — Update PRD progress log**

Append to `docs/product-specs/2026-04-23-web-tauri-api-base-url-unification.md` (new section at the end):

```
## 8. Implementation Progress Log

- 2026-04-23: branch `feat/2026-04-23-web-tauri-api-base` opened.
- 2026-04-23..24: implemented Tasks 1–5 per `docs/exec-plans/2026-04-23-web-tauri-api-base.md`.
- Verification: `pnpm --filter @finsentinel/web test` green; `grep` confirms no `BASE = '/api'` literal remains.
- Manual browser dev smoke passes (Next.js rewrites still routing).
- Tauri end-to-end smoke deferred to PRD #9 (`2026-04-23-desktop-ci-smoke-build.md`).
```

- [ ] **Step 6.4 — Commit progress log**

```bash
git add docs/product-specs/2026-04-23-web-tauri-api-base-url-unification.md
git commit -m "docs(web): log API base unification implementation progress"
```

---

## Self-Review Checklist

- [x] Spec coverage: §5.1 resolveBase → Task 1; §5.2 ensureLocalToken refactor → Tasks 3+4; §5.4 lint/grep gate → Task 5. §5.3 (Tauri runtime config) explicitly out-of-scope per the input.
- [x] No placeholders: every step has runnable code or a runnable command.
- [x] Type consistency: `resolveBase()` is the single shared name, exported by `client.ts` and re-imported only in tests; `getApiBaseUrl` is reused inside `local-login.ts` to keep one source of truth.
- [x] Verification: every task ends with a runnable command + commit.
- [x] Scope discipline: only client.ts, local-login.ts, providers.tsx + the two new test files. No drive-by refactors.

## Risks Going In

- `process.env` mutation between vitest cases is shared global state. The afterEach in each test restores via `process.env = { ...original }`. If a test leaks env, later tests can flake — keep the restore pattern.
- `ensureLocalToken` may be invoked transitively by `apiFetch` in Task 2 tests; stub it (Step 2.2 spells out the spy) so the assertion only inspects the apiFetch URL.
- `client.ts` currently re-exports `BASE`; if any consumer outside `apps/web` imports `BASE` we have to update them — `grep` in Step 1.3 catches that case before the commit.
