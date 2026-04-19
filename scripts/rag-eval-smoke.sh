#!/usr/bin/env bash
#
# rag-eval-smoke.sh — reproduce the CI RAG eval gate locally in < 10 min.
#
# Mirrors .github/workflows/rag-eval-gate.yml without spinning up a live
# API: applies migrations, seeds the fixture corpus, and runs the
# evaluator in offline CorpusRetriever mode against configs/ci-offline.yaml.
#
# Defaults to an ephemeral `finsentinel_test` DB on localhost:5432 to avoid
# touching the Homebrew-native dev DB (see CLAUDE.md). Override with
# DATABASE_URL to target a different DB. If the overridden URL points at
# the native dev DB (`/finsentinel`, not `/finsentinel_test`), the script
# prompts for interactive confirmation before proceeding.
#
# Usage:
#   ./scripts/rag-eval-smoke.sh
#   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/finsentinel_test \
#     ./scripts/rag-eval-smoke.sh
#
# Exit code:
#   0   eval gate passed
#   1+  anything failed (migration, seed, evaluator)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Preflight: fail fast if required tools are missing rather than producing
# an opaque error deep in the migrate/seed/evaluator pipeline.
command -v pnpm >/dev/null || { echo "[smoke] missing: pnpm"; exit 1; }
command -v python3 >/dev/null || { echo "[smoke] missing: python3"; exit 1; }

# DATABASE_URL handling. Two branches:
#   1) unset → default to the ephemeral finsentinel_test DB and warn loudly.
#   2) set and pointing at the dev DB → prompt before proceeding.
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[smoke] WARNING: DATABASE_URL not set — defaulting to finsentinel_test on localhost:5432."
  echo "[smoke] If you want to use a different DB, set DATABASE_URL before running this script."
  echo "[smoke] This script will: (1) run migrations, (2) seed fixture corpus, (3) run the evaluator."
  echo
  DATABASE_URL="postgresql://postgres:postgres@localhost:5432/finsentinel_test"
else
  # If DATABASE_URL points at the native dev DB (path ends in /finsentinel,
  # NOT /finsentinel_test), warn and require explicit y/Y confirmation.
  # Match on `/finsentinel` followed by end-of-string or query string.
  if [[ "$DATABASE_URL" =~ /finsentinel(\?|$) ]]; then
    echo "[smoke] Detected DATABASE_URL points at the native dev DB."
    echo "[smoke]   DATABASE_URL = ${DATABASE_URL}"
    read -r -p "Proceed? [y/N] " reply
    case "$reply" in
      y|Y) ;;
      *) echo "[smoke] aborted"; exit 1 ;;
    esac
  fi
fi

: "${REDIS_URL:=redis://localhost:6379}"
export DATABASE_URL REDIS_URL

# Belt-and-braces: the seed CLI's production-safety guard expects either
# NODE_ENV=test or an ephemeral-looking URL. Localhost matches; set
# FIXTURE_SEED_CONFIRM=1 as an extra override for operators who point
# at non-localhost test DBs.
: "${FIXTURE_SEED_CONFIRM:=1}"
export FIXTURE_SEED_CONFIRM

REPORT_DIR="${REPO_ROOT}/reports"
mkdir -p "$REPORT_DIR"
REPORT_PATH="${REPORT_DIR}/smoke-$(date +%Y%m%d-%H%M%S).json"

echo "== rag-eval-smoke =="
echo "   DATABASE_URL = ${DATABASE_URL}"
echo "   REDIS_URL    = ${REDIS_URL}"
echo "   REPORT_PATH  = ${REPORT_PATH}"
echo

echo "-> applying migrations"
pnpm --filter @finsentinel/db db:migrate

echo "-> seeding fixture corpus"
pnpm --filter @finsentinel/api rag:eval:seed-fixture \
  --corpus services/evaluation-runner/datasets/corpus.json \
  --stub-embeddings \
  --output-summary "${REPORT_DIR}/seed-summary.json"

echo "-> running evaluator (offline corpus mode)"
if python services/evaluation-runner/run_evaluation.py run \
  --dataset services/evaluation-runner/datasets/golden.json \
  --output "$REPORT_PATH" \
  --corpus services/evaluation-runner/datasets/corpus.json \
  --config services/evaluation-runner/configs/ci-offline.yaml; then
  echo
  echo "PASS — report at $REPORT_PATH"
  exit 0
else
  echo
  echo "FAIL — report at $REPORT_PATH"
  exit 1
fi
