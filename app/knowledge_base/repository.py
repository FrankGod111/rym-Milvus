"""Repository operations. SQL is the source of truth for text and metadata."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, select

from app.knowledge_base.database import SessionLocal, init_db
from app.knowledge_base.models import DocumentChunk, DocumentRecord, IndexJob, VectorIndexRecord


def _now() -> datetime:
    return datetime.now(timezone.utc)


class KnowledgeRepository:
    def __init__(self) -> None:
        init_db()

    def upsert_document(self, document: dict[str, Any], acl: dict[str, Any] | None = None) -> None:
        with SessionLocal.begin() as session:
            row = session.get(DocumentRecord, str(document["id"]))
            if row is None:
                row = DocumentRecord(id=str(document["id"]))
                session.add(row)
            row.title = str(document.get("title") or "")
            row.source_file_name = str(document.get("file_name") or "")
            row.owner_id = str(document.get("owner_id") or "")
            row.department_id = str(document.get("department_id") or "")
            row.knowledge_domain = str(document.get("knowledge_dataset_key") or "")
            row.version = int(document.get("version") or 1)
            row.status = str(document.get("status") or "uploaded")
            row.ai_enabled = bool(document.get("ai_enabled"))
            row.metadata_json = json.dumps(document, ensure_ascii=False, default=str)
            row.acl_json = json.dumps(acl or {}, ensure_ascii=False, default=str)
            row.updated_at = _now()
            row.created_at = row.created_at or _now()

    def replace_chunks(self, document: dict[str, Any], chunks: list[str]) -> list[str]:
        document_id = str(document["id"])
        version = int(document.get("version") or 1)
        ids: list[str] = []
        with SessionLocal.begin() as session:
            session.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document_id))
            session.execute(delete(VectorIndexRecord).where(VectorIndexRecord.chunk_id.like(f"{document_id}:v%")))
            for ordinal, content in enumerate(chunks):
                chunk_id = f"{document_id}:v{version}:c{ordinal:05d}"
                ids.append(chunk_id)
                session.add(DocumentChunk(
                    id=chunk_id,
                    document_id=document_id,
                    version=version,
                    ordinal=ordinal,
                    content=content,
                    content_hash=hashlib.sha256(content.encode("utf-8")).hexdigest(),
                    token_count=len(content),
                    index_status="pending",
                ))
        return ids

    def set_chunk_status(self, chunk_ids: list[str], status: str, backend: str = "", error: str = "") -> None:
        if not chunk_ids:
            return
        with SessionLocal.begin() as session:
            rows = session.scalars(select(DocumentChunk).where(DocumentChunk.id.in_(chunk_ids))).all()
            for row in rows:
                row.index_status = status
                row.vector_backend = backend
                row.indexed_at = _now() if status == "completed" else None
                if backend:
                    session.merge(VectorIndexRecord(
                        chunk_id=row.id,
                        collection_name=backend,
                        milvus_pk=row.id,
                        embedding_model="",
                        status=status,
                        error=error,
                        indexed_at=row.indexed_at,
                    ))

    def chunks_for_ids(self, chunk_ids: list[str]) -> list[DocumentChunk]:
        if not chunk_ids:
            return []
        with SessionLocal() as session:
            return list(session.scalars(select(DocumentChunk).where(DocumentChunk.id.in_(chunk_ids))))

    def documents_for_ids(self, document_ids: list[str]) -> dict[str, dict[str, Any]]:
        if not document_ids:
            return {}
        with SessionLocal() as session:
            rows = list(session.scalars(select(DocumentRecord).where(DocumentRecord.id.in_(document_ids))))
        result: dict[str, dict[str, Any]] = {}
        for row in rows:
            try:
                result[row.id] = json.loads(row.metadata_json or "{}")
            except json.JSONDecodeError:
                result[row.id] = {"id": row.id, "title": row.title}
        return result

    def all_chunks(self) -> list[DocumentChunk]:
        with SessionLocal() as session:
            return list(session.scalars(select(DocumentChunk).order_by(DocumentChunk.document_id, DocumentChunk.ordinal)))

    def delete_document(self, document_id: str) -> None:
        with SessionLocal.begin() as session:
            session.execute(delete(DocumentChunk).where(DocumentChunk.document_id == str(document_id)))
            session.execute(delete(VectorIndexRecord).where(VectorIndexRecord.chunk_id.like(f"{document_id}:v%")))
            row = session.get(DocumentRecord, str(document_id))
            if row:
                row.status = "deleted"
                row.updated_at = _now()

    def create_job(self, document_id: str, version: int, status: str, chunk_count: int = 0, error: str = "") -> str:
        job_id = f"job-{uuid.uuid4().hex[:16]}"
        with SessionLocal.begin() as session:
            session.add(IndexJob(id=job_id, document_id=document_id, version=version, status=status, chunk_count=chunk_count, error=error, created_at=_now(), finished_at=_now() if status in {"completed", "failed"} else None))
        return job_id

    def status(self) -> dict[str, Any]:
        with SessionLocal() as session:
            docs = list(session.scalars(select(DocumentRecord)))
            chunks = list(session.scalars(select(DocumentChunk)))
            jobs = list(session.scalars(select(IndexJob).order_by(IndexJob.created_at.desc()).limit(100)))
        counts: dict[str, int] = {}
        for row in chunks:
            counts[row.index_status] = counts.get(row.index_status, 0) + 1
        return {
            "database": "relational",
            "document_count": len(docs),
            "chunk_count": len(chunks),
            "chunk_status": counts,
            "jobs": [{"id": j.id, "document_id": j.document_id, "version": j.version, "status": j.status, "chunk_count": j.chunk_count, "error": j.error} for j in jobs],
        }
