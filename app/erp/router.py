"""ERP document management API routes."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile, status
from starlette.responses import FileResponse, Response

from app.erp.schemas import (
    AiGovernancePolicyUpdateRequest,
    AiGovernanceReviewRecordResponse,
    AiGovernanceReviewRequest,
    AiQuestionRequest,
    AiQuestionResponse,
    AccessDecisionResponse,
    ApprovalCreateRequest,
    ApprovalDecisionRequest,
    ArchiveCatalogCreateRequest,
    ArchiveCatalogItemCreateRequest,
    ArchiveCatalogItemUpdateRequest,
    ArchiveCatalogResponse,
    ArchiveCatalogUpdateRequest,
    ArchiveCoverageDetailResponse,
    ArchiveDocumentCatalogMatchRequest,
    ArchiveDocumentScopeTransferRequest,
    ArchiveMissingItemResponse,
    ArchiveTreeBatchUpdateRequest,
    ArchiveTreeMergeRequest,
    ArchiveTreeMoveRequest,
    ArchiveTreeNodeCreateRequest,
    ArchiveTreeNodeUpdateRequest,
    AssistantApprovalSubmitRequest,
    AssistantCard,
    AssistantFieldDescriptor,
    AssistantTurnRequest,
    AssistantTurnResponse,
    BatchActionRequest,
    CatalogPermissionUpdate,
    ContractReviewRequest,
    DashboardResponse,
    DifyChatResponse,
    DifyDocumentLinkRequest,
    DocumentCreate,
    DocumentListResponse,
    DocumentUpdate,
    KnowledgeDatasetMappingResponse,
    KnowledgeDatasetMappingUpdateRequest,
    KnowledgeRetrieveResponse,
    LoginRequest,
    LoginResponse,
    MeetingSummaryRequest,
    OrgTreeNode,
    PermissionUpdate,
    RolePermissionUpdate,
    SceneResultResponse,
    SceneSessionCreateRequest,
    SettingsUpdateRequest,
    SettingUpdate,
    TestReportRequest,
)
from app.erp.store import get_erp_store
from app.integrations.dify.client import DifyAPIError, DifyConfigError
from app.integrations.dify.service import DifySyncService

router = APIRouter(prefix="/erp/v1", tags=["erp"])
MAX_UPLOAD_BYTES = 50 * 1024 * 1024


SCENE_KEYWORDS = {
    "contract-review": ["合同", "条款", "模板", "审查", "对比", "协议"],
    "meeting-summary": ["纪要", "会议", "待办", "决议", "会议记录"],
    "test-report": ["测试报告", "测试结论", "缺陷", "上线建议", "回归测试"],
}


def _extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


def current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    token = _extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    user = get_erp_store().authenticate(token)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user


def require_permission(permission: str):
    def dependency(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        if not get_erp_store().user_has_permission(user["id"], permission):
            raise HTTPException(status_code=403, detail=f"Missing permission: {permission}")
        return user

    return dependency


def require_permissions(*permissions: str):
    def dependency(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        missing = [permission for permission in permissions if not get_erp_store().user_has_permission(user["id"], permission)]
        if missing:
            raise HTTPException(status_code=403, detail=f"Missing permission: {', '.join(missing)}")
        return user

    return dependency


def require_admin(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if not get_erp_store().is_admin(user["id"]):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def require_archive_missing_access(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    """Only administrators or department operators may view archive gaps."""
    store = get_erp_store()
    if store.is_admin(user["id"]) or store.user_has_permission(user["id"], "archive:write"):
        return user
    raise HTTPException(status_code=403, detail="当前账号无档案缺失提醒权限")


def _short_text(value: str, limit: int = 160) -> str:
    text = " ".join(str(value or "").strip().split())
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}…"


def _scene_label(scene_type: str) -> str:
    return {
        "employee-qa": "普通员工问答",
        "contract-review": "合同对比审查",
        "meeting-summary": "会议纪要生成",
        "test-report": "测试报告生成",
    }.get(scene_type, scene_type)


def _persist_scene_result(
    *,
    user: dict[str, Any],
    scene_type: str,
    title: str,
    input_payload: dict[str, Any],
    output: dict[str, Any],
    summary: str,
    citations: list[dict[str, Any]],
    conversation_id: str = "",
    submit_for_approval: bool = False,
    approval_note: str = "",
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    store = get_erp_store()
    session = store.create_scene_session(
        user,
        {
            "scene_type": scene_type,
            "title": title,
            "input": input_payload,
            "output": output,
            "summary": summary,
            "citations": citations,
            "conversation_id": conversation_id,
            "status": "completed",
        },
    )
    approval = None
    if submit_for_approval:
        approval = store.create_approval(user, session["id"], approval_note)
    return session, approval


def _qa_cards(answer: str, citations: list[dict[str, Any]], session: dict[str, Any] | None) -> list[AssistantCard]:
    cards = [
        AssistantCard(
            type="answer",
            title="问答结果",
            body=answer,
            actions=[
                {"id": "submit-approval", "label": "提交审批"},
                {"id": "view-history", "label": "查看历史"},
            ] if session else [],
        )
    ]
    if citations:
        cards.append(
            AssistantCard(
                type="citations",
                title="引用来源",
                data={"citations": citations},
            )
        )
    return cards


def _scene_cards(
    *,
    scene_type: str,
    summary: str,
    output: dict[str, Any],
    citations: list[dict[str, Any]],
    session: dict[str, Any] | None,
    approval: dict[str, Any] | None,
) -> list[AssistantCard]:
    cards = [
        AssistantCard(
            type="draft",
            title=f"{_scene_label(scene_type)}草稿",
            body=summary,
            data={"scene_type": scene_type, "output": output},
            actions=[
                {"id": "submit-approval", "label": "提交审批"},
                {"id": "view-history", "label": "查看历史"},
            ] if session and approval is None else [{"id": "view-history", "label": "查看历史"}],
        )
    ]
    if citations:
        cards.append(
            AssistantCard(
                type="citations",
                title="引用来源",
                data={"citations": citations},
            )
        )
    if approval is not None:
        cards.append(
            AssistantCard(
                type="approval",
                title="审批状态",
                body=f"当前状态：{approval.get('status', 'pending')}",
                data=approval,
            )
        )
    return cards


def _history_cards(user: dict[str, Any]) -> list[AssistantCard]:
    sessions = get_erp_store().list_scene_sessions(user["id"])[:8]
    approvals = get_erp_store().list_approvals(user["id"])[:8]
    cards: list[AssistantCard] = []
    if sessions:
        cards.append(
            AssistantCard(
                type="sessions",
                title="最近历史会话",
                data={"sessions": sessions},
            )
        )
    if approvals:
        cards.append(
            AssistantCard(
                type="approvals",
                title="最近审批事项",
                data={"approvals": approvals},
            )
        )
    return cards


def _archive_governance_citations(user: dict[str, Any]) -> list[dict[str, Any]]:
    missing = get_erp_store().archive_missing_items(user["id"])
    citations: list[dict[str, Any]] = []
    for item in missing.get("items", [])[:8]:
        citations.append(
            {
                "document_id": str(item.get("catalog_item_id") or ""),
                "document_name": f"档案记录 · {item.get('scope_name', '')}",
                "content": f"缺失目录项：{item.get('document_name_rule', '')}；分类：{item.get('category', '')}/{item.get('subcategory', '')}；归档周期：{item.get('filing_period', '')}",
                "score": 1,
                "segment_id": "archive-record",
                "source_type": "archive_record",
            }
        )
    return citations


def _ai_governance_citations(user: dict[str, Any]) -> list[dict[str, Any]]:
    docs = get_erp_store().list_ai_governance_documents(user["id"])
    citations: list[dict[str, Any]] = []
    for item in docs.get("documents", [])[:8]:
        citations.append(
            {
                "document_id": str(item.get("id") or ""),
                "document_name": f"AI 知识来源 · {item.get('title', '')}",
                "content": item.get("ai_gate_block_reason") or item.get("review_pending_reason") or item.get("knowledge_dataset_key") or "治理状态已记录",
                "score": 1,
                "segment_id": "ai-knowledge-source",
                "source_type": "ai_knowledge_source",
            }
        )
    return citations


def _archive_governance_cards(user: dict[str, Any]) -> list[AssistantCard]:
    overview = get_erp_store().archive_overview(user["id"])
    missing = get_erp_store().archive_missing_items(user["id"])
    top_missing = sorted(overview, key=lambda item: item.get("missing_total", 0), reverse=True)[:5]
    return [
        AssistantCard(
            type="archive_overview",
            title="档案覆盖情况",
            body="我整理了当前各部门的档案覆盖情况。",
            data={"overview": overview, "missing": missing.get("items", [])[:10]},
            actions=[
                {"id": "open-coverage", "label": "打开覆盖看板"},
                {"id": "open-missing-items", "label": "查看缺失项"},
            ],
        ),
        AssistantCard(
            type="archive_missing_summary",
            title="缺失重点",
            body="、".join(f"{item.get('scope_name', '')} 缺 {item.get('missing_total', 0)} 项" for item in top_missing if item.get("missing_total")) or "当前没有缺失的必传项。",
            data={"rows": top_missing},
        ),
    ]


def _ai_governance_cards(user: dict[str, Any]) -> list[AssistantCard]:
    candidates = get_erp_store().list_ai_sync_candidates(user["id"])
    docs = get_erp_store().list_ai_governance_documents(user["id"])
    return [
        AssistantCard(
            type="ai_governance",
            title="AI 可用性概览",
            body=f"当前有 {candidates.get('total', 0)} 个文档可进入 AI 候选同步清单。",
            data={
                "candidates": candidates.get("documents", [])[:10],
                "documents": docs.get("documents", [])[:10],
            },
            actions=[
                {"id": "open-ai-governance", "label": "打开 AI 治理"},
                {"id": "open-archive-library", "label": "查看档案库"},
            ],
        )
    ]


def _assistant_archive_overview_response(conversation_id: str, user: dict[str, Any]) -> AssistantTurnResponse:
    return AssistantTurnResponse(
        reply="我已经整理了当前档案覆盖情况和缺失重点。",
        intent="archive-governance",
        status="answered",
        conversation_id=conversation_id,
        cards=_archive_governance_cards(user),
        citations=_archive_governance_citations(user),
        suggested_actions=[
            {"id": "open-coverage", "label": "打开覆盖看板"},
            {"id": "open-missing-items", "label": "查看缺失项"},
        ],
    )


def _assistant_ai_governance_overview_response(conversation_id: str, user: dict[str, Any]) -> AssistantTurnResponse:
    return AssistantTurnResponse(
        reply="我已经整理了允许进入 AI 的候选文档和当前治理状态。",
        intent="ai-governance",
        status="answered",
        conversation_id=conversation_id,
        cards=_ai_governance_cards(user),
        citations=_ai_governance_citations(user),
        suggested_actions=[
            {"id": "open-ai-governance", "label": "打开 AI 治理"},
            {"id": "open-archive-library", "label": "查看档案库"},
        ],
    )


def _required_fields_for_intent(intent: str) -> list[AssistantFieldDescriptor]:
    if intent == "contract-review":
        return [
            AssistantFieldDescriptor(key="primary_file_name", label="合同文件 A 名称", placeholder="例如：supplier_contract.md"),
            AssistantFieldDescriptor(key="primary_text", label="合同文件 A 内容", input_type="textarea", placeholder="粘贴合同 A 正文"),
            AssistantFieldDescriptor(key="secondary_file_name", label="合同文件 B / 模板名称", placeholder="例如：company_template.md"),
            AssistantFieldDescriptor(key="secondary_text", label="合同文件 B / 模板内容", input_type="textarea", placeholder="粘贴合同 B 正文"),
            AssistantFieldDescriptor(key="contract_type", label="合同类型", placeholder="例如：采购服务合同", required=False),
            AssistantFieldDescriptor(key="review_focus", label="审查重点", input_type="textarea", placeholder="例如：付款、违约、验收、保密", required=False),
            AssistantFieldDescriptor(key="notes", label="补充说明", input_type="textarea", placeholder="输入业务背景和关注点", required=False),
        ]
    if intent == "meeting-summary":
        return [
            AssistantFieldDescriptor(key="topic", label="会议主题", placeholder="例如：Q2 采购流程优化会"),
            AssistantFieldDescriptor(key="meeting_date", label="会议日期", placeholder="例如：2026-05-15", required=False),
            AssistantFieldDescriptor(key="attendees", label="参会人员", placeholder="例如：张三、李四", required=False),
            AssistantFieldDescriptor(key="notes", label="原始记录", input_type="textarea", placeholder="粘贴会议原文或整理要点"),
        ]
    if intent == "test-report":
        return [
            AssistantFieldDescriptor(key="project", label="项目名称", placeholder="例如：ERP 知识库控制台"),
            AssistantFieldDescriptor(key="version", label="版本号", placeholder="例如：v0.6.0-sandbox", required=False),
            AssistantFieldDescriptor(key="scope", label="测试范围", input_type="textarea", placeholder="输入测试范围"),
            AssistantFieldDescriptor(key="findings", label="缺陷与现象", input_type="textarea", placeholder="输入缺陷情况", required=False),
            AssistantFieldDescriptor(key="conclusion", label="测试结论", input_type="textarea", placeholder="输入测试结论"),
        ]
    return []


def _detect_intent(message: str, context: dict[str, Any]) -> str:
    text = str(message or "")
    lowered = text.lower()
    if context.get("intent") in {"contract-review", "meeting-summary", "test-report"}:
        return str(context["intent"])
    if any(keyword in text for keyword in ["审批", "通过", "退回"]) and context.get("approval_id"):
        return "approval"
    if any(keyword in text for keyword in ["缺失", "档案没齐", "档案还没齐", "档案未齐", "档案是否齐全", "哪些部门档案", "覆盖率", "必传项"]):
        return "archive-governance"
    if any(keyword in text for keyword in ["允许进入 AI", "进入 AI", "AI 可用", "AI 治理", "未同步"]):
        return "ai-governance"
    if any(keyword in text for keyword in ["历史", "会话", "记录", "草稿"]):
        return "history"
    for scene_type, keywords in SCENE_KEYWORDS.items():
        if any(keyword in text or keyword.lower() in lowered for keyword in keywords):
            return scene_type
    return "qa"


def _missing_fields(intent: str, attachments: dict[str, Any]) -> list[AssistantFieldDescriptor]:
    required = _required_fields_for_intent(intent)
    missing: list[AssistantFieldDescriptor] = []
    for field in required:
        value = attachments.get(field.key)
        if field.required and not str(value or "").strip():
            missing.append(field)
    return missing


@router.post("/auth/login", response_model=LoginResponse)
def login(body: LoginRequest) -> LoginResponse:
    result = get_erp_store().login(body.username, body.password)
    if result is None:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return LoginResponse(**result)


@router.get("/auth/me", response_model=LoginResponse)
def auth_me(user: dict[str, Any] = Depends(current_user)) -> LoginResponse:
    token, expires_at = get_erp_store().issue_token(user["id"])
    return LoginResponse(token=token, expires_at=expires_at, user=user)


@router.get("/reference")
def reference_data(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return get_erp_store().reference_data(user["id"])


@router.get("/access-context")
def access_context(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return get_erp_store().access_context(user["id"])


@router.get("/permissions/tree")
def permission_tree(user: dict[str, Any] = Depends(require_admin)) -> list[dict[str, Any]]:
    return get_erp_store().permission_tree(user["id"])


@router.get("/dashboard", response_model=DashboardResponse)
def dashboard(user: dict[str, Any] = Depends(current_user)) -> DashboardResponse:
    return DashboardResponse(**get_erp_store().dashboard(user["id"]))


@router.get("/documents", response_model=DocumentListResponse)
def list_documents(
    q: str = "",
    category: str = "",
    tag: str = "",
    owner_id: str = "",
    department_id: str = "",
    status_filter: str = Query(default="", alias="status"),
    visibility: str = "",
    user: dict[str, Any] = Depends(require_permission("document:read")),
) -> DocumentListResponse:
    data = get_erp_store().list_documents({
        "q": q,
        "category": category,
        "tag": tag,
        "owner_id": owner_id,
        "department_id": department_id,
        "status": status_filter,
        "visibility": visibility,
    }, user_id=user["id"])
    return DocumentListResponse(**data)


@router.post("/documents", status_code=status.HTTP_201_CREATED)
def create_document(
    body: DocumentCreate,
    user: dict[str, Any] = Depends(require_permission("document:write")),
) -> dict[str, Any]:
    payload = body.model_dump()
    if not get_erp_store().is_admin(user["id"]):
        payload["owner_id"] = user["id"]
        payload["department_id"] = user.get("department_id") or payload.get("department_id")
        payload["org_unit_id"] = user.get("department_id") or payload.get("org_unit_id")
    else:
        payload["owner_id"] = payload.get("owner_id") or user["id"]
    # A document assigned to an archive catalog must be writable in that
    # catalog.  This keeps API clients from bypassing directory scope rules.
    catalog_ref = str(payload.get("archive_catalog_id") or "").strip()
    if catalog_ref and not get_erp_store().is_admin(user["id"]):
        state = get_erp_store().state()
        catalog = next((row for row in state.get("archive_catalogs", []) if str(row.get("id")) == catalog_ref), None)
        catalog_item = None
        if catalog is None:
            catalog_item = next((row for row in state.get("archive_catalog_items", []) if str(row.get("id")) == catalog_ref), None)
            catalog = next((row for row in state.get("archive_catalogs", []) if str(row.get("id")) == str((catalog_item or {}).get("catalog_id"))), None)
        scope_matches = not catalog_item or str(catalog_item.get("scope_id") or "") == str(payload.get("org_unit_id") or payload.get("department_id") or "")
        if catalog is None or not scope_matches or not get_erp_store().can_user_access_catalog(state, catalog, user["id"], "write"):
            raise HTTPException(status_code=403, detail="无权将文档归入该档案目录")
    return get_erp_store().create_document(payload)


async def _upload_document_impl(
    *,
    file: UploadFile,
    title: str,
    category: str,
    tags: str,
    owner_id: str,
    department_id: str,
    visibility: str,
    org_unit_id: str,
    org_path: str,
    archive_catalog_id: str,
    archive_tree_node_id: str,
    archive_category: str,
    archive_path: str,
    document_code: str,
    document_type: str,
    filing_year: str,
    filing_period: str,
    retention_period: str,
    is_required: bool,
    required_rule_source: str,
    filing_status: str,
    ai_enabled: bool,
    ai_usage_scope: str,
    knowledge_dataset_key: str,
    confidentiality_level: str,
    redaction_required: bool,
    archive_owner_id: str,
    review_owner_id: str,
    compliance_status: str,
    user: dict[str, Any],
) -> dict[str, Any]:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Uploaded file exceeds 50MB limit")
    tag_list = [item.strip() for item in tags.split(",") if item.strip()]
    effective_owner_id = user["id"] if not get_erp_store().is_admin(user["id"]) else (owner_id or user["id"])
    effective_department_id = (user.get("department_id") or department_id) if not get_erp_store().is_admin(user["id"]) else department_id
    tree_defaults: dict[str, Any] = {}
    ai_summary_template = ""
    if archive_tree_node_id:
        tree_node = get_erp_store().get_archive_tree_node(archive_tree_node_id, user["id"])
        tree_defaults = get_erp_store().archive_tree_upload_defaults(archive_tree_node_id, user["id"]) or {}
        if not tree_node or not tree_defaults:
            raise HTTPException(status_code=403, detail="无权在该档案节点下上传文件")
        org_unit_id = str(tree_defaults.get("org_unit_id") or org_unit_id)
        effective_department_id = str(tree_defaults.get("department_id") or effective_department_id)
        archive_catalog_id = str(tree_defaults.get("archive_catalog_id") or archive_catalog_id)
        archive_category = str(tree_defaults.get("archive_category") or archive_category)
        archive_path = str(tree_defaults.get("archive_path") or archive_path)
        org_path = str(tree_defaults.get("archive_path") or org_path)
        document_type = str(tree_defaults.get("document_type") or document_type)
        filing_period = str(tree_defaults.get("filing_period") or filing_period)
        retention_period = str(tree_defaults.get("retention_period") or retention_period)
        is_required = bool(tree_defaults.get("is_required", is_required))
        ai_enabled = bool(tree_defaults.get("ai_enabled", ai_enabled))
        if not ai_usage_scope or ai_usage_scope == "archive_only":
            ai_usage_scope = "ai_answer" if ai_enabled else "archive_only"
        ai_summary_template = str(tree_defaults.get("ai_summary_template") or "")
        default_tags = tree_defaults.get("tags") or []
        tag_list = list(dict.fromkeys([*default_tags, *tag_list]))
    if not get_erp_store().is_admin(user["id"]):
        target_scope_id = str(org_unit_id or effective_department_id or "").strip()
        if target_scope_id != str(user.get("department_id") or ""):
            raise HTTPException(status_code=403, detail="无权将文档上传到其他组织范围")
        catalog_ref = str(archive_catalog_id or "").strip()
        if catalog_ref:
            state = get_erp_store().state()
            catalog = next((row for row in state.get("archive_catalogs", []) if str(row.get("id")) == catalog_ref), None)
            catalog_item = next((row for row in state.get("archive_catalog_items", []) if str(row.get("id")) == catalog_ref), None)
            if catalog is None and catalog_item:
                catalog = next((row for row in state.get("archive_catalogs", []) if str(row.get("id")) == str(catalog_item.get("catalog_id"))), None)
            if catalog is None or (catalog_item and str(catalog_item.get("scope_id") or "") != target_scope_id) or not get_erp_store().can_user_access_catalog(state, catalog, user["id"], "write"):
                raise HTTPException(status_code=403, detail="无权将文档归入该档案目录")
    return get_erp_store().create_uploaded_document(
        title=title or file.filename or "未命名文档",
        category=category,
        tags=tag_list,
        owner_id=effective_owner_id,
        department_id=effective_department_id,
        visibility=visibility,
        file_name=file.filename or "upload.bin",
        mime_type=file.content_type or "application/octet-stream",
        raw=raw,
        archive_payload={
            "org_unit_id": org_unit_id or effective_department_id,
            "org_path": org_path,
            "archive_catalog_id": archive_catalog_id,
            "archive_tree_node_id": archive_tree_node_id,
            "archive_category": archive_category,
            "archive_path": archive_path,
            "document_code": document_code,
            "document_type": document_type,
            "filing_year": filing_year,
            "filing_period": filing_period,
            "retention_period": retention_period,
            "is_required": is_required,
            "required_rule_source": required_rule_source,
            "filing_status": filing_status,
            "ai_enabled": ai_enabled,
            "ai_usage_scope": ai_usage_scope,
            "ai_summary_template": ai_summary_template,
            "knowledge_dataset_key": knowledge_dataset_key,
            "confidentiality_level": confidentiality_level,
            "redaction_required": redaction_required,
            "archive_owner_id": archive_owner_id or effective_owner_id,
            "review_owner_id": review_owner_id,
            "compliance_status": compliance_status,
        },
    )


@router.post("/documents/upload", status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    title: str = Form(""),
    category: str = Form("General"),
    tags: str = Form(""),
    owner_id: str = Form("u-admin"),
    department_id: str = Form("dept-ops"),
    visibility: str = Form("department"),
    org_unit_id: str = Form("dept-ops"),
    org_path: str = Form(""),
    archive_catalog_id: str = Form(""),
    archive_tree_node_id: str = Form(""),
    archive_category: str = Form("制度"),
    archive_path: str = Form(""),
    document_code: str = Form(""),
    document_type: str = Form("通用文档"),
    filing_year: str = Form(""),
    filing_period: str = Form("年度"),
    retention_period: str = Form("长期"),
    is_required: bool = Form(False),
    required_rule_source: str = Form(""),
    filing_status: str = Form("unfiled"),
    ai_enabled: bool = Form(False),
    ai_usage_scope: str = Form("archive_only"),
    knowledge_dataset_key: str = Form(""),
    confidentiality_level: str = Form("internal"),
    redaction_required: bool = Form(False),
    archive_owner_id: str = Form(""),
    review_owner_id: str = Form(""),
    compliance_status: str = Form("compliant"),
    user: dict[str, Any] = Depends(require_permission("document:write")),
) -> dict[str, Any]:
    return await _upload_document_impl(
        file=file,
        title=title,
        category=category,
        tags=tags,
        owner_id=owner_id,
        department_id=department_id,
        visibility=visibility,
        org_unit_id=org_unit_id,
        org_path=org_path,
        archive_catalog_id=archive_catalog_id,
        archive_tree_node_id=archive_tree_node_id,
        archive_category=archive_category,
        archive_path=archive_path,
        document_code=document_code,
        document_type=document_type,
        filing_year=filing_year,
        filing_period=filing_period,
        retention_period=retention_period,
        is_required=is_required,
        required_rule_source=required_rule_source,
        filing_status=filing_status,
        ai_enabled=ai_enabled,
        ai_usage_scope=ai_usage_scope,
        knowledge_dataset_key=knowledge_dataset_key,
        confidentiality_level=confidentiality_level,
        redaction_required=redaction_required,
        archive_owner_id=archive_owner_id,
        review_owner_id=review_owner_id,
        compliance_status=compliance_status,
        user=user,
    )


@router.get("/documents/{document_id}")
def get_document(
    document_id: str,
    user: dict[str, Any] = Depends(require_permission("document:read")),
) -> dict[str, Any]:
    doc = get_erp_store().get_document(document_id, user_id=user["id"])
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.patch("/documents/{document_id}")
def update_document(
    document_id: str,
    body: DocumentUpdate,
    user: dict[str, Any] = Depends(require_permission("document:write")),
) -> dict[str, Any]:
    store = get_erp_store()
    if not store.can_access_document(document_id, user["id"], action="write"):
        raise HTTPException(status_code=403, detail="You do not have write access to this document")
    payload = body.model_dump(exclude_unset=True)
    if not store.is_admin(user["id"]):
        state = store.state()
        current = next((row for row in state.get("documents", []) if row.get("id") == document_id), {})
        target_scope = str(payload.get("org_unit_id") or payload.get("department_id") or current.get("org_unit_id") or current.get("department_id") or "")
        catalog_ref = str(payload.get("archive_catalog_id") or current.get("archive_catalog_id") or "").strip()
        catalog = next((row for row in state.get("archive_catalogs", []) if str(row.get("id")) == catalog_ref), None)
        catalog_item = next((row for row in state.get("archive_catalog_items", []) if str(row.get("id")) == catalog_ref), None)
        if catalog is None and catalog_item:
            catalog = next((row for row in state.get("archive_catalogs", []) if str(row.get("id")) == str(catalog_item.get("catalog_id"))), None)
        allowed = target_scope == str(user.get("department_id") or "")
        if catalog is not None:
            allowed = (not catalog_item or str(catalog_item.get("scope_id") or "") == target_scope) and store.can_user_access_catalog(state, catalog, user["id"], "write")
        if not allowed:
            raise HTTPException(status_code=403, detail="无权将文档调整到该组织或档案目录")
        payload["department_id"] = str(user.get("department_id") or payload.get("department_id") or current.get("department_id") or "")
        payload["org_unit_id"] = target_scope
    doc = store.update_document(document_id, payload, actor=user["id"])
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_document(
    document_id: str,
    user: dict[str, Any] = Depends(require_permission("document:write")),
) -> Response:
    if not get_erp_store().can_access_document(document_id, user["id"], action="write"):
        raise HTTPException(status_code=403, detail="You do not have write access to this document")
    count = get_erp_store().soft_delete([document_id])
    if count == 0:
        raise HTTPException(status_code=404, detail="Document not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/documents/batch/delete")
def batch_delete(
    body: BatchActionRequest,
    user: dict[str, Any] = Depends(require_permission("document:write")),
) -> dict[str, int]:
    for document_id in body.ids:
        if not get_erp_store().can_access_document(document_id, user["id"], action="write"):
            raise HTTPException(status_code=403, detail=f"No write access for document {document_id}")
    return {"affected": get_erp_store().soft_delete(body.ids)}


@router.post("/documents/batch/archive")
def batch_archive(
    body: BatchActionRequest,
    user: dict[str, Any] = Depends(require_permission("document:write")),
) -> dict[str, int]:
    for document_id in body.ids:
        if not get_erp_store().can_access_document(document_id, user["id"], action="write"):
            raise HTTPException(status_code=403, detail=f"No write access for document {document_id}")
    return {"affected": get_erp_store().archive(body.ids)}


@router.post("/documents/batch/reindex")
def batch_reindex(
    body: BatchActionRequest,
    user: dict[str, Any] = Depends(require_permission("document:index")),
) -> dict[str, Any]:
    for document_id in body.ids:
        if not get_erp_store().can_access_document(document_id, user["id"], action="index"):
            raise HTTPException(status_code=403, detail=f"No index access for document {document_id}")
    jobs = get_erp_store().reindex(body.ids)
    return {"jobs": jobs, "affected": len(jobs)}


@router.post("/documents/{document_id}/reparse")
def reparse_document(
    document_id: str,
    user: dict[str, Any] = Depends(require_permission("document:index")),
) -> dict[str, Any]:
    store = get_erp_store()
    if not store.can_access_document(document_id, user["id"], action="index"):
        raise HTTPException(status_code=403, detail="You do not have index access to this document")
    item = store.reparse_document(document_id, actor=user["id"])
    if item is None:
        raise HTTPException(status_code=400, detail="原始文件不存在，无法重新解析")
    return item


@router.get("/org/tree", response_model=list[OrgTreeNode])
def org_tree(user: dict[str, Any] = Depends(require_permission("archive:read"))) -> list[dict[str, Any]]:
    return get_erp_store().org_tree(user["id"])


@router.get("/archive/scopes", response_model=list[OrgTreeNode])
def archive_scopes(user: dict[str, Any] = Depends(require_permission("archive:read"))) -> list[dict[str, Any]]:
    return get_erp_store().org_tree(user["id"])


@router.get("/archive/tree/children")
def archive_tree_children(
    parent_id: str = "",
    user: dict[str, Any] = Depends(require_permission("archive:read")),
) -> list[dict[str, Any]]:
    return get_erp_store().list_archive_tree_nodes(user["id"], parent_id=parent_id)


@router.get("/archive/tree/nodes")
def archive_tree_nodes(user: dict[str, Any] = Depends(require_permission("archive:read"))) -> list[dict[str, Any]]:
    return get_erp_store().list_archive_tree_nodes(user["id"])


@router.get("/archive/tree/nodes/{node_id}")
def archive_tree_node(
    node_id: str,
    user: dict[str, Any] = Depends(require_permission("archive:read")),
) -> dict[str, Any]:
    item = get_erp_store().get_archive_tree_node(node_id, user["id"])
    if item is None:
        raise HTTPException(status_code=404, detail="Archive tree node not found")
    return item


@router.get("/archive/tree/nodes/{node_id}/upload-defaults")
def archive_tree_node_upload_defaults(
    node_id: str,
    user: dict[str, Any] = Depends(require_permission("archive:read")),
) -> dict[str, Any]:
    defaults = get_erp_store().archive_tree_upload_defaults(node_id, user["id"])
    if defaults is None:
        raise HTTPException(status_code=403, detail="无权在该档案节点下上传文件")
    return defaults


@router.post("/archive/tree/nodes", status_code=status.HTTP_201_CREATED)
def create_archive_tree_node(
    body: ArchiveTreeNodeCreateRequest,
    user: dict[str, Any] = Depends(require_permission("archive:catalog:write")),
) -> dict[str, Any]:
    try:
        item = get_erp_store().create_archive_tree_node(body.model_dump(), actor=user["id"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if item is None:
        raise HTTPException(status_code=403, detail="无权在该节点下新增目录")
    return item


@router.patch("/archive/tree/nodes/{node_id}")
def update_archive_tree_node(
    node_id: str,
    body: ArchiveTreeNodeUpdateRequest,
    user: dict[str, Any] = Depends(require_permission("archive:catalog:write")),
) -> dict[str, Any]:
    try:
        item = get_erp_store().update_archive_tree_node(node_id, body.model_dump(exclude_unset=True), actor=user["id"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if item is None:
        raise HTTPException(status_code=403, detail="无权修改该目录节点")
    return item


@router.post("/archive/tree/batch-update")
def batch_update_archive_tree_nodes(
    body: ArchiveTreeBatchUpdateRequest,
    user: dict[str, Any] = Depends(require_permission("archive:catalog:write")),
) -> dict[str, Any]:
    try:
        items = get_erp_store().batch_update_archive_tree_nodes(
            body.ids, body.model_dump(exclude={"ids"}, exclude_unset=True), actor=user["id"]
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"nodes": items, "affected": len(items)}


@router.post("/archive/tree/nodes/{node_id}/move")
def move_archive_tree_node(
    node_id: str,
    body: ArchiveTreeMoveRequest,
    user: dict[str, Any] = Depends(require_permission("archive:catalog:write")),
) -> dict[str, Any]:
    try:
        item = get_erp_store().move_archive_tree_node(node_id, body.target_parent_id, body.sort_order, actor=user["id"])
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if item is None:
        raise HTTPException(status_code=403, detail="无权移动该目录节点")
    return item


@router.post("/archive/tree/nodes/{node_id}/merge")
def merge_archive_tree_node(
    node_id: str,
    body: ArchiveTreeMergeRequest,
    user: dict[str, Any] = Depends(require_permission("archive:catalog:write")),
) -> dict[str, Any]:
    try:
        item = get_erp_store().merge_archive_tree_node(node_id, body.target_node_id, actor=user["id"])
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if item is None:
        raise HTTPException(status_code=403, detail="无权合并该目录节点")
    return item


@router.get("/archive/tree/nodes/{node_id}/documents", response_model=DocumentListResponse)
def archive_tree_node_documents(
    node_id: str,
    user: dict[str, Any] = Depends(require_permission("archive:read")),
) -> DocumentListResponse:
    node = get_erp_store().get_archive_tree_node(node_id, user["id"])
    if node is None:
        raise HTTPException(status_code=404, detail="Archive tree node not found")
    documents = get_erp_store().list_documents_for_archive_tree_node(node_id, user["id"])
    return DocumentListResponse(documents=documents, total=len(documents), filters=get_erp_store().document_filters(get_erp_store().state()))


@router.get("/archive/tree/nodes/{node_id}/template")
def archive_tree_node_template(
    node_id: str,
    user: dict[str, Any] = Depends(require_permission("archive:read")),
) -> dict[str, Any]:
    item = get_erp_store().archive_tree_template(node_id, user["id"])
    if item is None:
        raise HTTPException(status_code=404, detail="Archive template not found")
    return item


@router.get("/archive/tree/nodes/{node_id}/template/download")
def download_archive_tree_node_template(
    node_id: str,
    user: dict[str, Any] = Depends(require_permission("archive:read")),
) -> Response:
    item = get_erp_store().archive_tree_template(node_id, user["id"])
    if item is None:
        raise HTTPException(status_code=404, detail="Archive template not found")
    filename = f"{item.get('name') or 'archive-template'}.md"
    return Response(
        content=str(item.get("content") or ""),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.get("/archive/tree/nodes/{node_id}/audit-logs")
def archive_tree_node_audit_logs(
    node_id: str,
    user: dict[str, Any] = Depends(require_permission("archive:read")),
) -> list[dict[str, Any]]:
    return get_erp_store().archive_tree_audit_logs(node_id, user["id"])


@router.get("/archive/catalogs", response_model=list[ArchiveCatalogResponse])
def archive_catalogs(
    scope_id: str = "",
    user: dict[str, Any] = Depends(require_permission("archive:read")),
) -> list[ArchiveCatalogResponse]:
    return [ArchiveCatalogResponse(**item) for item in get_erp_store().list_archive_catalogs(scope_id=scope_id, user_id=user["id"])]


@router.post("/archive/catalogs", status_code=status.HTTP_201_CREATED, response_model=ArchiveCatalogResponse)
def create_archive_catalog(
    body: ArchiveCatalogCreateRequest,
    user: dict[str, Any] = Depends(require_permission("archive:catalog:write")),
) -> ArchiveCatalogResponse:
    if not get_erp_store().is_admin(user["id"]) and str(body.scope_id) != str(user.get("department_id") or ""):
        raise HTTPException(status_code=403, detail="只能在有权管理的组织范围创建档案目录")
    return ArchiveCatalogResponse(**get_erp_store().create_archive_catalog(body.model_dump(), actor=user["id"]))


@router.patch("/archive/catalogs/{catalog_id}", response_model=ArchiveCatalogResponse)
def update_archive_catalog(
    catalog_id: str,
    body: ArchiveCatalogUpdateRequest,
    user: dict[str, Any] = Depends(require_permission("archive:catalog:write")),
) -> ArchiveCatalogResponse:
    state = get_erp_store().state()
    catalog = next((row for row in state.get("archive_catalogs", []) if row.get("id") == catalog_id), None)
    if not catalog or not get_erp_store().can_user_access_catalog(state, catalog, user["id"], "write"):
        raise HTTPException(status_code=403, detail="无权修改该档案目录")
    if not get_erp_store().is_admin(user["id"]) and body.scope_id is not None and str(body.scope_id) != str(catalog.get("scope_id") or ""):
        raise HTTPException(status_code=403, detail="无权将档案目录调整到其他组织范围")
    item = get_erp_store().update_archive_catalog(catalog_id, body.model_dump(exclude_unset=True), actor=user["id"])
    if item is None:
        raise HTTPException(status_code=404, detail="Archive catalog not found")
    return ArchiveCatalogResponse(**item)


@router.delete("/archive/catalogs/{catalog_id}", response_model=ArchiveCatalogResponse)
def delete_archive_catalog(
    catalog_id: str,
    user: dict[str, Any] = Depends(require_permission("archive:catalog:write")),
) -> ArchiveCatalogResponse:
    state = get_erp_store().state()
    catalog = next((row for row in state.get("archive_catalogs", []) if row.get("id") == catalog_id), None)
    if not catalog or not get_erp_store().can_user_access_catalog(state, catalog, user["id"], "write"):
        raise HTTPException(status_code=403, detail="无权停用该档案目录")
    item = get_erp_store().disable_archive_catalog(catalog_id, actor=user["id"])
    if item is None:
        raise HTTPException(status_code=404, detail="Archive catalog not found")
    return ArchiveCatalogResponse(**item)


@router.get("/archive/catalogs/by-scope/{scope_id}", response_model=list[ArchiveCatalogResponse])
def archive_catalogs_by_scope(
    scope_id: str,
    user: dict[str, Any] = Depends(require_permission("archive:read")),
) -> list[ArchiveCatalogResponse]:
    return [ArchiveCatalogResponse(**item) for item in get_erp_store().archive_catalogs_by_scope(scope_id, user_id=user["id"])]


@router.put("/archive/catalogs/{catalog_id}/permissions")
def update_archive_catalog_permissions(
    catalog_id: str,
    body: CatalogPermissionUpdate,
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    try:
        result = get_erp_store().update_catalog_permissions(catalog_id, body.model_dump(), actor=user["id"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Archive catalog not found")
    return result


@router.get("/archive/catalog-items")
def archive_catalog_items(
    scope_id: str = "",
    category: str = "",
    required: str = "",
    status_filter: str = Query(default="", alias="status"),
    user: dict[str, Any] = Depends(require_permission("archive:read")),
) -> list[dict[str, Any]]:
    return get_erp_store().list_archive_catalog_items({
        "scope_id": scope_id,
        "category": category,
        "required": required,
        "status": status_filter,
    }, user_id=user["id"])


@router.post("/archive/catalog-items", status_code=status.HTTP_201_CREATED)
def create_archive_catalog_item(
    body: ArchiveCatalogItemCreateRequest,
    user: dict[str, Any] = Depends(require_permission("archive:catalog:write")),
) -> dict[str, Any]:
    state = get_erp_store().state()
    catalog_id = str(body.catalog_id or "").strip()
    catalog = next((row for row in state.get("archive_catalogs", []) if str(row.get("id")) == catalog_id), None) if catalog_id else None
    if catalog is None:
        catalog = next((row for row in state.get("archive_catalogs", []) if str(row.get("scope_id")) == str(body.scope_id) and row.get("status") == "active"), None)
    if not get_erp_store().is_admin(user["id"]):
        if catalog is None or str(catalog.get("scope_id") or "") != str(body.scope_id) or not get_erp_store().can_user_access_catalog(state, catalog, user["id"], "write"):
            raise HTTPException(status_code=403, detail="无权在该档案目录创建目录项")
    return get_erp_store().create_archive_catalog_item(body.model_dump(), actor=user["id"])


@router.patch("/archive/catalog-items/{item_id}")
def update_archive_catalog_item(
    item_id: str,
    body: ArchiveCatalogItemUpdateRequest,
    user: dict[str, Any] = Depends(require_permission("archive:catalog:write")),
) -> dict[str, Any]:
    state = get_erp_store().state()
    catalog_item = next((row for row in state.get("archive_catalog_items", []) if row.get("id") == item_id), None)
    catalog = next((row for row in state.get("archive_catalogs", []) if row.get("id") == (catalog_item or {}).get("catalog_id")), None)
    if not catalog or not get_erp_store().can_user_access_catalog(state, catalog, user["id"], "write"):
        raise HTTPException(status_code=403, detail="无权修改该目录项")
    if not get_erp_store().is_admin(user["id"]) and body.scope_id is not None and str(body.scope_id) != str(catalog_item.get("scope_id") or ""):
        raise HTTPException(status_code=403, detail="无权将目录项调整到其他组织范围")
    item = get_erp_store().update_archive_catalog_item(item_id, body.model_dump(exclude_unset=True), actor=user["id"])
    if item is None:
        raise HTTPException(status_code=404, detail="Archive catalog item not found")
    return item


@router.get("/archive/documents", response_model=DocumentListResponse)
def archive_documents(
    q: str = "",
    department_id: str = "",
    org_unit_id: str = "",
    archive_category: str = "",
    document_type: str = "",
    filing_year: str = "",
    filing_status: str = "",
    ai_enabled: str = "",
    knowledge_sync_status: str = "",
    confidentiality_level: str = "",
    user: dict[str, Any] = Depends(require_permission("archive:read")),
) -> DocumentListResponse:
    data = get_erp_store().list_archive_documents({
        "q": q,
        "department_id": department_id,
        "org_unit_id": org_unit_id,
        "archive_category": archive_category,
        "document_type": document_type,
        "filing_year": filing_year,
        "filing_status": filing_status,
        "ai_enabled": ai_enabled,
        "knowledge_sync_status": knowledge_sync_status,
        "confidentiality_level": confidentiality_level,
    }, user_id=user["id"])
    return DocumentListResponse(**data)


@router.get("/archive/documents/{document_id}")
def get_archive_document(
    document_id: str,
    user: dict[str, Any] = Depends(require_permission("archive:read")),
) -> dict[str, Any]:
    doc = get_erp_store().get_archive_document(document_id, user_id=user["id"])
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.post("/archive/documents/upload", status_code=status.HTTP_201_CREATED)
async def upload_archive_document(
    file: UploadFile = File(...),
    title: str = Form(""),
    category: str = Form("General"),
    tags: str = Form(""),
    owner_id: str = Form("u-admin"),
    department_id: str = Form("dept-ops"),
    visibility: str = Form("department"),
    org_unit_id: str = Form("dept-ops"),
    org_path: str = Form(""),
    archive_catalog_id: str = Form(""),
    archive_tree_node_id: str = Form(""),
    archive_category: str = Form("制度"),
    archive_path: str = Form(""),
    document_code: str = Form(""),
    document_type: str = Form("通用文档"),
    filing_year: str = Form(""),
    filing_period: str = Form("年度"),
    retention_period: str = Form("长期"),
    is_required: bool = Form(False),
    required_rule_source: str = Form(""),
    filing_status: str = Form("unfiled"),
    ai_enabled: bool = Form(False),
    ai_usage_scope: str = Form("archive_only"),
    knowledge_dataset_key: str = Form(""),
    confidentiality_level: str = Form("internal"),
    redaction_required: bool = Form(False),
    archive_owner_id: str = Form(""),
    review_owner_id: str = Form(""),
    compliance_status: str = Form("compliant"),
    user: dict[str, Any] = Depends(require_permission("document:write")),
) -> dict[str, Any]:
    return await _upload_document_impl(
        file=file,
        title=title,
        category=category,
        tags=tags,
        owner_id=owner_id,
        department_id=department_id,
        visibility=visibility,
        org_unit_id=org_unit_id,
        org_path=org_path,
        archive_catalog_id=archive_catalog_id,
        archive_tree_node_id=archive_tree_node_id,
        archive_category=archive_category,
        archive_path=archive_path,
        document_code=document_code,
        document_type=document_type,
        filing_year=filing_year,
        filing_period=filing_period,
        retention_period=retention_period,
        is_required=is_required,
        required_rule_source=required_rule_source,
        filing_status=filing_status,
        ai_enabled=ai_enabled,
        ai_usage_scope=ai_usage_scope,
        knowledge_dataset_key=knowledge_dataset_key,
        confidentiality_level=confidentiality_level,
        redaction_required=redaction_required,
        archive_owner_id=archive_owner_id,
        review_owner_id=review_owner_id,
        compliance_status=compliance_status,
        user=user,
    )


@router.post("/archive/documents/{document_id}/match-catalog")
def match_archive_document_catalog(
    document_id: str,
    body: ArchiveDocumentCatalogMatchRequest,
    user: dict[str, Any] = Depends(require_permission("archive:write")),
) -> dict[str, Any]:
    if not get_erp_store().can_access_document(document_id, user["id"], action="write"):
        raise HTTPException(status_code=403, detail="You do not have write access to this document")
    state = get_erp_store().state()
    catalog_item = next((row for row in state.get("archive_catalog_items", []) if str(row.get("id")) == str(body.item_id)), None)
    catalog = next((row for row in state.get("archive_catalogs", []) if str(row.get("id")) == str((catalog_item or {}).get("catalog_id"))), None)
    if catalog_item is None or catalog is None or not get_erp_store().can_user_access_catalog(state, catalog, user["id"], "write"):
        raise HTTPException(status_code=403, detail="无权将文档匹配到该档案目录")
    doc = get_erp_store().match_archive_document_to_catalog(document_id, body.item_id, actor=user["id"])
    if doc is None:
        raise HTTPException(status_code=404, detail="Document or catalog item not found")
    return doc


@router.post("/archive/documents/{document_id}/transfer-scope")
def transfer_archive_document_scope(
    document_id: str,
    body: ArchiveDocumentScopeTransferRequest,
    user: dict[str, Any] = Depends(require_permission("archive:write")),
) -> dict[str, Any]:
    store = get_erp_store()
    if not store.can_access_document(document_id, user["id"], action="write"):
        raise HTTPException(status_code=403, detail="无权调整该文档归属范围")
    if not store.is_admin(user["id"]):
        state = store.state()
        target_catalog = None
        if body.target_catalog_item_id:
            target_item = next((row for row in state.get("archive_catalog_items", []) if str(row.get("id")) == str(body.target_catalog_item_id)), None)
            target_catalog = next((row for row in state.get("archive_catalogs", []) if str(row.get("id")) == str((target_item or {}).get("catalog_id"))), None)
        if target_catalog is None or not store.can_user_access_catalog(state, target_catalog, user["id"], "write"):
            raise HTTPException(status_code=403, detail="无权调整到目标组织范围")
    doc = store.transfer_archive_document_scope(
        document_id,
        body.target_scope_id,
        body.target_catalog_item_id,
        visibility=body.visibility,
        role_ids=body.role_ids,
        user_ids=body.user_ids,
        actor=user["id"],
    )
    if doc is None:
        raise HTTPException(status_code=404, detail="Document, target scope, or catalog item not found")
    return doc


@router.patch("/archive/documents/{document_id}/ai-policy")
def update_archive_document_ai_policy(
    document_id: str,
    body: AiGovernancePolicyUpdateRequest,
    user: dict[str, Any] = Depends(require_permission("ai-governance:write")),
) -> dict[str, Any]:
    if not get_erp_store().can_access_document(document_id, user["id"], action="write"):
        raise HTTPException(status_code=403, detail="You do not have write access to this document")
    item = get_erp_store().update_ai_policy(document_id, body.model_dump(exclude_unset=True), actor=user["id"])
    if item is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return item


@router.get("/archive/catalog-items/{item_id}/documents", response_model=DocumentListResponse)
def archive_catalog_item_documents(
    item_id: str,
    user: dict[str, Any] = Depends(require_permission("archive:read")),
) -> DocumentListResponse:
    state = get_erp_store().state()
    catalog_item = next((row for row in state.get("archive_catalog_items", []) if str(row.get("id")) == str(item_id)), None)
    catalog = next((row for row in state.get("archive_catalogs", []) if str(row.get("id")) == str((catalog_item or {}).get("catalog_id"))), None)
    if catalog_item is None or catalog is None or not get_erp_store().can_user_access_catalog(state, catalog, user["id"], "read"):
        raise HTTPException(status_code=404, detail="Archive catalog item not found")
    documents = get_erp_store().list_documents_for_catalog_item(item_id, user_id=user["id"])
    return DocumentListResponse(documents=documents, total=len(documents), filters=get_erp_store().document_filters(get_erp_store().state()))


@router.get("/archive/coverage", response_model=list[ArchiveCoverageDetailResponse])
def archive_coverage(user: dict[str, Any] = Depends(require_permission("archive:coverage:read"))) -> list[dict[str, Any]]:
    return get_erp_store().archive_overview(user["id"])


@router.get("/archive/coverage/{scope_id}", response_model=ArchiveCoverageDetailResponse)
def archive_coverage_detail(
    scope_id: str,
    user: dict[str, Any] = Depends(require_permission("archive:coverage:read")),
) -> dict[str, Any]:
    detail = get_erp_store().archive_scope_detail(scope_id, user["id"])
    if detail is None:
        if str(scope_id) not in get_erp_store().catalog_accessible_scope_ids(user["id"], "coverage"):
            raise HTTPException(status_code=403, detail="当前账号无权查看该目录范围的档案覆盖数据")
        raise HTTPException(status_code=404, detail="Archive scope not found")
    return detail


@router.get("/archive/missing-items", response_model=ArchiveMissingItemResponse)
def archive_missing_items(
    filing_year: str = "",
    filing_period: str = "",
    user: dict[str, Any] = Depends(require_archive_missing_access),
) -> ArchiveMissingItemResponse:
    return ArchiveMissingItemResponse(**get_erp_store().archive_missing_items(user["id"], filing_year=filing_year, filing_period=filing_period))


@router.get("/archive/missing-required", response_model=ArchiveMissingItemResponse)
def archive_missing_required(
    filing_year: str = "",
    filing_period: str = "",
    user: dict[str, Any] = Depends(require_archive_missing_access),
) -> ArchiveMissingItemResponse:
    return ArchiveMissingItemResponse(**get_erp_store().archive_missing_items(user["id"], filing_year=filing_year, filing_period=filing_period))


@router.post("/archive/recalculate-coverage", response_model=list[ArchiveCoverageDetailResponse])
def archive_recalculate_coverage(
    user: dict[str, Any] = Depends(require_permission("archive:coverage:read")),
) -> list[dict[str, Any]]:
    return get_erp_store().archive_overview(user["id"])


@router.get("/archive/missing-items/export")
def archive_missing_items_export(
    filing_year: str = "",
    filing_period: str = "",
    user: dict[str, Any] = Depends(require_archive_missing_access),
) -> Response:
    content = get_erp_store().export_archive_missing_items(user["id"], filing_year=filing_year, filing_period=filing_period)
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="archive-missing-items.csv"'},
    )


@router.get("/knowledge/datasets/mapping", response_model=KnowledgeDatasetMappingResponse)
def knowledge_dataset_mappings(user: dict[str, Any] = Depends(require_admin)) -> KnowledgeDatasetMappingResponse:
    return KnowledgeDatasetMappingResponse(mappings=get_erp_store().get_dataset_mappings())


@router.patch("/knowledge/datasets/mapping", response_model=KnowledgeDatasetMappingResponse)
def update_knowledge_dataset_mappings(
    body: KnowledgeDatasetMappingUpdateRequest,
    user: dict[str, Any] = Depends(require_admin),
) -> KnowledgeDatasetMappingResponse:
    return KnowledgeDatasetMappingResponse(mappings=get_erp_store().update_dataset_mappings([item.model_dump() for item in body.mappings], actor=user["id"]))


@router.get("/knowledge/migration-inventory/export")
def export_knowledge_migration_inventory(user: dict[str, Any] = Depends(require_admin)) -> Response:
    content = get_erp_store().export_knowledge_migration_inventory()
    return Response(
        content="\ufeff" + content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="knowledge-dataset-migration-inventory.csv"'},
    )


@router.get("/ai-governance/documents", response_model=DocumentListResponse)
def ai_governance_documents(user: dict[str, Any] = Depends(require_permission("ai-governance:read"))) -> DocumentListResponse:
    return DocumentListResponse(**get_erp_store().list_ai_governance_documents(user["id"]))


@router.patch("/ai-governance/documents/{document_id}")
def update_ai_governance_document(
    document_id: str,
    body: AiGovernancePolicyUpdateRequest,
    user: dict[str, Any] = Depends(require_permission("ai-governance:write")),
) -> dict[str, Any]:
    if not get_erp_store().can_access_document(document_id, user["id"], action="write"):
        raise HTTPException(status_code=403, detail="You do not have write access to this document")
    item = get_erp_store().update_ai_policy(document_id, body.model_dump(exclude_unset=True), actor=user["id"])
    if item is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return item


@router.post("/ai-governance/documents/batch-policy")
def batch_update_ai_governance_documents(
    body: BatchActionRequest,
    ai_enabled: bool | None = None,
    user: dict[str, Any] = Depends(require_permission("ai-governance:write")),
) -> dict[str, Any]:
    for document_id in body.ids:
        if not get_erp_store().can_access_document(document_id, user["id"], action="write"):
            raise HTTPException(status_code=403, detail=f"No write access for document {document_id}")
    payload = {"ai_enabled": ai_enabled} if ai_enabled is not None else {}
    return get_erp_store().batch_update_ai_policy(body.ids, payload, actor=user["id"])


@router.post("/ai-governance/documents/{document_id}/review")
def review_ai_governance_document(
    document_id: str,
    body: AiGovernanceReviewRequest,
    user: dict[str, Any] = Depends(require_permission("ai-governance:approve")),
) -> dict[str, Any]:
    if not get_erp_store().can_access_document(document_id, user["id"], action="write"):
        raise HTTPException(status_code=403, detail="You do not have write access to this document")
    item = get_erp_store().review_ai_document(document_id, body.model_dump(exclude_unset=True), actor=user["id"])
    if item is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return item


@router.get("/ai-governance/review-records", response_model=list[AiGovernanceReviewRecordResponse])
def ai_governance_review_records(
    status: str = "",
    user: dict[str, Any] = Depends(require_permission("ai-governance:read")),
) -> list[AiGovernanceReviewRecordResponse]:
    return [AiGovernanceReviewRecordResponse(**item) for item in get_erp_store().list_ai_review_records(user["id"], status=status)]


@router.get("/ai-governance/sync-candidates", response_model=DocumentListResponse)
def ai_governance_sync_candidates(user: dict[str, Any] = Depends(require_permission("ai-governance:read"))) -> DocumentListResponse:
    return DocumentListResponse(**get_erp_store().list_ai_sync_candidates(user["id"]))


@router.get("/knowledge/sync-candidates", response_model=DocumentListResponse)
def knowledge_sync_candidates(user: dict[str, Any] = Depends(require_permission("ai-governance:read"))) -> DocumentListResponse:
    return DocumentListResponse(**get_erp_store().list_ai_sync_candidates(user["id"]))


@router.post("/ai-governance/sync-candidates/batch-sync")
def ai_governance_batch_sync(
    body: BatchActionRequest,
    user: dict[str, Any] = Depends(require_permissions("document:index", "ai-governance:write")),
) -> dict[str, Any]:
    for document_id in body.ids:
        if not get_erp_store().can_access_document(document_id, user["id"], action="index"):
            raise HTTPException(status_code=403, detail=f"No index access for document {document_id}")
    return DifySyncService(get_erp_store()).sync_documents(body.ids)


@router.post("/knowledge/batch/sync")
def knowledge_batch_sync(
    body: BatchActionRequest,
    user: dict[str, Any] = Depends(require_permissions("document:index", "ai-governance:write")),
) -> dict[str, Any]:
    for document_id in body.ids:
        if not get_erp_store().can_access_document(document_id, user["id"], action="index"):
            raise HTTPException(status_code=403, detail=f"No index access for document {document_id}")
    return DifySyncService(get_erp_store()).sync_documents(body.ids)


@router.get("/dify/config")
def dify_config_status(user: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    return DifySyncService(get_erp_store()).config_status()


@router.get("/dify/documents")
def dify_documents(user: dict[str, Any] = Depends(require_permission("ai-governance:read"))) -> dict[str, Any]:
    try:
        return DifySyncService(get_erp_store()).list_remote_documents(user["id"])
    except DifyConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except DifyAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        # Keep deployment/configuration failures visible to the operator instead
        # of leaving the frontend with an opaque "Internal Server Error".
        raise HTTPException(status_code=502, detail=f"读取 Dify 文档失败：{exc}") from exc


@router.post("/dify/documents/{dify_document_id}/link", status_code=status.HTTP_201_CREATED)
def link_dify_document(
    dify_document_id: str,
    body: DifyDocumentLinkRequest,
    user: dict[str, Any] = Depends(require_permission("document:write")),
) -> dict[str, Any]:
    store = get_erp_store()
    if not store.org_scope_exists(body.scope_id):
        raise HTTPException(status_code=400, detail="组织范围不存在")
    if not store.is_admin(user["id"]):
        state = store.state()
        catalog = None
        if body.catalog_item_id:
            catalog_item = next((row for row in state.get("archive_catalog_items", []) if str(row.get("id")) == str(body.catalog_item_id)), None)
            catalog = next((row for row in state.get("archive_catalogs", []) if str(row.get("id")) == str((catalog_item or {}).get("catalog_id"))), None)
        allowed = str(body.scope_id) == str(user.get("department_id") or "")
        if catalog is not None:
            allowed = str(catalog.get("scope_id") or "") == str(body.scope_id) and store.can_user_access_catalog(state, catalog, user["id"], "write")
        if not allowed:
            raise HTTPException(status_code=403, detail="无权将 Dify 文档归属到该组织范围")
    # A client may only bind a remote document to a Dataset that is configured
    # in the ERP route table and visible to the current user. This prevents a
    # crafted dataset_id from bypassing the stable knowledge-domain policy.
    if body.dataset_id:
        allowed_dataset_ids = {
            str(route.get("dataset_id") or "")
            for route in DifySyncService(store)._routes_for_user(user["id"])
            if route.get("dataset_id")
        }
        if str(body.dataset_id) not in allowed_dataset_ids:
            raise HTTPException(status_code=403, detail="所选 Dify Dataset 不在当前用户允许的知识域范围内")
    try:
        linked = store.register_dify_document(
            user=user,
            dify_document_id=dify_document_id,
            name=body.name,
            scope_id=body.scope_id,
            scope_name=body.scope_name,
            catalog_item_id=body.catalog_item_id,
            archive_tree_node_id=body.archive_tree_node_id,
            visibility=body.visibility,
            confidentiality_level=body.confidentiality_level,
            ai_usage_scope=body.ai_usage_scope,
            dataset_id=body.dataset_id,
        )
        return linked
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/documents/batch/sync-to-dify")
def batch_sync_to_dify(
    body: BatchActionRequest,
    user: dict[str, Any] = Depends(require_permissions("document:index", "ai-governance:write")),
) -> dict[str, Any]:
    for document_id in body.ids:
        if not get_erp_store().can_access_document(document_id, user["id"], action="index"):
            raise HTTPException(status_code=403, detail=f"No index access for document {document_id}")
    return DifySyncService(get_erp_store()).sync_documents(body.ids)


@router.post("/documents/batch/refresh-dify-status")
def batch_refresh_dify_status(
    body: BatchActionRequest,
    user: dict[str, Any] = Depends(require_permission("document:index")),
) -> dict[str, Any]:
    for document_id in body.ids:
        if not get_erp_store().can_access_document(document_id, user["id"], action="index"):
            raise HTTPException(status_code=403, detail=f"No index access for document {document_id}")
    return DifySyncService(get_erp_store()).refresh_documents_status(body.ids)


@router.post("/documents/{document_id}/sync-to-dify")
def sync_document_to_dify(
    document_id: str,
    user: dict[str, Any] = Depends(require_permissions("document:index", "ai-governance:write")),
) -> dict[str, Any]:
    if not get_erp_store().can_access_document(document_id, user["id"], action="index"):
        raise HTTPException(status_code=403, detail="You do not have index access to this document")
    try:
        return DifySyncService(get_erp_store()).sync_document(document_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DifyConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except DifyAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/documents/{document_id}/refresh-dify-status")
def refresh_document_dify_status(
    document_id: str,
    user: dict[str, Any] = Depends(require_permission("document:index")),
) -> dict[str, Any]:
    if not get_erp_store().can_access_document(document_id, user["id"], action="index"):
        raise HTTPException(status_code=403, detail="You do not have index access to this document")
    try:
        return DifySyncService(get_erp_store()).refresh_document_status(document_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DifyConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except DifyAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.put("/documents/{document_id}/permissions")
def update_permissions(
    document_id: str,
    body: PermissionUpdate,
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    try:
        result = get_erp_store().update_permissions(document_id, body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return result


@router.get("/documents/{document_id}/download")
def download_document(document_id: str, user: dict[str, Any] = Depends(require_permission("document:download"))) -> Response:
    store = get_erp_store()
    state = store.state()
    doc = next((d for d in state.get("documents", []) if d.get("id") == document_id and d.get("status") != "deleted"), None)
    if not doc or not store.can_user_access_document(state, doc, user["id"], action="download"):
        raise HTTPException(status_code=403, detail="没有文档下载权限")
    path = store.document_absolute_path(document_id)
    if path is None:
        if str(doc.get("knowledge_source_type") or "") == "dify":
            raise HTTPException(status_code=404, detail="该文档仅存在于 Dify，ERP 未保存可下载的原始附件")
        raise HTTPException(status_code=404, detail="原始附件不存在或文件为空，无法下载")
    if path.stat().st_size <= 0:
        raise HTTPException(status_code=404, detail="原始附件为空，无法下载")
    return FileResponse(path, filename=doc.get("file_name") or doc.get("title") or path.name, media_type=doc.get("mime_type") or "application/octet-stream")


@router.get("/documents/{document_id}/access-decision", response_model=AccessDecisionResponse)
def document_access_decision(
    document_id: str,
    action: str = Query(default="read", pattern="^(read|write|index|download)$"),
    user: dict[str, Any] = Depends(current_user),
) -> AccessDecisionResponse:
    return AccessDecisionResponse(**get_erp_store().explain_document_access(document_id, user["id"], action))


@router.get("/archive/tree/nodes/{node_id}/access-decision", response_model=AccessDecisionResponse)
def archive_tree_access_decision(
    node_id: str,
    action: str = Query(default="read", pattern="^(read|upload|delete|metadata|download)$"),
    user: dict[str, Any] = Depends(current_user),
) -> AccessDecisionResponse:
    return AccessDecisionResponse(**get_erp_store().explain_archive_tree_access(node_id, user["id"], action))


@router.get("/index/status")
def index_status(user: dict[str, Any] = Depends(require_permission("document:read"))) -> dict[str, Any]:
    return get_erp_store().index_status()


@router.get("/ai/data-plane/status")
def ai_data_plane_status(user: dict[str, Any] = Depends(require_permission("ai-governance:read"))) -> dict[str, Any]:
    """Expose relational chunk and Milvus health without leaking credentials."""
    from app.knowledge_base import get_data_plane

    return get_data_plane().status()


@router.get("/users")
def users(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    return get_erp_store().reference_data(user["id"])["users"]


@router.get("/roles")
def roles(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    return get_erp_store().reference_data(user["id"])["roles"]


@router.put("/roles/{role_id}/permissions")
def update_role_permissions(
    role_id: str,
    body: RolePermissionUpdate,
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    result = get_erp_store().update_role_permissions(role_id, body.permissions, actor=user["id"])
    if result is None:
        raise HTTPException(status_code=404, detail="Role not found")
    return result


@router.get("/departments")
def departments(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    return get_erp_store().reference_data(user["id"])["departments"]


@router.get("/audit-logs")
def audit_logs(user: dict[str, Any] = Depends(require_admin)) -> list[dict[str, Any]]:
    return get_erp_store().audit_logs()


@router.get("/archive/audit-logs")
def archive_audit_logs(user: dict[str, Any] = Depends(require_permission("archive:read"))) -> list[dict[str, Any]]:
    return get_erp_store().archive_audit_logs()


@router.get("/ai-governance/audit-logs")
def ai_governance_audit_logs(user: dict[str, Any] = Depends(require_permission("ai-governance:read"))) -> list[dict[str, Any]]:
    return get_erp_store().ai_governance_audit_logs()


@router.get("/settings")
def settings(user: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    return get_erp_store().settings(user["id"])


@router.patch("/settings")
def update_setting(
    body: SettingUpdate,
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    try:
        return get_erp_store().update_setting(body.key, body.value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/settings/batch")
def update_settings(
    body: SettingsUpdateRequest,
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    try:
        return get_erp_store().update_settings(body.settings)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/ai/ask", response_model=AiQuestionResponse)
def ask_ai(
    body: AiQuestionRequest,
    user: dict[str, Any] = Depends(require_permission("document:read")),
) -> AiQuestionResponse:
    try:
        result = DifySyncService(get_erp_store()).chat(
            body.question, user=user["id"], conversation_id=body.conversation_id
        )
        return AiQuestionResponse(status="ok", **result)
    except DifyConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except DifyAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/ai/retrieve", response_model=KnowledgeRetrieveResponse)
def retrieve_knowledge(
    body: AiQuestionRequest,
    user: dict[str, Any] = Depends(require_permission("document:read")),
) -> KnowledgeRetrieveResponse:
    try:
        result = DifySyncService(get_erp_store()).retrieve(
            body.question,
            top_k=body.top_k,
            score_threshold=body.score_threshold,
            user_id=user["id"],
        )
        return KnowledgeRetrieveResponse(query=result["query"], chunks=result["chunks"])
    except DifyConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except DifyAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/ai/chat", response_model=DifyChatResponse)
def chat_with_dify(
    body: AiQuestionRequest,
    user: dict[str, Any] = Depends(require_permission("document:read")),
) -> DifyChatResponse:
    try:
        result = DifySyncService(get_erp_store()).chat(
            body.question, user=user["id"], conversation_id=body.conversation_id
        )
        return DifyChatResponse(**result)
    except DifyConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except DifyAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/scenes/contract-review", response_model=SceneResultResponse)
def scene_contract_review(
    body: ContractReviewRequest,
    user: dict[str, Any] = Depends(current_user),
) -> SceneResultResponse:
    return SceneResultResponse(**get_erp_store().build_contract_review_mock(**body.model_dump()))


@router.post("/scenes/meeting-summary", response_model=SceneResultResponse)
def scene_meeting_summary(
    body: MeetingSummaryRequest,
    user: dict[str, Any] = Depends(current_user),
) -> SceneResultResponse:
    return SceneResultResponse(**get_erp_store().build_meeting_summary_mock(**body.model_dump()))


@router.post("/scenes/test-report", response_model=SceneResultResponse)
def scene_test_report(
    body: TestReportRequest,
    user: dict[str, Any] = Depends(current_user),
) -> SceneResultResponse:
    return SceneResultResponse(**get_erp_store().build_test_report_mock(**body.model_dump()))


@router.get("/scene-sessions")
def list_scene_sessions(
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    return get_erp_store().list_scene_sessions(user["id"])


@router.post("/scene-sessions", status_code=status.HTTP_201_CREATED)
def create_scene_session(
    body: SceneSessionCreateRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    return get_erp_store().create_scene_session(user, body.model_dump())


@router.get("/scene-sessions/{session_id}")
def get_scene_session(
    session_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    session = get_erp_store().get_scene_session(session_id, user["id"])
    if session is None:
        raise HTTPException(status_code=404, detail="Scene session not found")
    return session


@router.get("/approvals")
def list_approvals(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    return get_erp_store().list_approvals(user["id"])


@router.post("/approvals", status_code=status.HTTP_201_CREATED)
def create_approval(
    body: ApprovalCreateRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    try:
        return get_erp_store().create_approval(user, body.session_id, body.note)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/approvals/{approval_id}")
def get_approval(
    approval_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    approval = get_erp_store().get_approval(approval_id, user["id"])
    if approval is None:
        raise HTTPException(status_code=404, detail="Approval not found")
    return approval


@router.patch("/approvals/{approval_id}")
def update_approval(
    approval_id: str,
    body: ApprovalDecisionRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    try:
        approval = get_erp_store().update_approval(approval_id, user, body.status, body.note)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if approval is None:
        raise HTTPException(status_code=404, detail="Approval not found")
    return approval


@router.post("/assistant/turn", response_model=AssistantTurnResponse)
def assistant_turn(
    body: AssistantTurnRequest,
    user: dict[str, Any] = Depends(current_user),
) -> AssistantTurnResponse:
    intent = _detect_intent(body.message, body.context)
    attachments = body.attachments or {}

    if intent == "history":
        cards = _history_cards(user)
        return AssistantTurnResponse(
            reply="我已经整理了你最近的历史会话和审批事项，你可以直接点开继续处理。",
            intent="history",
            status="answered",
            conversation_id=body.conversation_id,
            cards=cards,
            suggested_actions=[
                {"id": "open-sessions", "label": "查看历史会话"},
                {"id": "open-approvals", "label": "查看审批事项"},
            ],
        )

    if intent == "archive-governance":
        return _assistant_archive_overview_response(body.conversation_id, user)

    if intent == "ai-governance":
        return _assistant_ai_governance_overview_response(body.conversation_id, user)

    if intent == "approval":
        approval_id = str(body.context.get("approval_id") or "")
        if not approval_id:
            raise HTTPException(status_code=400, detail="Missing approval_id in context")
        status_value = "approved" if "通过" in body.message else "rejected"
        try:
            approval = get_erp_store().update_approval(approval_id, user, status_value, body.message)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if approval is None:
            raise HTTPException(status_code=404, detail="Approval not found")
        return AssistantTurnResponse(
            reply=f"我已经把审批更新为：{status_value}。",
            intent="approval",
            status="approval_updated",
            conversation_id=body.conversation_id,
            approval=approval,
            cards=[AssistantCard(type="approval", title="审批结果", body=f"当前状态：{approval.get('status', '')}", data=approval)],
            suggested_actions=[{"id": "open-approvals", "label": "刷新审批列表"}],
        )

    if intent in {"contract-review", "meeting-summary", "test-report"}:
        missing = _missing_fields(intent, attachments)
        if missing:
            return AssistantTurnResponse(
                reply=f"我可以继续为你完成{_scene_label(intent)}，但还缺少一些必要信息。",
                intent=intent,
                status="needs_input",
                conversation_id=body.conversation_id,
                required_fields=missing,
                cards=[
                    AssistantCard(
                        type="form",
                        title=f"补充{_scene_label(intent)}参数",
                        body="请补齐下列字段后再次提交。",
                        data={"intent": intent, "fields": [field.model_dump() for field in missing]},
                    )
                ],
                suggested_actions=[{"id": "submit-form", "label": "补齐后生成草稿"}],
            )

        if intent == "contract-review":
            result = get_erp_store().build_contract_review_mock(
                primary_file_name=str(attachments.get("primary_file_name") or ""),
                secondary_file_name=str(attachments.get("secondary_file_name") or ""),
                contract_type=str(attachments.get("contract_type") or ""),
                review_focus=str(attachments.get("review_focus") or ""),
                notes=str(attachments.get("notes") or ""),
                primary_text=str(attachments.get("primary_text") or ""),
                secondary_text=str(attachments.get("secondary_text") or ""),
            )
            input_payload = {
                "primaryFile": attachments.get("primary_file_name", ""),
                "secondaryFile": attachments.get("secondary_file_name", ""),
                "contractType": attachments.get("contract_type", ""),
                "reviewFocus": attachments.get("review_focus", ""),
                "notes": attachments.get("notes", ""),
            }
        elif intent == "meeting-summary":
            result = get_erp_store().build_meeting_summary_mock(
                topic=str(attachments.get("topic") or ""),
                meeting_date=str(attachments.get("meeting_date") or ""),
                attendees=str(attachments.get("attendees") or ""),
                notes=str(attachments.get("notes") or ""),
            )
            input_payload = {
                "topic": attachments.get("topic", ""),
                "date": attachments.get("meeting_date", ""),
                "attendees": attachments.get("attendees", ""),
                "notes": attachments.get("notes", ""),
            }
        else:
            result = get_erp_store().build_test_report_mock(
                project=str(attachments.get("project") or ""),
                version=str(attachments.get("version") or ""),
                scope=str(attachments.get("scope") or ""),
                findings=str(attachments.get("findings") or ""),
                conclusion=str(attachments.get("conclusion") or ""),
            )
            input_payload = {
                "project": attachments.get("project", ""),
                "version": attachments.get("version", ""),
                "scope": attachments.get("scope", ""),
                "findings": attachments.get("findings", ""),
                "conclusion": attachments.get("conclusion", ""),
            }

        session, approval = _persist_scene_result(
            user=user,
            scene_type=intent,
            title=str(result.get("title") or _scene_label(intent)),
            input_payload=input_payload,
            output=dict(result.get("output") or {}),
            summary=str(result.get("summary") or ""),
            citations=list(result.get("citations") or []),
            conversation_id=body.conversation_id,
            submit_for_approval=bool(body.context.get("submit_for_approval")),
            approval_note=str(body.context.get("approval_note") or ""),
        )
        cards = _scene_cards(
            scene_type=intent,
            summary=str(result.get("summary") or ""),
            output=dict(result.get("output") or {}),
            citations=list(result.get("citations") or []),
            session=session,
            approval=approval,
        )
        return AssistantTurnResponse(
            reply=f"我已经为你生成了{_scene_label(intent)}草稿。",
            intent=intent,
            status="draft_generated",
            conversation_id=body.conversation_id,
            cards=cards,
            citations=list(result.get("citations") or []),
            session=session,
            approval=approval,
            suggested_actions=[
                {"id": "submit-approval", "label": "提交审批"},
                {"id": "open-session", "label": "查看历史记录"},
            ],
        )

    try:
        result = DifySyncService(get_erp_store()).chat(
            body.message,
            user=user["id"],
            conversation_id=body.conversation_id,
        )
    except DifyConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except DifyAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    answer = str(result.get("answer") or "").strip()
    citations = list(result.get("citations") or [])
    session, approval = _persist_scene_result(
        user=user,
        scene_type="employee-qa",
        title=_short_text(body.message, 48) or "普通员工问答",
        input_payload={"question": body.message},
        output={"answer": answer},
        summary=_short_text(answer, 120),
        citations=citations,
        conversation_id=str(result.get("conversation_id") or body.conversation_id),
        submit_for_approval=bool(body.context.get("submit_for_approval")),
        approval_note=str(body.context.get("approval_note") or ""),
    )
    return AssistantTurnResponse(
        reply=answer or "我已完成回答。",
        intent="qa",
        status="answered",
        conversation_id=str(result.get("conversation_id") or body.conversation_id),
        cards=_qa_cards(answer, citations, session),
        citations=citations,
        session=session,
        approval=approval,
        suggested_actions=[
            {"id": "ask-again", "label": "继续追问"},
            {"id": "submit-approval", "label": "提交审批"},
        ],
    )


@router.get("/assistant/archive-overview", response_model=AssistantTurnResponse)
def assistant_archive_overview(user: dict[str, Any] = Depends(current_user)) -> AssistantTurnResponse:
    return _assistant_archive_overview_response("", user)


@router.get("/assistant/ai-governance-overview", response_model=AssistantTurnResponse)
def assistant_ai_governance_overview(user: dict[str, Any] = Depends(current_user)) -> AssistantTurnResponse:
    return _assistant_ai_governance_overview_response("", user)


@router.get("/assistant/sessions")
def assistant_sessions(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    return get_erp_store().list_scene_sessions(user["id"])


@router.get("/assistant/sessions/{session_id}")
def assistant_session_detail(
    session_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    session = get_erp_store().get_scene_session(session_id, user["id"])
    if session is None:
        raise HTTPException(status_code=404, detail="Scene session not found")
    return session


@router.delete("/assistant/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_assistant_session(
    session_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> Response:
    try:
        deleted = get_erp_store().delete_scene_session(session_id, user["id"])
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Scene session not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/assistant/sessions/{session_id}/submit-approval", status_code=status.HTTP_201_CREATED)
def assistant_submit_approval(
    session_id: str,
    body: AssistantApprovalSubmitRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    try:
        return get_erp_store().create_approval(user, session_id, body.note)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/assistant/approvals")
def assistant_approvals(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    return get_erp_store().list_approvals(user["id"])


@router.patch("/assistant/approvals/{approval_id}")
def assistant_update_approval(
    approval_id: str,
    body: ApprovalDecisionRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    try:
        approval = get_erp_store().update_approval(approval_id, user, body.status, body.note)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if approval is None:
        raise HTTPException(status_code=404, detail="Approval not found")
    return approval


@router.get("/capabilities")
def capabilities(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, str]]:
    return get_erp_store().capabilities()
