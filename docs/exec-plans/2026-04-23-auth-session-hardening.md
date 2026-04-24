# Exec Plan: Auth & Session Hardening (P0 slice)

> **For agentic workers:** REQUIRED SUB-SKILL — superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Source PRD:** `docs/product-specs/2026-04-23-auth-session-hardening.md`
**Branch:** `feat/2026-04-23-auth-session-hardening`
**Goal:** Make cookie flags + CORS env-driven, eliminate the register-race redundant pre-checks, and gate the response-body token to opt-in desktop callers — without touching the existing Tauri build.
**Approach:** Add a small `auth.cookie` typed config + `cors.origins` env. Replace SELECT-then-INSERT in register with INSERT + PG 23505 catch. Keep returning the token in the body **only** when the request carries `X-Client: desktop`; browser flows get the cookie alone.
**Tech:** NestJS + Drizzle + postgres-js + vitest.

## Out of Scope (deferred to follow-up slices)

- Desktop keychain integration (Tauri Rust + JS bridge).
- Removal of `NEXT_PUBLIC_LOCAL_USER_*` build-bake (depends on the keychain slice).
- 1-release backwards-compatibility shim that drains the legacy `localStorage.fs_local_token` (depends on the keychain slice).
- Helmet / request-id / compression middleware (lives in the platform-bootstrap PRD #8).

## What we keep

- `register()` and `login()` still return `{ token, username, email }` *to clients that send the desktop opt-in header*; everyone else gets `{ username, email }`.
- Default behaviour: cookie attributes match the previous defaults (`secure: false`, `sameSite: 'lax'`) so dev workflow is unchanged.
- DB schema is unchanged; no new migration. The V1 `users` table already has `UNIQUE (username, email)` constraints — the race lives in the application code's redundant SELECTs, not the DB.

## File Map

| Path | Role |
|------|------|
| `apps/api/src/config/auth.config.ts` | NEW — typed `auth.cookie` + `auth.cors` config (Zod-validated, mirrors existing config files). |
| `apps/api/src/config/__tests__/auth.config.spec.ts` | NEW — unit test for env→config mapping. |
| `apps/api/src/config/config.module.ts` | MODIFY — register the new config. |
| `apps/api/src/auth/auth.controller.ts` | MODIFY — read cookie attrs from typed config; gate token-in-body on `X-Client: desktop` header. |
| `apps/api/src/auth/auth.service.ts` | MODIFY — remove SELECT-then-INSERT race; INSERT, catch PG 23505, throw `ConflictException`. |
| `apps/api/src/auth/__tests__/auth.controller.spec.ts` | MODIFY — assert env-driven cookie attrs + header-gated token body. |
| `apps/api/src/auth/__tests__/auth.service.spec.ts` | MODIFY — assert race-free register (no pre-SELECTs; catches DB unique violation). |
| `apps/api/src/main.ts` | MODIFY — `enableCors({ origin: env.CORS_ORIGINS.split(',') })`. |

## Tasks

---

### Task 1: typed `auth.cookie` + `auth.cors` config

**Files:**
- Create: `apps/api/src/config/auth.config.ts`
- Create: `apps/api/src/config/__tests__/auth.config.spec.ts`
- Modify: `apps/api/src/config/config.module.ts`

- [ ] **Step 1.1 — Read an existing typed config for the pattern**

```
cat apps/api/src/config/jwt.config.ts
```

Match its registerAs + Zod-validated factory pattern.

- [ ] **Step 1.2 — Write failing test**

`apps/api/src/config/__tests__/auth.config.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { authConfigFactory } from '../auth.config';

describe('authConfigFactory', () => {
  const baseEnv = {
    AUTH_COOKIE_NAME: 'FS_AUTH',
    AUTH_COOKIE_SECURE: 'false',
    AUTH_COOKIE_SAMESITE: 'lax',
    AUTH_COOKIE_MAX_AGE_SEC: '86400',
    CORS_ORIGINS: 'http://localhost:3000,http://localhost:5173',
  };

  it('parses env into typed cookie + cors config', () => {
    const cfg = authConfigFactory(baseEnv);
    expect(cfg.cookie.name).toBe('FS_AUTH');
    expect(cfg.cookie.secure).toBe(false);
    expect(cfg.cookie.sameSite).toBe('lax');
    expect(cfg.cookie.maxAgeMs).toBe(86400 * 1000);
    expect(cfg.corsOrigins).toEqual(['http://localhost:3000', 'http://localhost:5173']);
  });

  it('honours secure=true and sameSite=strict', () => {
    const cfg = authConfigFactory({ ...baseEnv, AUTH_COOKIE_SECURE: 'true', AUTH_COOKIE_SAMESITE: 'strict' });
    expect(cfg.cookie.secure).toBe(true);
    expect(cfg.cookie.sameSite).toBe('strict');
  });

  it('falls back to safe defaults when env keys are absent', () => {
    const cfg = authConfigFactory({});
    expect(cfg.cookie.name).toBe('FS_AUTH');
    expect(cfg.cookie.secure).toBe(false); // dev default
    expect(cfg.cookie.sameSite).toBe('lax');
    expect(cfg.cookie.maxAgeMs).toBe(86400 * 1000);
    expect(cfg.corsOrigins).toEqual(['http://localhost:3000', 'http://localhost:5173']);
  });

  it('rejects an invalid sameSite value', () => {
    expect(() => authConfigFactory({ ...baseEnv, AUTH_COOKIE_SAMESITE: 'bogus' })).toThrow();
  });
});
```

- [ ] **Step 1.3 — Run, verify FAIL**

```
pnpm --filter @finsentinel/api vitest run src/config/__tests__/auth.config.spec.ts
```
Expected: module not found.

- [ ] **Step 1.4 — Implement**

`apps/api/src/config/auth.config.ts`:

```ts
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const sameSiteSchema = z.enum(['lax', 'strict', 'none']);

export interface AuthCookieConfig {
  name: string;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  maxAgeMs: number;
  domain?: string;
}

export interface AuthRuntimeConfig {
  cookie: AuthCookieConfig;
  corsOrigins: string[];
}

const DEFAULT_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'];

/**
 * Pure factory exposed for unit testing — takes a plain env-shaped object.
 * Production wiring goes via NestJS @nestjs/config registerAs below.
 */
export function authConfigFactory(env: Record<string, string | undefined>): AuthRuntimeConfig {
  const sameSiteRaw = (env.AUTH_COOKIE_SAMESITE ?? 'lax').toLowerCase();
  const sameSite = sameSiteSchema.parse(sameSiteRaw);
  const secure = (env.AUTH_COOKIE_SECURE ?? 'false').toLowerCase() === 'true';
  const maxAgeSec = Number(env.AUTH_COOKIE_MAX_AGE_SEC ?? '86400');

  const originsRaw = env.CORS_ORIGINS;
  const corsOrigins = originsRaw
    ? originsRaw.split(',').map((o) => o.trim()).filter(Boolean)
    : DEFAULT_ORIGINS;

  return {
    cookie: {
      name: env.AUTH_COOKIE_NAME ?? 'FS_AUTH',
      secure,
      sameSite,
      maxAgeMs: maxAgeSec * 1000,
      ...(env.AUTH_COOKIE_DOMAIN ? { domain: env.AUTH_COOKIE_DOMAIN } : {}),
    },
    corsOrigins,
  };
}

/**
 * NestJS-side wiring — the AuthController and main.ts pull the typed config
 * via `configService.get<AuthRuntimeConfig>('auth')`.
 */
export const authConfig = registerAs('auth', (): AuthRuntimeConfig =>
  authConfigFactory(process.env),
);
```

- [ ] **Step 1.5 — Register in config.module.ts**

Find where other configs are added to `ConfigModule.forRoot({ load: [...] })` and append `authConfig` to the load array. Then re-run the failing test:

```
pnpm --filter @finsentinel/api vitest run src/config/__tests__/auth.config.spec.ts
```
Expected: PASS, all 4 cases.

- [ ] **Step 1.6 — Commit**

```bash
git add apps/api/src/config/auth.config.ts \
        apps/api/src/config/__tests__/auth.config.spec.ts \
        apps/api/src/config/config.module.ts
git commit -m "feat(config): typed auth.cookie + auth.cors runtime config"
```

---

### Task 2: env-driven CORS in `main.ts`

**Files:**
- Modify: `apps/api/src/main.ts`

- [ ] **Step 2.1 — Read current main.ts**

Already read in this session. Plan: pull `auth` config out of NestJS ConfigService (`app.get(ConfigService).get('auth')`) and use it for `enableCors`.

- [ ] **Step 2.2 — Edit `main.ts`**

```ts
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import type { AuthRuntimeConfig } from './config/auth.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
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

- [ ] **Step 2.3 — Sanity-build**

```
pnpm --filter @finsentinel/api typecheck
```
Expected: clean.

- [ ] **Step 2.4 — Commit**

```bash
git add apps/api/src/main.ts
git commit -m "feat(api): main.ts CORS origin from typed auth config"
```

---

### Task 3: header-gated token body + env-driven cookie attrs in `AuthController`

**Files:**
- Modify: `apps/api/src/auth/auth.controller.ts`
- Modify: `apps/api/src/auth/__tests__/auth.controller.spec.ts`

- [ ] **Step 3.1 — Add failing controller tests**

Append to `apps/api/src/auth/__tests__/auth.controller.spec.ts`:

```ts
describe('cookie attrs + token body gating (P0-3)', () => {
  it('uses env-driven secure/sameSite when ConfigService is bound', async () => {
    const ctrl = await buildController({
      authRuntimeConfig: {
        cookie: { name: 'FS_AUTH', secure: true, sameSite: 'strict', maxAgeMs: 60_000 },
        corsOrigins: ['https://x.example'],
      },
    });
    const res = createMockResponse();
    await ctrl.login({ username: 'a', password: 'b' } as any, res, {} /* headers */ as any);

    const [name, _token, opts] = (res.cookie as Mock).mock.calls[0]!;
    expect(name).toBe('FS_AUTH');
    expect(opts.secure).toBe(true);
    expect(opts.sameSite).toBe('strict');
    expect(opts.maxAge).toBe(60_000);
  });

  it('omits the token from the response body for a default (browser) request', async () => {
    const ctrl = await buildController();
    const res = createMockResponse();
    const out = await ctrl.login({ username: 'a', password: 'b' } as any, res, {} /* headers */ as any);
    expect(out).toEqual(expect.objectContaining({ username: expect.any(String), email: expect.any(String) }));
    expect((out as Record<string, unknown>).token).toBeUndefined();
  });

  it('returns the token in the response body when X-Client: desktop is set', async () => {
    const ctrl = await buildController();
    const res = createMockResponse();
    const out = await ctrl.login({ username: 'a', password: 'b' } as any, res, {
      'x-client': 'desktop',
    } as any);
    expect((out as { token?: string }).token).toBeDefined();
  });
});
```

`buildController` and `createMockResponse` are small helpers — copy the pattern from existing controller tests in the same file. The third arg to `login` represents the request headers, which we'll surface via a new `@Headers()` param in the controller.

- [ ] **Step 3.2 — Run, verify FAIL**

```
pnpm --filter @finsentinel/api vitest run src/auth/__tests__/auth.controller.spec.ts
```

- [ ] **Step 3.3 — Implement**

Replace `apps/api/src/auth/auth.controller.ts` with:

```ts
import {
  Controller,
  Post,
  Body,
  Res,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { registerRequestSchema, loginRequestSchema } from '@finsentinel/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';
import type { RegisterRequest, LoginRequest } from '@finsentinel/shared';
import type { AuthRuntimeConfig } from '../config/auth.config';

const DESKTOP_CLIENT = 'desktop';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  private cookieOpts() {
    const auth = this.config.get<AuthRuntimeConfig>('auth')!;
    return {
      httpOnly: true,
      secure: auth.cookie.secure,
      sameSite: auth.cookie.sameSite,
      maxAge: auth.cookie.maxAgeMs,
      path: '/',
      ...(auth.cookie.domain ? { domain: auth.cookie.domain } : {}),
    };
  }

  private cookieName(): string {
    return this.config.get<AuthRuntimeConfig>('auth')!.cookie.name;
  }

  private shapeBody(
    full: { token: string; username: string; email: string },
    headers: Record<string, string | string[] | undefined>,
  ) {
    const client = (headers['x-client'] ?? headers['X-Client']) as string | undefined;
    if (client === DESKTOP_CLIENT) return full;
    // Browser path: cookie is the source of truth, drop the token from the body.
    const { token: _drop, ...rest } = full;
    return rest;
  }

  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: RegisterRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const result = await this.authService.register(body);
    res.cookie(this.cookieName(), result.token, this.cookieOpts());
    return this.shapeBody(result, headers);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const result = await this.authService.login(body);
    res.cookie(this.cookieName(), result.token, this.cookieOpts());
    return this.shapeBody(result, headers);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) res: Response) {
    const opts = this.cookieOpts();
    // clearCookie ignores maxAge but uses the rest for the matching attributes.
    res.clearCookie(this.cookieName(), {
      httpOnly: opts.httpOnly,
      secure: opts.secure,
      sameSite: opts.sameSite,
      path: opts.path,
      ...('domain' in opts ? { domain: opts.domain as string } : {}),
    });
  }
}
```

- [ ] **Step 3.4 — Run tests, verify PASS**

```
pnpm --filter @finsentinel/api vitest run src/auth/__tests__/auth.controller.spec.ts
```
If any pre-existing controller test broke because it constructed the controller without the new `ConfigService` dep, update the helper to inject a stub via `Test.createTestingModule({ providers: [{ provide: ConfigService, useValue: { get: () => defaultAuthConfig } }, ...] })`.

- [ ] **Step 3.5 — Commit**

```bash
git add apps/api/src/auth/auth.controller.ts \
        apps/api/src/auth/__tests__/auth.controller.spec.ts
