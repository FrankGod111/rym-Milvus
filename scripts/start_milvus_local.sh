#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

export ERP_DATA_DIR="${ERP_DATA_DIR:-$PROJECT_DIR/data/erp}"
export KNOWLEDGE_DATABASE_URL="${KNOWLEDGE_DATABASE_URL:-sqlite:///$ERP_DATA_DIR/knowledge.db}"
export KNOWLEDGE_VECTOR_BACKEND="${KNOWLEDGE_VECTOR_BACKEND:-milvus}"
export MILVUS_URI="${MILVUS_URI:-http://127.0.0.1:19530}"
export MILVUS_COLLECTION="${MILVUS_COLLECTION:-knowledge_chunks}"
export KNOWLEDGE_EMBEDDING_PROVIDER="${KNOWLEDGE_EMBEDDING_PROVIDER:-hash}"
export KNOWLEDGE_VECTOR_DIMENSION="${KNOWLEDGE_VECTOR_DIMENSION:-256}"

echo "ERP_DATA_DIR=$ERP_DATA_DIR"
echo "KNOWLEDGE_DATABASE_URL=$KNOWLEDGE_DATABASE_URL"
echo "MILVUS_URI=$MILVUS_URI"
echo "MILVUS_COLLECTION=$MILVUS_COLLECTION"

PYTHON_BIN="${PYTHON_BIN:-python}"
if [[ -x "$PROJECT_DIR/.venv-local/bin/python" ]] && "$PROJECT_DIR/.venv-local/bin/python" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
  PYTHON_BIN="$PROJECT_DIR/.venv-local/bin/python"
fi
exec "$PYTHON_BIN" -m uvicorn app.main:app --host "${BACKEND_HOST:-127.0.0.1}" --port "${BACKEND_PORT:-18115}"
