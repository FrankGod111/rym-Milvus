---
name: erp_scene_workflow
description: Uses the sandbox ERP workflow service to run permission-filtered knowledge Q&A, scene generation, session persistence, and approval actions through a single skill contract. Use when the agent should work from the business-level workflow instead of learning the underlying ERP, Dify, scene, and approval APIs.
metadata: {openclaw: {emoji: "🧭", requires: {bins: ["curl"]}}}
---

# erp_scene_workflow (OpenClaw skill)

Use this skill when another agent platform should consume the **business workflow** directly, rather than re-understanding the underlying ERP, knowledge base, scene generation, Dify, and approval details.

This skill wraps four capabilities behind one stable HTTP contract:

1. 权限过滤的知识检索与员工问答
2. 场景生成草稿
3. 历史会话留痕
4. 审批提交与审批决策

## Base URL

- Read the base URL from env **`OPENCLAW_KB_BASE_URL`** and strip trailing `/`.
- If unset, default to `http://127.0.0.1:8000` only when the user confirmed reachability.

All skill HTTP calls are under **`{base}/skill/v1/workflow`**.

## Auth model

This skill uses the sandbox ERP bearer token session.

1. First call `POST /skill/v1/workflow/session/login`
2. Save the returned `token`
3. Send all later workflow requests with:

```http
Authorization: Bearer <token>
```

Available demo accounts:

- `admin`
- `ops`
- `finance`

Password can be any non-empty string in this sandbox.

## Actions

| id | method | path | notes |
|---|---|---|---|
| `manifest` | GET | `/skill/v1/workflow/manifest` | Self-describes workflow actions. |
| `session_login` | POST | `/skill/v1/workflow/session/login` | Get bearer token. |
| `session_me` | GET | `/skill/v1/workflow/session/me` | Validate or refresh session token. |
| `retrieve` | POST | `/skill/v1/workflow/retrieve` | Permission-filtered knowledge retrieval only. |
| `ask` | POST | `/skill/v1/workflow/ask` | Employee QA over visible knowledge. |
| `contract_review` | POST | `/skill/v1/workflow/scenes/contract-review` | Generate contract comparison draft. |
| `meeting_summary` | POST | `/skill/v1/workflow/scenes/meeting-summary` | Generate meeting minutes draft. |
| `test_report` | POST | `/skill/v1/workflow/scenes/test-report` | Generate test report draft. |
| `list_sessions` | GET | `/skill/v1/workflow/sessions` | List saved scene sessions. |
| `get_session` | GET | `/skill/v1/workflow/sessions/{session_id}` | Read one session. |
| `submit_approval` | POST | `/skill/v1/workflow/sessions/{session_id}/submit-approval` | Push one session into approval queue. |
| `list_approvals` | GET | `/skill/v1/workflow/approvals` | List visible approvals. |
| `get_approval` | GET | `/skill/v1/workflow/approvals/{approval_id}` | Read one approval. |
| `decide_approval` | PATCH | `/skill/v1/workflow/approvals/{approval_id}` | Approve / reject. Admin required. |

## Recommended workflow

### A. Employee QA

1. `session_login`
2. `ask`
3. If the answer should be retained, keep `persist_session=true`
4. If the draft should enter review, set `submit_for_approval=true`

### B. Scene generation

1. `session_login`
2. Call one of:
   - `contract_review`
   - `meeting_summary`
   - `test_report`
3. Default to `persist_session=true`
4. If the draft must enter approval immediately, set `submit_for_approval=true`

### C. Approval loop

1. `list_approvals`
2. `get_approval`
3. `decide_approval` with `approved` or `rejected`

## Contract notes

- `ask` reuses the ERP AI chain and returns `conversation_id`, `confidence`, `retrieved_count`, `citations`.
- Scene generation endpoints return a unified structure: `scene_type`, `title`, `summary`, `output`, `citations`.
- When `persist_session=true`, the response includes a `session` object.
- When `submit_for_approval=true`, the response includes both `session` and `approval`.
- Approval is **not automatic execution**. It is a controlled confirmation step for generated drafts.

## Example: login + ask

```bash
BASE="${OPENCLAW_KB_BASE_URL:-http://127.0.0.1:8000}"

TOKEN=$(curl -sS -X POST "$BASE/skill/v1/workflow/session/login" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d '{"username":"admin","password":"admin"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')

curl -sS -X POST "$BASE/skill/v1/workflow/ask" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d '{"question":"采购审批超过5万怎么处理？","persist_session":true}'
```

## Example: generate meeting summary and submit for approval

```bash
curl -sS -X POST "$BASE/skill/v1/workflow/scenes/meeting-summary" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d '{
    "topic":"Q2 采购流程优化会",
    "meeting_date":"2026-05-15",
    "attendees":"张三、李四、王五",
    "notes":"1. 采购审批超过5万需财务复核。2. 法务要求合同模板统一。3. 下周输出流程优化草案。",
    "persist_session":true,
    "submit_for_approval":true,
    "approval_note":"请行政负责人确认纪要措辞"
  }'
```

## Example: approve one draft

```bash
curl -sS "$BASE/skill/v1/workflow/approvals" \
  -H "Authorization: Bearer $TOKEN"

curl -sS -X PATCH "$BASE/skill/v1/workflow/approvals/<approval_id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d '{"status":"approved","note":"可以进入下一步"}'
```

## Request shapes

### `POST /workflow/ask`

```json
{
  "question": "采购审批超过5万怎么处理？",
  "conversation_id": "",
  "persist_session": true,
  "submit_for_approval": false,
  "approval_note": "",
  "session_title": ""
}
```

### `POST /workflow/scenes/contract-review`

```json
{
  "primary_file_name": "合同A.txt",
  "secondary_file_name": "模板B.txt",
  "contract_type": "采购合同",
  "review_focus": "付款、违约、保密、验收",
  "notes": "重点看付款节点",
  "primary_text": "...",
  "secondary_text": "...",
  "persist_session": true,
  "submit_for_approval": false,
  "approval_note": "",
  "session_title": ""
}
```

### `PATCH /workflow/approvals/{approval_id}`

```json
{
  "status": "approved",
  "note": "确认通过"
}
```

## Installing in OpenClaw

OpenClaw picks up skills from workspace `/skills`, `/.agents/skills`, `~/.agents/skills`, `~/.openclaw/skills`, or **`skills.load.extraDirs`** in `openclaw.json`. Copy this skill directory into the workspace `skills/` directory, or add this repo's `skills/` path to `extraDirs`.

## Suggested agent behavior

- Prefer `ask` for employee-facing Q&A instead of manually calling retrieval + chat endpoints.
- Prefer scene endpoints for structured drafting instead of reconstructing prompts from scratch.
- Treat all generated results as drafts unless an approval action explicitly confirms them.
- When the task is “read-only consultation”, use `persist_session=false` and `submit_for_approval=false`.
- When the task must be traceable, keep `persist_session=true`.
- When the result must enter a controlled business flow, set `submit_for_approval=true`.