git commit -m "feat(auth): env-driven cookie attrs + X-Client gated token body"
```

---

### Task 4: race-free `register()` (DB unique-violation catch)

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/src/auth/__tests__/auth.service.spec.ts`

- [ ] **Step 4.1 — Add failing test**

Append to `apps/api/src/auth/__tests__/auth.service.spec.ts`:

```ts
describe('race-free register (P0-3)', () => {
  it('does NOT pre-SELECT for username/email — only INSERTs', async () => {
    const insertSpy = vi.fn().mockResolvedValue([
      { id: 'u1', username: 'alice', email: 'a@x', password: 'h', createdAt: new Date(), updatedAt: new Date(), displayName: null },
    ]);
    const selectSpy = vi.fn();
    const db = {
      select: selectSpy,
      insert: () => ({ values: () => ({ returning: insertSpy }) }),
    } as any;
    const svc = await buildService({ db });

    await svc.register({ username: 'alice', email: 'a@x', password: 'P@ssw0rd1' } as any);
    expect(selectSpy).not.toHaveBeenCalled();
    expect(insertSpy).toHaveBeenCalled();
  });

  it('translates a Postgres unique-violation (23505) into a 409 ConflictException', async () => {
    const pgUniqueErr = Object.assign(new Error('duplicate key value'), { code: '23505' });
    const insertSpy = vi.fn().mockRejectedValue(pgUniqueErr);
    const db = {
      select: vi.fn(),
      insert: () => ({ values: () => ({ returning: insertSpy }) }),
    } as any;
    const svc = await buildService({ db });

    await expect(
      svc.register({ username: 'alice', email: 'a@x', password: 'P@ssw0rd1' } as any),
    ).rejects.toThrow('Username or email already exists');
  });

  it('rethrows non-23505 errors unchanged', async () => {
    const otherErr = Object.assign(new Error('connection refused'), { code: '08006' });
    const insertSpy = vi.fn().mockRejectedValue(otherErr);
    const db = {
      select: vi.fn(),
      insert: () => ({ values: () => ({ returning: insertSpy }) }),
    } as any;
    const svc = await buildService({ db });

    await expect(
      svc.register({ username: 'a', email: 'a@x', password: 'P@ssw0rd1' } as any),
    ).rejects.toThrow('connection refused');
  });
});
```

