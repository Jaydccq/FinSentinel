# Exec Plan: Desktop CI Smoke (P2 slice)

> **For agentic workers:** REQUIRED SUB-SKILL — superpowers:executing-plans.

**Source PRD:** `docs/product-specs/2026-04-23-desktop-ci-smoke-build.md`
**Branch:** `feat/2026-04-23-desktop-ci-smoke`
**Goal:** Stop the Tauri desktop path from rotting silently. Default `pnpm build/test` excludes `@finsentinel/desktop` for fast PR feedback; this slice adds a dedicated CI job that always exercises the desktop build.
**Approach:** New GitHub Actions workflow `.github/workflows/desktop-smoke.yml` per the codex consult on 2026-04-23 — `ubuntu-latest` on every PR + nightly `macos-latest` cron + `macos-latest` immediate trigger when build config / native bindings / packaging files change.

## Out of scope

- Producing signed release artifacts (DMG / MSI / AppImage).
- Adding a runtime smoke that drives the actual GUI / Tauri IPC. Today `apps/desktop/test` is a stub; building is enough signal that the desktop path didn't rot.
- Replacing the existing `pnpm build/test` filter exclusion. Keeping fast PR feedback as the default; the new workflow is what catches the desktop path.

## File Map

| Path                                                      | Role                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| `.github/workflows/desktop-smoke.yml`                     | NEW — three jobs (PR ubuntu, nightly macOS, on-touch macOS). |
| `docs/product-specs/2026-04-23-desktop-ci-smoke-build.md` | MODIFY — append progress log.                                |
| `.gitignore`                                              | MODIFY — whitelist this exec plan.                           |

## Tasks

### Task 1: write the workflow

- [ ] Create `.github/workflows/desktop-smoke.yml`:

```yaml
name: desktop-smoke

on:
  pull_request:
    branches: [main]
    paths:
      - 'apps/desktop/**'
      - 'apps/web/**'
      - 'packages/shared/**'
      - '.github/workflows/desktop-smoke.yml'
  schedule:
    # Nightly at 04:00 UTC (low-traffic window).
    - cron: '0 4 * * *'
  workflow_dispatch:

concurrency:
  group: desktop-smoke-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # Cheap PR check — every PR that touches desktop, web, or shared.
  pr-smoke-ubuntu:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.30.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - uses: dtolnay/rust-toolchain@stable
      - name: Install Tauri Linux deps
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
      - run: pnpm install --frozen-lockfile
      - name: Build web (Tauri export)
        run: pnpm --filter @finsentinel/web build
        env:
          NEXT_PUBLIC_TAURI: '1'
          NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8080'
      - name: Build desktop (debug, no bundle)
        run: pnpm --filter @finsentinel/desktop tauri build --debug --no-bundle
      - run: pnpm --filter @finsentinel/desktop test

  # Nightly macOS — catches Apple-specific Tauri / signing / packaging drift.
  nightly-mac:
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    runs-on: macos-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.30.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - uses: dtolnay/rust-toolchain@stable
      - run: pnpm install --frozen-lockfile
      - name: Build web (Tauri export)
        run: pnpm --filter @finsentinel/web build
        env:
          NEXT_PUBLIC_TAURI: '1'
          NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8080'
      - name: Build desktop (debug, no bundle)
        run: pnpm --filter @finsentinel/desktop tauri build --debug --no-bundle
      - run: pnpm --filter @finsentinel/desktop test

  # Immediate macOS smoke when a PR touches build config / Rust / packaging.
  pr-smoke-mac-on-touch:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest # the filter step doesn't need a mac runner
    timeout-minutes: 30
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
      - name: Trigger macOS build (in-line)
        if: steps.changes.outputs.critical == 'true'
        # Re-run the same install + build sequence on macOS via composite action
        # would be ideal; for V1 we just fail-closed on critical paths and ask
        # the dev to run the nightly workflow_dispatch from the Actions tab.
        run: |
          echo "::error::PR touches Tauri-critical files (src-tauri / tauri.conf.json / desktop package.json)."
          echo "::error::Run the desktop-smoke workflow on macOS-latest before merging:"
          echo "::error::  gh workflow run desktop-smoke --ref ${{ github.head_ref }}"
          exit 1
```

- [ ] Sanity-check the YAML locally:

```
yq eval '.jobs | keys' .github/workflows/desktop-smoke.yml
```

If `yq` isn't installed, just verify `cat`. The runtime correctness lands on the next push — Actions reports the schema validation immediately.

- [ ] Commit: `ci(desktop): smoke workflow (ubuntu PR + macOS nightly + on-touch gate)`.

### Task 2: append PRD progress log + whitelist

- [ ] Append `## 8. Implementation Progress Log` section.
- [ ] Whitelist `docs/exec-plans/2026-04-23-desktop-ci-smoke.md` in `.gitignore`.
- [ ] Commit: `docs(ci): log desktop-smoke implementation progress`.

## Self-Review

- Spec coverage: §5.1 GitHub Actions matrix → Task 1 (codex-validated). §5.2 smoke script — explicitly out-of-scope; build is sufficient signal in V1. §5.3 README guidance — deferred (PRD §5.3 mentions runbook updates; we'll add when the workflow has run a few times and we know the failure modes).
- No placeholders.
- Verification: schema check + Actions validation on push.
- Scope discipline: pure CI / docs change; no service code touched.

## Risks

- The `pr-smoke-mac-on-touch` job uses an "exit 1 with instructional message" pattern instead of actually running on macOS, because GitHub Actions can't conditionally choose `runs-on` at the job level. A composite action or matrix expansion would be cleaner; doing it that way needs more design. For V1 the failing message is enough to force the dev to run the macOS workflow manually.
- Tauri 2.x Linux deps list (`libwebkit2gtk-4.1-dev` etc.) follows current Tauri docs; if Tauri bumps to a different webkit version we'll need to update. Track via the nightly job — first failure is the canary.
