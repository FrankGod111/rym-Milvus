"""Orchestrates SQL chunk persistence, embeddings and Milvus retrieval."""

from __future__ import annotations

import os
import re
import uuid
from typing import Any

from app.knowledge_base.embeddings import EmbeddingError, get_embedding_provider
from app.knowledge_base.milvus_store import MilvusVectorStore, VectorStoreUnavailable
from app.knowledge_base.repository import KnowledgeRepository


def _split_text(text: str, size: int = 800, overlap: int = 120) -> list[str]:
    normalized = re.sub(r"\n{3,}", "\n\n", text or "").strip()
    if not normalized:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        end = min(len(normalized), start + size)
        if end < len(normalized):
            boundary = max(normalized.rfind("\n", start, end), normalized.rfind("。", start, end), normalized.rfind(" ", start, end))
            if boundary > start + size // 2:
                end = boundary + 1
        chunks.append(normalized[start:end].strip())
        if end >= len(normalized):
            break
        start = max(end - overlap, start + 1)
    return [chunk for chunk in chunks if chunk]


class KnowledgeDataPlane:
    def __init__(self) -> None:
        self.repository = KnowledgeRepository()
        self.embedding = get_embedding_provider()
        self.backend = os.environ.get("KNOWLEDGE_VECTOR_BACKEND", "milvus").lower()
        self.vector_store = MilvusVectorStore(self.embedding.dimension) if self.backend == "milvus" else None

    def sync_document(self, document: dict[str, Any], acl: dict[str, Any] | None = None) -> None:
        self.repository.upsert_document(document, acl)

    def index_document(self, document: dict[str, Any], content: str, acl: dict[str, Any] | None = None) -> dict[str, Any]:
        self.repository.upsert_document(document, acl)
        chunks = _split_text(content)
        chunk_ids = self.repository.replace_chunks(document, chunks)
        if not chunk_ids:
            self.repository.create_job(str(document["id"]), int(document.get("version") or 1), "skipped", 0, "没有可索引文本")
            return {"document_id": document["id"], "chunk_count": 0, "status": "skipped", "backend": self.backend}
        try:
            vectors = self.embedding.embed(chunks)
            if self.vector_store is None:
                raise VectorStoreUnavailable("Milvus vector backend is disabled")
            self.vector_store.upsert(chunk_ids, [str(document["id"])] * len(chunks), [int(document.get("version") or 1)] * len(chunks), [str(document.get("knowledge_dataset_key") or "")] * len(chunks), vectors)
            self.repository.set_chunk_status(chunk_ids, "completed", self.vector_store.collection)
            status = "completed"
            error = ""
        except (EmbeddingError, VectorStoreUnavailable, ValueError) as exc:
            # SQL chunks remain available for local lexical fallback and can be
            # retried after Milvus or the embedding service is restored.
            self.repository.set_chunk_status(chunk_ids, "pending", "", str(exc))
            status = "pending"
            error = str(exc)
        self.repository.create_job(str(document["id"]), int(document.get("version") or 1), status, len(chunks), error)
        return {"document_id": document["id"], "chunk_count": len(chunks), "status": status, "backend": self.backend, "error": error}

    def retrieve(self, query: str, top_k: int = 5, allowed_document_ids: set[str] | None = None) -> dict[str, Any]:
        all_chunks = self.repository.all_chunks()
        if not all_chunks:
            return {"chunks": [], "backend": self.backend, "reason": "no_chunks"}
        hits: list[dict[str, Any]] = []
        vector_hits = False
        try:
            vector = self.embedding.embed([query])[0]
            if self.vector_store is None:
                raise VectorStoreUnavailable("Milvus vector backend is disabled")
            hits = self.vector_store.search(vector, top_k=max(top_k * 5, 20))
            vector_hits = bool(hits)
        except (EmbeddingError, VectorStoreUnavailable, ValueError):
            # Development-safe fallback; it still reads text from SQL and never
            # bypasses the caller's document ACL filtering.
            terms = {term for term in re.split(r"\W+", query.lower()) if term}
            for row in all_chunks:
                if allowed_document_ids is not None and row.document_id not in allowed_document_ids:
                    continue
                haystack = row.content.lower()
                score = sum(1 for term in terms if term in haystack)
                if score:
                    hits.append({"chunk_id": row.id, "document_id": row.document_id, "version": row.version, "score": score / max(len(terms), 1)})
            hits.sort(key=lambda item: item["score"], reverse=True)
        # Vector search returns only IDs; hydrate those IDs with one SQL query.
        hydrated = self.repository.chunks_for_ids([str(hit.get("chunk_id")) for hit in hits]) if vector_hits else all_chunks
        by_id = {row.id: row for row in hydrated}
        results: list[dict[str, Any]] = []
        for hit in hits:
            row = by_id.get(str(hit.get("chunk_id")))
            if row is None or (allowed_document_ids is not None and row.document_id not in allowed_document_ids):
                continue
            results.append({"chunk_id": row.id, "document_id": row.document_id, "version": row.version, "score": float(hit.get("score") or 0), "content": row.content})
            if len(results) >= top_k:
                break
        return {"chunks": results, "backend": self.backend, "fallback": not bool(self.vector_store and self.vector_store.enabled)}

    def status(self) -> dict[str, Any]:
        result = self.repository.status()
        result.update({
            "vector_backend": self.backend,
            "milvus_configured": bool(self.vector_store and self.vector_store.enabled),
            "milvus_error": str(getattr(self.vector_store, "connection_error", "") or ""),
            "embedding_model": self.embedding.model,
            "embedding_dimension": self.embedding.dimension,
        })
        return result


_data_plane: KnowledgeDataPlane | None = None


def get_data_plane() -> KnowledgeDataPlane:
    global _data_plane
    if _data_plane is None:
        _data_plane = KnowledgeDataPlane()
    return _data_plane
