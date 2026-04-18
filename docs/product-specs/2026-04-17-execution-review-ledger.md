# PRD: 执行复核账本

日期：2026-04-17
状态：Draft
优先级：P1

## 1. 问题

OpenAlice 最有辨识度的设计之一，是把交易执行抽象成：

- add
- commit
- push
- reject

也就是一个清晰的 reviewable boundary。

FinSentinel 当前并不是没有这个能力底座：

- `UnifiedTradingService` 已有 `stage / commit / execute`
- `ExecutionPrepTeamService` 能产出 broker-neutral `orderDrafts`
- `AnalysisApprovalService` 能把草案映射为交易请求

但这些环节目前没有形成一个用户可见的“执行账本”。

现状更像：

1. AI 生成订单草案
2. 用户点 Approve
3. 系统内部去 stage / commit / execute

这在系统上能跑，但在产品上不够可审计，也不够让用户放心。

## 2. 目标

把 analysis run 的 execution prep 与真实 trading lifecycle 连接成一条可查看、可确认、可复盘的执行复核账本。

## 3. 非目标

- 不改 broker adapter 协议
- 不在本 PRD 中引入自动化高频执行
- 不做复杂回测或成交分析模块

## 4. 核心对象

新增 `execution_review_ledger` 概念，至少包含：

- `ledgerId`
- `runId`
- `approvalId`
- `status`
- `orderDraftRefs`
- `stagedOperationRefs`
- `commitHash`
- `executionResultRef`
- `createdAt`
- `updatedAt`

建议状态：

- `DRAFTED`
- `STAGED`
- `COMMITTED`
- `APPROVED`
- `DISPATCHED`
- `EXECUTED`
- `REJECTED`
- `FAILED`

## 5. 功能需求

### 5.1 草案到 staging 可见化

当 `orderDrafts` 通过校验后，系统应能展示：

- 每一条 draft 会变成什么 `UnifiedStageRequest`
- 哪些字段来自 thesis
- 哪些字段来自 risk limits
- 哪些字段是 broker-neutral，哪些是 execution-layer 补充

### 5.2 Commit 作为一等产物

用户审批后，不应直接只看到“成功/失败”。

必须能看到：

- commit message
- commit hash
- staged operation count
- 每个 symbol 的操作摘要

### 5.3 Rejection 也是正式结果

当用户拒绝执行时，账本必须保留：

- 被拒绝的 draft
- 拒绝原因
- 对应 run
- 对应 approval

不允许 rejection 只是一个瞬时按钮动作。

### 5.4 Auto-dispatch 透明化

如果启用 auto dispatch：

- UI 仍必须展示 staging、commit、dispatch 的中间状态
- dispatch 失败要进入 `FAILED`，而不是只写一条难发现的 event

## 6. UX 要求

### 6.1 Approval Rail 升级

右侧审批面板改为“执行复核面板”，包含：

- Thesis 摘要
- 风险限制
- 订单草案
- staging preview
- commit preview
- approve / reject

### 6.2 Execution Ledger View

每个 run 的 final view 中新增 `Execution Ledger`：

- staged operations
- commit hash
- dispatch status
- broker execution result
- rejection note

### 6.3 交易历史联动

从 Trading 页面能反查：

- 这次执行来自哪个 analysis run
- 当时的 thesis / risk / approval 是什么

## 7. 验收标准

1. 每次 execution approval 都会生成 ledger 记录。
2. 用户可以看到 draft -> staged -> committed -> executed 的状态变化。
3. 拒绝执行同样会生成可回查记录。
4. Trading 页面能反向链接回 analysis run。
5. auto-dispatch 失败会在 ledger 中显示，而不是只埋在事件里。

## 8. 风险

- 如果仍然只有“Approve Execution”按钮，系统边界虽然存在，用户边界并不存在。
- 如果 commit 不成为可见对象，`UnifiedTradingService` 的阶段化价值无法传递到产品层。
