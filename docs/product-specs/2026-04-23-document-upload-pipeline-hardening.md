# PRD: 文档上传链路稳定性加固

日期：2026-04-23
状态：Draft
优先级：P1

## 1. 问题

当前 `POST /documents` 上传链路在内存占用、失败一致性与生产路径上有四个相互叠加的弱点：

1. **整体进内存**：`@UseInterceptors(FileInterceptor('file'))` + `file.buffer` 把整份文件读入 Node 进程内存，单个大 PDF 即可造成峰值 RSS 抬升。
2. **storage 与 DB 无补偿**：先 `storage.upload()` 写对象存储，再 `db.insert()`；若 DB 失败没有任何回滚，会留下 orphan 对象（`storage.delete` 在仓库内 0 引用）。
3. **同步 fallback 进入请求路径**：当 `vectorizeProducer` 不存在时，parse + chunk + embed 同步执行，导致请求线程承担数十秒 LLM 调用。
4. **`regionId` 硬编码 `'US'`**：同时出现在 DB record（第 94 行）与 vectorization metadata（第 132 行），后续按 region 过滤的 RAG 查询将失真。

## 2. 当前代码落点

- `apps/api/src/document/document.controller.ts:57` —— `FileInterceptor('file')`
- `apps/api/src/document/document.controller.ts:70` —— `buffer: file.buffer`
- `apps/api/src/document/document-upload.service.ts:82` —— `storage.upload(...)`
- `apps/api/src/document/document-upload.service.ts:86–100` —— DB insert
- `apps/api/src/document/document-upload.service.ts:94` —— `regionId: 'US'`
- `apps/api/src/document/document-upload.service.ts:110–112` —— async path
- `apps/api/src/document/document-upload.service.ts:115–161` —— sync fallback

## 3. 目标

1. 控制单请求内存峰值，避免大文件上传导致 OOM。
2. 任意一步失败后，存储层与数据库层最终一致：要么都存在，要么都被清理。
3. 生产环境不允许同步向量化路径执行。
4. `regionId` 由元数据驱动，可通过表单字段或解析结果决定。

## 4. 非目标

- 不重写 storage 抽象（继续使用 RustFS / hybrid）。
- 不改变 RAG 下游的 chunk/embed 算法。

## 5. 方案

### 5.1 流式或限流

短期：在 controller 上加 `MulterModule` 的 `limits.fileSize`（例如 50 MB），超过返回 413。

中期：把上传改为 `request.pipe()` 直接到 storage 的 `createMultipartUpload`，不再经过 `file.buffer`。`@nestjs/platform-express` 支持 `diskStorage` + 流式 reader；更彻底的做法是在 controller 层提供 `presignedUrl`，前端直传 storage，再回调给 API 注册 metadata。

### 5.2 写入顺序与补偿

引入「outbox」做法：

1. 先写 DB 记录（`status: PENDING_UPLOAD`，含 storageKey 占位）。
2. 写入 storage。
3. 标记 DB 记录为 `READY` 并发出 `DocumentUploaded` 事件。
4. 若步骤 2 失败，定时任务 / 同步 catch 把 DB 记录回滚为 `FAILED`，并尝试 `storage.delete(storageKey)`。
5. 若步骤 3 失败，由后台扫描器把 stuck `PENDING_UPLOAD` 修复或清理。

新增 `StorageService.delete(key)`，否则补偿无法实施。

### 5.3 强制异步向量化

- 配置项新增 `documents.requireAsyncVectorize: boolean`，生产环境默认 true。
- `requireAsyncVectorize=true` 且 `vectorizeProducer` 不存在时，启动失败而不是降级到同步路径。
- dev 模式保留同步 fallback，方便本地测试。

### 5.4 regionId 元数据化

- Multipart 表单接受 `regionId` 字段（`US` / `EU` / `APAC` / `GLOBAL` 等）。
- 缺省时由解析器（PDF metadata、URL host、SEC scraper 已知映射）推断。
- 推断失败时落到 `UNKNOWN`，并打 metric，方便后续修。
- DB schema 与 `region_id` 列保持兼容；shared enum 同步更新。

## 6. 验收标准

1. 上传 80 MB PDF 在 controller 层被拒（413），不进入服务。
2. 单测：模拟 storage 成功 / DB 失败 → 最终 storage 中无 orphan 对象（被补偿删除）。
3. 单测：`requireAsyncVectorize=true` + 无 producer → 启动期 throw。
4. 端到端：上传带 `regionId=EU` 的 PDF，落库与向量 metadata 都为 EU；不带字段时使用解析器推断结果。
5. 现有 dev 流程（pnpm dev、docker-compose）行为无回归。

## 7. 风险

- 改成 outbox 之后，前端原本「上传成功 = 立即可见」会变成「上传成功 = 已入队」。需要在 UI 层显示 `READY/PENDING/FAILED` 状态，否则用户体验下降。
- 如果 storage 层不支持幂等的 `delete`，补偿可能在重复触发时报错；需要在 wrapper 层吞 `NotFound`。

## 8. Implementation Progress Log

- 2026-04-24: branch `feat/2026-04-23-document-upload-hardening` opened.
- 2026-04-24: implemented Tasks 1–3 per `docs/exec-plans/2026-04-23-document-upload-hardening.md`.
  - Task 1: typed `rag.documents.requireAsyncVectorize` config (default false).
  - Task 2: compensation `storage.delete` on DB-insert failure; `regionId` parameter added to service signature; sync fallback refused when `requireAsyncVectorize=true` and no producer is bound. 5 new unit tests; full file 22/22 green.
  - Task 3: controller accepts `?regionId=` query param and forwards to service (undefined → service default 'US').
- Verification: typecheck clean. Full API suite shows 1518/1521 passing with 2 pre-existing flakes (`chat-stream.integration.spec.ts` and `cli-import-env.spec.ts`) confirmed on `main` HEAD without these changes.
- Deferred (per the Out-of-Scope section at the top of the exec plan):
  - Streaming/presigned-URL upload (significant refactor; not blocking).
  - Outbox pattern (DB-first PENDING_UPLOAD + reconciler).
  - regionId metadata extraction from PDF headers / SEC scraper inference.
