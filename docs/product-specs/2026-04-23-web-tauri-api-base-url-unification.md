# PRD: Web / Tauri 客户端 API base URL 统一

日期：2026-04-23
状态：Draft
优先级：P0

## 1. 问题

桌面端（Tauri 静态导出）与浏览器端（Next.js standalone + rewrites）共用 `apps/web`。仓库已为 Tauri 准备了运行时 base URL 机制，但前端实际请求路径并未接上：

- `apps/web/next.config.ts:18-19` 注释明确指出 Tauri 构建不能用 rewrites，应在运行时使用 `NEXT_PUBLIC_API_BASE_URL`。
- `apps/web/src/lib/api-base-url.ts` 提供了 `getApiBaseUrl()` 助手。
- 但 `apps/web/src/api/client.ts:15` 把 `BASE` 硬编码为 `'/api'`，从未导入 `getApiBaseUrl`。
- `apps/web/src/lib/auth/local-login.ts:60` 的 `ensureLocalToken(apiBase = '')` 默认空串，调用方 `providers.tsx` 也没有显式传入 base。

结果：Tauri 打包后所有请求会走相对路径，浏览器外壳下相对路径无法解析到 NestJS API，桌面端登录与全部业务请求都会失败。

## 2. 当前代码落点

- `apps/web/next.config.ts`
- `apps/web/src/lib/api-base-url.ts`
- `apps/web/src/api/client.ts`
- `apps/web/src/lib/auth/local-login.ts`
- `apps/web/src/app/providers.tsx`（`ensureLocalToken` 调用点）

## 3. 目标

1. 浏览器与 Tauri 两条路径共用同一份 fetch 客户端，且都尊重 `NEXT_PUBLIC_API_BASE_URL`。
2. 自动登录链路也使用同样的 base 解析逻辑。
3. 提供一条 Tauri 打包后的可重复执行的冒烟流程，以后此类回归能在 PR 阶段被发现。

## 4. 非目标

- 不重新设计认证流程（见 auth-session-hardening PRD）。
- 不替换 fetch 库或引入额外 HTTP client 抽象。

## 5. 方案

### 5.1 统一 base 解析

```ts
// apps/web/src/api/client.ts
import { getApiBaseUrl } from '@/lib/api-base-url';

const resolveBase = () => {
  const remote = getApiBaseUrl();
  return remote ? `${remote.replace(/\/$/, '')}/api` : '/api';
};
```

所有 `fetch(`${BASE}${path}`)` 改为 `fetch(`${resolveBase()}${path}`)`。`resolveBase()` 在每次调用时读取，便于运行时（Tauri 中可由 settings 注入）切换。

### 5.2 自动登录修正

`providers.tsx` 改为：

```ts
ensureLocalToken(getApiBaseUrl());
```

`ensureLocalToken` 内部所有 fetch 路径同样走 `resolveBase`-style helper，确保登录与后续业务请求落在同一域。

### 5.3 桌面端构建与运行约定

- `apps/desktop/.env.production` 写入 `NEXT_PUBLIC_API_BASE_URL=https://...`，由 Tauri 打包器在 build 时注入到 `apps/web`。
- 在 `apps/web/src/lib/api-base-url.ts` 增加运行时读取 Tauri runtime config 的能力（如 `__TAURI__` 注入的 settings），允许用户在桌面端 UI 里修改并即时生效。

### 5.4 冒烟测试

- 在 `apps/web` 加单元测试覆盖 `resolveBase()`：对 `''`、`'http://x'`、`'http://x/'` 三种环境变量都能产生预期 URL。
- 在 `apps/desktop` 加 Playwright/Tauri smoke：构建静态产物，启动 Tauri，触发一次 `/api/auth/login` 与 `/api/portfolio` 请求，断言成功。

## 6. 验收标准

1. `pnpm --filter @finsentinel/web build` 配 `NEXT_PUBLIC_TAURI=1` 后，产物中所有业务 fetch 不再出现裸 `/api/`，而是含完整 origin。
2. `apps/desktop` 在 `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8080` 启动后，可完成 login + 至少一条业务读 + 一条业务写。
3. 仓库中不再存在 `BASE = '/api'` 这种硬编码常量，被 lint/grep 规则保证。
4. 浏览器构建（无 Tauri flag）行为与升级前一致，rewrites 仍生效。

## 7. 风险

- 如果远端 base 设置错误（例如缺协议头），所有请求会一并失败；需要在 `getApiBaseUrl()` 解析时做基本 URL 校验，并在桌面端 UI 给出可见错误。
- 桌面端用户在不同环境间切换时，`localStorage` 缓存的 token 可能与新 base 域不匹配，需在切换 base 时主动清理。

## 8. Implementation Progress Log

- 2026-04-23: branch `feat/2026-04-23-web-tauri-api-base` opened.
- 2026-04-23..24: implemented Tasks 1–6 per `docs/exec-plans/2026-04-23-web-tauri-api-base.md`.
  - Tasks 1+2: introduced `resolveBase()` in `apps/web/src/api/client.ts`, removed the `BASE = '/api'` literal, refactored 8 consumer modules (news, analysis-runs, reports, chat, documents, analysis, okx, analysis-approvals) and the analysis-runs test mock.
  - Task 3: `performLogin` in `apps/web/src/lib/auth/local-login.ts` now resolves the base via `getApiBaseUrl()` when no explicit arg is given.
  - Task 4: `apps/web/src/providers.tsx` passes `getApiBaseUrl()` into `ensureLocalToken` so the boot-time wiring is auditable.
  - Task 5: `apps/web/src/context/AuthContext.tsx` logout call routed through `resolveBase()` (the last hardcoded `/api/` literal outside tests).
  - Task 6: full verification — `pnpm --filter @finsentinel/web typecheck` clean, full vitest suite 73/73 green.
- Decision deferred: Tauri-runtime UI base override (PRD §5.3); not needed for first-cut shipability.
- Decision deferred: full Tauri Playwright smoke; lives in `2026-04-23-desktop-ci-smoke-build.md` (PRD #9).
