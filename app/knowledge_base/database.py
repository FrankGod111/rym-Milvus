"""SQL database bootstrap.

SQLite is the local default. Set KNOWLEDGE_DATABASE_URL to a SQLAlchemy URL
such as ``postgresql+psycopg://user:pass@host/db`` for production.
"""

from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


def _default_database_url() -> str:
    root = Path(os.environ.get("ERP_DATA_DIR", "data/erp")).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{(root / 'knowledge.db').resolve()}"


def database_url() -> str:
    configured = os.environ.get("KNOWLEDGE_DATABASE_URL")
    return configured or _default_database_url()


def _engine_kwargs(url: str) -> dict[str, object]:
    if url.startswith("sqlite"):
        if url.startswith("sqlite:///") and url != "sqlite:///:memory:":
            db_path = Path(url[len("sqlite:///"):]).expanduser()
            db_path.parent.mkdir(parents=True, exist_ok=True)
        return {"connect_args": {"check_same_thread": False}}
    return {"pool_pre_ping": True}


engine = create_engine(database_url(), future=True, **_engine_kwargs(database_url()))
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def init_db() -> None:
    # Import models before create_all so every mapped table is registered.
    from app.knowledge_base import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
