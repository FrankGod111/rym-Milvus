"""File-backed catalog index + one document file per entry (no embeddings / RAG)."""

from __future__ import annotations

import json
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import os

_CATALOG_VERSION = 1
_ID_RE = re.compile(r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", re.I)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _default_root() -> Path:
    env = os.environ.get("KNOWLEDGE_DATA_DIR")
    if env:
        return Path(env).expanduser().resolve()
    repo = Path(__file__).resolve().parent.parent.parent
    demo = repo / "example_knowledge"
    if (demo / "catalog.json").is_file():
        return demo
    return repo / "data" / "knowledge"


class KnowledgeStore:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or _default_root()
        self.catalog_path = self.root / "catalog.json"
        self.documents_dir = self.root / "documents"
        self._lock = threading.Lock()

    def ensure_layout(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.documents_dir.mkdir(parents=True, exist_ok=True)
        if not self.catalog_path.exists():
            self._write_catalog_unsafe({"version": _CATALOG_VERSION, "entries": []})

    def _read_catalog_unsafe(self) -> dict[str, Any]:
        with open(self.catalog_path, encoding="utf-8") as f:
            return json.load(f)

    def _write_catalog_unsafe(self, data: dict[str, Any]) -> None:
        tmp = self.catalog_path.with_suffix(".json.tmp")
        payload = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        tmp.write_text(payload, encoding="utf-8")
        tmp.replace(self.catalog_path)

    def _doc_path(self, entry_id: str) -> Path:
        if not _ID_RE.match(entry_id):
            raise ValueError("invalid entry id")
        return self.documents_dir / f"{entry_id}.md"

    def get_catalog(self) -> dict[str, Any]:
        with self._lock:
            self.ensure_layout()
            return self._read_catalog_unsafe()

    def list_index_summaries(self) -> list[dict[str, Any]]:
        """Aggregate entry counts per index_key (the catalog's logical indexes)."""
        with self._lock:
            self.ensure_layout()
            cat = self._read_catalog_unsafe()
        buckets: dict[str, dict[str, Any]] = {}
        for e in cat.get("entries", []):
            key = str(e.get("index_key") or "")
            label = str(e.get("index_label") or "")
            if key not in buckets:
                buckets[key] = {"key": key, "label": label, "entry_count": 0}
            if label and not buckets[key]["label"]:
                buckets[key]["label"] = label
            buckets[key]["entry_count"] += 1
        # empty key (uncategorized) last, then alphabetical
        return [
            buckets[k]
            for k in sorted(buckets, key=lambda x: (x == "", x))
        ]

    def get_entry_meta(self, entry_id: str) -> dict[str, Any] | None:
        with self._lock:
            self.ensure_layout()
            cat = self._read_catalog_unsafe()
        for e in cat.get("entries", []):
            if e.get("id") == entry_id:
                return e
        return None

    def read_document(self, entry_id: str) -> str | None:
        if not _ID_RE.match(entry_id):
            return None
        path = self._doc_path(entry_id)
        if not path.is_file():
            return None
        return path.read_text(encoding="utf-8")

    def create_entry(
        self,
        title: str,
        summary: str,
        tags: list[str],
        content: str,
        index_key: str = "",
        index_label: str = "",
    ) -> dict[str, Any]:
        entry_id = str(uuid.uuid4())
        row = {
            "id": entry_id,
            "title": title,
            "summary": summary,
            "tags": list(tags),
            "index_key": index_key,
            "index_label": index_label,
            "updated_at": _utc_now_iso(),
        }
        path = self._doc_path(entry_id)
        with self._lock:
            self.ensure_layout()
            cat = self._read_catalog_unsafe()
            entries = list(cat.get("entries", []))
            entries.append(row)
            cat["version"] = int(cat.get("version", _CATALOG_VERSION))
            cat["entries"] = entries
            path.write_text(content, encoding="utf-8")
            self._write_catalog_unsafe(cat)
        return row

    def replace_entry(
        self,
        entry_id: str,
        title: str,
        summary: str,
        tags: list[str],
        content: str,
        index_key: str = "",
        index_label: str = "",
    ) -> dict[str, Any] | None:
        if not _ID_RE.match(entry_id):
            return None
        path = self._doc_path(entry_id)
        with self._lock:
            self.ensure_layout()
            cat = self._read_catalog_unsafe()
            entries = list(cat.get("entries", []))
            found = False
            new_entries: list[dict[str, Any]] = []
            for e in entries:
                if e.get("id") != entry_id:
                    new_entries.append(e)
                else:
                    found = True
                    new_entries.append(
                        {
                            "id": entry_id,
                            "title": title,
                            "summary": summary,
                            "tags": list(tags),
                            "index_key": index_key,
                            "index_label": index_label,
                            "updated_at": _utc_now_iso(),
                        }
                    )
            if not found:
                return None
            cat["entries"] = new_entries
            path.write_text(content, encoding="utf-8")
            self._write_catalog_unsafe(cat)
        return new_entries[-1]

    def patch_entry(
        self,
        entry_id: str,
        title: str | None,
        summary: str | None,
        tags: list[str] | None,
        content: str | None,
        index_key: str | None = None,
        index_label: str | None = None,
    ) -> dict[str, Any] | None:
        if not _ID_RE.match(entry_id):
            return None
        path = self._doc_path(entry_id)
        with self._lock:
            self.ensure_layout()
            cat = self._read_catalog_unsafe()
            entries = list(cat.get("entries", []))
            idx = next((i for i, e in enumerate(entries) if e.get("id") == entry_id), -1)
            if idx < 0:
                return None
            row = dict(entries[idx])
            row.setdefault("index_key", "")
            row.setdefault("index_label", "")
            if title is not None:
                row["title"] = title
            if summary is not None:
                row["summary"] = summary
            if tags is not None:
                row["tags"] = list(tags)
            if index_key is not None:
                row["index_key"] = index_key
            if index_label is not None:
                row["index_label"] = index_label
            row["updated_at"] = _utc_now_iso()
            entries[idx] = row
            cat["entries"] = entries
            if content is not None:
                path.write_text(content, encoding="utf-8")
            self._write_catalog_unsafe(cat)
        return row

    def delete_entry(self, entry_id: str) -> bool:
        if not _ID_RE.match(entry_id):
            return False
        path = self._doc_path(entry_id)
        with self._lock:
            self.ensure_layout()
            cat = self._read_catalog_unsafe()
            entries = [e for e in cat.get("entries", []) if e.get("id") != entry_id]
            if len(entries) == len(cat.get("entries", [])):
                return False
            cat["entries"] = entries
            self._write_catalog_unsafe(cat)
        if path.is_file():
            path.unlink()
        return True


_store: KnowledgeStore | None = None


def get_store() -> KnowledgeStore:
    global _store
    if _store is None:
        _store = KnowledgeStore()
    return _store
