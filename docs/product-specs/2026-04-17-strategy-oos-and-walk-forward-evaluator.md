# PRD: 样本外与 Walk-Forward Runtime

日期：2026-04-17
状态：Draft
优先级：P1

## 1. 问题

FinSentinel 现在已经有 `schedule`、`heartbeat` 和 `analysis runtime trigger`，但这些能力还没有用在“策略会不会随着时间衰减”这件事上。

而 Minara 文章自己也明确承认：

- 多数优化结果仍偏样本内
- 只有个别案例做了 holdout
- 真正的产品壁垒在于持续重验，不在于一次性找出榜单

## 2. 当前代码落点

- `apps/api/src/autonomy/schedule-runtime.service.ts`
  - 已能定时触发 analysis run
- `apps/api/src/autonomy/heartbeat-runtime.service.ts`
  - 已有周期型唤醒机制
- `apps/api/src/autonomy/analysis-runtime-trigger.service.ts`
  - 已能把自治任务转成 analysis run
- `apps/api/src/analysis/analysis-run.service.ts`
  - 已有历史 run 记录与 artifact
- `packages/db/src/schema/agent-schedules.ts`
  - 已有 schedule 持久化承接点

## 3. 目标

建立一个策略重验 runtime，把已归档策略按周期重新跑：

- holdout test
- walk-forward test
- rolling window revalidation
- edge decay detection

## 4. 非目标

- 一期不做全自动实盘切换
- 不把失败策略自动改成真实仓位调整
- 不做超高频分钟级回放

## 5. 核心产品逻辑

### 5.1 “一次通过”不等于“持续有效”

每条策略都要有一个 `validation status`：

- `IN_SAMPLE_ONLY`
- `HOLDOUT_PASSED`
- `WALK_FORWARD_STABLE`
- `DEGRADING`
- `FAILED_REVALIDATION`

### 5.2 重验必须走 runtime，而不是手工点按钮

最适合复用现有 `autonomy` 能力：

- 每周 / 每月跑一次
- 市场 regime 明显变化时触发一次
- drawdown 或 fee drag 超阈值时触发一次

### 5.3 结果必须能形成告警

不是只把新报告存起来，而是至少给出：

- edge 是否衰减
- 哪个指标先坏掉
- 是否建议降级归档状态

## 6. 与优秀策略的直接对应

### 6.1 低频 long-only 策略最适合做周期重验

- `50 & 200 SMA + RSI Average`
- `SuperTrend STRATEGY`

因为它们本来就是长周期、低维护、少交易，更适合 schedule 化重验。

### 6.2 高依赖 regime 的策略必须做 rolling window

- `SuperTrend AI Adaptive`
- `Volatility Breakout System`

因为这类策略对趋势环境和波动环境更敏感。

## 7. 验收标准

1. 已归档策略可以绑定周期性重验计划。
2. 系统能记录 `validation status` 的状态迁移。
3. OOS / walk-forward 结果会进入 artifact 与归档对象。
4. 当策略出现显著退化时，系统能发出重验失败告警。

## 8. 风险

- 如果没有持续重验，策略库会很快退化成历史最佳截图库。
- 如果重验结果不改变归档状态，系统会失去决策意义。
