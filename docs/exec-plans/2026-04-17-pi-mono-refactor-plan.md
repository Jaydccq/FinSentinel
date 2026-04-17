# Pi-Mono Architecture Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate FinSentinel toward a `badlogic/pi-mono`-style package-first architecture while preserving current product behavior.

**Architecture:** FinSentinel will keep `apps/*` as deployable product composition roots and move reusable contracts, domain logic, runtime orchestration, and provider adapters into focused `packages/*` workspaces. The first implementation wave should not replace NestJS, Next.js, Drizzle, pnpm, or Turbo; it should make package boundaries explicit and mechanically enforceable, then prove the pattern on one low-risk vertical slice before broad extraction.

**Tech Stack:** TypeScript, pnpm 10, Turbo, NestJS, Next.js, Vitest, Drizzle, Zod, Python sidecars under `services/*`.

---

## Background

FinSentinel is already a TypeScript monorepo, but most application and domain behavior still lives inside [apps/api](/Users/hongxichen/Desktop/FinSentinel/apps/api). Current reusable packages are limited to [packages/db](/Users/hongxichen/Desktop/FinSentinel/packages/db) and [packages/shared](/Users/hongxichen/Desktop/FinSentinel/packages/shared).

`badlogic/pi-mono` is package-first: the root is small, the main unit of composition is `packages/*`, and package entrypoints such as AI, agent runtime, coding agent CLI, terminal UI, web UI, Slack bot, and pods compose through explicit package dependencies rather than application-local imports. The useful architectural signal is not the exact package names; it is the dependency direction and thin product entrypoints.

## Source-Backed Pi-Mono Signals

Sources checked on 2026-04-17:

- https://github.com/badlogic/pi-mono
- https://raw.githubusercontent.com/badlogic/pi-mono/main/README.md
- https://github.com/badlogic/pi-mono/blob/main/package.json
- https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/agent/package.json
- https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/package.json
- https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/web-ui/package.json

Observed signals:

- `pi-mono` lists packages such as `pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-mom`, `pi-tui`, `pi-web-ui`, and `pi-pods`.
- Root workspaces are primarily `packages/*`, with examples nested under package folders.
- Root scripts centralize `build`, `check`, `test`, and publish workflows.
- `pi-agent-core` depends on `pi-ai`.
- `pi-coding-agent` depends on `pi-agent-core`, `pi-ai`, and `pi-tui`.
- `pi-web-ui` depends on reusable libraries instead of importing from an app.
- The root build script orders package builds directly by dependency shape.

## Current FinSentinel Facts

Repository facts from local inspection:

- Root workspace includes `apps/*` and `packages/*` in [pnpm-workspace.yaml](/Users/hongxichen/Desktop/FinSentinel/pnpm-workspace.yaml).
- Root scripts in [package.json](/Users/hongxichen/Desktop/FinSentinel/package.json) delegate `build`, `dev`, `test`, `lint`, and `typecheck` to Turbo.
- [turbo.json](/Users/hongxichen/Desktop/FinSentinel/turbo.json) already enforces package build dependencies through `^build`.
- Active app packages are [apps/api](/Users/hongxichen/Desktop/FinSentinel/apps/api), [apps/web](/Users/hongxichen/Desktop/FinSentinel/apps/web), and [apps/desktop](/Users/hongxichen/Desktop/FinSentinel/apps/desktop).
- Current package layer is [packages/db](/Users/hongxichen/Desktop/FinSentinel/packages/db) and [packages/shared](/Users/hongxichen/Desktop/FinSentinel/packages/shared).
- API source contains many domains directly: `agent`, `analysis`, `auth`, `autonomy`, `chat`, `document`, `events`, `market`, `mcp`, `news`, `okx`, `openbb`, `portfolio`, `quant`, `queue`, `rag`, `report`, `research`, `scraper`, `storage`, `trading`, `twitter`, and `watchlist`.
- Python sidecars exist under [services/evaluation-runner](/Users/hongxichen/Desktop/FinSentinel/services/evaluation-runner) and [services/reranker](/Users/hongxichen/Desktop/FinSentinel/services/reranker).
- Top-level directories outside the active workspace surface exist: `app`, `backend`, `dashboard`, `ev2`, `opennews-mcp`, `opentwitter-mcp`, `modes`, `memory`, `templates`, `skills`, and generated build directories.

