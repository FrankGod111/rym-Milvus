"""Optional Milvus adapter with a clear local fallback boundary."""

from __future__ import annotations

import os
from typing import Any


class VectorStoreUnavailable(RuntimeError):
    pass


class MilvusVectorStore:
    def __init__(self, dimension: int) -> None:
        self.uri = os.environ.get("MILVUS_URI", "http://127.0.0.1:19530").strip()
        self.collection = os.environ.get("MILVUS_COLLECTION", "knowledge_chunks").strip()
        self.dimension = dimension
        self.enabled = bool(self.uri)
        self.connection_error = ""
        self._collection: Any = None
        if self.enabled:
            try:
                from pymilvus import Collection, CollectionSchema, DataType, FieldSchema, connections, utility
            except ImportError as exc:
                self.connection_error = "pymilvus is not installed; run pip install -r requirements.txt"
                self.enabled = False
                return
            try:
                connections.connect(alias="default", uri=self.uri)
                if not utility.has_collection(self.collection):
                    schema = CollectionSchema([
                        FieldSchema(name="chunk_id", dtype=DataType.VARCHAR, is_primary=True, max_length=160),
                        FieldSchema(name="document_id", dtype=DataType.VARCHAR, max_length=128),
                        FieldSchema(name="version", dtype=DataType.INT64),
                        FieldSchema(name="knowledge_domain", dtype=DataType.VARCHAR, max_length=128),
                        FieldSchema(name="vector", dtype=DataType.FLOAT_VECTOR, dim=dimension),
                    ], description="RAG chunk vectors; SQL remains authoritative")
                    self._collection = Collection(self.collection, schema=schema)
                    self._collection.create_index("vector", {"index_type": "AUTOINDEX", "metric_type": "COSINE"})
                else:
                    self._collection = Collection(self.collection)
                self._collection.load()
            except Exception as exc:
                # A temporarily stopped Milvus must not prevent the ERP API
                # from serving metadata or retrying pending index jobs.
                self.connection_error = str(exc)
                self.enabled = False

    def upsert(self, chunk_ids: list[str], document_ids: list[str], versions: list[int], domains: list[str], vectors: list[list[float]]) -> None:
        if not self.enabled or self._collection is None:
            raise VectorStoreUnavailable("MILVUS_URI is not configured")
        self._collection.upsert([chunk_ids, document_ids, versions, domains, vectors])
        self._collection.flush()

    def search(self, vector: list[float], top_k: int = 20, domain: str | None = None) -> list[dict[str, Any]]:
        if not self.enabled or self._collection is None:
            raise VectorStoreUnavailable("MILVUS_URI is not configured")
        expr = f'knowledge_domain == "{domain.replace(chr(34), chr(92) + chr(34))}"' if domain else None
        rows = self._collection.search([vector], anns_field="vector", param={"metric_type": "COSINE"}, limit=top_k, expr=expr, output_fields=["document_id", "version", "knowledge_domain"])[0]
        return [{"chunk_id": hit.id, "score": float(hit.distance), "document_id": hit.entity.get("document_id"), "version": hit.entity.get("version"), "knowledge_domain": hit.entity.get("knowledge_domain")} for hit in rows]
