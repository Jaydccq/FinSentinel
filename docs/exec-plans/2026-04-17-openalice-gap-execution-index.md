# OpenAlice Gap Execution Plan Index

日期：2026-04-17

## 输入文档

- [OpenAlice 对比差距拆解](/Users/hongxichen/Desktop/FinSentinel/docs/product-specs/2026-04-17-openalice-gap-analysis-index.md)
- [工业级默认方向决策](/Users/hongxichen/Desktop/FinSentinel/docs/product-specs/2026-04-17-openalice-industrial-direction.md)
- [上下文谱系与会话日志 PRD](/Users/hongxichen/Desktop/FinSentinel/docs/product-specs/2026-04-17-context-lineage-and-session-journal.md)
- [Live Run Timeline 与 Replay PRD](/Users/hongxichen/Desktop/FinSentinel/docs/product-specs/2026-04-17-live-run-timeline-and-replay.md)
- [Agent Teams V2 可配置化 PRD](/Users/hongxichen/Desktop/FinSentinel/docs/product-specs/2026-04-17-agent-teams-v2-configurability.md)
- [Analysis Operator Console PRD](/Users/hongxichen/Desktop/FinSentinel/docs/product-specs/2026-04-17-analysis-operator-console.md)
- [执行复核账本 PRD](/Users/hongxichen/Desktop/FinSentinel/docs/product-specs/2026-04-17-execution-review-ledger.md)

## 计划拆分

本轮不把所有缺口硬塞进一份总计划，而是拆成四个可独立实现、可独立验证、能各自交付 working slice 的执行计划：

1. [Runtime & Context Foundation Implementation Plan](/Users/hongxichen/Desktop/FinSentinel/docs/exec-plans/2026-04-17-runtime-context-foundation-implementation-plan.md)
2. [Team Config Runtime Implementation Plan](/Users/hongxichen/Desktop/FinSentinel/docs/exec-plans/2026-04-17-team-config-runtime-implementation-plan.md)
3. [Operator Console Implementation Plan](/Users/hongxichen/Desktop/FinSentinel/docs/exec-plans/2026-04-17-operator-console-implementation-plan.md)
4. [Execution Review Ledger Implementation Plan](/Users/hongxichen/Desktop/FinSentinel/docs/exec-plans/2026-04-17-execution-review-ledger-implementation-plan.md)

## 当前代码校准摘要

本计划组已按 2026-04-17 当前代码重新校准：

- Drizzle 迁移输出使用 `packages/db/drizzle/`，不使用旧的 migrations 目录假设。
- Web 组件测试需要先修改 `apps/web/vitest.config.ts`，加入 `.test.tsx` 与 `jsdom`。
- Analysis run response 兼容当前 DB-shaped 字段：`sharedContextJson`、`decisionObjectJson`、`inputSnapshotJson`。
- Event stream 从 `agent_events.payloadJson` 映射到前端 `payload`。
- Execution approval 需要显式绑定 `ORDER_DRAFTS` artifact id，再推进 execution ledger。
- `docs/product-specs` 与本计划组已通过 `.gitignore` 例外规则恢复为可版本化 artifact。

## Progress Log

- 2026-04-17: 初版计划组由 OpenAlice gap PRD 与工业级方向拆分为四个 workstream。
- 2026-04-17: 按现有代码修正计划中的路径、测试环境、API 字段、event payload、approval artifact 绑定和版本化规则。
- 2026-04-18: Runtime & Context Foundation 已全部落地；Operator Console 经 PR #12 交付 timeline/SSE/live card slice，仍剩 navigator + context/artifact renderer；Team Config Runtime 与 Execution Review Ledger 未开始。剩余工作整合为 [openalice remaining-work plan](2026-04-18-openalice-remaining-work-plan.md)，按 Phase 1 (Team Config) → Phase 2 (Operator Console 补齐) → Phase 3 (Execution Ledger) 推进。

## Key Decisions

- 先交付 Runtime & Context Foundation，再推进 Team Config、Operator Console 和 Execution Review Ledger。
- Analysis 作为唯一主工作台，Chat / Autonomy 只跳转到同一 run console。
- Approval 与 execution ledger 分层，避免把人工确认直接等同于下单派发。

## Risks And Blockers

- 如果忽略 Runtime Foundation 先行，UI 和 ledger 都会依赖不稳定的 pause/resume 与 event semantics。
- `.gitignore` 当前仍只白名单本轮相关文档，后续新增 docs artifact 需要同步补白名单或调整 docs 版本化策略。

## 推荐执行顺序

### Phase 1

先执行 Runtime & Context Foundation。

原因：

- 先修复 `pause/resume` 假状态
- 先补齐 timeline / stream / materialized outputs
- 先建立 context journal 和 lineage 真相链

这一步完成前，后续 UI 和 ledger 都会建立在不稳定的运行时上。

### Phase 2

执行 Team Config Runtime。

原因：

- `preset / researchDepth / enabledTeams` 必须先从“表单字段”变成“真实运行图”
- role 级 summary / duration / skipped stage 语义也要先有

### Phase 3

执行 Operator Console。

原因：

- 这一步消费前两阶段提供的 stream、context、artifacts、role summaries
- UI 不再只能轮询和看 JSON

### Phase 4

执行 Execution Review Ledger。

原因：

- 这一步依赖 runtime 稳定、final decision 稳定、approval 边界稳定
- 也依赖 console 已能展示 run 和 stage 细节

## 交付边界

### Runtime & Context Foundation

交付后必须可以：

- 查看 run stream
- 正确 pause / resume / retry
- 查询 run context / stage input
- 在 run 完成后读取 `sharedContextJson / decisionObjectJson / finalReportMarkdown`

### Team Config Runtime

交付后必须可以：

- 选择 preset
- 让 `researchDepth` 真正改变运行参数
- 让 `enabledTeams` 真正改变执行图
- 在 timeline / stage 结果中看到 role-level 状态

### Operator Console

交付后必须可以：

- 在 Analysis 页看到 timeline / context / artifacts / final decision
- 在 Chat 内联看到升级 run 的 live card
- 从 Autonomy 打开的 run 进入同一工作台

### Execution Review Ledger

交付后必须可以：

- 从 approval 看到 draft -> staged -> committed -> executed / rejected
- Trading 页面能反查 run / approval / ledger
- auto-dispatch 失败不会埋在事件流里

## 验证门槛

每个子计划都必须至少通过：

1. 目标模块的 Vitest 单测
2. 相关 package 的 typecheck
3. 必要的 Drizzle migration 生成
4. 文档中列出的验收命令

## 注意事项

- 先做运行时，再做 UI。
- 先做显式边界，再做自动化。
- 不把 Chat 和 Analysis 做成双主控。
- 不把 approval 直接等同于 dispatch。