## Goal

Make FinSentinel package-first:

- `apps/*` become thin composition roots.
- Reusable domain logic lives under focused internal packages.
- Provider integrations are isolated from API transport and UI concerns.
- Dependency direction is documented and enforced by tooling.
- Existing behavior is preserved through targeted tests and workspace checks.

## Scope

In scope:

- Write the target architecture and phased migration path.
- Define package families and dependency rules.
- Identify the first extraction wave.
- Define verification gates for each phase.
- Capture engineering review findings and unresolved decisions in this file.

Out of scope for this planning task:

- Moving production code.
- Changing database schema.
- Replacing NestJS, Next.js, Tauri, Drizzle, pnpm, Turbo, or Vitest.
- Rewriting Python sidecars in TypeScript.
- Publishing any new external npm package.

## Assumptions

- The request means "adopt the pi-mono architectural pattern" rather than "copy every package and tool from pi-mono."
- Product behavior should remain stable throughout the migration.
- FinSentinel should preserve `apps/*` because it already has API, web, and desktop product surfaces.
- pnpm + Turbo remain in wave 1 because they already provide workspace orchestration.
- A staged strangler migration is safer than a big-bang rewrite.

## Uncertainties

- Whether toolchain parity with `pi-mono` is desired after structural migration.
- Whether `apps/desktop` is a supported product surface or experimental.
- Whether Python sidecars should stay as `services/*` or be promoted into `apps/*`.
- Which root-level non-workspace directories are active, generated, archived, or obsolete.

## Success Criteria

- New package boundaries are documented in this plan and in a repo architecture note.
- Boundary checks fail if a package imports from `apps/*`.
- One pilot domain extraction is implemented and verified without behavior changes.
- Existing API tests for the pilot domain still pass.
- `pnpm typecheck` passes after each extraction wave.
- App controllers/modules become thinner; business logic moves behind package entrypoints.
- Root documentation tells a newcomer which apps, packages, sidecars, and legacy directories are supported.

## Step 0: Scope Challenge

### What already solves parts of this

- [packages/shared](/Users/hongxichen/Desktop/FinSentinel/packages/shared) already centralizes Zod schemas, enums, and shared utilities.
- [packages/db](/Users/hongxichen/Desktop/FinSentinel/packages/db) already centralizes Drizzle schema and migrations.
- [turbo.json](/Users/hongxichen/Desktop/FinSentinel/turbo.json) already supports dependency-aware workspace builds.
- Existing `*.spec.ts` files under [apps/api/src](/Users/hongxichen/Desktop/FinSentinel/apps/api/src) provide slice-level regression coverage for several candidate domains.
- [README.md](/Users/hongxichen/Desktop/FinSentinel/README.md) already acts as a concise top-level map, but it omits desktop, services, and legacy top-level directory status.

### Minimum viable path

Do not rewrite the repository. Do this instead:

1. Document active workspace ownership.
2. Add mechanical import-boundary checks.
3. Extract one low-risk domain package.
4. Repeat only after the extraction pattern passes typecheck and tests.

### Complexity check

The full target architecture will touch more than 8 files and introduce more than 2 packages, so it is a scope-smell if attempted as one PR. The implementation must be split into waves. This plan treats "complete replacement" as a migration program, not a single code change.

### Search check

- **[Layer 1]** Use current pnpm + Turbo workspace orchestration because it already exists and has dependency-aware build semantics.
- **[Layer 1]** Use TypeScript path/package exports plus ESLint or dependency-cruiser for boundary enforcement instead of a custom import scanner if dependency-cruiser integrates cleanly.
- **[Layer 2]** Consider Biome parity with `pi-mono` only after structural migration; it is not a first-wave requirement.
- **[Layer 3]** The durable rule is dependency direction: foundational packages -> domain packages -> runtime packages -> product apps.

### Completeness check

The complete but still reversible version is to add boundary rules before moving code. Skipping boundary enforcement would save little time and would make the migration brittle.

### Distribution check

This plan creates internal workspace packages only. External distribution, npm publishing, binary packaging, and package release automation are explicitly not in scope for wave 1.

## Target Architecture

### Package map

