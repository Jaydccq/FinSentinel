# PRD: 逐笔复制验证与分级

日期：2026-04-17
状态：Draft
优先级：P0

## 1. 问题

当前仓库已经能算收益、波动、Sharpe 和回撤，但还不能回答一个更基础的问题：

“我们重建出来的策略，和原始 TradingView 回测到底是不是同一个东西？”

如果这一层不成立，后面的优化、排名、风险比较都会变成假工作。

Minara 的核心启发不是“236 个脚本里谁最强”，而是“严格复制后只剩很少一部分值得继续看”。

## 2. 当前代码落点

- `apps/api/src/quant/quant-analysis.service.ts`
  - 当前只有价格序列统计，没有 trade ledger 级指标
- `apps/api/src/market/technical-indicators.service.ts`
  - 已有多数一批策略所需指标，可作为复制基线
- `apps/api/src/analysis/analysis-run.service.ts`
  - 已有 run / stage / artifact / approval 基础
- `packages/db/src/schema/analysis-artifacts.ts`
  - 可承接复制报告、差异账本、grade
- `packages/shared/src/schemas/analysis.ts`
  - 可新增 replication artifact 的结构化消费契约

## 3. 目标

新增“复制验证器”，对标准化后的策略进行逐笔对齐验证，并输出分级。

至少支持：

- 同方向匹配
- 开仓价容差
- 平仓价容差
- 总交易数偏差约束
- PnL 偏差约束
- grade A / B / FAIL

## 4. 非目标

- 一期不做逐 tick 订单簿级复制
- 不做真实成交模拟
- 不做自动策略改写

## 5. 产品行为

### 5.1 复制验证是硬门槛

只有通过复制验证的策略，才允许进入：

- 费率感知回测
- 结构诊断
- 自动改造
- 排行与归档

### 5.2 输出不是一句 pass/fail

验证器必须输出：

- `matchRate`
- `tradeCountDelta`
- `entryPriceDeviation`
- `exitPriceDeviation`
- `pnlDivergence`
- `grade`
- `blockingReasons`

### 5.3 需要可检查的差异账本

最重要的 artifact 不是总分，而是逐笔差异账本：

- 哪一笔没有对上
- 哪一笔方向对了但价格偏差大
- 哪一笔是总交易数差异带来的

## 6. 与优秀策略的直接对应

### 6.1 第一批适合做复制验证基线的策略

- `Optimized BTC Mean Reversion`
- `RSI > 70 Buy`
- `50 & 200 SMA + RSI Average`

原因：

- 这三类模板的核心指标在现有仓库里已具备
- 适合先验证“复制框架是否稳定”

### 6.2 第二批用于拉高复制难度

- `SuperTrend STRATEGY`
- `Volatility Breakout System`

原因：

- 分别考验 `SuperTrend` 与 `Keltner` 指标基线
- 更容易暴露“我们以为支持，实际并未严格复现”的问题

## 7. 分级建议

- A：高匹配，可继续进入净收益回测与归档
- B：基本对齐，可进入人工复核或低置信后续流程
- FAIL：禁止继续优化

分级阈值一期应可配置，但默认必须偏严格。

## 8. 验收标准

1. 每条导入策略都可以产出 replication report。
2. 系统能明确区分 A / B / FAIL。
3. 未通过复制的策略不会继续进入自动优化链路。
4. 用户可以查看逐笔差异，而不是只看一个总分。
5. 第一批策略模板可以稳定跑完完整复制流程。

## 9. 风险

- 如果复制验证只做总收益对比，系统会误把“看起来差不多”的错误实现当成正确实现。
- 如果没有逐笔差异账本，团队无法定位问题到底出在指标、下单时点还是退出逻辑。
