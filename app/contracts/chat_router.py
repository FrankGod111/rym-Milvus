from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.deployment_config import DEPLOYMENT_CONFIG

router = APIRouter(prefix="/api/contracts/ai", tags=["contracts-ai"])


class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1)
    user: str = "contract-user"
    conversation_id: str = ""
    inputs: dict[str, Any] = Field(default_factory=dict)
    # Optional runtime overrides that mirror the v2 settings page.
    difyBaseUrl: str | None = None
    difyAppApiKey: str | None = None


def _resolve(base_url: str | None, app_key: str | None) -> tuple[str, str]:
    resolved_base = (base_url or DEPLOYMENT_CONFIG.dify_base_url or "").rstrip("/")
    resolved_key = (app_key or DEPLOYMENT_CONFIG.dify_app_api_key or "").strip()
    if resolved_key.lower().startswith("bearer "):
        resolved_key = resolved_key[7:].strip()
    if not resolved_base:
        raise HTTPException(status_code=400, detail="Dify base URL is not configured")
    if not resolved_key:
        raise HTTPException(status_code=400, detail="Dify app API key is not configured")
    return resolved_base, resolved_key


@router.post("/chat")
async def chat(body: ChatRequest) -> dict[str, Any]:
    base_url, app_key = _resolve(body.difyBaseUrl, body.difyAppApiKey)
    payload = {
        "query": body.query,
        "user": body.user or "contract-user",
        "inputs": body.inputs or {},
        "response_mode": "blocking",
        "auto_generate_name": True,
    }
    if body.conversation_id:
        payload["conversation_id"] = body.conversation_id
    try:
        async with httpx.AsyncClient(timeout=90, trust_env=False) as client:
            response = await client.post(
                f"{base_url}/chat-messages",
                headers={
                    "Authorization": f"Bearer {app_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"dify chat request failed: {exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text[:400])

    data = response.json()
    return {
        "answer": data.get("answer") or "",
        "conversation_id": data.get("conversation_id") or "",
        "message_id": data.get("id") or data.get("message_id") or "",
        "created_at": data.get("created_at"),
        "raw": data,
    }
