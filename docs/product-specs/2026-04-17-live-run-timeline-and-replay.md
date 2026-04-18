# PRD: Live Run Timeline 与 Replay

日期：2026-04-17
状态：Draft
优先级：P0

## 1. 问题

FinSentinel 已经有：

- `RunOrchestratorService`
- BullMQ job
- `analysis_runs / stages / artifacts / approvals`
- `agent_events`

但当前运行时仍存在明显断层：

- 前端主要靠 2 秒轮询读状态
- 事件流只有拉取接口，没有真正的 live subscription
- 角色级事件没有形成可回放时间线
- `resume` 控制面不完整，状态变化与实际 re-enqueue 没有统一
- `complexityScore / finalReportMarkdown / decisionObjectJson` 等 run-level 字段没有真正成为运行时产物

OpenAlice 的启发不在于它有多复杂，而在于它的 `event-log -> listener -> automation -> delivery` 是一条完整链路。系统能自然回答“刚刚发生了什么”和“现在该做什么”。

## 2. 目标

把 FinSentinel 的 analysis runtime 升级成可直播、可回放、可控制的运行时间线系统，而不是一组分散的表和轮询接口。

## 3. 非目标

- 不在本 PRD 中替换 BullMQ
- 不在本 PRD 中引入任意用户自定义 DAG
- 不要求 v1 就支持 tool-call 级 checkpoint 恢复

## 4. 核心设计

### 4.1 Runtime Timeline Event

新增统一 timeline 事件模型，覆盖：

- run
- queue
- stage
- role
- tool
- approval
- autonomy trigger

建议事件类型：

- `RUN_ENQUEUED`
- `RUN_STARTED`
- `RUN_PAUSED`
- `RUN_RESUMED`
- `RUN_CANCELED`
- `STAGE_STARTED`
- `ROLE_STARTED`
- `ROLE_COMPLETED`
- `TOOL_CALL_STARTED`
- `TOOL_CALL_COMPLETED`
- `CHECKPOINT_COMMITTED`
- `APPROVAL_WAITING`
- `APPROVAL_RESOLVED`
- `RUN_COMPLETED`
- `RUN_FAILED`

### 4.2 Materialized Run Summary

每个 run 结束时，必须物化：

- `sharedContextJson`
- `decisionObjectJson`
- `finalReportMarkdown`
- `complexityScore`
- `upgradeReason`

它们不能继续只是 schema 字段。

### 4.3 Replay Cursor

前端可基于 `seqNo` 或 `eventId` 订阅与重放：

- 初次加载获取历史
- 建立 live stream
- 断线后从最后 cursor 补齐

## 5. 功能需求

### 5.1 实时传输

新增 run timeline SSE 或 WebSocket：

- `GET /analysis/runs/:id/stream`

前端不再以轮询为主路径。

轮询只作为降级方案保留。

### 5.2 控制面闭环

控制动作必须走统一 runtime control service：

- pause
- resume
- cancel
- retry stage

要求：

- 状态变化与 queue 操作原子化
- `resume` 必须真实 re-enqueue，而不是只改 DB status
- 被暂停的 run 在 UI 中显示停在哪个 stage / role

### 5.3 角色级时间线

不仅要看到 team stage，还要看到：

- 进入了哪个 role
- role 用了多久
- role 是否重试
- role 失败原因

### 5.4 最终报告生成

run 完成后，必须生成 run-level `finalReportMarkdown`，而不是只散落在 stage artifacts 中。

建议由专门的 `RunReportAssembler` 负责：

- 汇总 stage structured outputs
- 汇总 human reports
- 生成 final report
- 生成 decision object

## 6. UI 要求

### 6.1 Timeline 面板

Analysis Workspace 中新增 live timeline：

- 时间顺序事件
- stage / role 过滤
- 错误高亮
- queue / approval 状态

### 6.2 Replay 模式

历史 run 必须可以：

- 重新打开
- 按时间轴回放
- 查看每次状态切换
- 查看 final report 是如何逐步形成的

### 6.3 Autonomy 联动

从 `AutonomyPage` 打开的 run，也要进入同一条时间线，不再只看到 schedule 或 heartbeat 事件。

## 7. 验收标准

1. Analysis Run 页面默认通过 live stream 获取增量状态。
2. 断线或刷新后可以从 cursor 继续补齐 timeline。
3. `resume` 会真实恢复执行，而不是只改变状态文本。
4. 用户能在时间线中看到 role 级事件，而不只是 stage chip。
5. run 完成后 `finalReportMarkdown` 与 `decisionObjectJson` 被真实写入。
6. chat、workspace、schedule、heartbeat 触发的 run 共享同一 timeline 模型。

## 8. 成功指标

- run 刷新后恢复成功率
- 用户查看 timeline 的占比
- 人工排障时间下降
- “为什么这次 run 卡住了”的定位时间下降

## 9. 风险

- 如果只做 streaming 而不补 materialized summary，历史回放仍然缺核心产物。
- 如果控制面与 queue 仍分离，pause/resume 会持续出现假状态。