`buildService` is a small helper to add (or extend) at the top of the spec file — wires `JwtService` (real or stub) + the injected `db`.

- [ ] **Step 4.2 — Run, verify FAIL**

```
pnpm --filter @finsentinel/api vitest run src/auth/__tests__/auth.service.spec.ts
```

- [ ] **Step 4.3 — Refactor `register()`**

Replace the body of `register()` in `apps/api/src/auth/auth.service.ts`:

```ts
async register(request: RegisterRequest): Promise<AuthResponse> {
  const hashedPassword = await hash(request.password, BCRYPT_ROUNDS);

  let created;
  try {
    const rows = await this.db
      .insert(users)
      .values({
        username: request.username,
        email: request.email,
        password: hashedPassword,
        displayName: request.displayName ?? null,
      })
      .returning();
    created = rows[0]!;
  } catch (err) {
    // Postgres unique_violation. The DB-side UNIQUE constraints on
    // users.username and users.email already exist (V1 schema), so this
    // is the authoritative race-free check. We deliberately do NOT pre-SELECT.
    if (
      err instanceof Error &&
      (err as { code?: string }).code === '23505'
    ) {
      throw new ConflictException('Username or email already exists');
    }
    throw err;
  }

  const token = await this.jwtService.generateToken(
    created.username,
    created.id,
  );

  return { token, username: created.username, email: created.email };
}
```

