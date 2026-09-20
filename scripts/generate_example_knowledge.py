#!/usr/bin/env python3
"""Generate example_knowledge/ at repo root: 8 index groups, 20 markdown documents."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "example_knowledge"
DOCS = OUT / "documents"
NS = uuid.UUID("018d31a8-542b-7e02-8000-000000000001")

INDEXES: list[tuple[str, str, int]] = [
    ("idx-network", "网络与协议", 3),
    ("idx-security", "安全与认证", 3),
    ("idx-api", "API 与接口", 3),
    ("idx-ops", "运维与部署", 2),
    ("idx-data", "数据与存储", 3),
    ("idx-product", "产品与流程", 2),
    ("idx-support", "故障与支持", 2),
    ("idx-glossary", "术语与缩写", 2),
]


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _eid(n: int) -> str:
    return str(uuid.uuid5(NS, f"example-kb-doc-{n:02d}"))


def main() -> None:
    DOCS.mkdir(parents=True, exist_ok=True)
    entries: list[dict] = []
    n = 0
    for key, label, count in INDEXES:
        for j in range(count):
            n += 1
            eid = _eid(n)
            title = f"{label} · 文档 {j + 1}"
            summary = (
                f"索引「{label}」下的示例文档 {j + 1}/{count}，"
                f"用于本地知识库全量读取演示（非 RAG）。"
            )
            tags = [key, "demo", f"part-{j + 1}"]
            body = f"""# {title}

**索引键**: `{key}`  
**索引名**: {label}  
**条目编号**: {n}/20  

## 摘要

本文件为示例知识库中的完整文档正文，供 Agent 通过 `GET /knowledge/v1/entries/{eid}/document` 一次性拉取。

## 要点

- 与「{label}」相关的约定段落（示例）。
- 文档 ID: `{eid}`

## 小节

### 使用说明

1. 先 `GET /knowledge/v1/catalog` 或 `GET /knowledge/v1/indexes` 浏览索引。
2. 按需拉取本文或同组其他文档全文。

---
*生成时间占位：运行脚本时写入静态示例即可。*
"""
            (DOCS / f"{eid}.md").write_text(body, encoding="utf-8")
            entries.append(
                {
                    "id": eid,
                    "title": title,
                    "summary": summary,
                    "tags": tags,
                    "index_key": key,
                    "index_label": label,
                    "updated_at": _now(),
                }
            )

    assert len(entries) == 20
    catalog = {"version": 1, "entries": entries}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(entries)} entries under {OUT}")


if __name__ == "__main__":
    main()
