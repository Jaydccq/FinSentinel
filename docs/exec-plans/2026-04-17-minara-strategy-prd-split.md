# Minara Strategy PRD Split Plan

日期：2026-04-17
状态：Completed
优先级：P1

## Background

用户希望基于 Minara《We Found 21 Money-Makers After Backtesting 236 TradingView Strategies》的方法论，总结出可应用在 FinSentinel 现有代码中的产品机会，并拆成独立 PRD，输出到 `docs/product-specs/`。

仓库当前已具备以下相关基础：

- `apps/api/src/analysis/`：多阶段 analysis run、artifacts、approval、runtime
- `apps/api/src/quant/`：收益、波动、VaR、Sharpe、回撤等量化统计
- `apps/api/src/market/technical-indicators.service.ts`：RSI / EMA / ATR / MACD / Stochastic 等指标基线
- `apps/api/src/trading/` 与 `apps/api/src/okx/`：交易执行、交易所接口、费用字段
- `apps/api/src/autonomy/`：定时与 heartbeat 触发运行
- `apps/web/src/views/AnalysisPage.tsx`：结构化 run 入口

## Goal

形成一组可以直接进入产品排期讨论的独立 PRD，说明 Minara 方法论在 FinSentinel 中最值得落地的模块、现有代码触点、用户价值、非目标、验收标准与推荐建设顺序。

## Scope

包含：

- 盘点当前代码中与策略验证、分析工件、费率、量化统计、自治重跑相关的模块
- 基于 Minara 方法论拆分独立 PRD
- 在 `docs/product-specs/` 新增索引与独立 PRD 文档

不包含：

- 实际代码实现
- 外部文章事实的额外扩展研究
- 回测引擎、Pine 解析器或前端页面的开发

## Assumptions

- 以 Minara 官方文章和公开 TradingView 策略页为事实输入，不额外扩展第三方二手解读
- 目标是“识别仓库中可承接的产品方向”，不是“证明当前仓库已经支持这些能力”
- PRD 以现有 `docs/product-specs/` 风格为准，保持可读、可排期、可继续拆实现计划

## Success Criteria

1. `docs/product-specs/` 中新增 1 份总索引和若干独立 PRD。
2. 每份 PRD 都明确说明可挂接的现有代码区域。
3. 拆分后的 PRD 能覆盖 Minara 方法论中的核心能力，而不是只复述文章结论。
4. 执行计划记录本轮分析过程和最终结果。

## Uncertainties

- 仓库当前没有独立的 strategy/backtest 模块，部分 PRD 需要落在 `analysis / quant / trading / autonomy` 组合上。
- 需要控制 PRD 粒度，避免把高度耦合的能力拆得过碎。

## Simplest Viable Path

1. 阅读现有 product spec、analysis/quant/trading/autonomy 代码，定位承接点。
   Verify: 能列出每个候选方向对应的代码触点。
2. 以 Minara 方法论的 7 个核心模块为主轴进行 PRD 拆分，并补一个总索引。
   Verify: 每个模块都具备独立问题、目标、范围和验收标准。
3. 写入 `docs/product-specs/`，更新本执行计划的进度与结果。
   Verify: 新文档可读、命名清晰、相互链接完整。

## Implementation Steps

1. 审阅现有相关代码和文档。
   Verify: 形成模块映射清单。
2. 确定 PRD 拆分边界与命名。
   Verify: 每份 PRD 对应单一产品能力。
3. 编写总索引与独立 PRD。
   Verify: 文档写入 `docs/product-specs/`。
4. 自查链接、命名和范围。
   Verify: `rg -n "Minara|Strategy" docs/product-specs` 可列出新增文档。

## Verification Approach

- 通过阅读仓库相关模块确认“适用位置”判断有代码依据
- 通过文档自查确认每份 PRD 都有明确边界
- 通过命令检查新增文档是否落在正确目录并可被索引发现

## Progress Log

- 2026-04-17 04:01 ET：读取 `docs/product-specs/`、`docs/exec-plans/` 现有文档，确认仓库已有 product-spec 风格与执行计划要求。
- 2026-04-17 04:05 ET：读取 `analysis / quant / market / trading / autonomy / okx` 相关代码，开始建立 Minara 方法论到当前代码的映射。
- 2026-04-17 04:18 ET：对照查看 Minara 官方文章和多条 Tier 1 策略页，确认可直接吸收的策略模板分为均值回归、波动突破、自适应趋势、反直觉动量、长周期 long-only 五类。
- 2026-04-17 04:28 ET：完成 `docs/product-specs/` 下的总索引与 7 份独立 PRD，补充当前仓库已覆盖指标、缺失指标以及推荐优先级。

## Key Decisions

- 采用“总索引 + 7 个独立 PRD”的结构，对齐用户总结中的 7 个产品模块。
- 现有仓库承接点以 `analysis / quant / market / trading / autonomy` 为主，而不是凭空假设新子系统已存在。

## Risks And Blockers

- 如果 PRD 只复述文章结论而不绑定仓库代码，会失去可执行价值。
- 如果把多个阶段耦合在一份文档里，后续难以独立排期。

## Final Outcome

已新增以下文档：

- `docs/product-specs/2026-04-17-minara-strategy-optimization-index.md`
- `docs/product-specs/2026-04-17-strategy-source-import-and-normalization.md`
- `docs/product-specs/2026-04-17-trade-replication-validator.md`
- `docs/product-specs/2026-04-17-fee-aware-strategy-backtesting.md`
- `docs/product-specs/2026-04-17-strategy-failure-diagnosis.md`
- `docs/product-specs/2026-04-17-strategy-rescue-operator-library.md`
- `docs/product-specs/2026-04-17-strategy-pareto-ranking-and-archive.md`
- `docs/product-specs/2026-04-17-strategy-oos-and-walk-forward-evaluator.md`

本轮结论：

- 现有仓库最适合先落地的是“策略导入 -> 复制验证 -> 费率感知回测”这条主链。
- 现有技术指标基线已足够支撑第一批模板：`Optimized BTC Mean Reversion`、`RSI > 70 Buy`、`50 & 200 SMA + RSI Average`。
- `Keltner` 与 `SuperTrend` 是当前最明确的指标级缺口，对应第二批更强模板：`Volatility Breakout System`、`ETHUSDT 4H - Keltner Breakout`、`SuperTrend AI Adaptive`、`SuperTrend STRATEGY`。
