# @finsentinel/web

Canonical frontend for FinSentinel.

This is the only frontend included in the pnpm/Turbo workspace.

## Commands

```bash
pnpm --filter @finsentinel/web dev
pnpm --filter @finsentinel/web build
pnpm --filter @finsentinel/web typecheck
pnpm --filter @finsentinel/web lint
```

## API Proxying

The app proxies `/api/*` through `next.config.ts`.

Defaults:
- local development: `http://localhost:3001`
- containerized runtime: set `INTERNAL_API_ORIGIN=http://api:3001`

## Notes

- Active frontend development belongs here.
