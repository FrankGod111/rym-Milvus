"""Pydantic models for the catalog + full-document knowledge API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class EntryMeta(BaseModel):
    id: str
    title: str
    summary: str = ""
    tags: list[str] = Field(default_factory=list)
    index_key: str = ""
    index_label: str = ""
    updated_at: str


class CatalogResponse(BaseModel):
    version: int
    entries: list[EntryMeta]


class IndexSummary(BaseModel):
    key: str
    label: str
    entry_count: int


class IndexesResponse(BaseModel):
    indexes: list[IndexSummary]


class EntryCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=512)
    summary: str = Field(default="", max_length=8192)
    tags: list[str] = Field(default_factory=list)
    index_key: str = Field(default="", max_length=64)
    index_label: str = Field(default="", max_length=128)
    content: str = Field(default="", max_length=2_000_000)


class EntryUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=512)
    summary: str | None = Field(default=None, max_length=8192)
    tags: list[str] | None = None
    index_key: str | None = Field(default=None, max_length=64)
    index_label: str | None = Field(default=None, max_length=128)
    content: str | None = Field(default=None, max_length=2_000_000)


class EntryDocumentResponse(BaseModel):
    id: str
    title: str
    format: str = "text/markdown"
    content: str
