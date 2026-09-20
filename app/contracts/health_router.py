from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from app.deployment_config import DEPLOYMENT_CONFIG

router = APIRouter(prefix="/api/contracts/ai", tags=["contracts-ai"])


class HealthCheckRequest(BaseModel):
    apiBaseUrl: str | None = None
    ollamaBaseUrl: str | None = None
    ollamaModel: str | None = None
    difyBaseUrl: str | None = None
    difyApiKey: str | None = None
    difyDatasetId: str | None = None
    difyAppApiKey: str | None = None
    embeddingProvider: str | None = None
    embeddingModel: str | None = None


async def _probe_ollama(base_url: str, model: str) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=8, trust_env=False) as client:
            response = await client.get(f"{base_url.rstrip('/')}/api/tags")
            response.raise_for_status()
            data = response.json()
        names = [item.get("name") for item in data.get("models", []) if item.get("name")]
        ok = bool(names) and (not model or model in names or any(n.startswith(model) for n in names))
        detail = f"available models: {', '.join(names[:5]) or '(none)'}"
        return {"ok": ok, "model": model, "detail": detail}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "model": model, "detail": f"ollama probe failed: {exc}"}


async def _probe_dify(
    base_url: str,
    api_key: str,
    dataset_id: str,
    app_api_key: str,
) -> dict[str, Any]:
    configured = bool(base_url) and (bool(api_key) or bool(app_api_key))
    if not configured:
        return {"ok": False, "configured": False, "datasetId": dataset_id, "detail": "not configured"}
    normalized = base_url.rstrip("/")
    headers = {"Authorization": f"Bearer {api_key or app_api_key}"}
    try:
        async with httpx.AsyncClient(timeout=8, trust_env=False) as client:
            if dataset_id and api_key:
                response = await client.get(f"{normalized}/datasets/{dataset_id}/documents", headers=headers)
            else:
                response = await client.get(f"{normalized}/datasets", headers=headers)
        if response.status_code == 200:
            return {"ok": True, "configured": True, "datasetId": dataset_id, "detail": "reachable"}
        return {
            "ok": False,
            "configured": True,
            "datasetId": dataset_id,
            "detail": f"http {response.status_code}: {response.text[:120]}",
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "configured": True, "datasetId": dataset_id, "detail": f"dify probe failed: {exc}"}


def _probe_embedding(provider: str, model: str, ollama_ok: bool, dify_ok: bool) -> dict[str, Any]:
    if provider.lower() in {"dashscope", "bailian", "aliyun"}:
        detail = "由 Dify 后台配置 DashScope/百炼 provider，前端仅记录默认值"
        return {"ok": dify_ok, "provider": provider, "model": model, "detail": detail}
    if provider.lower() == "ollama":
        return {"ok": ollama_ok, "provider": provider, "model": model, "detail": "使用本地 Ollama 嵌入模型"}
    return {"ok": False, "provider": provider, "model": model, "detail": "未识别的 embedding provider"}


@router.post("/health-check")
async def health_check(body: HealthCheckRequest) -> dict[str, Any]:
    ollama_url = body.ollamaBaseUrl or DEPLOYMENT_CONFIG.ollama_base_url
    ollama_model = body.ollamaModel or DEPLOYMENT_CONFIG.ollama_model
    dify_base = body.difyBaseUrl or DEPLOYMENT_CONFIG.dify_base_url
    dify_key = body.difyApiKey or DEPLOYMENT_CONFIG.dify_api_key
    dify_dataset = body.difyDatasetId or DEPLOYMENT_CONFIG.dify_dataset_id
    dify_app_key = body.difyAppApiKey or DEPLOYMENT_CONFIG.dify_app_api_key
    embedding_provider = body.embeddingProvider or "dashscope"
    embedding_model = body.embeddingModel or "text-embedding-v3"

    ollama = await _probe_ollama(ollama_url, ollama_model)
    dify = await _probe_dify(dify_base, dify_key, dify_dataset, dify_app_key)
    embedding = _probe_embedding(embedding_provider, embedding_model, ollama.get("ok", False), dify.get("ok", False))

    backend_detail = (
        f"public: {DEPLOYMENT_CONFIG.backend_public_base_url} · "
        f"port: {DEPLOYMENT_CONFIG.backend_port}"
    )
    return {
        "backend": {"ok": True, "detail": backend_detail},
        "ollama": ollama,
        "dify": dify,
        "embedding": embedding,
    }
