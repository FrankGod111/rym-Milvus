# Workflow skill curl 联调样本

本文档用于让另一个智能体平台或外部调用方，直接基于 **skill 风格入口** 完成联调，不需要重新理解底层 ERP / Dify / 场景接口。

对应 skill：

- `skills/erp_scene_workflow/SKILL.md`
- `GET /skill/v1/workflow/manifest`

## 1. 前提

启动服务：

```bash
cd /Users/frankgod/Desktop/RAG_t/Test_python_frontend_sandbox
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

基础地址：

```bash
BASE="http://127.0.0.1:8000"
```

## 2. 登录

```bash
TOKEN=$(curl -sS -X POST "$BASE/skill/v1/workflow/session/login" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d '{"username":"admin","password":"admin"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')
```

如果是只读联调，也可以改成：

- `ops`
- `finance`

## 3. 查看 skill manifest

```bash
curl -sS "$BASE/skill/v1/workflow/manifest" | python3 -m json.tool
```

## 4. 员工问答

```bash
curl -sS -X POST "$BASE/skill/v1/workflow/ask" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d '{
    "question":"采购审批超过5万怎么处理？",
    "persist_session":true,
    "submit_for_approval":false,
    "approval_note":"",
    "session_title":"采购审批问答联调样本"
  }' | python3 -m json.tool
```

返回重点：

- `output.answer`
- `citations`
- `conversation_id`
- `session.id`

## 5. 知识检索

```bash
curl -sS -X POST "$BASE/skill/v1/workflow/retrieve" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d '{
    "question":"采购审批超过5万怎么处理？",
    "top_k":5,
    "score_threshold":0.3
  }' | python3 -m json.tool
```

## 6. 会议纪要生成并直接提交审批

```bash
python3 - <<'PY' >/tmp/workflow_meeting_payload.json
import json
payload = {
  "topic": "Q2 采购流程优化会",
  "meeting_date": "2026-05-11",
  "attendees": "张三、李四、王五、赵六、钱七",
  "notes": "张三说明当前采购申请资料不完整的问题较多。李四提出金额超过5万元的采购必须先经部门负责人审批，再由财务复核预算和付款条件。王五提醒合同模板版本不统一，部分供应商版本存在自动验收、争议管辖地偏向供应商的问题。会议决定本周内补齐采购制度文档，统一合同模板，并上线普通员工问答场景测试。",
  "persist_session": True,
  "submit_for_approval": True,
  "approval_note": "联调样本：请审批会议纪要草稿",
  "session_title": "会议纪要联调样本"
}
print(json.dumps(payload, ensure_ascii=False))
PY

curl -sS -X POST "$BASE/skill/v1/workflow/scenes/meeting-summary" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json; charset=utf-8' \
  --data-binary @/tmp/workflow_meeting_payload.json | python3 -m json.tool
```

返回重点：

- `output.summary`
- `output.decisions`
- `output.todos`
- `session.id`
- `approval.id`

## 7. 合同审查生成

使用现有样本文件：

- `sample_scene_inputs/contracts/contract_a_supplier_standard.md`
- `sample_scene_inputs/contracts/contract_b_company_template.md`

```bash
python3 - <<'PY' >/tmp/workflow_contract_payload.json
import json
from pathlib import Path
root = Path('/Users/frankgod/Desktop/RAG_t/Test_python_frontend_sandbox/sample_scene_inputs/contracts')
payload = {
  "primary_file_name": "contract_a_supplier_standard.md",
  "secondary_file_name": "contract_b_company_template.md",
  "contract_type": "采购服务合同",
  "review_focus": "付款条件, 违约责任, 验收条款, 保密与数据安全, 争议解决",
  "notes": "重点识别供应商版本相对公司模板的风险，包括预付款比例过高、自动验收、违约责任不对等、保密期限不足和管辖地不利。",
  "primary_text": (root / 'contract_a_supplier_standard.md').read_text(encoding='utf-8'),
  "secondary_text": (root / 'contract_b_company_template.md').read_text(encoding='utf-8'),
  "persist_session": True,
  "submit_for_approval": False,
  "approval_note": "",
  "session_title": "合同审查联调样本"
}
print(json.dumps(payload, ensure_ascii=False))
PY

curl -sS -X POST "$BASE/skill/v1/workflow/scenes/contract-review" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json; charset=utf-8' \
  --data-binary @/tmp/workflow_contract_payload.json | python3 -m json.tool
```

## 8. 查询历史会话

```bash
curl -sS "$BASE/skill/v1/workflow/sessions" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

## 9. 查询审批列表

```bash
curl -sS "$BASE/skill/v1/workflow/approvals" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

## 10. 审批通过

仅管理员账号可操作。

```bash
APPROVAL_ID="替换为上一步返回的 approval.id"

curl -sS -X PATCH "$BASE/skill/v1/workflow/approvals/$APPROVAL_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d '{"status":"approved","note":"联调样本：审批通过"}' | python3 -m json.tool
```

## 11. 一键联调脚本

项目中也提供了可直接执行的 smoke 脚本：

```bash
cd /Users/frankgod/Desktop/RAG_t/Test_python_frontend_sandbox
bash scripts/workflow_skill_smoke.sh
```

可选环境变量：

```bash
BASE_URL=http://127.0.0.1:8000
USERNAME=admin
PASSWORD=admin
ROLE_MODE=admin
```

如果不想在脚本最后自动执行审批动作：

```bash
ROLE_MODE=finance bash scripts/workflow_skill_smoke.sh
```

## 12. 建议给另一个平台的接入方式

推荐它按以下顺序读取：

1. `skills/erp_scene_workflow/SKILL.md`
2. `GET /skill/v1/workflow/manifest`
3. 本文档中的 curl 样本

这样对方平台通常只需要理解：

- 如何拿 token
- 哪个 action 负责问答
- 哪个 action 负责场景生成
- 哪个 action 负责审批

而不需要再理解 `/erp/v1/ai/chat`、`/erp/v1/scene-sessions`、`/erp/v1/approvals` 和底层 Dify 接口。