- [ ] **Step 4.4 — Run tests, verify PASS**

```
pnpm --filter @finsentinel/api vitest run src/auth/__tests__/auth.service.spec.ts
```

If existing pre-SELECT tests now fail because they assumed two SELECTs before INSERT, update those expectations — race-free behaviour is the contract going forward.

- [ ] **Step 4.5 — Commit**

```bash
git add apps/api/src/auth/auth.service.ts \
        apps/api/src/auth/__tests__/auth.service.spec.ts
git commit -m "feat(auth): race-free register via DB unique-violation catch"
```

---

### Task 5: Final verification + progress log

- [ ] **Step 5.1 — Full API test suite**

```
pnpm --filter @finsentinel/api typecheck
pnpm --filter @finsentinel/api test
```
Expected: green. Pay particular attention to:
- `src/__tests__/integration/auth-flow.integration.spec.ts` if it exists (supertest E2E)
- Any test using the controller that didn't previously pass headers (the new `@Headers()` param defaults to `{}` so old call sites keep working)

- [ ] **Step 5.2 — Append progress log**

Append to `docs/product-specs/2026-04-23-auth-session-hardening.md` (new section):

```
## 8. Implementation Progress Log

- 2026-04-23: branch `feat/2026-04-23-auth-session-hardening` opened.
- 2026-04-24: implemented Tasks 1–4 per `docs/exec-plans/2026-04-23-auth-session-hardening.md`.
  - Task 1: typed `auth.cookie` + `auth.cors` config (`apps/api/src/config/auth.config.ts`).
  - Task 2: `main.ts` CORS origin pulled from typed config (env-driven).
  - Task 3: AuthController reads cookie attrs from config; token returned in body only when `X-Client: desktop` header is present.
  - Task 4: `register()` now does a single INSERT and translates Postgres 23505 unique-violations to 409. No pre-SELECTs; race window closed.
- Verification: `pnpm --filter @finsentinel/api test` green; typecheck clean.
- Deferred (per scope statement at top of exec plan):
  - Desktop keychain Tauri integration.
  - Removal of `NEXT_PUBLIC_LOCAL_USER_*` build-bake.
  - 1-release backwards-compat shim.
  - Helmet / request-id / compression (lives in PRD #8).
```