```text
FinSentinel
├── apps/
│   ├── api/              # NestJS composition root
│   ├── web/              # Next.js composition root
│   └── desktop/          # Desktop composition root, status to confirm
├── packages/
│   ├── shared/           # Existing shared schemas/enums/utils
│   ├── db/               # Existing persistence schema/migrations
│   ├── config/           # Typed config parsing and defaults
│   ├── watchlist/        # Pilot domain candidate
│   ├── portfolio/        # Later low-coupling domain
│   ├── market-data/      # Market domain plus provider-neutral models
│   ├── news/             # Feed normalization and source contracts
│   ├── research/         # Research orchestration contracts
│   ├── trading/          # Broker-neutral trading domain
│   ├── rag/              # Retrieval/chunking/indexing runtime
│   ├── analysis-runtime/ # High-coupling agent/analysis orchestration
│   └── integrations-*/   # Provider-specific adapters
└── services/
    ├── evaluation-runner/ # Python sidecar, explicit deployable
    └── reranker/          # Python sidecar, explicit deployable
```

### Dependency direction

```text
             apps/api       apps/web       apps/desktop       services/*
                │              │               │                 │
                └──────────────┴───────────────┴─────────────────┘
                                      │
                         runtime/orchestration packages
                    analysis-runtime, rag, chat-runtime, trading
                                      │
                              domain packages
                watchlist, portfolio, market-data, news, research
                                      │
                           foundation packages
                         shared, db, config, test-fixtures
```

Rules:

- Packages must not import from `apps/*`.
- Provider adapters must not own HTTP controllers, Next.js components, or NestJS modules.
- Apps may import package entrypoints, not package internals.
- Domain packages may depend on `shared`, `db`, and `config`, but not on apps.
- Runtime packages may orchestrate domain packages, queues, and provider adapters.

## Recommended Migration Order

1. Repository inventory and boundary rules.
2. Foundation packages: `config`, clarified `shared` entrypoints, optional `test-fixtures`.
3. Pilot extraction: `watchlist`.
4. Low-coupling domains: `portfolio`, `market-data`.
5. Medium-coupling domains: `news`, `research`, `document`, `storage`, selected trading adapters.
6. High-coupling runtime: `rag`, `chat`, `analysis-runtime`, `agent`, `autonomy`, `events`, `queue`.
7. Sidecar status decision and documentation.
8. Optional toolchain convergence decision.

## Architecture Review

### Issue 1: Big-bang replacement is too risky

Recommendation: Use a staged strangler migration. It matches the existing repo and makes each wave verifiable.

Tradeoff:

- 1A) Staged migration, recommended. Human: weeks; CC: several focused sessions. Risk: low. Completeness: 9/10.
- 1B) Big-bang rewrite. Human: months; CC: still high-risk. Risk: high. Completeness: 4/10 because behavior preservation is hard to prove.

Decision recorded for this plan: choose 1A unless the user explicitly asks for a rewrite despite risk.

### Issue 2: Toolchain parity would distract from architecture

Recommendation: Keep pnpm + Turbo in wave 1. Revisit Biome/npm-workspace parity after package boundaries are stable.

Tradeoff:

- 2A) Keep pnpm + Turbo first, recommended. Human: low; CC: low. Risk: low. Completeness: 9/10.
- 2B) Switch tooling during extraction. Human: medium; CC: medium. Risk: medium. Completeness: 6/10 because failures mix structural and tooling causes.

Decision recorded for this plan: choose 2A.

### Issue 3: Sidecars are architecture citizens

Recommendation: Keep Python sidecars under `services/*` in wave 1, but document them as supported deployables and define their package/API boundaries.

Tradeoff:

- 3A) Keep and document sidecars, recommended. Human: low; CC: low. Risk: low. Completeness: 8/10.
- 3B) Rewrite sidecars into TypeScript packages. Human: high; CC: high. Risk: high. Completeness: 5/10 for first wave.

Decision recorded for this plan: choose 3A pending user confirmation.

## Code Quality Review

Findings:

- The main code quality risk is circular dependency creation during extraction.
- The second risk is duplicating schema definitions if `packages/shared` is split too early.
- The third risk is moving NestJS-specific DI code into domain packages, making packages app-aware.

Rules for implementation:

