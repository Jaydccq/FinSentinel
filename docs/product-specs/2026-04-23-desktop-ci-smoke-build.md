# PRD: 桌面端持续集成冒烟构建

日期：2026-04-23
状态：Draft
优先级：P2

## 1. 问题

`apps/desktop/`（Tauri 2.x + Rust 私有索引器）是仓库里完整的子工程，但默认 CI 路径不会构建它：

- `package.json` 第 9 / 12 行：`build` 与 `test` 默认带 `--filter=!@finsentinel/desktop`。
- `.github/workflows/` 中没有任何 desktop 相关 job。
- 仓库里有 `apps/desktop/src-tauri/`，构建 / 依赖升级时如果有人忘记跑 `build:all`，问题只会在正式打包时爆。

桌面端依赖 Rust 工具链与 Web 静态导出（`NEXT_PUBLIC_TAURI=1`）的协同，最容易踩的就是「无人构建 = 偷偷坏掉」。

## 2. 当前代码落点

- 根 `package.json:9, 12`
- `.github/workflows/ci.yml`
- `apps/desktop/package.json`
- `apps/desktop/src-tauri/`

## 3. 目标

1. 至少有一条计划性 CI（nightly 或 PR-on-touch）确认桌面端能编译并完成 smoke。
2. 默认 `pnpm build` / `pnpm test` 仍然排除 desktop（保留快速 PR 反馈）。
3. 当 `apps/desktop/`、`apps/web/`、`packages/shared` 任一目录被改时，PR 强制触发桌面 smoke。

## 4. 非目标

- 不构建带签名的发行版（DMG / MSI / AppImage）。
- 不在 CI 中跑桌面端的真实 GUI；只跑 build + headless smoke。

## 5. 方案

### 5.1 GitHub Actions

**决议（codex consult 2026-04-23）：默认 `ubuntu-latest` 在 PR 上跑（廉价持续压力），`macos-latest` 在 nightly 跑（捕捉 Apple-specific 漂移）。任何 PR 改动到桌面构建配置 / native binding / packaging 时立即触发 macOS smoke，不必等 nightly。**

`.github/workflows/desktop-smoke.yml`：

```yaml
name: desktop-smoke
on:
  pull_request:
    paths:
      - 'apps/desktop/**'
      - 'apps/web/**'
      - 'packages/shared/**'
      - '.github/workflows/desktop-smoke.yml'
  schedule:
    - cron: '0 4 * * *'  # 每天 04:00 UTC

jobs:
  pr-smoke:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - uses: dtolnay/rust-toolchain@stable
      - run: sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @finsentinel/web build
        env:
          NEXT_PUBLIC_TAURI: '1'
          NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8080'
      - run: pnpm --filter @finsentinel/desktop tauri build --debug --no-bundle
      - run: pnpm --filter @finsentinel/desktop test

  nightly-mac:
    if: github.event_name == 'schedule'
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - uses: dtolnay/rust-toolchain@stable
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @finsentinel/web build
        env:
          NEXT_PUBLIC_TAURI: '1'
          NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8080'
      - run: pnpm --filter @finsentinel/desktop tauri build --debug --no-bundle
      - run: pnpm --filter @finsentinel/desktop test

  pr-mac-on-touch:
    # 即时触发条件：PR 改动到桌面构建配置 / Rust 端 / 打包脚本
    if: github.event_name == 'pull_request'
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - id: changes
        uses: dorny/paths-filter@v3
        with:
          filters: |
            critical:
              - 'apps/desktop/src-tauri/**'
              - 'apps/desktop/tauri.conf.json'
              - 'apps/desktop/package.json'
              - 'apps/desktop/scripts/**'
      - if: steps.changes.outputs.critical == 'true'
        uses: pnpm/action-setup@v3
      - if: steps.changes.outputs.critical == 'true'
        uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - if: steps.changes.outputs.critical == 'true'
        uses: dtolnay/rust-toolchain@stable
      - if: steps.changes.outputs.critical == 'true'
        run: pnpm install --frozen-lockfile
      - if: steps.changes.outputs.critical == 'true'
        run: pnpm --filter @finsentinel/web build
        env:
          NEXT_PUBLIC_TAURI: '1'
          NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8080'
      - if: steps.changes.outputs.critical == 'true'
        run: pnpm --filter @finsentinel/desktop tauri build --debug --no-bundle
```

### 5.2 Smoke 脚本

`apps/desktop/scripts/smoke.ts`：

- 启动 `tauri dev --no-watch`（或 mock NestJS）。
- 用 `@tauri-apps/api` 触发一次 IPC 命令验证 Rust ↔ Web 通道。
- 退出后断言无 panic、无 unhandled rejection。

### 5.3 责任与告警

- nightly job 失败时通过 GitHub annotation 与 webhook 通知 #builds 频道。
- README 与 `apps/desktop/README.md` 记录「如何在本机复现 smoke」。

## 6. 验收标准

1. PR 改动 `apps/web/src/api/client.ts` 时，desktop-smoke job 自动触发；改动 `docs/` 不触发。
2. 桌面端构建失败会阻塞合入对应 PR（required check 设为 desktop-smoke）。
3. nightly 至少跑过 7 天，任何回归都能在 24 小时内被捕获。

## 7. 风险

- macOS runner 时长比 ubuntu 高，需要预算；可考虑 ubuntu-latest 作为主 runner，macOS 仅 nightly。
- Rust 依赖首次拉取较慢，需配置 `cargo` cache。
- Tauri build 在无 webview 的 runner 上需要安装 `webkit2gtk`，写入 README。
