# PRD: 上下文谱系与会话日志

日期：2026-04-17
状态：Draft
优先级：P0

## 1. 问题

FinSentinel 当前已经同时拥有：

- `chat_messages`
- `chat_session_memories`
- `analysis_runs`
- `analysis_stages`
- `analysis_artifacts`
- `agent_events`

但它们还没有组成一条统一的上下文真相链。

当前最明显的问题：

- chat 入口用 `ChatCompactionService`
- analysis 入口用 `ContextFabricService`
- `AnalysisModule` 里的 session adapter 仍是空实现
- `sharedContextJson` 虽存在于 schema，却没有成为运行时的主记录
- 工具调用、阶段输入、阶段输出、升级边界、压缩边界，没有落在同一条可回放的日志里

相较之下，OpenAlice 的 `SessionStore + compaction boundary + tool_use/tool_result persistence` 让系统更容易回答两个核心问题：

1. 这次运行到底看到了什么？
2. 这个结论到底从哪来的？

## 2. 目标

建立 FinSentinel 的统一上下文谱系系统，使 chat、analysis run、schedule、heartbeat 共用同一条可持久化、可回放、可审计的上下文链。

这套系统要同时解决：

- 模型输入来源不透明
- chat 与 run 之间无法无损衔接
- 阶段交接依赖摘要字符串而不是结构化来源
- 无法精确回放“某个角色当时看到的上下文”

## 3. 非目标

- 不在本 PRD 中重写现有 RAG 检索算法
- 不直接替代 `analysis_artifacts`
- 不要求 v1 做到 token 级精确重放

## 4. 设计原则

1. 上下文先记录，再拼 prompt。
2. Prompt-ready 文本是派生视图，不是主存储。
3. Chat 与 Analysis 不允许维护两套完全独立的上下文生命周期。
4. 每个阶段都必须能回答“输入来自哪几部分”。

## 5. 核心对象

### 5.1 新增一等对象：Context Journal

每个 journal item 至少包含：

- `journalId`
- `userId`
- `sessionId`
- `runId`
- `stageKey`
- `roleKey`
- `entryType`
- `sourceType`
- `sourceRef`
- `payload`
- `createdAt`

推荐 `entryType`：

- `USER_MESSAGE`
- `ASSISTANT_MESSAGE`
- `COMPACTION_BOUNDARY`
- `COMPACTION_SUMMARY`
- `RAG_EVIDENCE`
- `TOOL_CALL`
- `TOOL_RESULT`
- `STAGE_INPUT`
- `STAGE_OUTPUT`
- `RUN_UPGRADE_LINK`
- `NOTIFICATION`

### 5.2 Shared Context 变为物化快照

`analysis_runs.sharedContextJson` 必须真的写入，并作为一次 run 的上下文快照。

至少包含：

- `longTermPreferenceContext`
- `midTermStrategyContext`
- `shortTermSessionContext`
- `retrievalContext`
- `lineage`

其中 `lineage` 必须记录每层来自哪些 journal entries，而不是只保留 `sourceIds`。

### 5.3 Stage Input Snapshot

每个 stage 开始前写入 `STAGE_INPUT`，至少记录：

- 使用了哪些 context layers
- 使用了哪些 prior stage outputs
- 使用了哪些 evidence items
- 最终 prompt hash
- token budget / truncation info

## 6. 功能需求

### 6.1 统一装配入口

新增 `ContextJournalService`，作为 chat、analysis、autonomy 的统一装配器与读取器。

要求：

- chat compaction 的结果写入 journal
- analysis stage input 写入 journal
- auto-upgrade 写入 `RUN_UPGRADE_LINK`
- heartbeat / schedule 触发的上下文也通过相同接口生成

### 6.2 Prompt 生成改造

`ContextFabricService` 保留，但职责下沉为：

- 从 journal 读取素材
- 生成 prompt-ready 视图
- 生成 machine-readable lineage 视图

不再允许由各入口各自偷偷拼接上下文字符串。

### 6.3 工具调用纳入上下文链

role 或 chat agent 的工具调用必须可选地写入 journal：

- `TOOL_CALL`
- `TOOL_RESULT`

v1 不要求记录全部大 payload，但至少要记录：

- 工具名
- 输入摘要
- 输出摘要
- 关联 stage / role

### 6.4 压缩边界可见

`ChatCompactionService` 不能只在 `chat_session_memories` 留一个摘要。

必须追加：

- `COMPACTION_BOUNDARY`
- `COMPACTION_SUMMARY`

并能告诉 analysis run：当前接入的是哪次压缩之后的会话窗口。

## 7. API 与读取能力

新增：

- `GET /chat/sessions/:id/journal`
- `GET /analysis/runs/:id/context`
- `GET /analysis/runs/:id/stages/:stageKey/input`

支持前端按阶段查看：

- 结构化上下文
- prompt-ready 视图
- 来源链路

## 8. UX 要求

在 Analysis Workspace 中，用户必须能看到：

- 当前阶段用了哪些上下文层
- 来自 chat 的哪些历史被压缩进入 run
- 哪些证据来自 RAG
- 哪些结论来自前序 stage

在 Chat 自动升级后，用户必须能看到：

- run 与 session 的链接关系
- 此次升级继承了哪些会话上下文

## 9. 验收标准

1. chat 与 analysis 共用同一套上下文谱系数据结构。
2. `sharedContextJson` 被真实写入，而不是保持空值。
3. 任意 stage 都能查看自己的输入快照与来源。
4. 自动升级后的 run 能追溯到触发它的 chat session 和 compaction summary。
5. 工具调用至少能以摘要形式进入上下文谱系。
6. 前端可以按阶段查看“模型看到了什么”。

## 10. 风险

- 如果只补 UI，不补 journal，本质问题不会消失。
- 如果 lineage 不进入存储，后续 replay 与 explainability 会继续失真。
