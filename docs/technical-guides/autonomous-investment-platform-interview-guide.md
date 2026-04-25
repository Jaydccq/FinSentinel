# Autonomous Investment Platform 技术面试指南

## 使用方式

这份文档用于学习和防守简历中的项目：

> Autonomous Investment Research & Risk Platform, Jan 2026 to Present.

核心原则：仓库是唯一事实来源。能在代码、测试、迁移、执行计划或指标中找到证据的内容，可以作为面试回答的主干；找不到证据的数字或说法，要么补证据，要么在面试中说得更谨慎。

建议按三轮学习：

1. 先读「系统总览」和「代码地图」。
2. 再按简历 bullet 逐个学习。
3. 最后只看问题，闭卷讲出回答框架。

## 项目介绍与技术栈

### 一句话项目介绍

FinSentinel 是一个 AI-assisted investment research and risk platform。它把投资研究里分散的行情、新闻、SEC filings、研究文档、组合持仓、风险复核和交易草案，整合到一个 chat/workspace 工作流里；LLM 负责理解用户意图、组织研究步骤和调用受控工具，后端负责权限、校验、状态机、人工审批、幂等执行、审计和观测。

面试时不要把它说成“自动炒股机器人”。更准确的定位是：

> 一个面向金融研究和风险控制的 AI workflow platform：模型辅助研究和生成草案，但交易执行必须经过确定性校验和 human approval。

### 这个项目解决什么问题

1. 投资研究信息太分散
   一个完整研究问题通常要同时看 market data、technical indicators、news、filings、research docs、portfolio exposure 和 broker state。项目通过 RAG + typed tools + analysis runtime，把这些来源接入统一 workflow。

2. LLM 不能直接被信任
   投资场景不能接受模型凭空给结论，更不能让模型直接下单。系统通过 Zod schema、tool registry、role tool scope、order draft validator、approval gate，把模型限制在受控边界内。

3. 金融执行有真实副作用
   API retry、用户重复点击、worker 重启都可能造成重复下单。因此 trading layer 不是简单的 `placeOrder()`，而是拆成 stage / commit / execute 三阶段，并用 Redis Lua、commit hash、`GETDEL` 和 commit history 做幂等保护。

4. 长对话会膨胀 token 和污染上下文
   Chat session 越长，历史消息越多。系统在超过阈值后做 LLM-based compaction：压缩旧消息，保留最近窗口，从而降低 token cost，同时保留当前上下文。

5. 后台任务需要异步和可恢复
   文档 ingestion、向量化、RAG enrichment、news processing、multi-stage analysis run 都不适合阻塞 HTTP 请求。项目用 Redis + BullMQ 负责队列、重试和 worker 执行。

6. 投资系统必须可审计
   研究结论、审批状态、交易草案、执行状态、限流、RAG latency 都需要可追踪。项目通过 Prometheus/Grafana 和 append-only event log 提供 observability 和 auditability。

### 端到端用户路径

典型流程可以这样讲：

```text
用户在 Web chat/workspace 提问
  -> Next.js 前端调用 NestJS API
  -> JWT / RateLimit / Zod validation 保护入口
  -> ChatService 判断普通对话或升级为 analysis run
  -> RAG 从 filings/research/news chunks 中找证据
  -> ToolRegistry 暴露行情、新闻、技术指标、组合、交易草案等 typed tools
  -> Analysis runtime 执行 Intelligence / Thesis / Risk / Execution Prep
  -> Execution Prep 生成 broker-neutral order drafts
  -> Human approval gate 等待用户确认
  -> Trading layer stage / commit / execute
  -> BrokerRegistry 路由到 paper/live broker
  -> Prometheus metrics 和 append-only events 记录全过程
```

### 技术栈分层

| 层级                          | 使用技术                                                                                      | 在项目中的作用                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Monorepo / Tooling            | TypeScript, Node.js 22+, pnpm 10, Turbo                                                       | 统一管理 API、Web、shared schema、db package、AI runtime package；统一 build/typecheck/test                                 |
| Frontend                      | Next.js 16, React 19, Tailwind CSS 4, Recharts, lightweight-charts, framer-motion             | 实现 chat、research workspace、portfolio/dashboard、图表和交互界面                                                          |
| Backend API                   | NestJS 11, RxJS, `@nestjs/config`, `@nestjs/schedule`                                         | 模块化后端；controller 保持薄，业务逻辑放 service；guard/pipe/filter 负责入口治理                                           |
| AI Runtime                    | `@finsentinel/ai-runtime`, `@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`               | 封装模型构造、typed tool adapter、streaming text runtime、embedding client，避免业务层直接耦合外部 SDK                      |
| Contracts                     | Zod, `packages/shared`                                                                        | API 请求/响应 schema、tool input schema、structured output boundary、前后端共享类型                                         |
| Database                      | PostgreSQL 17, pgvector, Drizzle ORM, `postgres` client                                       | 存 durable state、analysis runs、documents、RAG chunks、vector embeddings、event log                                        |
| Retrieval                     | pgvector, PostgreSQL full-text search, RRF, reranker sidecar, context packing, query traces   | 支持 query-class-aware dense+sparse hybrid retrieval、metadata routing、rank fusion、rerank fallback 和 prompt context 控制 |
| Queue / Cache / Runtime State | Redis 7, ioredis, BullMQ 5                                                                    | BullMQ job queue、rate limit counter、trading staging/pending state、Lua atomic transition                                  |
| Trading                       | Broker abstraction, Paper broker, live broker adapters, Redis `GETDEL`, order draft validator | broker-agnostic trading lifecycle；先生成草案，再审批，再幂等执行                                                           |
| Storage                       | RustFS / S3-compatible storage, AWS SDK S3 client                                             | 保存上传文档和对象存储内容，供 ingestion/RAG pipeline 使用                                                                  |
| Observability                 | prom-client, Prometheus, Grafana                                                              | 暴露 `/api/metrics`，观察 RAG latency、rate limit、请求量、系统健康度                                                       |
| Testing                       | Vitest, Nest testing utilities, benchmark-style specs                                         | 覆盖 services、tool registry、RAG、chat compaction、SSE concurrency、rate limiter 等路径                                    |
| Local Deployment              | Docker Compose, API/Web Dockerfiles                                                           | 本地启动 Postgres/pgvector、Redis、RustFS、reranker、API、Web、Prometheus、Grafana                                          |

### 为什么这些技术适合这个项目

**TypeScript + pnpm monorepo**
前端、后端、shared contracts、db schema 和 AI runtime 都在同一个 workspace，schema 和类型可以直接复用。比如 `packages/shared` 中的 Zod schema 可以同时服务 API validation、前端 type inference 和 tool input validation。

**NestJS**
项目后端领域很多：auth、chat、agent、analysis、rag、trading、portfolio、news、storage、observability。NestJS 的 module/controller/service/guard/pipe 结构能把边界拆清楚，避免把所有逻辑堆到一个 server 文件里。

**Next.js + React**
前端不只是一个聊天框，还需要 portfolio/dashboard、研究结果展示、图表、approval action、workspace 状态。Next.js 适合做这种 full-stack web UI，React 生态也方便接图表和交互组件。

**Zod**
Zod 是整个系统的 contract layer：HTTP body validation、shared frontend type、LLM tool parameters、structured output 都可以用同一套 schema 思路表达。它让“模型生成的输入”先通过确定性 schema，再进入业务逻辑。

**PostgreSQL + pgvector**
金融研究数据不是纯向量数据。它既有文档 chunk embedding，也有用户、portfolio、analysis run、event log、metadata filter 等关系型数据。Postgres + pgvector 可以把 vector search 和 relational filtering 放在同一个数据库里。

**Dense + Sparse + RRF 的 RAG 设计**
金融文档同时有语义问题和精确术语。Dense retrieval 适合“管理层怎么看 margin pressure”这类语义查询；sparse full-text search 适合 `10-Q`、`EPS`、ticker、会计术语；RRF 用 rank-based fusion 避免 dense score 和 sparse score 量纲不同的问题。当前实现还加入了 query class gating、representation search、metadata soft/hard routing、reranker fallback、context packing 和 trace/rollout。

