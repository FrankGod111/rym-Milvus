#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
USERNAME="${USERNAME:-admin}"
PASSWORD="${PASSWORD:-admin}"
ROLE_MODE="${ROLE_MODE:-admin}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SAMPLES_DIR="$ROOT_DIR/sample_scene_inputs"
TMP_DIR="${TMP_DIR:-$(mktemp -d)}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required" >&2
  exit 1
fi

json_get() {
  local file="$1"
  local expr="$2"
  python3 - "$file" "$expr" <<'PY'
import json
import sys

file_path = sys.argv[1]
expr = sys.argv[2]
with open(file_path, 'r', encoding='utf-8') as f:
    data = json.load(f)
current = data
for part in expr.split('.'):
    if not part:
        continue
    if isinstance(current, list):
        current = current[int(part)]
    else:
        current = current.get(part)
print("" if current is None else current)
PY
}

post_json() {
  local path="$1"
  local body_file="$2"
  local out_file="$3"
  if [[ -n "${TOKEN:-}" ]]; then
    curl -sS "$BASE_URL$path" \
      -H "Authorization: Bearer $TOKEN" \
      -H 'Content-Type: application/json; charset=utf-8' \
      -X POST \
      --data-binary "@$body_file" \
      > "$out_file"
  else
    curl -sS "$BASE_URL$path" \
      -H 'Content-Type: application/json; charset=utf-8' \
      -X POST \
      --data-binary "@$body_file" \
      > "$out_file"
  fi
}

patch_json() {
  local path="$1"
  local body_file="$2"
  local out_file="$3"
  curl -sS "$BASE_URL$path" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json; charset=utf-8' \
    -X PATCH \
    --data-binary "@$body_file" \
    > "$out_file"
}

get_json() {
  local path="$1"
  local out_file="$2"
  curl -sS "$BASE_URL$path" \
    -H "Authorization: Bearer $TOKEN" \
    > "$out_file"
}

printf 'Using BASE_URL=%s\n' "$BASE_URL"
printf 'Temporary outputs in %s\n' "$TMP_DIR"

LOGIN_BODY="$TMP_DIR/login.json"
cat > "$LOGIN_BODY" <<JSON
{
  "username": "$USERNAME",
  "password": "$PASSWORD"
}
JSON

LOGIN_OUT="$TMP_DIR/01_login.json"
post_json "/skill/v1/workflow/session/login" "$LOGIN_BODY" "$LOGIN_OUT"
TOKEN="$(json_get "$LOGIN_OUT" token)"
USER_NAME="$(json_get "$LOGIN_OUT" user.name)"
printf '[1/8] Logged in as %s\n' "$USER_NAME"

MANIFEST_OUT="$TMP_DIR/02_manifest.json"
curl -sS "$BASE_URL/skill/v1/workflow/manifest" > "$MANIFEST_OUT"
printf '[2/8] Downloaded workflow manifest\n'

ASK_BODY="$TMP_DIR/03_ask_body.json"
cat > "$ASK_BODY" <<'JSON'
{
  "question": "采购审批超过5万怎么处理？",
  "persist_session": true,
  "submit_for_approval": false,
  "approval_note": "",
  "session_title": "采购审批问答联调样本"
}
JSON

ASK_OUT="$TMP_DIR/03_ask_response.json"
post_json "/skill/v1/workflow/ask" "$ASK_BODY" "$ASK_OUT"
ASK_SESSION_ID="$(json_get "$ASK_OUT" session.id)"
ASK_CONVERSATION_ID="$(json_get "$ASK_OUT" conversation_id)"
printf '[3/8] Asked employee QA, session=%s conversation=%s\n' "$ASK_SESSION_ID" "$ASK_CONVERSATION_ID"

MEETING_BODY="$TMP_DIR/04_meeting_summary_body.json"
python3 - "$SAMPLES_DIR/payloads/meeting_summary_payload.json" "$MEETING_BODY" <<'PY'
import json
import sys
src, dst = sys.argv[1], sys.argv[2]
with open(src, 'r', encoding='utf-8') as f:
    data = json.load(f)
