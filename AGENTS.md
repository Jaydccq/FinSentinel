# Repository Guidelines

## Project Structure & Module Organization

The active workspace is a TypeScript monorepo:

- `apps/api/`: NestJS backend root
- `apps/web/`: Next.js frontend
- `packages/db/`: Drizzle schema package
- `packages/shared/`: shared Zod schemas, enums, and utils

API source lives under `apps/api/src/` with domain packages such as `agent/`, `auth/`, `chat/`, `common/`, `config/`, `document/`, `news/`, `portfolio/`, `rag/`, `research/`, `storage/`, and `trading/`. Tests live alongside source as `*.spec.ts`. Frontend source lives under `apps/web/src/`.

## Build, Test, and Development Commands

- `pnpm --filter @finsentinel/api dev`: start the NestJS API locally.
- `pnpm --filter @finsentinel/web dev`: start the Next.js frontend locally.
- `pnpm typecheck`: run workspace type checks.
- `pnpm test`: run workspace tests.
- `pnpm build`: build active workspace packages.
- `pnpm --filter @finsentinel/api test`: run API tests only.
- `pnpm --filter @finsentinel/web lint`: lint the frontend.

Use Node.js 22+ and pnpm 10+.

## Coding Style & Naming Conventions

- Use 2-space indentation in JSON/YAML and the prevailing formatter output in TypeScript files.
- Directory names are lowercase; TypeScript files use kebab-case or framework conventions; classes/types/components use PascalCase; functions/variables use camelCase.
- Keep NestJS controllers thin; business logic belongs in services.
- Prefer explicit types at module boundaries and shared contracts in `packages/shared`.
- Keep runtime config in `apps/api/src/config/`.

## Testing Guidelines

- Frameworks: Vitest for workspace tests and NestJS test utilities in `apps/api`.
- Test files should use `*.spec.ts` and describe behavior clearly.
- Add tests for happy path, validation failures, and auth/security boundaries.
- Run `pnpm typecheck` and relevant package tests before opening a PR.
- Prioritize meaningful coverage on auth, security, trading, RAG, and AI-agent workflows.

## Commit & Pull Request Guidelines

Local `.git` history is not available in this workspace snapshot, so follow Conventional Commits:

- `feat:`, `fix:`, `refactor:`, `test:`, `docs:`

PRs should include:

- concise problem/solution summary
- linked issue (if any)
- affected modules/packages
- test evidence (commands run and results)
- API examples (sample request/response) for endpoint changes

## Security & Configuration Tips

- Do not commit `.env` or real secrets.
- Set `POSTGRES_*`, `REDIS_*`, `JWT_SECRET`, `OPENROUTER_API_KEY`, `POLYGON_API_KEY`, and `FIRECRAWL_API_KEY` via environment variables.
- Replace default local credentials and JWT values in non-development environments.
