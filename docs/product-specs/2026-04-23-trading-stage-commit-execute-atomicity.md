# PRD: 交易 Stage / Commit / Execute 原子化与业务级幂等

日期：2026-04-23
状态：Draft
优先级：P0

## 1. 问题

`UnifiedTradingService` 的 git-like 三段流程（stage → commit → execute）当前在 Redis 上以多步独立操作实现，存在两类相互独立但都会影响正确性的缺陷：

1. **race window**：`commit()` 在 `getStagingArea()` 与 `clearStagingArea()` 之间没有任何互斥手段，期间任何并发 `stage()` 写入都会被随后的 `del` 静默清除。
2. **commit hash 失去业务幂等性**：hash 输入包含 `new Date().toISOString()`，同一笔业务委托如果被客户端重试（例如网络抖动），会得到不同的 commit hash，无法触发 `execute()` 端的重复检测。

`execute()` 使用 `GETDEL` 来读取 pending key，已经做到了 commit→execute 单点原子，但前置的 stage→commit 是问题源。

## 2. 当前代码落点

- `apps/api/src/trading/unified-trading.service.ts`
  - 第 156–163 行：`getStagingArea()` 普通 `redis.get()`
  - 第 168–172 行：`clearStagingArea()` 普通 `redis.del()`
  - 第 201–243 行：`commit()` 顺序执行 get → 计算 hash → setex → del，无 Lua/事务包裹
  - 第 218–220 行：`hashInput = '${message}|${JSON.stringify(ops)}|${timestamp}'` —— 含时间戳
  - 第 280 行附近：`execute()` 内的重复检测仅依赖 hash 字面量
- `apps/api/src/trading/unified-trading.controller.ts`
  - `POST /trading/commit` 的 DTO 中无 `idempotencyKey` 字段

## 3. 目标

1. 把 stage→commit 写为单 Redis 操作，杜绝 read-then-delete race。
2. 让 commit hash 仅由「业务意图」决定，不再因为重试时间不同而变化。
3. 为客户端提供显式 `idempotencyKey`，区分「同一笔重试」与「新提交」。
4. 不破坏现有的事件发射、wallet 历史、SSE 通知行为。

## 4. 非目标

- 不替换 Redis 存储；不引入分布式事务框架。
- 不修改 broker 适配层（Alpaca / CCXT / Paper）。
- 不调整 staging area 的 30 分钟 TTL 或 commit 上限 100 的策略。

## 5. 方案

### 5.1 Lua 原子 stage→commit

新增 `commit_atomic.lua`，由 `commit()` 通过 `redis.eval` 调用：

```
KEYS[1] = staging key
KEYS[2] = pending key
ARGV[1] = canonical commit JSON (without timestamp)
ARGV[2] = ttl seconds

local ops = redis.call('GET', KEYS[1])
if not ops then return nil end
redis.call('SETEX', KEYS[2], tonumber(ARGV[2]), ARGV[1])
redis.call('DEL', KEYS[1])
return ops
```

调用方在 Lua 之前先计算好 canonical payload（见 5.2），脚本只负责「拿到当前 staging → 写 pending → 删 staging」三件事原子完成。

### 5.2 Canonical hash 输入

```
hashInput = sha256('${idempotencyKey ?? autoKey}|${stableStringify(ops)}|${message}')
```

- 删除 `timestamp` 进入 hash。
- `stableStringify` 对 ops 数组按 `clientOrderId` 或位置排序，确保字段顺序无关。
- 没有 `idempotencyKey` 时，`autoKey` 取 `userId + sortedClientOrderIds`，以便老客户端仍能受益。

### 5.3 Idempotency Key

**决议（codex consult 2026-04-23）：走 HTTP 头 `Idempotency-Key`，而不是 body 字段。**

