"""Small Dify Knowledge Base API client.

Official API shape used here:
- POST /datasets/{dataset_id}/document/create-by-text
- POST /datasets/{dataset_id}/document/create-by-file
- GET  /datasets/{dataset_id}/documents/{batch}/indexing-status
- PATCH /datasets/{dataset_id}/documents/status/{action}
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx


class DifyConfigError(RuntimeError):
    pass


class DifyAPIError(RuntimeError):
    pass


@dataclass(frozen=True)
class DifyConfig:
    base_url: str
    api_key: str
    dataset_id: str
    indexing_technique: str = "high_quality"
    process_rule_mode: str = "automatic"
    doc_form: str = "text_model"
    doc_language: str = "Chinese"
    timeout_seconds: float = 60.0
    app_api_key: str = ""

    @classmethod
    def from_settings(cls, settings: dict[str, Any]) -> "DifyConfig":
        base_url = str(settings.get("dify_base_url") or "").rstrip("/")
        api_key = str(settings.get("dify_api_key") or "")
        dataset_id = str(settings.get("dify_dataset_id") or "")
        if not base_url or not api_key or not dataset_id:
            raise DifyConfigError("Dify is not configured. Please set base URL, API key and dataset ID.")
        return cls(
            base_url=base_url,
            api_key=api_key,
            dataset_id=dataset_id,
            indexing_technique=str(settings.get("dify_indexing_technique") or "high_quality"),
            process_rule_mode=str(settings.get("dify_process_rule_mode") or "automatic"),
            doc_form=str(settings.get("dify_doc_form") or "text_model"),
            doc_language=str(settings.get("dify_doc_language") or "Chinese"),
            timeout_seconds=float(settings.get("dify_timeout_seconds") or 60),
            app_api_key=str(settings.get("dify_app_api_key") or ""),
        )


class DifyClient:
    def __init__(self, config: DifyConfig) -> None:
        self.config = config
        self._headers = {"Authorization": f"Bearer {config.api_key}"}

    def _url(self, path: str) -> str:
        return f"{self.config.base_url}{path}"

    def _raise_for_status(self, response: httpx.Response) -> None:
        if response.is_success:
            return
        try:
            detail = response.json()
        except ValueError:
            detail = response.text
        raise DifyAPIError(f"Dify API error {response.status_code}: {detail}")

    def process_rule(self) -> dict[str, Any]:
        return {"mode": self.config.process_rule_mode}

    def create_document_by_text(self, name: str, text: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "name": name,
            "text": text,
            "indexing_technique": self.config.indexing_technique,
            "process_rule": self.process_rule(),
            "doc_form": self.config.doc_form,
            "doc_language": self.config.doc_language,
        }
        if metadata:
            payload["doc_metadata"] = metadata
        with httpx.Client(timeout=self.config.timeout_seconds, trust_env=False) as client:
            response = client.post(
                self._url(f"/datasets/{self.config.dataset_id}/document/create-by-text"),
                headers={**self._headers, "Content-Type": "application/json"},
                json=payload,
            )
        self._raise_for_status(response)
        return response.json()

    def create_document_by_file(self, file_path: Path, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        data = {
            "indexing_technique": self.config.indexing_technique,
            "process_rule": self.process_rule(),
            "doc_form": self.config.doc_form,
            "doc_language": self.config.doc_language,
        }
        if metadata:
            data["doc_metadata"] = metadata
        with file_path.open("rb") as f, httpx.Client(
            timeout=self.config.timeout_seconds, trust_env=False
        ) as client:
            response = client.post(
                self._url(f"/datasets/{self.config.dataset_id}/document/create-by-file"),
                headers=self._headers,
                data={"data": json.dumps(data, ensure_ascii=False)},
                files={"file": (file_path.name, f)},
            )
        self._raise_for_status(response)
        return response.json()

    def update_document_by_text(self, document_id: str, name: str, text: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "name": name,
            "text": text,
            "process_rule": self.process_rule(),
        }
        if metadata:
            payload["doc_metadata"] = metadata
        with httpx.Client(timeout=self.config.timeout_seconds, trust_env=False) as client:
            response = client.post(
                self._url(f"/datasets/{self.config.dataset_id}/documents/{document_id}/update-by-text"),
                headers={**self._headers, "Content-Type": "application/json"},
                json=payload,
            )
        self._raise_for_status(response)
        return response.json()

    def update_document_by_file(self, document_id: str, name: str, file_path: Path, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        data: dict[str, Any] = {
            "name": name,
            "indexing_technique": self.config.indexing_technique,
            "process_rule": self.process_rule(),
        }
        if metadata:
            data["doc_metadata"] = metadata
        with file_path.open("rb") as f, httpx.Client(timeout=self.config.timeout_seconds, trust_env=False) as client:
            response = client.post(
                self._url(f"/datasets/{self.config.dataset_id}/documents/{document_id}/update-by-file"),
                headers=self._headers,
                data={"data": json.dumps(data, ensure_ascii=False)},
                files={"file": (file_path.name, f)},
            )
        self._raise_for_status(response)
        return response.json()

    def delete_document(self, document_id: str) -> None:
        with httpx.Client(timeout=self.config.timeout_seconds, trust_env=False) as client:
            response = client.delete(
                self._url(f"/datasets/{self.config.dataset_id}/documents/{document_id}"),
                headers=self._headers,
            )
        self._raise_for_status(response)

    def get_indexing_status(self, batch: str) -> dict[str, Any]:
        with httpx.Client(timeout=self.config.timeout_seconds, trust_env=False) as client:
            response = client.get(
                self._url(f"/datasets/{self.config.dataset_id}/documents/{batch}/indexing-status"),
                headers=self._headers,
            )
        self._raise_for_status(response)
        return response.json()

    def list_documents(self, *, page: int = 1, limit: int = 100, keyword: str = "") -> dict[str, Any]:
        """Return documents currently present in the configured Dify dataset."""
        params: dict[str, Any] = {"page": page, "limit": limit}
        if keyword.strip():
            params["keyword"] = keyword.strip()
        url = self._url(f"/datasets/{self.config.dataset_id}/documents")
        try:
            with httpx.Client(timeout=self.config.timeout_seconds, trust_env=False) as client:
                response = client.get(url, headers=self._headers, params=params)
        except httpx.RequestError as exc:
            raise DifyAPIError(
                f"无法连接 Dify 文档接口（{url}）：{exc}。请检查 dify_base_url、服务器网络和 Dify API 服务状态。"
            ) from exc
        self._raise_for_status(response)
        try:
            payload = response.json()
        except ValueError as exc:
            raise DifyAPIError(
                f"Dify 文档接口返回的不是 JSON（HTTP {response.status_code}）。"
            ) from exc
        if not isinstance(payload, dict):
            raise DifyAPIError("Dify 文档接口返回格式异常，期望 JSON 对象。")
        return payload

    def update_document_status(self, document_ids: list[str], action: str) -> dict[str, Any]:
        with httpx.Client(timeout=self.config.timeout_seconds, trust_env=False) as client:
            response = client.patch(
                self._url(f"/datasets/{self.config.dataset_id}/documents/status/{action}"),
                headers={**self._headers, "Content-Type": "application/json"},
                json={"document_ids": document_ids},
            )
        self._raise_for_status(response)
        return response.json()

    def retrieve_chunks(
        self,
        query: str,
        *,
        search_method: str = "semantic_search",
        top_k: int = 5,
        score_threshold: float | None = None,
    ) -> dict[str, Any]:
        retrieval_model: dict[str, Any] = {
            "search_method": search_method,
            "reranking_enable": False,
            "top_k": top_k,
            "score_threshold_enabled": score_threshold is not None,
        }
        if score_threshold is not None:
            retrieval_model["score_threshold"] = score_threshold
        with httpx.Client(timeout=self.config.timeout_seconds, trust_env=False) as client:
            response = client.post(
                self._url(f"/datasets/{self.config.dataset_id}/retrieve"),
                headers={**self._headers, "Content-Type": "application/json"},
                json={"query": query, "retrieval_model": retrieval_model},
            )
        self._raise_for_status(response)
        return response.json()

    def chat_message(
        self,
        query: str,
        *,
        user: str,
        inputs: dict[str, Any] | None = None,
        conversation_id: str = "",
        response_mode: str = "blocking",
    ) -> dict[str, Any]:
        if not self.config.app_api_key:
            raise DifyConfigError("Dify app API key is not configured. Please set dify_app_api_key.")
        payload: dict[str, Any] = {
            "query": query,
            "inputs": inputs or {},
            "response_mode": response_mode,
            "user": user,
            "auto_generate_name": True,
        }
        if conversation_id:
            payload["conversation_id"] = conversation_id
        with httpx.Client(timeout=self.config.timeout_seconds, trust_env=False) as client:
            response = client.post(
                self._url("/chat-messages"),
                headers={
                    "Authorization": f"Bearer {self.config.app_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        self._raise_for_status(response)
        return response.json()
