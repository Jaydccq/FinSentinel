# PRD: RAG 融合权重、Metadata 下沉与 Shadow Runner 信号化

日期：2026-04-23
状态：Draft
优先级：P1

## 1. 问题

RAG 子系统已经做到 multi-stage（query plan → variant fan-out → soft/hard prefilter → dense + sparse + graph → fusion → rerank → shadow eval）。再上一档质量需要解决三处仍未补齐的细节：

1. **变体权重未进入融合**：`QueryVariant.weight` 字段已经预留，注释也写了「Reserved for future RRF per-variant weighting. Default 1.0」，但 `RetrievalFusionService.fuse()` 的实际公式仍是纯 RRF（`1 / (k + rank + 1)`）。
2. **Metadata 下沉不完整**：`MetadataPreFilterService` 注释明确写出 `sectors[]` / `regions[]` 当前被 discard，等待 R4.3 落 SQL；`tickers` / `issuerName` 已被填充但下游 SQL 还没消费（参 [RAG-TD-R4-01]）。
3. **Shadow Runner 用 5ms 轮询占槽**：`waitForSlot()` 用 `while (this.inflight >= concurrency) await sleep(5)`，会带来不必要的 CPU 抖动，并影响指标的可解释性。

## 2. 当前代码落点

- `apps/api/src/rag/retrieval-fusion.service.ts:20-21`（QueryVariant.weight 定义）
- `apps/api/src/rag/retrieval-fusion.service.ts:28-72`（fuse 实现，未读 weight）
- `apps/api/src/rag/metadata-pre-filter.service.ts:30-31, 77-80, 95`（注释承认未下沉）
- `apps/api/src/rag/shadow-runner.service.ts:51-55`（轮询 sleep）

## 3. 目标

1. fusion 公式可以读取 `QueryVariant.weight`，且默认行为与现状一致。
2. `sectors`、`regions`、`tickers`、`issuerName` 在能下沉的阶段全部下沉到 SQL 过滤，不再在结果集后端做 secondary filter。
3. Shadow Runner 用信号量 / mutex / queue 实现 slot 控制，移除 5ms polling。
4. 不破坏 `RAG_EVAL_RUNNER_ENABLED` 开关与现有 golden eval 报告。

## 4. 非目标

- 不更换 embedding 模型或 reranker。
- 不引入新的 retrieval lane（dense/sparse/graph 三通道结构保留）。

## 5. 方案

### 5.1 Weighted RRF

```ts
const w = variant.weight ?? 1;
contribution[docId] += w * (1 / (k + rank + 1));
```

- 增加单测：weight=0 应使该 variant 完全不影响排序；weight=2 与同 variant 重复一次的近似等价。
- query planner 在生成 paraphrase / decomposition 变体时填入 weight；初版可以走简单规则（同义改写 0.7、关键词扩张 1.0、否定改写 0.5）。

### 5.2 Metadata 下沉

**决议（codex consult 2026-04-23）：sector / region 默认走 SOFT 过滤，提升匹配文档在 fusion 中的得分但不排除其它候选；通过 `strict_metadata=true` 策略开关切到 HARD。**

- `SparseSearchFilters` 增补 `sector?: string[]`, `regionId?: string[]`, `tickers?: string[]`，并标记 `mode: 'soft' | 'hard'`。
- `MetadataPreFilterService` 把 `ExtractedEntities.sectors / regions / tickers / issuerName` 映射进 filter：
  - **默认 soft**：在 fusion 阶段为命中文档加权（建议初始权重 1.5），不剔除未命中文档。
  - **`strict_metadata=true`**：用户/调用方显式声明高精度场景时（合规筛查、事件级影响分析），切换为 SQL `WHERE sector = ANY($1) AND region_id = ANY($2)`，召回换精度。
- 查询响应里附 `metadataDiagnostics`：列出推断到的 sector/region、应用的 mode、被加权 / 被排除的候选数量，方便用户理解为何某些文档没出现。
- 用 30 题 golden 评测同时跑 soft-default 和 strict-default，结果纳入 release notes，但生产默认仍偏召回。
- DB 层在 `representations` / `documents` 上保证已有这些列的索引；缺索引的列给出 V 编号迁移。

### 5.3 Shadow Runner Semaphore

```ts
class Semaphore {
  private waiters: Array<() => void> = [];
  constructor(private slots: number) {}
  async acquire() {
    if (this.slots > 0) { this.slots--; return; }
    await new Promise<void>(resolve => this.waiters.push(resolve));
  }
  release() {
    const w = this.waiters.shift();
    if (w) w(); else this.slots++;
  }
}
```

`waitForSlot` / `releaseSlot` 改用上述 `Semaphore.acquire/release`，彻底删掉 polling sleep。

## 6. 验收标准

1. fusion 单测：注入两个变体（weight 1 vs 2），结果排序符合期望；weight 缺省时与升级前结果二进制一致。
2. metadata 单测：构造含 sector=Tech、region=US 的 query，SQL 计划里出现对应过滤；下游候选集减少 ≥ 30%（在评测语料上）。
3. shadow runner：在 concurrency=4 + 100 req 测试下，没有任何 5ms 等待循环；CPU 时间相比当前版本下降，且 p95 等待时间不上升。
4. `RAG_EVAL_RUNNER_ENABLED=true` 跑现有 golden 集，nDCG@10 不下降；带 sector/region 标签的子集 recall 上升。

## 7. 风险

- weighted RRF 可能放大某些低质 paraphrase 的影响，需要在 query planner 端约束 weight 范围（建议 [0, 2]）。
- sector/region SQL 下沉会让原本能命中的弱标注文档被过滤，可通过 hard vs soft 两层分级缓解。
- Semaphore 替换是行为正确性敏感操作，必须先在 shadow 环境验证一周再全量。
