# PRD: 多目标排序与策略归档

日期：2026-04-17
状态：Draft
优先级：P1

## 1. 问题

FinSentinel 现在已经有 `strategyArchivePayload` 这个消费位，但没有真正的策略级排序和归档产品。

这会导致两个问题：

- 系统即使未来能跑出多个策略，也只能粗暴按收益排序
- 用户无法在“高收益、高回撤”和“中收益、低维护”之间做清晰选择

Minara 文章已经非常明确地展示：

- APR 排名和 Sharpe 排名不是一回事
- 胜率和可交易性也不是一回事
- 一些极低频策略虽然收益高，但回撤体验非常差

## 2. 当前代码落点

- `packages/shared/src/schemas/analysis.ts`
  - 已有 `strategyArchivePayload`
- `packages/db/src/schema/analysis-artifacts.ts`
  - 已有归档 artifact 容器
- `apps/api/src/quant/quant-analysis.service.ts`
  - 已有 Sharpe、回撤、波动，但还缺 `profit factor / trade count / fee drag`
- `apps/web/src/views/AnalysisPage.tsx`
  - 已有 artifact 阅读入口

## 3. 目标

建立一个策略级排序与归档层，默认不输出“唯一最优策略”，而输出 Pareto 风格的候选集。

一期主指标至少包括：

- APR
- Sharpe
- max drawdown
- profit factor
- trade count
- fee drag
- sample size

## 4. 非目标

- 不做公开社区排行榜
- 不在一期做社交功能
- 不把归档和真实执行强绑定

## 5. 优秀策略给出的排序启发

### 5.1 高 APR 不代表最好持有

`SuperTrend STRATEGY` 这类低频趋势策略说明：

- 可能只有极少交易
- 但回撤体验可能极端

### 5.2 低胜率也可能是高质量策略

`RSI > 70 Buy`、`SuperTrend AI Adaptive` 说明：

- win rate 不能单独排序
- 更该看 profit factor 和 Sharpe

### 5.3 高胜率薄利策略必须暴露样本和风险

`BB Upper Breakout Short +2%` 说明：

- 100% 胜率很抓眼球
- 但样本量、深回撤、资产依赖都要一起展示

## 6. 产品行为

系统至少给出三种默认视图：

- `Return Max`：高收益优先
- `Balanced`：风险调整后最优
- `Low Maintenance`：低频、少交易、可运维性优先

每条策略归档至少包含：

- 标准化策略定义
- 复制分级结果
- gross / net 回测结果
- OOS 状态
- 诊断标签
- 被选中或被拒绝原因

## 7. 与现有 workspace 的结合方式

最自然的产品形态不是另开一个完全独立页面，而是：

- analysis workspace 内增加策略候选切换
- artifact panel 支持读取策略归档对象
- final report 支持输出“为什么推荐这个 Pareto 点”

## 8. 验收标准

1. 系统能同时展示多个候选策略，而不是只输出一个冠军。
2. 排名默认包含风险调整指标，而不是只看 APR。
3. 用户能一眼看到 trade count、fee drag、sample size。
4. 每个已归档策略都有清晰的被选中/被拒绝理由。

## 9. 风险

- 如果只按 APR 排序，用户会被高回撤或高脆弱性策略误导。
- 如果没有归档层，后续很难复用“曾经看过但没采用”的策略版本。
