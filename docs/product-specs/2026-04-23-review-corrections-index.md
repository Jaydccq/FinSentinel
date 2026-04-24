# 评审核对与 PRD 索引（2026-04-23）

日期：2026-04-23
作者：Claude Code（受 HongxiChen 委托做事实校验 + PRD 拆分）
状态：Reference

## 1. 总览

本次评审针对外部反馈的 9 条问题，逐条对照仓库实际代码做了核对，并把可执行项拆成 9 份独立 PRD。结论概览：

| # | 反馈主题 | 核对结果 | PRD |
|---|----------|----------|-----|
| 1 | 交易 stage/commit/execute 非原子 + hash 含时间戳 + 缺 idempotencyKey | **全部属实** | `2026-04-23-trading-stage-commit-execute-atomicity.md` (P0) |
| 2 | Web/Tauri API base 实现不一致（`client.ts` 写死 `/api`、`ensureLocalToken` 默认空 base） | **全部属实** | `2026-04-23-web-tauri-api-base-url-unification.md` (P0) |
| 3a | `callYahooSearch` URL 含杂引号 `"esCount=` | **不属实**（详见第 2 节） | — |
| 3b | search 与 quote/history 抽象分裂 | **属实** | `2026-04-23-market-search-provider-abstraction.md` (P1) |
| 3c | 搜索缓存 key 未规范化 | **属实** | 同上 |
| 4 | 文档上传：内存 buffer / 无补偿 / 同步 fallback / regionId 写死 | **全部属实** | `2026-04-23-document-upload-pipeline-hardening.md` (P1) |
| 5 | 认证与会话：cookie flag、响应体回 token、register 竞态、桌面账号入构建、JWT in localStorage、CORS 写死 | **全部属实** | `2026-04-23-auth-session-hardening.md` (P0) |
| 6 | RAG：weight 未进 RRF / sectors-regions 未下沉 / shadow runner 5ms 轮询 | **全部属实** | `2026-04-23-rag-fusion-prefilter-shadow-runner.md` (P1) |
| 7 | Watchlist：前端 localStorage、后端能力丰富但无 REST | **全部属实** | `2026-04-23-watchlist-server-persistence.md` (P1) |
| 8 | 平台 bootstrap：CORS 写死 / eager module / 缺 helmet/requestId | **全部属实** | `2026-04-23-platform-bootstrap-and-module-scoping.md` (P2) |
| 9 | 桌面端 CI 默认排除 | **全部属实** | `2026-04-23-desktop-ci-smoke-build.md` (P2) |

## 2. 唯一一处需要更正的反馈

反馈原话：

> ?q=${...}"esCount=${limit}&newsCount=0，中间出现了异常引号，query string 形状明显不对

仓库实际位置 `apps/api/src/market/market-data.service.ts:115`：

```ts
const url = `${YAHOO_SEARCH_URL}?q=${encodeURIComponent(query)}&quotesCount=${limit}&newsCount=0`;
```

这里的参数是 `quotesCount=`，不是 `"esCount=`；模板字符串里没有杂引号。推测反馈在阅读或粘贴时把 `quot` 误读为引号。

但同条反馈里另外两点（search 与 quote/history 抽象分裂、缓存 key 未 trim/lowercase）是真问题，已合并写进 `2026-04-23-market-search-provider-abstraction.md`。建议接收方在引用本条反馈时去掉「URL 拼接错误」这个论据，避免误导后续 review。

## 3. 优先级与建议落地顺序

**P0（先做，触及正确性 / 安全 / 可发布性）**

1. trading stage/commit/execute 原子化 — 没改之前任何并发 stage 都可能丢单。
2. Web/Tauri base URL 统一 — 是桌面发布能用的前置条件。
3. Auth/session 硬化 — 任何对外或多机分发前必须收紧。

**P1（紧随其后，影响产品体感 / 数据正确性）**

4. 文档上传链路加固 — 大文件 / 失败一致性 / 异步生产化。
5. Watchlist 服务端化 — 跨设备体验断层最明显。
6. RAG 三件套 — 直接影响检索质量上限。
7. Market search 抽象统一 — 与 P1 其它同档，但代码改动最小。

**P2（工程边界、长期复利）**

8. 平台 bootstrap / dynamic module。
9. 桌面 CI smoke。

## 4. 与现有 exec-plans / runbooks 的关系

这批 PRD 都属于 product-spec（仍是「为什么 / 范围 / 验收标准」），实际实施时建议每条对应再开 `docs/exec-plans/YYYY-MM-DD-...md`，承担步骤、进度日志、决策记录与最终结果——与仓库现行约定保持一致。

## 5. 已决策项（codex consult 2026-04-23 后定稿）

下面四条原本是开放问题，已经过 `/codex` 二次评估并把结论写回各自 PRD：

- **Q1 Trading idempotencyKey** — 走 HTTP 头 `Idempotency-Key`（Stripe 风格）。控制器边界归一为内部 typed metadata，不污染 DTO。需要在 ingress 层显式放行该头并写入结构化日志 / trace context。详见 `2026-04-23-trading-stage-commit-execute-atomicity.md` §5.3。
- **Q2 Linux 桌面 keychain fallback** — **不**实现自研 AES-GCM 文件 vault；缺 Secret Service 时进入「session-only 降级模式」（JWT 仅在内存中持有，进程退出即丢失），文档指引用户安装 `gnome-keyring` / KeePassXC。详见 `2026-04-23-auth-session-hardening.md` §5.4。
- **Q3 RAG sector/region 下沉** — 默认 SOFT filter（在 fusion 中给命中文档加权而非排除其它文档）；提供 `strict_metadata=true` 策略开关切到 HARD；查询响应附 `metadataDiagnostics`。详见 `2026-04-23-rag-fusion-prefilter-shadow-runner.md` §5.2。
- **Q4 Desktop CI runner** — `ubuntu-latest` 在每个 PR 跑（廉价持续压力）；`macos-latest` 跑 nightly；任何改动到 `apps/desktop/src-tauri/**` 等关键路径的 PR 立即再触发 macOS smoke。详见 `2026-04-23-desktop-ci-smoke-build.md` §5.1。

Codex session 已存档到 `.context/codex-session-id`（`019dbd8d-da03-7691-b48f-08e2101ea88f`），如需在实施过程中追问可直接 resume。
