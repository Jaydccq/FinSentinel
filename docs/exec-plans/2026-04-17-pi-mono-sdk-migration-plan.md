# Pi-Mono SDK Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace FinSentinel's Vercel AI SDK usage with a Pi-Mono SDK runtime while preserving current chat, analysis, RAG, and SSE behavior.

**Architecture:** Add a small internal `@finsentinel/ai-runtime` package that wraps `@mariozechner/pi-ai` model/provider primitives, `@mariozechner/pi-agent-core` tool execution/event streaming, and a local OpenAI-compatible embedding client. Migrate API services to that package first, keep NestJS controllers and existing tool services in place, then mechanically block new imports from `ai` and `@ai-sdk/openai`.

**Tech Stack:** TypeScript, pnpm 10, Turbo, NestJS, Vitest, `@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`, Zod, OpenRouter-compatible HTTP APIs.

---

## Background

FinSentinel currently uses Vercel AI SDK directly in the NestJS API:

- `streamText` + `stepCountIs` for streaming agent responses with tool execution.
- `generateText` for query rewriting, chat compaction, and analysis role execution.
- `embed` and `embedMany` for RAG embeddings.
- `tool()` and `ToolSet` for all agent tool factories.
- `createOpenAI` from `@ai-sdk/openai` to target OpenRouter's OpenAI-compatible API.

Pi-Mono provides two relevant packages:

- `@mariozechner/pi-ai`: unified multi-provider LLM API, model metadata, streaming, completion, tool schema primitives, provider-specific options, and deterministic faux providers for tests.
- `@mariozechner/pi-agent-core`: stateful agent loop built on `pi-ai`, with tool execution, event streaming, parallel tool execution, `beforeToolCall` and `afterToolCall` hooks, and low-level loop APIs.

The important architectural fit is not the coding-agent CLI. FinSentinel is a product backend, so wave 1 should use `pi-ai` and `pi-agent-core`, not `@mariozechner/pi-coding-agent` session discovery, file tools, TUI, or `.pi` project settings.

## Source Notes

Sources checked on 2026-04-17:

- `https://github.com/badlogic/pi-mono`
- `https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/ai/README.md`
- `https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/ai/src/types.ts`
- `https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/agent/README.md`
- `https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/sdk.md`

Observed API facts:

- `pi-ai` supports OpenAI, Anthropic, Google, OpenRouter, Vercel AI Gateway, OpenAI-compatible APIs, thinking/reasoning options, event streams, custom models, and tool schemas.
- `pi-ai` messages use `user`, `assistant`, and `toolResult` roles, with assistant content blocks for text, thinking, and tool calls.
- `pi-agent-core` owns the stateful agent loop and tool execution. Its default tool execution mode is parallel, and it emits `message_update`, `tool_execution_*`, `turn_*`, and `agent_*` events.
- `pi-agent-core` tools use `AgentTool` definitions with TypeBox-style JSON schemas and an `execute(toolCallId, params, signal, onUpdate)` function.
- `pi-ai` does not expose an embedding API in the checked public exports. FinSentinel still needs embeddings, so full Vercel SDK removal requires a local OpenAI-compatible embedding client.

## Current Repository Facts

Direct AI SDK imports exist in these files:

- `apps/api/src/agent/agent.service.ts`
- `apps/api/src/agent/stock-analysis.service.ts`
- `apps/api/src/okx/okx-analysis.service.ts`
- `apps/api/src/chat/chat-compaction.service.ts`
- `apps/api/src/rag/query-rewrite.service.ts`
- `apps/api/src/rag/rag-embedding.service.ts`
- `apps/api/src/analysis/teams/role-executor.service.ts`
- `apps/api/src/agent/tool-registry.ts`
- all tool factories under `apps/api/src/agent/tools/*.tool.ts`

Existing behavior that must remain stable:

- FinSentinel SSE format:

```text
event: message
data: {"content":"chunk","sessionId":"session-id"}

event: done
data: [DONE]

event: error
data: {"error":"message"}
```

- User profile + persona prompt composition in `AgentService`.
- Stock analysis tool subset in `StockAnalysisService`.
- OKX analysis market-context prompt.
- Chat compaction fallback to heuristic truncation on LLM failure.
- Query rewrite fallback to original/truncated query on LLM failure.
- RAG embedding query/chunk APIs returning `number[]` and `number[][]`.
- Role executor structured JSON extraction and Zod validation.
- Existing tool factory surface: a record keyed by tool name, each tool with description, schema, and execute behavior.

## Goal

Remove runtime and test reliance on Vercel AI SDK packages:

- `ai`
- `@ai-sdk/openai`

Replace those responsibilities with:

- `@mariozechner/pi-ai` for model definitions, completion/stream events, and OpenRouter-compatible model routing.
- `@mariozechner/pi-agent-core` for tool execution and agent loop state.
- `@finsentinel/ai-runtime` for FinSentinel-specific adapters, SSE-neutral streaming helpers, Zod-to-agent-tool conversion, model construction, no-Vercel import checks, and embeddings.

## Scope

In scope:

- Create `packages/ai-runtime`.
- Add Pi-Mono dependencies to the API/runtime layer.
- Replace every direct import from `ai` and `@ai-sdk/openai`.
- Preserve the existing NestJS module shape and controller behavior.
- Preserve current Zod schemas in tool factories through a local adapter so the migration does not combine SDK replacement with schema rewrites.
- Add tests for streaming, tool execution, text generation, embeddings, service rewiring, and dependency removal.
- Add a mechanical check that fails if new Vercel AI SDK imports are introduced.

Out of scope:

- Replacing NestJS, Next.js, pnpm, Turbo, Drizzle, or Vitest.
- Adopting `@mariozechner/pi-coding-agent` file tools, sessions, TUI, or `.pi` discovery.
- Rewriting all tool schemas from Zod to TypeBox in this wave.
- Changing prompt content, persona behavior, tool descriptions, or financial decision logic.
- Changing database schema or embedding vector dimensions.
- Publishing `@finsentinel/ai-runtime` externally.
- Migrating frontend UI components to `pi-web-ui`.

## Assumptions

- "Vercel SDK" means the Vercel AI SDK packages `ai` and `@ai-sdk/openai`, not Vercel hosting or Next.js.
- "Pi-Mono SDK architecture" means use Pi-Mono's provider and agent-loop packages, not a literal clone of the Pi coding agent.
- OpenRouter remains the configured provider in wave 1.
- Current tool schemas can stay in Zod because Zod is already a project-wide dependency and changing schema libraries would increase blast radius.
- Embeddings can be handled by a small OpenAI-compatible HTTP client because Pi-Mono's checked public `pi-ai` exports do not include embeddings.

## Uncertainties

- Whether the default `AI_MODEL=google/gemini-3-flash-preview` is present in Pi-Mono's generated model registry. The plan avoids relying on registry membership by creating a custom OpenRouter-compatible model object.
- Whether OpenRouter supports the configured `AI_EMBEDDING_MODEL` through `/embeddings` in every deployment. The embedding client must surface provider errors clearly.
- Whether current `generateText({ tools })` flows actually exercise tools in production. The migration should support tools through `pi-agent-core` anyway because the role executor passes scoped tools today.
- Whether the API should expose thinking/reasoning deltas later. This plan preserves text-only SSE output.

## Success Criteria

- `rg -n "from 'ai'|from \"ai\"|@ai-sdk/openai" apps packages` returns no application source imports after migration.
- `apps/api/package.json` no longer depends on `ai` or `@ai-sdk/openai`.
- `@finsentinel/ai-runtime` package tests pass.
- Existing targeted tests pass:
  - `pnpm --filter @finsentinel/api test -- src/agent/__tests__/agent.service.spec.ts`
  - `pnpm --filter @finsentinel/api test -- src/chat/__tests__/chat-compaction.service.spec.ts`
  - `pnpm --filter @finsentinel/api test -- src/rag/__tests__/query-rewrite.service.spec.ts`
  - `pnpm --filter @finsentinel/api test -- src/rag/__tests__/rag-embedding.service.spec.ts`
  - `pnpm --filter @finsentinel/api test -- src/analysis/teams/__tests__/role-executor.parse-structured.spec.ts`
- `pnpm --filter @finsentinel/api typecheck` passes.
- `pnpm typecheck` passes after the final dependency removal.
- Streaming services still emit the same FinSentinel SSE event names and payload shapes.

## What Already Exists

- `apps/api/src/config/ai.config.ts` already centralizes `OPENROUTER_API_KEY`, `AI_MODEL`, and `AI_EMBEDDING_MODEL`.
- `apps/api/src/agent/tool-registry.ts` already centralizes full vs stock-analysis tool selection.
- Tool factories already isolate tool descriptions, schemas, and service calls.
- Existing tests mock `ai` and `@ai-sdk/openai`; those tests provide clear migration targets for new `@finsentinel/ai-runtime` mocks.
- Existing SSE conversion helpers in agent services preserve the frontend contract.
- Existing fallback behavior in compaction and query rewrite should remain app-level behavior, not move into the runtime package.