- 对外契约：`POST /trading/commit` 与 `POST /trading/execute` 接受 `Idempotency-Key` 请求头（Stripe 风格），这条头要在 ingress / 反向代理上明确放行，并写入结构化日志和 trace context。
- 内部归一：在 NestJS 控制器边界把 header 读出，注入成内部 command 的 `idempotencyKey: string`，service 层只看 typed metadata，不感知 transport。
- 缺省值：header 缺失时降级到 5.2 的 `autoKey`，保持兼容。
- `execute()` 端的重复检测改为：`hash` 命中已存在 → 直接返回原次结果，不进入实际 broker 调用。
- 给 `agent_events` 的 `TRADE_COMMIT` / `TRADE_EXECUTE` 事件附加 `idempotencyKey`，方便审计。
- SDK / 内部脚本调用同一控制器时也走 header；如果未来出现真正非 HTTP 的内部命令通道，再扩展同名字段，不在公开 DTO 里掺 transport 概念。

## 6. 验收标准

1. 单元测试：在 `commit()` 进行中并发 `stage()` 一次新 op，结果——commit 完成后该 op 仍存在于 staging area。
2. 单元测试：相同 ops + 相同 message + 相同 idempotencyKey 重复 commit 两次 → 第二次返回首条 commit 的 hash，不写入新 pending key。
3. 单元测试：相同 ops + 不同 idempotencyKey → 产生不同 hash，是两个独立 commit。
4. 集成测试：`PaperTradingEngine` 端到端跑一遍 stage → commit → execute → re-execute（同 hash），第二次 execute 返回缓存的执行结果，不重复触发 broker。
5. 旧客户端（不带 idempotencyKey）回归——行为与升级前一致，不出现新的 422/409。

## 7. 风险

- Lua 脚本在 Redis Cluster 上要求所有 KEYS 同 hash slot，需要给 staging/pending key 加 `{userId}` hashtag。
- `stableStringify` 必须在 commit 与 execute 两端一致，否则 hash 不再可比；建议抽到 `packages/shared`。
- 客户端如果错误地复用 `idempotencyKey` 提交不同 ops，会被服务端当作重复，需要在文档中明确「key 必须随业务请求一同生成且唯一」。

## 8. Implementation Progress Log

- 2026-04-23: branch `feat/2026-04-23-trading-atomicity` opened; exec plan at `docs/exec-plans/2026-04-23-trading-atomicity.md`.
- 2026-04-23..24: implemented Tasks 1–8 per the exec plan.
  - Task 1 (`stableStringify` in `packages/shared/src/utils`): commit `8e9a6ac`.
  - Task 2 (`@IdempotencyKey()` decorator + `extractIdempotencyKey` extractor): commit `c5296cc`.
  - Task 3 (internal `CommitInput` type, body DTO unchanged): commit `d11292d`.
  - Task 4 (Lua `LUA_ATOMIC_COMMIT`, deterministic hash, idem cache): commit `84e7025`.
  - Task 5 (cached execute via `uta:executed:*`): commit `d5f2714`.
  - Task 6 (controller header wiring on v1+v2): commit `d860e25`.
  - Task 7 (same-key / different-key / determinism unit tests): folded into commit `84e7025`.
  - Task 8 (real-Redis integration spec — auto-skips when Redis down): commit `3b31c51`.
- Verification: `pnpm --filter @finsentinel/api test` → 1503 passed, 1 skipped, 0 failed.
  Includes `unified-trading.service.spec` (24), `unified-trading.integration.spec` (3 against live Redis), `trading-flow.integration.spec` (7 supertest E2E), `trading.controller.spec`, all broker specs, etc.
- Side fix: `apps/api/src/__tests__/integration/test-app.factory.ts` extended `luaEval` mock to recognise the new `LUA_ATOMIC_COMMIT` script (recognised by GET+DEL+`'[]'` literal absence of cjson.\*).
- Open: real `AgentEventService` wiring is still a stub (see PRD §4 out-of-scope); idempotencyKey now flows into the stub payload so the future event service can persist it.
