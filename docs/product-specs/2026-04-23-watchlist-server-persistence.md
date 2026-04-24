# PRD: 自选股从 localStorage 迁到服务端持久化

日期：2026-04-23
状态：Draft
优先级：P1

## 1. 问题

后端已经有结构化能力，但前端没有用上：

- 前端 `apps/web/src/views/DashboardPage.tsx`（第 24/26-39/97 行）把 watchlist 写在 `localStorage` 的 `finsentinel_watchlist` 里，仅是 ticker 字符串数组，60 秒轮询 `marketApi.batchQuotes`。
- 后端 `apps/api/src/watchlist/watchlist.service.ts` 已经支持 categories、items、`thesis`、`notes`、`priority`，并在 agent tools（`apps/api/src/agent/tools/watchlist.tool.ts`）里被使用。
- `apps/web/src/api/` 19 个 client 模块中没有 `watchlist.ts`，HTTP 层完全断开。

结果：用户在 UI 看到的「watchlist」与 agent 看到的、与跨设备的不是同一个东西，且换浏览器即丢。

## 2. 当前代码落点

- 后端 service：`apps/api/src/watchlist/watchlist.service.ts`
- 后端 agent tools：`apps/api/src/agent/tools/watchlist.tool.ts`
- 前端 dashboard：`apps/web/src/views/DashboardPage.tsx`
- 前端 settings：`apps/web/src/views/SettingsPage.tsx`（同样 localStorage）

## 3. 目标

1. 暴露 `WatchlistController`，提供分类（CRUD）、条目（CRUD）、整理 summary 等端点。
2. 在 `apps/web/src/api/watchlist.ts` 增加对应 client。
3. Dashboard 与 Settings 使用服务端数据；本地缓存只作为离线兜底。
4. UI 暴露 `thesis` / `notes` / `priority`，让 watchlist 真正作为研究工作台。

## 4. 非目标

- 不重新设计 RAG / agent 调度。
- 不实现实时协作（多端实时同步）；用「拉取 + ETag」即可。

## 5. 方案

### 5.1 REST 设计

```
GET    /watchlist                              -> categories[] (含 items)
POST   /watchlist/categories                   -> 创建 category
PATCH  /watchlist/categories/:id               -> 更新 description / summary
DELETE /watchlist/categories/:id
POST   /watchlist/categories/:id/items         -> 创建 item (symbol, thesis, notes, priority)
PATCH  /watchlist/items/:id
DELETE /watchlist/items/:id
POST   /watchlist/categories/:id/organize      -> 调用现有 organize 逻辑
```

请求/响应 schema 放 `packages/shared/src/schemas/watchlist.ts`，前后端共用。

### 5.2 前端迁移

- 新建 `apps/web/src/api/watchlist.ts`：包装上述端点。
- Dashboard：读取 `GET /watchlist`，展示 categories + items，渲染 thesis/notes/priority。
- 行情仍用 `marketApi.batchQuotes(items.map(i => i.symbol))`，但 watchlist 本体只在 mutation 后再拉。
- 离线兜底：保留 `localStorage` 副本，作为最近一次成功响应的缓存；启动时先用缓存渲染，再 revalidate（SWR 风格）。
- Settings 页面把「自选股」入口下沉到 Dashboard 的右侧抽屉，避免两套写入路径。

### 5.3 数据迁移

为不丢老用户已经手攒的 ticker：

- 启动时检测 `localStorage.finsentinel_watchlist`，若服务端 `GET /watchlist` 为空，自动 POST 一个名为「Imported」的 category，把 ticker 列表迁入；成功后清掉 localStorage。

## 6. 验收标准

1. 新装浏览器登录后，能看到上一台机器添加的 watchlist。
2. 在 Dashboard 给某条目加 thesis，跨设备/Agent 调 `getWatchlist` tool 时能拿到同一字段。
3. 旧用户首次访问触发自动迁移，迁移后老 localStorage 清空。
4. 网络掉线时 Dashboard 仍可使用最近一次缓存（read-only 状态有视觉提示）。
5. 单元测试：所有端点 schema 由 `packages/shared` 校验。

## 7. 风险

- agent tools 当前直接吃 service，不经 REST；需要在 service 层保持单一事实源，REST 与 agent tools 共用。
- 离线兜底如果与服务端冲突（在另一端编辑过），合并策略选简单的 last-write-wins，并在 UI 提示「服务器内容已更新」。

## 8. Implementation Progress Log

- 2026-04-24: branch `feat/2026-04-23-watchlist-server-persistence` opened.
- 2026-04-24: implemented Tasks 1–4 per `docs/exec-plans/2026-04-23-watchlist-server-persistence.md`.
  - Task 1: `saveWatchlistRequestSchema` (Zod) added to `packages/shared/src/schemas/watchlist.ts`.
  - Task 2: `WatchlistController` exposes `GET /watchlist` and `POST /watchlist`. `WatchlistModule` registered in `AppModule.imports`. 2 controller unit tests green.
  - Task 3: `apps/web/src/api/watchlist.ts` typed client (list + save) with 2 unit tests.
  - Task 4: `DashboardPage.tsx` boots from local cache for instant paint, fetches `GET /watchlist` to hydrate from the `Dashboard` category, auto-imports legacy `localStorage.finsentinel_watchlist` on first run, write-through to cache + server on add/remove.
- Verification: `pnpm --filter @finsentinel/api typecheck` clean, `pnpm --filter @finsentinel/api vitest run -- watchlist` 2/2 green; web typecheck clean, full web vitest 75/75 green.
- Deferred (per the Out-of-Scope section at the top of the exec plan):
  - Item-level CRUD (`PATCH /watchlist/items/:id`, `DELETE`) — service surface needed first.
  - Settings page redesign exposing thesis/notes/priority editing.
  - Real-time multi-device sync.