## NOT In Scope

- `@mariozechner/pi-coding-agent`: useful for coding-agent sessions, but it would add unrelated file/session/tool discovery behavior to a financial product API.
- TypeBox-only tool rewrite: desirable later, but not required to remove Vercel SDK and would touch every tool schema at once.
- Frontend chat UI replacement: no current direct Vercel AI SDK usage exists in `apps/web`.
- Provider change away from OpenRouter: the migration changes SDK architecture, not model/vendor routing.
- Embedding model replacement or vector dimension migration: existing pgvector data depends on stable dimensions.

## Step 0: Scope Challenge

### Existing code that solves sub-problems

- Model config is already centralized enough to feed a Pi-Mono model factory.
- Tool registry already supplies per-request tool sets.
- Zod tool schemas are already tested and should be adapted, not rewritten.
- SSE output is already isolated in service helpers and can be kept unchanged.

### Minimum viable path

1. Build an internal Pi runtime package.
2. Rewire no-tool text generation services.
3. Rewire embedding service.
4. Rewire tool-backed streaming/generation services.
5. Replace tool imports mechanically.
6. Remove Vercel AI SDK dependencies and add a no-import check.

### Complexity check

This migration touches more than 8 files and more than 2 service paths. Treat it as a multi-wave refactor, not one broad edit. Each task below has its own tests and can be committed independently.

### Search check

- **[Layer 1]** Use `pi-agent-core` instead of custom tool-loop orchestration because it is the Pi-Mono package explicitly built for stateful tool execution.
- **[Layer 1]** Keep existing Zod schemas through an adapter because Zod is already used across FinSentinel and replacing schemas is not required for SDK removal.
- **[Layer 2]** Use `pi-ai` custom model objects for OpenRouter to avoid depending on generated registry coverage for every OpenRouter model string.
- **[Layer 3]** Write a local embedding client because Pi-Mono's checked public `pi-ai` exports do not include embeddings.

### Distribution check

`@finsentinel/ai-runtime` is an internal workspace package. No external publish pipeline is needed.

## Target Data Flow

```text
Chat / analysis request
  │
  ├─ apps/api service composes system prompt + message history
  │
  ├─ ToolRegistry returns FinToolSet
  │
  ├─ @finsentinel/ai-runtime
  │    ├─ creates OpenRouter Model for pi-ai
  │    ├─ converts FinToolSet -> pi-agent-core AgentTool[]
  │    ├─ converts FinSentinel messages -> AgentMessage[]
  │    ├─ runs Agent.continue() or Agent.prompt()
  │    └─ emits text deltas as AsyncIterable<string>
  │
  └─ apps/api service keeps current SSE wrapper
       ├─ message chunks
       ├─ done
       └─ error
```

```text
RAG vectorization
  │
  ├─ RagEmbeddingService
  │
  ├─ @finsentinel/ai-runtime OpenRouterEmbeddingClient
  │    ├─ POST /embeddings
  │    ├─ validate response item count
  │    └─ return number[] / number[][]
  │
  └─ existing DocumentVectorService and RagChunkStoreService stay unchanged
```

## Architecture Review

1. The main architecture risk is replacing `streamText` with a custom loop. Recommendation: use `pi-agent-core` `Agent`, not a hand-rolled loop. Completeness: 9/10.
2. The embedding path is not covered by Pi-Mono's checked public API. Recommendation: add a tiny local embedding client and test provider error shapes. Completeness: 8/10.
3. Tool schema migration can explode the diff. Recommendation: keep Zod and convert at the adapter boundary, then consider TypeBox-only tools later. Completeness: 8/10.
4. Direct Pi-Mono usage scattered through app services would recreate the current SDK coupling. Recommendation: all app services import only `@finsentinel/ai-runtime`. Completeness: 9/10.

## Code Quality Review

- Keep `packages/ai-runtime` small and boring: model factory, tool adapter, text runner, embedding client, test helper exports.
- Do not move financial domain logic, tool descriptions, or prompts into the runtime package.
- Do not create a provider abstraction hierarchy until there is a second active provider.
- Keep app-level fallbacks in app services where they already exist.
- Add a no-import check so this migration does not regress.

## Test Coverage Diagram

```text
CODE PATH COVERAGE
==================
[+] createOpenRouterModel()
    ├── [GAP] builds openai-completions model from existing aiConfig
    ├── [GAP] preserves base URL default and custom override
    └── [GAP] marks unknown model metadata conservatively

[+] defineZodTool() / toAgentTools()
    ├── [GAP] exposes legacy inputSchema for existing tests
    ├── [GAP] converts Zod schema to AgentTool parameters
    ├── [GAP] returns successful string tool results as text content
    └── [GAP] throws on tool failure so pi-agent-core marks toolResult isError

[+] streamAgentTextFromMessages()
    ├── [GAP] converts user/assistant history to AgentMessage[]
    ├── [GAP] continues from last user message without duplicating it
    ├── [GAP] emits only text_delta chunks
    ├── [GAP] executes tool calls and continues to final answer
    ├── [GAP] aborts or errors clearly on max turn overflow
    └── [GAP] propagates model/provider error to caller

[+] generateAgentText()
    ├── [GAP] returns concatenated final assistant text
    ├── [GAP] supports scoped tools for RoleExecutorService
    └── [GAP] returns empty string only when the model returned no text blocks

[+] OpenRouterEmbeddingClient
    ├── [GAP] embedQuery returns one vector
    ├── [GAP] embedChunks returns vectors in input order
    ├── [GAP] empty chunks skips HTTP call
    ├── [GAP] mismatched provider item count throws
    └── [GAP] non-2xx response includes status and response text

[+] API rewiring
    ├── [GAP] AgentService keeps system prompt, tools, stop guard, and SSE format
    ├── [GAP] StockAnalysisService keeps stock-only tools and SSE format
    ├── [GAP] OkxAnalysisService keeps market context and SSE format
    ├── [GAP] ChatCompactionService keeps LLM-failure fallback
    ├── [GAP] QueryRewriteService keeps disabled/empty/failure behavior
    ├── [GAP] RagEmbeddingService keeps public methods and empty-array behavior
    └── [GAP] RoleExecutorService keeps structured JSON parsing contract

USER FLOW COVERAGE
==================
[+] User sends a chat message
    ├── [GAP] SSE chunks stream in the same event format
    ├── [GAP] tool-backed answer can complete after tool calls
    └── [GAP] provider error becomes error SSE event

[+] User runs stock analysis
    ├── [GAP] market-data and technical tools are available
    └── [GAP] final answer streams after tool execution

[+] RAG vectorization job runs
    ├── [GAP] chunks are embedded in order
    └── [GAP] embedding failure fails the vectorization path visibly

────────────────────────────────────────
COVERAGE NOW: 0/34 migration paths covered
TARGET BEFORE MERGE: 34/34 paths covered or mechanically checked
GAPS: 34 paths need tests/checks during implementation
────────────────────────────────────────
```

## Failure Modes

| Path | Realistic failure | Required test | Error handling expectation | User impact if missed |
| --- | --- | --- | --- | --- |
| Streaming chat | Last user message is duplicated when using `Agent.prompt()` over existing history | `streamAgentTextFromMessages` starts from history and calls `continue()` | No duplicate prompt in context | Repeated or confused answers |
| Tool execution | Tool throws but adapter returns success text | Tool failure test | Throw reaches `pi-agent-core` and becomes tool error | Model trusts failed data |
| Tool schema | Zod schema converts to invalid JSON schema | Tool parameters test | Runtime package test fails before app migration | Tool calls rejected by provider |
| Max turns | Model loops tool calls forever | max turn test | Agent aborts and surfaces error | Hung SSE request |
| SSE stream | Runtime emits thinking/tool deltas to frontend as user-visible text | streaming event filter test | Only text deltas become chunks | Leaked internal reasoning/tool noise |
| Embeddings | Provider returns fewer vectors than inputs | item-count mismatch test | Throw clear error | Chunks stored with wrong vectors |
| Dependency cleanup | New code imports `ai` again | no-Vercel import check | CI/check fails | Migration silently regresses |

Critical gaps before implementation:

- No `@finsentinel/ai-runtime` exists.
- No tests cover Pi-Mono event adaptation.
- No embedding replacement exists outside Vercel AI SDK.
- No mechanical check blocks future Vercel AI SDK imports.

## Implementation Steps

### Task 1: Create `@finsentinel/ai-runtime` Package Skeleton

