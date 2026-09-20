"""Backfill the relational RAG store from the legacy ERP JSON/files.

Usage from the clone root:
    python scripts/migrate_json_to_relational.py
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.erp.store import ERPStore
from app.knowledge_base import get_data_plane


logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")


def main() -> None:
    store = ERPStore()
    plane = get_data_plane()
    state = store.state()
    migrated = 0
    indexed = 0
    for document in state.get("documents", []):
        if document.get("status") == "deleted":
            continue
        plane.sync_document(document, state.get("permissions", {}).get(document.get("id"), {}))
        migrated += 1
        content = store._read_content(document.get("content_path", ""))
        if content:
            result = plane.index_document(document, content, state.get("permissions", {}).get(document.get("id"), {}))
            indexed += 1
            logging.info("%s: %s chunks, vector status=%s", document.get("id"), result.get("chunk_count", 0), result.get("status"))
    logging.info("migrated=%s indexed=%s", migrated, indexed)


if __name__ == "__main__":
    main()