**Redis + BullMQ**
Redis 已经适合做短生命周期状态和原子计数，BullMQ 又能基于 Redis 做 job queue。文档向量化、analysis run、news enrichment 这些任务可以异步执行；trading stage/pending state 和 rate limit 也能复用 Redis。

**SSE**
LLM chat 是服务端到客户端的单向增量输出。SSE 比 WebSocket 简单，适合 `message / done / error` 这种结构化 streaming frame。它能让用户实时看到模型输出，同时后端保留普通 HTTP 的部署和鉴权模型。

**Prometheus + Grafana**
AI workflow 的故障经常不是“服务挂了”，而是 latency 变高、retrieval result 变少、rate limit 命中异常、某个 stage 失败率上升。Prometheus 指标和 Grafana dashboard 更适合观察这些趋势。

### 当前仓库和简历技术栈的校准

简历中写的是：

```text
TypeScript • NestJS • Vercel AI SDK • PostgreSQL (pgvector) • Redis • BullMQ • Docker • Node.js
```

当前仓库更精确的版本是：

```text
TypeScript • NestJS • Next.js • internal @finsentinel/ai-runtime • PostgreSQL/pgvector • Drizzle • Redis • BullMQ • Docker Compose • Prometheus/Grafana • Node.js
```

其中最需要注意的是 `Vercel AI SDK`。当前代码已经迁移掉 direct `ai` / `@ai-sdk/openai` import，并通过 `pnpm check:no-vercel-ai-sdk` 机械阻止重新引入。面试时可以这样解释：

> 早期实现采用 Vercel AI SDK 风格的 typed tool calling、streaming 和 structured generation。后来为了降低 SDK coupling，把模型、tool adapter、streaming 和 embeddings 收敛到内部 `@finsentinel/ai-runtime` 包。业务层仍然保留 typed tools、Zod schema、streaming 和 tool orchestration 的架构，但不直接依赖 Vercel AI SDK。

### 30 秒项目介绍模板

> FinSentinel 是一个 AI-assisted investment research and risk platform。前端是 Next.js，后端是 NestJS，数据层用 PostgreSQL/pgvector 和 Redis/BullMQ。它用 RAG 从 filings、research 和 news 中检索证据，用 typed tools 让模型访问行情、新闻、技术指标、组合和交易草案能力，再用多阶段 analysis runtime 做 thesis、risk review 和 execution prep。交易不会由 LLM 直接执行，而是走 broker-neutral draft、人类审批和 Redis-backed stage/commit/execute lifecycle。Prometheus/Grafana 和 append-only events 用来做观测和审计。

### 2 分钟项目介绍模板

> 这个项目解决的是投资研究链路分散和 AI 输出不可控的问题。用户在 Web chat 或 workspace 里提问后，请求进入 NestJS API，先经过 JWT、rate limit 和 Zod validation。普通问题走 ChatService 实时 SSE streaming；复杂问题可以升级成 tracked analysis run。RAG pipeline 会从 SEC filings、research documents 和 market news 的 chunks 中检索证据，结合 query class gating、dense representation search、Postgres full-text sparse search、metadata routing、RRF fusion、reranker fallback 和 context packing，把证据压到可控 token budget 内。
>
> Agent 侧不是让模型随便访问系统，而是通过 ToolRegistry 暴露 typed tools。每个 tool 都有 Zod input schema 和后端 execute 函数，工具覆盖 market data、technical indicators、news、research、portfolio、watchlist、trading drafts 等。Analysis runtime 再把复杂研究拆成 intelligence、thesis、risk、execution prep、human approval 多个阶段，每个阶段有 checkpoint 和 artifacts。
>
> 交易侧的重点是风险控制和幂等。LLM 最多生成 broker-neutral order draft，执行前要经过 human approval。后端 trading layer 把交易拆成 stage、commit、execute：stage 暂存意图，commit 生成 hash 和 pending payload，execute 用 Redis `GETDEL` 原子消费 pending commit，再通过 BrokerRegistry 路由到 paper 或 live broker。整个过程通过 Prometheus metrics 和 append-only event log 做观测、审计和回放。

## 当前仓库对齐风险

这些点最容易被面试官深挖，也最需要你提前校准说法。