**Files:**

- Create: `packages/ai-runtime/package.json`
- Create: `packages/ai-runtime/tsconfig.json`
- Create: `packages/ai-runtime/tsconfig.build.json`
- Create: `packages/ai-runtime/src/index.ts`
- Modify: `apps/api/package.json`

- [x] **Step 1: Create package metadata**

Create `packages/ai-runtime/package.json`:

```json
{
  "name": "@finsentinel/ai-runtime",
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
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@mariozechner/pi-agent-core": "^0.67.6",
    "@mariozechner/pi-ai": "^0.67.6",
    "zod": "^3.25.76",
    "zod-to-json-schema": "^3.24.6"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.8.0",
    "vitest": "^4.1.2"
  }
}
```

- [x] **Step 2: Create TypeScript configs**

Create `packages/ai-runtime/tsconfig.json`:

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

Create `packages/ai-runtime/tsconfig.build.json`:

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

- [x] **Step 3: Create empty public entrypoint**

Create `packages/ai-runtime/src/index.ts`:

```ts
export {};
```

- [x] **Step 4: Add API dependency on the workspace package**

Add `@finsentinel/ai-runtime` to `apps/api/package.json` dependencies:

```json
{
  "dependencies": {
    "@finsentinel/ai-runtime": "workspace:*"
  }
}
```

Keep existing dependencies unchanged in this step.

- [x] **Step 5: Install and update the lockfile**

Run:

```bash
pnpm install
```

Expected: package resolution succeeds and `pnpm-lock.yaml` records `@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`, and `zod-to-json-schema`.

- [x] **Step 6: Verify package skeleton**

Run:

```bash
pnpm --filter @finsentinel/ai-runtime typecheck
```

Expected: PASS.

**Progress log**

- 2026-04-17: Added the `@finsentinel/ai-runtime` workspace package skeleton and API dependency. Repo-root `pnpm install` initially failed in the sandbox due registry DNS access, then passed after explicit network approval. Verified the package skeleton with `pnpm --filter @finsentinel/ai-runtime typecheck`.
- 2026-04-17: Completed Task 2 by adding `createOpenRouterModel`, exporting it from `@finsentinel/ai-runtime`, and verifying the package with `pnpm --filter @finsentinel/ai-runtime test -- src/model.spec.ts` and `pnpm --filter @finsentinel/ai-runtime typecheck`.
- 2026-04-17: Hardened Task 2 so the OpenRouter model factory now prefers Pi-Mono registry metadata for known models and only falls back for unknown model IDs; updated tests to lock registry-derived metadata, compat, and fallback overrides.

### Task 2: Add OpenRouter Model Factory

**Files:**

- Create: `packages/ai-runtime/src/model.ts`
- Create: `packages/ai-runtime/src/model.spec.ts`
- Modify: `packages/ai-runtime/src/index.ts`

- [x] **Step 1: Write model factory tests**

Create `packages/ai-runtime/src/model.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createOpenRouterModel } from './model';

describe('createOpenRouterModel', () => {
  it('creates an OpenRouter OpenAI-compatible Pi model', () => {
    const model = createOpenRouterModel({
      modelId: 'google/gemini-3-flash-preview',
      baseUrl: 'https://openrouter.ai/api/v1',
    });

    expect(model.id).toBe('google/gemini-3-flash-preview');
    expect(model.provider).toBe('openrouter');
    expect(model.api).toBe('openai-completions');
    expect(model.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(model.input).toEqual(['text']);
  });

  it('uses the default OpenRouter base URL', () => {
    const model = createOpenRouterModel({ modelId: 'openai/gpt-4o-mini' });

    expect(model.baseUrl).toBe('https://openrouter.ai/api/v1');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @finsentinel/ai-runtime test -- src/model.spec.ts
```

Expected: FAIL because `createOpenRouterModel` does not exist.

- [x] **Step 3: Implement model factory**

Create `packages/ai-runtime/src/model.ts`:

```ts
import type { Model } from '@mariozechner/pi-ai';

export interface OpenRouterModelOptions {
  modelId: string;
  baseUrl?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
}

export function createOpenRouterModel(options: OpenRouterModelOptions): Model<'openai-completions'> {
  return {
    id: options.modelId,
    name: options.modelId,
    api: 'openai-completions',
    provider: 'openrouter',
    baseUrl: options.baseUrl ?? 'https://openrouter.ai/api/v1',
    reasoning: options.reasoning ?? false,
    input: ['text'],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: options.contextWindow ?? 128000,
    maxTokens: options.maxTokens ?? 8192,
    compat: {
      thinkingFormat: 'openrouter',
      supportsStore: false,
    },
  };
}
```

- [x] **Step 4: Export model factory**

Update `packages/ai-runtime/src/index.ts`:

```ts
export * from './model';
```

- [x] **Step 5: Verify model factory**

Run:

```bash
pnpm --filter @finsentinel/ai-runtime test -- src/model.spec.ts
```

Expected: PASS.

### Task 3: Add Tool Adapter For Existing Zod Tools

**Files:**

- Create: `packages/ai-runtime/src/tools.ts`
- Create: `packages/ai-runtime/src/tools.spec.ts`
- Modify: `packages/ai-runtime/src/index.ts`

- [x] **Step 1: Write adapter tests**

Create `packages/ai-runtime/src/tools.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineZodTool, toAgentTools } from './tools';

describe('defineZodTool', () => {
  it('keeps the legacy inputSchema while exposing Pi parameters', async () => {
    const tool = defineZodTool({
      description: 'Echo a value',
      inputSchema: z.object({ value: z.string() }),
      execute: async ({ value }) => `echo:${value}`,
    });

    expect(tool.description).toBe('Echo a value');
    expect(tool.inputSchema.parse({ value: 'x' })).toEqual({ value: 'x' });
    expect(tool.parameters).toBeDefined();
    expect(await tool.execute({ value: 'x' })).toBe('echo:x');
  });

  it('converts a tool set into pi-agent-core tools keyed by record name', async () => {
    const tools = toAgentTools({
      echo: defineZodTool({
        description: 'Echo a value',
        inputSchema: z.object({ value: z.string() }),
        execute: async ({ value }) => `echo:${value}`,
      }),
    });

    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe('echo');
    expect(tools[0]!.label).toBe('echo');

    const result = await tools[0]!.execute('call-1', { value: 'ok' }, new AbortController().signal);
    expect(result.content).toEqual([{ type: 'text', text: 'echo:ok' }]);
  });

  it('throws when schema validation fails so the agent records a tool error', async () => {
    const [tool] = toAgentTools({
      echo: defineZodTool({
        description: 'Echo a value',
        inputSchema: z.object({ value: z.string() }),
        execute: async ({ value }) => `echo:${value}`,
      }),
    });

    await expect(
      tool!.execute('call-1', { value: 123 }, new AbortController().signal),
    ).rejects.toThrow(/value/);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @finsentinel/ai-runtime test -- src/tools.spec.ts
```

Expected: FAIL because the adapter does not exist.

- [x] **Step 3: Implement adapter**

Create `packages/ai-runtime/src/tools.ts`:

```ts
import type { AgentTool, ToolResult } from '@mariozechner/pi-agent-core';
import { Type, type TSchema } from '@mariozechner/pi-ai';
import { z, type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export interface FinTool<TSchemaDef extends ZodTypeAny = ZodTypeAny> {
  description: string;
  inputSchema: TSchemaDef;
  parameters: TSchema;
  execute: (args: z.infer<TSchemaDef>) => Promise<string> | string;
}

export type FinToolSet = Record<string, FinTool>;

export function defineZodTool<TSchemaDef extends ZodTypeAny>(definition: {
  description: string;
  inputSchema: TSchemaDef;
  execute: (args: z.infer<TSchemaDef>) => Promise<string> | string;
}): FinTool<TSchemaDef> {
  const jsonSchema = zodToJsonSchema(definition.inputSchema, {
    target: 'jsonSchema7',
  });

  return {
    ...definition,
    parameters: Type.Unsafe(jsonSchema as Record<string, unknown>),
  };
}

export function toAgentTools(toolSet: FinToolSet): AgentTool[] {
  return Object.entries(toolSet).map(([name, tool]) => ({
    name,
    label: name,
    description: tool.description,
    parameters: tool.parameters,
    execute: async (_toolCallId, params): Promise<ToolResult> => {
      const parsed = tool.inputSchema.parse(params);
      const text = await tool.execute(parsed);

      return {
        content: [{ type: 'text', text }],
        details: {},
      };
    },
  }));
}
```

- [x] **Step 4: Export adapter**

Update `packages/ai-runtime/src/index.ts`:

```ts
export * from './model';
export * from './tools';
```

- [x] **Step 5: Verify adapter**

