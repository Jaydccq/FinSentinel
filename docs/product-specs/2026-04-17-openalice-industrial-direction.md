# OpenAlice 对比后的工业级默认方向

日期：2026-04-17
状态：Recommended

## 1. 目的

基于当前 FinSentinel 实现、2026-04-17 这批 OpenAlice 差距 PRD，以及工业级系统对可审计性、可恢复性、可运营性的要求，确定一条默认产品与架构方向。

这里追求的不是“最自由”，而是：

- 单一真相源
- 明确的运行时语义
- 稳定的操作边界
- 对未来自治化的可扩展性

## 2. 总体判断

默认路线应当是：

**统一上下文账本 + 可恢复运行时 + Console 作为主控制面 + policy 驱动的执行边界**

这条路线比“先做更多 agent 花样”更工业级，因为它优先解决：

1. 系统到底看到了什么
2. 系统刚刚做了什么
3. 系统停在了哪里
4. 谁批准了什么
5. 哪一步真的触发了交易动作

## 3. 默认决策

### 3.1 上下文权威来源

**决策：采用统一 Context Journal，run 再物化自己的 `sharedContextJson` 快照。**

解释：

- 不保留 chat 和 analysis 两套彼此独立的上下文生命周期
- 也不只靠 compacted summary 传递上下文
- chat、analysis、schedule、heartbeat 都写入同一逻辑账本
- run 开始时生成自己的物化上下文快照，作为该次运行的可审计输入

落地含义：

- `Context Journal` 是主记录
- `sharedContextJson` 是 run 级快照
- `STAGE_INPUT` 是阶段级快照

这是最适合审计、回放、故障恢复的结构。

### 3.2 Chat 与 Analysis 的关系

**决策：Chat 负责发起与观察，Analysis Operator Console 负责运行与控制。**

解释：

- Chat 中保留 inline live card、升级原因、跳转入口
- 但 pause / resume / retry / approval / execution ledger 等控制动作，以 Console 为主
- 不做“两边都能完整操控”的双主控模式

原因：

- 双主控最容易造成状态理解不一致
- Console 更适合承载 timeline、context、artifacts、approval、ledger

### 3.3 `researchDepth` 的真实语义

**决策：`preset` 决定执行图，`researchDepth` 决定执行强度。**

具体推荐：

- `preset` 决定启用哪些 team、哪些 role、是否进入 execution prep
- `researchDepth` 至少控制：
  - 检索轮次
  - evidence 上限
  - thesis challenge 轮数
  - risk stress 深度
  - tool / token budget

不建议让 `researchDepth` 随意改变 role roster，否则用户难以预测运行行为。

### 3.4 `enabledTeams` 的边界语义

**决策：真实跳过，但必须服从依赖与产物约束。**

规则：

- 被关闭的 team 在 timeline 中显示 `SKIPPED`
- 如果下游能力依赖该 team，则相应产物降级或被阻断
- 例如：
  - 关闭 `RISK` 后，允许 research report 继续
  - 但不允许进入可执行交易建议
  - 关闭 `EXECUTION_PREP` 后，run 自动降级为 research-only

不采用“静默降级继续跑完整流程”的做法，因为那会制造假安全感。

### 3.5 Pause 的语义

**决策：v1 使用 cooperative pause，作用于 checkpoint 边界，不做任意中途硬中断。**

暂停应在这些边界生效：

- stage 开始前
- role 开始前
- tool call 前后
- stage 完成后

不建议 v1 做“强杀正在进行的模型调用或外部工具”，因为：

- 运行时一致性会显著变差
- 很难定义半完成输出的有效性
- 恢复语义会变得脆弱

### 3.6 Resume 的语义

**决策：`resume` 默认从最后一个 durable checkpoint 继续；未完成 stage 采用幂等重跑。**

具体规则：

- 如果某 stage 已有完成态与 `STAGE_OUTPUT`，从下一阶段继续
- 如果某 stage 已开始但没有完成态，则从该 stage 起点重跑
- 单独提供 `retry stage` 作为显式操作，不把它混进 `resume`

这样能保证：

- `resume` 语义稳定
- 用户不会因为一次刷新看到“恢复”其实变成“重新开始”

### 3.7 执行审批的安全边界

**决策：默认“审批不等于 dispatch”；审批后先进入 ledger/staging，再根据策略决定 commit/execute。**

默认工业级路径：

1. AI 产出 `orderDrafts`
2. 用户审批
3. 系统生成 `Execution Review Ledger`
4. 先 `stage`
5. 再 `commit`
6. 最后 `execute/dispatch`

自动 dispatch 只在满足策略条件时允许，例如：

- 账户被标记为允许自动执行
- 风险级别低于阈值
- 策略属于预授权范围

这比“Approve 后直接下单”更符合工业级产品边界。

### 3.8 Heartbeat / schedule 的产品定位

**决策：默认定位为研究助理触发器，不默认作为自动交易触发器。**

推荐顺序：

1. schedule / heartbeat 触发 research run
2. run 进入统一 timeline / console
3. 产出 alert、analysis、execution suggestion
4. 是否触发真实执行，由 ledger + policy 决定

换句话说：

- heartbeat 是统一 runtime 的来源之一
- 不是一条绕过审计边界的旁路

## 4. 配套产品形态

以上决策对应的产品形态应当是：

1. `Chat`：发起、观察、轻量承接
2. `Analysis Operator Console`：主工作台
3. `Autonomy`：配置触发条件，不承担 run 详情查看主职责
4. `Trading`：查看真实执行结果，并能反查对应 run 与 ledger

## 5. 实施顺序

### Phase 1: 先修运行时真问题

- 补齐 `pause/resume/cancel/retry` 控制面闭环
- 让 `resume` 真正 re-enqueue
- 让 `finalReportMarkdown / decisionObjectJson / sharedContextJson` 真实落库
- 建立 run timeline SSE

### Phase 2: 建立上下文真相链

- 引入 `ContextJournalService`
- 写入 `COMPACTION_BOUNDARY / COMPACTION_SUMMARY / TOOL_CALL / TOOL_RESULT / STAGE_INPUT`
- 打通 chat -> run lineage

### Phase 3: 让配置真正变成行为

- 引入 `preset`
- 让 `researchDepth` 生效
- 让 `enabledTeams` 真正改变执行图
- 增加 role 级 timeline 与输出摘要

### Phase 4: 完成控制台与执行账本

- Operator Console 四栏视图
- Human-readable artifact 渲染
- Execution Review Ledger
- Trading 反查 run / approval / ledger

## 6. 结论

最优的工业级方向不是“先把 agent 团队做得更炫”，而是：

**先把 context、runtime、control、execution boundary 变成一套可信系统。**

只有这样，FinSentinel 后续无论走：

- 更深的多 agent 协作
- 更强的自治 schedule
- 更自动化的执行

都不会建立在脆弱且不可审计的基础上。