| 简历说法                             | 当前仓库事实                                                                                                                               | 更稳的面试说法                                                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Vercel AI SDK`                      | 当前代码已迁移掉 direct `ai` / `@ai-sdk/openai` import，使用内部 `@finsentinel/ai-runtime`。`pnpm check:no-vercel-ai-sdk` 会阻止重新引入。 | "早期实现使用 Vercel AI SDK 风格的 typed tool orchestration；当前版本把这层抽到内部 AI runtime，保留 typed tools、streaming 和 OpenRouter-compatible model 行为。" |
| `20+ typed tools`                    | `apps/api/src/agent/tools` 下目前有 76 个 `tool({` 定义；运行时实际暴露哪些取决于服务注入和 role scope。                                   | "系统有超过 20 个 typed tools，统一由 ToolRegistry 组装，并通过 Zod schema 做参数校验。"                                                                           |
| `sub-300ms retrieval latency`        | RAG 有 `rag_search_duration_seconds` Prometheus histogram，但本次检查没有找到专门的 RAG latency benchmark。                                | "代码路径为低延迟设计，并有 Prometheus 指标。若要说具体 P95，需要带 benchmark 或 Grafana 证据。"                                                                   |
| `100+ concurrent streaming sessions` | `sse-concurrency.benchmark.spec.ts` 模拟 150 个并发 ReadableStream。它验证应用内 stream framing，不等于完整生产压测。                      | "我用 in-process benchmark 验证了 150 个并发 SSE stream 的应用层路径；生产容量需要看部署环境压测。"                                                                |
| `1k+ requests/min`                   | `rate-limiter.benchmark.spec.ts` 用 mock Redis 测 2000 次 check，并断言超过 1000 req/min。                                                 | "这个 benchmark 证明 TypeScript guard 热路径开销很低；真实 Redis 和网络容量仍要用环境压测确认。"                                                                   |

## 系统总览

```text
用户 / 前端
  |
  |  POST /chat/stream, /analysis/runs, approval actions
  v
apps/api NestJS API
  |
  +-- ChatService
  |     +-- ChatCompactionService
  |     +-- ChatUpgradePlannerService
  |     +-- AgentService
  |
  +-- AgentService / RoleExecutorService
  |     +-- ToolRegistry
  |     +-- @finsentinel/ai-runtime
  |     +-- OpenRouter-compatible model / embeddings
  |
  +-- RAG
  |     +-- QueryRewriteService
  |     +-- QueryVariantService
  |     +-- QueryEntityExtractorService
  |     +-- MetadataPreFilterService
  |     +-- RetrievalPlannerService
  |     +-- RetrievalOrchestratorService
  |     +-- RagChunkStoreService
  |     +-- SparseSearchService
  |     +-- GraphRetrievalService
  |     +-- RetrievalFusionService
  |     +-- RerankService
  |     +-- ContextExpanderService
  |     +-- ContextPackerService
  |     +-- RagTraceService / RolloutGateService / ShadowRunnerService
  |
  +-- Analysis Runtime
  |     +-- AnalysisRunService
  |     +-- AnalysisCheckpointService
  |     +-- RunOrchestratorService
  |     +-- TeamRegistry
  |     +-- Intelligence -> Thesis -> Risk -> Execution Prep -> Human Approval
  |
  +-- Trading Runtime
  |     +-- OrderDraftValidator
  |     +-- OrderDraftMapper
  |     +-- UnifiedTradingService
  |     +-- BrokerRegistry
  |
  +-- Safety / Observability
        +-- RateLimitGuard
        +-- MetricsService
        +-- AgentEventService

PostgreSQL / pgvector: durable state, RAG chunks, analysis tables.
Redis: BullMQ queues, rate-limit counters, trading staging/pending state.
Prometheus: scrape /api/metrics.
```

## 代码地图

| 主题                       | 关键文件                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 仓库优先规范               | `AGENTS.md`, `CLAUDE.md`, `docs/exec-plans/*`, `scripts/check-no-vercel-ai-sdk.mjs`                                                                                                              |
| AI runtime                 | `packages/ai-runtime/src/tools.ts`, `packages/ai-runtime/src/text-runtime.ts`, `packages/ai-runtime/src/embeddings.ts`                                                                           |
| Tool registry              | `apps/api/src/agent/tool-registry.ts`, `apps/api/src/agent/tools/*.tool.ts`                                                                                                                      |
| Role tool scope            | `apps/api/src/analysis/contracts/role-tool-scope.ts`, `apps/api/src/analysis/teams/role-executor.service.ts`                                                                                     |
| RAG retrieval              | `apps/api/src/rag/rag-retrieval.service.ts`, `retrieval-planner.service.ts`, `retrieval-orchestrator.service.ts`, `sparse-search.service.ts`, `retrieval-fusion.service.ts`, `rerank.service.ts` |
| RAG storage / traces       | `apps/api/src/rag/rag-chunk-store.service.ts`, `rag-trace.service.ts`, `packages/db/src/schema/document-chunks.ts`, `packages/db/src/schema/rag-query-logs.ts`                                   |
| RAG ingestion / enrichment | `apps/api/src/queue/vectorize.producer.ts`, `vectorize.consumer.ts`, `representation-enrich.consumer.ts`, `graph-enrich.consumer.ts`, `apps/api/src/document/*`, `services/parser/*`             |
| Analysis runtime           | `apps/api/src/analysis/run-orchestrator.service.ts`, `team-registry.ts`, `teams/*`                                                                                                               |
| Broker execution           | `apps/api/src/trading/unified-trading.service.ts`, `broker-registry.service.ts`                                                                                                                  |
| Order draft                | `packages/shared/src/schemas/order-draft.ts`, `order-draft-validator.service.ts`, `order-draft-mapper.service.ts`                                                                                |
| SSE chat                   | `apps/api/src/chat/chat.controller.ts`, `chat.service.ts`, `apps/api/src/agent/agent.service.ts`                                                                                                 |
| Chat compaction            | `apps/api/src/chat/chat-compaction.service.ts`, `chat-compaction.benchmark.spec.ts`                                                                                                              |
| Rate limit                 | `apps/api/src/common/services/rate-limiter.service.ts`, `rate-limit.guard.ts`                                                                                                                    |
| Metrics                    | `apps/api/src/common/services/metrics.service.ts`, `metrics.controller.ts`, `observability/prometheus/prometheus.yml`                                                                            |
| Event log                  | `apps/api/src/events/agent-event.service.ts`, `packages/db/src/schema/agent-events.ts`                                                                                                           |

## 1. Repository-First Guardrails

### 简历主张

你说自己用 Claude Code harness-engineering principles 建立了：

- repository-first specifications
- explicit workflow contracts
- validation layers
- strict human control over financial logic

### 仓库里的真实含义

Repository-first 不是说"我在聊天里告诉 AI 怎么写"，而是把关键约束写进仓库：

- `AGENTS.md`：本 workspace 的开发规则。
- `docs/exec-plans/`：复杂任务的背景、目标、范围、假设、验证、进度、决策、风险。
- `packages/shared/src/schemas/`：API、analysis、order draft、trading 等共享 Zod contract。
- `packages/db/src/schema/` 和 `packages/db/migrations/`：数据库 schema 和迁移。
- `scripts/check-no-vercel-ai-sdk.mjs`：把 "不要再直接引入 Vercel AI SDK" 变成可执行检查。

一句面试回答：

> 我把容易靠口头约定出错的地方尽量变成版本化 artifact 和机械检查。能用 schema、typecheck、test、migration、CI script 表达的规则，就不只写在 README 里。

### 三层 guardrail

**第一层：规范和计划**

`docs/exec-plans/` 要求每个非平凡任务写清楚：

- 背景
- 目标
- 范围
- 假设
- 实现步骤
- 验证方式
- 进度日志
- 关键决策
- 风险和 blocker
- 最终结果

这让开发过程可以被后续 agent 或人类复盘。

**第二层：类型和 schema**

`packages/shared/src/schemas/analysis.ts` 定义：

- analysis run source mode
- analysis run status
- stage key
- artifact kind
- approval status
- shared context
- stage structured output
- decision object
- API request/response schema

`packages/shared/src/schemas/order-draft.ts` 定义 broker-neutral order draft。

**第三层：运行时 guard**

- `JwtGuard` 控制身份。
- `RateLimitGuard` 控制调用频率。
- `ZodValidationPipe` 控制 body shape。
- `OrderDraftValidator` 控制 LLM 输出不能塞 broker-specific 字段。
- `AnalysisApprovalService` 和 `HumanApprovalGateService` 控制交易执行前必须有审批边界。

### 深挖问题

**Q: LLM 本身不确定，为什么你还说 deterministic guardrails？**

答：

> LLM 输出本身不确定，确定的是它外面的边界。比如 role 只能拿到 allow-list 里的 tools，tool 参数必须过 Zod，order drafts 必须是 broker-neutral schema，approval 必须落库，交易执行必须经过 Redis stage/commit/execute 状态机。LLM 可以建议和调用工具，但不能绕过这些确定性边界直接改 durable financial state。

**Q: 如果 AI 生成的代码违反规范，怎么拦？**

答：

> 最理想是机械拦截。例如当前 `pnpm check:no-vercel-ai-sdk` 直接阻止 direct SDK import。不是所有规则都已经机械化，所以执行计划和 review 仍然存在。我的原则是重复出现的问题要升级成脚本、测试、schema 或 lint 规则，而不是只靠记忆。

## 2. Multi-Stage RAG

### 简历主张

你说自己实现了：

- SEC filings、research、market news 上的 RAG
- hybrid dense + sparse retrieval
- Reciprocal Rank Fusion
- reranking
- metadata-aware filtering
- pgvector-backed retrieval
- BullMQ 异步 ingestion 和 enrichment
- 复杂约束查询下低延迟 retrieval

当前仓库里这条主张已经不只是“dense + sparse + RRF”。更准确的说法是：

> RAG 是一个 rollout-aware 的 multi-stage retrieval pipeline：ingestion 端把文档解析成 Markdown、按文档类型 chunk、生成 embedding、canonical search vector、可选 representation 和 graph enrichment；query 端先做 query class / variants / metadata hints，再并行跑 dense representation lane、sparse canonical+representation lane，以及受限的 graph lane，随后用 RRF fusion、sidecar rerank、context expansion/packing 和 trace logging 产出可审计的 prompt context。

### Ingestion 数据流

```text
Document / news source
  |
  v
VectorizeProducer
  |
  v
BullMQ queue: finsentinel-vectorize
  |
  v
VectorizeConsumer
  |
  +-- load document row
  +-- download content from storage
  +-- parse to Markdown / clean text
  +-- detect document shape and chunk text
  +-- embed chunks
  +-- replace document_chunks rows with metadata and search_vector
  +-- optionally enqueue representation enrichment
  +-- optionally enqueue graph enrichment
```

关键代码：

- `VectorizeProducer.send(docId)` 用稳定 job id：`vectorize:{docId}`。
- `VectorizeConsumer.process()` 负责 load/download/parse/vectorize/status update，并在成功后 enqueue enrichment。
- `DocumentParseService` 对 text/json 走本地解析；PDF/DOC/DOCX 走 `ParserSidecarClient`。
- `services/parser/` 是真实 parser sidecar：PDF 用 `pdfplumber`，Word 用 `python-docx`，输出 Markdown 和 metadata。
- `DocumentVectorService.vectorize()` 负责 Markdown structure、doc-type-aware chunking、embedding、metadata extraction 和 metrics。
- `DocumentChunkingService` 按 `report`、`qa`、`table_heavy`、`default` 选择 chunk 策略，默认窗口来自 `rag.chunking.*`。
- `RagChunkStoreService.replaceChunks()` 删除旧 chunks，插入新 chunks，并重建 canonical `search_vector`。
- `ChunkRepresentationService` 可选生成 `contextual_text`、`sample_question`、`summary`、`keyword_entity` 四类 representation。

BullMQ 配置要点：

- attempts: 3
- exponential backoff
- removeOnComplete: 100
- removeOnFail: 500
- consumer concurrency: 2

面试解释：

> 向量化是典型的异步任务：慢、可重试、可能调用外部 embedding API，不应该阻塞用户请求。BullMQ 复用了已有 Redis，支持 job id、retry、backoff 和 worker concurrency，足够支撑 v1 ingestion pipeline。

当前 parser 的边界也要说清楚：

- PDF parser 是 `pdfplumber` text/table extraction，不是 OCR；扫描件和图片型 PDF 不能保证可检索。
- parser sidecar 有 timeout、响应 schema 校验、最小 Markdown 长度校验和 circuit breaker。
- representation enrichment 默认受 `RAG_ENRICHMENT_ENABLED` 控制；不是所有 chunk 天然都有 representation rows。
- graph enrichment 会写 `knowledge_entities` / `chunk_entity_links` / `knowledge_relations`，但 Python sidecar 当前还没有完整 relation extraction 输出，所以不要把 GraphRAG 说成默认成熟能力。

### Query-time 数据流

```text
User query
  |
  v
RagRetrievalService
  |
  +-- choose pipeline: single_stage / multi_stage / shadow / canary
  +-- RetrievalPlannerService classifies query and builds variants
  +-- RetrievalOrchestratorService runs lanes
       +-- QueryEntityExtractorService extracts metadata hints
       +-- MetadataPreFilterService builds hard/soft filters
       +-- dense lane: pgvector over canonical/contextual/sample_question
       +-- sparse lane: PostgreSQL FTS over canonical + representation vectors
       +-- optional graph lane: only when configured and entity context exists
  +-- RetrievalFusionService applies RRF
  +-- RerankService improves precision or falls back
  +-- ContextExpanderService conditionally adds neighbors/sections
  +-- ContextPackerService dedupes and bounds prompt context
  +-- RagTraceService records sampled plans, lane counts, timings, fallbacks
```

`RagRetrievalService.choosePipeline()` 的关键点：

- `rag.multiStageEnabled` 当前默认是 `true`；依赖齐全时走 multi-stage。
- `RAG_ROLLOUT_MODE=off` 不是“禁止 multi-stage”，而是回到主开关控制。
- `shadow` 模式 authoritative result 仍可走 single-stage，同时后台采样跑 multi-stage 并写 `rag_shadow_comparisons`。
- `canary` 模式用 `RolloutGateService` 按 query class 和 stickiness 做稳定分流。
- multi-stage 出错时会记录 trace，然后 fallback 到 single-stage dense path。

### Query planner

`RetrievalPlannerService` 先把查询分成五类：

- `exact_lookup`
- `factoid`
- `relational`
- `analytical`
- `multi_part`

分类顺序很重要：`exact_lookup` 优先级最高，然后是 `multi_part`、`analytical`、`relational`、`factoid`。这样 `AAPL 2024 10-K Item 1A` 这类强精确查询不会被改写成泛化语义问题。

variants 当前包括：

- `original`
- `rewrite`
- `hyde`
- `subquery`

但不是所有查询都会生成全部 variants：

- `exact_lookup` 只保留 original，不做 rewrite、HyDE 或 decomposition。
- `rewrite` 默认启用，但只有在改写结果和原 query 不同时才加入 variant。
- HyDE 默认关闭，只在 analytical query 且开关启用时使用。
- decomposition 默认关闭，只在 multi-part query 且开关启用时使用。
- 每次 orchestrator 最多消费 4 个 variants，避免 recall 扩张失控。

面试说法：

> planner 的核心不是“让 LLM 多想一步”，而是保护不同 retrieval intent。精确查找要保留原始 ticker、form、section、财务术语；分析型问题才适合 rewrite 或 HyDE。这个 gating 防止 query rewrite 把最重要的 exact-match signal 洗掉。

### Dense retrieval

single-stage fallback 仍然用 `RagChunkStoreService.search()` 做 pgvector cosine search：

```sql
1 - (embedding <=> query_vector::vector) AS similarity
ORDER BY embedding <=> query_vector::vector
```

single-stage 支持这些 filter：

- `docType`
- `sector`
- `regionId`
- `afterDate`

multi-stage 的 dense lane 现在更强：`RagChunkStoreService.searchRepresentations()` 会在同一个 query embedding 下检索三种 dense surface：

- `canonical`: 原始 chunk embedding
- `contextual_text`: LLM 生成的上下文化 chunk 表述
- `sample_question`: 代表这个 chunk 能回答的问题

然后 dense lane 内部先按 representation type 分组做一次 RRF，合成“每个 chunk 一个 dense 候选”。这解决了一个实际问题：同一个 chunk 可能不是用原文最容易召回，而是通过问题型表述或上下文化表述更容易命中。

metadata filter 的边界：

- single-stage dense path 只处理 `docType`、`sector`、`regionId`、`afterDate`。
- multi-stage representation dense path 已经支持 `tickers` 和 `issuerName` 过滤。
- 当前 tech debt 里仍有 metadata schema/GIN index 等优化项，不要把 filter 性能说成已经完全生产化。

### Sparse retrieval

`SparseSearchService.search()` 用 PostgreSQL full-text search，同时查 canonical chunk 和 representation rows：

```sql
search_vector @@ websearch_to_tsquery('simple', query)
ts_rank_cd(weights, search_vector, websearch_to_tsquery('simple', query))
```

当前 sparse lane 的特点：

- canonical `document_chunks.search_vector` 会命中 title、source、entities、content。
- representation `document_chunk_representations.search_vector` 会命中 `contextual_text`、`sample_question`、`keyword_entity`。
- sparse weights 默认是 D/C/B/A = `0.1/0.2/0.4/1.0`，可通过配置调整。
- canonical 和 representation 命中会按 chunkId merge，保留最高 rank。
- 同一 source 多个 chunk 命中会有轻微 source hit boost：

```sql
rank_score * (1 + 0.1 * ln(hit_count))
```

解释：

> 如果同一份 filing 的多个 chunk 都命中关键词，说明整份文档和 query 的相关性更高，所以给这些 chunk 轻微 boost。

`RagChunkStoreService.replaceChunks()` 中的 `search_vector` 加权：

- title/source/entities 用 weight `A`
- content 用 weight `B`
- metadata 用 `simple` config，避免 ticker/entity 被错误 stem
- content 用 `english` config，支持英文词形归一

representation tsvector 的权重也不同：

- `contextual_text`: title/section 权重大，上下文化文本次之。
- `sample_question`: sample questions 权重大。
- `summary`: summary 可用于 sparse，但不参与 dense embedding search。
- `keyword_entity`: keyword/entity blob 可用于 sparse，但不参与 dense embedding search。

### Dense 和 sparse 的差别

Dense retrieval 擅长语义问题：

- "这家公司收入质量有没有恶化"
- "管理层对未来需求怎么看"
- "供应链风险是否变大"

Sparse retrieval 擅长精确问题：

- `10-Q`
- `diluted EPS`
- `risk factors`
- `AAPL`
- `Item 1A`
- 公司名、ticker、会计术语

面试回答：

> 金融文档既有语义问题，也有大量精确术语。只用 embedding 容易漏掉 exact-match intent；只用 full-text 又不擅长概念型查询。所以用 dense + sparse，再用 RRF 合并。

### Metadata-aware filtering

`RetrievalOrchestratorService` 不直接把用户 query 当 SQL filter。它先调用：

```text
QueryEntityExtractorService.extract()
  -> MetadataPreFilterService.buildFilter()
```

`QueryEntityExtractorService` 当前有两层：

- regex path：识别 ticker、10-K/10-Q/8-K、annual/quarterly、FY/Q/year 等时间锚点。
- optional LLM fallback：只有 regex 没有任何命中且 `RAG_ENTITY_LLM_FALLBACK_ENABLED=true` 时才会尝试，并带 timeout、并发上限和 circuit breaker。

`MetadataPreFilterService` 支持三种模式：

- `off`: 不生成 metadata prefilter。
- `soft`: 低置信度 hint 只做 boost，不做 hard restriction。
- `hard`: 高置信度 ticker/issuer/docType/timeRange 可进入 hard filter。

当前默认是 `soft`。高置信度 ticker、issuerName、docType 和 afterDate 可以缩小候选集；低置信度 ticker/issuerName 会作为 soft hint 传给 sparse lane。soft hint 的实现不是 WHERE restriction，而是 rank multiplier：

```text
matching hinted ticker / issuer -> rank_score * 1.15
```

还有一个重要 guardrail：如果 hard metadata filter 后候选数低于 query class 的最小阈值，orchestrator 会把 ticker/issuerName 降级成 soft hint，重新跑一次 recall，并记录 `rag_metadata_prefilter_downgrade_total`。这避免了 metadata extractor 抽错后把召回集清空。

局限也要主动讲：

- sector/region 抽取目前存在，但 prefilter 没有把它们路由进 hot path。
- explicit caller filters 优先于 extractor 结果。
- live API eval 尚未完全替代 offline corpus retriever，所以 metadata routing 的线上收益不能硬说。

### RRF

`RetrievalFusionService.fuse()` 公式：

```text
contribution = 1 / (k + rank + 1)
default k = 60
```

重点不是背公式，而是讲出为什么用 RRF：

> Dense 的 cosine similarity 和 sparse 的 full-text rank score 不在同一个量纲，直接 weighted sum 需要归一化和调参。RRF 只看各 lane 内部排名，天然避免不同 score scale 的比较问题。一个文档如果在 dense 和 sparse 都靠前，会自然排到前面。

当前实现会保留 provenance：

- 哪些 lane 命中过该 chunk。
- 哪些 representation types 命中过该 chunk。
- 哪些 query variants 命中过该 chunk。

这些信息会进入 trace，方便解释“为什么这个 chunk 被召回”。

### Reranker fallback

`RerankService` 调 sidecar：

```text
POST {RERANKER_URL}/rerank
```

传入 query 和 candidate text。如果 sidecar 不可用、超时或返回非 OK：

- 记录 warning
- 按 RRF score 排序
- 返回 topK
- 记录 fallback reason

面试说法：

> Reranker 是质量增强层，不是系统可用性的单点依赖。它挂了以后 retrieval 降级为 RRF 排序，而不是整体失败。

细节：

- candidate text 会带 `Title` / `Section` preamble，帮助 reranker 看到结构信息。
- `RAG_RERANK_MAX_TOKENS` 控制单个候选文本预算，默认 480。
- reranker 返回异常 JSON、schema 不合法、timeout 或 HTTP error 都走 fallback。

### Graph lane

仓库里有 GraphRAG 相关实现，但面试时要谨慎：

- `GraphRetrievalService` 能通过 `knowledge_entities`、`knowledge_relations`、`chunk_entity_links` 做最多 2-hop 的 recursive CTE retrieval。
- scorer 会结合 relation confidence、hop decay 和 chunk embedding relevance。
- planner 只有在 `rag.graph.enabled=true` 且 query class 适合时才会把 graph lane 放进 plan。
- orchestrator 还要求调用输入里有 entity names，当前普通 `RagRetrievalService.searchMultiStage()` 并没有把 extractor 的 issuerName 直接等价传成 graph entityNames。
- `graph-enrich.consumer.ts` 的 TypeScript 路径支持 relations，但 Python sidecar 当前未完整返回 relations。

稳妥说法：

> Graph lane 的 schema、service 和 enrichment worker 已经在仓库里，但它不是当前默认主召回路径。当前可防守的主路径是 dense representation + sparse representation + metadata routing + RRF/rerank/context packing。

### Context expansion and packing

`ContextExpanderService` 是可选层，默认由 `RAG_CONTEXT_EXPANSION_ENABLED` 控制。它不会无条件扩大上下文：

- 默认只允许 analytical、relational、multi_part query class 做 expansion。
- 如果 query class 不在 allow-list，只有 top source 看起来像 long document 时才扩。
- 可取 neighbor chunks，也可取 parent section。
- expansion chunk 会继承较低分数，避免邻居压过原始命中。

`ContextPackerService` 做三件事：

- 按 chunkId 去重
- 每个 source 最多保留 3 个 chunk
- 总 token estimate 默认不超过 4096

一句话：

> RAG 的终点不是拿到候选文档，而是把证据压成一个 token-bounded、source-diverse 的 prompt context。

### Trace, rollout, and evaluation

当前 RAG 不只是返回结果，还会留下可验证信号：

- `RagTraceService` 采样写 `rag_query_logs`：query hash、query class、variant hashes、filters、lanes、result chunk ids、lane counts、representation types、timings、fallback flags、rerank reason。
- query preview 默认不写入，除非显式开启 PII 配置。
- `ShadowRunnerService` 支持后台跑 shadow pipeline，记录 authoritative 和 shadow 的 chunk ids、latency、timeout/backpressure/error。
- `RolloutGateService` 支持按 query class 和 stickiness 做 canary。
- `/api/rag/search` 是 eval runner 专用入口，必须 `RAG_EVAL_ENDPOINT_ENABLED=true` 才开放；打开后无 auth，所以只应在受控评估环境使用。
- `services/evaluation-runner/configs/wave2-buckets.yaml` 已经有 100-entry golden set 的离线 bucket thresholds。

可防守的质量证据：

> 仓库里有 offline evaluation gate，按 exact_lookup、factoid、relational、analytical、multi_part、long_doc、cross_document、table_numeric、colloquial 等 bucket 设最低 recall/MRR。当前限制是 offline CorpusRetriever 不等同于 live API pipeline；live API gate 还需要 deterministic chunk id remapping 后再切换。

### Latency 怎么回答

代码里有低延迟设计：

- query class gating，避免 exact lookup 误用昂贵 variants
- metadata hard/soft pre-filter 和 hard-to-soft downgrade
- bounded topK / max variants
- dense/sparse lanes 并行执行，lane failure 用 `Promise.allSettled`
- reranker timeout + fallback
- context expansion 默认关闭且按 query class/long-doc gate
- context packing 限制 prompt size
- Prometheus histogram: `rag_search_duration_seconds`
- rollout/shadow 机制可先观测再放量

但本次检查没有找到 RAG latency benchmark。更稳的回答：

> 我不会空口说 P95。当前代码对 retrieval latency 做了 Prometheus instrumentation，并且查询路径通过 filter、并行 lanes 和 fallback 控制延迟。如果需要把 sub-300ms 写得很硬，我会带上 Grafana histogram 或代表性 corpus benchmark。

## 3. LLM Tool Orchestration

### 简历主张

你说系统暴露 20+ typed tools，覆盖 market data、technical indicators、news、research、trading，把自然语言请求转成多步金融 workflow。

### 当前 runtime 结构

当前代码不是直接用 Vercel AI SDK，而是：

```text
apps/api service
  |
  v
ToolRegistry builds FinToolSet
  |
  v
@finsentinel/ai-runtime
  |
  +-- defineZodTool()
  +-- Zod schema -> JSON schema / TypeBox boundary
  +-- pi-agent-core AgentTool
  +-- stream text deltas
```

`packages/ai-runtime/src/tools.ts` 做参数校验：

1. tool call params 先经过原始 Zod schema parse
2. parse 成功才执行 domain tool
3. 非 string result 会 JSON.stringify

面试重点：

> 工具参数不是模型说什么就是什么。模型输出会经过 schema validation，再进入服务层。

### ToolRegistry

`ToolRegistry.buildTools(userId, portfolioId)` 动态组装工具：

- always-on tools：market、technical indicators、thinking、confirmation
- optional service tools：company research、news、screener、calendar、ownership、trading、brain、profile、portfolio、watchlist、autonomy、crypto、Twitter

非常重要的一点：

> `userId` 是通过 closure 注入工具，不是让模型作为参数传进来。身份和权限上下文不能由 LLM 生成。

### Tool categories

仓库目前有 76 个 `tool({` 定义，主要包括：

- market quote and historical prices
- RSI, MACD, Bollinger Bands, EMA, SMA, ATR, Stochastic, ADX, OBV
- strategy template evaluation
- company profile, financial statements, analyst rating
- equity screeners and market movers
- earnings, dividend, split calendars
- institutional holders, insider transactions
- short interest and fails-to-deliver
- news and knowledge base search
- portfolio analysis
- watchlist management
- user investment profile and agent brain
- cron task and heartbeat tools
- crypto news, funding rate, position analytics, leverage
- Twitter search/profile/KOL signals
- trading stage, commit, execute, positions, wallet, history, sync

### Role-scoped tools

`ROLE_TOOL_SCOPE` 把不同角色限制在不同工具集合：

- `MARKET_ANALYST`: quote、historical bars、technical indicators、strategy eval、market hours
- `NEWS_ANALYST`: news、knowledge base、Twitter
- `FUNDAMENTALS_ANALYST`: company research、calendar、ownership、short interest
- `SENTIMENT_ANALYST`: news、Twitter、KOL、knowledge base
- `RISK_REVIEWER`: portfolio、knowledge base
- `PORTFOLIO_MANAGER`: portfolio、positions、wallet
- `TRADE_PLANNER`: portfolio、positions、quote
- `EXECUTION_DRAFT_BUILDER`: quote、market hours

一句面试回答：

> Role scope 是 LLM tool orchestration 的 trust boundary。不是每个 agent 都能拿到所有工具，尤其是执行相关工具不能随便暴露给分析角色。

### 多步 workflow 失败怎么办

当前模式：

- tool 内部通常 catch error 并返回 error string
- agent 可以读到失败信息并改用替代工具或解释失败
- runtime 有 maxTurns，避免无限工具循环

更成熟的未来改进：

- read-only tools 可重试
- execution tools 不自动重试
- tool error 用结构化格式返回，而不是普通字符串
- tool call/result 写入 context journal 或 event log

### Vercel AI SDK 被问到怎么办

你要主动说清楚历史和当前：

> 这个项目早期直接用过 Vercel AI SDK 的 stream/text/tool/embedding 风格。后来为了降低 SDK coupling，把这些能力迁移到内部 `@finsentinel/ai-runtime`。当前代码里不允许直接 import `ai` 或 `@ai-sdk/openai`，通过 `pnpm check:no-vercel-ai-sdk` 检查。简历如果保留 Vercel AI SDK，需要解释它是历史实现和设计风格，而不是当前 direct dependency。

## 4. Broker-Agnostic Trade Execution

### 简历主张

你说交易层有：

- dynamic broker routing
- broker-agnostic execution
- stage / commit / execute 三阶段生命周期
- Redis Lua atomic state transitions
- commit hashing
- GETDEL safeguards
- idempotent execution
- retry 时避免 duplicate order commits

### Broker abstraction

核心文件：

- `apps/api/src/trading/interfaces/broker.ts`
- `apps/api/src/trading/broker-registry.service.ts`
- `apps/api/src/trading/unified-trading.service.ts`

`IBroker` 定义：

- `brokerId()`
- `displayName()`
- `supportedSecurityTypes()`
- `capabilities()`
- `canHandle(contract)`
- `placeOrder(contract, request)`
- `getPositions()`
- `getOrders()`
- `getAccount()`
- `cancelOrder()`
- `syncOrders()`
- `getMarketClock()`
- `searchContracts()`

`BrokerRegistry.resolve(contract, mode, initialCash)`：

- PAPER mode: 返回 paper broker
- LIVE mode: 在 live brokers 中找第一个 `canHandle(contract)` 的 broker
- live broker priority: Alpaca > OKX > CCXT path

### Stage

Redis key：

```text
uta:staging:{userId}
```

`stage()` 用 Lua 脚本原子追加 JSON array：

1. GET 当前 staging array
2. decode
3. 如果超过 max size，返回 -1
4. append item
5. SET array
6. EXPIRE
7. 返回新长度

为什么需要 Lua：

> 如果在 TypeScript 里做 GET -> parse -> append -> SET，两个并发请求可能都读到旧数组，然后互相覆盖。Redis Lua 在 Redis server 内单线程执行，可以避免 lost update。

### Commit

`commit(userId, message)`：

1. message 不能为空
2. staging area 不能为空
3. 生成 timestamp
4. hash input = `message | JSON.stringify(ops) | timestamp`
5. SHA-256 生成 commit hash
6. 写入：

```text
uta:pending:{userId}
```

7. clear staging

Commit hash 的作用：

- 审计标识
- commit history 标识
- execute 阶段 idempotency check

### Execute

`execute(userId)`：

1. Redis `GETDEL uta:pending:{userId}` 原子读取并删除 pending commit
2. pending 不存在则拒绝
3. load/create wallet
4. 如果 commit hash 已经在 wallet commitHistory 中，则拒绝
5. 根据 contract 和 mode resolve broker
6. 调 broker `placeOrder`
7. 更新 wallet cash、positions、commitHistory
8. 返回 report

最重要的一句话：

> `GETDEL` 是 atomic consume。两个 execute 请求同时来，只有一个能拿到 pending commit，另一个拿到 null。commitHistory hash check 是第二道 idempotency 防线。

### Human approval

Analysis runtime 不直接下单：

```text
LLM analysis
  -> broker-neutral order drafts
  -> strict validation
  -> approval record
  -> human approve/reject
  -> mapped stage requests
  -> trading stage/commit/execute
```

`ExecutionPrepTeamService` 生成 order drafts，并调用 `OrderDraftValidator`。

`AnalysisApprovalService` 在 approve 后：

- 把 drafts map 成 unified stage requests
- 写 `EXECUTION_PAYLOAD` artifact
- mark run completed
- 如果 auto-dispatch flag enabled，才 stage/commit/execute

面试中不要说默认完全自动交易。更稳：

> 默认产品边界是 human-in-the-loop。模型可以起草，不默认越过审批。

### 最危险失败场景

服务器在 broker order submission 后、local persistence 前宕机：

- pending commit 已被 `GETDEL` 删除
- broker 可能已经收到订单
- wallet 可能还没更新

当前系统更偏向 at-most-once，优先避免重复下单。未来更强的方案是 saga：

```text
EXECUTION_STARTED
BROKER_ORDER_SUBMITTED
EXECUTION_COMPLETED
RECONCILIATION_REQUIRED
```

恢复任务扫描 started-without-completed 的记录，向 broker 查 order/position 后补偿。

## 5. Analysis Runtime

### 简历中隐含的系统能力

虽然简历 bullet 主要讲 tools 和 trading，但当前仓库已经有更完整的 team runtime：

```text
INTELLIGENCE
  -> THESIS
  -> RISK
  -> EXECUTION_PREP
  -> HUMAN_APPROVAL
```

`RunOrchestratorService` 是 state machine，BullMQ job 调 `step(data)`。

### Team responsibilities

| Stage            | Service                    | 作用                                                         |
| ---------------- | -------------------------- | ------------------------------------------------------------ |
| `INTELLIGENCE`   | `IntelligenceTeamService`  | 跑 market/news/fundamentals/sentiment roles，收集证据。      |
| `THESIS`         | `ThesisTeamService`        | positive case 和 negative case 并行，然后 thesis lead 收敛。 |
| `RISK`           | `RiskTeamService`          | 形成风险、组合决策、risk limits。                            |
| `EXECUTION_PREP` | `ExecutionPrepTeamService` | 生成 broker-neutral order drafts。                           |
| `HUMAN_APPROVAL` | `HumanApprovalGateService` | 把 run 停在审批状态。                                        |

### Checkpoints

`AnalysisCheckpointService` 写：

- stage status
- checkpointVersion
- structuredOutputJson
- humanReportMarkdown
- errorJson
- stage artifacts

artifact types 包括：

- `STAGE_STRUCTURED_OUTPUT`
- `STAGE_HUMAN_REPORT`
- `ORDER_DRAFTS`
- `EXECUTION_PAYLOAD`

面试回答：

> v1 的 durability boundary 是 team stage，不是每个 token 或每次 tool call。这样能提供可恢复和可审计的结构，同时避免一开始就做过重的 workflow engine。

### Context Fabric

`ContextFabricService` 汇总四层上下文：

- long-term preference context
- mid-term strategy context
- short-term session context
- retrieval context

并能输出 prompt-ready text。

为什么重要：

> Chat、workspace、schedule、heartbeat 不应该各自拼 prompt。ContextFabric 让不同入口共享一套上下文组装语义。

## 6. SSE Streaming 和 Chat Compaction

### SSE 路径

`ChatController.stream()`：

1. JWT guard
2. Zod body validation
3. RateLimitGuard
4. 调 `ChatService.streamChat()`
5. 设置 SSE headers
6. 读取 `ReadableStream`
7. `res.write(value)`
8. `res.end()`

headers：

```text
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

`AgentService` 输出 frame：

```text
event: message
data: {"content":"chunk","sessionId":"uuid"}

event: done
data: [DONE]

event: error
data: {"error":"message"}
```

### 为什么 SSE 而不是 WebSocket

面试回答：

> Chat streaming 是一次请求后服务端单向推 token，SSE 正好适合。它走普通 HTTP，容易经过 proxy 和 load balancer，回答结束后自然关闭。WebSocket 更适合持续双向通信，比如 order book、协作编辑、实时 cancel channel。当前 chat response 不需要先引入 WebSocket 复杂度。

### 100+ concurrent sessions 怎么防守

`sse-concurrency.benchmark.spec.ts`：

- 模拟 150 个 concurrent stream
- 每个 stream 10 个 message frame
- 最后 done frame
- 另一个测试模拟 100 个 stream，其中一半 error

更稳的说法：

> 我验证过应用层 ReadableStream 到 SSE frame 的并发路径，150 个 in-process stream 可以完成。这个测试不等于生产压测；生产并发还取决于 Node worker、proxy、容器 CPU 和连接限制。

### Chat compaction

`ChatCompactionService` 默认：

- threshold: 24 messages
- recentWindow: 10 messages
- maxSummaryChars: 1200

流程：

1. count session messages
2. 如果少于 threshold，原样返回
3. 取最老的 `messageCount - recentWindow` 条
4. LLM summarize
5. upsert 到 `chat_session_memories`
6. 把 summary prepend 到下一条 user prompt

### 60% token reduction 怎么解释

`chat-compaction.benchmark.spec.ts`：

- 构造 realistic financial conversation
- 用约 4 chars/token 估算
- 30 条消息超过 threshold
- compact 最老 20 条
- 保留最近 10 条
- 断言 token reduction >= 50%
- 80 条消息 reduction > 75%

面试说法：

> 这个 benchmark 支持 "roughly 60%" 的量级，但它是估算型 benchmark，不是 tokenizer-exact production metric。数学上，compaction 后上下文大小接近 summary + recent window，基本固定；compaction 前随消息数线性增长，所以对话越长，节省越明显。

### Compaction 的缺陷

它是有损压缩。第 12 条消息里的具体数字可能被总结丢失。

当前缓解：

- 原始消息仍在 `chatMessages`
- 最近 10 条保留原文
- summary prompt 强调 tickers、decisions、action items

未来更好方案：

```text
summary for broad context
  +
vector recall over old chatMessages for precise facts
```

回答模板：

> Compaction 不是 lossless memory。更强方案是 summary + retrieval：summary 提供主题连续性，向量召回提供早期原文中的具体数字。

## 7. Observability, Rate Limiting, Auditability

### Metrics

`MetricsService` 封装 `prom-client`：

- Counter
- Gauge
- Histogram
- default Node process metrics

`MetricsController` 暴露：

```text
GET /api/metrics
```

Prometheus 配置：

```text
job_name: finsentinel-api
metrics_path: /api/metrics
target: api:3001
```

### RAG metrics

`RagRetrievalService` 发：

- `rag_search_requests_total`
- `rag_search_results_total`
- `rag_search_duration_seconds`
- `rag_search_last_result_count`

`DocumentVectorService` 发：

- `rag_vectorizations_total`
- `rag_vectorization_last_duration_ms`
- `rag_vectorized_chunks_total`
- `rag_vectorization_last_chunk_count`

RAG rollout / trace 相关信号：

- `rag_retrieval_pipeline{mode,query_class}`
- `rag_shadow_outcome_total{outcome}`
- `rag_metadata_prefilter_downgrade_total{query_class}`
- `rag_query_logs` 保存采样 query plan、lane counts、timings、fallback flags
- `rag_shadow_comparisons` 保存 shadow/canary 评估所需的结果差异和 latency 差异

### RateLimit Guard

`RateLimiterService` 用 Redis Lua fixed window：

```lua
INCR key
if current == 1 then EXPIRE key
TTL key
return allowed, remaining, retryAfterMs
```

key：

```text
rl:{dimension}:{identifier}:{endpoint}
```

`RateLimitGuard`：

- 有 user：按 user 限流
- 没 user：按 IP 限流
- 只有 direct IP 是 trusted proxy 时才信任 `X-Forwarded-For`

发出的指标：

- `rate_limit_check_duration_seconds`
- `rate_limit_checks_total`
- `rate_limit_remaining`

### 为什么 fixed window

优点：

- Redis 操作少
- 内存开销小
- 一个 Lua script 就能原子完成
- 对用户级 API limit 足够简单

缺点：

- window 边界可能 burst

如果被问怎么改：

> 可以升级 sliding window counter 或 token bucket，但当前 user-level API limit 的复杂度还不需要。真正的全局流量保护应该结合 gateway/proxy 层。

### 1k+ requests/min 怎么防守

`rate-limiter.benchmark.spec.ts`：

- 2000 checks
- mock Redis eval hot path
- 断言 req/min > 1000
- 还测试 sustained load 下 allowed/denied 数量正确

谨慎说法：

> 这个 benchmark 证明应用层 guard 路径不会成为 1k req/min 的瓶颈。真实部署还需要 Redis 网络延迟、容器 CPU 和 proxy 配置的压测结果。

### Append-only event log

`AgentEventService` 支持：

- append
- idempotency key 去重
- recent events
- list by aggregate
- replay after seqNo
- count by user

`agent_events` schema：

- `seq_no` 是 generated identity
- `aggregate_type`
- `aggregate_id`
- `event_type`
- `payload_json`
- `idempotency_key`
- user-scoped unique idempotency index

回答重点：

> 这里的 event log 主要是 audit/timeline/replay surface，不是所有业务状态的唯一 source of truth。钱包、analysis run、stage、approval 仍然有 materialized tables 作为主查询路径。

## 8. 高频深挖问题

### Q1: 用户要求完整投资分析时，端到端怎么走？

答题结构：

1. `ChatController` 收到请求。
2. JWT、Zod、rate limit 生效。
3. `ChatService` 判断是否 auto-upgrade 到 tracked analysis run。
4. `AnalysisRunService` 创建 queued run。
5. `AnalysisRunProducer` 进 BullMQ。
6. `AnalysisRunConsumer` 调 `RunOrchestratorService.step()`。
7. `TeamRegistry` 注册各 stage executor。
8. Intelligence、Thesis、Risk、Execution Prep、Human Approval 依次执行。
9. `AnalysisCheckpointService` 写 stage outputs 和 artifacts。
10. Execution Prep 写 broker-neutral order drafts。
11. Human Approval 阶段等待用户 approve/reject。

### Q2: 模型为什么不能直接下单？

答题结构：

- role tool scope 限制能力
- execution prep 只产 broker-neutral draft
- draft 必须通过 strict Zod validation
- approval request 落库
- human approval gate 停住 run
- trading service 是独立 stage/commit/execute 生命周期
- auto-dispatch 是 flag-gated，不是默认路径

### Q3: 为什么 hybrid RAG？

答：

> 金融文档既有语义查询，也有精确术语。Dense retrieval 对语义问题好，sparse retrieval 对 ticker、form、section、会计术语、risk factor、公司名好。当前实现还不只是原始 chunk：dense 会查 canonical、contextual_text、sample_question 三种表示，sparse 会查 canonical 和 representation search vectors。最后用 RRF 合并，避免比较 cosine 和 ts_rank_cd 这两种不同量纲的 raw scores。

### Q4: RRF 公式是什么，为什么有用？

答：

```text
score(doc) = sum over lanes of 1 / (k + rank + 1)
```

重点：

- 只看 rank
- 不比较 cosine 和 ts_rank_cd 的 raw score
- 多个 lane 都靠前的文档自然更靠前
- 默认 k=60 平滑排名差异
- 当前实现还会记录命中的 lane、representation type 和 query variant，方便 trace/debug

### Q5: sub-300ms 怎么证明？

答：

> 我会先讲设计：query class gating、metadata hard/soft filter、bounded variants/topK、parallel lanes、reranker fallback、context expansion gate、context packing、Prometheus histogram。然后补证据：如果要说 P95 sub-300ms，需要贴 `rag_search_duration_seconds` 的 Grafana/Prometheus 数据或 benchmark output。仓库里有 offline quality gate，但那不是 live latency 证据，所以没有证据时不要把数字说死。

### Q6: reranker 挂了怎么办？

答：

> `RerankService` 有 timeout、schema validation 和 fallback。如果 sidecar 不可用、超时或返回 malformed response，就按 RRF score 返回 topK，并在 trace/metrics 里留下 fallback reason。质量可能下降，但 retrieval 不会整体失败。

### Q7: 为什么 BullMQ，不用 Kafka？

答：

> v1 任务是 document vectorization、news enrichment、analysis stage execution。这些是 Redis-backed job queue 很适合的任务。项目已经依赖 Redis，BullMQ 有 retry/backoff/jobId/concurrency，复杂度低。Kafka 更适合事件流和多消费者日志，不是当前 ingestion v1 的必要复杂度。

### Q8: 两个 execute 同时到达怎么防重？

答：

> pending commit 存在 Redis，execute 用 `GETDEL` 原子消费。两个请求同时来，只有一个拿到 commit。另一个拿到 null。之后 wallet commitHistory 还会检查 hash，防止 replay。

### Q9: 交易执行最难的 failure mode 是什么？

答：

> broker order 已提交但服务在写本地 wallet/event 前宕机。这时系统避免了 double execution，但本地状态可能落后 broker。未来要用 saga 事件和 reconciliation job 修复 started-without-completed 的执行。

### Q10: 为什么 SSE？

答：

> 因为 chat completion 是一次请求对应一个 server-to-client stream。SSE 简单、HTTP-friendly、proxy 兼容好、完成后自然关闭。WebSocket 适合持续双向通信，不是这个路径的最小需求。

### Q11: compaction 丢数字怎么办？

答：

> 当前 compaction 是有损的。原文仍存在数据库，但 prompt 只带 summary 和 recent window。更强方案是 summary + vector recall，从老消息里召回和当前问题相关的原文。

### Q12: event log 积累很多后怎么 replay？

答：

> 当前 event log 更偏 audit/timeline，不是唯一 primary state。正常读走 materialized tables。Replay 通过 user 和 seqNo 增量读取；如果未来需要大量事件恢复业务状态，应加 snapshot 或 aggregate projection。

### Q13: 你会优先补哪些生产化能力？

答：

- RAG representative latency benchmark
- live API RAG eval gate，替代当前 offline CorpusRetriever gate
- GraphRAG relation extraction 的真实 sidecar 输出
- scanned PDF / OCR ingestion strategy
- real Redis rate-limit load test
- broker saga reconciliation
- multi-instance SSE pub/sub or durable replay
- structured tool-call journal
- package dependency boundary lint
- benchmark evidence docs for resume数字

### Q14: 最重要的工程取舍是什么？

答：

> stage-level checkpoint，而不是 tool-call-level checkpoint。它提供了足够的可恢复性和审计性，同时避免 v1 就构建过重 workflow engine。

### Q15: 简历技术栈怎么更准确？

当前简历写 `Vercel AI SDK` 有被追问风险。更准确版本：

> TypeScript, NestJS, internal AI runtime with typed tool orchestration, PostgreSQL/pgvector, Redis, BullMQ, Docker, Node.js.

如果想保留历史迁移亮点：

> Migrated Vercel AI SDK-style typed tool orchestration into an internal `@finsentinel/ai-runtime` package with mechanical import guardrails.

## 9. 学习 Drill

### Drill 1: 画全链路

闭卷画：

```text
Chat request
  -> upgrade planner
  -> analysis run
  -> BullMQ
  -> orchestrator
  -> teams
  -> checkpoints
  -> order drafts
  -> approval
  -> trading stage/commit/execute
```

然后给每个节点标一个文件。

### Drill 2: 60 秒解释 RAG

背这个版本：

> 文档进入 BullMQ 后会解析成 Markdown，按文档类型 chunk，写 canonical embedding 和 search_vector；可选 enrichment 会生成 contextual_text、sample_question、summary、keyword_entity 等 representation。查询时 planner 先判断 exact_lookup、factoid、relational、analytical 或 multi_part，决定 rewrite/HyDE/subquery 是否能用。orchestrator 再用 metadata hints 跑 dense representation lane 和 sparse canonical+representation lane，RRF 融合，reranker 可选提升精度，失败时回退到 RRF。最后按 query class 做可选 context expansion，并由 context packer 做去重、source diversity 和 token budget 控制。

### Drill 3: 60 秒解释交易防重

背这个版本：

> Stage 用 Redis Lua 原子追加，避免并发写覆盖。Commit 把 staged ops 变成带 SHA-256 hash 的 pending commit。Execute 用 Redis GETDEL 原子消费 pending commit，只有一个请求能拿到。Wallet commitHistory 再用 hash 做 idempotency check。这个设计优先防止重复下单。

### Drill 4: 主动讲一个缺陷

任选一个：

- RAG sub-300ms 需要 benchmark/Grafana 证据。
- 当前 RAG quality gate 仍是 offline CorpusRetriever，不等于 live API pipeline。
- Graph lane 有 schema/service/worker，但 relation extraction 和默认 online activation 还不成熟。
- PDF parser 是 pdfplumber text extraction，不是 OCR。
- SSE 150 concurrency 是 in-process，不是生产压测。
- Rate limit 1k/min 是 mock Redis benchmark。
- Chat compaction 是有损的。
- Broker execution 需要 saga reconciliation。

回答公式：

1. 当前怎么做。
2. 局限在哪里。
3. 下一步怎么补。

### Drill 5: 代码定位

能在 30 秒内找到：

1. RRF 公式。
2. Redis Lua rate limiter。
3. Redis Lua trading stage append。
4. Redis `GETDEL` execute。
5. Role tool scope。
6. Order draft schema。
7. SSE frame。
8. Chat compaction benchmark。
9. Agent event idempotency index。
10. No Vercel AI SDK import check。

## 最终心智模型

不要把这个项目讲成 "LLM 加几个金融 API"。

更强的讲法是：

> 这是一个 typed, auditable, human-in-the-loop financial workflow system。LLM 负责理解请求、收集证据、调用受限工具、生成结构化草案；真正影响 durable financial state 的路径由 schema、role scope、stage checkpoint、approval record、Redis atomic operation 和 append-only event log 控制。
