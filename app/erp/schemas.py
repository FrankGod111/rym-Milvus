"""Schemas for the ERP document management MVP."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


Visibility = Literal["public", "department", "role", "private", "admin"]
DocumentStatus = Literal["uploaded", "indexing", "indexed", "failed", "archived", "deleted"]
IndexStatus = Literal["pending", "running", "completed", "failed", "skipped"]
FilingStatus = Literal["unfiled", "filed", "pending", "void"]
AiUsageScope = Literal["archive_only", "ai_search", "ai_answer"]
KnowledgeSyncStatus = Literal["disabled", "pending", "synced", "failed"]
ConfidentialityLevel = Literal["public", "internal", "department", "sensitive", "restricted"]
RedactionStatus = Literal["not_required", "pending", "completed"]


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    expires_at: str
    user: dict[str, Any]


class DashboardResponse(BaseModel):
    totals: dict[str, int]
    index_health: dict[str, int]
    recent_documents: list[dict[str, Any]]
    recent_audit_logs: list[dict[str, Any]]
    roadmap: list[dict[str, str]]


class DocumentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=256)
    category: str = Field(default="General", max_length=128)
    tags: list[str] = Field(default_factory=list)
    owner_id: str = "u-admin"
    department_id: str = "dept-ops"
    visibility: Visibility = "department"
    file_name: str = Field(..., min_length=1, max_length=256)
    mime_type: str = "text/plain"
    content_text: str = ""
    content_base64: str = ""
    org_unit_id: str = "dept-ops"
    org_path: str = Field(default="", max_length=256)
    archive_catalog_id: str = Field(default="", max_length=128)
    archive_tree_node_id: str = Field(default="", max_length=128)
    archive_category: str = Field(default="制度", max_length=128)
    archive_path: str = Field(default="", max_length=256)
    document_code: str = Field(default="", max_length=128)
    document_type: str = Field(default="通用文档", max_length=128)
    filing_year: str = Field(default="", max_length=32)
    filing_period: str = Field(default="年度", max_length=64)
    retention_period: str = Field(default="长期", max_length=64)
    is_required: bool = False
    required_rule_source: str = Field(default="", max_length=256)
    filing_status: FilingStatus = "unfiled"
    effective_date: str = Field(default="", max_length=64)
    expiry_date: str = Field(default="", max_length=64)
    ai_enabled: bool = False
    ai_usage_scope: AiUsageScope = "archive_only"
    knowledge_sync_status: KnowledgeSyncStatus = "disabled"
    knowledge_source_type: str = Field(default="archive_doc", max_length=64)
    knowledge_dataset_key: str = Field(default="", max_length=128)
    retrieval_priority: int = Field(default=50, ge=0, le=100)
    redaction_required: bool = False
    redaction_status: RedactionStatus = "not_required"
    ai_summary_enabled: bool = False
    ai_summary_template: str = Field(default="", max_length=2000)
    ai_keywords_enabled: bool = False
    confidentiality_level: ConfidentialityLevel = "internal"
    access_scope_type: str = Field(default="department", max_length=64)
    access_scope_ids: list[str] = Field(default_factory=list)
    approval_flow_id: str = Field(default="", max_length=128)
    archive_owner_id: str = Field(default="", max_length=128)
    review_owner_id: str = Field(default="", max_length=128)
    last_reviewed_at: str = Field(default="", max_length=64)
    ai_review_note: str = Field(default="", max_length=1000)
    ai_block_reason: str = Field(default="", max_length=1000)
    compliance_status: str = Field(default="compliant", max_length=64)


class DocumentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=256)
    category: str | None = Field(default=None, max_length=128)
    tags: list[str] | None = None
    owner_id: str | None = None
    department_id: str | None = None
    visibility: Visibility | None = None
    status: DocumentStatus | None = None
    content_text: str | None = None
    org_unit_id: str | None = None
    org_path: str | None = Field(default=None, max_length=256)
    archive_catalog_id: str | None = Field(default=None, max_length=128)
    archive_tree_node_id: str | None = Field(default=None, max_length=128)
    archive_category: str | None = Field(default=None, max_length=128)
    archive_path: str | None = Field(default=None, max_length=256)
    document_code: str | None = Field(default=None, max_length=128)
    document_type: str | None = Field(default=None, max_length=128)
    filing_year: str | None = Field(default=None, max_length=32)
    filing_period: str | None = Field(default=None, max_length=64)
    retention_period: str | None = Field(default=None, max_length=64)
    is_required: bool | None = None
    required_rule_source: str | None = Field(default=None, max_length=256)
    filing_status: FilingStatus | None = None
    effective_date: str | None = Field(default=None, max_length=64)
    expiry_date: str | None = Field(default=None, max_length=64)
    ai_enabled: bool | None = None
    ai_usage_scope: AiUsageScope | None = None
    knowledge_sync_status: KnowledgeSyncStatus | None = None
    knowledge_source_type: str | None = Field(default=None, max_length=64)
    knowledge_dataset_key: str | None = Field(default=None, max_length=128)
    retrieval_priority: int | None = Field(default=None, ge=0, le=100)
    redaction_required: bool | None = None
    redaction_status: RedactionStatus | None = None
    ai_summary_enabled: bool | None = None
    ai_summary_template: str | None = Field(default=None, max_length=2000)
    ai_keywords_enabled: bool | None = None
    confidentiality_level: ConfidentialityLevel | None = None
    access_scope_type: str | None = Field(default=None, max_length=64)
    access_scope_ids: list[str] | None = None
    approval_flow_id: str | None = Field(default=None, max_length=128)
    archive_owner_id: str | None = Field(default=None, max_length=128)
    review_owner_id: str | None = Field(default=None, max_length=128)
    last_reviewed_at: str | None = Field(default=None, max_length=64)
    ai_review_note: str | None = Field(default=None, max_length=1000)
    ai_block_reason: str | None = Field(default=None, max_length=1000)
    compliance_status: str | None = Field(default=None, max_length=64)


class DocumentListResponse(BaseModel):
    documents: list[dict[str, Any]]
    total: int
    filters: dict[str, list[str]]


class ArchiveCoverageDetailResponse(BaseModel):
    scope_id: str
    scope_name: str
    required_total: int
    filed_total: int
    missing_total: int
    ai_enabled_total: int
    ai_blocked_total: int
    coverage_rate: float
    items: list[dict[str, Any]] = Field(default_factory=list)


class ArchiveMissingItemResponse(BaseModel):
    items: list[dict[str, Any]]
    total: int


class ArchiveCatalogCreateRequest(BaseModel):
    scope_type: str = Field(default="department", max_length=64)
    scope_id: str = Field(..., min_length=1, max_length=128)
    scope_name: str = Field(default="", max_length=128)
    name: str = Field(..., min_length=1, max_length=128)
    description: str = Field(default="", max_length=1000)
    status: str = Field(default="active", max_length=64)
    sort_order: int = 0


class ArchiveCatalogUpdateRequest(BaseModel):
    scope_type: str | None = Field(default=None, max_length=64)
    scope_id: str | None = Field(default=None, min_length=1, max_length=128)
    scope_name: str | None = Field(default=None, max_length=128)
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=1000)
    status: str | None = Field(default=None, max_length=64)
    sort_order: int | None = None


class ArchiveCatalogResponse(BaseModel):
    id: str
    scope_type: str = "department"
    scope_id: str
    scope_name: str = ""
    name: str
    description: str = ""
    status: str = "active"
    sort_order: int = 0
    item_count: int = 0


class KnowledgeDatasetMappingItem(BaseModel):
    id: str = ""
    scope_type: str = Field(default="department", max_length=64)
    scope_id: str = Field(default="", max_length=128)
    scope_name: str = Field(default="", max_length=128)
    archive_category: str = Field(default="", max_length=128)
    document_type: str = Field(default="", max_length=128)
    ai_usage_scope: AiUsageScope = "ai_search"
    dataset_key: str = Field(..., min_length=1, max_length=128)
    dataset_name: str = Field(default="", max_length=128)
    # Stable ERP knowledge-domain key and the physical Dify Dataset UUID.
    # dataset_id is intentionally optional during compatibility rollout: when
    # omitted, the current single-dataset setting is used.
    dataset_id: str = Field(default="", max_length=256)
    security_domain: str = Field(default="department", max_length=64)
    allowed_role_ids: list[str] = Field(default_factory=list)
    allowed_department_ids: list[str] = Field(default_factory=list)
    enabled: bool = True
    priority: int = Field(default=100, ge=0, le=1000)
    note: str = Field(default="", max_length=1000)


class KnowledgeDatasetMappingUpdateRequest(BaseModel):
    mappings: list[KnowledgeDatasetMappingItem] = Field(default_factory=list)


class KnowledgeDatasetMappingResponse(BaseModel):
    mappings: list[KnowledgeDatasetMappingItem] = Field(default_factory=list)


class ArchiveDocumentCatalogMatchRequest(BaseModel):
    item_id: str = Field(..., min_length=1, max_length=128)


class ArchiveDocumentScopeTransferRequest(BaseModel):
    target_scope_id: str = Field(..., min_length=1, max_length=128)
    target_catalog_item_id: str = Field(default="", max_length=128)
    visibility: Visibility = "department"
    role_ids: list[str] = Field(default_factory=list)
    user_ids: list[str] = Field(default_factory=list)


class DifyDocumentLinkRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=256)
    scope_id: str = Field(..., min_length=1, max_length=128)
    scope_name: str = Field(default="", max_length=128)
    catalog_item_id: str = Field(default="", max_length=128)
    archive_tree_node_id: str = Field(default="", max_length=128)
    visibility: Visibility = "department"
    confidentiality_level: ConfidentialityLevel = "internal"
    ai_usage_scope: AiUsageScope = "ai_answer"
    dataset_id: str = Field(default="", max_length=256)


class BatchActionRequest(BaseModel):
    ids: list[str]


class PermissionUpdate(BaseModel):
    user_ids: list[str] = Field(default_factory=list)
    role_ids: list[str] = Field(default_factory=list)
    department_ids: list[str] = Field(default_factory=list)
    catalog_ids: list[str] = Field(default_factory=list)
    deny_user_ids: list[str] = Field(default_factory=list)
    deny_role_ids: list[str] = Field(default_factory=list)
    deny_department_ids: list[str] = Field(default_factory=list)
    visibility: Visibility | None = None
    download_enabled: bool = False


class AccessDecisionResponse(BaseModel):
    allowed: bool
    subject_type: str = "document"
    subject_id: str
    action: str = "read"
    source: str = ""
    reason: str = ""
    required_capability: str = ""
    matched_rules: list[str] = Field(default_factory=list)
    denied_by: str | None = None
    effective_scope: dict[str, Any] = Field(default_factory=dict)


class CatalogPermissionUpdate(BaseModel):
    user_ids: list[str] = Field(default_factory=list)
    role_ids: list[str] = Field(default_factory=list)
    department_ids: list[str] = Field(default_factory=list)
    deny_user_ids: list[str] = Field(default_factory=list)
    deny_role_ids: list[str] = Field(default_factory=list)
    deny_department_ids: list[str] = Field(default_factory=list)
    allowed_actions: list[Literal["read", "write", "coverage", "missing", "download"]] = Field(
        default_factory=lambda: ["read", "write", "coverage", "missing", "download"]
    )
    inherit_to_documents: bool = True


class RolePermissionUpdate(BaseModel):
    permissions: list[str] = Field(default_factory=list)


class ArchiveTreeNodeCreateRequest(BaseModel):
    parent_id: str = Field(..., min_length=1, max_length=128)
    name: str = Field(..., min_length=1, max_length=128)
    node_type: Literal["organization", "category"] = "category"
    scope_id: str = Field(default="", max_length=128)
    required: bool = False
    archive_status: Literal["filed", "pending", "unfiled"] = "unfiled"
    archive_period: str = Field(default="年度", max_length=64)
    retention_period: str = Field(default="长期", max_length=64)
    owner_role_id: str = Field(default="", max_length=128)
    reviewer_role_id: str = Field(default="", max_length=128)
    ai_enabled: bool = False
    ai_priority_scope: bool = False
    ai_summary_template: str = Field(default="", max_length=2000)
    template_name: str = Field(default="", max_length=256)
    template_content: str = Field(default="", max_length=10000)
    permission_mode: Literal["inherit", "override"] = "inherit"
    allowed_actions: list[Literal["read", "upload", "delete", "metadata", "download"]] = Field(default_factory=lambda: ["read", "upload", "delete", "metadata", "download"])
    user_ids: list[str] = Field(default_factory=list)
    role_ids: list[str] = Field(default_factory=list)
    department_ids: list[str] = Field(default_factory=list)
    deny_user_ids: list[str] = Field(default_factory=list)
    deny_role_ids: list[str] = Field(default_factory=list)
    deny_department_ids: list[str] = Field(default_factory=list)


class ArchiveTreeNodeUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    required: bool | None = None
    archive_status: Literal["filed", "pending", "unfiled"] | None = None
    archive_period: str | None = Field(default=None, max_length=64)
    retention_period: str | None = Field(default=None, max_length=64)
    owner_role_id: str | None = Field(default=None, max_length=128)
    reviewer_role_id: str | None = Field(default=None, max_length=128)
    ai_enabled: bool | None = None
    ai_priority_scope: bool | None = None
    ai_summary_template: str | None = Field(default=None, max_length=2000)
    template_name: str | None = Field(default=None, max_length=256)
    template_content: str | None = Field(default=None, max_length=10000)
    permission_mode: Literal["inherit", "override"] | None = None
    allowed_actions: list[Literal["read", "upload", "delete", "metadata", "download"]] | None = None
    user_ids: list[str] | None = None
    role_ids: list[str] | None = None
    department_ids: list[str] | None = None
    deny_user_ids: list[str] | None = None
    deny_role_ids: list[str] | None = None
    deny_department_ids: list[str] | None = None


class ArchiveTreeBatchUpdateRequest(BaseModel):
    ids: list[str] = Field(min_length=1)
    archive_period: str | None = Field(default=None, max_length=64)
    retention_period: str | None = Field(default=None, max_length=64)
    ai_enabled: bool | None = None
    ai_priority_scope: bool | None = None
    ai_summary_template: str | None = Field(default=None, max_length=2000)


class ArchiveTreeMoveRequest(BaseModel):
    target_parent_id: str = Field(..., min_length=1, max_length=128)
    sort_order: int = 0


class ArchiveTreeMergeRequest(BaseModel):
    target_node_id: str = Field(..., min_length=1, max_length=128)


class AiQuestionRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    scope: str = "visible_documents"
    top_k: int = Field(default=5, ge=1, le=20)
    score_threshold: float | None = Field(default=None, ge=0, le=1)
    conversation_id: str = ""


class AiQuestionResponse(BaseModel):
    answer: str
    status: str
    answer_mode: str = "chat"
    permission_filtered: bool = True
    confidence: float = 0
    retrieved_count: int = 0
    citations: list[dict[str, Any]] = Field(default_factory=list)


class KnowledgeRetrieveResponse(BaseModel):
    query: str
    chunks: list[dict[str, Any]]


class DifyChatResponse(BaseModel):
    answer: str
    conversation_id: str = ""
    message_id: str = ""
    answer_mode: str = "chat"
    permission_filtered: bool = True
    confidence: float = 0
    retrieved_count: int = 0
    citations: list[dict[str, Any]] = Field(default_factory=list)


class SettingUpdate(BaseModel):
    key: str
    value: Any


class SettingsUpdateRequest(BaseModel):
    settings: dict[str, Any]


class ContractReviewRequest(BaseModel):
    primary_file_name: str = Field(..., min_length=1, max_length=256)
    secondary_file_name: str = Field(..., min_length=1, max_length=256)
    contract_type: str = Field(default="", max_length=128)
    review_focus: str = Field(default="", max_length=1000)
    notes: str = Field(default="", max_length=4000)
    primary_text: str = Field(default="", max_length=80_000)
    secondary_text: str = Field(default="", max_length=80_000)


class MeetingSummaryRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=256)
    meeting_date: str = Field(default="", max_length=64)
    attendees: str = Field(default="", max_length=1000)
    notes: str = Field(..., min_length=1, max_length=20000)


class TestReportRequest(BaseModel):
    project: str = Field(..., min_length=1, max_length=256)
    version: str = Field(default="", max_length=128)
    scope: str = Field(..., min_length=1, max_length=10000)
    findings: str = Field(default="", max_length=10000)
    conclusion: str = Field(..., min_length=1, max_length=4000)


class SceneResultResponse(BaseModel):
    scene_type: str
    title: str
    summary: str
    output: dict[str, Any]
    citations: list[dict[str, Any]] = Field(default_factory=list)


class SceneSessionCreateRequest(BaseModel):
    scene_type: str = Field(..., min_length=1, max_length=64)
    title: str = Field(..., min_length=1, max_length=256)
    input: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] = Field(default_factory=dict)
    summary: str = Field(default="", max_length=4000)
    citations: list[dict[str, Any]] = Field(default_factory=list)
    conversation_id: str = Field(default="", max_length=256)
    status: str = Field(default="completed", max_length=64)


class ApprovalCreateRequest(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=128)
    note: str = Field(default="", max_length=4000)


class ApprovalDecisionRequest(BaseModel):
    status: Literal["approved", "rejected"]
    note: str = Field(default="", max_length=4000)


class AiGovernancePolicyUpdateRequest(BaseModel):
    ai_enabled: bool | None = None
    ai_usage_scope: AiUsageScope | None = None
    knowledge_sync_status: KnowledgeSyncStatus | None = None
    knowledge_dataset_key: str | None = Field(default=None, max_length=128)
    redaction_required: bool | None = None
    redaction_status: RedactionStatus | None = None
    confidentiality_level: ConfidentialityLevel | None = None
    filing_status: FilingStatus | None = None
    ai_review_note: str | None = Field(default=None, max_length=1000)
    ai_block_reason: str | None = Field(default=None, max_length=1000)


class AiGovernanceReviewRequest(BaseModel):
    status: Literal["approved", "rejected"]
    note: str = Field(default="", max_length=4000)
    block_reason: str = Field(default="", max_length=1000)


class AiGovernanceReviewRecordResponse(BaseModel):
    id: str
    document_id: str
    document_title: str
    status: Literal["approved", "rejected"]
    note: str = ""
    block_reason: str = ""
    actor: str = ""
    actor_name: str = ""
    created_at: str


class AssistantTurnRequest(BaseModel):
    message: str = Field(default="", max_length=10000)
    conversation_id: str = Field(default="", max_length=256)
    active_session_id: str = Field(default="", max_length=128)
    attachments: dict[str, Any] = Field(default_factory=dict)
    context: dict[str, Any] = Field(default_factory=dict)


class AssistantFieldDescriptor(BaseModel):
    key: str
    label: str
    input_type: str = "text"
    required: bool = True
    placeholder: str = ""
    options: list[str] = Field(default_factory=list)


class AssistantCard(BaseModel):
    type: str
    title: str
    body: str = ""
    data: dict[str, Any] = Field(default_factory=dict)
    actions: list[dict[str, str]] = Field(default_factory=list)


class AssistantTurnResponse(BaseModel):
    reply: str
    intent: str
    status: str
    conversation_id: str = ""
    required_fields: list[AssistantFieldDescriptor] = Field(default_factory=list)
    cards: list[AssistantCard] = Field(default_factory=list)
    citations: list[dict[str, Any]] = Field(default_factory=list)
    session: dict[str, Any] | None = None
    approval: dict[str, Any] | None = None
    suggested_actions: list[dict[str, str]] = Field(default_factory=list)


class AssistantApprovalSubmitRequest(BaseModel):
    note: str = Field(default="", max_length=4000)


class OrgTreeNode(BaseModel):
    id: str
    name: str
    parent_id: str = ""
    path: str = ""
    children: list["OrgTreeNode"] = Field(default_factory=list)


class ArchiveCatalogItemCreateRequest(BaseModel):
    catalog_id: str = Field(default="", max_length=128)
    scope_type: str = Field(default="department", max_length=64)
    scope_id: str = Field(..., min_length=1, max_length=128)
    scope_name: str = Field(default="", max_length=128)
    category: str = Field(..., min_length=1, max_length=128)
    subcategory: str = Field(default="", max_length=128)
    document_name_rule: str = Field(..., min_length=1, max_length=256)
    document_description: str = Field(default="", max_length=1000)
    required: bool = True
    archive_period: str = Field(default="年度", max_length=64)
    retention_policy: str = Field(default="长期", max_length=64)
    default_visibility: Visibility = "department"
    default_ai_enabled: bool = False
    default_ai_usage_type: AiUsageScope = "archive_only"
    ai_allowed: bool = True
    matching_rule: str = Field(default="", max_length=256)
    owner_role: str = Field(default="", max_length=128)
    sort_order: int = 0
    status: str = Field(default="active", max_length=64)


class ArchiveCatalogItemUpdateRequest(BaseModel):
    scope_type: str | None = Field(default=None, max_length=64)
    scope_id: str | None = Field(default=None, min_length=1, max_length=128)
    scope_name: str | None = Field(default=None, max_length=128)
    category: str | None = Field(default=None, min_length=1, max_length=128)
    subcategory: str | None = Field(default=None, max_length=128)
    document_name_rule: str | None = Field(default=None, min_length=1, max_length=256)
    document_description: str | None = Field(default=None, max_length=1000)
    required: bool | None = None
    archive_period: str | None = Field(default=None, max_length=64)
    retention_policy: str | None = Field(default=None, max_length=64)
    default_visibility: Visibility | None = None
    default_ai_enabled: bool | None = None
    default_ai_usage_type: AiUsageScope | None = None
    ai_allowed: bool | None = None
    matching_rule: str | None = Field(default=None, max_length=256)
    owner_role: str | None = Field(default=None, max_length=128)
    sort_order: int | None = None
    status: str | None = Field(default=None, max_length=64)


OrgTreeNode.model_rebuild()
