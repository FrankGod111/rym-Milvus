"""Relational metadata + vector search data plane for the RAG application."""

from app.knowledge_base.service import KnowledgeDataPlane, get_data_plane

__all__ = ["KnowledgeDataPlane", "get_data_plane"]
