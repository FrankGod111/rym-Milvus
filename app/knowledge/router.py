"""HTTP API: full catalog for agents, full document body per entry (no RAG)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import TypeAdapter
from starlette.responses import Response

from app.knowledge.schemas import (
    CatalogResponse,
    EntryCreate,
    EntryDocumentResponse,
    EntryMeta,
    EntryUpdate,
    IndexesResponse,
    IndexSummary,
)
from app.knowledge.store import get_store

router = APIRouter(prefix="/knowledge/v1", tags=["knowledge"])


@router.get("/catalog", response_model=CatalogResponse)
def get_catalog(
    index_key: str | None = Query(
        default=None,
        description="If set, return only entries under this index_key (logical index).",
    ),
) -> CatalogResponse:
    """Return the full catalog (metadata only). Optional filter by index_key."""
    raw = get_store().get_catalog()
    rows = raw.get("entries", [])
    if index_key is not None and index_key != "":
        rows = [e for e in rows if str(e.get("index_key", "")) == index_key]
    entries = TypeAdapter(list[EntryMeta]).validate_python(rows)
    return CatalogResponse(version=int(raw.get("version", 1)), entries=entries)


@router.get("/indexes", response_model=IndexesResponse)
def list_indexes() -> IndexesResponse:
    """List logical indexes (index_key groups) with entry counts for navigation."""
    raw = get_store().list_index_summaries()
    items = TypeAdapter(list[IndexSummary]).validate_python(raw)
    return IndexesResponse(indexes=items)


@router.get("/entries/{entry_id}", response_model=EntryMeta)
def get_entry(entry_id: str) -> EntryMeta:
    row = get_store().get_entry_meta(entry_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return EntryMeta.model_validate(row)


@router.get("/entries/{entry_id}/document", response_model=EntryDocumentResponse)
def get_entry_document(entry_id: str) -> EntryDocumentResponse:
    """Return the full knowledge document for one catalog entry (whole file, not chunks)."""
    store = get_store()
    row = store.get_entry_meta(entry_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    body = store.read_document(entry_id)
    if body is None:
        raise HTTPException(status_code=404, detail="Document file missing")
    return EntryDocumentResponse(
        id=row["id"],
        title=row["title"],
        content=body,
    )


@router.post("/entries", response_model=EntryMeta, status_code=status.HTTP_201_CREATED)
def create_entry(body: EntryCreate) -> EntryMeta:
    row = get_store().create_entry(
        title=body.title,
        summary=body.summary,
        tags=body.tags,
        content=body.content,
        index_key=body.index_key,
        index_label=body.index_label,
    )
    return EntryMeta.model_validate(row)


@router.put("/entries/{entry_id}", response_model=EntryMeta)
def replace_entry(entry_id: str, body: EntryCreate) -> EntryMeta:
    row = get_store().replace_entry(
        entry_id,
        title=body.title,
        summary=body.summary,
        tags=body.tags,
        content=body.content,
        index_key=body.index_key,
        index_label=body.index_label,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return EntryMeta.model_validate(row)


@router.patch("/entries/{entry_id}", response_model=EntryMeta)
def patch_entry(entry_id: str, body: EntryUpdate) -> EntryMeta:
    row = get_store().patch_entry(
        entry_id,
        title=body.title,
        summary=body.summary,
        tags=body.tags,
        content=body.content,
        index_key=body.index_key,
        index_label=body.index_label,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return EntryMeta.model_validate(row)


@router.delete(
    "/entries/{entry_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_entry(entry_id: str) -> Response:
    ok = get_store().delete_entry(entry_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Entry not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
