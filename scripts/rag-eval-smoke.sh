#!/usr/bin/env bash
#
# rag-eval-smoke.sh — reproduce the CI RAG eval gate locally in < 10 min.
#
# Mirrors .github/workflows/rag-eval-gate.yml without spinning up a live
# API: applies migrations, seeds the fixture corpus, and runs the
# evaluator in offline CorpusRetriever mode against configs/ci-offline.yaml.
#
# Defaults to the Homebrew-native Postgres on localhost:5432 per the repo
# convention (see CLAUDE.md). Override with DATABASE_URL if you want to
# target a different ephemeral DB.
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

: "${DATABASE_URL:=postgresql://postgres:postgres@localhost:5432/finsentinel}"
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
  --skip-enrichment \
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
