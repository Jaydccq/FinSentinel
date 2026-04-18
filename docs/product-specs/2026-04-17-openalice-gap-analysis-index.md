# OpenAlice 对比差距拆解

日期：2026-04-17

## 背景

本轮对比以 `/Users/hongxichen/Downloads/OpenAlice/docs/reports/2026-04-17-openalice-technical-report.md` 为主线，并回看了 OpenAlice 的 `session.ts`、`compaction.ts`、`agent-center.ts`、`event-log.ts`、`heartbeat.ts`、`connector-center.ts`、`TradingGit.ts` 和 UI 页面。

对应检查了 FinSentinel 当前的 `chat/`、`analysis/`、`autonomy/`、`events/`、`trading/` 以及 `ChatPage / AnalysisPage / AutonomyPage`。

## 结论

FinSentinel 现在已经不再是“只有聊天 agent”的状态。你们在这几个点上已经明显超过 OpenAlice：

- 已有显式的 `analysis_run`
- 已有 team-stage runtime
- 已有 approval gate
- 已有 chat 自动升级到 tracked run

但真正的差距也很明确：

- OpenAlice 更强在“运行时的一致性”
- OpenAlice 更强在“可检查、可回放、可操作”
- FinSentinel 更强在“多 agent 目标形态”
- FinSentinel 更弱在“这些能力是否已经闭环到同一套产品体验里”

换句话说，FinSentinel 的问题已经不是“没有 multi-agent 架构”，而是：

1. 上下文仍然分裂在 chat 和 analysis 两套路径里
2. agent loop 有状态机，但缺少真正的 live timeline / replay / control plane
3. agent teams 已经落代码，但还是硬编码、弱可视、弱可配置
4. 研究工作台还没长成 operator console
5. 执行审批还是二元按钮，不是可复盘的执行账本

## 主要发现

### 1. 上下文管理

OpenAlice 的 `SessionStore + compaction boundary + tool/result persistence` 是一条完整链路。

FinSentinel 当前则是：

- chat 走 `ChatCompactionService`
- analysis 走 `ContextFabricService`
- `AnalysisModule` 里 session adapter 仍是空实现
- `sharedContextJson` 虽有 schema，但没有形成运行时真相源

### 2. Agent Loop

FinSentinel 已经有 `RunOrchestratorService` 和 stage checkpoint，但 live 体验仍主要依赖轮询，且控制面还没完全闭环。

OpenAlice 虽没有多 team graph，却有更统一的 `event-log -> listener -> automation -> delivery` 机制。

### 3. Agent Teams

FinSentinel 的 team 设计方向是对的，但 `enabledTeams`、`researchDepth` 目前还没有真正改变执行图。用户能配置，系统不真正响应，这会直接伤害可信度。

### 4. 使用体验

OpenAlice 更像一个 operations console。

FinSentinel 的 `Chat / Analysis / Autonomy` 现在是三个入口，但还不是一个连续的操作台：

- 分析页只展示 stage chip 和原始 JSON
- 没有角色级视角
- 没有上下文来源回放
- 没有事件时间线
- 没有执行账本视图

## PRD 拆分

1. [上下文谱系与会话日志 PRD](/Users/hongxichen/Desktop/FinSentinel/docs/product-specs/2026-04-17-context-lineage-and-session-journal.md)
2. [Live Run Timeline 与 Replay PRD](/Users/hongxichen/Desktop/FinSentinel/docs/product-specs/2026-04-17-live-run-timeline-and-replay.md)
3. [Agent Teams V2 可配置化 PRD](/Users/hongxichen/Desktop/FinSentinel/docs/product-specs/2026-04-17-agent-teams-v2-configurability.md)
4. [Analysis Operator Console PRD](/Users/hongxichen/Desktop/FinSentinel/docs/product-specs/2026-04-17-analysis-operator-console.md)
5. [执行复核账本 PRD](/Users/hongxichen/Desktop/FinSentinel/docs/product-specs/2026-04-17-execution-review-ledger.md)
6. [工业级默认方向决策](/Users/hongxichen/Desktop/FinSentinel/docs/product-specs/2026-04-17-openalice-industrial-direction.md)

## 优先级建议

- P0: 上下文谱系与会话日志
- P0: Live Run Timeline 与 Replay
- P0: Agent Teams V2 可配置化
- P1: Analysis Operator Console
- P1: 执行复核账本

## 与 2026-04-16 文档的关系

昨天那批 PRD 更偏“把 multi-agent runtime 做出来”。

今天这批 PRD 更偏“基于当前已落地代码，把仍未闭环的地方补完”，重点是：

- 一致性
- 可观测性
- 可操作性
- 用户对系统过程的可理解性

这也是 OpenAlice 源码给出的最大启发。
