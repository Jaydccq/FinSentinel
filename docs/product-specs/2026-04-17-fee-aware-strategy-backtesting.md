# PRD: 费率感知回测与执行成本模型

日期：2026-04-17
状态：Draft
优先级：P0

## 1. 问题

FinSentinel 现在已经有订单草案、交易所回执和 OKX 费用字段，但系统核心分析链路仍然没有把“净收益是否还能成立”当成一级判断标准。

Minara 文章最明确的一点是：

- 毛收益不等于可交易收益
- 高频薄利在真实费率下会迅速失真
- 策略类别不是第一杀手，交易频次才是

## 2. 当前代码落点

- `apps/api/src/okx/interfaces/okx-types.ts`
  - 已有 `fee`、`feeCcy`
- `apps/web/src/api/okx.ts`
  - 前端已消费订单与费用字段
- `packages/shared/src/schemas/order-draft.ts`
  - 已有 `maxSlippageBps`
- `apps/api/src/trading/`
  - 已有 broker-neutral order draft 与执行映射
- `apps/api/src/analysis/`
  - 可把 gross/net 双结果写为 artifact

## 3. 目标

建立一个成本模型，把策略回测默认拆成两层：

1. `gross edge`：零费用、零滑点，验证逻辑本身是否有 edge
2. `net edge`：带 venue fee、成交方式、滑点假设，验证 edge 是否能活下来

## 4. 非目标

- 一期不做 L2 订单簿回放
- 不做部分成交与冲击成本的精细撮合
- 不把该模块和真实下单引擎耦死

## 5. 为什么这件事现在就适合做

### 5.1 现有项目已经有“成本语义碎片”

- OKX 订单模型里已经有 fee
- order draft 已经有 slippage limit
- analysis run 已经有 artifact 与 decision object

缺的是把这些碎片提升成统一的策略评分函数。

### 5.2 优秀策略本身就在强调真实成本

`SuperTrend AI Adaptive` 的策略页已经把这件事写进默认参数：

- commission：0.06%
- slippage：2 ticks

这说明优秀策略作者自己也在把真实交易摩擦当作策略结构的一部分，而不是“回测结束后再补一嘴”。

## 6. 产品行为

每个策略至少输出两组结果：

- `grossMetrics`
- `netMetrics`

其中 `netMetrics` 至少包括：

- net APR
- fee drag
- estimated slippage drag
- annual trade count
- per-trade average edge

## 7. 优秀策略给出的直接产品启发

### 7.1 低频胜过薄利高频

应把以下指标放在一级面板：

- 每年交易笔数
- 每笔平均收益
- round-trip 成本占单笔 edge 的比例

### 7.2 不能只看胜率

像 `RSI > 70 Buy`、`SuperTrend AI Adaptive` 这类策略说明：

- 低胜率不代表不能活
- 只要单笔盈亏比大，仍能覆盖成本

所以评分面板必须展示：

- win rate
- profit factor
- average winner / average loser

## 8. 验收标准

1. 每条通过复制验证的策略都能输出 gross / net 两套结果。
2. 策略页默认展示 `fee drag`，而不是把费用藏在明细里。
3. 系统能按 venue profile 切换费率假设。
4. 交易频次和单笔 edge 会进入主排序信号。
5. 策略即使毛收益高，只要净收益转负，系统也会降级或阻塞。

## 9. 风险

- 如果系统只显示毛收益，用户会被高频薄利策略误导。
- 如果 venue profile 不显式建模，策略结果会对实际执行场地失真。
