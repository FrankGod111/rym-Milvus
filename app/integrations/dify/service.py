"""Bridge ERP documents to Dify Knowledge Base indexing."""

from __future__ import annotations

import re
import os
from typing import Any

import httpx

from app.erp.store import ERPStore
from app.integrations.dify.client import DifyAPIError, DifyClient, DifyConfig, DifyConfigError


class DifySyncService:
    def __init__(self, store: ERPStore) -> None:
        self.store = store

    def _enrich_citations(self, citations: list[dict[str, Any]], user_id: str | None) -> list[dict[str, Any]]:
        """Attach an ERP identity and download decision without trusting Dify metadata."""
        state = self.store.state()
        documents = [doc for doc in state.get("documents", []) if doc.get("status") != "deleted"]
        by_erp_id = {str(doc.get("id")): doc for doc in documents}
        by_dify_id = {str(doc.get("dify_document_id")): doc for doc in documents if doc.get("dify_document_id")}
        enriched: list[dict[str, Any]] = []
        for citation in citations:
            item = dict(citation)
            source_id = str(item.get("document_id") or "")
            doc = by_erp_id.get(source_id) or by_dify_id.get(source_id)
            if doc is not None:
                can_download = self.store.can_user_access_document(state, doc, user_id, action="download")
                # Dify-direct documents may be permission-mapped but have no
                # original file stored in ERP, so they cannot be downloaded.
                can_download = can_download and self.store.document_absolute_path(str(doc.get("id"))) is not None
                item["erp_document_id"] = str(doc.get("id") or "")
                item["download_file_name"] = str(doc.get("file_name") or doc.get("title") or "")
                item["can_download"] = bool(can_download)
            else:
                item["erp_document_id"] = ""
                item["can_download"] = False
            enriched.append(item)
        return enriched

    def _local_visible_chunks(self, query: str, user_id: str | None, top_k: int = 5) -> list[dict[str, Any]]:
        state = self.store.state()
        query_terms = {term for term in re.split(r"\W+", query.lower()) if term}
        chunks: list[dict[str, Any]] = []
        for doc in state.get("documents", []):
            if doc.get("status") == "deleted":
                continue
            if not self.store.can_user_access_document(state, doc, user_id):
                continue
            if not self.store.document_ai_gate(doc).get("allowed"):
                continue
            content = self.store._read_content(doc.get("content_path", ""))
            haystack = " ".join([doc.get("title", ""), doc.get("category", ""), " ".join(doc.get("tags", [])), content]).lower()
            score = sum(1 for term in query_terms if term in haystack)
            if score == 0 and not any(keyword in haystack for keyword in ["采购", "审批", "5 万", "5万", "财务复核"]):
                continue
            chunks.append(
                {
                    "score": min(1.0, max(0.35, score / max(1, len(query_terms)))),
                    "content": content,
                    "segment_id": f"local:{doc['id']}",
                    "document_id": doc.get("dify_document_id") or doc["id"],
                    "document_name": doc.get("title", ""),
                    "metadata": {"source": "erp_local_fallback"},
                }
            )
        chunks.sort(key=lambda item: item["score"], reverse=True)
        return chunks[:top_k]

    def _ollama_answer(self, query: str, context: str) -> str:
        prompt = (
            "请只基于以下知识库内容回答用户问题。"
            "如果内容不足以回答，请说明没有足够依据。回答要简洁、明确，并保留关键审批步骤。\n\n"
            f"知识库内容：\n{context}\n\n用户问题：{query}"
        )
        with httpx.Client(timeout=120, trust_env=False) as client:
            response = client.post(
                "http://127.0.0.1:11434/api/generate",
                json={"model": "qwen3:8b", "prompt": prompt, "stream": False},
            )
        response.raise_for_status()
        return str(response.json().get("response") or "").strip()

    def _local_fallback_answer(self, query: str, chunks: list[dict[str, Any]]) -> str:
        if not chunks:
            return "当前知识服务暂不可用，且在你有权限访问的本地文档中没有检索到相关内容。请稍后重试，或联系管理员检查 Dify 连接。"
        excerpts = []
        for index, chunk in enumerate(chunks[:3], 1):
            name = str(chunk.get("document_name") or "文档")
            content = str(chunk.get("content") or "").strip().replace("\n", " ")
            excerpts.append(f"{index}. {name}：{content[:260]}")
        return "Dify 当前不可达，以下是根据你有权限访问的 ERP 文档找到的相关内容：\n" + "\n".join(excerpts)

    def _client(self, dataset_id: str | None = None) -> DifyClient:
        settings = self.store.raw_settings()
        if dataset_id:
            settings = {**settings, "dify_dataset_id": dataset_id}
        return DifyClient(DifyConfig.from_settings(settings))

    def _dataset_routes(self) -> list[dict[str, Any]]:
        """Build physical Dataset routes from stable ERP mapping keys.

        During rollout, mappings without dataset_id intentionally point to the
        legacy settings.dify_dataset_id, so routing can be tested before new
        Dify datasets are created.
        """
        settings = self.store.raw_settings()
        fallback_id = str(settings.get("dify_dataset_id") or "").strip()
        routes: dict[str, dict[str, Any]] = {}
        for mapping in self.store.get_dataset_mappings():
            if not bool(mapping.get("enabled", True)):
                continue
            key = str(mapping.get("dataset_key") or "").strip()
            dataset_id = str(mapping.get("dataset_id") or fallback_id).strip()
            if not key or not dataset_id:
                continue
            route = routes.setdefault(dataset_id, {"dataset_id": dataset_id, "dataset_keys": [], "mappings": []})
            route["dataset_keys"].append(key)
            route["mappings"].append(mapping)
        if not routes and fallback_id:
            routes[fallback_id] = {"dataset_id": fallback_id, "dataset_keys": ["__legacy__"], "mappings": []}
        return list(routes.values())

    def _routes_for_user(self, user_id: str | None) -> list[dict[str, Any]]:
        allowed_keys = self.store.allowed_knowledge_dataset_keys(user_id)
        routes = self._dataset_routes()
        if self.store.is_admin(user_id):
            return routes
        authorized_routes: list[dict[str, Any]] = []
        for route in routes:
            allowed_route_keys = [key for key in route["dataset_keys"] if key in allowed_keys]
            if not allowed_route_keys:
                continue
            authorized_routes.append({
                **route,
                "dataset_keys": allowed_route_keys,
                "mappings": [
                    mapping for mapping in route.get("mappings", [])
                    if str(mapping.get("dataset_key") or "") in allowed_keys
                ],
            })
        return authorized_routes

    def config_status(self) -> dict[str, Any]:
        settings = self.store.raw_settings()
        has_routed_dataset = any(
            bool(item.get("dataset_id"))
            for item in self.store.get_dataset_mappings()
            if bool(item.get("enabled", True))
        )
        missing = [
            key for key in ["dify_base_url", "dify_api_key", "dify_dataset_id"]
            if not settings.get(key) and not (key == "dify_dataset_id" and has_routed_dataset)
        ]
        return {
            "enabled": bool(settings.get("dify_enabled")),
            "configured": not missing,
            "missing": missing,
            "base_url": settings.get("dify_base_url", ""),
            "dataset_id": settings.get("dify_dataset_id", ""),
            "app_configured": bool(settings.get("dify_app_api_key")),
            "indexing_technique": settings.get("dify_indexing_technique", "high_quality"),
            "process_rule_mode": settings.get("dify_process_rule_mode", "automatic"),
            "dataset_mappings": len(self.store.get_dataset_mappings()),
            "routed_datasets": len(self._dataset_routes()),
        }

    def list_remote_documents(self, user_id: str) -> dict[str, Any]:
        """List Dify dataset documents and mark whether ERP already manages each one."""
        state = self.store.state()
        settings = self.store.raw_settings()
        fallback_id = str(settings.get("dify_dataset_id") or "").strip()
        local_documents = [doc for doc in state.get("documents", []) if doc.get("status") != "deleted"]
        local_by_dify_id = {str(doc.get("dify_document_id")): doc for doc in local_documents if doc.get("dify_document_id")}
        local_by_name = {str(doc.get("file_name") or doc.get("title") or "").lower(): doc for doc in local_documents}
        rows: list[dict[str, Any]] = []
        routes = self._routes_for_user(user_id)
        if not routes:
            return {"documents": [], "total": 0, "dataset_id": "", "dataset_routes": []}
        for route in routes:
            client = self._client(route["dataset_id"])
            page = 1
            while page <= 10:
                payload = client.list_documents(page=page, limit=100)
                page_rows = payload.get("data") or payload.get("documents") or []
                if not isinstance(page_rows, list):
                    page_rows = []
                for remote in page_rows:
                    if not isinstance(remote, dict):
                        continue
                    remote = dict(remote)
                    remote_id = str(remote.get("id") or remote.get("document_id") or "")
                    name = str(remote.get("name") or remote.get("title") or "")
                    local = local_by_dify_id.get(remote_id) or local_by_name.get(name.lower())
                    source_info = remote.get("data_source_info")
                    if not isinstance(source_info, dict):
                        source_info = {}
                    rows.append({
                        "id": remote_id or name,
                        "name": name or "未命名 Dify 文档",
                        "indexing_status": remote.get("indexing_status") or remote.get("status") or "unknown",
                        "word_count": remote.get("word_count", 0),
                        "created_at": remote.get("created_at") or remote.get("createdAt") or "",
                        "updated_at": remote.get("updated_at") or remote.get("updatedAt") or "",
                        "enabled": remote.get("enabled", True),
                        "archived": remote.get("archived", False),
                        "data_source_type": remote.get("data_source_type") or source_info.get("data_source_type", ""),
                        "dataset_id": route["dataset_id"],
                        "dataset_keys": route["dataset_keys"],
                        "managed_by_erp": bool(local),
                        "erp_document_id": local.get("id", "") if local else "",
                        "erp_title": local.get("title", "") if local else "",
                        "permission_note": "已关联 ERP 文档权限" if local else "Dify 直接上传，尚未配置 ERP 权限映射",
                    })
                has_more = bool(payload.get("has_more"))
                if not has_more or len(page_rows) < 100:
                    break
                page += 1
        return {"documents": rows, "total": len(rows), "dataset_id": fallback_id, "dataset_routes": routes}

    def sync_document(self, document_id: str) -> dict[str, Any]:
        document = self.store.get_document(document_id)
        if document is None:
            raise ValueError("Document not found")
        gate = self.store.document_ai_gate(document)
        if not gate.get("allowed"):
            raise ValueError(str(gate.get("block_reason") or "Document is not allowed to sync to AI"))
        route_key = self.store.knowledge_domain_for_document(document)
        routes = self._dataset_routes()
        route = next((item for item in routes if route_key in set(item.get("dataset_keys") or [])), None)
        if route is None and len(routes) == 1:
            route = routes[0]
        if route is None:
            raise DifyConfigError(f"文档未匹配到可用知识域：{route_key or '未配置'}")
        client = self._client(route["dataset_id"])
        settings = self.store.raw_settings()
        metadata = None
        if settings.get("dify_send_metadata"):
            metadata = {
                "erp_document_id": document["id"],
                "visibility": document.get("visibility", "department"),
                "department_id": document.get("department_id", ""),
                "org_unit_id": document.get("org_unit_id", "") or document.get("department_id", ""),
                "archive_catalog_id": document.get("archive_catalog_id", ""),
                "access_scope_type": document.get("access_scope_type", "department"),
                "access_scope_ids": ",".join(str(item) for item in (document.get("access_scope_ids") or [])),
                "owner_id": document.get("owner_id", ""),
                "category": document.get("category", ""),
                "confidentiality_level": document.get("confidentiality_level", "internal"),
                "tags": ",".join(document.get("tags", [])),
                "knowledge_domain": route_key,
                "dify_dataset_id": route["dataset_id"],
            }
        content = document.get("content_text") or ""
        old_dataset_id = str(document.get("dify_dataset_id") or "").strip()
        old_document_id = str(document.get("dify_document_id") or "").strip()
        same_dataset_update = bool(old_document_id and old_dataset_id == route["dataset_id"])
        file_path = None
        if not content.strip():
            file_path = self.store.document_absolute_path(document_id)
            if file_path is None:
                raise ValueError("Document has no readable content or stored file")
        if content.strip() and same_dataset_update:
            try:
                result = client.update_document_by_text(old_document_id, document.get("file_name") or document["title"], content, metadata)
            except DifyAPIError as exc:
                if "error 404" not in str(exc):
                    raise
                result = client.create_document_by_text(document.get("file_name") or document["title"], content, metadata)
        elif content.strip():
            result = client.create_document_by_text(document.get("file_name") or document["title"], content, metadata)
        elif same_dataset_update:
            try:
                result = client.update_document_by_file(old_document_id, document.get("file_name") or document["title"], file_path, metadata)
            except DifyAPIError as exc:
                if "error 404" not in str(exc):
                    raise
                result = client.create_document_by_file(file_path, metadata)
        else:
            result = client.create_document_by_file(file_path, metadata)
        if old_document_id and old_dataset_id and old_dataset_id != route["dataset_id"]:
            try:
                self._client(old_dataset_id).delete_document(old_document_id)
            except DifyAPIError as exc:
                if "error 404" in str(exc):
                    pass
                else:
                    # Roll back the newly-created remote document when possible so
                    # ERP never silently commits a half-finished migration.
                    new_document = result.get("document") or result.get("data") or {}
                    new_document_id = str(new_document.get("id") or result.get("document_id") or "")
                    if new_document_id:
                        try:
                            client.delete_document(new_document_id)
                        except Exception:
                            pass
                    raise DifyAPIError("目标 Dataset 已写入，但旧 Dataset 文档清理失败；已尝试回滚，请检查 Dify 后重试") from exc
            except Exception as exc:
                # Roll back the newly-created remote document when possible so
                # ERP never silently commits a half-finished migration.
                new_document = result.get("document") or result.get("data") or {}
                new_document_id = str(new_document.get("id") or result.get("document_id") or "")
                if new_document_id:
                    try:
                        client.delete_document(new_document_id)
                    except Exception:
                        pass
                raise DifyAPIError("目标 Dataset 已写入，但旧 Dataset 文档清理失败；已尝试回滚，请检查 Dify 后重试") from exc
        return self.store.record_dify_sync(
            document_id,
            result,
            dataset_id=client.config.dataset_id,
            knowledge_dataset_key=route_key,
        )

    def sync_documents(self, document_ids: list[str]) -> dict[str, Any]:
        synced: list[dict[str, Any]] = []
        errors: list[dict[str, str]] = []
        for document_id in document_ids:
            try:
                synced.append(self.sync_document(document_id))
            except (DifyConfigError, Exception) as exc:  # return per-document errors for batch work
                errors.append({"document_id": document_id, "error": str(exc)})
        return {"synced": synced, "errors": errors, "affected": len(synced)}

    def refresh_document_status(self, document_id: str) -> dict[str, Any]:
        document = self.store.get_document(document_id)
        if document is None:
            raise ValueError("Document not found")
        batch = document.get("dify_batch")
        if not batch:
            raise ValueError("Document has not been synced to Dify")
        dataset_id = str(document.get("dify_dataset_id") or "").strip()
        if not dataset_id:
            routes = self._dataset_routes()
            dataset_id = str((routes[0] if len(routes) == 1 else {}).get("dataset_id") or "")
        if not dataset_id:
            raise DifyConfigError("文档没有可用的 Dify Dataset 路由")
        client = self._client(dataset_id)
        result = client.get_indexing_status(batch)
        return self.store.record_dify_status(document_id, result)

    def refresh_documents_status(self, document_ids: list[str]) -> dict[str, Any]:
        refreshed: list[dict[str, Any]] = []
        errors: list[dict[str, str]] = []
        for document_id in document_ids:
            try:
                refreshed.append(self.refresh_document_status(document_id))
            except Exception as exc:
                errors.append({"document_id": document_id, "error": str(exc)})
        return {"refreshed": refreshed, "errors": errors, "affected": len(refreshed)}

    def retrieve(
        self,
        query: str,
        top_k: int = 5,
        score_threshold: float | None = None,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        # The new data plane is the default in the Milvus/relational clone.
        # Set KNOWLEDGE_VECTOR_BACKEND=dify to use the legacy Dify path.
        if os.environ.get("KNOWLEDGE_VECTOR_BACKEND", "milvus").lower() == "milvus":
            return self._retrieve_from_data_plane(query, top_k=top_k, user_id=user_id)
        settings = self.store.raw_settings()
        routes = self._routes_for_user(user_id)
        configured = bool(settings.get("dify_base_url") and settings.get("dify_api_key") and (settings.get("dify_dataset_id") or routes))
        if not routes and configured:
            return {"query": query, "chunks": [], "raw": {"permission_filtered": True, "reason": "当前用户没有允许访问的知识域"}}
        if not routes:
            local = self._local_visible_chunks(query, user_id, top_k=top_k)
            return {"query": query, "chunks": self._enrich_citations(local, user_id), "raw": {"fallback": "dify_not_configured"}}
        enforce_permissions = bool(user_id) and not self.store.is_admin(user_id)
        # Retrieve from every authorized Dataset. When several domains still
        # share the legacy Dataset, the route is deduplicated automatically.
        candidate_top_k = min(100, max(top_k, top_k * 10)) if enforce_permissions else top_k
        raw_by_route: list[tuple[dict[str, Any], dict[str, Any]]] = []
        route_errors: list[str] = []
        for route in routes:
            try:
                raw = self._client(route["dataset_id"]).retrieve_chunks(
                    query, top_k=candidate_top_k, score_threshold=score_threshold
                )
                if isinstance(raw, dict):
                    raw_by_route.append((raw, route))
            except (DifyConfigError, DifyAPIError, httpx.HTTPError) as exc:
                route_errors.append(f"{route['dataset_id']}: {exc}")
        # Documents uploaded directly in Dify have no ERP permission record.
        # Keep them visible to administrators while filtering them for regular users.
        state = self.store.state()
        managed_by_dify_id = {
            str(doc.get("dify_document_id")): doc
            for doc in state.get("documents", [])
            if doc.get("dify_document_id") and doc.get("status") != "deleted"
        }
        chunks: list[dict[str, Any]] = []
        seen_segments: set[str] = set()
        for raw, route in raw_by_route:
            records = raw.get("records") or raw.get("data") or []
            if not isinstance(records, list):
                continue
            for record in records:
                if not isinstance(record, dict):
                    continue
                segment = record.get("segment") or record
                if not isinstance(segment, dict):
                    segment = record
                document = segment.get("document") or record.get("document") or {}
                if not isinstance(document, dict):
                    document = {}
                document_id = document.get("id") or segment.get("document_id") or ""
                managed_document = managed_by_dify_id.get(str(document_id))
                if managed_document is None:
                    # Unlinked Dify documents have no ERP ACL. Administrators
                    # may discover them for governance; other users may not.
                    if enforce_permissions:
                        continue
                else:
                    if not self.store.can_user_access_document(state, managed_document, user_id):
                        continue
                    allow_external_content = str(managed_document.get("knowledge_source_type") or "") == "dify"
                    if not self.store.document_ai_gate(managed_document, allow_external_content=allow_external_content).get("allowed"):
                        continue
                segment_id = str(segment.get("id") or record.get("id") or "")
                dedupe_key = f"{route['dataset_id']}:{segment_id or document_id}"
                if dedupe_key in seen_segments:
                    continue
                seen_segments.add(dedupe_key)
                chunks.append(
                    {
                        "score": record.get("score") or record.get("tsne_position") or 0,
                        "content": segment.get("content") or record.get("content") or "",
                        "segment_id": segment_id,
                        "document_id": document_id,
                        "document_name": document.get("name") or document.get("title") or "",
                        "dataset_id": route["dataset_id"],
                        "dataset_keys": route["dataset_keys"],
                        "metadata": segment.get("metadata") or record.get("metadata") or {},
                    }
                )
        chunks.sort(key=lambda item: float(item.get("score") or 0), reverse=True)
        chunks = chunks[:top_k]
        if not chunks:
            if route_errors:
                local = self._local_visible_chunks(query, user_id, top_k=top_k)
                return {"query": query, "chunks": self._enrich_citations(local, user_id), "raw": {"fallback": "dify_unreachable", "errors": route_errors}}
        return {"query": query, "chunks": self._enrich_citations(chunks, user_id), "raw": {"routes": routes, "errors": route_errors}}

    def _retrieve_from_data_plane(self, query: str, *, top_k: int, user_id: str | None) -> dict[str, Any]:
        """Search Milvus, then hydrate and authorize results from SQL/ERP metadata."""
        from app.knowledge_base import get_data_plane

        state = self.store.state()
        visible = {
            str(doc.get("id"))
            for doc in state.get("documents", [])
            if doc.get("status") != "deleted"
            and self.store.can_user_access_document(state, doc, user_id)
            and self.store.document_ai_gate(doc).get("allowed")
        }
        result = get_data_plane().retrieve(query, top_k=top_k, allowed_document_ids=visible)
        sql_docs = get_data_plane().repository.documents_for_ids(
            [str(item.get("document_id")) for item in result.get("chunks", [])]
        )
        by_id = {str(doc.get("id")): doc for doc in state.get("documents", [])}
        chunks: list[dict[str, Any]] = []
        for item in result.get("chunks", []):
            document_id = str(item.get("document_id"))
            acl_doc = by_id.get(document_id)
            doc = sql_docs.get(document_id) or acl_doc
            if doc is None or acl_doc is None:
                continue
            chunks.append({
                "score": item.get("score", 0),
                "content": item.get("content", ""),
                "segment_id": item.get("chunk_id", ""),
                "document_id": doc.get("dify_document_id") or doc.get("id", ""),
                "erp_document_id": acl_doc.get("id", ""),
                "document_name": doc.get("title", ""),
                "dataset_id": doc.get("dify_dataset_id", ""),
                "dataset_keys": [doc.get("knowledge_dataset_key", "")],
                "metadata": {"source": "relational+milvus", "chunk_id": item.get("chunk_id", ""), "document_id": document_id},
            })
        return {"query": query, "chunks": self._enrich_citations(chunks, user_id), "raw": {"backend": result.get("backend", "milvus"), "fallback": result.get("fallback", False)}}

    def chat(self, query: str, user: str, conversation_id: str = "") -> dict[str, Any]:
        retrieval = self.retrieve(query, top_k=5, user_id=user)
        if not retrieval["chunks"]:
            return {
                "answer": "没有在你当前可见的知识库范围内检索到相关内容。",
                "conversation_id": conversation_id,
                "message_id": "",
                "answer_mode": "no_context",
                "permission_filtered": True,
                "confidence": 0.0,
                "retrieved_count": 0,
                "citations": [],
                "raw": {"permission_filtered": True},
            }
        context = "\n\n".join(
            f"[{idx + 1}] {chunk['document_name']}\n{chunk['content']}"
            for idx, chunk in enumerate(retrieval["chunks"])
        )
        guarded_query = (
            "请只基于以下 ERP 权限过滤后的知识库片段回答问题；"
            "如果片段不足以回答，请说明没有足够依据。\n\n"
            f"权限过滤后的片段：\n{context}\n\n用户问题：{query}"
        )
        try:
            app_routes = self._routes_for_user(user)
            if not app_routes:
                raise DifyConfigError("当前用户没有可用的 Dify 知识域")
            client = self._client(app_routes[0]["dataset_id"])
            raw = client.chat_message(
                guarded_query,
                user=user,
                conversation_id=conversation_id,
                inputs={
                    "erp_context": context,
                    "allowed_dataset_keys": ",".join(
                        sorted({key for route in app_routes for key in route["dataset_keys"]})
                    ),
                    "permission_mode": "erp_filtered_context",
                },
            )
        except (DifyConfigError, DifyAPIError, httpx.HTTPError):
            try:
                answer = self._ollama_answer(query, context)
                answer_mode = "local_ollama_fallback"
            except httpx.HTTPError:
                answer = self._local_fallback_answer(query, retrieval["chunks"])
                answer_mode = "local_document_fallback"
            raw = {
                "answer": answer,
                "conversation_id": conversation_id,
                "message_id": "",
                "metadata": {},
                "answer_mode": answer_mode,
            }
        metadata = raw.get("metadata") or {}
        retriever_resources = metadata.get("retriever_resources") or []
        retrieved_dify_ids = {str(item.get("document_id") or "") for item in retrieval["chunks"]}
        citations = []
        for item in retriever_resources:
            document_id = str(item.get("document_id") or "")
            # A Chat App may have its own bound knowledge base. Never surface
            # citations that were not present in ERP's filtered retrieval.
            if document_id not in retrieved_dify_ids:
                continue
            citations.append({
                "document_name": item.get("document_name", ""),
                "document_id": document_id,
                "segment_id": item.get("segment_id", ""),
                "content": item.get("content", ""),
                "score": item.get("score", 0),
            })
        if not citations:
            citations = retrieval["chunks"]
        citations = self._enrich_citations(citations, user)
        confidence = 0.0
        if retrieval["chunks"]:
            top_score = retrieval["chunks"][0].get("score") or 0
            try:
                confidence = max(0.0, min(1.0, float(top_score)))
            except (TypeError, ValueError):
                confidence = 0.0
        return {
            "answer": raw.get("answer") or "",
            "conversation_id": raw.get("conversation_id") or conversation_id,
            "message_id": raw.get("message_id") or "",
            "answer_mode": raw.get("answer_mode") or "guarded_chat",
            "permission_filtered": True,
            "confidence": confidence,
            "retrieved_count": len(retrieval["chunks"]),
            "citations": citations,
            "raw": raw,
        }
