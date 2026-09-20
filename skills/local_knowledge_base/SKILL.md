---
name: local_knowledge_base
description: Reads curated knowledge from a locally hosted HTTP knowledge service by fetching a manifest, then full indexes, catalog and complete document bodies (no embeddings, no vector RAG). Use when the user mentions the project knowledge base, OPENCLAW_KB_BASE_URL, /skill/v1, or wants OpenClaw to read full local documents instead of doing retrieval search.
metadata: {openclaw: {emoji: "📚", requires: {bins: ["curl"]}}}
---

# local_knowledge_base (OpenClaw skill)

Use this skill to load curated knowledge from the companion Python service in this repository. The contract is **full-read, no RAG**: the agent reads the full catalog for navigation and then pulls **complete** document bodies for the entries it needs.

## Base URL

- Read the base URL from env **`OPENCLAW_KB_BASE_URL`** (example `http://127.0.0.1:8000`). Strip trailing `/`.
- If unset, default to `http://127.0.0.1:8000` only when the user confirmed reachability.

All skill HTTP calls are under **`{base}/skill/v1`**. CRUD administration still lives on `{base}/knowledge/v1` but is not part of this skill.

## Actions

| id | method | path | notes |
|---|---|---|---|
| `manifest` | GET | `/skill/v1/manifest` | Self-describes available actions. Call once to verify connectivity. |
| `list_indexes` | GET | `/skill/v1/kb/indexes` | Returns `index_key` groups + `entry_count`. |
| `get_catalog` | GET | `/skill/v1/kb/catalog?index_key=` | Catalog metadata; optional filter. |
| `get_document` | GET | `/skill/v1/kb/document/{entry_id}` | Full Markdown body for one entry. |
| `get_bundle` | POST | `/skill/v1/kb/bundle` | One-shot: indexes + filtered catalog + optional documents. |

## Workflow

1. Pull indexes via `list_indexes` **or** go straight to `get_bundle` for a single round-trip.
2. Pick relevant `entry_id`s from the catalog (titles + summaries + tags).
3. Pull each body with `get_document`, or preload them via `get_bundle` with `entry_ids` / `include_all_documents=true`.
4. Answer the user using **entire** document content. Do not assume chunk-level retrieval.

Context discipline: if the bundle would be large, filter by `index_keys` first, or fetch documents one by one.

## Example (curl)

```bash
BASE="${OPENCLAW_KB_BASE_URL:-http://127.0.0.1:8000}"

curl -sS "$BASE/skill/v1/manifest"
curl -sS "$BASE/skill/v1/kb/indexes"
curl -sS "$BASE/skill/v1/kb/catalog?index_key=idx-api"

# one-shot: load the API index + all its documents
curl -sS -X POST "$BASE/skill/v1/kb/bundle" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d '{"index_keys":["idx-api"],"include_all_documents":true,"max_documents":5}'
```

## Bundle request body

```json
{
  "index_keys": ["idx-api"],
  "entry_ids": ["<uuid>", "<uuid>"],
  "include_all_documents": false,
  "max_documents": 20
}
```

Response shape:

- `indexes`: full list (unchanged by filter).
- `catalog.entries`: filtered by `index_keys` if any.
- `documents`: full bodies for `entry_ids` and (if `include_all_documents`) filtered catalog entries.
- `truncated`: `true` when `max_documents` capped the document list.

## Installing in OpenClaw

OpenClaw picks up skills from workspace `/skills`, `/.agents/skills`, `~/.agents/skills`, `~/.openclaw/skills`, or **`skills.load.extraDirs`** in `openclaw.json`. Copy `{baseDir}` into the workspace `skills/` directory, or add this repo's `skills/` path to `extraDirs`. Start a new session (`/new` or restart the gateway) and verify with `openclaw skills list`.

Require the service URL via gating (optional in this skill's frontmatter):

```markdown
metadata: {openclaw: {requires: {env: ["OPENCLAW_KB_BASE_URL"], bins: ["curl"]}}}
```
