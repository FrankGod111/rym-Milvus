"""Authoritative relational records for documents, chunks and indexing."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Float, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.knowledge_base.database import Base


class DocumentRecord(Base):
    __tablename__ = "knowledge_documents"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    source_file_name: Mapped[str] = mapped_column(String(512), default="")
    owner_id: Mapped[str] = mapped_column(String(128), default="")
    department_id: Mapped[str] = mapped_column(String(128), default="")
    knowledge_domain: Mapped[str] = mapped_column(String(128), default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(32), default="uploaded")
    ai_enabled: Mapped[bool] = mapped_column(default=False)
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    acl_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class DocumentChunk(Base):
    __tablename__ = "knowledge_document_chunks"
    __table_args__ = (UniqueConstraint("document_id", "version", "ordinal"),)

    id: Mapped[str] = mapped_column(String(160), primary_key=True)
    document_id: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    version: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), default="")
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    index_status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    vector_backend: Mapped[str] = mapped_column(String(32), default="")
    indexed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class VectorIndexRecord(Base):
    __tablename__ = "knowledge_vector_index_records"

    chunk_id: Mapped[str] = mapped_column(String(160), primary_key=True)
    collection_name: Mapped[str] = mapped_column(String(256), nullable=False)
    milvus_pk: Mapped[str] = mapped_column(String(256), nullable=False)
    embedding_model: Mapped[str] = mapped_column(String(256), default="")
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    error: Mapped[str] = mapped_column(Text, default="")
    indexed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class IndexJob(Base):
    __tablename__ = "knowledge_index_jobs"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    document_id: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