Run:

```bash
pnpm --filter @finsentinel/ai-runtime test -- src/tools.spec.ts
```

Expected: PASS.

**Progress log**

- 2026-04-17: Added `packages/ai-runtime/src/tools.spec.ts` and `packages/ai-runtime/src/tools.ts` to bridge legacy Zod tools into Pi-Mono agent tools without touching app tool factories yet.
- 2026-04-17: Verified Task 3 with `pnpm --filter @finsentinel/ai-runtime test -- src/tools.spec.ts` and `pnpm --filter @finsentinel/ai-runtime typecheck`.

### Task 4: Add Pi Agent Text Runtime

**Files:**

- Create: `packages/ai-runtime/src/text-runtime.ts`
- Create: `packages/ai-runtime/src/text-runtime.spec.ts`
- Modify: `packages/ai-runtime/src/index.ts`

- [x] **Step 1: Write runtime tests**

Create `packages/ai-runtime/src/text-runtime.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fauxAssistantMessage, fauxText, fauxToolCall, registerFauxProvider } from '@mariozechner/pi-ai';
import { z } from 'zod';
import { defineZodTool } from './tools';
import { collectAsyncText, generateAgentText, streamAgentTextFromMessages } from './text-runtime';

describe('text runtime', () => {
  it('generates text from a single prompt', async () => {
    const provider = registerFauxProvider();
    provider.setResponses([fauxAssistantMessage([fauxText('hello world')])]);

    try {
      const text = await generateAgentText({
        model: provider.getModel(),
        systemPrompt: 'Be brief.',
        prompt: 'Say hello.',
        tools: {},
      });

      expect(text).toBe('hello world');
    } finally {
      provider.unregister();
    }
  });

  it('streams text from existing messages without duplicating the last user message', async () => {
    const provider = registerFauxProvider();
    provider.setResponses([fauxAssistantMessage([fauxText('streamed')])]);

    try {
      const chunks = await collectAsyncText(
        streamAgentTextFromMessages({
          model: provider.getModel(),
          systemPrompt: 'Be brief.',
          messages: [{ role: 'user', content: 'Continue from this message.' }],
          tools: {},
        }),
      );

      expect(chunks.join('')).toBe('streamed');
      expect(provider.state.callCount).toBe(1);
    } finally {
      provider.unregister();
    }
  });

  it('executes a tool call and continues to final text', async () => {
    const provider = registerFauxProvider();
    provider.setResponses([
      fauxAssistantMessage([fauxToolCall('echo', { value: 'AAPL' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxText('tool said AAPL')]),
    ]);

    try {
      const text = await generateAgentText({
        model: provider.getModel(),
        systemPrompt: 'Use tools.',
        prompt: 'Echo AAPL.',
        tools: {
          echo: defineZodTool({
            description: 'Echo a value',
            inputSchema: z.object({ value: z.string() }),
            execute: async ({ value }) => value,
          }),
        },
      });

      expect(text).toBe('tool said AAPL');
    } finally {
      provider.unregister();
    }
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @finsentinel/ai-runtime test -- src/text-runtime.spec.ts
```

Expected: FAIL because `text-runtime.ts` does not exist.

- [x] **Step 3: Implement runtime**

Create `packages/ai-runtime/src/text-runtime.ts`:

```ts
import { Agent, type AgentMessage } from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';
import type { FinToolSet } from './tools';
import { toAgentTools } from './tools';

export interface ChatMessageInput {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentTextOptions {
  model: Model;
  systemPrompt: string;
  tools: FinToolSet;
  maxTurns?: number;
}

export interface GenerateAgentTextOptions extends AgentTextOptions {
  prompt: string;
}

export interface StreamAgentTextOptions extends AgentTextOptions {
  messages: ChatMessageInput[];
}

export async function generateAgentText(options: GenerateAgentTextOptions): Promise<string> {
  const chunks: string[] = [];
  const agent = createAgent(options, []);
  attachTextCollector(agent, chunks);

  await runWithTurnLimit(agent, options.maxTurns, () => agent.prompt(options.prompt));

  return chunks.join('');
}

export async function* streamAgentTextFromMessages(
  options: StreamAgentTextOptions,
): AsyncIterable<string> {
  const queue: string[] = [];
  let done = false;
  let failure: unknown;
  let notify: (() => void) | undefined;

  const agent = createAgent(options, toAgentMessages(options.messages));
  agent.subscribe((event) => {
    if (
      event.type === 'message_update' &&
      event.assistantMessageEvent.type === 'text_delta'
    ) {
      queue.push(event.assistantMessageEvent.delta);
      notify?.();
    }
  });

  void runWithTurnLimit(agent, options.maxTurns, () => agent.continue())
    .catch((error) => {
      failure = error;
    })
    .finally(() => {
      done = true;
      notify?.();
    });

  while (!done || queue.length > 0) {
    while (queue.length > 0) {
      yield queue.shift()!;
    }
    if (failure) {
      throw failure;
    }
    if (!done) {
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
      notify = undefined;
    }
  }

  if (failure) {
    throw failure;
  }
}

export async function collectAsyncText(stream: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

function createAgent(options: AgentTextOptions, messages: AgentMessage[]): Agent {
  return new Agent({
    initialState: {
      systemPrompt: options.systemPrompt,
      model: options.model,
      thinkingLevel: 'off',
      tools: toAgentTools(options.tools),
      messages,
    },
    toolExecution: 'parallel',
  });
}

function toAgentMessages(messages: ChatMessageInput[]): AgentMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    timestamp: Date.now(),
  }));
}

function attachTextCollector(agent: Agent, chunks: string[]): void {
  agent.subscribe((event) => {
    if (
      event.type === 'message_update' &&
      event.assistantMessageEvent.type === 'text_delta'
    ) {
      chunks.push(event.assistantMessageEvent.delta);
    }
  });
}

async function runWithTurnLimit(
  agent: Agent,
  maxTurns = 10,
  run: () => Promise<void>,
): Promise<void> {
  let turns = 0;
  const unsubscribe = agent.subscribe((event) => {
    if (event.type !== 'turn_start') return;
    turns += 1;
    if (turns > maxTurns) {
      agent.abort();
      throw new Error(`Agent exceeded max turn limit of ${maxTurns}`);
    }
  });

  try {
    await run();
  } finally {
    unsubscribe();
  }
}
```

- [x] **Step 4: Export runtime**

Update `packages/ai-runtime/src/index.ts`:

```ts
export * from './model';
export * from './text-runtime';
export * from './tools';
```

- [x] **Step 5: Verify runtime**

Run:

```bash
pnpm --filter @finsentinel/ai-runtime test -- src/text-runtime.spec.ts
```

Expected: PASS. If `Agent.subscribe()` cannot safely throw from a listener, replace the max-turn implementation with an `agent_end` error check and keep the max-turn test as the contract.

**Progress log**

- 2026-04-17: Added `packages/ai-runtime/src/text-runtime.spec.ts` covering single-prompt text generation, streamed history replay, tool-call continuation, and async text collection with `@mariozechner/pi-ai` faux providers.
- 2026-04-17: Implemented `packages/ai-runtime/src/text-runtime.ts` with Pi Agent text generation/streaming, message conversion with timestamps, max-turn guarding, and text-delta-only collection.
- 2026-04-17: Added a max-turn overflow test that confirms the guard aborts a tool-driven loop before the final answer is produced.
- 2026-04-17: Tightened `streamAgentTextFromMessages` so assistant-tail or empty history returns no chunks and does not issue a provider call; added a regression test for the assistant-tail case.
- 2026-04-17: Added early-close cancellation coverage that verifies `Agent.abort()` is invoked when the text stream is closed before the runner settles.
- 2026-04-17: Exported the runtime from `packages/ai-runtime/src/index.ts` and verified Task 4 with `pnpm --filter @finsentinel/ai-runtime test -- src/text-runtime.spec.ts` and `pnpm --filter @finsentinel/ai-runtime typecheck`.

### Task 5: Add OpenRouter-Compatible Embedding Client

**Files:**

- Create: `packages/ai-runtime/src/embeddings.ts`
- Create: `packages/ai-runtime/src/embeddings.spec.ts`
- Modify: `packages/ai-runtime/src/index.ts`

- [x] **Step 1: Write embedding tests**

