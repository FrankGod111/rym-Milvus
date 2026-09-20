# Windows / Docker / Dify Deployment Notes

This project now centralizes most deployment addresses in code-level config files. Before packaging/deploying to a Windows server, update the following files.

## 0. Knowledge database and Milvus mode

The project defaults to `KNOWLEDGE_VECTOR_BACKEND=milvus`. This is the knowledge retrieval data plane: SQLAlchemy stores document/chunk metadata and Milvus stores vectors. The ERP compatibility state remains in `data/erp/state.json`, contracts remain in `data/contracts.db`, and uploaded files remain under `data/erp/documents/` until a separate production migration is completed.

For a production Milvus deployment, configure the relational database and vector service before starting the backend:

```powershell
$env:KNOWLEDGE_DATABASE_URL = "postgresql+psycopg://user:password@db-host:5432/rym"
$env:KNOWLEDGE_VECTOR_BACKEND = "milvus"
$env:MILVUS_URI = "http://milvus-host:19530"
$env:MILVUS_COLLECTION = "knowledge_chunks"
$env:KNOWLEDGE_EMBEDDING_PROVIDER = "ollama"
$env:KNOWLEDGE_EMBEDDING_MODEL = "nomic-embed-text"
```

Install `requirements.txt` so `pymilvus` and the PostgreSQL driver are available. The script `scripts/start_milvus_local.sh` only starts FastAPI; Milvus must be deployed separately. After deployment, run `python scripts/migrate_json_to_relational.py` and rebuild the document indexes. The migration script does not migrate the ERP JSON state, contracts SQLite database, or local files.

If Dify should remain responsible for knowledge retrieval, set `KNOWLEDGE_VECTOR_BACKEND=dify` instead. This setting changes this application's retrieval path and does not replace Dify's own PostgreSQL, Redis, or vector service.

FastAPI is API-only. The old backend-served sandbox pages `/app` and `/new` have been removed. The React/Vite interface is served on port `5185`; port `8013` is reserved for the backend API.

## 1. Frontend / Vite dev proxy

File: `deployment.config.mjs`

```js
export const deploymentConfig = {
  frontendHost: '0.0.0.0',
  frontendPort: 5185,
  backendBaseUrl: 'http://<SERVER_IP>:8013',
  ollamaBaseUrl: 'http://<SERVER_IP_OR_DOCKER_HOST>:11434',
  ollamaModel: 'qwen3:8b',
  difyBaseUrl: 'http://<SERVER_IP_OR_DIFY_HOST>:5001',
};
```

`vite.config.ts` reads this file and proxies `/api` to `deploymentConfig.backendBaseUrl`.

## 2. Browser-side API base

File: `src/config/deployment.ts`

Default recommended value:

```ts
apiBaseUrl: ''
```

Use empty string when frontend and backend are served behind the same proxy domain, e.g. browser calls `/api/contracts`.

If the frontend must call the backend directly, set:

```ts
apiBaseUrl: 'http://<SERVER_IP>:8013'
```

## 3. Backend deployment addresses

File: `app/deployment_config.py`

```python
DEPLOYMENT_CONFIG = DeploymentConfig(
    backend_host='0.0.0.0',
    backend_port=8013,
    backend_public_base_url='http://<SERVER_IP>:8013',
    ollama_base_url='http://127.0.0.1:11434',
    ollama_model='qwen3:8b',
    dify_base_url='http://<DIFY_HOST>:5001',
)
```

Notes for Windows/Docker:

- If FastAPI and Ollama run on the same Windows host without Docker isolation, use `http://127.0.0.1:11434`.
- If FastAPI runs in Docker and Ollama runs on Windows host, use `http://host.docker.internal:11434`.
- If Ollama runs as another Docker Compose service, use the service name, e.g. `http://ollama:11434`.
- If Dify runs in Docker Compose and backend runs in the same Compose network, use the Dify API service name/port.
- If backend runs outside Docker and Dify runs on Windows/Docker published port, use `http://127.0.0.1:<published_port>` or `http://<SERVER_IP>:<published_port>`.

## 4. Backend AI router manual patch if not yet applied

File: `app/contracts/ai_router.py`

Replace:

```python
import os
...
_OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
_OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:8b")
```

With:

```python
from app.deployment_config import DEPLOYMENT_CONFIG
...
_OLLAMA_URL = DEPLOYMENT_CONFIG.ollama_base_url
_OLLAMA_MODEL = DEPLOYMENT_CONFIG.ollama_model
```

Then remove unused `import os`.

## 5. Dify client manual patch if desired

File: `app/integrations/dify/client.py`

The ERP/Dify integration currently reads settings from ERP runtime settings. For code-level defaults, import `DEPLOYMENT_CONFIG` and fallback to it when settings are empty:

```python
from app.deployment_config import DEPLOYMENT_CONFIG

base_url = str(settings.get('dify_base_url') or DEPLOYMENT_CONFIG.dify_base_url or '').rstrip('/')
api_key = str(settings.get('dify_api_key') or DEPLOYMENT_CONFIG.dify_api_key or '')
dataset_id = str(settings.get('dify_dataset_id') or DEPLOYMENT_CONFIG.dify_dataset_id or '')
app_api_key = str(settings.get('dify_app_api_key') or DEPLOYMENT_CONFIG.dify_app_api_key or '')
```

## 6. Startup commands

Backend:

```bash
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8013
```

Frontend dev:

```bash
npm run dev -- --host 0.0.0.0
```

Ollama test:

```bash
curl http://127.0.0.1:11434/api/tags
```

Backend API test:

```bash
curl http://127.0.0.1:8013/api/contracts
```

Model extraction test:

```bash
curl -X POST http://127.0.0.1:8013/api/contracts/ai/extract \
  -H "Content-Type: application/json" \
  -d "{\"raw_text\":\"合同编号：HT-TEST-001\\n甲方名称：测试公司\"}"
```
