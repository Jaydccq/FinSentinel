# PRD: 策略结构诊断器

日期：2026-04-17
状态：Draft
优先级：P1

## 1. 问题

FinSentinel 现在可以做分析 run，也能算部分风险指标，但还没有一个系统能在策略失败时说清楚：

- 是复制没对齐
- 还是费率把 edge 吃掉了
- 还是止损/止盈结构有问题
- 还是在震荡区过度交易
- 还是方向偏置错误

没有这一层，系统只能输出“结果不好”，不能进入可操作的下一步。

## 2. 当前代码落点

- `apps/api/src/analysis/teams/role-executor.service.ts`
  - 已有多角色结构和 role-scoped tool execution
- `apps/api/src/analysis/contracts/role-tool-scope.ts`
  - `MARKET_ANALYST` 已能访问 RSI、EMA、ATR、ADX、Bollinger 等指标工具
- `apps/api/src/quant/quant-analysis.service.ts`
  - 可提供 Sharpe / drawdown 等风险基础
- `apps/api/src/analysis/analysis-run.service.ts`
  - 可保存诊断 artifact
- `packages/db/src/schema/analysis-artifacts.ts`
  - 适合持久化 `diagnosis report`

## 3. 目标

新增一个结构诊断器，把失败策略转成“可执行问题分类”。

一期至少支持以下主因标签：

- `REPLICATION_MISMATCH`
- `FEE_DRAG`
- `OVERTRADING`
- `POOR_EXIT_STRUCTURE`
- `REGIME_MISMATCH`
- `DIRECTIONAL_BIAS_ERROR`
- `THIN_PER_TRADE_EDGE`
- `SAMPLE_TOO_SMALL`

## 4. 非目标

- 一期不直接改写策略
- 不替代复制验证或回测本身
- 不做全自动交易建议

## 5. 优秀策略给出的诊断维度

### 5.1 高胜率并不自动代表高质量

`BB Upper Breakout Short +2%` 说明：

- 100% 胜率也可能成立
- 但样本可能偏小，且 drawdown 可能很深

系统必须能同时给出：

- `WIN_RATE_PROFILE`
- `SAMPLE_QUALITY`
- `MAX_DRAWDOWN_RISK`

### 5.2 低胜率也不应被误杀

`RSI > 70 Buy`、`SuperTrend AI Adaptive` 说明：

- 胜率低不代表坏策略
- 关键是 profit factor、单笔盈亏结构、费后净 edge

### 5.3 很多失败不是“入场没 edge”，而是退出太差

Minara 的 Rescue 4 直接指出：

- 动量入场有 edge
- 但没有退出逻辑，导致赢利回吐

所以诊断器必须把“entry edge”和“exit structure”分开判定。

## 6. 产品行为

每次失败诊断至少输出：

- `primaryCause`
- `contributingFactors`
- `confidence`
- `evidence`
- `recommendedNextStep`

`recommendedNextStep` 只允许三类：

- `STOP`：不要继续优化
- `REPLICATE_FIRST`：先修复制问题
- `TRY_OPERATORS`：可进入结构改造

## 7. 与现有 runtime 的结合方式

最合适的落点是：

- 作为复制验证与净收益回测之后的独立 stage
- 输出诊断 artifact
- 为后续 operator library 提供输入

它不应直接嵌在聊天输出里，而应成为 analysis workspace 可查看的结构化工件。

## 8. 验收标准

1. 每条失败策略都能得到一个主因标签，而不是“结果差”。
2. 系统能区分“复制没对上”和“策略逻辑本身没净 edge”。
3. 诊断结果可以直接喂给后续 operator library。
4. 用户能看到证据链，而不是黑盒结论。

## 9. 风险

- 如果诊断器只用自然语言总结，后续自动化模块无法消费。
- 如果主因标签定义不清，系统会把本应停止的策略继续送进优化器。