Create `packages/ai-runtime/src/embeddings.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { OpenRouterEmbeddingClient } from './embeddings';

describe('OpenRouterEmbeddingClient', () => {
  it('embeds a single query', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }), { status: 200 }),
    );
    const client = new OpenRouterEmbeddingClient({
      apiKey: 'key',
      model: 'text-embedding-3-small',
      fetchImpl,
    });

    await expect(client.embedQuery('hello')).resolves.toEqual([1, 2, 3]);
  });

  it('embeds chunks in order', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ embedding: [1] }, { embedding: [2] }],
        }),
        { status: 200 },
      ),
    );
    const client = new OpenRouterEmbeddingClient({
      apiKey: 'key',
      model: 'text-embedding-3-small',
      fetchImpl,
    });

    await expect(client.embedChunks(['a', 'b'])).resolves.toEqual([[1], [2]]);
  });

  it('skips HTTP for empty chunk arrays', async () => {
    const fetchImpl = vi.fn();
    const client = new OpenRouterEmbeddingClient({
      apiKey: 'key',
      model: 'text-embedding-3-small',
      fetchImpl,
    });

    await expect(client.embedChunks([])).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws on provider item count mismatch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [1] }] }), { status: 200 }),
    );
    const client = new OpenRouterEmbeddingClient({
      apiKey: 'key',
      model: 'text-embedding-3-small',
      fetchImpl,
    });

    await expect(client.embedChunks(['a', 'b'])).rejects.toThrow(/expected 2 embeddings, got 1/);
  });

  it('throws with status and body on non-2xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('bad key', { status: 401 }));
    const client = new OpenRouterEmbeddingClient({
      apiKey: 'key',
      model: 'text-embedding-3-small',
      fetchImpl,
    });

    await expect(client.embedQuery('hello')).rejects.toThrow(/401.*bad key/);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @finsentinel/ai-runtime test -- src/embeddings.spec.ts
```

Expected: FAIL because the embedding client does not exist.

- [x] **Step 3: Implement embedding client**

Create `packages/ai-runtime/src/embeddings.ts`:

```ts
export interface OpenRouterEmbeddingClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface EmbeddingResponse {
  data?: Array<{ embedding?: unknown }>;
}

export class OpenRouterEmbeddingClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenRouterEmbeddingClientOptions) {
    this.baseUrl = options.baseUrl ?? 'https://openrouter.ai/api/v1';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embedQuery(value: string): Promise<number[]> {
    const [embedding] = await this.embedChunks([value]);
    return embedding!;
  }

  async embedChunks(values: string[]): Promise<number[][]> {
    if (values.length === 0) {
      return [];
    }

    const response = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.options.model,
        input: values,
      }),
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`Embedding request failed with ${response.status}: ${bodyText}`);
    }

    const body = JSON.parse(bodyText) as EmbeddingResponse;
    const embeddings = (body.data ?? []).map((item) => {
      if (!Array.isArray(item.embedding) || !item.embedding.every((n) => typeof n === 'number')) {
        throw new Error('Embedding response contained a non-numeric embedding');
      }
      return item.embedding;
    });

    if (embeddings.length !== values.length) {
      throw new Error(`Embedding response expected ${values.length} embeddings, got ${embeddings.length}`);
    }

    return embeddings;
  }
}
```

- [x] **Step 4: Export embedding client**

Update `packages/ai-runtime/src/index.ts`:

```ts
export * from './embeddings';
export * from './model';
export * from './text-runtime';
export * from './tools';
```

- [x] **Step 5: Verify embeddings**

Run:

```bash
pnpm --filter @finsentinel/ai-runtime test -- src/embeddings.spec.ts
```

Expected: PASS.

**Progress log**

- 2026-04-17: Added `packages/ai-runtime/src/embeddings.spec.ts` first, verified the expected red state when `./embeddings` was missing, then implemented `OpenRouterEmbeddingClient` with request validation, empty-input short-circuiting, count checks, and malformed embedding guards.
- 2026-04-17: Verified Task 5 with `pnpm --filter @finsentinel/ai-runtime test -- src/embeddings.spec.ts` and `pnpm --filter @finsentinel/ai-runtime typecheck`.
- 2026-04-17: Tightened embedding client error handling so non-2xx and invalid-JSON responses now use bounded body snippets instead of full response text; added tests for truncation and kept the package typecheck green.

### Task 6: Migrate No-Tool Text Services

**Files:**

- Modify: `apps/api/src/config/ai.config.ts`
- Modify: `apps/api/src/chat/chat-compaction.service.ts`
- Modify: `apps/api/src/rag/query-rewrite.service.ts`
- Modify tests:
  - `apps/api/src/chat/__tests__/chat-compaction.service.spec.ts`
  - `apps/api/src/rag/__tests__/query-rewrite.service.spec.ts`

- [x] **Step 1: Add base URL config**

Update `apps/api/src/config/ai.config.ts`:

```ts
import { registerAs } from '@nestjs/config';

export const aiConfig = registerAs('ai', () => ({
  openrouterApiKey: process.env['OPENROUTER_API_KEY']!,
  openrouterBaseUrl: process.env['OPENROUTER_BASE_URL'] || 'https://openrouter.ai/api/v1',
  model: process.env['AI_MODEL'] || 'google/gemini-3-flash-preview',
  embeddingModel: process.env['AI_EMBEDDING_MODEL'] || 'text-embedding-3-small',
}));
```

- [x] **Step 2: Update tests to mock runtime package**

In `chat-compaction.service.spec.ts`, replace `vi.mock('ai', ...)` and `vi.mock('@ai-sdk/openai', ...)` with:

```ts
vi.mock('@finsentinel/ai-runtime', () => ({
  createOpenRouterModel: vi.fn(() => 'mock-model'),
  generateAgentText: vi.fn().mockImplementation(async ({ prompt }: { prompt: string }) => prompt),
}));
```

In `query-rewrite.service.spec.ts`, replace `vi.mock('ai', ...)` and `vi.mock('@ai-sdk/openai', ...)` with:

```ts
vi.mock('@finsentinel/ai-runtime', () => ({
  createOpenRouterModel: vi.fn(() => 'mock-model'),
  generateAgentText: vi.fn().mockImplementation(async ({ prompt }: { prompt: string }) => prompt.trim()),
}));
```

Update each `mockAiConfig` object to include:

```ts
openrouterBaseUrl: 'https://openrouter.ai/api/v1',
```

- [x] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm --filter @finsentinel/api test -- src/chat/__tests__/chat-compaction.service.spec.ts src/rag/__tests__/query-rewrite.service.spec.ts
```

Expected: FAIL because services still import Vercel AI SDK.

- [x] **Step 4: Migrate `ChatCompactionService`**

Replace Vercel imports in `apps/api/src/chat/chat-compaction.service.ts` with:

```ts
import { createOpenRouterModel, generateAgentText } from '@finsentinel/ai-runtime';
```

Replace constructor model creation with:

```ts
this.model = createOpenRouterModel({
  modelId: this.aiCfg.model,
  baseUrl: this.aiCfg.openrouterBaseUrl,
});
```

Replace the `generateText` call in `generateSummary` with:

```ts
const text = await generateAgentText({
  model: this.model,
  systemPrompt:
    `You are a financial assistant summarizer. Produce a concise summary ` +
    `of the conversation below, capturing key topics, tickers, decisions, ` +
    `and any action items. Keep it under ${this.maxSummaryChars} characters. ` +
    `Return only the summary text, no extra commentary.`,
  prompt: conversationText,
  tools: {},
});
```

- [x] **Step 5: Migrate `QueryRewriteService`**

Replace Vercel imports in `apps/api/src/rag/query-rewrite.service.ts` with:

```ts
import { createOpenRouterModel, generateAgentText } from '@finsentinel/ai-runtime';
```

Replace constructor model creation with:

```ts
this.model = createOpenRouterModel({
  modelId: this.aiCfg.model,
  baseUrl: this.aiCfg.openrouterBaseUrl,
});
```

Replace the `generateText` call in `generateRewrite` with:

```ts
const text = await generateAgentText({
  model: this.model,
  systemPrompt:
    `You are a financial search query optimizer. Rewrite the following ` +
    `query to be more specific and effective for searching a financial ` +
    `document database (SEC filings, research reports, market news). ` +
    `Keep it under ${this.maxLength} characters. Return only the rewritten query.`,
  prompt: query,
  tools: {},
});
```

- [x] **Step 6: Verify no-tool services**

Run:

```bash
pnpm --filter @finsentinel/api test -- src/chat/__tests__/chat-compaction.service.spec.ts src/rag/__tests__/query-rewrite.service.spec.ts
```

Expected: PASS.

**Progress log**

- 2026-04-17: Updated `apps/api/src/config/ai.config.ts`, `apps/api/src/chat/chat-compaction.service.ts`, `apps/api/src/rag/query-rewrite.service.ts`, and the two service specs to use `@finsentinel/ai-runtime` for no-tool text generation.
- 2026-04-17: Resolved the verification blocker by narrowing the `zod-to-json-schema` type boundary in `packages/ai-runtime/src/tools.ts`, excluding specs from the `@finsentinel/ai-runtime` build output, and adding `import`/`require` package export entries for TypeScript package resolution.
- 2026-04-17: Verified Task 6 with `pnpm --filter @finsentinel/api exec vitest run src/chat/__tests__/chat-compaction.service.spec.ts src/rag/__tests__/query-rewrite.service.spec.ts`, `pnpm --filter @finsentinel/api typecheck`, `pnpm --filter @finsentinel/ai-runtime build`, and `pnpm --filter @finsentinel/ai-runtime test`.

### Task 7: Migrate Embedding Service

**Files:**

- Modify: `apps/api/src/rag/rag-embedding.service.ts`
- Create: `apps/api/src/rag/__tests__/rag-embedding.service.spec.ts`

- [x] **Step 1: Add service test**

Create `apps/api/src/rag/__tests__/rag-embedding.service.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { RagEmbeddingService } from '../rag-embedding.service';

