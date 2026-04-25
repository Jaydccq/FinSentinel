# PRD: 平台层 bootstrap 与模块作用域整理

日期：2026-04-23
状态：Draft
优先级：P2

## 1. 问题

API 进程的「外壳」与「模块装载策略」积累了一些早期决定，开始放大启动依赖与故障面：

1. `apps/api/src/main.ts:11-15` 的 CORS 是固定 localhost origin；没有 helmet / compression / requestId 中间件。
2. `apps/api/src/app.module.ts:45-50` 把 OpenBB、OKX、Queue 等外部集成模块全 eager import；注释明确写「always imported, services internally guard via config.enabled」。
3. 全局异常过滤已经有 `GlobalExceptionFilter`，但缺乏请求上下文（trace id、user id）注入，日志查找困难。

这些不是 P0，但会在如下三种场合放大成本：

- 部署到不同环境（CORS 写死要 patch 镜像）。
- 增加新可选集成（要继续往 `imports[]` 末端追加）。
- 排障（同一时段日志挤在一起，无 trace id）。

## 2. 当前代码落点

- `apps/api/src/main.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/common/filters/global-exception.filter.ts`

## 3. 目标

1. CORS、安全头、压缩由 env 配置驱动。
2. 每个请求带稳定 `requestId`，进入日志、SSE、agent_events。
3. 可选集成模块（OpenBB / OKX / Queue / 6551 News / Twitter）通过 `forRootAsync` / dynamic module + feature flag 装载，关闭即不装。
4. 现有功能行为不变。

## 4. 非目标

- 不切换 NestJS 主体框架。
- 不引入服务网格 / sidecar / OpenTelemetry exporter（留给后续 PRD）。

## 5. 方案

### 5.1 Bootstrap 强化

```ts
const allowList = env.CORS_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.enableCors({ origin: allowList, credentials: true });
app.use(helmet());
app.use(compression());
app.use(requestIdMiddleware()); // 生成或透传 X-Request-Id
```

`requestIdMiddleware` 写一个本地实现：若 header 已带 `X-Request-Id` 则透传，否则生成 ULID；注入 `nestjs-pino` 或现有 logger 的 child context。

### 5.2 Dynamic Modules

例：

```ts
@Module({})
export class OpenBbModule {
  static register(config: OpenBbConfig): DynamicModule {
    if (!config.enabled) return { module: OpenBbModule };
    return {
      module: OpenBbModule,
      providers: [OpenBbService, ...],
      exports: [OpenBbService],
    };
  }
}
```

`AppModule` 中：

```ts
OpenBbModule.register({ enabled: env.OPENBB_ENABLED }),
OkxModule.register({ enabled: env.OKX_ENABLED }),
NewsModule.register({ cryptoNewsEnabled: env.APP_CRYPTO_NEWS_ENABLED }),
```

服务层不再「先 inject 再 if (enabled) return」；调用方按是否注入到判断能力存在。

### 5.3 异常过滤增强

`GlobalExceptionFilter` 在响应里加 `X-Request-Id` 头，并把 `requestId` 写入错误日志结构化字段。

## 6. 验收标准

1. `CORS_ORIGINS=https://a,https://b` 启动后只有这两个 origin 通过；未列入的被拒。
2. 任意请求响应都带 `X-Request-Id`；日志中可以用同 id 找到 controller / service / agent_event 三层。
3. `OPENBB_ENABLED=false` 启动时，`OpenBbService` provider 不在容器里；调用 `nest-test` 检查。
4. 启动时间相比当前不出现明显回归（< +5%）。

## 7. 风险

- 改 dynamic module 需要触碰每个集成模块的 import 链，回归面较大；建议一次只改 1-2 个模块。

## 8. Implementation Progress Log

- 2026-04-24: branch `feat/2026-04-23-platform-bootstrap` opened.
- 2026-04-24: implemented Tasks 1–3 per `docs/exec-plans/2026-04-23-platform-bootstrap.md`.
  - Task 1: added `helmet` + `compression` deps + a Node `randomUUID`-based `requestIdMiddleware` that reads/generates `X-Request-Id`. 3 unit tests green.
  - Task 2: wired `requestIdMiddleware` (first), `helmet({ contentSecurityPolicy: false, hsts: false })`, `compression()`, then existing `cookieParser` + CORS into `main.ts`. CSP + HSTS deferred until web + desktop QA passes.
  - Task 3: `GlobalExceptionFilter` echoes `X-Request-Id` and includes `requestId` in unhandled-exception logs. Side fix: `WatchlistModule` (added in P1-2) was missing `AuthModule` import — `JwtGuard` couldn't resolve `JwtService` at bootstrap. Integration tests caught it on this branch; fixed in same commit.
- Verification: `pnpm --filter @finsentinel/api typecheck` clean; full suite `1539 / 1540` green (1 skipped, 0 failed).
- Deferred (per the Out-of-Scope section at the top of the exec plan):
  - Dynamic `Module.register()` refactor for OpenBB / OKX / Queue / News / Twitter optional integrations.
  - Helmet CSP / HSTS — wait for web + desktop QA before turning on.
  - Replacing the built-in NestJS Logger with `nestjs-pino`.
- helmet 默认会动 CSP / HSTS，可能影响 SSE / 文件下载；需要在 web/desktop QA 一遍。
