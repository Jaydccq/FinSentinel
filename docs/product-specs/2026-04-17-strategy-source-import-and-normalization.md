# PRD: 策略源码导入与标准化

日期：2026-04-17
状态：Draft
优先级：P0

## 1. 问题

FinSentinel 现在能做研究 run、量化指标计算和交易执行，但还没有“把外部公开策略变成可计算对象”的入口。

这会导致三个问题：

- 优秀策略只能停留在文章链接和 Pine 代码里，不能进入系统流水线
- 后续复制验证、费用回测、策略改造都没有统一输入
- AI 只能“读描述”，不能对策略结构做稳定推理

Minara 最值得抄的第一步不是优化器，而是把公开 Pine Script 先转成统一内部表示。

## 2. 当前代码落点

- `apps/api/src/market/technical-indicators.service.ts`
  - 已有 RSI、Stochastic、EMA、SMA、ATR、ADX、MACD、Bollinger，可覆盖第一批策略模板
- `apps/api/src/analysis/analysis-run.service.ts`
  - 已有 run / artifact 基础，可承接“导入任务”与解析工件
- `packages/shared/src/schemas/analysis.ts`
  - 已有 `strategyArchivePayload`，可扩展为标准化策略快照的消费出口
- `packages/db/src/schema/analysis-artifacts.ts`
  - 可落地 `NORMALIZED_STRATEGY` 一类 artifact
- `apps/web/src/views/AnalysisPage.tsx`
  - 可作为 Strategy Studio 的一期入口壳
- `apps/api/src/agent/agent-brain.service.ts`
  - 可承接用户保留的“当前主策略摘要”，但不适合作为策略库本身

## 3. 目标

新增一个策略导入层，把 TradingView 开源脚本或手工粘贴的策略描述转成统一 DSL，至少抽出：

- 市场与周期
- 指标集合
- 入场条件
- 出场条件
- 风控规则
- position sizing
- 费用/滑点假设
- 来源元数据
- 无法解析或缺失的部分

## 4. 非目标

- 一期不做完整 Pine Script 解释器
- 不做私有脚本抓取
- 不在一期做自动优化
- 不在一期承诺 100% 覆盖所有 Pine 特性

## 5. 设计原则

### 5.1 先覆盖高价值、低复杂模板

优先支持仓库现有指标已覆盖的策略：

- `Optimized BTC Mean Reversion (RSI 20/65)`：RSI + Stochastic + EMA
- `RSI > 70 Buy`：RSI 动量延续
- `50 & 200 SMA + RSI Average`：SMA + RSI + single-trade

### 5.2 缺失指标必须显式暴露

像下面这些策略不应“假装支持”：

- `Volatility Breakout System` / `ETHUSDT 4H - Keltner Breakout`：当前缺 `Keltner`
- `SuperTrend AI Adaptive` / `SuperTrend STRATEGY`：当前缺 `SuperTrend`

导入器必须输出：

- 已成功标准化的结构
- 缺失的指标或 Pine 特性
- 是否允许进入下一步复制验证

### 5.3 标准化对象优先于自然语言摘要

系统主输入应是结构化 DSL；人类可读摘要是附属工件。

## 6. 产品流程

1. 用户提交 TradingView URL、Pine 代码或手工策略描述。
2. 系统识别来源类型。
3. 解析出策略 DSL。
4. 输出：
   - 标准化策略对象
   - 解析摘要
   - 缺失能力列表
   - 可继续动作：复制验证 / 等待人工补全 / 阻塞
5. 用户确认后，策略进入后续验证流水线。

## 7. 核心输出

建议至少生成以下对象：

- `normalizedStrategy`
- `indicatorCoverage`
- `unsupportedConstructs`
- `sourceProvenance`
- `humanReadableSummary`

其中 `indicatorCoverage` 要明确分成：

- `coveredByCurrentEngine`
- `requiresNewIndicator`
- `requiresManualRewrite`

## 8. 与优秀策略的直接对应

### 8.1 第一批应优先导入的模板

- 低频均值回归：`Optimized BTC Mean Reversion`
- 反直觉动量：`RSI > 70 Buy`
- 长周期 long-only：`50 & 200 SMA + RSI Average`

### 8.2 第二批应在补指标后支持

- 波动突破：`Volatility Breakout System`
- 低维护突破：`ETHUSDT 4H - Keltner Breakout`
- 自适应趋势：`SuperTrend AI Adaptive`
- 极低频趋势：`SuperTrend STRATEGY`

## 9. 验收标准

1. 用户可以提交外部公开策略并得到结构化 DSL。
2. 系统能正确标出“当前已有指标覆盖”和“当前缺失指标”。
3. 至少三类现有已覆盖模板可以无人工改写完成标准化。
4. 无法解析的 Pine 特性不会被静默忽略，而会进入阻塞或人工补全状态。
5. 标准化结果可以作为后续复制验证的唯一输入。

## 10. 风险

- 如果导入器直接输出“模糊总结”，后续复制验证会失真。
- 如果缺失指标被静默降级，系统会误以为自己已经支持某条策略。