- [ ] **Step 5.3 — Commit progress log**

```bash
git add docs/product-specs/2026-04-23-auth-session-hardening.md
git commit -m "docs(auth): log auth/session hardening implementation progress"
```

---

## Self-Review Checklist

- [x] Spec coverage: §5.1 cookie + CORS env-driven → Tasks 1+2+3. §5.2 token-in-body gating → Task 3. §5.3 register race fix → Task 4. §5.4/§5.5 explicitly out-of-scope per the plan header.
- [x] No placeholders: every task has runnable code or a runnable command.
- [x] Type consistency: `AuthRuntimeConfig`, `cookieOpts()`, `cookieName()`, `shapeBody()` defined once in Task 3 and consumed throughout.
- [x] Verification: each task ends in tests + commit.
- [x] Scope discipline: only auth controller/service, one new config file, one main.ts edit. No drive-by refactors of the wider auth surface (jwt.service, jwt.guard, decorators).

## Risks Going In

- The new `@Headers()` param means existing controller tests that constructed `AuthController` directly may need a third arg. The plan's tests use the helper pattern, but downstream supertest tests should be unaffected because Express auto-supplies headers.
- Removing the response-body token by default is a *quiet* breaking change for any client that was reading it. The Web client uses the cookie (not the body); the Tauri client *also* uses the cookie via `apiFetch` after the P0-2 work, so the only consumer that actually reads the token is `local-login.ts` performLogin (which then stores it in localStorage). After this PRD lands, the Web build's auto-login will need to send `X-Client: desktop` OR switch to cookie-only — we'll handle that one-line patch in the Web side or the keychain follow-up; for the slice landing here, the dev workflow remains because dev doesn't have `NEXT_PUBLIC_LOCAL_USER_*` set in the browser.
- The 23505 catch uses `(err as { code?: string }).code` — postgres-js surfaces the SQLSTATE as `code`. If an upstream wrapper renames it, the test in 4.2 will catch it. Worth grepping `.code === '23` once after the change to ensure consistency with how other services translate constraint errors.