- Extract pure domain functions and provider-neutral services first.
- Keep NestJS controllers and modules inside `apps/api`.
- Keep schemas in `packages/shared` until there is a proven need for `packages/contracts`.
- Add package entrypoints before consumers start importing moved internals.
- Do not rename domains and move files in the same task unless the rename is required by the package name.

## Test Review

Detected framework:

- Node/TypeScript workspace.
- Vitest in API, web, shared, and db packages.
- NestJS test utilities in [apps/api](/Users/hongxichen/Desktop/FinSentinel/apps/api).

### Coverage diagram for the migration plan

```text
CODE PATH COVERAGE
==================
[+] Boundary rule addition
    ├── [GAP] package imports app code -> check must fail
    ├── [GAP] app imports package entrypoint -> check must pass
    └── [GAP] package deep-import policy -> check must catch disallowed internals if enabled

[+] Pilot package extraction: watchlist
    ├── [★★ TESTED] current service behavior exists in apps/api/src/watchlist/__tests__
    ├── [GAP] package-level tests for extracted pure/domain behavior
    ├── [GAP] API module still wires service through package entrypoint
    └── [GAP] no behavior drift after moving imports

[+] Foundation config package
    ├── [GAP] valid environment parses to typed config
    ├── [GAP] invalid environment reports exact missing/invalid keys
    └── [GAP] API consumes typed config without importing package internals

[+] Repository inventory documentation
    ├── [GAP] active apps/packages/services documented
    └── [GAP] legacy/generated directories classified

USER FLOW COVERAGE
==================
[+] Developer changes package code
    ├── [GAP] `pnpm typecheck` catches boundary/type errors
    └── [GAP] targeted package test runs without booting API

[+] API behavior after pilot extraction
    ├── [GAP] existing watchlist endpoints keep same request/response behavior
    └── [GAP] auth/security behavior stays covered by existing API tests

────────────────────────────────────────
COVERAGE: 1/14 paths currently identified as already covered
Code paths: 1/10
User flows: 0/4
QUALITY: ★★★: 0  ★★: 1  ★: 0
GAPS: 13 paths need tests or mechanical checks
────────────────────────────────────────
```

### Required verification by wave

- Boundary wave: run the boundary rule against at least one intentional failing fixture or sample import.
- Foundation package wave: add package-level Vitest tests before app rewiring.
- Pilot extraction wave: run package tests, API watchlist tests, and `pnpm typecheck`.
- Broad extraction waves: add tests for every moved branch before moving consumers.

## Performance Review

Current plan should not add runtime work. Performance risks come from extraction mistakes:

- Recreating database clients inside packages instead of passing existing DB dependencies from app composition.
- Moving cache or queue logic without preserving singleton/lifecycle behavior.
- Adding cross-package wrappers that duplicate serialization or validation work.
- Introducing N+1 queries while separating API controllers from domain services.

Performance rule:

- Package extraction must preserve existing DB access patterns unless a specific task has tests proving a behavior-preserving optimization.

## Failure Modes

| New path | Realistic failure | Test required | Error handling expectation | User impact if missed |
| --- | --- | --- | --- | --- |
| Boundary check | Check misses app-to-package cycle | Intentional failing import fixture | CI fails clearly | Hidden circular dependencies |
| `packages/config` | Missing env var silently defaults | Invalid env test | Config parser reports exact key | Misconfigured deploy |
| `packages/watchlist` | API response shape changes after move | Existing API spec plus package tests | Controller keeps current response mapping | Broken frontend calls |
| Provider adapter extraction | Adapter starts importing API config directly | Import-boundary check | Adapter accepts typed config dependency | Hard-to-test provider behavior |
| Sidecar documentation | Service omitted from supported surface | README/docs check in review | Docs list run command and boundary | Onboarding/deploy confusion |

Critical gaps:

- Boundary checks are not yet present.
- Package-level tests for the first extracted domain do not yet exist.

## Implementation Steps

Each task is intentionally scoped as an independent PR-sized unit. Do not combine structural movement with behavior changes.

### Task 1: Classify Repository Surface

**Files:**

- Modify: [README.md](/Users/hongxichen/Desktop/FinSentinel/README.md)
- Create: [docs/architecture/repository-surface.md](/Users/hongxichen/Desktop/FinSentinel/docs/architecture/repository-surface.md)
- Modify: [docs/exec-plans/2026-04-17-pi-mono-refactor-plan.md](/Users/hongxichen/Desktop/FinSentinel/docs/exec-plans/2026-04-17-pi-mono-refactor-plan.md)

