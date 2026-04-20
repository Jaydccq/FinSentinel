# NVIDIA Model Provider Integration

## Background

FinSentinel currently routes chat, agent, RAG rewrite, metadata extraction, and
representation generation through the internal `@finsentinel/ai-runtime`
package. That runtime builds OpenAI-compatible chat models, but the API config
is named around OpenRouter and relies on `OPENROUTER_API_KEY`.

NVIDIA Build/NIM exposes hosted language models through an OpenAI-compatible
chat-completions endpoint at `https://integrate.api.nvidia.com/v1`.

## Goal

Allow the API to use NVIDIA Build language models by setting environment
variables, without breaking the existing OpenRouter default.

## Scope

- Add first-class text model provider configuration for `openrouter` and
  `nvidia`.
- Add provider configuration for OpenAI-compatible embeddings while preserving
  OpenRouter defaults.
- Update environment validation, Docker Compose wiring, `.env.example`, and
  README guidance.
- Add focused tests for provider selection and model construction.

## Assumptions

- "借入" means "接入": integrate NVIDIA Build models into the app.
- This task covers hosted NVIDIA Build/NIM chat models, not self-hosted NIM
  containers.
- The NVIDIA token must be provided through environment variables, not committed
  to the repository.
- NVIDIA chat models should use an explicit `AI_MODEL` value chosen from the
  NVIDIA catalog.

## Implementation Steps

1. Add provider-neutral model construction in `@finsentinel/ai-runtime`.
   Verify: unit tests cover OpenRouter defaults, NVIDIA base URL, provider name,
   API key passthrough, and compatibility flags.
2. Extend API AI config and env validation.
   Verify: config tests cover NVIDIA provider requirements and OpenRouter
   defaults.
3. Update model call sites to use provider-neutral config.
   Verify: existing API tests that assert model factory calls are updated.
4. Update environment docs and compose files.
   Verify: `rg` shows no required OpenRouter-only wording in runtime docs.
5. Run targeted tests and type checks.
   Verify: `pnpm --filter @finsentinel/ai-runtime test` and relevant API config
   / agent tests pass.

## Verification Approach

- Unit tests for model factory behavior.
- Unit tests for environment validation.
- Focused API tests for injected model config call sites.
- Type checking for API and AI runtime packages if targeted tests pass.

## Progress Log

- 2026-04-20: Confirmed NVIDIA hosted LLM endpoint is OpenAI-compatible and uses
  `POST /v1/chat/completions` under `https://integrate.api.nvidia.com/v1`.
- 2026-04-20: Found current runtime uses OpenRouter-specific config for all
  text calls and a direct embedding client for RAG embeddings.
- 2026-04-20: Added provider-neutral OpenAI-compatible model and embedding
  factories, plus a NVIDIA model helper with conservative compatibility flags.
- 2026-04-20: Updated API config, env validation, compose files, README, and
  `.env.example` to support `AI_PROVIDER=nvidia` with `NVIDIA_API_KEY`.
- 2026-04-20: Updated API call sites and focused tests to pass provider,
  base URL, model, and API key through the runtime.
- 2026-04-20: Verified `pnpm --filter @finsentinel/ai-runtime test`
  passes with 4 files / 29 tests, and targeted API `vitest run` passes with
  13 files / 102 tests. `pnpm --filter @finsentinel/ai-runtime typecheck`,
  `pnpm --filter @finsentinel/api typecheck`, and `git diff --check` also pass.
  A broad API test invocation also ran but hit local Redis/Postgres/listen
  restrictions in unrelated integration tests.
- 2026-04-20: Investigated push CI failure on commit `38143e4`. The API
  typecheck failed because `golden-candidates.cli.ts` referenced NVIDIA/provider
  runtime exports that were still only in the local working tree. Re-verified
  the full dirty tree with `pnpm typecheck`, `pnpm build`, `git diff --check`,
  `pnpm --filter @finsentinel/ai-runtime typecheck`, `pnpm --filter
  @finsentinel/ai-runtime test`, `pnpm --filter @finsentinel/ai-runtime build`,
  and targeted API Vitest specs. All passed before committing the provider
  runtime and API changes together.

## Key Decisions

- Keep OpenRouter as the default provider to preserve current behavior.
- Introduce NVIDIA as a text provider with `NVIDIA_API_KEY` and
  `NVIDIA_BASE_URL`, while retaining separate embedding variables.
- Do not store or log real API tokens.

## Risks And Blockers

- NVIDIA model IDs are catalog-specific and change over time; users must set a
  valid `AI_MODEL` from the NVIDIA Build catalog.
- Some NVIDIA models may not support tool calling or every OpenAI extension
  used by the agent runtime. This integration disables nonessential OpenRouter
  compatibility assumptions for NVIDIA.
- Live verification requires a real NVIDIA token, which is intentionally not
  stored in the repository.

## Final Outcome

Implemented NVIDIA Build model integration through provider-neutral AI runtime
configuration. The existing OpenRouter default remains intact. NVIDIA usage
requires `AI_PROVIDER=nvidia`, a valid `NVIDIA_API_KEY`, and an explicit
`AI_MODEL` selected from the NVIDIA Build catalog. Live NVIDIA smoke testing was
not run because no token was provided or stored.
