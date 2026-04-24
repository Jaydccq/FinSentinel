# PRD: 认证与会话策略硬化

日期：2026-04-23
状态：Draft
优先级：P0

## 1. 问题

当前认证体系是为「本机单租户」搭起来的，已经足够 prototype，但向共享环境或正式桌面分发推进前需要修补五处：

1. `FS_AUTH` cookie 写入时 `httpOnly: true` 但 `secure: false`、`sameSite: 'lax'` 全部硬编码，无法按环境切换 https。
2. 登录/注册接口同时在响应体里返回 `token`，与 cookie 形成两条并行凭据，加大泄露面。
3. `register()` 用两次 `SELECT` 检查 username/email 唯一性后再 `INSERT`，存在并发竞态。
4. 桌面 `ensureLocalToken` 把 `NEXT_PUBLIC_LOCAL_USER_USERNAME/PASSWORD` 烘进构建产物，等价于把账号密码硬编码进可分发二进制。
5. 桌面端把 JWT 存在 `window.localStorage`（key `fs_local_token`），任意页面脚本可读，没有进入系统 keychain。

主 CORS 也在 `apps/api/src/main.ts:11-15` 写死 `localhost:3000` / `localhost:5173`，不能走 env 配置。

## 2. 当前代码落点

- `apps/api/src/main.ts:11-15`：CORS 静态 origin
- `apps/api/src/auth/auth.controller.ts:28-51`：cookie flag 硬编码 + 响应体含 token
- `apps/api/src/auth/auth.service.ts:28-47`：register 两次 SELECT 后 INSERT
- `apps/web/src/lib/auth/local-login.ts:1, 29-30, 35-36, 51`：`NEXT_PUBLIC_LOCAL_USER_*` + `localStorage.setItem('fs_local_token', token)`

## 3. 目标

1. cookie 与 CORS 行为由环境配置驱动，prod 默认 `secure: true` + `sameSite: 'strict'`。
2. 浏览器侧只通过 cookie 持有会话；token 不再回写到响应体（除非桌面/CLI 显式声明）。
3. 注册唯一性由数据库约束保证，不再依赖应用层先查后写。
4. 桌面端不再把账号密码或 JWT 暴露在 `localStorage` / 构建产物里。
5. 不影响开发体验：本地 dev 仍能 `secure: false` 跑通。

## 4. 非目标

- 不引入 OAuth / SSO（留给后续 PRD）。
- 不改变 JWT 算法/有效期（仍由 `JWT_SECRET` 控制）。

## 5. 方案

### 5.1 配置驱动的 cookie & CORS

新增 `auth.cookie` typed config：

```ts
interface AuthCookieConfig {
  name: string;          // FS_AUTH
  secure: boolean;       // env: AUTH_COOKIE_SECURE
  sameSite: 'lax' | 'strict' | 'none';
  domain?: string;
  maxAgeSec: number;
}
```

`AuthController` 读取该 config 而非内联字面量。production `.env` 默认 `secure=true`、`sameSite=strict`。

CORS 在 `main.ts` 中 `enableCors({ origin: env.CORS_ORIGINS.split(',') })`，并在违规时记日志便于排错。

### 5.2 Web 端不再回 token

- 浏览器路径：`/auth/login` 仅 `Set-Cookie`；响应体只返回 `username/email`。
- 桌面路径：客户端发送 `X-Client: desktop` 头，服务端在白名单时才返回 token，由桌面 secure storage 保存。

### 5.3 唯一性约束

迁移 `Vxx__auth_unique.sql`：

```sql
ALTER TABLE users ADD CONSTRAINT users_username_key UNIQUE (username);
ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
```

`auth.service.register()` 改为直接 INSERT，捕获 PG 23505 → 抛 `409 Conflict`，删除前两次 SELECT。

### 5.4 桌面凭据

**决议（codex consult 2026-04-23）：默认要求 OS 自带的安全存储；Linux 缺 Secret Service 时进入「session-only 降级模式」，不再实现自研 AES-GCM 文件 fallback。**

