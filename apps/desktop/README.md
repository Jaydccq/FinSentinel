# @finsentinel/desktop

> **Status: experimental.** Smoke CI only, no release artifacts yet.
> See the App status matrix in the [root README](../../README.md#app-status-matrix).

Tauri 2.x desktop shell for FinSentinel.

## Architecture

Two-path RAG:

- **Cloud path** — untouched. Frontend calls NestJS at `NEXT_PUBLIC_API_BASE_URL`.
- **Local path** — this package. Rust (Tauri) indexes user-picked PDFs into a SQLite
  database (`sqlite-vec` virtual table) using a locally-bundled fastembed model.
  Private docs never leave the machine.

Frontend merges both result streams via `src/lib/rag/hybrid-search.ts`.

The cloud RAG path received new fields (`chunkId`, `sourceId`, representation provenance) in the T1-T7 redesign wave. Desktop local RAG stays compatibility-only for that wave. See `docs/exec-plans/2026-04-19-desktop-rag-parity-notes.md` for the rationale and any future parity approaches.

## Running locally

```bash
pnpm --filter @finsentinel/desktop dev
```

This starts the Next.js dev server at :3000 with `NEXT_PUBLIC_TAURI=1`, compiles the
Rust side, and opens a native window.

## Building a distributable

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.finsentinel.example \
  pnpm --filter @finsentinel/desktop build
```

Output: `src-tauri/target/release/bundle/` (format varies by host OS).

## Why these choices

- **SQLite + sqlite-vec** (not LanceDB, not Qdrant): zero native deps to ship, single
  file for user data, battle-tested storage.
- **fastembed-rs bundled model** (not remote API): private docs must never hit the
  network, even for embeddings.
- **Next.js static export** (not SPA or SSR): Tauri loads static files; no Node runtime
  inside the desktop binary.
- **No sync with cloud pgvector**: out of scope (mode Y in the planning decision).

## Data location

User DB lives at the OS app-data dir:

- macOS: `~/Library/Application Support/com.finsentinel.desktop/finsentinel-private.db`
- Windows: `%APPDATA%\com.finsentinel.desktop\finsentinel-private.db`
- Linux: `~/.local/share/com.finsentinel.desktop/finsentinel-private.db`

Delete the file to reset.
