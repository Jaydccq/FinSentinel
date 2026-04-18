# PRD: 策略改造算子库

日期：2026-04-17
状态：Draft
优先级：P2

## 1. 问题

FinSentinel 现在有技术指标工具，但没有“可组合的策略改造动作空间”。

没有算子库时，AI 优化只能退化成两种低价值模式：

- 瞎调参数
- 写一段听起来合理但不可复用的自然语言建议

Minara 的优化案例最值得学的地方，是把“为什么改”和“具体改了哪些结构”说得非常离散、可复用。

## 2. 当前代码落点

- `apps/api/src/analysis/teams/role-executor.service.ts`
  - 已有 planner/builder 风格的角色执行模型
- `apps/api/src/analysis/teams/execution-prep-team.service.ts`
  - 现成体现了“先 plan 再 build 再 validate”的 team pattern
- `apps/api/src/market/technical-indicators.service.ts`
  - 已支持多数算子所需指标基础：ATR、EMA、RSI、ADX、Bollinger
- `packages/db/src/schema/analysis-artifacts.ts`
  - 可记录 operator branch 结果和被拒绝分支

## 3. 目标

建立一组有限、可解释、可审计的策略改造算子，供 AI 在诊断之后调用。

一期优先支持：

- `RAISE_TIMEFRAME`
- `ADD_ATR_STOP_LOSS`
- `ADD_ATR_TAKE_PROFIT`
- `ADD_TRAILING_STOP`
- `ADD_TREND_FILTER`
- `ADD_ADX_REGIME_FILTER`
- `ADD_COOLDOWN`
- `BOUND_RSI_ENTRY_RANGE`
- `CONVERT_TO_LONG_ONLY`
- `LIMIT_SINGLE_POSITION`

## 4. 非目标

- 一期不做全自动无约束代码改写
- 不做超大规模参数网格搜索
- 不把所有 Pine 语法操作暴露成低层原语

## 5. 优秀策略和 Rescue 案例给出的直接算子

### 5.1 来自优秀策略模板

- `Optimized BTC Mean Reversion`：RSI + Stochastic + EMA trend filter
- `Volatility Breakout System`：Keltner breakout + 200 EMA + ADX
- `SuperTrend AI Adaptive`：trend filter + volume filter + cooldown + ATR risk
- `50 & 200 SMA + RSI Average`：single-trade + long-only + higher timeframe

### 5.2 来自 Minara Rescue 案例

- 固定止损/止盈 -> ATR 缩放风控
- 增加 trailing stop
- EMA 方向过滤后，再加 ADX 趋势强度过滤
- RSI 动量不再只看阈值，而是限制在有效区间
- 直接放弃低质量高频骨架，升周期重写

## 6. 产品原则

### 6.1 算子必须有“适用前提”

例如：

- `ADD_COOLDOWN` 只对过度重入策略有效
- `CONVERT_TO_LONG_ONLY` 只适用于长期正漂移或不允许做空的执行场地
- `ADD_ATR_STOP_LOSS` 只在已有高低收数据且波动结构稳定时生效

### 6.2 算子输出必须保存 rejected branches

Minara 的经验很重要：

- 不只是保留“最后那个版本”
- 还要保存“试过但被否决的版本”

这对后续模型学习和人工复盘都很关键。

### 6.3 AI 决策不应直接跨越算子边界

系统应先选 operator，再产出 branch，再比较结果。
不要允许模型直接黑盒“改出一个新脚本”。

## 7. 产品流程

1. 诊断器输出主因与推荐方向。
2. Optimizer 选 1 到 N 个候选算子。
3. 系统生成多个 branch。
4. 每个 branch 重新跑复制 / 回测 / 费用模型。
5. 保留结果更优的 branch，同时归档 rejected branches。

## 8. 验收标准

1. 系统一期至少支持 8 个以上离散算子。
2. 每个算子都有适用前提和预期效果说明。
3. 每次改造都能保存 before / after 指标对比。
4. rejected branches 会进入持久化归档。

## 9. 风险

- 如果没有算子边界，优化器会重新退化成 prompt 驱动的黑盒代码生成。
- 如果 rejected branches 不保存，系统会重复尝试同类坏方向。
