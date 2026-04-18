# Minara 策略优化落地拆解

日期：2026-04-17

## 背景

这轮不是单纯“抄 21 个脚本”，而是把 Minara 的两层价值拆出来：

1. 方法论：先复制验证，再扣真实费率，再决定调参还是重写。
2. 模板库：优秀策略背后有一组重复出现的结构模式，可以直接变成 FinSentinel 的产品能力。

我对照查看了 Minara 官方文章和多条 Tier 1 策略页，确认最值得吸收的不是某个单一指标，而是以下共性：

- 低频均值回归也能很强，但必须带趋势过滤和确认过滤
- 波动突破要和趋势强度过滤一起看，不能只看突破
- 趋势跟随真正有用的是 regime filter、cooldown、ATR 风控，而不是“单个 SuperTrend 指标”
- 很多好策略胜率不高，但 profit factor 和单笔盈亏比足够覆盖费率
- 多数结果仍偏样本内，必须补 OOS / walk-forward

## 已确认的代码承接点

以下现有模块已经可以承接这批能力：

- `apps/api/src/analysis/`：run、stage、artifact、approval、operator console 基础
- `apps/api/src/quant/quant-analysis.service.ts`：年化收益、波动、Sharpe、回撤
- `apps/api/src/market/technical-indicators.service.ts`：RSI、Stochastic、EMA、SMA、ATR、ADX、MACD、Bollinger、OBV
- `apps/api/src/trading/` + `apps/api/src/okx/`：订单草案、执行约束、费用字段、交易所回执
- `apps/api/src/autonomy/`：schedule / heartbeat / analysis runtime trigger
- `packages/shared/src/schemas/analysis.ts`：已有 `strategyArchivePayload`
- `packages/db/src/schema/analysis-artifacts.ts`：可承接策略级 artifact

同时也确认了几个关键缺口：

- 还没有策略 DSL / Pine 导入层
- 还没有逐笔复制验证与 trade diff ledger
- 还没有费率感知回测层
- 还没有 `profit factor / trade count / fee drag / OOS` 这些策略排序核心指标
- 还没有 Keltner / SuperTrend 这两个和文章高度相关的指标基线

## 优秀策略里最值得直接转成产品模板的 5 类模式

### 1. 低频均值回归 + 趋势过滤

代表策略：

- [Optimized BTC Mean Reversion (RSI 20/65)](https://www.tradingview.com/script/pIrgsDpT-Optimized-BTC-Mean-Reversion-RSI-20-65/)

已知结构：

- RSI 极值触发
- Stochastic 二次确认
- 200 EMA 趋势过滤

这类模板对 FinSentinel 很友好，因为现有指标服务已经全覆盖。

### 2. 波动突破 + 趋势强度过滤

代表策略：

- [Volatility Breakout System [Fixed Risk]](https://www.tradingview.com/script/36zwwSMa-Volatility-Breakout-System-Fixed-Risk/)
- [ETHUSDT 4H - Keltner Breakout](https://www.tradingview.com/script/LmNV3ZLN/)

已知结构：

- Keltner breakout 触发
- 200 EMA 方向过滤
- ADX 趋势强度过滤

这类模板的产品价值高，但仓库当前缺 `Keltner` 指标实现。

### 3. 自适应趋势跟随

代表策略：

- [SuperTrend AI Adaptive - Strategy [BTC]](https://www.tradingview.com/script/kZVrTReu-SuperTrend-AI-Adaptive-Strategy-BTC/)
- [SuperTrend STRATEGY](https://www.tradingview.com/script/VLRj2sG9-SuperTrend-STRATEGY/)

已知结构：

- SuperTrend / ATR 核心趋势框架
- EMA 趋势过滤
- ADX / volume / ranging skip / cooldown
- ATR 止损、RR 止盈、真实 commission + slippage 假设

这类模板说明“策略重心不在入场信号本身，而在 regime + risk model”。

### 4. 反直觉动量延续

代表策略：

- [RSI > 70 Buy / Exit on Cross Below 70](https://www.tradingview.com/script/wZIdSrBG/)

已知结构：

- RSI 大于 70 反而做多
- RSI 跌回 70 下方立即退出

这类模板特别适合训练系统不要把“超买=做空”当成硬编码教条。

### 5. 长周期、低频、long-only 过滤器

代表策略：

- [50 & 200 SMA + RSI Average Strategy (Long Only, Single Trade)](https://www.tradingview.com/script/1x2AawHf-50-200-SMA-RSI-Average-Strategy-Long-Only-Single-Trade/)
- [SuperTrend STRATEGY](https://www.tradingview.com/script/VLRj2sG9-SuperTrend-STRATEGY/)

已知结构：

- 单标的长期正漂移下，long-only + 少交易 + 单笔持有
- 目标不是交易很多，而是过滤弱势区间

这类模板非常适合和 `autonomy` 的周期重验联动。

## 最快能在当前仓库落地的模板优先级

### 第一批：现有指标已覆盖

- Optimized BTC Mean Reversion
- RSI > 70 Buy
- 50 & 200 SMA + RSI Average

原因：

- 现有 `technical-indicators.service.ts` 已有 RSI / EMA / SMA / ATR / Stochastic / ADX / Bollinger
- 不需要先补 Keltner / SuperTrend

### 第二批：需要补指标基线

- Volatility Breakout System
- ETHUSDT 4H - Keltner Breakout
- SuperTrend AI Adaptive
- SuperTrend STRATEGY

原因：

- 这些策略的产品价值很高，但依赖 `Keltner` 或 `SuperTrend`

## PRD 拆分

1. [策略源码导入与标准化 PRD](./2026-04-17-strategy-source-import-and-normalization.md)
2. [逐笔复制验证与分级 PRD](./2026-04-17-trade-replication-validator.md)
3. [费率感知回测与执行成本模型 PRD](./2026-04-17-fee-aware-strategy-backtesting.md)
4. [策略结构诊断器 PRD](./2026-04-17-strategy-failure-diagnosis.md)
5. [策略改造算子库 PRD](./2026-04-17-strategy-rescue-operator-library.md)
6. [多目标排序与策略归档 PRD](./2026-04-17-strategy-pareto-ranking-and-archive.md)
7. [样本外与 Walk-Forward Runtime PRD](./2026-04-17-strategy-oos-and-walk-forward-evaluator.md)

## 推荐顺序

- P0：策略源码导入与标准化
- P0：逐笔复制验证与分级
- P0：费率感知回测与执行成本模型
- P1：多目标排序与策略归档
- P1：样本外与 Walk-Forward Runtime
- P1：策略结构诊断器
- P2：策略改造算子库

## 直接结论

对 FinSentinel 来说，优秀策略最该“运用到项目中”的方式不是先建一个回测排行榜，而是先把这三件事做扎实：

1. 让外部策略能被标准化导入。
2. 让系统知道自己是否真的复制对了。
3. 让所有收益判断默认以净收益和成本拖累为准。

只有这三件事成立，后面的诊断、改造、Pareto 排名和周期重验才不是建立在假信号上。
