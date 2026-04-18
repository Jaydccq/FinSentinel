# PRD: Analysis Operator Console

日期：2026-04-17
状态：Draft
优先级：P1

## 1. 问题

FinSentinel 当前已经有三个重要入口：

- Chat
- Analysis
- Autonomy

但它们仍然像三个平行页面，而不是一个连续的操作台。

当前体验的主要问题：

- Analysis 页只看到 stage chip、原始 artifact JSON、审批侧栏
- `finalReportMarkdown` 目前没有真正形成稳定终态
- `AutonomyPage` 的 event/schedule 与 analysis run 没有深度串联
- Chat 升级到 run 后，体验只停留在一个 banner 和 `Open Run` 链接

OpenAlice 的直接启发是：哪怕没有复杂的 multi-agent team，它也让 chat、automation、logs、delivery 更像同一套控制台。

## 2. 目标

把 FinSentinel 的研究与自治能力收拢为一个 operator console，让用户能在同一条工作流里：

- 发起 run
- 看 live progress
- 看 context lineage
- 看 artifacts
- 看 autonomy trigger
- 做 approval
- 回看历史

## 3. 非目标

- 不追求大规模视觉重设计
- 不在一期引入桌面端或 Telegram 控台
- 不替代通用 chat 输入体验

## 4. 页面结构

### 4.1 左侧：Run / Session Navigator

显示：

- recent runs
- pinned runs
- linked chat sessions
- source mode (`CHAT / WORKSPACE / SCHEDULE / HEARTBEAT`)

### 4.2 中间：Live Workspace

包含 4 个主视图：

1. `Timeline`
2. `Context`
3. `Artifacts`
4. `Final Decision`

### 4.3 右侧：Control Rail

包含：

- pause / resume / cancel
- approval card
- schedule / heartbeat 来源信息
- escalation / failure reason

## 5. 关键功能

### 5.1 Artifact 渲染升级

`ArtifactsPanel` 不能继续只展示 JSON。

至少需要：

- Markdown 报告渲染
- JSON 结构化对象树
- 角色输出摘要卡片
- 下载原始 artifact

### 5.2 Chat <-> Run 联动

从 Chat 自动升级出来的 run，在 console 中要看到：

- 原始聊天请求
- 触发升级原因
- 所继承的上下文
- 回到 chat 的入口

### 5.3 Autonomy <-> Run 联动

从 schedule / heartbeat 触发的 run，在 console 中要看到：

- 来源 schedule / heartbeat 配置
- 最近一次 tick / trigger
- 同类历史 run

### 5.4 历史回看

历史 run 的默认视图不是“打开一个旧 JSON”，而是：

- 时间线
- 最终结论
- 关键 artifact
- 审批结果

## 6. 交互要求

### 6.1 Role Drilldown

用户点开 stage 时，应能下钻到 role 层：

- 角色名
- 输出摘要
- 工具摘要
- 耗时

### 6.2 Final Decision 视图

最终结果统一展示：

- natural-language report
- decision object
- execution payload
- alert payload
- strategy archive payload

并标注来源 stage。

### 6.3 Event Tail

在 console 中内嵌 event tail，而不是把事件只留在 `AutonomyPage`。

## 7. 入口策略

### 7.1 Chat

当 chat 升级为 tracked run：

- assistant 返回短说明
- 同时在 UI 内联显示 run live card
- 用户无需离开 chat 也能看到 run 已开始

### 7.2 Analysis

Analysis 页成为 console 的默认启动入口。

### 7.3 Autonomy

Autonomy 页保留配置职能，但 run 查看统一跳到 operator console。

## 8. 验收标准

1. Analysis 页能渲染 human-readable artifacts，而不是只显示 JSON。
2. 用户能在同一页面看到 run timeline、context、artifacts、approval。
3. chat 升级后的 run 可以在 chat 内联看到基本进度。
4. schedule / heartbeat 触发的 run 可以无缝跳入同一个 console。
5. 历史 run 回看默认呈现为可读工作流，而不是数据表直出。

## 9. 风险

- 如果没有 operator console，runtime 能力越强，用户反而越难理解系统在做什么。
- 如果 artifacts 继续以原始 JSON 为主，团队输出的价值对用户不可见。
