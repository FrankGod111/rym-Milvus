"""Stable HTTP contracts used by external skills.

Design notes:
- `/skill/v1` keeps the original read-friendly knowledge contract for the
  `local_knowledge_base` skill.
- `/skill/v1/workflow/*` exposes a higher-level ERP workflow contract so another
  agent platform can answer questions, run scene generation, persist sessions,
  and submit / review approvals without understanding the underlying ERP, Dify,
  or scene-specific endpoints.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field, TypeAdapter

from app.erp.schemas import (
    ApprovalDecisionRequest,
    ContractReviewRequest,
    KnowledgeRetrieveResponse,
    LoginRequest,
    LoginResponse,
    MeetingSummaryRequest,
    TestReportRequest,
)
from app.erp.store import get_erp_store
from app.integrations.dify.client import DifyAPIError, DifyConfigError
from app.integrations.dify.service import DifySyncService
from app.knowledge.schemas import (
    CatalogResponse,
    EntryDocumentResponse,
    EntryMeta,
    IndexesResponse,
    IndexSummary,
)
from app.knowledge.store import get_store

router = APIRouter(prefix="/skill/v1", tags=["skill"])

SKILL_NAME = "local_knowledge_base"
SKILL_VERSION = "1.0.0"
WORKFLOW_SKILL_NAME = "erp_scene_workflow"
WORKFLOW_SKILL_VERSION = "1.0.0"


class ManifestAction(BaseModel):
    id: str
    method: str
    path: str
    description: str
    params: dict[str, str] = Field(default_factory=dict)
    requires_auth: bool = False


class ManifestResponse(BaseModel):
    skill: str
    version: str
    protocol: str = "http+json"
    base_path: str = "/skill/v1"
    actions: list[ManifestAction]


class BundleRequest(BaseModel):
    index_keys: list[str] = Field(
        default_factory=list,
        description="Restrict catalog entries to these index_keys. Empty = all.",
    )
    entry_ids: list[str] = Field(
        default_factory=list,
        description="entry_ids whose full document body must be included.",
    )
    include_all_documents: bool = Field(
        default=False,
        description="If true, include the full document body for every entry in the filtered catalog.",
    )
    max_documents: int = Field(
        default=20,
        ge=0,
        le=200,
        description="Safety cap on number of documents returned when include_all_documents=true.",
    )


class BundleResponse(BaseModel):
    indexes: list[IndexSummary]
    catalog: CatalogResponse
    documents: list[EntryDocumentResponse]
    truncated: bool = False


class WorkflowApprovalCreateRequest(BaseModel):
    note: str = Field(default="", max_length=4000)


class WorkflowAskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    conversation_id: str = Field(default="", max_length=256)
    persist_session: bool = True
    submit_for_approval: bool = False
    approval_note: str = Field(default="", max_length=4000)
    session_title: str = Field(default="", max_length=256)


class WorkflowRetrieveRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    top_k: int = Field(default=5, ge=1, le=20)
    score_threshold: float | None = Field(default=None, ge=0, le=1)


class WorkflowContractReviewRequest(ContractReviewRequest):
    persist_session: bool = True
    submit_for_approval: bool = False
    approval_note: str = Field(default="", max_length=4000)
    session_title: str = Field(default="", max_length=256)


class WorkflowMeetingSummaryRequest(MeetingSummaryRequest):
    persist_session: bool = True
    submit_for_approval: bool = False
    approval_note: str = Field(default="", max_length=4000)
    session_title: str = Field(default="", max_length=256)


class WorkflowTestReportRequest(TestReportRequest):
    persist_session: bool = True
    submit_for_approval: bool = False
    approval_note: str = Field(default="", max_length=4000)
    session_title: str = Field(default="", max_length=256)


class WorkflowRunResponse(BaseModel):
    scene_type: str
    title: str
    summary: str
    output: dict[str, Any]
    citations: list[dict[str, Any]] = Field(default_factory=list)
    conversation_id: str = ""
    answer_mode: str = ""
    permission_filtered: bool = True
    confidence: float = 0
    retrieved_count: int = 0
    session: dict[str, Any] | None = None
    approval: dict[str, Any] | None = None


@router.get("/manifest", response_model=ManifestResponse)
def manifest() -> ManifestResponse:
    """Self-describe the local knowledge skill contract."""
    actions = [
        ManifestAction(
            id="list_indexes",
            method="GET",
            path="/skill/v1/kb/indexes",
            description="List logical indexes (index_key + label + entry_count).",
        ),
        ManifestAction(
            id="get_catalog",
            method="GET",
            path="/skill/v1/kb/catalog",
            description="Return catalog metadata (optionally filtered by index_key).",
            params={"index_key": "optional string"},
        ),
        ManifestAction(
            id="get_document",
            method="GET",
            path="/skill/v1/kb/document/{entry_id}",
            description="Return the full Markdown document for one entry (no chunking).",
        ),
        ManifestAction(
            id="get_bundle",
            method="POST",
            path="/skill/v1/kb/bundle",
            description=(
                "One-shot: returns indexes + filtered catalog + optional full documents. "
                "Use to minimize round-trips."
            ),
        ),
    ]
    return ManifestResponse(
        skill=SKILL_NAME,
        version=SKILL_VERSION,
        actions=actions,
    )


@router.get("/workflow/manifest", response_model=ManifestResponse)
def workflow_manifest() -> ManifestResponse:
    """Self-describe the higher-level ERP workflow skill contract."""
    actions = [
        ManifestAction(
            id="session_login",
            method="POST",
            path="/skill/v1/workflow/session/login",
            description="Login with ERP demo credentials and get a bearer token for subsequent workflow actions.",
            params={"username": "required string", "password": "required string"},
        ),
        ManifestAction(
            id="session_me",
            method="GET",
            path="/skill/v1/workflow/session/me",
            description="Validate the current bearer token and refresh the session token.",
            requires_auth=True,
        ),
        ManifestAction(
            id="retrieve",
            method="POST",
            path="/skill/v1/workflow/retrieve",
            description="Run permission-filtered knowledge retrieval for the current user.",
            params={"question": "required string", "top_k": "optional int", "score_threshold": "optional float"},
            requires_auth=True,
        ),
        ManifestAction(
            id="ask",
            method="POST",
            path="/skill/v1/workflow/ask",
            description="Run knowledge-grounded employee Q&A and optionally persist the result as a scene session or submit it for approval.",
            params={"question": "required string", "conversation_id": "optional string", "persist_session": "optional bool", "submit_for_approval": "optional bool"},
            requires_auth=True,
        ),
        ManifestAction(
            id="contract_review",
            method="POST",
            path="/skill/v1/workflow/scenes/contract-review",
            description="Generate a contract comparison draft and optionally persist / submit it for approval.",
            requires_auth=True,
        ),
        ManifestAction(
            id="meeting_summary",
            method="POST",
            path="/skill/v1/workflow/scenes/meeting-summary",
            description="Generate a meeting summary draft and optionally persist / submit it for approval.",
            requires_auth=True,
        ),
        ManifestAction(
            id="test_report",
            method="POST",
            path="/skill/v1/workflow/scenes/test-report",
            description="Generate a structured test report draft and optionally persist / submit it for approval.",
            requires_auth=True,
        ),
        ManifestAction(
            id="list_sessions",
            method="GET",
            path="/skill/v1/workflow/sessions",
            description="List the current user's saved scene sessions.",
            requires_auth=True,
        ),
        ManifestAction(
            id="get_session",
            method="GET",
            path="/skill/v1/workflow/sessions/{session_id}",
            description="Get one saved scene session by ID.",
            requires_auth=True,
        ),
        ManifestAction(
            id="submit_approval",
            method="POST",
            path="/skill/v1/workflow/sessions/{session_id}/submit-approval",
            description="Submit a saved scene session into the approval queue.",
            requires_auth=True,
        ),
        ManifestAction(
            id="list_approvals",
            method="GET",
            path="/skill/v1/workflow/approvals",
            description="List approvals visible to the current user. Admin sees all approvals.",
            requires_auth=True,
        ),
        ManifestAction(
            id="get_approval",
            method="GET",
            path="/skill/v1/workflow/approvals/{approval_id}",
            description="Get one approval by ID.",
            requires_auth=True,
        ),
        ManifestAction(
            id="decide_approval",
            method="PATCH",
            path="/skill/v1/workflow/approvals/{approval_id}",
            description="Approve or reject one approval. Admin account required.",
            params={"status": "approved|rejected", "note": "optional string"},
            requires_auth=True,
        ),
    ]
    return ManifestResponse(
        skill=WORKFLOW_SKILL_NAME,
        version=WORKFLOW_SKILL_VERSION,
        base_path="/skill/v1/workflow",
        actions=actions,
    )


@router.get("/kb/indexes", response_model=IndexesResponse)
def kb_indexes() -> IndexesResponse:
    raw = get_store().list_index_summaries()
    items = TypeAdapter(list[IndexSummary]).validate_python(raw)
    return IndexesResponse(indexes=items)


@router.get("/kb/catalog", response_model=CatalogResponse)
def kb_catalog(
    index_key: str | None = Query(
        default=None, description="Filter to this index_key; omit for full catalog."
    ),
) -> CatalogResponse:
    raw = get_store().get_catalog()
    rows: list[dict[str, Any]] = list(raw.get("entries", []))
    if index_key:
        rows = [e for e in rows if str(e.get("index_key", "")) == index_key]
    entries = TypeAdapter(list[EntryMeta]).validate_python(rows)
    return CatalogResponse(version=int(raw.get("version", 1)), entries=entries)


@router.get("/kb/document/{entry_id}", response_model=EntryDocumentResponse)
def kb_document(entry_id: str) -> EntryDocumentResponse:
    store = get_store()
    row = store.get_entry_meta(entry_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    body = store.read_document(entry_id)
    if body is None:
        raise HTTPException(status_code=404, detail="Document file missing")
    return EntryDocumentResponse(id=row["id"], title=row["title"], content=body)


@router.post("/kb/bundle", response_model=BundleResponse)
def kb_bundle(req: BundleRequest = Body(default_factory=BundleRequest)) -> BundleResponse:
    store = get_store()
    raw_catalog = store.get_catalog()
    all_rows: list[dict[str, Any]] = list(raw_catalog.get("entries", []))
    if req.index_keys:
        wanted = set(req.index_keys)
        rows = [e for e in all_rows if str(e.get("index_key", "")) in wanted]
    else:
        rows = all_rows
    entries = TypeAdapter(list[EntryMeta]).validate_python(rows)
    catalog = CatalogResponse(
        version=int(raw_catalog.get("version", 1)),
        entries=entries,
    )

    indexes = TypeAdapter(list[IndexSummary]).validate_python(store.list_index_summaries())

    target_ids: list[str] = []
    if req.include_all_documents:
        target_ids.extend(e.id for e in entries)
    for eid in req.entry_ids:
        if eid not in target_ids:
            target_ids.append(eid)

    truncated = False
    if len(target_ids) > req.max_documents:
        target_ids = target_ids[: req.max_documents]
        truncated = True

    docs: list[EntryDocumentResponse] = []
    for eid in target_ids:
        meta = store.get_entry_meta(eid)
        if meta is None:
            continue
        body = store.read_document(eid)
        if body is None:
            continue
        docs.append(
            EntryDocumentResponse(id=meta["id"], title=meta["title"], content=body)
        )

    return BundleResponse(
        indexes=indexes,
        catalog=catalog,
        documents=docs,
        truncated=truncated,
    )


def _extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


def _workflow_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    token = _extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    user = get_erp_store().authenticate(token)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user


def _short_text(value: str, limit: int) -> str:
    text = " ".join(str(value or "").strip().split())
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}…"


def _persist_workflow_result(
    *,
    user: dict[str, Any],
    scene_type: str,
    title: str,
    input_payload: dict[str, Any],
    output: dict[str, Any],
    summary: str,
    citations: list[dict[str, Any]],
    conversation_id: str,
    persist_session: bool,
    submit_for_approval: bool,
    approval_note: str,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    store = get_erp_store()
    session: dict[str, Any] | None = None
    approval: dict[str, Any] | None = None
    if persist_session or submit_for_approval:
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
    if submit_for_approval and session is not None:
        approval = store.create_approval(user, session["id"], approval_note)
    return session, approval


@router.post("/workflow/session/login", response_model=LoginResponse)
def workflow_login(body: LoginRequest) -> LoginResponse:
    result = get_erp_store().login(body.username, body.password)
    if result is None:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return LoginResponse(**result)


@router.get("/workflow/session/me", response_model=LoginResponse)
def workflow_me(user: dict[str, Any] = Depends(_workflow_user)) -> LoginResponse:
    token, expires_at = get_erp_store().issue_token(user["id"])
    return LoginResponse(token=token, expires_at=expires_at, user=user)


@router.post("/workflow/retrieve", response_model=KnowledgeRetrieveResponse)
def workflow_retrieve(
    body: WorkflowRetrieveRequest,
    user: dict[str, Any] = Depends(_workflow_user),
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


@router.post("/workflow/ask", response_model=WorkflowRunResponse)
def workflow_ask(
    body: WorkflowAskRequest,
    user: dict[str, Any] = Depends(_workflow_user),
) -> WorkflowRunResponse:
    try:
        result = DifySyncService(get_erp_store()).chat(
            body.question,
            user=user["id"],
            conversation_id=body.conversation_id,
        )
    except DifyConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except DifyAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    answer = str(result.get("answer") or "").strip()
    conversation_id = str(result.get("conversation_id") or body.conversation_id)
    title = body.session_title.strip() or _short_text(body.question, 48) or "普通员工问答"
    summary = _short_text(answer, 120) or title
    citations = list(result.get("citations") or [])
    output = {"answer": answer}
    session, approval = _persist_workflow_result(
        user=user,
        scene_type="employee-qa",
        title=title,
        input_payload={"question": body.question},
        output=output,
        summary=summary,
        citations=citations,
        conversation_id=conversation_id,
        persist_session=body.persist_session,
        submit_for_approval=body.submit_for_approval,
        approval_note=body.approval_note,
    )
    return WorkflowRunResponse(
        scene_type="employee-qa",
        title=title,
        summary=summary,
        output=output,
        citations=citations,
        conversation_id=conversation_id,
        answer_mode=str(result.get("answer_mode") or "guarded_chat"),
        permission_filtered=bool(result.get("permission_filtered", True)),
        confidence=float(result.get("confidence") or 0),
        retrieved_count=int(result.get("retrieved_count") or 0),
        session=session,
        approval=approval,
    )


@router.post("/workflow/scenes/contract-review", response_model=WorkflowRunResponse)
def workflow_contract_review(
    body: WorkflowContractReviewRequest,
    user: dict[str, Any] = Depends(_workflow_user),
) -> WorkflowRunResponse:
    scene_input = body.model_dump(
        exclude={"persist_session", "submit_for_approval", "approval_note", "session_title"}
    )
    result = get_erp_store().build_contract_review_mock(**scene_input)
    title = body.session_title.strip() or str(result.get("title") or "合同对比审查")
    summary = str(result.get("summary") or "")
    citations = list(result.get("citations") or [])
    output = dict(result.get("output") or {})
    session, approval = _persist_workflow_result(
        user=user,
        scene_type=str(result.get("scene_type") or "contract-review"),
        title=title,
        input_payload={
            "primaryFile": body.primary_file_name,
            "secondaryFile": body.secondary_file_name,
            "contractType": body.contract_type,
            "reviewFocus": body.review_focus,
            "notes": body.notes,
        },
        output=output,
        summary=summary,
        citations=citations,
        conversation_id="",
        persist_session=body.persist_session,
        submit_for_approval=body.submit_for_approval,
        approval_note=body.approval_note,
    )
    return WorkflowRunResponse(
        scene_type=str(result.get("scene_type") or "contract-review"),
        title=title,
        summary=summary,
        output=output,
        citations=citations,
        session=session,
        approval=approval,
    )


@router.post("/workflow/scenes/meeting-summary", response_model=WorkflowRunResponse)
def workflow_meeting_summary(
    body: WorkflowMeetingSummaryRequest,
    user: dict[str, Any] = Depends(_workflow_user),
) -> WorkflowRunResponse:
    scene_input = body.model_dump(
        exclude={"persist_session", "submit_for_approval", "approval_note", "session_title"}
    )
    result = get_erp_store().build_meeting_summary_mock(**scene_input)
    title = body.session_title.strip() or str(result.get("title") or "会议纪要")
    summary = str(result.get("summary") or "")
    citations = list(result.get("citations") or [])
    output = dict(result.get("output") or {})
    session, approval = _persist_workflow_result(
        user=user,
        scene_type=str(result.get("scene_type") or "meeting-summary"),
        title=title,
        input_payload={
            "topic": body.topic,
            "date": body.meeting_date,
            "attendees": body.attendees,
            "notes": body.notes,
        },
        output=output,
        summary=summary,
        citations=citations,
        conversation_id="",
        persist_session=body.persist_session,
        submit_for_approval=body.submit_for_approval,
        approval_note=body.approval_note,
    )
    return WorkflowRunResponse(
        scene_type=str(result.get("scene_type") or "meeting-summary"),
        title=title,
        summary=summary,
        output=output,
        citations=citations,
        session=session,
        approval=approval,
    )


@router.post("/workflow/scenes/test-report", response_model=WorkflowRunResponse)
def workflow_test_report(
    body: WorkflowTestReportRequest,
    user: dict[str, Any] = Depends(_workflow_user),
) -> WorkflowRunResponse:
    scene_input = body.model_dump(
        exclude={"persist_session", "submit_for_approval", "approval_note", "session_title"}
    )
    result = get_erp_store().build_test_report_mock(**scene_input)
    title = body.session_title.strip() or str(result.get("title") or "测试报告")
    summary = str(result.get("summary") or "")
    citations = list(result.get("citations") or [])
    output = dict(result.get("output") or {})
    session, approval = _persist_workflow_result(
        user=user,
        scene_type=str(result.get("scene_type") or "test-report"),
        title=title,
        input_payload={
            "project": body.project,
            "version": body.version,
            "scope": body.scope,
            "findings": body.findings,
            "conclusion": body.conclusion,
        },
        output=output,
        summary=summary,
        citations=citations,
        conversation_id="",
        persist_session=body.persist_session,
        submit_for_approval=body.submit_for_approval,
        approval_note=body.approval_note,
    )
    return WorkflowRunResponse(
        scene_type=str(result.get("scene_type") or "test-report"),
        title=title,
        summary=summary,
        output=output,
        citations=citations,
        session=session,
        approval=approval,
    )


@router.get("/workflow/sessions")
def workflow_list_sessions(
    user: dict[str, Any] = Depends(_workflow_user),
) -> list[dict[str, Any]]:
    return get_erp_store().list_scene_sessions(user["id"])


@router.get("/workflow/sessions/{session_id}")
def workflow_get_session(
    session_id: str,
    user: dict[str, Any] = Depends(_workflow_user),
) -> dict[str, Any]:
    session = get_erp_store().get_scene_session(session_id, user["id"])
    if session is None:
        raise HTTPException(status_code=404, detail="Scene session not found")
    return session


@router.post("/workflow/sessions/{session_id}/submit-approval", status_code=status.HTTP_201_CREATED)
def workflow_submit_approval(
    session_id: str,
    body: WorkflowApprovalCreateRequest = Body(default_factory=WorkflowApprovalCreateRequest),
    user: dict[str, Any] = Depends(_workflow_user),
) -> dict[str, Any]:
    try:
        return get_erp_store().create_approval(user, session_id, body.note)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/workflow/approvals")
def workflow_list_approvals(
    user: dict[str, Any] = Depends(_workflow_user),
) -> list[dict[str, Any]]:
    return get_erp_store().list_approvals(user["id"])


@router.get("/workflow/approvals/{approval_id}")
def workflow_get_approval(
    approval_id: str,
    user: dict[str, Any] = Depends(_workflow_user),
) -> dict[str, Any]:
    approval = get_erp_store().get_approval(approval_id, user["id"])
    if approval is None:
        raise HTTPException(status_code=404, detail="Approval not found")
    return approval


@router.patch("/workflow/approvals/{approval_id}")
def workflow_update_approval(
    approval_id: str,
    body: ApprovalDecisionRequest,
    user: dict[str, Any] = Depends(_workflow_user),
) -> dict[str, Any]:
    try:
        approval = get_erp_store().update_approval(approval_id, user, body.status, body.note)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if approval is None:
        raise HTTPException(status_code=404, detail="Approval not found")
    return approval