data['persist_session'] = True
data['submit_for_approval'] = True
data['approval_note'] = '联调样本：请审批会议纪要草稿'
data['session_title'] = '会议纪要联调样本'
with open(dst, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
PY

MEETING_OUT="$TMP_DIR/04_meeting_summary_response.json"
post_json "/skill/v1/workflow/scenes/meeting-summary" "$MEETING_BODY" "$MEETING_OUT"
MEETING_SESSION_ID="$(json_get "$MEETING_OUT" session.id)"
MEETING_APPROVAL_ID="$(json_get "$MEETING_OUT" approval.id)"
printf '[4/8] Generated meeting summary, session=%s approval=%s\n' "$MEETING_SESSION_ID" "$MEETING_APPROVAL_ID"

CONTRACT_BODY="$TMP_DIR/05_contract_review_body.json"
python3 - "$SAMPLES_DIR/payloads/contract_review_payload.json" "$SAMPLES_DIR/contracts/contract_a_supplier_standard.md" "$SAMPLES_DIR/contracts/contract_b_company_template.md" "$CONTRACT_BODY" <<'PY'
import json
import sys
payload_path, primary_path, secondary_path, output_path = sys.argv[1:5]
with open(payload_path, 'r', encoding='utf-8') as f:
    data = json.load(f)
with open(primary_path, 'r', encoding='utf-8') as f:
    data['primary_text'] = f.read()
with open(secondary_path, 'r', encoding='utf-8') as f:
    data['secondary_text'] = f.read()
data['persist_session'] = True
data['submit_for_approval'] = False
data['approval_note'] = ''
data['session_title'] = '合同审查联调样本'
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
PY

CONTRACT_OUT="$TMP_DIR/05_contract_review_response.json"
post_json "/skill/v1/workflow/scenes/contract-review" "$CONTRACT_BODY" "$CONTRACT_OUT"
CONTRACT_SESSION_ID="$(json_get "$CONTRACT_OUT" session.id)"
printf '[5/8] Generated contract review, session=%s\n' "$CONTRACT_SESSION_ID"

SESSIONS_OUT="$TMP_DIR/06_sessions.json"
get_json "/skill/v1/workflow/sessions" "$SESSIONS_OUT"
printf '[6/8] Listed sessions\n'

APPROVALS_OUT="$TMP_DIR/07_approvals.json"
get_json "/skill/v1/workflow/approvals" "$APPROVALS_OUT"
printf '[7/8] Listed approvals\n'

if [[ "$ROLE_MODE" == "admin" && -n "$MEETING_APPROVAL_ID" ]]; then
  APPROVE_BODY="$TMP_DIR/08_approve_body.json"
  cat > "$APPROVE_BODY" <<JSON
{
  "status": "approved",
  "note": "联调样本：审批通过"
}
JSON
  APPROVE_OUT="$TMP_DIR/08_approve_response.json"
  patch_json "/skill/v1/workflow/approvals/$MEETING_APPROVAL_ID" "$APPROVE_BODY" "$APPROVE_OUT"
  printf '[8/8] Approved meeting summary approval=%s\n' "$MEETING_APPROVAL_ID"
else
  printf '[8/8] Skipped approval decision because ROLE_MODE=%s\n' "$ROLE_MODE"
fi

cat <<EOF

Smoke test completed.

Artifacts:
- login:      $LOGIN_OUT
- manifest:   $MANIFEST_OUT
- ask:        $ASK_OUT
- meeting:    $MEETING_OUT
- contract:   $CONTRACT_OUT
- sessions:   $SESSIONS_OUT
- approvals:  $APPROVALS_OUT

Key IDs:
- ask_session_id=$ASK_SESSION_ID
- meeting_session_id=$MEETING_SESSION_ID
- meeting_approval_id=$MEETING_APPROVAL_ID
- contract_session_id=$CONTRACT_SESSION_ID

You can inspect results with:
  python3 -m json.tool "$ASK_OUT"
  python3 -m json.tool "$MEETING_OUT"
  python3 -m json.tool "$SESSIONS_OUT"
EOF
