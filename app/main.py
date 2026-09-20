"""Small HTTP CRUD API for agent or client access."""

from __future__ import annotations

import threading
import uuid
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.utils import is_body_allowed_for_status_code
from pydantic import BaseModel, Field
from starlette.responses import JSONResponse, Response

from app.contracts.ai_router import router as contracts_ai_router
from app.contracts.chat_router import router as contracts_chat_router
from app.contracts.health_router import router as contracts_health_router
from app.contracts.router import router as contracts_router
from app.erp.router import router as erp_router
from app.knowledge.router import router as knowledge_router
from app.skill_api.router import router as skill_router


class UTF8JSONResponse(JSONResponse):
    """Include charset so clients decode JSON body as UTF-8 (avoids mojibake for CJK)."""

    media_type = "application/json; charset=utf-8"


async def _http_exception_handler(request: Request, exc: HTTPException) -> Response:
    headers = getattr(exc, "headers", None)
    if not is_body_allowed_for_status_code(exc.status_code):
        return Response(status_code=exc.status_code, headers=headers)
    return UTF8JSONResponse(
        {"detail": exc.detail}, status_code=exc.status_code, headers=headers
    )


async def _validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> UTF8JSONResponse:
    return UTF8JSONResponse(
        status_code=422,
        content={"detail": jsonable_encoder(exc.errors())},
    )


app = FastAPI(
    title="Mini CRUD + Knowledge Base",
    description="ERP knowledge API with relational metadata/chunks and Milvus vector retrieval.",
    version="1.0.0",
    default_response_class=UTF8JSONResponse,
)
app.add_exception_handler(HTTPException, _http_exception_handler)
app.add_exception_handler(RequestValidationError, _validation_exception_handler)
app.include_router(contracts_router)
app.include_router(contracts_ai_router)
app.include_router(contracts_chat_router)
app.include_router(contracts_health_router)
app.include_router(erp_router)
app.include_router(knowledge_router)
app.include_router(skill_router)
_lock = threading.Lock()
_store: dict[str, dict[str, Any]] = {}


class ItemCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=256)
    description: str = Field(default="", max_length=4096)


class ItemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=256)
    description: str | None = Field(default=None, max_length=4096)


class Item(BaseModel):
    id: str
    name: str
    description: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/", include_in_schema=False)
def root() -> dict[str, str]:
    """Keep the API root lightweight; the React UI is served by Vite."""
    return {"status": "ok", "service": "erp-api", "frontend": "http://127.0.0.1:5185"}


@app.post("/items", response_model=Item, status_code=status.HTTP_201_CREATED)
def create_item(body: ItemCreate) -> Item:
    item_id = str(uuid.uuid4())
    record = {"id": item_id, "name": body.name, "description": body.description}
    with _lock:
        _store[item_id] = record
    return Item(**record)


@app.get("/items", response_model=list[Item])
def list_items() -> list[Item]:
    with _lock:
        return [Item(**v) for v in _store.values()]


@app.get("/items/{item_id}", response_model=Item)
def get_item(item_id: str) -> Item:
    with _lock:
        row = _store.get(item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return Item(**row)


@app.put("/items/{item_id}", response_model=Item)
def replace_item(item_id: str, body: ItemCreate) -> Item:
    with _lock:
        if item_id not in _store:
            raise HTTPException(status_code=404, detail="Item not found")
        _store[item_id] = {
            "id": item_id,
            "name": body.name,
            "description": body.description,
        }
        return Item(**_store[item_id])


@app.patch("/items/{item_id}", response_model=Item)
def update_item(item_id: str, body: ItemUpdate) -> Item:
    with _lock:
        row = _store.get(item_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Item not found")
        if body.name is not None:
            row["name"] = body.name
        if body.description is not None:
            row["description"] = body.description
        _store[item_id] = row
        return Item(**row)


@app.delete(
    "/items/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_item(item_id: str) -> Response:
    with _lock:
        if item_id not in _store:
            raise HTTPException(status_code=404, detail="Item not found")
        del _store[item_id]
    return Response(status_code=status.HTTP_204_NO_CONTENT)