- [ ] **Step 1: Inventory current top-level directories**

Run:

```bash
find . -maxdepth 2 -type d -not -path './node_modules*' -not -path './.git*' | sort
```

Expected: output includes active workspaces, sidecars, observability, docs, and legacy/generated directories.

- [ ] **Step 2: Write repository surface doc**

Create `docs/architecture/repository-surface.md` with these sections:

```markdown
# Repository Surface

## Supported Product Surfaces

- `apps/api`: NestJS API and app-specific composition.
- `apps/web`: Next.js frontend.
- `apps/desktop`: Desktop app surface; confirm supported vs experimental before migration wave 2.

## Supported Internal Packages

- `packages/shared`: Shared schemas, enums, and utilities.
- `packages/db`: Database schema, migrations, and migration helpers.

## Supported Sidecars

- `services/evaluation-runner`: Python evaluation runner.
- `services/reranker`: Python reranker service.

## Observability

- `observability/prometheus`: Prometheus config.
- `observability/grafana`: Grafana provisioning and dashboards.

## Requires Owner Classification

- `app`
- `backend`
- `dashboard`
- `ev2`
- `opennews-mcp`
- `opentwitter-mcp`
- `modes`
- `memory`
- `templates`
- `skills`

## Generated Or Local-Only Surfaces

- `build`
- `.turbo`
- `.pnpm-store`
- IDE and tool cache directories
```

- [ ] **Step 3: Keep README concise**

Update `README.md` to link to `docs/architecture/repository-surface.md` rather than expanding top-level details inline.

- [ ] **Step 4: Verify docs**

Run:

```bash
pnpm typecheck
```

Expected: PASS. Docs-only changes should not affect typecheck.

### Task 2: Add Mechanical Package Boundary Checks

**Files:**

- Modify: [package.json](/Users/hongxichen/Desktop/FinSentinel/package.json)
- Create: [dependency-cruiser.config.cjs](/Users/hongxichen/Desktop/FinSentinel/dependency-cruiser.config.cjs)
- Create: [docs/architecture/package-boundaries.md](/Users/hongxichen/Desktop/FinSentinel/docs/architecture/package-boundaries.md)

- [ ] **Step 1: Add dependency-cruiser**

Run:

```bash
pnpm add -D dependency-cruiser
```

Expected: `package.json` and `pnpm-lock.yaml` update.

- [ ] **Step 2: Add root script**

Update root `package.json` scripts to include:

```json
{
  "scripts": {
    "check:boundaries": "depcruise apps packages --config dependency-cruiser.config.cjs"
  }
}
```

Keep existing scripts unchanged.

- [ ] **Step 3: Add boundary config**

Create `dependency-cruiser.config.cjs`:

```js
module.exports = {
  forbidden: [
    {
      name: 'packages-must-not-import-apps',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'apps-must-not-import-package-src-internals',
      severity: 'warn',
      from: { path: '^apps/' },
      to: { path: '^packages/[^/]+/src/(?!index\\.ts$)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
  },
};
```

- [ ] **Step 4: Document the rules**

Create `docs/architecture/package-boundaries.md`:

```markdown
# Package Boundaries

## Dependency Direction

`packages/shared`, `packages/db`, and future foundation packages sit at the bottom.
Domain packages may depend on foundation packages.
Runtime packages may orchestrate domain packages.
Apps compose packages and expose transport/UI concerns.

## Mechanical Rules

- Packages must not import from `apps/*`.
- Apps should import package public entrypoints instead of package internals.
- Provider adapters should receive config and clients through package APIs, not by importing app modules.

## Verification

Run:

```bash
pnpm check:boundaries
```
```

- [ ] **Step 5: Verify boundary check**

Run:

```bash
pnpm check:boundaries
```

Expected: PASS or only documented warnings for existing deep imports. Any package importing from `apps/*` is a blocking failure.

### Task 3: Add Foundation Config Package

**Files:**

- Modify: [pnpm-workspace.yaml](/Users/hongxichen/Desktop/FinSentinel/pnpm-workspace.yaml)
- Create: [packages/config/package.json](/Users/hongxichen/Desktop/FinSentinel/packages/config/package.json)
- Create: [packages/config/tsconfig.json](/Users/hongxichen/Desktop/FinSentinel/packages/config/tsconfig.json)
- Create: [packages/config/tsconfig.build.json](/Users/hongxichen/Desktop/FinSentinel/packages/config/tsconfig.build.json)
- Create: [packages/config/src/index.ts](/Users/hongxichen/Desktop/FinSentinel/packages/config/src/index.ts)
- Create: [packages/config/src/config-schema.ts](/Users/hongxichen/Desktop/FinSentinel/packages/config/src/config-schema.ts)
- Create: [packages/config/src/config-schema.spec.ts](/Users/hongxichen/Desktop/FinSentinel/packages/config/src/config-schema.spec.ts)

- [ ] **Step 1: Write failing config tests**

Create `packages/config/src/config-schema.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseFinsentinelConfig } from './config-schema';

describe('parseFinsentinelConfig', () => {
  it('parses required runtime configuration', () => {
    const config = parseFinsentinelConfig({
      DATABASE_URL: 'postgres://user:pass@localhost:5432/finsentinel',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'development-secret',
      OPENROUTER_API_KEY: 'openrouter-key',
      POLYGON_API_KEY: 'polygon-key',
    });

    expect(config.databaseUrl).toBe('postgres://user:pass@localhost:5432/finsentinel');
    expect(config.redisUrl).toBe('redis://localhost:6379');
    expect(config.jwtSecret).toBe('development-secret');
  });

  it('reports missing required keys', () => {
    expect(() => parseFinsentinelConfig({})).toThrow(/DATABASE_URL/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @finsentinel/config test
```

Expected: FAIL because the package and implementation do not exist yet.

- [ ] **Step 3: Create package metadata**

Create `packages/config/package.json`:

```json
{
  "name": "@finsentinel/config",
  "version": "0.0.1",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "vitest": "^4.1.2"
  }
}
```

- [ ] **Step 4: Create TypeScript configs**

Create `packages/config/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Create `packages/config/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "module": "CommonJS",
    "moduleResolution": "Node",
    "verbatimModuleSyntax": false
  }
}
```

- [ ] **Step 5: Implement minimal config parser**

Create `packages/config/src/config-schema.ts`:

```ts
import { z } from 'zod';

const finsentinelConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  POLYGON_API_KEY: z.string().min(1),
});

export type FinsentinelConfig = {
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  openrouterApiKey: string;
  polygonApiKey: string;
};

export function parseFinsentinelConfig(env: Record<string, string | undefined>): FinsentinelConfig {
  const parsed = finsentinelConfigSchema.parse(env);

  return {
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    jwtSecret: parsed.JWT_SECRET,
    openrouterApiKey: parsed.OPENROUTER_API_KEY,
    polygonApiKey: parsed.POLYGON_API_KEY,
  };
}
```

Create `packages/config/src/index.ts`:

```ts
export type { FinsentinelConfig } from './config-schema';
export { parseFinsentinelConfig } from './config-schema';
```

- [ ] **Step 6: Verify package**

Run:

```bash
pnpm --filter @finsentinel/config test
pnpm --filter @finsentinel/config typecheck
pnpm typecheck
```

Expected: PASS.

### Task 4: Pilot Extract Watchlist Domain

**Files:**

- Create: [packages/watchlist/package.json](/Users/hongxichen/Desktop/FinSentinel/packages/watchlist/package.json)
- Create: [packages/watchlist/tsconfig.json](/Users/hongxichen/Desktop/FinSentinel/packages/watchlist/tsconfig.json)
- Create: [packages/watchlist/tsconfig.build.json](/Users/hongxichen/Desktop/FinSentinel/packages/watchlist/tsconfig.build.json)
- Create: [packages/watchlist/src/index.ts](/Users/hongxichen/Desktop/FinSentinel/packages/watchlist/src/index.ts)
- Create: [packages/watchlist/src/watchlist-domain.ts](/Users/hongxichen/Desktop/FinSentinel/packages/watchlist/src/watchlist-domain.ts)
- Create: [packages/watchlist/src/watchlist-domain.spec.ts](/Users/hongxichen/Desktop/FinSentinel/packages/watchlist/src/watchlist-domain.spec.ts)
- Modify: [apps/api/package.json](/Users/hongxichen/Desktop/FinSentinel/apps/api/package.json)
- Modify: [apps/api/src/watchlist/watchlist.service.ts](/Users/hongxichen/Desktop/FinSentinel/apps/api/src/watchlist/watchlist.service.ts)

- [ ] **Step 1: Identify pure watchlist logic**

Run:

```bash
sed -n '1,260p' apps/api/src/watchlist/watchlist.service.ts
sed -n '1,260p' apps/api/src/watchlist/__tests__/watchlist.service.spec.ts
```

Expected: list pure validation/mapping/query helper candidates separately from NestJS and DB wiring.

- [ ] **Step 2: Write package tests before moving behavior**

Create `packages/watchlist/src/watchlist-domain.spec.ts` with tests for the exact pure functions selected in Step 1. The first extraction should cover behavior that does not require NestJS DI or a live database.

Required test cases:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeWatchlistSymbol } from './watchlist-domain';

describe('normalizeWatchlistSymbol', () => {
  it('trims and uppercases a symbol', () => {
    expect(normalizeWatchlistSymbol(' aapl ')).toBe('AAPL');
  });

  it('rejects empty symbols', () => {
    expect(() => normalizeWatchlistSymbol('   ')).toThrow(/symbol/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
pnpm --filter @finsentinel/watchlist test
```

Expected: FAIL because package implementation does not exist.

- [ ] **Step 4: Create package metadata**

Create `packages/watchlist/package.json`:

```json
{
  "name": "@finsentinel/watchlist",
  "version": "0.0.1",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@finsentinel/shared": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "vitest": "^4.1.2"
  }
}
```

- [ ] **Step 5: Create TypeScript configs**

Create `packages/watchlist/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Create `packages/watchlist/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "module": "CommonJS",
    "moduleResolution": "Node",
    "verbatimModuleSyntax": false
  }
}
```

- [ ] **Step 6: Implement minimal pure function**

Create `packages/watchlist/src/watchlist-domain.ts`:

```ts
export function normalizeWatchlistSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();

  if (normalized.length === 0) {
    throw new Error('Watchlist symbol is required');
  }

  return normalized;
}
```

Create `packages/watchlist/src/index.ts`:

```ts
export { normalizeWatchlistSymbol } from './watchlist-domain';
```

- [ ] **Step 7: Rewire API service narrowly**

Add `@finsentinel/watchlist` to `apps/api/package.json` dependencies:

```json
{
  "dependencies": {
    "@finsentinel/watchlist": "workspace:*"
  }
}
```

In `apps/api/src/watchlist/watchlist.service.ts`, replace only local symbol normalization logic with:

```ts
import { normalizeWatchlistSymbol } from '@finsentinel/watchlist';
```

Do not move NestJS decorators, module wiring, controller code, or DB client construction in this task.

- [ ] **Step 8: Verify pilot extraction**

Run:

```bash
pnpm --filter @finsentinel/watchlist test
pnpm --filter @finsentinel/watchlist typecheck
pnpm --filter @finsentinel/api test -- src/watchlist
pnpm typecheck
pnpm check:boundaries
```

Expected: PASS.

### Task 5: Write the Repeated Extraction Checklist

**Files:**

- Create: [docs/architecture/package-extraction-checklist.md](/Users/hongxichen/Desktop/FinSentinel/docs/architecture/package-extraction-checklist.md)

- [ ] **Step 1: Create checklist**

Create `docs/architecture/package-extraction-checklist.md`:

```markdown
# Package Extraction Checklist

Use this checklist for every domain extraction.

1. Identify the smallest pure domain behavior that can move without changing runtime behavior.
2. Write package-level tests before moving consumers.
3. Create or update package entrypoints.
4. Rewire app code through the package public entrypoint.
5. Keep framework composition in `apps/*`.
6. Run package tests.
7. Run affected app tests.
8. Run `pnpm typecheck`.
9. Run `pnpm check:boundaries`.
10. Update the migration plan progress log.
```

- [ ] **Step 2: Verify docs stay concise**

Run:

```bash
wc -l README.md docs/architecture/package-extraction-checklist.md
```

Expected: `README.md` remains concise and points to detailed docs rather than becoming an encyclopedia.

## NOT in Scope

- Literal file-for-file clone of `badlogic/pi-mono`: different product and runtime requirements.
- Replacing `apps/*` with only `packages/*`: FinSentinel has deployable product surfaces.
- npm workspace migration: current pnpm workspace is already functional.
- Biome migration: useful only after package boundaries stabilize.
- Python sidecar rewrite: high churn, not required for package-first TypeScript migration.
- External package publishing: internal workspace packages are enough for wave 1.
- Database schema changes: architecture migration should preserve behavior first.
- Broad UI redesign: unrelated to package boundaries.

## What Already Exists

| Existing asset | Reuse plan |
| --- | --- |
| `packages/shared` | Keep as foundation contracts/schemas initially. |
| `packages/db` | Keep as persistence foundation package. |
| `turbo.json` | Keep dependency-aware workspace orchestration. |
| API domain tests | Reuse as regression tests during extraction. |
| `README.md` | Keep as concise map; link deeper architecture docs. |
| `services/*` | Keep as explicit sidecar deployables in wave 1. |

## Backlog Candidates

These are not part of wave 1 but should be reconsidered after the pilot extraction:

- Split `packages/shared` into `packages/contracts` only if shared becomes too broad.
- Decide whether `apps/desktop` is supported, experimental, or archived.
- Classify top-level `app`, `backend`, `dashboard`, and `ev2`.
- Decide whether MCP directories belong in this repo or should remain nested external projects.
- Consider Biome after package boundaries and first extraction are stable.

## Progress Log

- 2026-04-17: Read repository instructions and existing `pi-mono` plan artifacts.
- 2026-04-17: Rechecked current `badlogic/pi-mono` README, root package metadata, and package metadata.
- 2026-04-17: Inspected local workspace structure, root scripts, Turbo config, package manifests, README, and API domain layout.
- 2026-04-17: Replaced the earlier high-level plan with this executable implementation plan and engineering review.
- 2026-04-17: Ran banned-pattern scan against this plan; no prohibited filler patterns were found.
- 2026-04-17: Ran `git check-ignore` and updated `.gitignore` so this plan can be tracked despite the broader `docs/` ignore rule.
- 2026-04-17: Ran `pnpm typecheck`; it failed in existing workspace build before this plan is implemented because `packages/db/src/apply-migrations.ts` uses `import.meta` while `packages/db/tsconfig.build.json` compiles as CommonJS.

## Key Decisions

- Use `pi-mono` as an architectural reference, not a literal clone target.
- Keep pnpm + Turbo in wave 1.
- Preserve `apps/*` as product composition roots.
- Start with mechanical boundary enforcement before code movement.
- Use `watchlist` as the recommended pilot extraction candidate.
- Keep sidecars in `services/*` for wave 1 and document their status.

## Risks and Blockers

- Full migration spans many domains and should not be attempted in one PR.
- Boundary tooling may reveal existing deep-import warnings that need triage.
- Package-level config parsing can conflict with existing NestJS config if rewired too aggressively.
- Watchlist extraction must be limited to pure behavior first; moving DB/NestJS concerns too early increases risk.
- User confirmation is still needed for desktop and sidecar long-term status.

## Final Outcome

Planning is complete for the architecture migration. No production code has been moved. The recommended next action is Task 1, then Task 2, then the `watchlist` pilot extraction only after boundary checks are in place. Before implementation relies on workspace-wide verification, resolve or explicitly scope around the existing `packages/db` CommonJS/import-meta typecheck failure.

## Related Plans

- SDK migration: [2026-04-17-pi-mono-sdk-migration-plan.md](/Users/hongxichen/Desktop/FinSentinel/docs/exec-plans/2026-04-17-pi-mono-sdk-migration-plan.md)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | - | Not run |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | - | Not run |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | Big-bang rewrite rejected; 13 test/check gaps identified; 2 critical gaps remain until implementation |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | - | Not applicable to backend/package architecture plan |

**UNRESOLVED:** Confirm desktop status, sidecar long-term status, and whether later toolchain parity is desired.

**VERDICT:** ENG PLAN WRITTEN WITH OPEN IMPLEMENTATION GATES - ready to start Task 1, not ready for broad code extraction.
