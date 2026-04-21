#!/usr/bin/env bash
#
# rag-eval-local.sh — run the RAG eval against a live local apps/api.
#
# Sibling to rag-eval-smoke.sh. Where the smoke script runs the evaluator
# in offline CorpusRetriever mode against corpus.json directly, THIS
# script drives it against a running NestJS API on http://localhost:3001
# so that the real multi-stage retrieval pipeline is exercised end-to-end.
#
# Pre-requisites (must be satisfied before invoking):
#   1. apps/api is running: `pnpm --filter @finsentinel/api dev`
#   2. Postgres is reachable at DATABASE_URL (default: finsentinel_test)
#   3. Redis is reachable at REDIS_URL
#   4. An embedding provider API key is set (OPENROUTER_API_KEY or
#      NVIDIA_API_KEY) so the API's RagEmbeddingService can run.
#
# What it does:
#   - Applies DB migrations via `pnpm --filter @finsentinel/db db:migrate`
#   - Seeds the fixture corpus from services/evaluation-runner/datasets/
#     corpus.json into document_chunks (via rag:eval:seed-fixture)
#   - Runs the evaluator against the live API with the golden set
#   - Writes a timestamped report under reports/local-live-<ts>.json
#
# Usage:
#   ./scripts/rag-eval-local.sh
#   RAG_API_URL=http://localhost:3001 ./scripts/rag-eval-local.sh
#   RAG_API_TOKEN=dev-token ./scripts/rag-eval-local.sh  # optional bearer
#
# Exit code:
#   0  eval passed all configured thresholds
#   1+ evaluator/config/preflight failure or threshold violation

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

command -v pnpm >/dev/null || { echo "[local-eval] missing: pnpm"; exit 1; }
command -v python3 >/dev/null || { echo "[local-eval] missing: python3"; exit 1; }
command -v curl >/dev/null || { echo "[local-eval] missing: curl"; exit 1; }

RAG_API_URL="${RAG_API_URL:-http://localhost:3001}"
RAG_API_TOKEN="${RAG_API_TOKEN:-}"

# Fail fast if apps/api is not up. We hit /rag/search with a junk query —
# a 200/401/400/422 response proves the route is mounted; connection refused
# is a clear "API not running" signal.
echo "-> preflight: probing ${RAG_API_URL}/api/rag/search"
if ! curl -fsS -o /dev/null -w "%{http_code}" -X POST \
     -H "Content-Type: application/json" \
     -d '{"query":"preflight","topK":1}' \
     --max-time 5 \
     "${RAG_API_URL}/api/rag/search" 2>&1 | grep -qE '^[0-9]+$'; then
  echo "[local-eval] apps/api not reachable at ${RAG_API_URL}. Start it first:"
  echo "  pnpm --filter @finsentinel/api dev"
  exit 1
fi

# DATABASE_URL — default to finsentinel_test to avoid stepping on native dev DB.
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[local-eval] DATABASE_URL unset — defaulting to finsentinel_test on localhost:5432."
  DATABASE_URL="postgresql://postgres:postgres@localhost:5432/finsentinel_test"
else
  if [[ "$DATABASE_URL" =~ /finsentinel(\?|$) ]]; then
    echo "[local-eval] Detected DATABASE_URL points at the native dev DB."
    echo "  DATABASE_URL = ${DATABASE_URL}"
    read -r -p "Proceed (will migrate + seed fixture)? [y/N] " reply
    case "$reply" in y|Y) ;; *) echo "[local-eval] aborted"; exit 1 ;; esac
  fi
fi

: "${REDIS_URL:=redis://localhost:6379}"
: "${FIXTURE_SEED_CONFIRM:=1}"
export DATABASE_URL REDIS_URL FIXTURE_SEED_CONFIRM

REPORT_DIR="${REPO_ROOT}/reports"
mkdir -p "$REPORT_DIR"
REPORT_PATH="${REPORT_DIR}/local-live-$(date +%Y%m%d-%H%M%S).json"

CONFIG="${EVAL_CONFIG:-services/evaluation-runner/configs/wave2-buckets.yaml}"

echo "== rag-eval-local =="
echo "   RAG_API_URL   = ${RAG_API_URL}"
echo "   TOKEN         = $([[ -n "$RAG_API_TOKEN" ]] && echo 'present' || echo 'none')"
echo "   DATABASE_URL  = ${DATABASE_URL}"
echo "   REDIS_URL     = ${REDIS_URL}"
echo "   CONFIG        = ${CONFIG}"
echo "   REPORT_PATH   = ${REPORT_PATH}"
echo

echo "-> applying migrations"
pnpm --filter @finsentinel/db db:migrate

echo "-> seeding fixture corpus"
pnpm --filter @finsentinel/api rag:eval:seed-fixture \
  --corpus services/evaluation-runner/datasets/corpus.json \
  --stub-embeddings \
  --output-summary "${REPORT_DIR}/seed-summary.json"

echo "-> running evaluator (live-API mode)"
# Config provides api_base_url; RAG_API_URL env overrides it at run time via
# run_evaluation.py's retrieval.api_token/bearer path. We export RAG_API_TOKEN
# so fetch_retrieval_results() picks it up without a config edit.
export RAG_API_TOKEN

if python services/evaluation-runner/run_evaluation.py run \
  --dataset services/evaluation-runner/datasets/golden.json \
  --output "$REPORT_PATH" \
  --config "$CONFIG"; then
  echo
  echo "PASS — report at $REPORT_PATH"
  exit 0
else
  echo
  echo "FAIL — report at $REPORT_PATH"
  exit 1
fi