- 移除 `NEXT_PUBLIC_LOCAL_USER_USERNAME/PASSWORD`。
- 自动登录改为 Tauri 启动时弹出一次性登录窗，密码从系统 keychain（macOS Keychain / Windows Credential Manager / Linux libsecret）读取或写入。
- JWT 也写入 keychain，前端通过 Tauri command 拉取，不进 `localStorage`。
- Web 端 `ensureLocalToken` 在 `window.__TAURI__` 存在时调用 Tauri 指令，否则保持现状（dev only）。
- **Linux 没有可用 keyring（headless / 最小安装）时**：
  - 不写盘任何持久凭据。
  - 启动时给出明确文案「未检测到 libsecret / gnome-keyring / KeePassXC，将进入会话模式：本次启动结束后需重新登录」。
  - JWT 仅在内存中持有；进程退出即丢失。
  - 文档里指引用户安装受支持的 keyring（推荐 `gnome-keyring` 或 `KeePassXC` 的 Secret Service 兼容模式）。
- 不实现 XDG_DATA_HOME 下 mode 0600 + AES-GCM + machine-id 派生密钥的自研 vault：会带来第二套安全模型、新的恢复路径、跨发行版支持负担——对一个早期金融研究工具而言成本远大于收益。

### 5.5 兼容期

- 新版本上线前后 1 个 release，旧客户端的 `localStorage.fs_local_token` 仍被读取一次后立即转移到 keychain 并清除 localStorage。

## 6. 验收标准

1. `AUTH_COOKIE_SECURE=true` 启动时，浏览器请求 `Set-Cookie` 含 `Secure; SameSite=Strict`；`false` 则与现状一致。
2. 100 个并发 register 请求同 username → 只有 1 个成功，其它 409；DB 不出现重复行。
3. 浏览器登录后响应体不含 `token` 字段，但 `document.cookie` 中存在 `FS_AUTH`。
4. 桌面端构建产物中 grep `NEXT_PUBLIC_LOCAL_USER_` 为空；`fs_local_token` 在 `localStorage` 中不再存在。
5. CORS 通过环境变量加白名单后，未列入的 origin 请求被拒。

## 7. 风险

- 桌面 keychain 集成在不同 OS 行为不同；需要为 Linux 提供 fallback（Secret Service 不可用时降级到加密文件 + OS file ACL）。
- `secure=true` 需要 https，本地 dev 容易踩坑；通过 README + dev 脚本默认 false 解决。
- 删除响应体 token 是 breaking change：必须先发 SDK / Web 客户端的更新版本。

## 8. Implementation Progress Log (P0 slice)

- 2026-04-23: branch `feat/2026-04-23-auth-session-hardening` opened.
- 2026-04-24: implemented Tasks 1–5 per `docs/exec-plans/2026-04-23-auth-session-hardening.md`.
  - Task 1: typed `auth.cookie` + `auth.cors` config (`apps/api/src/config/auth.config.ts`) with Zod validation and 5 unit tests covering env→config mapping.
  - Task 2: `apps/api/src/main.ts` CORS origin pulled from typed config (env-driven via `CORS_ORIGINS`).
  - Task 3: `AuthController` reads cookie attrs from typed config; response body returns the JWT only when the request carries `X-Client: desktop` (Stripe-style header opt-in). Browser callers get the cookie alone.
  - Task 4: `register()` does a single INSERT and translates Postgres 23505 unique-violations into `409 ConflictException`. No pre-SELECTs; race window closed.
  - Task 5: integration suites (`auth-flow`, `trading-flow`, `chat-stream`) updated to either send `X-Client: desktop` or read the JWT from the `Set-Cookie` header. The mock Drizzle insert now mirrors the V1 `users(username, email)` UNIQUE constraint by emitting a 23505-coded error, so the new race-free `register()` is exercised end-to-end.
- Verification: `pnpm --filter @finsentinel/api typecheck` clean; `pnpm vitest run` shows 1499 passed / 1 skipped / 1 failed. The 1 failure is `src/rag/__tests__/cli-import-env.spec.ts` (5-second timeout on dynamic CLI imports), which **also fails on `main` HEAD without any of these changes** — pre-existing flake unrelated to this PRD; tracked for follow-up.
- Deferred (per the Out-of-Scope section at the top of the exec plan):
  - Desktop keychain Tauri integration (Rust `tauri::api::keychain` bridge + JS facade).
  - Removal of `NEXT_PUBLIC_LOCAL_USER_USERNAME / _PASSWORD` build-bake — depends on the keychain slice landing first.
  - 1-release backwards-compat shim that drains the legacy `localStorage.fs_local_token` after keychain rollout.
  - Helmet / request-id / compression middleware — owned by the platform-bootstrap PRD (#8).
