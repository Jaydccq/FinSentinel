# Deferred Follow-ups from the 2026-04-23 PRD Batch

日期：2026-04-24
状态：Reference (not actively executing)
说明：本文档汇总 9 份 2026-04-23 PRD 在执行阶段显式延后的工作。每条都给出来源 PRD、现状、推荐做法、估算工作量。继续推进时，可以独立挑任意一条开新分支。

---

## 优先级总览

| 优先级 | 条目 | 估算 | 阻塞 |
|--------|------|------|------|
| P0 | [F-1: 桌面端 keychain（Tauri Rust 端）](#f-1-桌面端-keychain-tauri-rust-端) | 1.5–2 day | 无 |
| P0 | [F-2: 移除 `NEXT_PUBLIC_LOCAL_USER_*` 构建烘焙](#f-2-移除-next_public_local_user_-构建烘焙) | 0.5 day | F-1 |
| P0 | [F-3: 1-release 兼容 shim（`localStorage.fs_local_token` → keychain 迁移）](#f-3-1-release-兼容-shim) | 0.5 day | F-1, F-2 |
| P1 | [F-4: 文档上传 outbox + presigned URL 直传](#f-4-文档上传-outbox--presigned-url-直传) | 2–3 day | 无 |
| P1 | [F-5: RAG `strict_metadata=true` HARD SQL 下沉](#f-5-rag-strict_metadatatrue-hard-sql-下沉) | 1.5 day | 30 题 golden 评测可信 |
| P1 | [F-6: Watchlist item-level CRUD + Settings UI](#f-6-watchlist-item-level-crud--settings-ui) | 1.5–2 day | 无 |
| P2 | [F-7: 平台层 Dynamic Module 重构（OpenBB / OKX / Queue / News / Twitter）](#f-7-dynamic-module-重构) | 2 day per module × 5 | 单独跑，逐模块 |
| P2 | [F-8: helmet CSP + HSTS 启用](#f-8-helmet-csp--hsts-启用) | 0.5 day | Web + 桌面端 SSE QA 通过 |
| P2 | [F-9: 桌面 CI 真正的运行时 smoke（GUI/IPC）](#f-9-桌面-ci-runtime-smoke) | 1 day | F-1 落地后更有意义 |
| P2 | [F-10: 桌面端发行包（DMG / MSI / AppImage）+ 签名](#f-10-桌面端发行包--签名) | 2 day | F-9 |
| P2 | [F-11: 新增 search-capable provider（Polygon / Alpaca）](#f-11-新增-search-capable-provider) | 0.5 day per provider | 无 |
| P2 | [F-12: nestjs-pino 替换内置 Logger](#f-12-nestjs-pino-替换内置-logger) | 1 day | 无 |
| P2 | [F-13: 文档上传 `regionId` 元数据自动推断](#f-13-文档上传-regionid-元数据自动推断) | 0.5 day | 无 |
| P2 | [F-14: 接受标准 `colloquial` query class TODO](#f-14-接受标准-colloquial-query-class-todo) | 0.5 day | 无 |

---

## P0 follow-ups

### F-1: 桌面端 keychain（Tauri Rust 端）

**来源 PRD：** `docs/product-specs/2026-04-23-auth-session-hardening.md` §5.4
**当前状态：** P0-3 实现了 cookie / CORS / 注册竞态 / X-Client header gate；**桌面凭据存储仍在 `localStorage.fs_local_token`**。
**目标：** Tauri 启动时通过 Rust 端 `tauri::api::keychain` (或 `keyring-rs`) 把 JWT 写入系统 keychain（macOS Keychain / Windows Credential Manager / Linux libsecret）；前端通过 Tauri command 读取，不再走 `localStorage`。

**落地步骤建议：**
1. `apps/desktop/src-tauri/Cargo.toml` 加 `keyring = "3"`。
2. 在 `apps/desktop/src-tauri/src/lib.rs` 暴露 `#[tauri::command] fn read_token()` / `write_token(token)` / `clear_token()`，service name 用 `"finsentinel-desktop"`，user 用 `"jwt"`。
3. `apps/web/src/lib/auth/local-login.ts` 在 `window.__TAURI__` 存在时改为 `await invoke('read_token')`；`performLogin` 成功后 `await invoke('write_token', { token })`，不再写 `localStorage.setItem(TOKEN_KEY, ...)`。
4. Linux 缺 Secret Service 的降级路径：codex 决议是 **不** 写盘任何持久凭据 → 进入会话模式（启动期弹一次性登录 UI，只在内存中持有 token）。Rust 端检测 `keyring::Error::PlatformFailure` / `NoStorageBackend` 时抛回 JS 一个明确的 `error: 'session_only'`，前端显示提示文案。
5. 单元测试：mock Tauri invoke，断言 `localStorage.fs_local_token` 不再被读写。
6. 桌面端集成测试：`cargo test` 跑 keyring round-trip（macOS/Windows runner 上跑通；Linux 上跳过或在 CI 用 `--features mock-keyring`）。

**估算：** 1.5–2 day（一半时间在 Linux fallback / 测试环境配置）。
**为何延后：** Tauri Rust 改动 + 跨平台 keychain 行为差异，独立于其它 P0 工作；与本批次的 NestJS / Next.js 重构耦合度低。

---

### F-2: 移除 `NEXT_PUBLIC_LOCAL_USER_*` 构建烘焙

**来源 PRD：** `docs/product-specs/2026-04-23-auth-session-hardening.md` §5.4
**当前状态：** Web build 仍读 `process.env.NEXT_PUBLIC_LOCAL_USER_USERNAME / _PASSWORD`，等价于把账号密码硬编码进可分发二进制（`apps/web/src/lib/auth/local-login.ts:35-36`）。
**目标：** 完全移除这两个 env，桌面端登录改为 F-1 落地后的 keychain + 一次性 UI。

**落地步骤建议：**
1. F-1 必须先完成（否则会留下没有自动登录路径）。
2. 删 `isLocalLoginEnabled()` 中的 env 检查；改为 `window.__TAURI__` 存在时启用 keychain 路径。
3. 跨仓库 `grep -r NEXT_PUBLIC_LOCAL_USER` 清干净（包含 docs / Tauri config）。
4. 桌面端首次启动如果 keychain 没有 token：弹出登录窗（用 Tauri webview 加载 web 的 `/login`），登录成功后写 keychain。
5. `apps/desktop/.env` 模板移除这两行，`apps/desktop/README.md` 同步。

**估算：** 0.5 day after F-1。

---

### F-3: 1-release 兼容 shim

**来源 PRD：** `docs/product-specs/2026-04-23-auth-session-hardening.md` §5.5
**目标：** F-1 / F-2 第一个 release 上线时，桌面端启动期检测 `localStorage.fs_local_token`，迁移到 keychain 后清空 `localStorage`。下一个 release 移除 shim。

**落地步骤建议：**
1. 在 `apps/web/src/lib/auth/local-login.ts` 的 `ensureLocalToken` 入口加：

```ts
if (typeof window !== 'undefined' && window.__TAURI__) {
  const legacy = window.localStorage.getItem('fs_local_token');
  if (legacy) {
    await invoke('write_token', { token: legacy });
    window.localStorage.removeItem('fs_local_token');
  }
  return invoke<string | null>('read_token');
}
```

2. 在仓库 `docs/runbooks/` 加一条「F-3 shim 移除节奏」runbook，标 release N+1 删除。

**估算：** 0.5 day。

---

## P1 follow-ups

### F-4: 文档上传 outbox + presigned URL 直传

**来源 PRD：** `docs/product-specs/2026-04-23-document-upload-pipeline-hardening.md` §5.1 / §5.2
**当前状态：** P1-1 解决了 storage→DB 顺序补偿、`regionId` 参数化、`requireAsyncVectorize` 配置门。**文件仍整体进 Node 内存（`file.buffer`），仍是 storage-first 然后 DB-first 顺序。**
**目标：**
- 引入 outbox pattern：先写 DB 行 `status: PENDING_UPLOAD`（含 `storageKey` 占位），再上传 storage，再标 `READY`；后台 reconciler 清理 stuck `PENDING_UPLOAD`。
- 大文件改成 presigned URL 直传：controller 返回 `{ uploadUrl, storageKey }`，前端 PUT 到 RustFS，再回调 `POST /documents/finalize` 把 metadata 写入 DB。

**落地步骤建议：**
1. 先 outbox（不改 transport）：
   - DB schema 加 `status PENDING_UPLOAD` enum 值（V23 migration）。
   - `DocumentUploadService.upload` 改为 INSERT 先发，storage 上传后 `update status=READY`，失败时 `status=FAILED` + `storage.delete`。
   - 加一个 `DocumentReconcilerService`（`@Cron(EVERY_10_MINUTES)`）找超过 1h 的 `PENDING_UPLOAD` → 看 storage 是否存在 → 修或清。
2. 然后 presigned URL：
   - `RustFSStorageService` 加 `createPresignedUploadUrl(key, ttl)` 包装。
   - 新 controller endpoint `POST /documents/upload-url` → 返回 `{ id, storageKey, uploadUrl }`。
   - 前端 `documents.ts` 改造：`upload()` 先 POST 拿 URL → PUT file → POST `/documents/${id}/finalize`。
3. 单元测试：
   - outbox：模拟 storage 失败 → DB 行最终 `FAILED`；模拟 DB 失败 → storage 已被 `delete`。
   - presigned：mock storage 返回 URL → 前端流程对照。

**估算：** 2–3 day（outbox 1 day + presigned 1.5 day + 测试）。
**为何延后：** 是个有意义的架构改动，比 P1-1 的补丁式修复大一档；前端 UI 也需要从「上传 = 立即可见」过渡到「PENDING/READY/FAILED」状态显示，是单独 PRD 级别的工作。

---

### F-5: RAG `strict_metadata=true` HARD SQL 下沉

**来源 PRD：** `docs/product-specs/2026-04-23-rag-fusion-prefilter-shadow-runner.md` §5.2
**当前状态：** P1-3 实现了 SOFT 下沉（top-1 sector + region 进 `softFilter`，通过 `SOFT_FILTER_MULTIPLIER` 加权）。**HARD 路径未开**。
**目标：** 调用方传 `strict_metadata: true` 时，把 sector / region 转为 SQL `WHERE sector = ANY($1) AND region_id = ANY($2)`，召回换精度。

**落地步骤建议：**
1. `RetrievalOrchestrator` / `RagRetrievalService` 入参增 `strict_metadata?: boolean`。
2. `MetadataPreFilterService.buildFilter` 在 `strict_metadata === true` 时，把 top-N sector / region 写到 `hardFilter.sector` / `hardFilter.regionId`（注意当前 `SparseSearchFilters.sector` 是单值 `string`，HARD 路径要么扩成 `string[]` 要么只取 top-1）。
3. SQL 已经支持 `metadata->>'sector' = filters.sector`（`sparse-search.service.ts:125-128`），但需要确认 `documents` 索引覆盖（如果 sector 走 `documents.sector` 列而不是 metadata JSON，确认 V21 / V22 索引能命中）。
4. 评测：跑 `RAG_EVAL_RUNNER_ENABLED=true` 在 30 题 golden 集对比 strict vs default 的 nDCG@10、recall、precision；写 release notes。
5. 暴露 `strict_metadata` 到 `/api/rag/search` query param，前端 advanced search 加 toggle。
6. 单元测试：strict mode 时，sector 进 hardFilter；soft 时只进 softFilter。

**估算：** 1.5 day（不含跑评测）。
**为何延后：** codex 明确建议默认 SOFT，HARD 需要 eval data 验证后再启用。Wait until 30 题 golden 集 baseline 跑稳、能区分 strict vs default 的 quality movement。

---

### F-6: Watchlist item-level CRUD + Settings UI

**来源 PRD：** `docs/product-specs/2026-04-23-watchlist-server-persistence.md` §5.1 / §5.2
**当前状态：** P1-2 实现了 `GET /watchlist` + `POST /watchlist`（整个 category 上传）。**条目级 CRUD、thesis / notes / priority 编辑 UI 没做**。
**目标：**
- 后端：`PATCH /watchlist/items/:id`、`DELETE /watchlist/items/:id`、`PATCH /watchlist/categories/:id`、`DELETE /watchlist/categories/:id`、`POST /watchlist/categories/:id/organize`。
- 前端：Dashboard 旁加抽屉，能编辑 thesis / notes / priority；Settings 里把「自选股」入口下沉到 Dashboard，避免两套写入路径。

**落地步骤建议：**
1. 后端：
   - `WatchlistService` 加 `updateItem`、`deleteItem`、`deleteCategory`、`updateCategory` 方法。
   - `WatchlistController` 加对应 routes，复用 `JwtGuard`。
   - 在 `packages/shared/src/schemas/watchlist.ts` 加 `updateWatchlistItemRequestSchema` 等。
   - 单元测试：service + controller。
2. 前端：
   - `apps/web/src/api/watchlist.ts` 加 `updateItem`、`deleteItem`、`updateCategory`、`deleteCategory`。
   - `DashboardPage.tsx` 把当前的「string[]」watchlist 升级为「items[]」（symbol + thesis + notes + priority）；编辑时弹抽屉。
   - `SettingsPage.tsx` 把「自选股」入口移除或重定向到 Dashboard。
3. 数据迁移：现有用户的「Dashboard」category 已经只有 symbol；UI 改造后 thesis / notes 默认空，渐进填充。

**估算：** 1.5–2 day。
**为何延后：** 当前 Dashboard UX 还是 ticker grid，没必要先做 thesis 编辑；等用户开始用「研究工作台」诉求出来再做。

---

## P2 follow-ups

### F-7: Dynamic Module 重构

**来源 PRD：** `docs/product-specs/2026-04-23-platform-bootstrap-and-module-scoping.md` §5.2
**当前状态：** `app.module.ts` 仍 eager import 所有可选集成（OpenBB / OKX / Queue / 6551 News / Twitter），靠 service 层 `if (!config.enabled) return` 守卫。
**目标：** 改造成 `XxxModule.register({ enabled })` dynamic module 模式，禁用时不 inject 任何 provider。

**落地步骤建议：每模块独立做，避免大爆炸。**

每个模块的 PR 长这样：
1. 把 `XxxModule` 改为：
   ```ts
   @Module({})
   export class XxxModule {
     static register(cfg: { enabled: boolean }): DynamicModule {
       if (!cfg.enabled) return { module: XxxModule };
       return {
         module: XxxModule,
         providers: [/* 原 providers */],
         exports: [/* 原 exports */],
       };
     }
   }
   ```
2. `app.module.ts` 改成 `XxxModule.register({ enabled: env.XXX_ENABLED })`。
3. 删 service 层的 `if (!enabled) return`；改为通过 `@Optional() @Inject(XxxService)` 让调用方判断「能力是否存在」。
4. 启动期 `nest test` 断言 `XXX_ENABLED=false` 时 `XxxService` 不在容器里。

**优先级建议（先易后难）：**
- F-7a: OpenBB（最孤立）
- F-7b: OKX
- F-7c: Twitter (`APP_TWITTER_6551_ENABLED`)
- F-7d: News (`APP_CRYPTO_NEWS_ENABLED`)
- F-7e: Queue（最复杂，多个 consumer 依赖；动一改一）

**估算：** 2 day per module × 5 = 10 day total，分批做。
**为何延后：** 大批量改 import 链，回归面巨大；建议每月 1-2 个模块的节奏，配合 `desktop-smoke` + 全量集成测试逐步推进。

---

### F-8: helmet CSP + HSTS 启用

**来源 PRD：** `docs/product-specs/2026-04-23-platform-bootstrap-and-module-scoping.md` §7
**当前状态：** P2-1 装了 helmet 但 `contentSecurityPolicy: false, hsts: false`。原因：CSP 默认会阻断 SSE / inline-style / dynamic script，HSTS 在本地 dev 的 http 上吵闹。
**目标：** 测出一组 CSP directives 能容纳 SSE + Tauri + 现有 web 资源；HSTS 在 prod 启用。

**落地步骤建议：**
1. 浏览器侧：抓出当前 `/news/stream`、`/chat/stream`、`/analysis/stream` 的 SSE behavior；`/reports/:id/pdf`、`/documents/:id/download` 的 blob 下载行为。
2. 起一个最小 helmet config：
   ```ts
   helmet({
     contentSecurityPolicy: {
       directives: {
         defaultSrc: ["'self'"],
         scriptSrc: ["'self'"],
         connectSrc: ["'self'", env.NEXT_PUBLIC_API_BASE_URL ?? "'self'"],
         imgSrc: ["'self'", 'data:'],
         styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind inline styles
       },
     },
     hsts: env.AUTH_COOKIE_SECURE ? { maxAge: 31_536_000 } : false,
   });
   ```
3. 跑一遍 `pnpm dev` + 桌面 smoke + Playwright `/browse` 验证关键页面。
4. 记 ADR：CSP 决策史。

**估算：** 0.5 day（不含 Playwright QA 时长）。
**为何延后：** CSP 一旦动，浏览器报 violation 是静默的，必须配 `Report-To` 或先收 telemetry；不是关掉就出问题，但需要质量检验团队（或 owner 自己）把所有路径走一遍。

---

### F-9: 桌面 CI runtime smoke

**来源 PRD：** `docs/product-specs/2026-04-23-desktop-ci-smoke-build.md` §5.2
**当前状态：** P2-2 的 `desktop-smoke.yml` 只跑 `tauri build --debug --no-bundle` + `pnpm --filter @finsentinel/desktop test`（后者目前是个 stub）。
**目标：** 真正跑一次 Tauri webview，触发一条 IPC，断言无 panic / unhandled rejection。

**落地步骤建议：**
1. 在 `apps/desktop/scripts/smoke.ts`（或 `smoke.spec.ts`）写：
   - 用 `@tauri-apps/api` 启 Tauri dev process（`tauri dev --no-watch` 或 mock NestJS 的 `mock-api.ts`）。
   - `invoke('ping')` 一条预置的健康检查 command（Rust 端实现：返回 `"pong"`）。
   - 断言响应、退出 code = 0、无 stderr 中的 panic / unhandled rejection。
2. `apps/desktop/src-tauri/src/lib.rs` 加 `#[tauri::command] fn ping() -> &'static str { "pong" }`。
3. 在 `desktop-smoke.yml` 的 `pr-smoke-ubuntu` 和 `nightly-mac` 加 `pnpm --filter @finsentinel/desktop smoke` 步骤。
4. F-1 落地后，可以扩 smoke 到一次 keychain round-trip。

**估算：** 1 day。
**为何延后：** 需要 Tauri 端 IPC 框架先稳定（F-1 keychain 是头一份「真业务」command）。

---

### F-10: 桌面端发行包 + 签名

**来源 PRD：** `docs/product-specs/2026-04-23-desktop-ci-smoke-build.md` §3 非目标里写过；但生产用必备。
**目标：** 给 release tag 触发的 workflow 跑 `tauri build`（不是 `--debug --no-bundle`），产出 macOS DMG / Windows MSI / Linux AppImage，做 macOS notarization + Windows code-signing。

**落地步骤建议：**
1. 单独 workflow `release.yml`，trigger on `push: tags: ['v*']`。
2. macOS：需要 Apple Developer 账号 + Developer ID Application 证书，secrets 存 GH Actions：
   - `APPLE_CERTIFICATE` (base64 .p12)
   - `APPLE_CERTIFICATE_PASSWORD`
   - `APPLE_SIGNING_IDENTITY` ("Developer ID Application: …")
   - `APPLE_ID` / `APPLE_PASSWORD` (notarization)
3. Windows：EV code-signing certificate (HSM-bound) — 或先发 unsigned + SmartScreen warning。
4. Linux：AppImage 不签名；如果发 Snap / Flatpak 后续单独配置。
5. 上传 artifact 到 GH Releases；可选发 auto-update endpoint。

**估算：** 2 day（macOS notarization 的反馈环节最慢）。
**为何延后：** 需要 Apple Developer 账号 + 预算；不是 P2 工程问题，是产品 / 法务环节。

---

### F-11: 新增 search-capable provider

**来源 PRD：** `docs/product-specs/2026-04-23-market-search-provider-abstraction.md` §4 非目标
**当前状态：** P1-4 实现了 `MarketDataProvider.searchTickers?` 可选方法 + `Registry.getSearchProvider()` 会优先 default → fallback Yahoo；只有 `YahooFinanceMarketDataProvider` 实现。
**目标：** 给 `PolygonMarketDataProvider` / `FmpMarketDataProvider` 加 `searchTickers` 实现，让 default provider 自身能搜，省掉 Yahoo 流量。

**落地步骤建议（每个 provider 独立）：**
1. Polygon：`GET https://api.polygon.io/v3/reference/tickers?search=X&active=true&limit=10`，map 字段到 `TickerSearchResult`。
2. FMP：`GET https://financialmodelingprep.com/api/v3/search?query=X&limit=10`，类似 map。
3. 在 `MarketDataServiceTest` 中给 default provider 注入 mock `searchTickers`，断言 registry 优先选 default。

**估算：** 0.5 day per provider。
**为何延后：** 没有功能驱动；做了减少一条 Yahoo 依赖路径，但 Yahoo fallback 已经稳定。

---

### F-12: nestjs-pino 替换内置 Logger

**来源 PRD：** `docs/product-specs/2026-04-23-platform-bootstrap-and-module-scoping.md` §5.1
**当前状态：** 用内置 `@nestjs/common` Logger，纯文本输出，不带 request-id 结构化字段。
**目标：** 切到 `nestjs-pino`，让所有日志带 JSON 结构 + child context（`requestId`, `userId`），方便 ingress 到 Loki / DataDog / CloudWatch。

**落地步骤建议：**
1. `pnpm --filter @finsentinel/api add nestjs-pino pino-http` + `-D pino-pretty`。
2. `app.module.ts` `imports` 加 `LoggerModule.forRoot({ pinoHttp: { level, transport: dev ? pino-pretty : undefined, customProps: req => ({ requestId: req.id }) } })`。
3. `main.ts` `app.useLogger(app.get(Logger))`。
4. 全仓 `private readonly logger = new Logger(X.name)` 替换为 `constructor(@InjectPinoLogger(X.name) private readonly logger: PinoLogger) {}`（或保持向后兼容 — `nestjs-pino` 兼容 NestJS Logger 接口）。
5. `GlobalExceptionFilter` 用 pino 写结构化字段，不再字符串拼 requestId。

**估算：** 1 day（含 grep / 替换）。
**为何延后：** 大量替换面，且 Logger 行为差异（async-context、child logger）可能造成不可见日志丢失，要谨慎。

---

### F-13: 文档上传 `regionId` 元数据自动推断

**来源 PRD：** `docs/product-specs/2026-04-23-document-upload-pipeline-hardening.md` §5.4
**当前状态：** P1-1 让 `regionId` 通过 `?regionId=...` query 传入，缺省 `'US'`。**未做自动推断**。
**目标：** PDF metadata、URL host、SEC scraper 已知映射 → 自动猜 `regionId`；猜不到落到 `'UNKNOWN'` 并打 metric。

**落地步骤建议：**
1. 在 `DocumentParseService` 加 `extractRegionHint(buffer, mimetype, originalName): string | null`：
   - PDF：parse `Author` / `Producer` 元数据找国家提示。
   - 文件名：含 `10-K` / `S-1` → US；含 `Annual Report` + 中文 → CN 等。
2. `DocumentUploadService.upload` 当 caller 不传 `regionId` 时，调用 `extractRegionHint`；都失败 → `'UNKNOWN'`。
3. 在 SEC scraper / 6551 fetcher 等已知来源加显式 region 注入。
4. metric：在 `agent_events` 加 `DOCUMENT_REGION_INFERRED` event type，payload 含 `inferredFrom`。

**估算：** 0.5 day（推断逻辑） + 0.5 day（每个已知来源加注入）。
**为何延后：** P1-1 已经把缺省路径理顺，自动推断纯粹是 quality-of-life。

---

### F-14: 接受标准 `colloquial` query class TODO

**来源 PRD：** 不直接来自这批；在 `apps/api/src/rag/__tests__/metadata-pre-filter.service.spec.ts:67-68` 有 FIXME(R4)：
```ts
// FIXME(R4): plan uses 'colloquial' but QueryClass omits it; reconcile in a follow-up.
```
**目标：** 把 `colloquial` 加到 `QueryClass` enum 里，移除 `as any` 强制转。

**落地步骤建议：**
1. `apps/api/src/rag/retrieval-planner.service.ts` 的 `QueryClass` union 加 `'colloquial'`。
2. `query-classifier.service.ts` 决定何时分类为 colloquial。
3. `MetadataPreFilterService.minCandidatesByClass` 给 colloquial 加默认值（建议 0 — 闲聊不强制有候选）。
4. 删掉 spec 里的 `as any`。

**估算：** 0.5 day。
**为何延后：** 不影响生产路径；是个 hygiene 项。

---

## .gitignore allow-list

新建本文档时记得：

```
# .gitignore
!docs/exec-plans/2026-04-24-deferred-followups.md
```

---

## 怎么用本文档

- **想下次做什么：** 看顶部「优先级总览」，从 P0 开始挑。
- **想理解一条的全部背景：** 跳到锚点；回到来源 PRD 看完整文脉。
- **想拉新分支开做：** 复用本批的命名约定 `feat/2026-MM-DD-<short-name>`，写 exec plan 到 `docs/exec-plans/`，allow-list 加进 `.gitignore`，跟随 P0 / P1 / P2 模板。

---

## 不在本文档的内容

不属于本批 9 PRD 衍生延后项的工作（已经有自己的位置）：
- `docs/exec-plans/tech-debt-tracker.md` 里的 `[RAG-TD-R4-*]` 系列条目
- `docs/runbooks/2026-04-19-rag-wave2-rollout.md` 的剩余 R4 / R5 / R6 / R7 工作
- 任何 trading subsystem 的 broker-adapter / 策略层工作（在 `docs/product-specs/2026-04-17-*` 系列）

如果你下次想统一处理「所有未完成」，先把这两个目录扫一遍，再看本文档。