const embedQuery = vi.fn();
const embedChunks = vi.fn();

vi.mock('@finsentinel/ai-runtime', () => ({
  OpenRouterEmbeddingClient: vi.fn().mockImplementation(() => ({
    embedQuery,
    embedChunks,
  })),
}));

describe('RagEmbeddingService', () => {
  it('embeds a query through the runtime embedding client', async () => {
    embedQuery.mockResolvedValueOnce([1, 0, 0]);

    const service = new RagEmbeddingService({
      openrouterApiKey: 'key',
      openrouterBaseUrl: 'https://openrouter.ai/api/v1',
      model: 'model',
      embeddingModel: 'text-embedding-3-small',
    });

    await expect(service.embedQuery('risk')).resolves.toEqual([1, 0, 0]);
    expect(embedQuery).toHaveBeenCalledWith('risk');
  });

  it('returns empty arrays without calling provider for empty chunks', async () => {
    embedChunks.mockResolvedValueOnce([]);

    const service = new RagEmbeddingService({
      openrouterApiKey: 'key',
      openrouterBaseUrl: 'https://openrouter.ai/api/v1',
      model: 'model',
      embeddingModel: 'text-embedding-3-small',
    });

    await expect(service.embedChunks([])).resolves.toEqual([]);
    expect(embedChunks).toHaveBeenCalledWith([]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @finsentinel/api test -- src/rag/__tests__/rag-embedding.service.spec.ts
```

Expected: FAIL because the service still imports Vercel AI SDK.

- [x] **Step 3: Migrate service**

Replace `apps/api/src/rag/rag-embedding.service.ts` with:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { OpenRouterEmbeddingClient } from '@finsentinel/ai-runtime';
import { aiConfig } from '../config/ai.config';

@Injectable()
export class RagEmbeddingService {
  private readonly embeddingClient: OpenRouterEmbeddingClient;

  constructor(
    @Inject(aiConfig.KEY) private readonly aiCfg: ConfigType<typeof aiConfig>,
  ) {
    this.embeddingClient = new OpenRouterEmbeddingClient({
      apiKey: this.aiCfg.openrouterApiKey,
      baseUrl: this.aiCfg.openrouterBaseUrl,
      model: this.aiCfg.embeddingModel,
    });
  }

  async embedQuery(value: string): Promise<number[]> {
    return this.embeddingClient.embedQuery(value);
  }

  async embedChunks(values: string[]): Promise<number[][]> {
    return this.embeddingClient.embedChunks(values);
  }
}
```

- [x] **Step 4: Verify embedding service**

Run:

```bash
pnpm --filter @finsentinel/api test -- src/rag/__tests__/rag-embedding.service.spec.ts
```

Expected: PASS.

**Progress log**

- 2026-04-17: Added `apps/api/src/rag/__tests__/rag-embedding.service.spec.ts` to verify `RagEmbeddingService` constructs `OpenRouterEmbeddingClient` from AI config and delegates query/chunk embedding calls, including `[]` input.
- 2026-04-17: Migrated `apps/api/src/rag/rag-embedding.service.ts` to `@finsentinel/ai-runtime` and removed service-level embedding branching.
- 2026-04-17: Verified Task 7 with `pnpm --filter @finsentinel/api exec vitest run src/rag/__tests__/rag-embedding.service.spec.ts` and `pnpm --filter @finsentinel/api typecheck`.

### Task 8: Migrate Tool Type Imports And Tool Factories

**Files:**

- Modify: `apps/api/src/agent/tool-registry.ts`
- Modify: every `apps/api/src/agent/tools/*.tool.ts`
- Modify tests:
  - `apps/api/src/agent/tools/__tests__/tools.spec.ts`
  - `apps/api/src/agent/__tests__/tool-registry.spec.ts`

- [x] **Step 1: Update tests to assert Pi-compatible structure**

In tool tests, update the structure assertion to require both legacy and Pi fields:

```ts
function assertToolStructure(tools: Record<string, unknown>) {
  for (const [name, t] of Object.entries(tools)) {
    const toolObj = t as Record<string, unknown>;
    expect(toolObj, `${name} missing description`).toHaveProperty('description');
    expect(typeof toolObj.description, `${name} description not string`).toBe('string');
    expect((toolObj.description as string).length, `${name} description empty`).toBeGreaterThan(0);
    expect(toolObj, `${name} missing inputSchema`).toHaveProperty('inputSchema');
    expect(toolObj, `${name} missing Pi parameters`).toHaveProperty('parameters');
    expect(toolObj, `${name} missing execute`).toHaveProperty('execute');
    expect(typeof toolObj.execute, `${name} execute not function`).toBe('function');
  }
}
```

- [x] **Step 2: Run tool tests to verify they fail after import target changes**

Run:

```bash
pnpm --filter @finsentinel/api test -- src/agent/tools/__tests__/tools.spec.ts src/agent/__tests__/tool-registry.spec.ts
```

Expected: FAIL until tool factories use the runtime adapter.

- [x] **Step 3: Update `ToolRegistry` type import**

Replace:

```ts
import type { ToolSet } from 'ai';
```

with:

```ts
import type { FinToolSet } from '@finsentinel/ai-runtime';
```

Change return types:

```ts
buildTools(userId: string, portfolioId?: string): FinToolSet
buildStockAnalysisTools(): FinToolSet
```

- [x] **Step 4: Replace tool imports mechanically**

For each `apps/api/src/agent/tools/*.tool.ts`, replace:

```ts
import { tool } from 'ai';
```

with:

```ts
import { defineZodTool as tool } from '@finsentinel/ai-runtime';
```

Keep every existing `tool({ description, inputSchema, execute })` body unchanged.

- [x] **Step 5: Verify tool factories**

Run:

```bash
pnpm --filter @finsentinel/api test -- src/agent/tools/__tests__/tools.spec.ts src/agent/__tests__/tool-registry.spec.ts
```

Expected: PASS.

**Progress log**

- 2026-04-17: Completed Task 8 by swapping agent tool factories to `@finsentinel/ai-runtime`, updating `ToolRegistry` to return `FinToolSet`, and tightening tool-structure tests to require `description`, `inputSchema`, `parameters`, and `execute`. Verified with `pnpm --filter @finsentinel/api exec vitest run src/agent/tools/__tests__/tools.spec.ts src/agent/__tests__/tool-registry.spec.ts`, `pnpm --filter @finsentinel/api typecheck`, and `rg -n "import \\{ tool \\} from 'ai'|import type \\{ ToolSet \\} from 'ai'" apps/api/src/agent`.
- 2026-04-17: Widened `FinTool.execute` to preserve existing structured tool return values, and added adapter coverage that serializes non-string tool results at the Pi Agent boundary. Verified with `pnpm --filter @finsentinel/ai-runtime exec vitest run src/tools.spec.ts`.

### Task 9: Migrate Streaming Agent Services

**Files:**

- Modify: `apps/api/src/agent/agent.service.ts`
- Modify: `apps/api/src/agent/stock-analysis.service.ts`
- Modify: `apps/api/src/okx/okx-analysis.service.ts`
- Modify tests:
  - `apps/api/src/agent/__tests__/agent.service.spec.ts`
  - add or update stock/OKX service tests if missing

- [x] **Step 1: Update `AgentService` tests**

Replace AI SDK mocks in `agent.service.spec.ts` with:

```ts
const mockStreamAgentTextFromMessages = vi.fn();

vi.mock('@finsentinel/ai-runtime', () => ({
  createOpenRouterModel: vi.fn(() => 'mock-model'),
  streamAgentTextFromMessages: (...args: unknown[]) => mockStreamAgentTextFromMessages(...args),
}));
```

Default mock:

```ts
mockStreamAgentTextFromMessages.mockReturnValue(
  (async function* () {
    yield 'Hello ';
    yield 'World';
  })(),
);
```

Update assertions:

```ts
expect(mockStreamAgentTextFromMessages).toHaveBeenCalledTimes(1);
const callArgs = mockStreamAgentTextFromMessages.mock.calls[0]![0];
expect(callArgs.systemPrompt).toContain('Risk tolerance: MODERATE');
expect(callArgs.messages).toEqual([
  { role: 'user', content: 'Hello' },
  { role: 'assistant', content: 'Hi' },
  { role: 'user', content: 'Analyze AAPL' },
]);
expect(callArgs.tools).toBe(mockTools);
expect(callArgs.maxTurns).toBe(10);
```

- [ ] **Step 2: Run agent tests to verify they fail**

Run:

```bash
pnpm --filter @finsentinel/api test -- src/agent/__tests__/agent.service.spec.ts
```

Expected: FAIL because service still imports Vercel AI SDK.

- [x] **Step 3: Migrate `AgentService`**

Replace Vercel imports with:

```ts
import { createOpenRouterModel, streamAgentTextFromMessages } from '@finsentinel/ai-runtime';
```

Replace constructor model creation with:

```ts
this.model = createOpenRouterModel({
  modelId: this.aiCfg.model,
  baseUrl: this.aiCfg.openrouterBaseUrl,
});
```

Replace `streamText` call with:

```ts
const textStream = streamAgentTextFromMessages({
  model: this.model,
  systemPrompt,
  messages: messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  })),
  tools,
  maxTurns: 10,
});
```

Return:

```ts
return this.toFinSentinelSSE(textStream, sessionId);
```

- [x] **Step 4: Migrate `StockAnalysisService`**

Use the same runtime imports and replace `getModel()` with:

```ts
private getModel() {
  return createOpenRouterModel({
    modelId: this.aiCfg.model,
    baseUrl: this.aiCfg.openrouterBaseUrl,
  });
}
```

Replace the `streamText` call with:

```ts
const textStream = streamAgentTextFromMessages({
  model: this.getModel(),
  systemPrompt: STOCK_ANALYSIS_SYSTEM_PROMPT,
  messages: messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  })),
  tools,
  maxTurns: 10,
});
```

- [x] **Step 5: Migrate `OkxAnalysisService`**

Use the runtime imports and replace `streamText` with:

```ts
const textStream = streamAgentTextFromMessages({
  model: this.model,
  systemPrompt,
  messages: [{ role: 'user', content: userMessage }],
  tools: {},
  maxTurns: 1,
});
```

- [x] **Step 6: Verify streaming services**

Run:

```bash
pnpm --filter @finsentinel/api test -- src/agent/__tests__/agent.service.spec.ts
pnpm --filter @finsentinel/api typecheck
```

Expected: PASS.

**Progress log**

- 2026-04-17: Completed Task 9 by migrating `AgentService`, `StockAnalysisService`, and `OkxAnalysisService` to `@finsentinel/ai-runtime`, adding narrow streaming-service coverage for stock and OKX, and updating `agent.service.spec.ts` to assert runtime arguments and SSE behavior. Verified with `pnpm --filter @finsentinel/api exec vitest run src/agent/__tests__/agent.service.spec.ts src/agent/__tests__/stock-analysis.service.spec.ts src/okx/__tests__/okx-analysis.service.spec.ts` and `pnpm --filter @finsentinel/api typecheck`.

### Task 10: Migrate Role Executor

**Files:**

- Modify: `apps/api/src/analysis/teams/role-executor.service.ts`
- Modify: `apps/api/src/analysis/__tests__/role-executor.service.spec.ts`
- Modify: `apps/api/src/analysis/teams/__tests__/role-executor.parse-structured.spec.ts` if imports or mocks require updates

- [x] **Step 1: Update LLM runner contract**

Change the `LlmRunner.generate` argument type from:

```ts
tools: Record<string, unknown>;
```

to:

```ts
tools: FinToolSet;
```

Import:

```ts
import type { FinToolSet } from '@finsentinel/ai-runtime';
```

- [x] **Step 2: Update tests to mock runtime**

Where tests mock `ai` or `@ai-sdk/openai`, replace them with:

```ts
vi.mock('@finsentinel/ai-runtime', () => ({
  createOpenRouterModel: vi.fn(() => 'mock-model'),
  generateAgentText: vi.fn().mockResolvedValue('{"summary":"ok","confidence":0.8,"findings":[],"risks":[],"actions":[]}')
}));
```

Use the exact JSON shape expected by `stageStructuredOutputSchema` in this repository; if that schema differs, use the minimal valid object from `packages/shared/src/schemas/analysis.ts`.

- [x] **Step 3: Run role executor tests to verify failure**

Run:

```bash
pnpm --filter @finsentinel/api test -- src/analysis/__tests__/role-executor.service.spec.ts src/analysis/teams/__tests__/role-executor.parse-structured.spec.ts
```

Expected: FAIL until service imports runtime package.

- [x] **Step 4: Migrate default LLM**

Replace Vercel imports with:

```ts
import { createOpenRouterModel, generateAgentText, type FinToolSet } from '@finsentinel/ai-runtime';
```

Replace constructor model creation with:

```ts
this.model = createOpenRouterModel({
  modelId: aiCfg.model,
  baseUrl: aiCfg.openrouterBaseUrl,
});
```

Replace `defaultLlm()` with:

```ts
private defaultLlm(): LlmRunner {
  return {
    generate: async (args) => ({
      text: await generateAgentText({
        model: args.model as never,
        systemPrompt: args.system,
        prompt: args.prompt,
        tools: args.tools,
        maxTurns: 10,
      }),
    }),
  };
}
```

- [x] **Step 5: Verify role executor**

Run:

```bash
pnpm --filter @finsentinel/api test -- src/analysis/__tests__/role-executor.service.spec.ts src/analysis/teams/__tests__/role-executor.parse-structured.spec.ts
```

Expected: PASS.

**Progress log**

- 2026-04-17: Completed Task 10 by migrating `RoleExecutorService` from `ai` / `@ai-sdk/openai` to `@finsentinel/ai-runtime`, changing `LlmRunner.generate.tools` and scoped role tools to `FinToolSet`, preserving `ROLE_TOOL_SCOPE` filtering, and adding narrow runtime mocks to role executor tests so injected-runner and JSON parsing coverage stays isolated from Pi-Mono package resolution. Initial targeted role executor verification failed before test collection with `No "exports" main defined ... @mariozechner/pi-ai/package.json`; after adding the focused runtime mocks and migrating the service, verified with `pnpm --filter @finsentinel/api exec vitest run src/analysis/__tests__/role-executor.service.spec.ts src/analysis/teams/__tests__/role-executor.parse-structured.spec.ts` (2 files, 13 tests passed), `pnpm --filter @finsentinel/api typecheck` (passed), and `rg -n "generateText|createOpenAI|@ai-sdk/openai|from 'ai'|from \"ai\"" apps/api/src/analysis/teams/role-executor.service.ts apps/api/src/analysis/__tests__/role-executor.service.spec.ts apps/api/src/analysis/teams/__tests__/role-executor.parse-structured.spec.ts` (no matches; exit 1).

### Task 11: Remove Vercel AI SDK Dependencies And Add Regression Check

**Files:**

- Modify: `apps/api/package.json`
- Modify: `package.json`
- Modify: `apps/api/src/chat/__tests__/chat-compaction.benchmark.spec.ts`
- Create: `scripts/check-no-vercel-ai-sdk.mjs`
- Modify: `pnpm-lock.yaml`

- [x] **Step 1: Create no-import checker**

Create `scripts/check-no-vercel-ai-sdk.mjs`:

```js
import { execFileSync } from 'node:child_process';

const patterns = [
  "from 'ai'",
  'from "ai"',
  "'@ai-sdk/openai'",
  '"@ai-sdk/openai"',
];

let failed = false;

for (const pattern of patterns) {
  try {
    const output = execFileSync('rg', ['-n', pattern, 'apps', 'packages'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (output.trim()) {
      failed = true;
      process.stderr.write(output);
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && error.status === 1) {
      continue;
    }
    throw error;
  }
}

if (failed) {
  process.stderr.write('Vercel AI SDK imports are not allowed. Use @finsentinel/ai-runtime.\\n');
  process.exit(1);
}
```

- [x] **Step 2: Add root script**

Update root `package.json`:

```json
{
  "scripts": {
    "check:no-vercel-ai-sdk": "node scripts/check-no-vercel-ai-sdk.mjs"
  }
}
```

Keep existing scripts unchanged.

- [x] **Step 3: Remove Vercel dependencies**

Run:

```bash
pnpm --filter @finsentinel/api remove ai @ai-sdk/openai
```

Expected: `apps/api/package.json` no longer lists either package.

- [x] **Step 4: Verify the regression check**

Run:

```bash
pnpm check:no-vercel-ai-sdk
```

Expected: PASS with no output.

- [x] **Step 5: Verify lockfile no longer resolves Vercel AI SDK packages**

Run:

```bash
rg -n "'?(@ai-sdk/openai|ai)@|@ai-sdk/openai|ai@6" pnpm-lock.yaml
```

Expected: no matches for `@ai-sdk/openai` or `ai@6`. If transitive packages still include `@ai-sdk/*`, confirm they come from another dependency before accepting.

**Progress log**

- 2026-04-17: Completed Task 11 by adding `scripts/check-no-vercel-ai-sdk.mjs`, wiring `pnpm check:no-vercel-ai-sdk`, replacing the lingering `@ai-sdk/openai` benchmark mock in `chat-compaction.benchmark.spec.ts` with an `@finsentinel/ai-runtime` mock, and removing direct `ai` / `@ai-sdk/openai` dependencies from `apps/api/package.json` with `pnpm --store-dir /Users/hongxichen/Library/pnpm/store/v10 --filter @finsentinel/api remove ai @ai-sdk/openai`. The first `pnpm remove` failed because pnpm wanted a different store location; the store-dir rerun succeeded after sandbox escalation. Verified with `pnpm check:no-vercel-ai-sdk` (passed), `pnpm --filter @finsentinel/api exec vitest run src/chat/__tests__/chat-compaction.benchmark.spec.ts` (1 file, 2 tests passed), and `pnpm --filter @finsentinel/api typecheck` (passed). Lockfile verification with `rg -n "'?(@ai-sdk/openai|ai)@|@ai-sdk/openai|ai@6" pnpm-lock.yaml` returned only unrelated package-name substrings such as `@google/genai`, `@mariozechner/pi-ai`, `@mistralai/mistralai`, `chai`, and transitive `openai@6`; there were no `@ai-sdk/openai` or direct `ai@6` lockfile entries.

### Task 12: Final Verification And Documentation

**Files:**

- Modify: `docs/exec-plans/2026-04-17-pi-mono-sdk-migration-plan.md`
- Modify: `docs/exec-plans/2026-04-17-pi-mono-refactor-plan.md`
- Modify: `README.md` or `docs/architecture/package-boundaries.md` if those files exist after the package-boundary plan is implemented

- [x] **Step 1: Run targeted tests**

Run:

```bash
pnpm --filter @finsentinel/ai-runtime test
pnpm --filter @finsentinel/api test -- src/agent/__tests__/agent.service.spec.ts
pnpm --filter @finsentinel/api test -- src/agent/tools/__tests__/tools.spec.ts src/agent/__tests__/tool-registry.spec.ts
pnpm --filter @finsentinel/api test -- src/chat/__tests__/chat-compaction.service.spec.ts
pnpm --filter @finsentinel/api test -- src/rag/__tests__/query-rewrite.service.spec.ts src/rag/__tests__/rag-embedding.service.spec.ts
pnpm --filter @finsentinel/api test -- src/analysis/__tests__/role-executor.service.spec.ts src/analysis/teams/__tests__/role-executor.parse-structured.spec.ts
```

Expected: PASS.

- [x] **Step 2: Run workspace checks**

Run:

```bash
pnpm check:no-vercel-ai-sdk
pnpm --filter @finsentinel/api typecheck
pnpm typecheck
```

Expected: PASS.

- [x] **Step 3: Update plan outcome**

Update this plan's progress log and final outcome with:

```markdown
## Final Outcome

- Vercel AI SDK imports removed from application source.
- `@finsentinel/ai-runtime` owns Pi-Mono model, tool, text, stream, and embedding adapters.
- Targeted tests and workspace typecheck passed on YYYY-MM-DD.
- Remaining follow-up: optional TypeBox-native tool schemas after the SDK migration has stabilized.
```

- [x] **Step 4: Link this plan from the broader Pi-Mono refactor plan**

Add one line to `docs/exec-plans/2026-04-17-pi-mono-refactor-plan.md` under linked artifacts or related plans:

```markdown
- SDK migration: [2026-04-17-pi-mono-sdk-migration-plan.md](/Users/hongxichen/Desktop/FinSentinel/docs/exec-plans/2026-04-17-pi-mono-sdk-migration-plan.md)
```

## Verification Approach

Use this order:

1. Runtime package unit tests.
2. API service tests for each migrated call site.
3. Tool registry and tool factory tests.
4. No-import mechanical check.
5. API typecheck.
6. Workspace typecheck.

Do not remove `ai` or `@ai-sdk/openai` until all application source imports have moved to `@finsentinel/ai-runtime`.

## Key Decisions

- Use `@mariozechner/pi-agent-core` for tool execution instead of implementing a custom tool loop.
- Use `@mariozechner/pi-ai` custom OpenRouter-compatible model objects instead of assuming every configured OpenRouter model exists in Pi-Mono's generated registry.
- Keep Zod schemas during wave 1 and adapt them at the runtime boundary.
- Implement embeddings locally because checked Pi-Mono public exports do not include an embedding API.
- Keep FinSentinel SSE formatting in app services, not the runtime package, to avoid coupling the runtime package to one transport.

## Risks And Blockers

- `pi-agent-core` type signatures may differ slightly from the README examples. If implementation finds mismatches, prefer package type definitions over this plan's snippets and update this plan before continuing.
- `zod-to-json-schema` conversion may not preserve every Zod refinement. If a tool relies on a refinement that cannot be represented to the model, keep Zod parse as the authoritative runtime validation and add a test for that tool.
- OpenRouter embedding support may differ by account or model. The embedding client must fail clearly and preserve existing vectorization failure behavior.
- The existing `RoleExecutorService` structured output schema may require a more precise mock object than the example in this plan. Read `packages/shared/src/schemas/analysis.ts` before editing that test.

## Progress Log

- 2026-04-17: Created the Pi-Mono SDK migration plan after inspecting current Vercel AI SDK imports, existing AI services, tool factories, tests, and Pi-Mono public docs/source.
- 2026-04-17: Completed final verification for the SDK migration. `pnpm --filter @finsentinel/ai-runtime test` passed with 4 files and 24 tests. A combined API Vitest run covering agent streaming, tools, tool registry, chat compaction, chat compaction benchmark, RAG query rewrite, RAG embeddings, and role executor passed with 9 files and 112 tests. `pnpm check:no-vercel-ai-sdk`, `pnpm --filter @finsentinel/api typecheck`, `pnpm typecheck`, and `git diff --check` all passed. The workspace typecheck completed with Turbo reporting 9 successful tasks; the existing desktop script printed its known `no src-tauri yet, skipping typecheck` message while exiting successfully.
- 2026-04-17: Addressed final review findings. Removed top-level runtime imports of ESM-only Pi packages from the CommonJS `@finsentinel/ai-runtime` build by returning a plain OpenRouter model object, using `@sinclair/typebox` directly for TypeBox schemas, and dynamically importing `pi-agent-core` when an agent run starts. Added terminal provider-error propagation in `text-runtime.ts` so `stopReason: "error"` / `"aborted"` assistant messages throw instead of producing successful empty output. Added regression tests for generated text and streaming provider errors. Verified with `pnpm --filter @finsentinel/ai-runtime test` (4 files, 25 tests passed), `pnpm --filter @finsentinel/ai-runtime smoke:dist` (build plus dist import passed), `node -e "import('@finsentinel/ai-runtime')..."` from `apps/api` (passed), the combined API Vitest run (9 files, 112 tests passed), `pnpm check:no-vercel-ai-sdk`, `pnpm --filter @finsentinel/api typecheck`, and `pnpm typecheck`.

## Final Outcome

- Vercel AI SDK imports were removed from application source.
- Direct `ai` and `@ai-sdk/openai` dependencies were removed from `apps/api`.
- `@finsentinel/ai-runtime` now owns Pi-Mono model, tool, text, stream, and embedding adapters.
- Chat compaction, query rewrite, RAG embeddings, streaming agent services, stock analysis, OKX analysis, tool factories, tool registry, and role executor now route through the internal runtime package.
- A mechanical `pnpm check:no-vercel-ai-sdk` check now blocks reintroducing static Vercel AI SDK imports under `apps` and `packages`.
- Targeted tests and workspace typecheck passed on 2026-04-17.
- Remaining follow-up: optional TypeBox-native tool schemas after the SDK migration has stabilized.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | - | - |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | - | - |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 4 architecture/code risks, 34 test gaps captured before implementation |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | - | Backend SDK migration; no UI scope |

**UNRESOLVED:** User still needs to confirm whether TypeBox-native tool schemas should be a follow-up after SDK removal.

**VERDICT:** ENG REVIEW COMPLETE FOR PLANNING - ready to implement in staged tasks, not as a big-bang rewrite.
