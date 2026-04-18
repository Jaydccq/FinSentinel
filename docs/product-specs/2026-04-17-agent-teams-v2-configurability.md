# PRD: Agent Teams V2 可配置化

日期：2026-04-17
状态：Draft
优先级：P0

## 1. 问题

FinSentinel 现在已经有真正的 team services：

- `Intelligence`
- `Thesis`
- `Risk`
- `Execution Prep`
- `Human Approval`

这比 OpenAlice 更先进。

但当前实现仍有几个关键短板：

- `enabledTeams` 在 UI 可选，但执行图并未真正消费
- `researchDepth` 被采集，但没有改变 role 数量、工具预算、检索深度或收敛策略
- team 顺序是硬编码
- role 输出虽进入 stage payload，但用户看不到 role 级过程
- team registry 更像启动期 wiring，不是产品级 team definition

这意味着用户表面上在“配置 multi-agent run”，实际上系统大多仍在跑固定剧本。

## 2. 目标

把现有 team runtime 从“代码里写死的编排器”升级为“用户可配置、系统真执行、过程可见”的 team system。

## 3. 非目标

- 不做任意 DAG 自由编排器
- 不在 v1 开放用户自定义 prompt 模板
- 不在本 PRD 中处理模型 provider 选择

## 4. 一期设计

### 4.1 Team Preset

新增可执行的 team preset 概念：

- `FAST_RISK_CHECK`
- `STANDARD_ANALYSIS`
- `DEEP_THESIS`
- `EXECUTION_READY`

每个 preset 明确定义：

- 启用哪些 team
- 每个 team 的 role roster
- 检索深度
- tool budget
- 最大并发数
- 是否要求 execution prep

### 4.2 researchDepth 真正生效

`researchDepth` 至少影响：

- Intelligence Team 的检索轮次
- 允许的 evidence 数量
- Thesis Team 是否启用第二轮 challenge
- Risk Team 是否启用组合层压力测试

建议：

- `SHALLOW`：快速单轮，少量证据
- `STANDARD`：默认 team 组合
- `DEEP`：更多证据、可选二次 challenge、更多 artifact

### 4.3 enabledTeams 真正改变执行图

如果用户关闭某个 team：

- 运行图必须真实跳过
- timeline 要显示 `SKIPPED`
- 后续 team 只能消费前面真实存在的输出

不允许 UI 和 backend 行为不一致。

### 4.4 Role 级可视化

每个 stage 下要能看到：

- role 状态
- role 用时
- role 输出摘要
- role 失败与重试
- role 工具使用摘要

## 5. Team Definition 模型

新增可持久化 team definition，至少包含：

- `presetKey`
- `stageKey`
- `enabled`
- `roleKeys`
- `retryPolicy`
- `maxTurns`
- `maxEvidenceCount`
- `toolBudget`

v1 可以先做 repo-owned preset，不做用户自由编辑。

## 6. 输出要求

### 6.1 Stage 输出

每个 stage 除了 team 汇总，还必须保留：

- `roleSummaries`
- `roleDurations`
- `roleFailures`
- `roleArtifactRefs`

### 6.2 UI 配置与实际执行一致

Run Setup 中所有可操作项都必须映射到实际运行结果：

- preset
- enabled teams
- research depth
- portfolio context

## 7. UX 要求

### 7.1 Run Setup

Run Setup 面板改为真正的配置器，而不是静态表单：

- 选择 preset
- 展开查看哪些 team / role 会运行
- 估算耗时与复杂度
- 明确显示会不会进入 execution prep

### 7.2 Stage Drilldown

用户点开 `THESIS` 时，应看到：

- Positive Case
- Negative Case
- Thesis Lead

而不是只看到一个合并后的 team 结果。

## 8. 验收标准

1. `enabledTeams` 会真实改变执行图。
2. `researchDepth` 会真实改变至少 3 个 runtime 参数。
3. UI 能展示 role 级状态和输出摘要。
4. 历史 run 回看时，用户能知道当时使用的是哪个 preset。
5. Stage 被跳过时，时间线和 artifacts 都能明确反映。

## 9. 风险

- 如果不把 preset 变成一等对象，配置项会继续漂浮在 UI 层。
- 如果 role 级观测缺失，team 编排越复杂，用户越不信任结果。
