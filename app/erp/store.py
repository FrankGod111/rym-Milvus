"""File-backed ERP document management store for the MVP."""

from __future__ import annotations

import base64
import csv
import hashlib
import hmac
import io
import json
import logging
import os
import re
import urllib.request
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.erp.parsers import extract_text

logger = logging.getLogger(__name__)


_STATE_VERSION = 1
_DEFAULT_TOKEN_TTL_SECONDS = 12 * 60 * 60
_SENSITIVE_SETTINGS = {"dify_api_key", "dify_app_api_key"}
_ALLOWED_SETTINGS: dict[str, type] = {
    "llm_provider": str,
    "embedding_provider": str,
    "dify_enabled": bool,
    "dify_base_url": str,
    "dify_api_key": str,
    "dify_app_api_key": str,
    "dify_dataset_id": str,
    "dify_indexing_technique": str,
    "dify_process_rule_mode": str,
    "dify_doc_form": str,
    "dify_doc_language": str,
    "dify_timeout_seconds": int,
    "dify_send_metadata": bool,
    "watermark_enabled": bool,
    "review_flow_enabled": bool,
    "sensitive_scan_enabled": bool,
    "ocr_enabled": bool,
    "duplicate_detection_enabled": bool,
    "scheduled_reindex": str,
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _token_secret() -> str:
    return os.environ.get("ERP_SECRET_KEY", "erp-dev-secret-change-me")


def _token_ttl_seconds() -> int:
    raw = os.environ.get("ERP_TOKEN_TTL_SECONDS", str(_DEFAULT_TOKEN_TTL_SECONDS))
    try:
        return max(300, int(raw))
    except ValueError:
        return _DEFAULT_TOKEN_TTL_SECONDS


def _default_root() -> Path:
    env = os.environ.get("ERP_DATA_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return _repo_root() / "data" / "erp"


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def _safe_filename(name: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9._\-一-鿿]+", "_", name).strip("._")
    return clean or "upload.bin"


def _document_governance_defaults(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = payload or {}
    department_id = payload.get("department_id") or "dept-ops"
    return {
        "org_unit_id": payload.get("org_unit_id") or department_id,
        "org_path": payload.get("org_path") or "",
        "archive_catalog_id": payload.get("archive_catalog_id") or "",
        "archive_tree_node_id": payload.get("archive_tree_node_id") or "",
        "archive_category": payload.get("archive_category") or payload.get("category") or "制度",
        "archive_path": payload.get("archive_path") or "",
        "document_code": payload.get("document_code") or "",
        "document_type": payload.get("document_type") or "通用文档",
        "filing_year": payload.get("filing_year") or "",
        "filing_period": payload.get("filing_period") or "年度",
        "retention_period": payload.get("retention_period") or "长期",
        "is_required": bool(payload.get("is_required", False)),
        "required_rule_source": payload.get("required_rule_source") or "",
        "filing_status": payload.get("filing_status") or "unfiled",
        "effective_date": payload.get("effective_date") or "",
        "expiry_date": payload.get("expiry_date") or "",
        "ai_enabled": bool(payload.get("ai_enabled", False)),
        "ai_usage_scope": payload.get("ai_usage_scope") or "archive_only",
        "knowledge_sync_status": payload.get("knowledge_sync_status") or ("pending" if payload.get("ai_enabled") else "disabled"),
        "knowledge_source_type": payload.get("knowledge_source_type") or "archive_doc",
        "knowledge_dataset_key": payload.get("knowledge_dataset_key") or "",
        "retrieval_priority": int(payload.get("retrieval_priority") or 50),
        "redaction_required": bool(payload.get("redaction_required", False)),
        "redaction_status": payload.get("redaction_status") or ("pending" if payload.get("redaction_required") else "not_required"),
        "ai_summary_enabled": bool(payload.get("ai_summary_enabled", False)),
        "ai_summary_template": payload.get("ai_summary_template") or "",
        "ai_keywords_enabled": bool(payload.get("ai_keywords_enabled", False)),
        "confidentiality_level": payload.get("confidentiality_level") or "internal",
        "access_scope_type": payload.get("access_scope_type") or "department",
        "access_scope_ids": list(payload.get("access_scope_ids") or [department_id]),
        "approval_flow_id": payload.get("approval_flow_id") or "",
        "archive_owner_id": payload.get("archive_owner_id") or payload.get("owner_id") or "",
        "review_owner_id": payload.get("review_owner_id") or "",
        "last_reviewed_at": payload.get("last_reviewed_at") or "",
        "ai_review_note": payload.get("ai_review_note") or "",
        "ai_block_reason": payload.get("ai_block_reason") or "",
        "compliance_status": payload.get("compliance_status") or "compliant",
    }


def _normalize_text(value: Any) -> str:
    return str(value or "").strip().lower()


_GOVERNANCE_REVIEW_LABELS = {
    "redaction_required": "脱敏要求",
    "redaction_status": "脱敏状态",
    "confidentiality_level": "密级",
    "filing_status": "归档状态",
    "ai_enabled": "AI 开关",
    "ai_usage_scope": "AI 用途",
    "knowledge_dataset_key": "知识库标识",
}


def _governance_recheck_reasons(before: dict[str, Any], after: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    for key, label in _GOVERNANCE_REVIEW_LABELS.items():
        if before.get(key) != after.get(key):
            reasons.append(f"{label}变更")
    return reasons


_TREE_ACTIONS = ["read", "upload", "delete", "metadata", "download"]


def _archive_tree_seed(
    catalogs: list[dict[str, Any]], catalog_items: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    now = _utc_now()
    nodes: list[dict[str, Any]] = [{
        "id": "archive-root",
        "parent_id": "",
        "node_type": "root",
        "name": "档案目录",
        "scope_id": "",
        "catalog_id": "",
        "catalog_item_id": "",
        "required": False,
        "archive_status": "unfiled",
        "archive_period": "年度",
        "retention_period": "长期",
        "owner_role_id": "role-admin",
        "reviewer_role_id": "role-admin",
        "ai_enabled": True,
        "ai_priority_scope": False,
        "ai_summary_template": "请概括文档主题、关键要求和责任主体。",
        "template_name": "企业档案通用模板",
        "template_content": "# 企业档案\n\n- 文档名称：\n- 责任部门：\n- 归档年度：\n- 责任人：\n",
        "permission_mode": "override",
        "allowed_actions": list(_TREE_ACTIONS),
        "user_ids": [], "role_ids": [], "department_ids": [],
        "deny_user_ids": [], "deny_role_ids": [], "deny_department_ids": [],
        "sort_order": 0,
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }]
    for catalog in sorted(catalogs, key=lambda item: (item.get("sort_order", 0), item.get("name", ""))):
        org_id = f"tree-{catalog['id']}"
        scope_id = str(catalog.get("scope_id") or "")
        nodes.append({
            "id": org_id, "parent_id": "archive-root", "node_type": "organization",
            "name": catalog.get("scope_name") or catalog.get("name") or scope_id,
            "scope_id": scope_id, "catalog_id": catalog.get("id", ""), "catalog_item_id": "",
            "required": False, "archive_status": "unfiled", "archive_period": "年度", "retention_period": "长期",
            "owner_role_id": "role-editor", "reviewer_role_id": "role-admin",
            "ai_enabled": True, "ai_priority_scope": False,
            "ai_summary_template": "请按部门职责概括核心事项、时间要求和责任人。",
            "template_name": catalog.get("name", ""), "template_content": f"# {catalog.get('name', '归档模板')}\n\n{catalog.get('description', '')}\n",
            "permission_mode": "override", "allowed_actions": list(_TREE_ACTIONS),
            "user_ids": [], "role_ids": [], "department_ids": [scope_id] if scope_id else [],
            "deny_user_ids": [], "deny_role_ids": [], "deny_department_ids": [],
            "sort_order": int(catalog.get("sort_order") or 0), "status": "active",
            "created_at": now, "updated_at": now,
        })
        category_nodes: dict[str, str] = {}
        items = [item for item in catalog_items if str(item.get("catalog_id")) == str(catalog.get("id"))]
        for item in sorted(items, key=lambda row: (row.get("sort_order", 0), row.get("category", ""))):
            category = str(item.get("category") or item.get("document_name_rule") or "未分类")
            category_key = _safe_filename(category).lower()
            category_id = category_nodes.get(category_key)
            if not category_id:
                category_id = f"tree-category-{catalog['id']}-{hashlib.sha1(category.encode('utf-8')).hexdigest()[:8]}"
                category_nodes[category_key] = category_id
                nodes.append({
                    "id": category_id, "parent_id": org_id, "node_type": "category", "name": category,
                    "scope_id": scope_id, "catalog_id": catalog.get("id", ""), "catalog_item_id": "",
                    "required": bool(item.get("required")), "archive_status": "unfiled",
                    "archive_period": item.get("archive_period") or "年度", "retention_period": item.get("retention_policy") or "长期",
                    "owner_role_id": "role-editor", "reviewer_role_id": "role-admin",
                    "ai_enabled": bool(item.get("default_ai_enabled")), "ai_priority_scope": False,
                    "ai_summary_template": "请提取文档的业务事项、执行步骤和责任主体。",
                    "template_name": item.get("document_name_rule", ""), "template_content": f"# {item.get('document_name_rule', category)}\n\n{item.get('document_description', '')}\n",
                    "permission_mode": "inherit", "allowed_actions": list(_TREE_ACTIONS),
                    "user_ids": [], "role_ids": [], "department_ids": [],
                    "deny_user_ids": [], "deny_role_ids": [], "deny_department_ids": [],
                    "sort_order": int(item.get("sort_order") or 0), "status": "active", "created_at": now, "updated_at": now,
                })
            subcategory = str(item.get("subcategory") or "").strip()
            if subcategory and _normalize_text(subcategory) != _normalize_text(category):
                leaf_id = f"tree-item-{item['id']}"
                nodes.append({
                    "id": leaf_id, "parent_id": category_id, "node_type": "category", "name": subcategory,
                    "scope_id": scope_id, "catalog_id": catalog.get("id", ""), "catalog_item_id": item.get("id", ""),
                    "required": bool(item.get("required")), "archive_status": "unfiled",
                    "archive_period": item.get("archive_period") or "年度", "retention_period": item.get("retention_policy") or "长期",
                    "owner_role_id": "role-editor", "reviewer_role_id": "role-admin",
                    "ai_enabled": bool(item.get("default_ai_enabled")), "ai_priority_scope": False,
                    "ai_summary_template": "请提取文档的业务事项、执行步骤和责任主体。",
                    "template_name": item.get("document_name_rule", ""), "template_content": f"# {item.get('document_name_rule', subcategory)}\n\n{item.get('document_description', '')}\n",
                    "permission_mode": "inherit", "allowed_actions": list(_TREE_ACTIONS),
                    "user_ids": [], "role_ids": [], "department_ids": [],
                    "deny_user_ids": [], "deny_role_ids": [], "deny_department_ids": [],
                    "sort_order": int(item.get("sort_order") or 0), "status": "active", "created_at": now, "updated_at": now,
                })
            else:
                next(node for node in nodes if node["id"] == category_id)["catalog_item_id"] = item.get("id", "")
    return nodes


class ERPStore:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or _default_root()
        self.state_path = self.root / "state.json"
        self.documents_dir = self.root / "documents"
        self._lock = threading.Lock()

    @staticmethod
    def _sync_knowledge_record(doc: dict[str, Any], acl: dict[str, Any] | None = None) -> None:
        """Mirror ERP metadata into the relational RAG data plane.

        The JSON store remains the MVP compatibility source for the existing UI;
        the new relational store is the authoritative RAG metadata/chunk source.
        A temporary database outage must not lose an uploaded ERP document.
        """
        try:
            from app.knowledge_base import get_data_plane

            get_data_plane().sync_document(doc, acl)
        except Exception:
            logger.exception("Unable to mirror document %s to relational knowledge store", doc.get("id"))

    def ensure_layout(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.documents_dir.mkdir(parents=True, exist_ok=True)
        if not self.state_path.exists():
            self._write_state_unsafe(self._seed_state())
        else:
            state = self._read_state_unsafe()
            if self._migrate_state(state):
                self._write_state_unsafe(state)

    def _migrate_state(self, state: dict[str, Any]) -> bool:
        changed = False
        defaults = self._seed_state()
        settings = state.setdefault("settings", {})
        for key, value in defaults["settings"].items():
            if key not in settings:
                settings[key] = value
                changed = True
        if "org_nodes" not in state:
            state["org_nodes"] = defaults["org_nodes"]
            changed = True
        if "archive_catalogs" not in state:
            state["archive_catalogs"] = defaults["archive_catalogs"]
            changed = True
        if "archive_catalog_items" not in state:
            state["archive_catalog_items"] = defaults["archive_catalog_items"]
            changed = True
        if "archive_tree_nodes" not in state:
            state["archive_tree_nodes"] = _archive_tree_seed(
                state.get("archive_catalogs", []), state.get("archive_catalog_items", [])
            )
            changed = True
        if "catalog_permissions" not in state:
            state["catalog_permissions"] = {}
            changed = True
        if "knowledge_dataset_mappings" not in state:
            state["knowledge_dataset_mappings"] = defaults["knowledge_dataset_mappings"]
            changed = True
        # Keep the archive taxonomy extensible without replacing user-created
        # departments or catalog templates in the file-backed store.
        for key in ("org_nodes", "departments", "archive_catalogs", "archive_catalog_items", "knowledge_dataset_mappings"):
            existing_ids = {str(item.get("id")) for item in state.get(key, []) if isinstance(item, dict)}
            for item in defaults.get(key, []):
                if str(item.get("id")) not in existing_ids:
                    state.setdefault(key, []).append(item)
                    existing_ids.add(str(item.get("id")))
                    changed = True
        # Dataset mappings were originally metadata-only. Add routing fields
        # without replacing mappings already configured on the server.
        for mapping in state.get("knowledge_dataset_mappings", []):
            if not isinstance(mapping, dict):
                continue
            defaults_by_key = {
                "dataset_id": "",
                "security_domain": str(mapping.get("scope_id") or "department"),
                "allowed_role_ids": [],
                "allowed_department_ids": [str(mapping.get("scope_id"))] if mapping.get("scope_id") else [],
            }
            for field, value in defaults_by_key.items():
                if field not in mapping:
                    mapping[field] = value
                    changed = True
            legacy_public_roles = {"role-admin", "role-editor", "role-viewer", "role-governance-approver"}
            if (
                str(mapping.get("security_domain") or "") == "public"
                and set(str(value) for value in (mapping.get("allowed_role_ids") or [])) == legacy_public_roles
            ):
                mapping["allowed_role_ids"] = []
                changed = True
        dify_defaults = {
            "dify_dataset_id": "",
            "dify_document_id": "",
            "dify_batch": "",
            "dify_sync_status": "not_synced",
            "dify_indexing_status": "",
            "dify_error": "",
            "dify_segment_count": 0,
            "last_synced_at": "",
            "last_dify_status_at": "",
            "original_path": "",
            "parse_status": "parsed",
            "parse_error": "",
            "parser": "",
            "source_type": "json",
            "vector_index_status": "pending",
            "vector_backend": "milvus",
            "vector_error": "",
        }
        for doc in state.get("documents", []):
            for key, value in dify_defaults.items():
                if key not in doc:
                    doc[key] = value
                    changed = True
            governance_defaults = _document_governance_defaults(doc)
            for key, value in governance_defaults.items():
                if key not in doc:
                    doc[key] = value
                    changed = True
            if "archive_tree_node_id" not in doc:
                catalog_ref = str(doc.get("archive_catalog_id") or "")
                matched_node = next(
                    (
                        node for node in state.get("archive_tree_nodes", [])
                        if str(node.get("catalog_item_id") or "") == catalog_ref
                    ),
                    None,
                )
                doc["archive_tree_node_id"] = str((matched_node or {}).get("id") or "")
                changed = True
            permissions = state.setdefault("permissions", {}).setdefault(doc["id"], {})
            for key, value in {
                "user_ids": [], "role_ids": [], "department_ids": [], "catalog_ids": [],
                "deny_user_ids": [], "deny_role_ids": [], "deny_department_ids": [], "download_enabled": False,
            }.items():
                if key not in permissions:
                    permissions[key] = value
                    changed = True
        for role in state.get("roles", []):
            if role.get("id") == "role-admin" and "*" not in role.get("permissions", []):
                role["permissions"] = ["*"]
                changed = True
        existing_role_ids = {role.get("id") for role in state.get("roles", [])}
        for role in defaults.get("roles", []):
            if role.get("id") not in existing_role_ids:
                state.setdefault("roles", []).append(role)
                changed = True
        if "scene_sessions" not in state:
            state["scene_sessions"] = []
            changed = True
        if "approvals" not in state:
            state["approvals"] = []
            changed = True
        if "ai_review_records" not in state:
            state["ai_review_records"] = []
            changed = True
        return changed

    def _seed_state(self) -> dict[str, Any]:
        now = _utc_now()
        org_nodes = [
            {"id": "org-hq", "name": "集团总部", "parent_id": "", "path": "/集团总部"},
            {"id": "dept-ops", "name": "运营管理部", "parent_id": "org-hq", "path": "/集团总部/运营管理部"},
            {"id": "dept-finance", "name": "财务部", "parent_id": "org-hq", "path": "/集团总部/财务部"},
            {"id": "dept-hr", "name": "人力资源部", "parent_id": "org-hq", "path": "/集团总部/人力资源部"},
            {"id": "dept-legal", "name": "法务合规部", "parent_id": "org-hq", "path": "/集团总部/法务合规部"},
            {"id": "dept-admin", "name": "综合管理部", "parent_id": "org-hq", "path": "/集团总部/综合管理部"},
            {"id": "dept-safety", "name": "安全生产部", "parent_id": "org-hq", "path": "/集团总部/安全生产部"},
            {"id": "dept-engineering", "name": "工程技术部", "parent_id": "org-hq", "path": "/集团总部/工程技术部"},
            {"id": "dept-information", "name": "信息化管理部", "parent_id": "org-hq", "path": "/集团总部/信息化管理部"},
        ]
        archive_catalogs = [
            {
                "id": "archive-catalog-finance",
                "scope_type": "department",
                "scope_id": "dept-finance",
                "scope_name": "财务部",
                "name": "财务归档模板",
                "description": "财务部年度制度、审批与凭证归档模板。",
                "status": "active",
                "sort_order": 10,
            },
            {
                "id": "archive-catalog-ops",
                "scope_type": "department",
                "scope_id": "dept-ops",
                "scope_name": "运营管理部",
                "name": "运营归档模板",
                "description": "运营流程与 SOP 归档模板。",
                "status": "active",
                "sort_order": 20,
            },
            {
                "id": "archive-catalog-hr",
                "scope_type": "department",
                "scope_id": "dept-hr",
                "scope_name": "人力资源部",
                "name": "人事归档模板",
                "description": "人事制度、台账与敏感档案归档模板。",
                "status": "active",
                "sort_order": 30,
            },
            {"id": "archive-catalog-hq", "scope_type": "org", "scope_id": "org-hq", "scope_name": "集团总部", "name": "集团总部综合档案", "description": "集团制度、公文与跨部门通用档案。", "status": "active", "sort_order": 0},
            {"id": "archive-catalog-legal", "scope_type": "department", "scope_id": "dept-legal", "scope_name": "法务合规部", "name": "法务合规归档模板", "description": "合同、印章与合规审批材料。", "status": "active", "sort_order": 40},
            {"id": "archive-catalog-admin", "scope_type": "department", "scope_id": "dept-admin", "scope_name": "综合管理部", "name": "综合管理归档模板", "description": "会议、用车、公文与流程材料。", "status": "active", "sort_order": 50},
            {"id": "archive-catalog-safety", "scope_type": "department", "scope_id": "dept-safety", "scope_name": "安全生产部", "name": "安全生产归档模板", "description": "施工安全、车辆和设备管理材料。", "status": "active", "sort_order": 60},
            {"id": "archive-catalog-engineering", "scope_type": "department", "scope_id": "dept-engineering", "scope_name": "工程技术部", "name": "工程技术归档模板", "description": "工程项目与技术资料。", "status": "active", "sort_order": 70},
            {"id": "archive-catalog-information", "scope_type": "department", "scope_id": "dept-information", "scope_name": "信息化管理部", "name": "信息化归档模板", "description": "OA、企业邮箱与信息系统资料。", "status": "active", "sort_order": 80},
        ]
        archive_catalog_items = [
            {
                "id": "catalog-finance-policy",
                "catalog_id": "archive-catalog-finance",
                "scope_type": "department",
                "scope_id": "dept-finance",
                "scope_name": "财务部",
                "category": "制度",
                "subcategory": "财务制度",
                "document_name_rule": "年度财务制度文件",
                "document_description": "财务部年度制度、流程与审批规范归档项。",
                "required": True,
                "archive_period": "年度",
                "retention_policy": "长期",
                "default_visibility": "department",
                "default_ai_enabled": True,
                "default_ai_usage_type": "ai_answer",
                "ai_allowed": True,
                "matching_rule": "title contains 制度",
                "owner_role": "文档编辑",
                "sort_order": 10,
                "status": "active",
            },
            {
                "id": "catalog-ops-sop",
                "catalog_id": "archive-catalog-ops",
                "scope_type": "department",
                "scope_id": "dept-ops",
                "scope_name": "运营管理部",
                "category": "流程",
                "subcategory": "SOP",
                "document_name_rule": "运营流程SOP",
                "document_description": "运营部流程与操作指引归档项。",
                "required": True,
                "archive_period": "年度",
                "retention_policy": "长期",
                "default_visibility": "department",
                "default_ai_enabled": True,
                "default_ai_usage_type": "ai_search",
                "ai_allowed": True,
                "matching_rule": "category equals 流程",
                "owner_role": "文档编辑",
                "sort_order": 20,
                "status": "active",
            },
            {
                "id": "catalog-hr-record",
                "catalog_id": "archive-catalog-hr",
                "scope_type": "department",
                "scope_id": "dept-hr",
                "scope_name": "人力资源部",
                "category": "人事档案",
                "subcategory": "内部档案",
                "document_name_rule": "内部人事制度与表单",
                "document_description": "人力资源制度与模板管理。",
                "required": False,
                "archive_period": "长期",
                "retention_policy": "长期",
                "default_visibility": "private",
                "default_ai_enabled": False,
                "default_ai_usage_type": "archive_only",
                "ai_allowed": False,
                "matching_rule": "confidentiality_level == sensitive",
                "owner_role": "管理员",
                "sort_order": 30,
                "status": "active",
            },
            {"id": "catalog-hq-general", "catalog_id": "archive-catalog-hq", "scope_type": "org", "scope_id": "org-hq", "scope_name": "集团总部", "category": "综合档案", "subcategory": "集团制度与公文", "document_name_rule": "集团总部通用制度与公文", "document_description": "集团级制度、公文和跨部门通用材料。", "required": False, "archive_period": "年度", "retention_policy": "永久", "default_visibility": "department", "default_ai_enabled": True, "default_ai_usage_type": "ai_search", "ai_allowed": True, "matching_rule": "scope equals org-hq", "owner_role": "管理员", "sort_order": 10, "status": "active"},
            {"id": "catalog-legal-contract", "catalog_id": "archive-catalog-legal", "scope_type": "department", "scope_id": "dept-legal", "scope_name": "法务合规部", "category": "合同与印章", "subcategory": "审批材料", "document_name_rule": "合同、印章与合规审批材料", "document_description": "合同审批表、印章申请与法务制度。", "required": True, "archive_period": "年度", "retention_policy": "长期", "default_visibility": "department", "default_ai_enabled": True, "default_ai_usage_type": "ai_answer", "ai_allowed": True, "matching_rule": "title contains 合同 or 印章", "owner_role": "文档编辑", "sort_order": 40, "status": "active"},
            {"id": "catalog-admin-process", "catalog_id": "archive-catalog-admin", "scope_type": "department", "scope_id": "dept-admin", "scope_name": "综合管理部", "category": "行政流程", "subcategory": "申请与公文", "document_name_rule": "会议、用车、发文与流程材料", "document_description": "综合管理部日常申请和流程文件。", "required": False, "archive_period": "年度", "retention_policy": "长期", "default_visibility": "department", "default_ai_enabled": True, "default_ai_usage_type": "ai_search", "ai_allowed": True, "matching_rule": "title contains 会议 or 用车 or 流程", "owner_role": "文档编辑", "sort_order": 50, "status": "active"},
            {"id": "catalog-safety-rules", "catalog_id": "archive-catalog-safety", "scope_type": "department", "scope_id": "dept-safety", "scope_name": "安全生产部", "category": "安全生产", "subcategory": "制度与培训", "document_name_rule": "安全、施工、车辆与设备管理制度", "document_description": "铁路工务、施工安全、车辆和养路机械资料。", "required": True, "archive_period": "年度", "retention_policy": "长期", "default_visibility": "department", "default_ai_enabled": True, "default_ai_usage_type": "ai_answer", "ai_allowed": True, "matching_rule": "title contains 安全 or 施工 or 车辆", "owner_role": "文档编辑", "sort_order": 60, "status": "active"},
            {"id": "catalog-information-system", "catalog_id": "archive-catalog-information", "scope_type": "department", "scope_id": "dept-information", "scope_name": "信息化管理部", "category": "信息系统", "subcategory": "OA 与邮箱", "document_name_rule": "OA、企业邮箱与信息系统规范", "document_description": "信息系统使用、管理和运维资料。", "required": False, "archive_period": "年度", "retention_policy": "长期", "default_visibility": "department", "default_ai_enabled": True, "default_ai_usage_type": "ai_search", "ai_allowed": True, "matching_rule": "title contains OA or 邮箱 or 信息系统", "owner_role": "管理员", "sort_order": 80, "status": "active"},
        ]
        knowledge_dataset_mappings = [
            {
                "id": "dataset-map-public",
                "scope_type": "global",
                "scope_id": "",
                "scope_name": "全员公共知识",
                "archive_category": "",
                "document_type": "",
                "ai_usage_scope": "ai_search",
                "dataset_key": "public-kb",
                "dataset_name": "公共制度知识库",
                "dataset_id": "",
                "security_domain": "public",
                "allowed_role_ids": [],
                "allowed_department_ids": [],
                "enabled": True,
                "priority": 10,
                "note": "全员可访问的流程、用车、请假和发文制度",
            },
            {
                "id": "dataset-map-finance-policy",
                "scope_type": "department",
                "scope_id": "dept-finance",
                "scope_name": "财务部",
                "archive_category": "制度",
                "document_type": "通用文档",
                "ai_usage_scope": "ai_answer",
                "dataset_key": "finance-policy-kb",
                "dataset_name": "财务制度知识库",
                "dataset_id": "",
                "security_domain": "finance",
                "allowed_role_ids": [],
                "allowed_department_ids": ["dept-finance"],
                "enabled": True,
                "priority": 100,
                "note": "财务制度默认进入财务知识库",
            },
            {
                "id": "dataset-map-ops-sop",
                "scope_type": "department",
                "scope_id": "dept-ops",
                "scope_name": "运营管理部",
                "archive_category": "流程",
                "document_type": "通用文档",
                "ai_usage_scope": "ai_search",
                "dataset_key": "ops-sop-kb",
                "dataset_name": "运营流程知识库",
                "dataset_id": "",
                "security_domain": "ops",
                "allowed_role_ids": [],
                "allowed_department_ids": ["dept-ops"],
                "enabled": True,
                "priority": 90,
                "note": "运营 SOP 默认进入流程检索库",
            },
        ]
        department_dataset_defaults = [
            ("dept-hr", "人力资源部", "hr-kb", "人力资源知识库"),
            ("dept-legal", "法务合规部", "legal-kb", "法务合规知识库"),
            ("dept-admin", "综合管理部", "admin-kb", "综合管理知识库"),
            ("dept-safety", "安全生产部", "safety-kb", "安全生产知识库"),
            ("dept-engineering", "工程技术部", "engineering-kb", "工程技术知识库"),
            ("dept-information", "信息化管理部", "information-kb", "信息化知识库"),
        ]
        for scope_id, scope_name, dataset_key, dataset_name in department_dataset_defaults:
            knowledge_dataset_mappings.append({
                "id": f"dataset-map-{scope_id}",
                "scope_type": "department",
                "scope_id": scope_id,
                "scope_name": scope_name,
                "archive_category": "",
                "document_type": "",
                "ai_usage_scope": "ai_search",
                "dataset_key": dataset_key,
                "dataset_name": dataset_name,
                "dataset_id": "",
                "security_domain": scope_id.removeprefix("dept-"),
                "allowed_role_ids": [],
                "allowed_department_ids": [scope_id],
                "enabled": True,
                "priority": 80,
                "note": f"{scope_name}部门资料默认进入本部门知识库",
            })
        knowledge_dataset_mappings.append({
            "id": "dataset-map-restricted",
            "scope_type": "global",
            "scope_id": "",
            "scope_name": "核心受限知识",
            "archive_category": "",
            "document_type": "",
            "ai_usage_scope": "ai_answer",
            "dataset_key": "restricted-kb",
            "dataset_name": "核心受限知识库",
            "dataset_id": "",
            "security_domain": "restricted",
            "allowed_role_ids": [],
            "allowed_department_ids": [],
            "enabled": True,
            "priority": 1000,
            "note": "默认仅管理员访问；负责人需由管理员显式加入角色或部门白名单",
        })
        archive_tree_nodes = _archive_tree_seed(archive_catalogs, archive_catalog_items)
        return {
            "version": _STATE_VERSION,
            "users": [
                {"id": "u-admin", "name": "系统管理员", "username": "admin", "role_id": "role-admin", "department_id": "dept-ops", "status": "active"},
                {"id": "u-ops", "name": "运维负责人", "username": "ops", "role_id": "role-editor", "department_id": "dept-ops", "status": "active"},
                {"id": "u-finance", "name": "财务专员", "username": "finance", "role_id": "role-viewer", "department_id": "dept-finance", "status": "active"},
            ],
            "roles": [
                {"id": "role-admin", "name": "管理员", "permissions": ["*"]},
                {"id": "role-editor", "name": "文档编辑", "permissions": ["document:read", "document:write", "document:index", "document:download", "permission:read", "archive:read", "archive:write", "archive:catalog:write", "archive:coverage:read", "ai-governance:read", "ai-governance:write"]},
                {"id": "role-viewer", "name": "只读成员", "permissions": ["document:read", "archive:read", "archive:coverage:read", "ai-governance:read"]},
                {"id": "role-governance-approver", "name": "治理审批人", "permissions": ["document:read", "archive:read", "archive:coverage:read", "ai-governance:read", "ai-governance:approve"]},
            ],
            "departments": [
                {"id": "dept-ops", "name": "运营管理部", "parent_id": "org-hq"},
                {"id": "dept-finance", "name": "财务部", "parent_id": "org-hq"},
                {"id": "dept-hr", "name": "人力资源部", "parent_id": "org-hq"},
                {"id": "dept-legal", "name": "法务合规部", "parent_id": "org-hq"},
                {"id": "dept-admin", "name": "综合管理部", "parent_id": "org-hq"},
                {"id": "dept-safety", "name": "安全生产部", "parent_id": "org-hq"},
                {"id": "dept-engineering", "name": "工程技术部", "parent_id": "org-hq"},
                {"id": "dept-information", "name": "信息化管理部", "parent_id": "org-hq"},
            ],
            "org_nodes": org_nodes,
            "archive_catalogs": archive_catalogs,
            "archive_catalog_items": archive_catalog_items,
            "archive_tree_nodes": archive_tree_nodes,
            "catalog_permissions": {},
            "knowledge_dataset_mappings": knowledge_dataset_mappings,
            "documents": [],
            "versions": {},
            "permissions": {},
            "ai_review_records": [],
            "scene_sessions": [],
            "approvals": [],
            "index_jobs": [],
            "audit_logs": [
                {"id": _new_id("log"), "actor": "system", "action": "system.seed", "target": "erp", "detail": "初始化 ERP 文档管理基础数据", "created_at": now}
            ],
            "settings": {
                "llm_provider": "reserved",
                "embedding_provider": "reserved",
                "dify_enabled": False,
                "dify_base_url": "",
                "dify_api_key": "",
                "dify_app_api_key": "",
                "dify_dataset_id": "",
                "dify_indexing_technique": "high_quality",
                "dify_process_rule_mode": "automatic",
                "dify_doc_form": "text_model",
                "dify_doc_language": "Chinese",
                "dify_timeout_seconds": 60,
                "dify_send_metadata": False,
                "watermark_enabled": False,
                "review_flow_enabled": False,
                "sensitive_scan_enabled": False,
                "ocr_enabled": False,
                "duplicate_detection_enabled": False,
                "scheduled_reindex": "manual",
            },
        }

    def _read_state_unsafe(self) -> dict[str, Any]:
        with open(self.state_path, encoding="utf-8") as f:
            return json.load(f)

    def _write_state_unsafe(self, data: dict[str, Any]) -> None:
        tmp = self.state_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(self.state_path)

    def _content_path(self, document_id: str, version: int, suffix: str = ".txt") -> Path:
        safe_id = "".join(ch for ch in document_id if ch.isalnum() or ch in "-_")
        folder = self.documents_dir / safe_id
        folder.mkdir(parents=True, exist_ok=True)
        return folder / f"v{version}{suffix}"

    def _original_path(self, document_id: str, version: int, file_name: str) -> Path:
        safe_id = "".join(ch for ch in document_id if ch.isalnum() or ch in "-_")
        folder = self.documents_dir / safe_id / "original"
        folder.mkdir(parents=True, exist_ok=True)
        return folder / f"v{version}_{_safe_filename(file_name)}"

    def _append_log(self, state: dict[str, Any], action: str, target: str, detail: str, actor: str = "admin") -> None:
        state.setdefault("audit_logs", []).insert(0, {
            "id": _new_id("log"),
            "actor": actor,
            "action": action,
            "target": target,
            "detail": detail,
            "created_at": _utc_now(),
        })
        state["audit_logs"] = state["audit_logs"][:300]

    def _write_document_content(self, doc: dict[str, Any], version: int, content_text: str, content_base64: str) -> tuple[str, int]:
        if content_text:
            path = self._content_path(doc["id"], version, ".txt")
            path.write_text(content_text, encoding="utf-8")
            return str(path.relative_to(self.root)), len(content_text.encode("utf-8"))
        if content_base64:
            path = self._content_path(doc["id"], version, ".bin")
            raw = base64.b64decode(content_base64.split(",")[-1])
            path.write_bytes(raw)
            return str(path.relative_to(self.root)), len(raw)
        path = self._content_path(doc["id"], version, ".txt")
        path.write_text("", encoding="utf-8")
        return str(path.relative_to(self.root)), 0

    def _read_content(self, relative_path: str) -> str:
        path = self.root / relative_path
        if not path.exists() or path.suffix == ".bin":
            return ""
        return path.read_text(encoding="utf-8")

    def _sign_token(self, payload: str) -> str:
        return hmac.new(
            _token_secret().encode("utf-8"),
            payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    def _make_token(self, user_id: str) -> tuple[str, str]:
        issued_at = int(time.time())
        expires_at = issued_at + _token_ttl_seconds()
        payload = json.dumps(
            {"user_id": user_id, "iat": issued_at, "exp": expires_at},
            separators=(",", ":"),
        )
        token_payload = base64.urlsafe_b64encode(payload.encode("utf-8")).decode("ascii").rstrip("=")
        signature = self._sign_token(token_payload)
        expires_at_iso = datetime.fromtimestamp(expires_at, tz=timezone.utc).replace(microsecond=0).isoformat()
        return f"{token_payload}.{signature}", expires_at_iso

    def issue_token(self, user_id: str) -> tuple[str, str]:
        return self._make_token(user_id)

    def _parse_token(self, token: str) -> dict[str, Any] | None:
        try:
            token_payload, signature = token.split(".", 1)
        except ValueError:
            return None
        if not hmac.compare_digest(signature, self._sign_token(token_payload)):
            return None
        padding = "=" * (-len(token_payload) % 4)
        try:
            payload = json.loads(base64.urlsafe_b64decode(f"{token_payload}{padding}").decode("utf-8"))
        except (ValueError, json.JSONDecodeError):
            return None
        exp = int(payload.get("exp", 0))
        if exp <= int(time.time()):
            return None
        return payload

    def authenticate(self, token: str) -> dict[str, Any] | None:
        payload = self._parse_token(token)
        if not payload:
            return None
        state = self.state()
        user = next(
            (
                candidate
                for candidate in state["users"]
                if candidate["id"] == payload.get("user_id") and candidate.get("status") == "active"
            ),
            None,
        )
        if user is None:
            return None
        item = self._enrich_user(user, state)
        item["token_expires_at"] = datetime.fromtimestamp(int(payload["exp"]), tz=timezone.utc).replace(microsecond=0).isoformat()
        return item

    def document_absolute_path(self, document_id: str) -> Path | None:
        state = self.state()
        doc = next(
            (
                d
                for d in state["documents"]
                if d["id"] == document_id and d.get("status") != "deleted"
            ),
            None,
        )
        if not doc:
            return None
        for key in ("original_path", "content_path"):
            relative_path = doc.get(key, "")
            if not relative_path:
                continue
            path = self.root / relative_path
            # Never expose an empty parser placeholder as a downloadable file.
            if path.is_file() and path.stat().st_size > 0:
                # For binary uploads, a parsed .txt file is not the original
                # attachment and must never be served with a .pdf/.docx name.
                if key == "content_path":
                    mime = str(doc.get("mime_type") or "").lower()
                    file_name = str(doc.get("file_name") or "").lower()
                    text_like = mime.startswith("text/") or mime in {"application/json", "application/markdown"} or file_name.endswith((".txt", ".md", ".csv", ".json"))
                    if not text_like:
                        continue
                return path
        return None

    def raw_settings(self) -> dict[str, Any]:
        state = self.state()
        return dict(state["settings"])

    def _user_context(self, state: dict[str, Any], user_id: str | None) -> dict[str, Any] | None:
        if not user_id:
            return None
        user = next((u for u in state["users"] if u["id"] == user_id), None)
        if not user:
            return None
        role = next((r for r in state["roles"] if r["id"] == user.get("role_id")), {})
        return {**user, "role": role, "is_admin": "*" in role.get("permissions", [])}

    def _role_permissions(self, state: dict[str, Any], user_id: str | None) -> set[str]:
        user = self._user_context(state, user_id)
        if not user:
            return set()
        return set(user.get("role", {}).get("permissions", []))

    def user_has_permission(self, user_id: str | None, permission: str) -> bool:
        if not user_id:
            return False
        state = self.state()
        perms = self._role_permissions(state, user_id)
        return "*" in perms or permission in perms

    def is_admin(self, user_id: str | None) -> bool:
        return self.user_has_permission(user_id, "*")

    def _validate_permission_subjects(self, state: dict[str, Any], payload: dict[str, Any]) -> None:
        """Reject stale ACL references before they become impossible to administer."""
        known_users = {str(row.get("id")) for row in state.get("users", [])}
        known_roles = {str(row.get("id")) for row in state.get("roles", [])}
        known_departments = {str(row.get("id")) for row in state.get("departments", [])}
        known_departments.update(str(row.get("id")) for row in state.get("org_nodes", []))
        checks = (("user_ids", known_users), ("deny_user_ids", known_users), ("role_ids", known_roles), ("deny_role_ids", known_roles), ("department_ids", known_departments), ("deny_department_ids", known_departments))
        for key, allowed in checks:
            invalid = [str(value) for value in (payload.get(key) or []) if str(value) not in allowed]
            if invalid:
                raise ValueError(f"{key} 包含不存在的权限主体: {', '.join(invalid)}")

    def explain_document_access(self, document_id: str, user_id: str | None, action: str = "read") -> dict[str, Any]:
        state = self.state()
        doc = next((row for row in state.get("documents", []) if str(row.get("id")) == str(document_id) and row.get("status") != "deleted"), None)
        base = {"allowed": False, "subject_type": "document", "subject_id": str(document_id), "action": action, "source": "", "reason": "", "required_capability": "", "matched_rules": [], "denied_by": None, "effective_scope": {}}
        if doc is None:
            base.update({"reason": "文档不存在或已删除", "denied_by": "document"})
            return base
        user = self._user_context(state, user_id)
        if user is None:
            base.update({"reason": "未登录或用户不存在", "denied_by": "authentication"})
            return base
        required = {"read": "document:read", "write": "document:write", "index": "document:index", "download": "document:download"}.get(action, "document:read")
        base["required_capability"] = required
        role_permissions = set(user.get("role", {}).get("permissions", []))
        if user.get("is_admin"):
            base.update({"allowed": True, "source": "admin", "reason": "管理员拥有全局访问权限", "matched_rules": ["管理员通配能力 *"]})
            return base
        if required not in role_permissions:
            base.update({"reason": f"当前角色缺少 {required}", "denied_by": "role_capability"})
            return base
        base["matched_rules"].append(f"角色能力: {required}")
        perms = state.get("permissions", {}).get(str(document_id), {})
        denied = ((user["id"] in perms.get("deny_user_ids", [])) or (user.get("role_id") in perms.get("deny_role_ids", [])) or (user.get("department_id") in perms.get("deny_department_ids", [])))
        if denied:
            base.update({"reason": "命中文档黑名单", "denied_by": "document_blacklist"})
            return base
        if doc.get("visibility", "department") == "public" and action != "download":
            base.update({"allowed": True, "source": "public", "reason": "公共文档对公司范围开放", "matched_rules": [*base["matched_rules"], "文档可见范围: public"]})
            return base
        tree_node_id = str(doc.get("archive_tree_node_id") or "")
        if tree_node_id:
            tree = self._archive_tree_node(state, tree_node_id)
            tree_action = "download" if action == "download" else "upload" if action in {"write", "index"} else "read"
            if tree is None or not self.can_user_access_archive_tree_node(state, tree, user_id, tree_action):
                base.update({"reason": "当前用户不属于规则树节点授权范围", "denied_by": "tree_node", "effective_scope": {"tree_node_id": tree_node_id}})
                return base
            base["matched_rules"].append(f"规则树节点授权: {tree_node_id}")
            base["effective_scope"]["tree_node_id"] = tree_node_id
        catalog = self._catalog_for_document(state, doc)
        if catalog and bool(state.get("catalog_permissions", {}).get(str(catalog.get("id")), {}).get("inherit_to_documents", True)):
            catalog_action = "download" if action == "download" else "write" if action in {"write", "index"} else "read"
            if not self.can_user_access_catalog(state, catalog, user_id, catalog_action):
                base.update({"reason": "当前用户不属于档案目录授权范围", "denied_by": "catalog", "effective_scope": {**base["effective_scope"], "catalog_id": catalog.get("id")}})
                return base
            base["matched_rules"].append(f"档案目录授权: {catalog.get('id')}")
            base["effective_scope"]["catalog_id"] = catalog.get("id")
        if action == "download" and not perms.get("download_enabled", False):
            base.update({"reason": "文档未授予下载权限", "denied_by": "download_policy"})
            return base
        if user["id"] in perms.get("user_ids", []):
            source, reason = "user", "用户直接授权"
        elif user.get("role_id") in perms.get("role_ids", []):
            source, reason = "role", "角色授权"
        elif user.get("department_id") in perms.get("department_ids", []):
            source, reason = "department", "部门授权"
        elif doc.get("owner_id") == user["id"] and action != "download":
            source, reason = "owner", "文档负责人"
        elif doc.get("visibility", "department") == "department" and (doc.get("department_id") == user.get("department_id") or doc.get("org_unit_id") == user.get("department_id")):
            source, reason = "department", "文档所属部门"
        elif doc.get("visibility") == "public" and action == "download":
            source, reason = "public-download", "公共文档且已单独授予下载权限"
        elif doc.get("visibility") == "role" and doc.get("role_id") == user.get("role_id"):
            source, reason = "role", "文档指定角色"
        else:
            base.update({"reason": "未命中文档、目录或规则树授权范围", "denied_by": "scope"})
            return base
        base.update({"allowed": True, "source": source, "reason": reason, "matched_rules": [*base["matched_rules"], reason], "effective_scope": {**base["effective_scope"], "department_id": doc.get("department_id")}})
        return base

    def explain_archive_tree_access(self, node_id: str, user_id: str | None, action: str = "read") -> dict[str, Any]:
        state = self.state()
        node = self._archive_tree_node(state, node_id)
        base = {"allowed": False, "subject_type": "archive_tree_node", "subject_id": str(node_id), "action": action, "source": "", "reason": "", "required_capability": "", "matched_rules": [], "denied_by": None, "effective_scope": {}}
        if node is None:
            base.update({"reason": "规则树节点不存在", "denied_by": "tree_node"})
            return base
        required = {"read": "archive:read", "upload": "document:write", "delete": "document:write", "metadata": "archive:catalog:write", "download": "document:download"}.get(action, "archive:read")
        base["required_capability"] = required
        user = self._user_context(state, user_id)
        if user is None:
            base.update({"reason": "未登录或用户不存在", "denied_by": "authentication"})
            return base
        if user.get("is_admin"):
            base.update({"allowed": True, "source": "admin", "reason": "管理员拥有全局目录权限", "matched_rules": ["管理员通配能力 *"]})
            return base
        if required not in set(user.get("role", {}).get("permissions", [])):
            base.update({"reason": f"当前角色缺少 {required}", "denied_by": "role_capability"})
            return base
        policy = self._archive_tree_effective_policy(state, node)
        base["effective_scope"] = {"source_node_id": policy.get("source_node_id"), "department_ids": policy.get("department_ids", []), "role_ids": policy.get("role_ids", []), "user_ids": policy.get("user_ids", [])}
        if action not in set(policy.get("allowed_actions") or []):
            base.update({"reason": "规则树未授予该操作", "denied_by": "allowed_actions"})
            return base
        if user["id"] in policy.get("deny_user_ids", []) or user.get("role_id") in policy.get("deny_role_ids", []) or user.get("department_id") in policy.get("deny_department_ids", []):
            base.update({"reason": "命中规则树黑名单", "denied_by": "tree_blacklist"})
            return base
        explicit = bool(policy.get("user_ids") or policy.get("role_ids") or policy.get("department_ids"))
        matched = user["id"] in policy.get("user_ids", []) or user.get("role_id") in policy.get("role_ids", []) or user.get("department_id") in policy.get("department_ids", [])
        if explicit and not matched:
            base.update({"reason": "未命中规则树白名单", "denied_by": "tree_whitelist"})
            return base
        if not explicit and node.get("scope_id") and str(node.get("scope_id")) != str(user.get("department_id")):
            base.update({"reason": "当前用户不属于节点组织范围", "denied_by": "tree_scope"})
            return base
        base.update({"allowed": True, "source": "tree_policy", "reason": "规则树策略允许该操作", "matched_rules": [f"规则树策略来源: {policy.get('source_node_id')}"]})
        return base

    def _catalog_for_document(self, state: dict[str, Any], doc: dict[str, Any]) -> dict[str, Any] | None:
        reference = str(doc.get("archive_catalog_id") or "")
        if not reference:
            return None
        catalog = next((item for item in state.get("archive_catalogs", []) if str(item.get("id")) == reference), None)
        if catalog:
            return catalog
        catalog_item = next((item for item in state.get("archive_catalog_items", []) if str(item.get("id")) == reference), None)
        if not catalog_item:
            return None
        return next((item for item in state.get("archive_catalogs", []) if str(item.get("id")) == str(catalog_item.get("catalog_id"))), None)

    def can_user_access_catalog(
        self,
        state: dict[str, Any],
        catalog: dict[str, Any],
        user_id: str | None,
        action: str = "read",
    ) -> bool:
        user = self._user_context(state, user_id)
        if user_id and user is None:
            return False
        if user is None or user.get("is_admin"):
            return True
        required_permission = {
            "read": "archive:read",
            "write": "archive:catalog:write",
            "coverage": "archive:coverage:read",
            "missing": "archive:write",
            "download": "document:download",
        }.get(action, "archive:read")
        role_permissions = set(user.get("role", {}).get("permissions", []))
        if required_permission not in role_permissions:
            return False
        policy = state.get("catalog_permissions", {}).get(str(catalog.get("id")), {})
        if user["id"] in policy.get("deny_user_ids", []) or user.get("role_id") in policy.get("deny_role_ids", []) or user.get("department_id") in policy.get("deny_department_ids", []):
            return False
        allowed_actions = set(policy.get("allowed_actions") or ["read", "write", "coverage", "missing", "download"])
        if action not in allowed_actions:
            return False
        explicit_subjects = bool(policy.get("user_ids") or policy.get("role_ids") or policy.get("department_ids"))
        if user["id"] in policy.get("user_ids", []) or user.get("role_id") in policy.get("role_ids", []) or user.get("department_id") in policy.get("department_ids", []):
            return True
        if explicit_subjects:
            return False
        return str(catalog.get("scope_id") or "") == str(user.get("department_id") or "")

    def catalog_accessible_scope_ids(self, user_id: str | None, action: str = "read") -> set[str]:
        state = self.state()
        return {
            str(catalog.get("scope_id") or "")
            for catalog in state.get("archive_catalogs", [])
            if catalog.get("status") == "active" and self.can_user_access_catalog(state, catalog, user_id, action)
        }

    def can_user_access_document(
        self, state: dict[str, Any], doc: dict[str, Any], user_id: str | None, action: str = "read"
    ) -> bool:
        user = self._user_context(state, user_id)
        if user_id and user is None:
            return False
        if user is None:
            return True
        if user["is_admin"]:
            return True
        required_permission = {
            "read": "document:read",
            "write": "document:write",
            "index": "document:index",
            "download": "document:download",
        }.get(action, "document:read")
        role_permissions = set(user.get("role", {}).get("permissions", []))
        if required_permission not in role_permissions:
            return False
        perms = state.get("permissions", {}).get(
            doc["id"], {"user_ids": [], "role_ids": [], "department_ids": [], "catalog_ids": [], "deny_user_ids": [], "deny_role_ids": [], "deny_department_ids": [], "download_enabled": False}
        )
        if user["id"] in perms.get("deny_user_ids", []) or user.get("role_id") in perms.get("deny_role_ids", []) or user.get("department_id") in perms.get("deny_department_ids", []):
            return False
        # Public documents are company-wide after the role capability check.
        # Their visibility must not be narrowed by a legacy catalog/tree scope.
        if doc.get("visibility", "department") == "public" and action != "download":
            return True
        tree_allows = False
        tree_node_id = str(doc.get("archive_tree_node_id") or "")
        if tree_node_id:
            tree_node = self._archive_tree_node(state, tree_node_id)
            tree_action = "download" if action == "download" else "upload" if action in {"write", "index"} else "read"
            if tree_node is None or not self.can_user_access_archive_tree_node(state, tree_node, user_id, tree_action):
                return False
            tree_allows = True
        catalog = self._catalog_for_document(state, doc)
        catalog_allows = False
        if catalog and bool(state.get("catalog_permissions", {}).get(str(catalog.get("id")), {}).get("inherit_to_documents", True)):
            catalog_action = "download" if action == "download" else "write" if action in {"write", "index"} else "read"
            catalog_allows = self.can_user_access_catalog(state, catalog, user_id, catalog_action)
            if not catalog_allows:
                return False
        if action == "download" and not perms.get("download_enabled", False):
            return False
        if doc.get("owner_id") == user["id"] and action != "download":
            return True
        if user["id"] in perms.get("user_ids", []):
            return True
        if user.get("role_id") in perms.get("role_ids", []):
            return True
        if user.get("department_id") in perms.get("department_ids", []):
            return True
        if doc.get("archive_catalog_id") and doc.get("archive_catalog_id") in perms.get("catalog_ids", []):
            return True
        if catalog_allows:
            return True
        if tree_allows:
            return True
        visibility = doc.get("visibility", "department")
        if visibility == "public":
            return True
        if visibility == "department":
            return doc.get("department_id") == user.get("department_id") or doc.get("org_unit_id") == user.get("department_id")
        if visibility == "role":
            return doc.get("role_id", "") == user.get("role_id")
        if visibility == "private":
            return False
        if visibility == "admin":
            return False
        return False

    def visible_dify_document_ids(self, user_id: str | None) -> set[str]:
        state = self.state()
        visible: set[str] = set()
        for doc in state.get("documents", []):
            if doc.get("status") == "deleted":
                continue
            if self.can_user_access_document(state, doc, user_id):
                dify_id = doc.get("dify_document_id")
                if dify_id:
                    visible.add(dify_id)
        return visible

    def state(self) -> dict[str, Any]:
        with self._lock:
            self.ensure_layout()
            return self._read_state_unsafe()

    def login(self, username: str, password: str) -> dict[str, Any] | None:
        if not password:
            return None
        state = self.state()
        for user in state["users"]:
            if user["username"] == username and user.get("status") == "active":
                token, expires_at = self._make_token(user["id"])
                return {"token": token, "expires_at": expires_at, "user": self._enrich_user(user, state)}
        return None

    def _enrich_user(self, user: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
        role = next((r for r in state["roles"] if r["id"] == user.get("role_id")), {})
        dept = next((d for d in state["departments"] if d["id"] == user.get("department_id")), {})
        item = dict(user)
        item["role_name"] = role.get("name", "")
        item["department_name"] = dept.get("name", "")
        return item

    def _settings_view(self, state: dict[str, Any], user_id: str | None) -> dict[str, Any]:
        settings = dict(state["settings"])
        if self.is_admin(user_id):
            return settings
        for key in _SENSITIVE_SETTINGS:
            if key in settings:
                settings[key] = ""
        return settings

    def reference_data(self, user_id: str | None = None) -> dict[str, Any]:
        state = self.state()
        return {
            "users": [self._enrich_user(u, state) for u in state["users"]],
            "roles": state["roles"],
            "departments": state["departments"],
            "settings": self._settings_view(state, user_id),
            "capabilities": self.capabilities(),
        }

    def _org_tree(self, state: dict[str, Any]) -> list[dict[str, Any]]:
        nodes = state.get("org_nodes", [])
        def build(parent: str) -> list[dict[str, Any]]:
            result = []
            for node in nodes:
                if str(node.get("parent_id") or "") != parent:
                    continue
                result.append({"id": node.get("id"), "name": node.get("name"), "type": "department" if str(node.get("id", "")).startswith("dept-") else "org", "children": build(str(node.get("id")))})
            return result
        return build("")

    def menu_permissions(self, permissions: list[str] | set[str]) -> dict[str, bool]:
        granted = set(permissions)
        admin = "*" in granted
        return {"dashboard": True, "assistant": admin or "document:read" in granted, "contracts": admin or "document:read" in granted, "dev-mgmt": admin, "knowledge": admin or "document:read" in granted, "knowledge-index": admin or "document:index" in granted, "archive": admin or "archive:read" in granted, "archive-write": admin or "archive:write" in granted, "archive-catalog": admin or "archive:catalog:write" in granted, "archive-coverage": admin or "archive:coverage:read" in granted, "archive-missing": admin or "archive:write" in granted, "oa-approval": admin or "ai-governance:approve" in granted, "permissions": admin, "settings": admin}

    def access_context(self, user_id: str) -> dict[str, Any]:
        state = self.state()
        user = self._user_context(state, user_id) or {}
        role = user.get("role", {})
        permissions = sorted(set(role.get("permissions", [])))
        visible_scope_ids = self.catalog_accessible_scope_ids(user_id, "read") if user else set()
        departments = state.get("departments", []) if self.is_admin(user_id) else [
            dept for dept in state.get("departments", []) if str(dept.get("id")) in visible_scope_ids
        ]
        return {"user": self._enrich_user(user, state) if user else {}, "role": role, "permissions": permissions, "departments": departments, "org_tree": self.org_tree(user_id), "capabilities": self.capabilities(), "menu_permissions": self.menu_permissions(permissions)}

    def permission_tree(self, user_id: str) -> list[dict[str, Any]]:
        state = self.state()
        docs = [self._enrich_document(d, state, include_content=True) for d in state.get("documents", []) if d.get("status") != "deleted"]
        if not self.is_admin(user_id):
            docs = [d for d in docs if self.can_user_access_document(state, d, user_id)]
        def leaf(key: str, title: str, children: list[dict[str, Any]] | None = None) -> dict[str, Any]:
            return {"key": key, "title": title, "children": children or []}
        org = [leaf(f"department:{d['id']}", d.get("name", "")) for d in state.get("departments", [])]
        roles = []
        for role in state.get("roles", []):
            node = leaf(f"role:{role['id']}", role.get("name", ""), [leaf(f"permission:{p}", p) for p in role.get("permissions", [])])
            node["data"] = {"role_permissions": list(role.get("permissions", []))}
            roles.append(node)
        users = [leaf(f"user:{u['id']}", f"{u.get('name', '')} · {u.get('username', '')}") for u in state.get("users", [])]
        catalogs = []
        for catalog in state.get("archive_catalogs", []):
            policy = state.get("catalog_permissions", {}).get(catalog.get("id"), {})
            node = leaf(f"catalog:{catalog['id']}", f"{catalog.get('scope_name', '')} · {catalog.get('name', '')}", [
                leaf(f"catalog:{catalog['id']}:actions", f"操作：{', '.join(policy.get('allowed_actions') or ['read', 'write', 'coverage', 'missing', 'download'])}"),
                leaf(f"catalog:{catalog['id']}:subjects", f"授权主体：{len(policy.get('user_ids', [])) + len(policy.get('role_ids', [])) + len(policy.get('department_ids', []))}"),
                leaf(f"catalog:{catalog['id']}:deny", f"黑名单：{len(policy.get('deny_user_ids', [])) + len(policy.get('deny_role_ids', [])) + len(policy.get('deny_department_ids', []))}"),
                leaf(f"catalog:{catalog['id']}:inherit", f"继承文档：{'是' if policy.get('inherit_to_documents', True) else '否'}"),
            ])
            node["data"] = {"scope_id": catalog.get("scope_id", ""), "permissions": policy}
            catalogs.append(node)
        knowledge = [leaf("knowledge:dify", "Dify 数据集"), leaf("knowledge:index", "本地索引"), leaf("knowledge:filter", "Dify 知识过滤")]
        doc_nodes = []
        for doc in docs:
            p = state.get("permissions", {}).get(doc["id"], {})
            children = [leaf(f"document:{doc['id']}:department", f"所属部门：{doc.get('department_name', '')}"), leaf(f"document:{doc['id']}:visibility", f"可见范围：{doc.get('visibility', 'department')}"), leaf(f"document:{doc['id']}:roles", f"允许角色：{len(p.get('role_ids', []))}"), leaf(f"document:{doc['id']}:users", f"允许用户：{len(p.get('user_ids', []))}"), leaf(f"document:{doc['id']}:deny", f"黑名单：{len(p.get('deny_user_ids', [])) + len(p.get('deny_role_ids', [])) + len(p.get('deny_department_ids', []))}"), leaf(f"document:{doc['id']}:download", f"下载：{'允许' if p.get('download_enabled') else '禁止'}")]
            doc_nodes.append(leaf(f"document:{doc['id']}", doc.get("title", ""), children))
        return [leaf("root:org", "组织与部门", org), leaf("root:roles", "角色与权限", roles), leaf("root:users", "用户", users), leaf("root:catalogs", "档案目录", catalogs), leaf("root:knowledge", "知识库与过滤", knowledge), leaf("root:documents", "文档", doc_nodes)]

    def update_role_permissions(self, role_id: str, permissions: list[str], actor: str = "admin") -> dict[str, Any] | None:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            idx = next((i for i, role in enumerate(state.get("roles", [])) if str(role.get("id")) == str(role_id)), -1)
            if idx < 0:
                return None
            role = dict(state["roles"][idx])
            # The built-in administrator role remains the recovery account and
            # cannot accidentally lose its wildcard permission.
            role["permissions"] = ["*"] if "*" in role.get("permissions", []) else sorted({str(item).strip() for item in permissions if str(item).strip() and item != "*"})
            state["roles"][idx] = role
            self._append_log(state, "role.permission.update", role_id, f"更新角色《{role.get('name', '')}》能力", actor=actor)
            self._write_state_unsafe(state)
            return role

    def capabilities(self) -> list[dict[str, str]]:
        return [
            {"key": "versioning", "name": "文档版本管理", "status": "mvp", "note": "已记录版本历史，后续可加入差异对比"},
            {"key": "preview", "name": "文档预览", "status": "mvp", "note": "文本类文件可预览，PDF/Office 预留解析器"},
            {"key": "online_edit", "name": "文档在线编辑", "status": "reserved", "note": "预留编辑器入口"},
            {"key": "batch_upload", "name": "批量上传", "status": "reserved", "note": "前端已预留批量操作区"},
            {"key": "batch_permission", "name": "批量权限设置", "status": "reserved", "note": "权限模型已独立"},
            {"key": "review_flow", "name": "文档审核流", "status": "reserved", "note": "系统设置中可见开关"},
            {"key": "archive_trash", "name": "归档与回收站", "status": "mvp", "note": "支持归档/删除状态"},
            {"key": "download_permission", "name": "文档下载权限", "status": "reserved", "note": "权限表可扩展 download 权限"},
            {"key": "watermark", "name": "水印", "status": "reserved", "note": "系统设置中可见开关"},
            {"key": "audit", "name": "操作日志", "status": "mvp", "note": "核心操作已写审计日志"},
            {"key": "sensitive_scan", "name": "敏感词扫描", "status": "reserved", "note": "预留任务入口"},
            {"key": "duplicate_detection", "name": "重复文档检测", "status": "reserved", "note": "可基于 hash/embedding 扩展"},
            {"key": "ocr", "name": "OCR 识别", "status": "reserved", "note": "预留解析器入口"},
            {"key": "auto_summary", "name": "自动摘要", "status": "reserved", "note": "LLM 接入后启用"},
            {"key": "auto_tags", "name": "自动标签", "status": "reserved", "note": "LLM 接入后启用"},
            {"key": "quality_score", "name": "知识库质量评分", "status": "reserved", "note": "预留评分字段"},
            {"key": "index_retry", "name": "索引失败重试", "status": "mvp", "note": "支持重新索引动作"},
            {"key": "scheduled_reindex", "name": "定时重建索引", "status": "reserved", "note": "系统设置中预留策略"},
        ]

    def dashboard(self, user_id: str | None = None) -> dict[str, Any]:
        state = self.state()
        docs = [d for d in state["documents"] if d.get("status") != "deleted"]
        if user_id:
            docs = [d for d in docs if self.can_user_access_document(state, d, user_id)]
        status_counts: dict[str, int] = {}
        for doc in docs:
            status_counts[doc["status"]] = status_counts.get(doc["status"], 0) + 1
        return {
            "totals": {
                "documents": len(docs),
                "users": len(state["users"]) if not user_id or self.is_admin(user_id) else 1,
                "roles": len(state["roles"]) if not user_id or self.is_admin(user_id) else 1,
                "departments": len(state["departments"]) if not user_id or self.is_admin(user_id) else len(self.catalog_accessible_scope_ids(user_id, "read")),
            },
            "index_health": status_counts,
            "recent_documents": docs[:6],
            "recent_audit_logs": state["audit_logs"][:8] if not user_id or self.is_admin(user_id) else [
                log for log in state["audit_logs"] if log.get("actor") == user_id or log.get("target") in {doc.get("id") for doc in docs}
            ][:8],
            "roadmap": self.capabilities(),
        }

    def list_documents(self, filters: dict[str, str], user_id: str | None = None) -> dict[str, Any]:
        state = self.state()
        docs = [self._enrich_document(d, state, include_content=False) for d in state["documents"]]
        docs = [d for d in docs if d.get("status") != "deleted"]
        docs = [d for d in docs if self.can_user_access_document(state, d, user_id)]
        q = filters.get("q", "").strip().lower()
        if q:
            docs = [d for d in docs if q in d["title"].lower() or q in d["file_name"].lower() or q in " ".join(d.get("tags", [])).lower()]
        for key in ["category", "owner_id", "department_id", "status", "visibility"]:
            value = filters.get(key, "").strip()
            if value:
                docs = [d for d in docs if str(d.get(key, "")) == value]
        tag = filters.get("tag", "").strip()
        if tag:
            docs = [d for d in docs if tag in d.get("tags", [])]
        return {"documents": docs, "total": len(docs), "filters": self.document_filters(state)}

    def document_filters(self, state: dict[str, Any]) -> dict[str, list[str]]:
        docs = [d for d in state["documents"] if d.get("status") != "deleted"]
        tags = sorted({tag for d in docs for tag in d.get("tags", [])})
        return {
            "categories": sorted({d.get("category", "General") for d in docs}),
            "tags": tags,
            "statuses": ["uploaded", "indexing", "indexed", "failed", "archived"],
            "visibilities": ["public", "department", "role", "private", "admin"],
            "archive_categories": sorted({d.get("archive_category", "") for d in docs if d.get("archive_category")}),
            "document_types": sorted({d.get("document_type", "") for d in docs if d.get("document_type")}),
            "filing_years": sorted({d.get("filing_year", "") for d in docs if d.get("filing_year")}),
            "filing_statuses": ["unfiled", "filed", "pending", "void"],
            "knowledge_sync_statuses": ["disabled", "pending", "synced", "failed"],
            "confidentiality_levels": ["public", "internal", "department", "sensitive", "restricted"],
        }

    def _enrich_document(self, doc: dict[str, Any], state: dict[str, Any], include_content: bool) -> dict[str, Any]:
        owner = next((u for u in state["users"] if u["id"] == doc.get("owner_id")), {})
        dept = next((d for d in state["departments"] if d["id"] == doc.get("department_id")), {})
        item = dict(doc)
        item["owner_name"] = owner.get("name", "")
        item["department_name"] = dept.get("name", "")
        item["version_count"] = len(state.get("versions", {}).get(doc["id"], []))
        if include_content:
            item["content_text"] = self._read_content(doc.get("content_path", ""))
            item["permissions"] = state.get("permissions", {}).get(doc["id"], {"user_ids": [], "role_ids": [], "department_ids": []})
            item["versions"] = state.get("versions", {}).get(doc["id"], [])
        return item

    def get_document(self, document_id: str, user_id: str | None = None) -> dict[str, Any] | None:
        state = self.state()
        doc = next((d for d in state["documents"] if d["id"] == document_id and d.get("status") != "deleted"), None)
        if not doc:
            return None
        if not self.can_user_access_document(state, doc, user_id):
            return None
        return self._enrich_document(doc, state, include_content=True)

    def org_scope_exists(self, scope_id: str) -> bool:
        state = self.state()
        return any(str(item.get("id")) == str(scope_id) for item in state.get("departments", []) + state.get("org_nodes", []))

    def register_dify_document(
        self,
        *,
        user: dict[str, Any],
        dify_document_id: str,
        name: str,
        scope_id: str,
        scope_name: str = "",
        catalog_item_id: str = "",
        archive_tree_node_id: str = "",
        visibility: str = "department",
        confidentiality_level: str = "internal",
        ai_usage_scope: str = "ai_answer",
        dataset_id: str = "",
    ) -> dict[str, Any]:
        state = self.state()
        dify_dataset_id = str(dataset_id or state.get("settings", {}).get("dify_dataset_id") or "")
        existing = next((doc for doc in state.get("documents", []) if str(doc.get("dify_document_id")) == str(dify_document_id) and doc.get("status") != "deleted"), None)
        if existing:
            return self._enrich_document(existing, state, include_content=True)
        department = next((item for item in state.get("departments", []) if item.get("id") == scope_id), {})
        catalog_item = next((item for item in state.get("archive_catalog_items", []) if item.get("id") == catalog_item_id), {}) if catalog_item_id else {}
        if not catalog_item_id:
            scope_catalog_items = [
                item for item in state.get("archive_catalog_items", [])
                if str(item.get("scope_id") or "") == str(scope_id) and item.get("status") == "active"
            ]
            if len(scope_catalog_items) == 1:
                catalog_item = scope_catalog_items[0]
                catalog_item_id = str(catalog_item.get("id") or "")
        if catalog_item_id and not catalog_item:
            raise ValueError("档案目录项不存在")
        if catalog_item and str(catalog_item.get("scope_id") or "") != str(scope_id):
            raise ValueError("档案目录项不属于所选组织范围")
        scope_node = next((item for item in state.get("org_nodes", []) if item.get("id") == scope_id), {})
        resolved_scope_name = scope_name or department.get("name") or scope_node.get("name") or scope_id
        title = name.rsplit("/", 1)[-1] or name
        tree_defaults = self.archive_tree_upload_defaults(archive_tree_node_id, user["id"]) if archive_tree_node_id else {}
        if archive_tree_node_id and not tree_defaults:
            raise ValueError("无权将 Dify 文档关联到该档案节点")
        if tree_defaults:
            scope_id = str(tree_defaults.get("org_unit_id") or scope_id)
            catalog_item_id = str(tree_defaults.get("archive_catalog_id") or catalog_item_id)
            department = next((item for item in state.get("departments", []) if item.get("id") == scope_id), {})
            catalog_item = next((item for item in state.get("archive_catalog_items", []) if item.get("id") == catalog_item_id), {}) if catalog_item_id else {}
            scope_node = next((item for item in state.get("org_nodes", []) if item.get("id") == scope_id), {})
            resolved_scope_name = scope_name or department.get("name") or scope_node.get("name") or scope_id
        route_probe = {
            "visibility": visibility,
            "org_unit_id": scope_id,
            "department_id": scope_id,
            "archive_category": catalog_item.get("category") or "Dify 知识库",
            "document_type": catalog_item.get("subcategory") or "Dify 外部文档",
            "ai_usage_scope": ai_usage_scope,
            "confidentiality_level": confidentiality_level,
        }
        remote_mapping = self._resolve_dataset_mapping(route_probe, state)
        payload = {
            "title": title,
            "category": catalog_item.get("category") or "Dify 知识库",
            "tags": ["dify-direct-upload"],
            "owner_id": user["id"],
            "department_id": scope_id,
            "visibility": visibility,
            "file_name": title,
            "mime_type": "application/octet-stream",
            "content_text": "",
            "org_unit_id": scope_id,
            "org_path": department.get("path") or scope_node.get("path") or (f"/集团总部/{resolved_scope_name}" if resolved_scope_name != "集团总部" else "/集团总部"),
            "archive_catalog_id": catalog_item_id,
            "archive_tree_node_id": archive_tree_node_id,
            "archive_category": (tree_defaults or {}).get("archive_category") or catalog_item.get("category") or "Dify 知识库",
            "archive_path": (tree_defaults or {}).get("archive_path") or "",
            "document_type": (tree_defaults or {}).get("document_type") or catalog_item.get("subcategory") or "Dify 外部文档",
            "filing_period": (tree_defaults or {}).get("filing_period") or catalog_item.get("archive_period") or "年度",
            "retention_period": (tree_defaults or {}).get("retention_period") or catalog_item.get("retention_policy") or "长期",
            "filing_status": "filed",
            "ai_enabled": True,
            "ai_usage_scope": ai_usage_scope,
            "knowledge_sync_status": "synced",
            "knowledge_source_type": "dify",
            "knowledge_dataset_key": str((remote_mapping or {}).get("dataset_key") or "dify-remote"),
            "confidentiality_level": confidentiality_level,
            "ai_summary_template": (tree_defaults or {}).get("ai_summary_template", ""),
        }
        created = self.create_document(payload)
        with self._lock:
            state = self._read_state_unsafe()
            idx = next((i for i, doc in enumerate(state.get("documents", [])) if doc.get("id") == created.get("id")), -1)
            if idx >= 0:
                doc = dict(state["documents"][idx])
                doc["dify_document_id"] = str(dify_document_id)
                doc["dify_dataset_id"] = dify_dataset_id
                doc["dify_sync_status"] = "synced"
                doc["dify_indexing_status"] = "completed"
                doc["knowledge_sync_status"] = "synced"
                doc["updated_at"] = _utc_now()
                state["documents"][idx] = doc
                permissions = state.setdefault("permissions", {}).setdefault(doc["id"], {"user_ids": [], "role_ids": [], "department_ids": []})
                if visibility == "private":
                    permissions.update({"user_ids": [user["id"]], "role_ids": [], "department_ids": []})
                elif visibility == "department":
                    permissions.update({"user_ids": [], "role_ids": [], "department_ids": [scope_id]})
                else:
                    permissions.update({"user_ids": [], "role_ids": [], "department_ids": []})
                self._append_log(state, "dify.document.link", doc["id"], f"关联 Dify 文档《{doc['title']}》并归属组织 {resolved_scope_name}", actor=user["id"])
                self._write_state_unsafe(state)
                created = self._enrich_document(doc, state, include_content=True)
        return created

    def create_document(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            now = _utc_now()
            doc = {
                "id": _new_id("doc"),
                "title": payload["title"],
                "category": payload.get("category") or "General",
                "tags": payload.get("tags", []),
                "owner_id": payload.get("owner_id") or "u-admin",
                "department_id": payload.get("department_id") or "dept-ops",
                "visibility": payload.get("visibility") or "department",
                "file_name": payload["file_name"],
                "mime_type": payload.get("mime_type") or "text/plain",
                "status": "uploaded",
                "index_status": "pending",
                "dify_dataset_id": "",
                "dify_document_id": "",
                "dify_batch": "",
                "dify_sync_status": "not_synced",
                "dify_indexing_status": "",
                "dify_error": "",
                "dify_segment_count": 0,
                "last_synced_at": "",
                "last_dify_status_at": "",
                "original_path": "",
                "parse_status": "parsed" if payload.get("content_text") else "empty",
                "parse_error": "" if payload.get("content_text") else "No text content provided.",
                "parser": "json-text",
                "source_type": "json",
                "quality_score": 0,
                "size_bytes": 0,
                "version": 1,
                "created_at": now,
                "updated_at": now,
                **_document_governance_defaults(payload),
            }
            if not str(doc.get("knowledge_dataset_key") or "").strip():
                mapping = self._resolve_dataset_mapping(doc, state)
                if mapping:
                    doc["knowledge_dataset_key"] = str(mapping.get("dataset_key") or "")
            content_path, size = self._write_document_content(doc, 1, payload.get("content_text", ""), payload.get("content_base64", ""))
            doc["content_path"] = content_path
            doc["size_bytes"] = size
            state["documents"].insert(0, doc)
            state.setdefault("versions", {})[doc["id"]] = [{"version": 1, "file_name": doc["file_name"], "size_bytes": size, "created_at": now, "created_by": doc["owner_id"], "content_path": content_path}]
            state.setdefault("permissions", {})[doc["id"]] = {"user_ids": [], "role_ids": [], "department_ids": [doc["department_id"]]}
            self._append_log(state, "document.create", doc["id"], f"上传文档《{doc['title']}》", actor=doc["owner_id"])
            self._write_state_unsafe(state)
            self._sync_knowledge_record(doc, state.get("permissions", {}).get(doc["id"], {}))
            return self._enrich_document(doc, state, include_content=True)

    def create_uploaded_document(
        self,
        *,
        title: str,
        category: str,
        tags: list[str],
        owner_id: str,
        department_id: str,
        visibility: str,
        file_name: str,
        mime_type: str,
        raw: bytes,
        archive_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            now = _utc_now()
            merged_payload = {
                "category": category,
                "owner_id": owner_id,
                "department_id": department_id,
                "visibility": visibility,
                **(archive_payload or {}),
            }
            doc = {
                "id": _new_id("doc"),
                "title": title,
                "category": category or "General",
                "tags": list(tags),
                "owner_id": owner_id or "u-admin",
                "department_id": department_id or "dept-ops",
                "visibility": visibility or "department",
                "file_name": file_name,
                "mime_type": mime_type or "application/octet-stream",
                "status": "uploaded",
                "index_status": "pending",
                "dify_dataset_id": "",
                "dify_document_id": "",
                "dify_batch": "",
                "dify_sync_status": "not_synced",
                "dify_indexing_status": "",
                "dify_error": "",
                "dify_segment_count": 0,
                "last_synced_at": "",
                "last_dify_status_at": "",
                "quality_score": 0,
                "size_bytes": len(raw),
                "version": 1,
                "created_at": now,
                "updated_at": now,
                "source_type": "upload",
                **_document_governance_defaults(merged_payload),
            }
            if not str(doc.get("knowledge_dataset_key") or "").strip():
                mapping = self._resolve_dataset_mapping(doc, state)
                if mapping:
                    doc["knowledge_dataset_key"] = str(mapping.get("dataset_key") or "")
            original_path = self._original_path(doc["id"], 1, file_name)
            original_path.write_bytes(raw)
            parse = extract_text(original_path, mime_type=mime_type, file_name=file_name)
            content_path = self._content_path(doc["id"], 1, ".txt")
            content_path.write_text(parse["text"], encoding="utf-8")
            doc["original_path"] = str(original_path.relative_to(self.root))
            doc["content_path"] = str(content_path.relative_to(self.root))
            doc["parse_status"] = parse["status"]
            doc["parse_error"] = parse["error"]
            doc["parser"] = parse["parser"]
            state["documents"].insert(0, doc)
            state.setdefault("versions", {})[doc["id"]] = [
                {
                    "version": 1,
                    "file_name": doc["file_name"],
                    "size_bytes": len(raw),
                    "created_at": now,
                    "created_by": doc["owner_id"],
                    "content_path": doc["content_path"],
                    "original_path": doc["original_path"],
                    "parse_status": doc["parse_status"],
                    "parser": doc["parser"],
                }
            ]
            state.setdefault("permissions", {})[doc["id"]] = {
                "user_ids": [],
                "role_ids": [],
                "department_ids": [doc["department_id"]],
            }
            self._append_log(
                state,
                "document.upload",
                doc["id"],
                f"上传原始文件《{doc['file_name']}》，解析状态: {doc['parse_status']}",
                actor=doc["owner_id"],
            )
            self._write_state_unsafe(state)
            self._sync_knowledge_record(doc, state.get("permissions", {}).get(doc["id"], {}))
            return self._enrich_document(doc, state, include_content=True)

    def update_document(self, document_id: str, payload: dict[str, Any], actor: str = "admin") -> dict[str, Any] | None:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            idx = next((i for i, d in enumerate(state["documents"]) if d["id"] == document_id and d.get("status") != "deleted"), -1)
            if idx < 0:
                return None
            previous = dict(state["documents"][idx])
            doc = dict(previous)
            content_text = payload.pop("content_text", None)
            route_fields = {"org_unit_id", "department_id", "archive_catalog_id", "archive_tree_node_id", "archive_category", "document_type", "visibility", "confidentiality_level", "ai_usage_scope"}
            route_changed = bool(route_fields & set(payload))
            explicit_domain = "knowledge_dataset_key" in payload and payload.get("knowledge_dataset_key") is not None
            governance_keys = {"ai_enabled", "ai_usage_scope", "knowledge_sync_status", "knowledge_dataset_key", "redaction_required", "redaction_status", "confidentiality_level", "filing_status"}
            touched_governance = False
            for key, value in payload.items():
                if value is not None:
                    doc[key] = value
                    if key in governance_keys:
                        touched_governance = True
            if route_changed and not explicit_domain:
                mapping = self._resolve_dataset_mapping({**doc, "knowledge_dataset_key": ""}, state)
                doc["knowledge_dataset_key"] = str((mapping or {}).get("dataset_key") or "")
                touched_governance = True
            if content_text is not None:
                doc["version"] = int(doc.get("version", 1)) + 1
                content_path, size = self._write_document_content(doc, doc["version"], content_text, "")
                doc["content_path"] = content_path
                doc["size_bytes"] = size
                state.setdefault("versions", {}).setdefault(document_id, []).insert(0, {"version": doc["version"], "file_name": doc["file_name"], "size_bytes": size, "created_at": _utc_now(), "created_by": doc.get("owner_id", ""), "content_path": content_path})
                doc["index_status"] = "pending"
                doc["status"] = "uploaded"
                doc["dify_sync_status"] = "stale"
                doc["dify_indexing_status"] = ""
                doc["dify_error"] = ""
                if doc.get("ai_enabled"):
                    doc["knowledge_sync_status"] = "pending"
            review_reasons = _governance_recheck_reasons(previous, doc)
            if doc.get("ai_enabled") is False:
                doc["knowledge_sync_status"] = "disabled"
            elif touched_governance and str(doc.get("knowledge_sync_status") or "") == "synced":
                doc["knowledge_sync_status"] = "pending"
                doc["dify_sync_status"] = "stale"
            if review_reasons:
                doc["ai_review_status"] = "pending"
                doc["ai_review_note"] = ""
                doc["ai_block_reason"] = ""
                doc["review_pending_reason"] = "、".join(review_reasons)
                doc["last_reviewed_at"] = _utc_now()
                self._append_log(state, "ai.review.pending", document_id, f"文档《{doc['title']}》因{doc['review_pending_reason']}进入待复核", actor=actor)
            doc["updated_at"] = _utc_now()
            state["documents"][idx] = doc
            self._append_log(state, "document.update", document_id, f"更新文档《{doc['title']}》", actor=actor)
            self._write_state_unsafe(state)
            self._sync_knowledge_record(doc, state.get("permissions", {}).get(document_id, {}))
            item = self._enrich_document(doc, state, include_content=True)
            gate = self.document_ai_gate(item)
            item["ai_gate_allowed"] = bool(gate.get("allowed"))
            item["ai_gate_block_reason"] = str(gate.get("block_reason") or "")
            return item

    def can_access_document(self, document_id: str, user_id: str | None, action: str = "read") -> bool:
        state = self.state()
        doc = next(
            (item for item in state["documents"] if item["id"] == document_id and item.get("status") != "deleted"),
            None,
        )
        if doc is None:
            return False
        return self.can_user_access_document(state, doc, user_id, action=action)

    def soft_delete(self, ids: list[str]) -> int:
        return self._set_status(ids, "deleted", "document.delete", "批量删除文档")

    def archive(self, ids: list[str]) -> int:
        return self._set_status(ids, "archived", "document.archive", "批量归档文档")

    def _set_status(self, ids: list[str], status: str, action: str, detail: str) -> int:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            count = 0
            wanted = set(ids)
            for doc in state["documents"]:
                if doc["id"] in wanted:
                    doc["status"] = status
                    doc["updated_at"] = _utc_now()
                    count += 1
            if count:
                self._append_log(state, action, ",".join(ids), f"{detail}: {count} 个")
                self._write_state_unsafe(state)
                for doc in state["documents"]:
                    if doc.get("id") in wanted:
                        self._sync_knowledge_record(doc, state.get("permissions", {}).get(doc["id"], {}))
            return count

    def reindex(self, ids: list[str]) -> list[dict[str, Any]]:
        indexed_docs: list[dict[str, Any]] = []
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            jobs: list[dict[str, Any]] = []
            wanted = set(ids)
            for doc in state["documents"]:
                if doc["id"] in wanted and doc.get("status") != "deleted":
                    content = self._read_content(doc.get("content_path", ""))
                    status = "completed" if content else "skipped"
                    doc["index_status"] = status
                    doc["status"] = "indexed" if status == "completed" else doc.get("status", "uploaded")
                    doc["quality_score"] = min(98, max(35, len(content) // 20)) if content else 0
                    doc["updated_at"] = _utc_now()
                    job = {"id": _new_id("job"), "document_id": doc["id"], "document_title": doc["title"], "status": status, "chunk_count": max(1, len(content) // 800) if content else 0, "message": "MVP 本地索引已生成，LLM embedding 接口预留" if content else "非文本或空内容，等待解析器", "created_at": _utc_now()}
                    state.setdefault("index_jobs", []).insert(0, job)
                    jobs.append(job)
                    indexed_docs.append(dict(doc))
            if jobs:
                state["index_jobs"] = state["index_jobs"][:200]
                self._append_log(state, "document.reindex", ",".join(ids), f"重新索引 {len(jobs)} 个文档")
                self._write_state_unsafe(state)
        # Chunking/embedding/Milvus work is kept outside the JSON lock. SQL
        # chunks are durable even when Milvus is unavailable and can be retried.
        for doc in indexed_docs:
            try:
                from app.knowledge_base import get_data_plane

                content = self._read_content(doc.get("content_path", ""))
                result = get_data_plane().index_document(doc, content)
                self._record_vector_index_status(doc["id"], result.get("status", "pending"), result.get("backend", "milvus"), result.get("error", ""))
                for job in jobs:
                    if job.get("document_id") == doc.get("id"):
                        job["chunk_count"] = result.get("chunk_count", job.get("chunk_count", 0))
                        job["vector_status"] = result.get("status", "pending")
                        job["vector_backend"] = result.get("backend", "milvus")
                        if result.get("error"):
                            job["message"] = result["error"]
            except Exception as exc:
                logger.exception("Knowledge data-plane indexing failed for %s", doc.get("id"))
                self._record_vector_index_status(doc["id"], "failed", "milvus", str(exc))
                for job in jobs:
                    if job.get("document_id") == doc.get("id"):
                        job["vector_status"] = "failed"
                        job["message"] = str(exc)
        return jobs

    def _record_vector_index_status(self, document_id: str, status: str, backend: str, error: str = "") -> None:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            doc = next((row for row in state.get("documents", []) if row.get("id") == document_id), None)
            if doc is None:
                return
            doc["vector_index_status"] = status
            doc["vector_backend"] = backend
            doc["vector_error"] = error
            for job in state.get("index_jobs", []):
                if job.get("document_id") == document_id:
                    job["vector_status"] = status
                    job["vector_backend"] = backend
                    if error:
                        job["message"] = error
                    break
            self._write_state_unsafe(state)

    def reparse_document(self, document_id: str, actor: str = "admin") -> dict[str, Any] | None:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            idx = next((i for i, doc in enumerate(state.get("documents", [])) if doc.get("id") == document_id and doc.get("status") != "deleted"), -1)
            if idx < 0:
                return None
            doc = dict(state["documents"][idx])
            original = self.root / str(doc.get("original_path") or "")
            if not original.exists():
                return None
            parsed = extract_text(original, mime_type=doc.get("mime_type", ""), file_name=doc.get("file_name", ""))
            version = int(doc.get("version") or 1)
            content_path = self._content_path(document_id, version, ".txt")
            content_path.write_text(str(parsed.get("text") or ""), encoding="utf-8")
            doc["content_path"] = str(content_path.relative_to(self.root))
            doc["parse_status"] = parsed.get("status") or "empty"
            doc["parse_error"] = parsed.get("error") or ""
            doc["parser"] = parsed.get("parser") or ""
            doc["index_status"] = "pending"
            doc["status"] = "uploaded"
            doc["updated_at"] = _utc_now()
            state["documents"][idx] = doc
            self._append_log(state, "document.reparse", document_id, f"重新解析文档《{doc.get('title', '')}》", actor=actor)
            self._write_state_unsafe(state)
            self._sync_knowledge_record(doc, state.get("permissions", {}).get(document_id, {}))
            return self._enrich_document(doc, state, include_content=True)

    def update_permissions(self, document_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            idx = next((i for i, d in enumerate(state["documents"]) if d["id"] == document_id and d.get("status") != "deleted"), -1)
            if idx < 0:
                return None
            doc = dict(state["documents"][idx])
            self._validate_permission_subjects(state, payload)
            if payload.get("visibility"):
                doc["visibility"] = payload["visibility"]
                mapping = self._resolve_dataset_mapping({**doc, "knowledge_dataset_key": ""}, state)
                next_domain = str((mapping or {}).get("dataset_key") or "")
                if next_domain != str(doc.get("knowledge_dataset_key") or ""):
                    doc["knowledge_dataset_key"] = next_domain
                    if str(doc.get("knowledge_sync_status") or "") == "synced":
                        doc["knowledge_sync_status"] = "pending"
                        doc["dify_sync_status"] = "stale"
            perms = {
                "user_ids": payload.get("user_ids", []), "role_ids": payload.get("role_ids", []), "department_ids": payload.get("department_ids", []),
                "catalog_ids": payload.get("catalog_ids", []), "deny_user_ids": payload.get("deny_user_ids", []),
                "deny_role_ids": payload.get("deny_role_ids", []), "deny_department_ids": payload.get("deny_department_ids", []),
                "download_enabled": bool(payload.get("download_enabled", False)),
            }
            state["documents"][idx] = doc
            state.setdefault("permissions", {})[document_id] = perms
            self._append_log(state, "permission.update", document_id, f"更新文档《{doc['title']}》权限")
            self._write_state_unsafe(state)
            self._sync_knowledge_record(doc, perms)
            return {"document_id": document_id, **perms, "visibility": doc["visibility"]}

    def index_status(self) -> dict[str, Any]:
        state = self.state()
        docs = [d for d in state["documents"] if d.get("status") != "deleted"]
        counts: dict[str, int] = {"pending": 0, "completed": 0, "failed": 0, "skipped": 0}
        for doc in docs:
            key = doc.get("index_status", "pending")
            counts[key] = counts.get(key, 0) + 1
        return {"summary": counts, "jobs": state.get("index_jobs", [])[:100]}

    def record_dify_sync(
        self,
        document_id: str,
        result: dict[str, Any],
        dataset_id: str,
        knowledge_dataset_key: str = "",
    ) -> dict[str, Any]:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            idx = next(
                (
                    i
                    for i, d in enumerate(state["documents"])
                    if d["id"] == document_id and d.get("status") != "deleted"
                ),
                -1,
            )
            if idx < 0:
                raise ValueError("Document not found")
            doc = dict(state["documents"][idx])
            dify_document = result.get("document") or result.get("data") or {}
            doc["dify_dataset_id"] = dataset_id
            if knowledge_dataset_key:
                doc["knowledge_dataset_key"] = knowledge_dataset_key
            doc["dify_document_id"] = str(
                dify_document.get("id") or result.get("document_id") or ""
            )
            doc["dify_batch"] = str(result.get("batch") or result.get("batch_id") or "")
            doc["dify_sync_status"] = "synced"
            doc["knowledge_sync_status"] = "synced"
            doc["dify_indexing_status"] = str(
                dify_document.get("indexing_status")
                or result.get("indexing_status")
                or "waiting"
            )
            doc["dify_error"] = ""
            doc["last_synced_at"] = _utc_now()
            doc["updated_at"] = _utc_now()
            state["documents"][idx] = doc
            self._append_log(
                state, "dify.sync", document_id, f"同步文档《{doc['title']}》到 Dify"
            )
            self._write_state_unsafe(state)
            return self._enrich_document(doc, state, include_content=True)

    def record_dify_status(self, document_id: str, result: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            idx = next(
                (
                    i
                    for i, d in enumerate(state["documents"])
                    if d["id"] == document_id and d.get("status") != "deleted"
                ),
                -1,
            )
            if idx < 0:
                raise ValueError("Document not found")
            doc = dict(state["documents"][idx])
            rows = result.get("data") or result.get("documents") or []
            row = rows[0] if isinstance(rows, list) and rows else result
            indexing_status = str(row.get("indexing_status") or row.get("status") or "")
            doc["dify_indexing_status"] = indexing_status
            doc["dify_error"] = str(row.get("error") or row.get("error_msg") or "")
            doc["dify_segment_count"] = int(
                row.get("completed_segments")
                or row.get("segment_count")
                or doc.get("dify_segment_count")
                or 0
            )
            doc["last_dify_status_at"] = _utc_now()
            if indexing_status in {"completed", "available"}:
                doc["index_status"] = "completed"
                doc["status"] = "indexed"
                doc["knowledge_sync_status"] = "synced"
            elif indexing_status in {"error", "failed"}:
                doc["index_status"] = "failed"
                doc["knowledge_sync_status"] = "failed"
            state["documents"][idx] = doc
            self._append_log(
                state,
                "dify.status",
                document_id,
                f"刷新 Dify 索引状态: {indexing_status or 'unknown'}",
            )
            self._write_state_unsafe(state)
            return self._enrich_document(doc, state, include_content=True)

    def audit_logs(self) -> list[dict[str, Any]]:
        return self.state().get("audit_logs", [])

    def archive_audit_logs(self) -> list[dict[str, Any]]:
        return [
            item for item in self.audit_logs()
            if str(item.get("action") or "").startswith("archive.")
        ]

    def ai_governance_audit_logs(self) -> list[dict[str, Any]]:
        prefixes = ("ai.", "dify.")
        return [
            item for item in self.audit_logs()
            if str(item.get("action") or "").startswith(prefixes)
        ]

    def settings(self, user_id: str | None) -> dict[str, Any]:
        state = self.state()
        return self._settings_view(state, user_id)

    def update_setting(self, key: str, value: Any) -> dict[str, Any]:
        if key not in _ALLOWED_SETTINGS:
            raise ValueError(f"Unsupported setting: {key}")
        expected_type = _ALLOWED_SETTINGS[key]
        if expected_type is bool and not isinstance(value, bool):
            raise ValueError(f"Setting {key} must be a boolean")
        if expected_type is int:
            if not isinstance(value, int):
                raise ValueError(f"Setting {key} must be an integer")
        elif expected_type is str and not isinstance(value, str):
            raise ValueError(f"Setting {key} must be a string")
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            state.setdefault("settings", {})[key] = value
            self._append_log(state, "setting.update", key, f"更新系统设置 {key}")
            self._write_state_unsafe(state)
            return state["settings"]

    def update_settings(self, updates: dict[str, Any]) -> dict[str, Any]:
        for key, value in updates.items():
            if key not in _ALLOWED_SETTINGS:
                raise ValueError(f"Unsupported setting: {key}")
            expected_type = _ALLOWED_SETTINGS[key]
            if expected_type is bool and not isinstance(value, bool):
                raise ValueError(f"Setting {key} must be a boolean")
            if expected_type is int:
                if not isinstance(value, int):
                    raise ValueError(f"Setting {key} must be an integer")
            elif expected_type is str and not isinstance(value, str):
                raise ValueError(f"Setting {key} must be a string")
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            settings = state.setdefault("settings", {})
            for key, value in updates.items():
                settings[key] = value
            self._append_log(state, "setting.batch_update", ",".join(sorted(updates)), f"批量更新系统设置 {len(updates)} 项")
            self._write_state_unsafe(state)
            return state["settings"]

    def _archive_tree_node(self, state: dict[str, Any], node_id: str) -> dict[str, Any] | None:
        return next(
            (node for node in state.get("archive_tree_nodes", []) if str(node.get("id")) == str(node_id) and node.get("status") != "disabled"),
            None,
        )

    def _archive_tree_ancestors(self, state: dict[str, Any], node: dict[str, Any]) -> list[dict[str, Any]]:
        by_id = {str(item.get("id")): item for item in state.get("archive_tree_nodes", []) if item.get("status") != "disabled"}
        result = [node]
        seen = {str(node.get("id"))}
        parent_id = str(node.get("parent_id") or "")
        while parent_id and parent_id not in seen and parent_id in by_id:
            parent = by_id[parent_id]
            result.append(parent)
            seen.add(parent_id)
            parent_id = str(parent.get("parent_id") or "")
        return list(reversed(result))

    def _archive_tree_descendant_ids(self, state: dict[str, Any], node_id: str) -> set[str]:
        children: dict[str, list[str]] = {}
        for node in state.get("archive_tree_nodes", []):
            if node.get("status") == "disabled":
                continue
            children.setdefault(str(node.get("parent_id") or ""), []).append(str(node.get("id")))
        result: set[str] = set()
        pending = [str(node_id)]
        while pending:
            current = pending.pop()
            if current in result:
                continue
            result.add(current)
            pending.extend(children.get(current, []))
        return result

    def _archive_tree_effective_policy(self, state: dict[str, Any], node: dict[str, Any]) -> dict[str, Any]:
        chain = self._archive_tree_ancestors(state, node)
        selected = chain[0] if chain else node
        for candidate in reversed(chain):
            if candidate.get("permission_mode", "inherit") == "override":
                selected = candidate
                break
        return {
            "source_node_id": selected.get("id", ""),
            "allowed_actions": list(selected.get("allowed_actions") or _TREE_ACTIONS),
            "user_ids": list(selected.get("user_ids") or []),
            "role_ids": list(selected.get("role_ids") or []),
            "department_ids": list(selected.get("department_ids") or []),
            "deny_user_ids": list(selected.get("deny_user_ids") or []),
            "deny_role_ids": list(selected.get("deny_role_ids") or []),
            "deny_department_ids": list(selected.get("deny_department_ids") or []),
        }

    def can_user_access_archive_tree_node(
        self, state: dict[str, Any], node: dict[str, Any], user_id: str | None, action: str = "read"
    ) -> bool:
        user = self._user_context(state, user_id)
        if user_id and user is None:
            return False
        if user is None or user.get("is_admin"):
            return True
        required_permission = {
            "read": "archive:read",
            "upload": "document:write",
            "delete": "document:write",
            "metadata": "archive:catalog:write",
            "download": "document:download",
        }.get(action, "archive:read")
        if required_permission not in set(user.get("role", {}).get("permissions", [])):
            return False
        if node.get("node_type") == "root":
            return True
        policy = self._archive_tree_effective_policy(state, node)
        if action not in set(policy.get("allowed_actions") or []):
            return False
        if user["id"] in policy["deny_user_ids"] or user.get("role_id") in policy["deny_role_ids"] or user.get("department_id") in policy["deny_department_ids"]:
            return False
        explicit = bool(policy["user_ids"] or policy["role_ids"] or policy["department_ids"])
        if user["id"] in policy["user_ids"] or user.get("role_id") in policy["role_ids"] or user.get("department_id") in policy["department_ids"]:
            return True
        if explicit:
            return False
        scope_id = str(node.get("scope_id") or "")
        return not scope_id or scope_id == str(user.get("department_id") or "")

    def _enrich_archive_tree_node(self, state: dict[str, Any], node: dict[str, Any], user_id: str | None) -> dict[str, Any]:
        item = dict(node)
        node_id = str(node.get("id"))
        active_nodes = [row for row in state.get("archive_tree_nodes", []) if row.get("status") != "disabled"]
        item["has_children"] = any(str(row.get("parent_id") or "") == node_id for row in active_nodes)
        item["child_count"] = len([row for row in active_nodes if str(row.get("parent_id") or "") == node_id])
        descendant_ids = self._archive_tree_descendant_ids(state, node_id)
        linked_docs = []
        for doc in state.get("documents", []):
            if doc.get("status") == "deleted":
                continue
            linked_id = str(doc.get("archive_tree_node_id") or "")
            legacy_match = False
            if not linked_id:
                if node.get("node_type") == "root":
                    legacy_match = True
                elif node.get("catalog_item_id"):
                    legacy_match = str(doc.get("archive_catalog_id") or "") == str(node.get("catalog_item_id"))
                elif node.get("node_type") == "organization":
                    legacy_match = str(doc.get("org_unit_id") or doc.get("department_id") or "") == str(node.get("scope_id") or "")
                elif node.get("node_type") == "category":
                    legacy_match = _normalize_text(doc.get("archive_category")) == _normalize_text(node.get("name"))
            if linked_id in descendant_ids or legacy_match:
                linked_docs.append(doc)
        item["document_count"] = len(linked_docs)
        # A node's badge reflects the filing state of all documents below it.
        # Explicit node status remains the fallback for empty folders.
        statuses = {str(doc.get("filing_status") or "unfiled") for doc in linked_docs if str(doc.get("filing_status") or "") != "void"}
        if statuses:
            if statuses == {"filed"}:
                item["archive_status"] = "filed"
            elif "pending" in statuses or "filed" in statuses:
                item["archive_status"] = "pending"
            else:
                item["archive_status"] = "unfiled"
        item["path"] = [{"id": row.get("id", ""), "name": row.get("name", "")} for row in self._archive_tree_ancestors(state, node)]
        item["effective_policy"] = self._archive_tree_effective_policy(state, node)
        item["capabilities"] = {
            action: self.can_user_access_archive_tree_node(state, node, user_id, action)
            for action in _TREE_ACTIONS
        }
        role_by_id = {str(role.get("id")): role.get("name", "") for role in state.get("roles", [])}
        item["owner_role_name"] = role_by_id.get(str(node.get("owner_role_id") or ""), "")
        item["reviewer_role_name"] = role_by_id.get(str(node.get("reviewer_role_id") or ""), "")
        return item

    def list_archive_tree_nodes(self, user_id: str, parent_id: str | None = None) -> list[dict[str, Any]]:
        state = self.state()
        nodes = [node for node in state.get("archive_tree_nodes", []) if node.get("status") != "disabled"]
        if parent_id is not None:
            nodes = [node for node in nodes if str(node.get("parent_id") or "") == str(parent_id)]
        result = []
        for node in nodes:
            if node.get("node_type") == "root" or self.can_user_access_archive_tree_node(state, node, user_id, "read"):
                result.append(self._enrich_archive_tree_node(state, node, user_id))
        return sorted(result, key=lambda item: (int(item.get("sort_order") or 0), item.get("name", "")))

    def get_archive_tree_node(self, node_id: str, user_id: str, action: str = "read") -> dict[str, Any] | None:
        state = self.state()
        node = self._archive_tree_node(state, node_id)
        if node is None or not self.can_user_access_archive_tree_node(state, node, user_id, action):
            return None
        return self._enrich_archive_tree_node(state, node, user_id)

    def create_archive_tree_node(self, payload: dict[str, Any], actor: str) -> dict[str, Any] | None:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            parent = self._archive_tree_node(state, str(payload.get("parent_id") or ""))
            if parent is None or not self.can_user_access_archive_tree_node(state, parent, actor, "metadata"):
                return None
            now = _utc_now()
            node = {
                "id": _new_id("tree"),
                "scope_id": payload.get("scope_id") or parent.get("scope_id", ""),
                "catalog_id": parent.get("catalog_id", ""),
                "catalog_item_id": "",
                "sort_order": len([row for row in state.get("archive_tree_nodes", []) if row.get("parent_id") == parent.get("id")]) * 10 + 10,
                "status": "active", "created_at": now, "updated_at": now,
                **payload,
            }
            node["scope_id"] = payload.get("scope_id") or parent.get("scope_id", "")
            if node.get("node_type") == "organization" and node.get("scope_id"):
                node["department_ids"] = list(dict.fromkeys([*(node.get("department_ids") or []), node["scope_id"]]))
            state.setdefault("archive_tree_nodes", []).append(node)
            self._append_log(state, "archive.tree.create", node["id"], f"在《{parent.get('name', '')}》下新增目录节点《{node.get('name', '')}》", actor=actor)
            self._write_state_unsafe(state)
            return self._enrich_archive_tree_node(state, node, actor)

    def update_archive_tree_node(self, node_id: str, payload: dict[str, Any], actor: str) -> dict[str, Any] | None:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            idx = next((i for i, row in enumerate(state.get("archive_tree_nodes", [])) if str(row.get("id")) == str(node_id) and row.get("status") != "disabled"), -1)
            if idx < 0 or not self.can_user_access_archive_tree_node(state, state["archive_tree_nodes"][idx], actor, "metadata"):
                return None
            self._validate_permission_subjects(state, payload)
            node = dict(state["archive_tree_nodes"][idx])
            if node.get("node_type") == "root":
                payload.pop("name", None)
            for key, value in payload.items():
                if value is not None:
                    node[key] = value
            node["updated_at"] = _utc_now()
            state["archive_tree_nodes"][idx] = node
            self._append_log(state, "archive.tree.update", node_id, f"更新目录节点《{node.get('name', '')}》规则与元数据", actor=actor)
            self._write_state_unsafe(state)
            return self._enrich_archive_tree_node(state, node, actor)

    def batch_update_archive_tree_nodes(self, node_ids: list[str], payload: dict[str, Any], actor: str) -> list[dict[str, Any]]:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            wanted = set(node_ids)
            updated: list[dict[str, Any]] = []
            for idx, current in enumerate(state.get("archive_tree_nodes", [])):
                if current.get("id") not in wanted or not self.can_user_access_archive_tree_node(state, current, actor, "metadata"):
                    continue
                node = dict(current)
                for key, value in payload.items():
                    if value is not None:
                        node[key] = value
                node["updated_at"] = _utc_now()
                state["archive_tree_nodes"][idx] = node
                updated.append(node)
            if updated:
                self._append_log(state, "archive.tree.batch_update", ",".join(node["id"] for node in updated), f"批量更新 {len(updated)} 个目录节点规则", actor=actor)
                self._write_state_unsafe(state)
            return [self._enrich_archive_tree_node(state, node, actor) for node in updated]

    def move_archive_tree_node(self, node_id: str, target_parent_id: str, sort_order: int, actor: str) -> dict[str, Any] | None:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            node = self._archive_tree_node(state, node_id)
            target = self._archive_tree_node(state, target_parent_id)
            if node is None or target is None or node.get("node_type") == "root":
                return None
            descendants = self._archive_tree_descendant_ids(state, node_id)
            if target_parent_id in descendants:
                raise ValueError("不能把节点移动到自身或其子节点下")
            if not self.can_user_access_archive_tree_node(state, node, actor, "metadata") or not self.can_user_access_archive_tree_node(state, target, actor, "metadata"):
                return None
            old_parent = str(node.get("parent_id") or "")
            new_scope = str(target.get("scope_id") or node.get("scope_id") or "")
            old_scope = str(node.get("scope_id") or "")
            actor_context = self._user_context(state, actor) or {}
            if old_scope != new_scope and not actor_context.get("is_admin"):
                raise PermissionError("跨组织迁移目录仅管理员可执行")
            for idx, current in enumerate(state.get("archive_tree_nodes", [])):
                if current.get("id") not in descendants:
                    continue
                changed = dict(current)
                if changed.get("id") == node_id:
                    changed["parent_id"] = target_parent_id
                    changed["sort_order"] = sort_order
                changed["scope_id"] = new_scope
                changed["updated_at"] = _utc_now()
                state["archive_tree_nodes"][idx] = changed
            by_id = {row.get("id"): row for row in state.get("archive_tree_nodes", [])}
            for doc in state.get("documents", []):
                if str(doc.get("archive_tree_node_id") or "") not in descendants:
                    continue
                if new_scope:
                    doc["department_id"] = new_scope
                    doc["org_unit_id"] = new_scope
                leaf = by_id.get(doc.get("archive_tree_node_id"), {})
                doc["archive_catalog_id"] = leaf.get("catalog_item_id") or doc.get("archive_catalog_id", "")
                doc["archive_path"] = "/".join(row.get("name", "") for row in self._archive_tree_ancestors(state, leaf))
                doc["updated_at"] = _utc_now()
            self._append_log(state, "archive.tree.move", node_id, f"目录节点《{node.get('name', '')}》从 {old_parent} 移动到《{target.get('name', '')}》", actor=actor)
            self._write_state_unsafe(state)
            moved = self._archive_tree_node(state, node_id)
            return self._enrich_archive_tree_node(state, moved, actor) if moved else None

    def merge_archive_tree_node(self, source_id: str, target_id: str, actor: str) -> dict[str, Any] | None:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            source = self._archive_tree_node(state, source_id)
            target = self._archive_tree_node(state, target_id)
            if source is None or target is None or source.get("node_type") == "root" or source_id == target_id:
                return None
            if not self.can_user_access_archive_tree_node(state, source, actor, "metadata") or not self.can_user_access_archive_tree_node(state, target, actor, "metadata"):
                return None
            actor_context = self._user_context(state, actor) or {}
            if str(source.get("scope_id") or "") != str(target.get("scope_id") or "") and not actor_context.get("is_admin"):
                raise PermissionError("跨组织合并目录仅管理员可执行")
            descendants = self._archive_tree_descendant_ids(state, source_id)
            if target_id in descendants:
                raise ValueError("目标节点不能位于待合并节点内部")
            target_scope = str(target.get("scope_id") or "")
            for idx, node in enumerate(state.get("archive_tree_nodes", [])):
                changed = dict(node)
                if str(changed.get("parent_id") or "") == source_id:
                    changed["parent_id"] = target_id
                if changed.get("id") in descendants:
                    changed["scope_id"] = target_scope
                if changed.get("id") == source_id:
                    changed["status"] = "disabled"
                state["archive_tree_nodes"][idx] = changed
            for doc in state.get("documents", []):
                if str(doc.get("archive_tree_node_id") or "") == source_id:
                    doc["archive_tree_node_id"] = target_id
                if str(doc.get("archive_tree_node_id") or "") in descendants and target_scope:
                    doc["department_id"] = target_scope
                    doc["org_unit_id"] = target_scope
                if str(doc.get("archive_tree_node_id") or "") in descendants:
                    doc["archive_path"] = "/".join(row.get("name", "") for row in self._archive_tree_ancestors(state, self._archive_tree_node(state, str(doc.get("archive_tree_node_id"))) or target))
                    doc["updated_at"] = _utc_now()
            self._append_log(state, "archive.tree.merge", source_id, f"目录节点《{source.get('name', '')}》合并到《{target.get('name', '')}》", actor=actor)
            self._write_state_unsafe(state)
            refreshed = self._archive_tree_node(state, target_id)
            return self._enrich_archive_tree_node(state, refreshed, actor) if refreshed else None

    def list_documents_for_archive_tree_node(self, node_id: str, user_id: str) -> list[dict[str, Any]]:
        state = self.state()
        node = self._archive_tree_node(state, node_id)
        if node is None or not self.can_user_access_archive_tree_node(state, node, user_id, "read"):
            return []
        descendants = self._archive_tree_descendant_ids(state, node_id)
        result = []
        for doc in state.get("documents", []):
            if doc.get("status") == "deleted" or not self.can_user_access_document(state, doc, user_id):
                continue
            linked_id = str(doc.get("archive_tree_node_id") or "")
            legacy_match = False
            if not linked_id:
                if node.get("catalog_item_id"):
                    legacy_match = str(doc.get("archive_catalog_id") or "") == str(node.get("catalog_item_id"))
                elif node.get("node_type") == "organization":
                    legacy_match = str(doc.get("org_unit_id") or doc.get("department_id") or "") == str(node.get("scope_id") or "")
                elif node.get("node_type") == "category":
                    legacy_match = _normalize_text(doc.get("archive_category")) == _normalize_text(node.get("name"))
            if linked_id in descendants or legacy_match:
                result.append(self._enrich_document(doc, state, include_content=False))
        return sorted(result, key=lambda doc: doc.get("updated_at", ""), reverse=True)

    def archive_tree_upload_defaults(self, node_id: str, user_id: str) -> dict[str, Any] | None:
        state = self.state()
        node = self._archive_tree_node(state, node_id)
        if node is None or node.get("node_type") == "root" or not self.can_user_access_archive_tree_node(state, node, user_id, "upload"):
            return None
        chain = self._archive_tree_ancestors(state, node)
        categories = [row.get("name", "") for row in chain if row.get("node_type") == "category"]
        return {
            "archive_tree_node_id": node_id,
            "org_unit_id": node.get("scope_id", ""),
            "department_id": node.get("scope_id", ""),
            "archive_catalog_id": node.get("catalog_item_id", ""),
            "archive_category": categories[0] if categories else node.get("name", ""),
            "document_type": categories[-1] if categories else "通用文档",
            "archive_path": "/".join(row.get("name", "") for row in chain),
            "filing_period": node.get("archive_period", "年度"),
            "retention_period": node.get("retention_period", "长期"),
            "is_required": bool(node.get("required")),
            "ai_enabled": bool(node.get("ai_enabled")),
            "ai_summary_template": node.get("ai_summary_template", ""),
            "tags": [f"archive-node:{node_id}", *categories],
        }

    def archive_tree_template(self, node_id: str, user_id: str) -> dict[str, Any] | None:
        state = self.state()
        node = self._archive_tree_node(state, node_id)
        if node is None or not self.can_user_access_archive_tree_node(state, node, user_id, "read"):
            return None
        chain = list(reversed(self._archive_tree_ancestors(state, node)))
        source = next((row for row in chain if row.get("template_name") or row.get("template_content")), node)
        return {
            "node_id": node_id,
            "name": source.get("template_name") or f"{node.get('name', '')}归档模板",
            "content": source.get("template_content") or f"# {node.get('name', '')}归档模板\n",
            "source_node_id": source.get("id", ""),
        }

    def archive_tree_audit_logs(self, node_id: str, user_id: str) -> list[dict[str, Any]]:
        state = self.state()
        node = self._archive_tree_node(state, node_id)
        if node is None or not self.can_user_access_archive_tree_node(state, node, user_id, "read"):
            return []
        related = self._archive_tree_descendant_ids(state, node_id)
        return [
            dict(log) for log in state.get("audit_logs", [])
            if str(log.get("action") or "").startswith("archive.tree.") and str(log.get("target") or "") in related
        ][:100]

    def org_tree(self, user_id: str | None = None, action: str = "read") -> list[dict[str, Any]]:
        state = self.state()
        nodes = [dict(node) for node in state.get("org_nodes", [])]
        if user_id and not self.is_admin(user_id):
            visible_ids = {
                str(catalog.get("scope_id") or "") for catalog in state.get("archive_catalogs", [])
                if catalog.get("status") == "active" and self.can_user_access_catalog(state, catalog, user_id, action)
            }
            by_id = {str(node.get("id")): node for node in nodes}
            included = set(visible_ids)
            for node_id in list(visible_ids):
                parent_id = str(by_id.get(node_id, {}).get("parent_id") or "")
                while parent_id:
                    included.add(parent_id)
                    parent_id = str(by_id.get(parent_id, {}).get("parent_id") or "")
            nodes = [node for node in nodes if str(node.get("id")) in included]
        node_map = {node["id"]: {**node, "children": []} for node in nodes}
        roots: list[dict[str, Any]] = []
        for node in node_map.values():
            parent_id = node.get("parent_id") or ""
            parent = node_map.get(parent_id)
            if parent:
                parent.setdefault("children", []).append(node)
            else:
                roots.append(node)
        for node in node_map.values():
            node["children"] = sorted(node.get("children", []), key=lambda item: item.get("name", ""))
        return sorted(roots, key=lambda item: item.get("name", ""))

    def list_archive_catalogs(self, scope_id: str = "", user_id: str | None = None, action: str = "read") -> list[dict[str, Any]]:
        state = self.state()
        items = [dict(item) for item in state.get("archive_catalogs", [])]
        if user_id:
            items = [item for item in items if self.can_user_access_catalog(state, item, user_id, action)]
        scope_id = str(scope_id or "").strip()
        if scope_id:
            items = [item for item in items if item.get("scope_id") == scope_id]
        catalog_items = state.get("archive_catalog_items", [])
        for item in items:
            item["item_count"] = len([row for row in catalog_items if row.get("catalog_id") == item.get("id") and row.get("status") != "disabled"])
            item["permissions"] = state.get("catalog_permissions", {}).get(item.get("id"), {})
        return sorted(items, key=lambda item: (item.get("scope_name", ""), item.get("sort_order", 0), item.get("name", "")))

    def create_archive_catalog(self, payload: dict[str, Any], actor: str = "admin") -> dict[str, Any]:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            item = {
                "id": _new_id("archivecatalog"),
                **payload,
            }
            state.setdefault("archive_catalogs", []).append(item)
            self._append_log(state, "archive.catalog.create", item["id"], f"新增档案目录模板《{item['name']}》", actor=actor)
            self._write_state_unsafe(state)
            item["item_count"] = 0
            return item

    def update_archive_catalog(self, catalog_id: str, payload: dict[str, Any], actor: str = "admin") -> dict[str, Any] | None:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            idx = next((i for i, item in enumerate(state.get("archive_catalogs", [])) if item.get("id") == catalog_id), -1)
            if idx < 0:
                return None
            item = dict(state["archive_catalogs"][idx])
            for key, value in payload.items():
                if value is not None:
                    item[key] = value
            state["archive_catalogs"][idx] = item
            self._append_log(state, "archive.catalog.update", catalog_id, f"更新档案目录模板《{item['name']}》", actor=actor)
            self._write_state_unsafe(state)
            item["item_count"] = len([row for row in state.get("archive_catalog_items", []) if row.get("catalog_id") == item.get("id") and row.get("status") != "disabled"])
            return item

    def disable_archive_catalog(self, catalog_id: str, actor: str = "admin") -> dict[str, Any] | None:
        return self.update_archive_catalog(catalog_id, {"status": "disabled"}, actor=actor)

    def archive_catalogs_by_scope(self, scope_id: str, user_id: str | None = None) -> list[dict[str, Any]]:
        return self.list_archive_catalogs(scope_id=scope_id, user_id=user_id)

    def list_archive_catalog_items(self, filters: dict[str, str] | None = None, user_id: str | None = None, action: str = "read") -> list[dict[str, Any]]:
        state = self.state()
        items = [dict(item) for item in state.get("archive_catalog_items", [])]
        if user_id:
            visible_catalog_ids = {
                str(catalog.get("id")) for catalog in state.get("archive_catalogs", [])
                if self.can_user_access_catalog(state, catalog, user_id, action)
            }
            items = [item for item in items if str(item.get("catalog_id")) in visible_catalog_ids]
        filters = filters or {}
        scope_id = (filters.get("scope_id") or "").strip()
        category = (filters.get("category") or "").strip()
        required = (filters.get("required") or "").strip().lower()
        status_value = (filters.get("status") or "").strip()
        catalog_id = (filters.get("catalog_id") or "").strip()
        if scope_id:
            items = [item for item in items if item.get("scope_id") == scope_id]
        if category:
            items = [item for item in items if item.get("category") == category]
        if catalog_id:
            items = [item for item in items if item.get("catalog_id") == catalog_id]
        if required in {"true", "false"}:
            expected = required == "true"
            items = [item for item in items if bool(item.get("required")) is expected]
        if status_value:
            items = [item for item in items if item.get("status") == status_value]
        return sorted(items, key=lambda item: (item.get("scope_name", ""), item.get("sort_order", 0), item.get("document_name_rule", "")))

    def update_catalog_permissions(self, catalog_id: str, payload: dict[str, Any], actor: str = "admin") -> dict[str, Any] | None:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            catalog = next((item for item in state.get("archive_catalogs", []) if item.get("id") == catalog_id), None)
            if not catalog:
                return None
            self._validate_permission_subjects(state, payload)
            policy = {
                "user_ids": list(payload.get("user_ids") or []),
                "role_ids": list(payload.get("role_ids") or []),
                "department_ids": list(payload.get("department_ids") or []),
                "deny_user_ids": list(payload.get("deny_user_ids") or []),
                "deny_role_ids": list(payload.get("deny_role_ids") or []),
                "deny_department_ids": list(payload.get("deny_department_ids") or []),
                "allowed_actions": list(payload.get("allowed_actions") or []),
                "inherit_to_documents": bool(payload.get("inherit_to_documents", True)),
            }
            state.setdefault("catalog_permissions", {})[catalog_id] = policy
            self._append_log(state, "archive.catalog.permission.update", catalog_id, f"更新档案目录《{catalog.get('name', '')}》权限", actor=actor)
            self._write_state_unsafe(state)
            return {"catalog_id": catalog_id, **policy}

    def create_archive_catalog_item(self, payload: dict[str, Any], actor: str = "admin") -> dict[str, Any]:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            catalog_id = str(payload.get("catalog_id") or "").strip()
            if not catalog_id:
                matched_catalog = next(
                    (
                        item for item in state.get("archive_catalogs", [])
                        if item.get("scope_id") == payload.get("scope_id") and item.get("status") == "active"
                    ),
                    None,
                )
                if matched_catalog:
                    catalog_id = str(matched_catalog.get("id") or "")
            item = {
                "id": _new_id("catalog"),
                **payload,
                "catalog_id": catalog_id,
            }
            state.setdefault("archive_catalog_items", []).append(item)
            self._append_log(state, "archive.catalog_item.create", item["id"], f"新增档案目录项《{item['document_name_rule']}》", actor=actor)
            self._write_state_unsafe(state)
            return item

    def update_archive_catalog_item(self, item_id: str, payload: dict[str, Any], actor: str = "admin") -> dict[str, Any] | None:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            idx = next((i for i, item in enumerate(state.get("archive_catalog_items", [])) if item.get("id") == item_id), -1)
            if idx < 0:
                return None
            item = dict(state["archive_catalog_items"][idx])
            for key, value in payload.items():
                if value is not None:
                    item[key] = value
            state["archive_catalog_items"][idx] = item
            self._append_log(state, "archive.catalog_item.update", item_id, f"更新档案目录项《{item['document_name_rule']}》", actor=actor)
            self._write_state_unsafe(state)
            return item

    def list_archive_documents(self, filters: dict[str, str], user_id: str | None = None) -> dict[str, Any]:
        state = self.state()
        docs = [self._enrich_document(d, state, include_content=False) for d in state["documents"]]
        docs = [d for d in docs if d.get("status") != "deleted"]
        docs = [d for d in docs if self.can_user_access_document(state, d, user_id)]
        for key in ["department_id", "org_unit_id", "archive_category", "document_type", "filing_year", "filing_status", "knowledge_sync_status", "confidentiality_level"]:
            value = (filters.get(key) or "").strip()
            if value:
                docs = [d for d in docs if str(d.get(key, "")) == value]
        ai_enabled = (filters.get("ai_enabled") or "").strip().lower()
        if ai_enabled in {"true", "false"}:
            expected = ai_enabled == "true"
            docs = [d for d in docs if bool(d.get("ai_enabled")) is expected]
        q = (filters.get("q") or "").strip().lower()
        if q:
            docs = [
                d for d in docs if q in d.get("title", "").lower()
                or q in d.get("archive_path", "").lower()
                or q in d.get("document_code", "").lower()
                or q in d.get("org_path", "").lower()
            ]
        for doc in docs:
            gate = self.document_ai_gate(doc)
            doc["ai_gate_allowed"] = bool(gate.get("allowed"))
            doc["ai_gate_block_reason"] = str(gate.get("block_reason") or "")
        return {"documents": docs, "total": len(docs), "filters": self.document_filters(state)}

    def match_document_to_catalog_item(self, doc: dict[str, Any], item: dict[str, Any]) -> bool:
        if str(item.get("status") or "") != "active":
            return False
        item_scope_id = str(item.get("scope_id") or "")
        doc_scope_id = str(doc.get("org_unit_id") or doc.get("department_id") or "")
        if item_scope_id and item_scope_id != doc_scope_id:
            return False
        doc_catalog_id = str(doc.get("archive_catalog_id") or "").strip()
        item_id = str(item.get("id") or "")
        if doc_catalog_id:
            return doc_catalog_id == item_id
        item_category = _normalize_text(item.get("category"))
        item_rule = _normalize_text(item.get("document_name_rule"))
        item_subcategory = _normalize_text(item.get("subcategory"))
        matching_rule = _normalize_text(item.get("matching_rule"))
        doc_archive_category = _normalize_text(doc.get("archive_category"))
        doc_document_type = _normalize_text(doc.get("document_type"))
        doc_title = _normalize_text(doc.get("title"))
        haystack = " ".join(part for part in [doc_archive_category, doc_document_type, doc_title] if part).strip()
        if item_category and item_category != doc_archive_category:
            return False
        if item_rule and item_rule in {doc_document_type, doc_title}:
            return True
        if item_subcategory and item_subcategory in {doc_document_type, doc_title}:
            return True
        if item_rule and item_rule and item_rule in haystack:
            return True
        if item_subcategory and item_subcategory and item_subcategory in haystack:
            return True
        if matching_rule.startswith("title contains "):
            token = matching_rule.replace("title contains ", "", 1).strip()
            if token and token in doc_title:
                return True
        if matching_rule.startswith("category equals "):
            token = matching_rule.replace("category equals ", "", 1).strip()
            if token and token == doc_archive_category:
                return True
        return bool(item_category and item_category == doc_archive_category and any([doc_document_type, doc_title]))

    def document_ai_gate(self, doc: dict[str, Any], *, allow_external_content: bool = False) -> dict[str, Any]:
        if not bool(doc.get("ai_enabled")):
            return {"allowed": False, "block_reason": "文档未启用 AI"}
        if str(doc.get("filing_status") or "") != "filed":
            return {"allowed": False, "block_reason": "文档尚未完成归档"}
        if bool(doc.get("redaction_required")) and str(doc.get("redaction_status") or "") != "completed":
            return {"allowed": False, "block_reason": "文档要求脱敏但尚未完成脱敏"}
        if str(doc.get("confidentiality_level") or "") == "sensitive":
            return {"allowed": False, "block_reason": "敏感文档默认禁止进入 AI"}
        if str(doc.get("confidentiality_level") or "") == "restricted" and str(doc.get("ai_review_status") or "") != "approved":
            return {"allowed": False, "block_reason": "受限文档须经 AI 治理审批后才能检索"}
        required_metadata = {
            "org_unit_id": "缺少组织归属信息",
            "document_type": "缺少文档类型，暂不可进入 AI",
            "archive_category": "缺少档案分类，暂不可进入 AI",
        }
        if str(doc.get("ai_usage_scope") or "archive_only") != "archive_only":
            required_metadata["knowledge_dataset_key"] = "缺少知识库标识，暂不可进入 AI"
        for key, reason in required_metadata.items():
            if not str(doc.get(key) or "").strip():
                return {"allowed": False, "block_reason": reason}
        if not allow_external_content and str(doc.get("parse_status") or "") != "parsed":
            return {"allowed": False, "block_reason": "文档解析结果不可用于 AI 入库"}
        content = self._read_content(doc.get("content_path", "")) if doc.get("content_path") else str(doc.get("content_text") or "")
        if not allow_external_content and not str(content or "").strip():
            return {"allowed": False, "block_reason": "文档缺少可用正文内容"}
        return {"allowed": True, "block_reason": ""}

    def _coverage_rows_for_scope(self, state: dict[str, Any], scope_id: str, user_id: str | None = None, catalog_action: str = "coverage") -> dict[str, Any]:
        dept = next((item for item in state.get("departments", []) if item.get("id") == scope_id), None)
        if dept is None:
            raise ValueError("Scope not found")
        docs = [self._enrich_document(d, state, include_content=False) for d in state.get("documents", []) if d.get("status") != "deleted"]
        docs = [d for d in docs if self.can_user_access_document(state, d, user_id)]
        dept_docs = [doc for doc in docs if doc.get("org_unit_id") == scope_id or doc.get("department_id") == scope_id]
        visible_catalog_ids = {
            str(catalog.get("id")) for catalog in state.get("archive_catalogs", [])
            if str(catalog.get("scope_id") or "") == str(scope_id)
            and catalog.get("status") == "active"
            and self.can_user_access_catalog(state, catalog, user_id, catalog_action)
        }
        catalog_items = [item for item in state.get("archive_catalog_items", []) if item.get("scope_id") == scope_id and item.get("status") == "active" and str(item.get("catalog_id")) in visible_catalog_ids]
        rows: list[dict[str, Any]] = []
        required_total = 0
        filed_total = 0
        missing_total = 0
        ai_enabled_total = 0
        ai_blocked_total = 0
        for item in sorted(catalog_items, key=lambda current: (current.get("sort_order", 0), current.get("document_name_rule", ""))):
            matched_docs = [doc for doc in dept_docs if self.match_document_to_catalog_item(doc, item)]
            filed_docs = [doc for doc in matched_docs if str(doc.get("filing_status") or "") == "filed"]
            preferred_docs = filed_docs or matched_docs
            matched_payload = []
            ai_allowed_docs: list[dict[str, Any]] = []
            for doc in preferred_docs:
                gate = self.document_ai_gate(doc)
                dataset_mapping = self._resolve_dataset_mapping(doc, state)
                if gate.get("allowed"):
                    ai_allowed_docs.append(doc)
                matched_payload.append({
                    "id": doc.get("id", ""),
                    "title": doc.get("title", ""),
                    "filing_status": doc.get("filing_status", ""),
                    "filing_year": doc.get("filing_year", ""),
                    "ai_enabled": bool(doc.get("ai_enabled")),
                    "knowledge_sync_status": doc.get("knowledge_sync_status", ""),
                    "knowledge_dataset_key": str(doc.get("knowledge_dataset_key") or ""),
                    "dataset_mapping": dataset_mapping,
                    "ai_gate_allowed": bool(gate.get("allowed")),
                    "ai_gate_block_reason": str(gate.get("block_reason") or ""),
                })
            missing = bool(item.get("required")) and not filed_docs
            if item.get("required"):
                required_total += 1
            if filed_docs:
                filed_total += 1
            if missing:
                missing_total += 1
            ai_enabled_total += len(ai_allowed_docs)
            ai_blocked_total += len(preferred_docs) - len(ai_allowed_docs)
            primary_match = matched_payload[0] if matched_payload else None
            ai_block_reason = ""
            if missing:
                ai_block_reason = "档案目录项尚未完成归档"
            elif primary_match and not primary_match["ai_gate_allowed"]:
                ai_block_reason = str(primary_match.get("ai_gate_block_reason") or "")
            elif not primary_match:
                ai_block_reason = "暂无匹配文档"
            rows.append({
                "catalog_item_id": item.get("id", ""),
                "scope_id": scope_id,
                "scope_name": dept.get("name", ""),
                "category": item.get("category", ""),
                "subcategory": item.get("subcategory", ""),
                "document_name_rule": item.get("document_name_rule", ""),
                "required": bool(item.get("required")),
                "missing": missing,
                "matched_documents": matched_payload,
                "ai_ready": bool(ai_allowed_docs),
                "ai_block_reason": ai_block_reason,
                "knowledge_sync_status": primary_match.get("knowledge_sync_status", "missing") if primary_match else "missing",
                "knowledge_dataset_key": primary_match.get("knowledge_dataset_key", "") if primary_match else "",
                "dataset_mapping": primary_match.get("dataset_mapping") if primary_match else None,
            })
        coverage_rate = round((filed_total / required_total) * 100, 1) if required_total else 100.0
        return {
            "scope_id": scope_id,
            "scope_name": dept.get("name", ""),
            "required_total": required_total,
            "filed_total": filed_total,
            "missing_total": missing_total,
            "ai_enabled_total": ai_enabled_total,
            "ai_blocked_total": ai_blocked_total,
            "coverage_rate": coverage_rate,
            "items": rows,
        }

    def archive_overview(self, user_id: str | None = None) -> list[dict[str, Any]]:
        state = self.state()
        allowed_scope_ids = {
            str(catalog.get("scope_id") or "") for catalog in state.get("archive_catalogs", [])
            if catalog.get("status") == "active" and self.can_user_access_catalog(state, catalog, user_id, "coverage")
        }
        rows = []
        for dept in state.get("departments", []):
            if str(dept.get("id")) not in allowed_scope_ids:
                continue
            rows.append(self._coverage_rows_for_scope(state, dept["id"], user_id=user_id, catalog_action="coverage"))
        return rows

    def archive_scope_detail(self, scope_id: str, user_id: str | None = None) -> dict[str, Any] | None:
        state = self.state()
        allowed = any(
            str(catalog.get("scope_id") or "") == str(scope_id)
            and catalog.get("status") == "active"
            and self.can_user_access_catalog(state, catalog, user_id, "coverage")
            for catalog in state.get("archive_catalogs", [])
        )
        if not allowed:
            return None
        try:
            return self._coverage_rows_for_scope(state, scope_id, user_id=user_id, catalog_action="coverage")
        except ValueError:
            return None

    def archive_missing_items(self, user_id: str | None = None, filing_year: str = "", filing_period: str = "") -> dict[str, Any]:
        state = self.state()
        filing_year = str(filing_year or "").strip()
        filing_period = str(filing_period or "").strip()
        items: list[dict[str, Any]] = []
        catalog_items = {item.get("id", ""): item for item in state.get("archive_catalog_items", [])}
        user = self._user_context(state, user_id)
        if user and not user.get("is_admin") and "archive:write" not in set(user.get("role", {}).get("permissions", [])):
            return {"items": [], "total": 0}
        allowed_scope_ids = {
            str(catalog.get("scope_id") or "") for catalog in state.get("archive_catalogs", [])
            if catalog.get("status") == "active" and self.can_user_access_catalog(state, catalog, user_id, "missing")
        }
        for dept in state.get("departments", []):
            if str(dept.get("id")) not in allowed_scope_ids:
                continue
            detail = self._coverage_rows_for_scope(state, dept["id"], user_id=user_id, catalog_action="missing")
            for row in detail.get("items", []):
                if not row.get("missing"):
                    continue
                catalog_item = catalog_items.get(row.get("catalog_item_id", ""), {})
                row_filing_period = str(catalog_item.get("archive_period") or "")
                if filing_period and row_filing_period != filing_period:
                    continue
                matched_documents = row.get("matched_documents", [])
                representative = matched_documents[0] if matched_documents else {}
                if filing_year and str(representative.get("filing_year") or "") not in {"", filing_year}:
                    continue
                items.append({
                    "scope_id": row.get("scope_id", ""),
                    "scope_name": row.get("scope_name", ""),
                    "catalog_item_id": row.get("catalog_item_id", ""),
                    "category": row.get("category", ""),
                    "subcategory": row.get("subcategory", ""),
                    "document_name_rule": row.get("document_name_rule", ""),
                    "required": True,
                    "matched_documents": matched_documents,
                    "filing_year": filing_year or str(representative.get("filing_year") or ""),
                    "filing_period": row_filing_period,
                    "archive_owner_id": str(representative.get("archive_owner_id") or ""),
                    "review_owner_id": str(representative.get("review_owner_id") or ""),
                    "owner_role": str(catalog_item.get("owner_role") or ""),
                })
        return {"items": items, "total": len(items)}

    def export_archive_missing_items(self, user_id: str | None = None, filing_year: str = "", filing_period: str = "") -> str:
        data = self.archive_missing_items(user_id=user_id, filing_year=filing_year, filing_period=filing_period)
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(["部门", "目录项", "分类", "子分类", "归档年度", "归档周期", "档案责任人", "复核责任人", "责任角色"])
        for item in data.get("items", []):
            writer.writerow([
                item.get("scope_name", ""),
                item.get("document_name_rule", ""),
                item.get("category", ""),
                item.get("subcategory", ""),
                item.get("filing_year", ""),
                item.get("filing_period", ""),
                item.get("archive_owner_id", ""),
                item.get("review_owner_id", ""),
                item.get("owner_role", ""),
            ])
        return buffer.getvalue()

    def _resolve_dataset_mapping(self, doc: dict[str, Any], state: dict[str, Any]) -> dict[str, Any] | None:
        mappings = [
            dict(item)
            for item in state.get("knowledge_dataset_mappings", [])
            if bool(item.get("enabled", True))
        ]
        mappings.sort(key=lambda item: int(item.get("priority") or 0), reverse=True)
        doc_scope_id = str(doc.get("org_unit_id") or doc.get("department_id") or "")
        doc_archive_category = str(doc.get("archive_category") or "")
        doc_document_type = str(doc.get("document_type") or "")
        # Restricted documents must never fall through to a department route.
        if str(doc.get("confidentiality_level") or "") == "restricted":
            return next(
                (item for item in mappings if str(item.get("security_domain") or "") == "restricted"),
                None,
            )
        # Public documents must route to the public domain before a
        # department-specific rule is considered.
        if str(doc.get("visibility") or "department") == "public":
            public = next((item for item in mappings if str(item.get("security_domain") or "") == "public"), None)
            if public and str(public.get("ai_usage_scope") or "archive_only") != "archive_only":
                return public
        for item in mappings:
            # Global public/restricted routes are selected only by the checks
            # above and must never become generic fallbacks.
            if str(item.get("security_domain") or "") in {"public", "restricted"}:
                continue
            scope_id = str(item.get("scope_id") or "")
            archive_category = str(item.get("archive_category") or "")
            document_type = str(item.get("document_type") or "")
            if scope_id and scope_id != doc_scope_id:
                continue
            if archive_category and archive_category != doc_archive_category:
                continue
            if document_type and document_type != doc_document_type:
                continue
            # ai_usage_scope controls whether a document may enter AI and
            # whether it may answer questions; it does not change the
            # security domain or Dataset route.
            return item
        # When a department has a single route, use it as the default for
        # uncategorized documents. More specific category rules above still
        # take precedence.
        department_routes = [
            item for item in mappings
            if str(item.get("scope_id") or "") == doc_scope_id
            and str(item.get("security_domain") or "") not in {"public", "restricted"}
        ]
        if len(department_routes) == 1:
            return department_routes[0]
        return None

    def knowledge_domain_for_document(self, doc: dict[str, Any], state: dict[str, Any] | None = None) -> str:
        """Return the stable ERP knowledge-domain key for a document."""
        state = state or self.state()
        mappings = state.get("knowledge_dataset_mappings", [])
        # Classification changes must override a stale domain saved before
        # the document was marked restricted.
        if str(doc.get("confidentiality_level") or "") == "restricted":
            restricted = next(
                (item for item in mappings if str(item.get("security_domain") or "") == "restricted" and bool(item.get("enabled", True))),
                None,
            )
            if restricted:
                return str(restricted.get("dataset_key") or "")
        explicit = str(doc.get("knowledge_dataset_key") or "").strip()
        if explicit and any(str(item.get("dataset_key") or "") == explicit for item in mappings):
            return explicit
        mapping = self._resolve_dataset_mapping(doc, state)
        if mapping:
            return str(mapping.get("dataset_key") or "")
        return explicit

    def allowed_knowledge_dataset_keys(self, user_id: str | None) -> set[str]:
        """Return Dataset keys the user may query, independent of query text."""
        state = self.state()
        user = self._user_context(state, user_id)
        if user is None:
            return set()
        mappings = [item for item in state.get("knowledge_dataset_mappings", []) if bool(item.get("enabled", True)) and str(item.get("dataset_key") or "")]
        if user.get("is_admin"):
            allowed = {str(item.get("dataset_key")) for item in mappings}
        else:
            role_id = str(user.get("role_id") or "")
            department_id = str(user.get("department_id") or "")
            allowed = set()
            for item in mappings:
                roles = {str(value) for value in (item.get("allowed_role_ids") or [])}
                departments = {str(value) for value in (item.get("allowed_department_ids") or [])}
                scope_id = str(item.get("scope_id") or "")
                # A public domain without an explicit whitelist is available
                # to every authenticated role that has document:read. This
                # keeps newly-created roles out of hard-coded demo IDs.
                if str(item.get("security_domain") or "") == "public" and not roles and not departments:
                    if "document:read" in set(user.get("role", {}).get("permissions", [])):
                        allowed.add(str(item.get("dataset_key")))
                elif roles or departments or scope_id:
                    if role_id in roles or department_id in departments or department_id == scope_id:
                        allowed.add(str(item.get("dataset_key")))
        return allowed

    def get_dataset_mappings(self) -> list[dict[str, Any]]:
        state = self.state()
        return sorted(
            [dict(item) for item in state.get("knowledge_dataset_mappings", [])],
            key=lambda item: (-int(item.get("priority") or 0), item.get("scope_name", ""), item.get("dataset_name", "")),
        )

    def update_dataset_mappings(self, mappings: list[dict[str, Any]], actor: str = "admin") -> list[dict[str, Any]]:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            normalized: list[dict[str, Any]] = []
            seen_keys: set[str] = set()
            for item in mappings:
                dataset_key = str(item.get("dataset_key") or "").strip()
                if not dataset_key:
                    raise ValueError("Dataset Key 不能为空")
                if dataset_key in seen_keys:
                    raise ValueError(f"Dataset Key 重复: {dataset_key}")
                seen_keys.add(dataset_key)
                self._validate_permission_subjects(state, {
                    "role_ids": item.get("allowed_role_ids") or [],
                    "department_ids": item.get("allowed_department_ids") or [],
                })
                normalized.append({
                    "id": str(item.get("id") or _new_id("datasetmap")),
                    "scope_type": str(item.get("scope_type") or "department"),
                    "scope_id": str(item.get("scope_id") or ""),
                    "scope_name": str(item.get("scope_name") or ""),
                    "archive_category": str(item.get("archive_category") or ""),
                    "document_type": str(item.get("document_type") or ""),
                    "ai_usage_scope": str(item.get("ai_usage_scope") or "ai_search"),
                    "dataset_key": dataset_key,
                    "dataset_name": str(item.get("dataset_name") or ""),
                    "dataset_id": str(item.get("dataset_id") or ""),
                    "security_domain": str(item.get("security_domain") or item.get("scope_id") or "department"),
                    "allowed_role_ids": [str(value) for value in (item.get("allowed_role_ids") or [])],
                    "allowed_department_ids": [str(value) for value in (item.get("allowed_department_ids") or [])],
                    "enabled": bool(item.get("enabled", True)),
                    "priority": int(item.get("priority") or 0),
                    "note": str(item.get("note") or ""),
                })
            state["knowledge_dataset_mappings"] = normalized
            self._append_log(state, "archive.dataset_mapping.update", "knowledge-datasets", f"更新 dataset 映射 {len(normalized)} 项", actor=actor)
            self._write_state_unsafe(state)
            return normalized

    def export_knowledge_migration_inventory(self) -> str:
        """Create a reviewable CSV manifest before documents are moved between Dify datasets."""
        state = self.state()
        departments = {str(item.get("id")): str(item.get("name") or "") for item in state.get("departments", [])}
        catalogs = {str(item.get("id")): item for item in state.get("archive_catalogs", [])}
        catalog_items = {str(item.get("id")): item for item in state.get("archive_catalog_items", [])}
        mappings = {str(item.get("dataset_key")): item for item in state.get("knowledge_dataset_mappings", [])}
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow([
            "文档ID", "文档名称", "所属部门", "档案目录", "知识域", "目标Dataset ID",
            "密级", "可见范围", "可见角色", "可见部门", "可见用户", "允许AI检索",
            "ERP同步状态", "当前Dify文档ID", "当前Dify Dataset ID", "迁移确认",
        ])
        for doc in state.get("documents", []):
            if doc.get("status") == "deleted":
                continue
            doc_id = str(doc.get("id") or "")
            catalog_ref = str(doc.get("archive_catalog_id") or "")
            catalog_item = catalog_items.get(catalog_ref, {})
            catalog = catalogs.get(catalog_ref) or catalogs.get(str(catalog_item.get("catalog_id") or ""), {})
            domain = self.knowledge_domain_for_document(doc, state)
            mapping = mappings.get(domain, {})
            permissions = state.get("permissions", {}).get(doc_id, {})
            writer.writerow([
                doc_id,
                doc.get("title") or doc.get("file_name") or "",
                departments.get(str(doc.get("org_unit_id") or doc.get("department_id") or ""), ""),
                catalog_item.get("document_name_rule") or catalog.get("name") or doc.get("archive_path") or "",
                domain,
                mapping.get("dataset_id") or "兼容旧单库",
                doc.get("confidentiality_level") or "",
                doc.get("visibility") or "",
                ",".join(str(value) for value in permissions.get("role_ids", [])),
                ",".join(str(value) for value in permissions.get("department_ids", [])),
                ",".join(str(value) for value in permissions.get("user_ids", [])),
                "是" if self.document_ai_gate(doc).get("allowed") else "否",
                doc.get("knowledge_sync_status") or "",
                doc.get("dify_document_id") or "",
                doc.get("dify_dataset_id") or "",
                "待确认",
            ])
        return buffer.getvalue()

    def get_archive_document(self, document_id: str, user_id: str | None = None) -> dict[str, Any] | None:
        state = self.state()
        doc = next((d for d in state["documents"] if d["id"] == document_id and d.get("status") != "deleted"), None)
        if not doc:
            return None
        if not self.can_user_access_document(state, doc, user_id):
            return None
        item = self._enrich_document(doc, state, include_content=True)
        gate = self.document_ai_gate(item)
        item["ai_gate_allowed"] = bool(gate.get("allowed"))
        item["ai_gate_block_reason"] = str(gate.get("block_reason") or "")
        catalog_item = next((row for row in state.get("archive_catalog_items", []) if row.get("id") == item.get("archive_catalog_id")), None)
        item["catalog_item"] = dict(catalog_item) if catalog_item else None
        if catalog_item:
            catalog = next((row for row in state.get("archive_catalogs", []) if row.get("id") == catalog_item.get("catalog_id")), None)
            item["catalog"] = dict(catalog) if catalog else None
        else:
            item["catalog"] = None
        latest_review = next((row for row in state.get("ai_review_records", []) if row.get("document_id") == document_id), None)
        item["latest_ai_review"] = dict(latest_review) if latest_review else None
        item["dataset_mapping"] = self._resolve_dataset_mapping(item, state)
        item["related_audit_logs"] = [
            dict(log) for log in state.get("audit_logs", [])
            if log.get("target") == document_id and str(log.get("action") or "").startswith(("archive.", "ai.", "dify."))
        ][:12]
        return item

    def list_documents_for_catalog_item(self, item_id: str, user_id: str | None = None) -> list[dict[str, Any]]:
        state = self.state()
        catalog_item = next((row for row in state.get("archive_catalog_items", []) if row.get("id") == item_id), None)
        if catalog_item is None:
            return []
        docs = [self._enrich_document(d, state, include_content=False) for d in state.get("documents", []) if d.get("status") != "deleted"]
        docs = [d for d in docs if self.can_user_access_document(state, d, user_id)]
        scope_catalog_items = [
            row for row in state.get("archive_catalog_items", [])
            if str(row.get("scope_id") or "") == str(catalog_item.get("scope_id") or "")
            and row.get("status") == "active"
        ]
        matched = []
        for doc in docs:
            if self.match_document_to_catalog_item(doc, catalog_item):
                matched.append(doc)
            elif (
                not doc.get("archive_catalog_id")
                and len(scope_catalog_items) == 1
                and str(doc.get("org_unit_id") or doc.get("department_id") or "")
                == str(catalog_item.get("scope_id") or "")
            ):
                # Older Dify links stored only the organization. Treat the
                # organization's sole active catalog item as the implicit match.
                doc["archive_catalog_id"] = catalog_item.get("id", "")
                doc["archive_category"] = catalog_item.get("category") or doc.get("archive_category", "")
                doc["document_type"] = catalog_item.get("subcategory") or doc.get("document_type", "")
                matched.append(doc)
        for doc in matched:
            gate = self.document_ai_gate(doc)
            doc["ai_gate_allowed"] = bool(gate.get("allowed"))
            doc["ai_gate_block_reason"] = str(gate.get("block_reason") or "")
        return matched

    def match_archive_document_to_catalog(self, document_id: str, item_id: str, actor: str = "admin") -> dict[str, Any] | None:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            idx = next((i for i, d in enumerate(state.get("documents", [])) if d.get("id") == document_id and d.get("status") != "deleted"), -1)
            if idx < 0:
                return None
            catalog_item = next((row for row in state.get("archive_catalog_items", []) if row.get("id") == item_id), None)
            if catalog_item is None:
                return None
            doc = dict(state["documents"][idx])
            doc_scope_id = str(doc.get("org_unit_id") or doc.get("department_id") or "").strip()
            item_scope_id = str(catalog_item.get("scope_id") or "").strip()
            if str(catalog_item.get("status") or "") != "active" or (item_scope_id and item_scope_id != doc_scope_id):
                return None
            doc["archive_catalog_id"] = catalog_item.get("id", "")
            doc["archive_category"] = catalog_item.get("category") or doc.get("archive_category", "")
            doc["document_type"] = catalog_item.get("subcategory") or doc.get("document_type", "")
            doc["filing_period"] = catalog_item.get("archive_period") or doc.get("filing_period", "")
            doc["retention_period"] = catalog_item.get("retention_policy") or doc.get("retention_period", "")
            doc["visibility"] = catalog_item.get("default_visibility") or doc.get("visibility", "department")
            doc["is_required"] = bool(catalog_item.get("required"))
            doc["ai_enabled"] = bool(catalog_item.get("default_ai_enabled", doc.get("ai_enabled", False)))
            doc["ai_usage_scope"] = catalog_item.get("default_ai_usage_type") or doc.get("ai_usage_scope", "archive_only")
            if not bool(catalog_item.get("ai_allowed", True)):
                doc["ai_enabled"] = False
                doc["ai_usage_scope"] = "archive_only"
                doc["knowledge_sync_status"] = "disabled"
            dataset_mapping = self._resolve_dataset_mapping(doc, state)
            if dataset_mapping and not str(doc.get("knowledge_dataset_key") or "").strip():
                doc["knowledge_dataset_key"] = str(dataset_mapping.get("dataset_key") or "")
            doc["updated_at"] = _utc_now()
            state["documents"][idx] = doc
            self._append_log(state, "archive.catalog.match", document_id, f"文档《{doc['title']}》匹配到目录项《{catalog_item.get('document_name_rule', '')}》", actor=actor)
            self._write_state_unsafe(state)
        return self.get_archive_document(document_id)

    def transfer_archive_document_scope(
        self,
        document_id: str,
        target_scope_id: str,
        target_catalog_item_id: str = "",
        visibility: str = "department",
        role_ids: list[str] | None = None,
        user_ids: list[str] | None = None,
        actor: str = "admin",
    ) -> dict[str, Any] | None:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            idx = next((i for i, d in enumerate(state.get("documents", [])) if d.get("id") == document_id and d.get("status") != "deleted"), -1)
            target_scope = next((row for row in state.get("departments", []) if str(row.get("id")) == str(target_scope_id)), None)
            target_item = None
            if target_catalog_item_id:
                target_item = next((row for row in state.get("archive_catalog_items", []) if row.get("id") == target_catalog_item_id), None)
                if target_item is None or str(target_item.get("scope_id") or "") != str(target_scope_id) or str(target_item.get("status") or "") != "active":
                    return None
            if idx < 0 or target_scope is None:
                return None
            self._validate_permission_subjects(state, {"role_ids": role_ids or [], "user_ids": user_ids or [], "department_ids": [str(target_scope_id)]})
            doc = dict(state["documents"][idx])
            old_scope_id = str(doc.get("org_unit_id") or doc.get("department_id") or "")
            doc["department_id"] = str(target_scope_id)
            doc["org_unit_id"] = str(target_scope_id)
            doc["org_path"] = str(target_scope.get("name") or "")
            doc["access_scope_type"] = "department"
            doc["access_scope_ids"] = [str(target_scope_id)]
            if str(doc.get("knowledge_sync_status") or "") == "synced":
                doc["knowledge_sync_status"] = "pending"
                doc["dify_sync_status"] = "stale"
            if target_item is not None:
                doc["archive_catalog_id"] = target_item.get("id", "")
                doc["archive_category"] = target_item.get("category") or doc.get("archive_category", "")
                doc["document_type"] = target_item.get("subcategory") or doc.get("document_type", "")
                doc["filing_period"] = target_item.get("archive_period") or doc.get("filing_period", "")
                doc["retention_period"] = target_item.get("retention_policy") or doc.get("retention_period", "")
                target_tree_node = next(
                    (
                        row for row in state.get("archive_tree_nodes", [])
                        if str(row.get("catalog_item_id") or "") == str(target_item.get("id") or "")
                        and row.get("status") != "disabled"
                    ),
                    None,
                )
                doc["archive_tree_node_id"] = str(target_tree_node.get("id")) if target_tree_node else ""
            else:
                doc["archive_catalog_id"] = ""
                doc["archive_tree_node_id"] = ""
            doc["visibility"] = visibility or "department"
            mapping = self._resolve_dataset_mapping({**doc, "knowledge_dataset_key": ""}, state)
            doc["knowledge_dataset_key"] = str((mapping or {}).get("dataset_key") or "")
            doc["updated_at"] = _utc_now()
            state["documents"][idx] = doc
            state.setdefault("permissions", {})[document_id] = {
                "user_ids": list(user_ids or []) if doc["visibility"] in {"role", "private"} else [],
                "role_ids": list(role_ids or []) if doc["visibility"] == "role" else [],
                "department_ids": [str(target_scope_id)] if doc["visibility"] == "department" else [],
                "catalog_ids": [],
                "deny_user_ids": [],
                "deny_role_ids": [],
                "deny_department_ids": [],
                "download_enabled": False,
            }
            self._append_log(state, "archive.scope.transfer", document_id, f"文档《{doc.get('title', '')}》组织从 {old_scope_id or '未设置'} 调整为 {target_scope.get('name', target_scope_id)}", actor=actor)
            self._write_state_unsafe(state)
        return self.get_archive_document(document_id)

    def list_ai_governance_documents(self, user_id: str | None = None) -> dict[str, Any]:
        data = self.list_archive_documents({}, user_id=user_id)
        for doc in data["documents"]:
            gate = self.document_ai_gate(doc)
            doc["ai_gate_allowed"] = bool(gate.get("allowed"))
            doc["ai_gate_block_reason"] = str(gate.get("block_reason") or "")
            doc["dataset_mapping"] = self._resolve_dataset_mapping(doc, self.state())
        return data

    def list_ai_sync_candidates(self, user_id: str | None = None) -> dict[str, Any]:
        state = self.state()
        docs = [self._enrich_document(d, state, include_content=False) for d in state.get("documents", []) if d.get("status") != "deleted"]
        docs = [d for d in docs if self.can_user_access_document(state, d, user_id)]
        candidates: list[dict[str, Any]] = []
        for doc in docs:
            gate = self.document_ai_gate(doc)
            if gate.get("allowed") and str(doc.get("knowledge_sync_status") or "") in {"pending", "failed", "stale"}:
                doc["ai_gate_allowed"] = True
                doc["ai_gate_block_reason"] = ""
                candidates.append(doc)
        return {"documents": candidates, "total": len(candidates), "filters": self.document_filters(state)}

    def update_ai_policy(self, document_id: str, payload: dict[str, Any], actor: str = "admin") -> dict[str, Any] | None:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            idx = next((i for i, d in enumerate(state["documents"]) if d["id"] == document_id and d.get("status") != "deleted"), -1)
            if idx < 0:
                return None
            previous = dict(state["documents"][idx])
            doc = dict(previous)
            dirty_fields = {"ai_enabled", "ai_usage_scope", "knowledge_sync_status", "knowledge_dataset_key", "redaction_required", "redaction_status", "confidentiality_level", "filing_status"}
            note_fields = {"ai_review_note", "ai_block_reason", "ai_review_status", "last_ai_reviewed_by"}
            touched = False
            notes_touched = False
            for key, value in payload.items():
                if value is not None:
                    doc[key] = value
                    touched = touched or key in dirty_fields
                    notes_touched = notes_touched or key in note_fields
            review_reasons = _governance_recheck_reasons(previous, doc)
            if doc.get("ai_enabled") is False:
                doc["knowledge_sync_status"] = "disabled"
            elif touched and str(doc.get("knowledge_sync_status") or "") == "synced":
                doc["knowledge_sync_status"] = "pending"
                doc["dify_sync_status"] = "stale"
            if review_reasons:
                doc["ai_review_status"] = "pending"
                doc["review_pending_reason"] = "、".join(review_reasons)
                if not notes_touched:
                    doc["ai_review_note"] = ""
                    doc["ai_block_reason"] = ""
                doc["last_reviewed_at"] = _utc_now()
                self._append_log(state, "ai.review.pending", document_id, f"文档《{doc['title']}》因{doc['review_pending_reason']}进入待复核", actor=actor)
            elif notes_touched:
                doc["last_reviewed_at"] = _utc_now()
            doc["updated_at"] = _utc_now()
            state["documents"][idx] = doc
            self._append_log(state, "ai.policy.update", document_id, f"更新文档《{doc['title']}》AI 治理策略", actor=actor)
            self._write_state_unsafe(state)
            item = self._enrich_document(doc, state, include_content=True)
            gate = self.document_ai_gate(item)
            item["ai_gate_allowed"] = bool(gate.get("allowed"))
            item["ai_gate_block_reason"] = str(gate.get("block_reason") or "")
            return item

    def review_ai_document(self, document_id: str, payload: dict[str, Any], actor: str = "admin") -> dict[str, Any] | None:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            idx = next((i for i, d in enumerate(state["documents"]) if d["id"] == document_id and d.get("status") != "deleted"), -1)
            if idx < 0:
                return None
            doc = dict(state["documents"][idx])
            actor_user = next((item for item in state.get("users", []) if item.get("id") == actor), {})
            reviewed_at = _utc_now()
            review_status = str(payload.get("status") or "rejected")
            note = str(payload.get("note") or "")
            block_reason = str(payload.get("block_reason") or "")
            doc["ai_review_status"] = review_status
            doc["ai_review_note"] = note
            doc["ai_block_reason"] = block_reason
            doc["review_pending_reason"] = ""
            doc["last_ai_reviewed_at"] = reviewed_at
            doc["last_ai_reviewed_by"] = actor
            doc["last_reviewed_at"] = reviewed_at
            if review_status == "approved":
                doc["ai_enabled"] = True
                if doc.get("knowledge_sync_status") == "disabled":
                    doc["knowledge_sync_status"] = "pending"
            else:
                doc["ai_enabled"] = False
                doc["knowledge_sync_status"] = "disabled"
            doc["updated_at"] = reviewed_at
            state["documents"][idx] = doc
            record = {
                "id": _new_id("aireview"),
                "document_id": document_id,
                "document_title": doc.get("title", ""),
                "status": review_status,
                "note": note,
                "block_reason": block_reason,
                "actor": actor,
                "actor_name": actor_user.get("name", actor),
                "created_at": reviewed_at,
            }
            state.setdefault("ai_review_records", []).insert(0, record)
            state["ai_review_records"] = state["ai_review_records"][:300]
            self._append_log(state, "ai.policy.review", document_id, f"审核文档《{doc['title']}》AI 状态: {review_status}", actor=actor)
            self._write_state_unsafe(state)
            item = self._enrich_document(doc, state, include_content=True)
            gate = self.document_ai_gate(item)
            item["ai_gate_allowed"] = bool(gate.get("allowed"))
            item["ai_gate_block_reason"] = str(gate.get("block_reason") or "")
            item["latest_ai_review"] = record
            return item

    def list_ai_review_records(self, user_id: str | None = None, status: str = "") -> list[dict[str, Any]]:
        state = self.state()
        status = str(status or "").strip()
        visible_docs = {
            doc.get("id")
            for doc in state.get("documents", [])
            if doc.get("status") != "deleted" and self.can_user_access_document(state, doc, user_id)
        }
        records = [dict(item) for item in state.get("ai_review_records", []) if item.get("document_id") in visible_docs]
        if status:
            records = [item for item in records if item.get("status") == status]
        return records

    def batch_update_ai_policy(self, ids: list[str], payload: dict[str, Any], actor: str = "admin") -> dict[str, Any]:
        updated: list[dict[str, Any]] = []
        missing: list[str] = []
        for document_id in ids:
            item = self.update_ai_policy(document_id, payload, actor=actor)
            if item is None:
                missing.append(document_id)
            else:
                updated.append(item)
        return {"updated": updated, "missing": missing, "affected": len(updated)}

    def _ollama_generate(self, prompt: str) -> str:
        payload = json.dumps(
            {"model": "qwen3:8b", "prompt": prompt, "stream": False},
            ensure_ascii=False,
        ).encode("utf-8")
        req = urllib.request.Request(
            "http://127.0.0.1:11434/api/generate",
            data=payload,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return str(data.get("response") or "").strip()

    def _json_from_model_response(self, text: str) -> dict[str, Any]:
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
            cleaned = re.sub(r"\s*```$", "", cleaned)
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            cleaned = cleaned[start : end + 1]
        parsed = json.loads(cleaned)
        if not isinstance(parsed, dict):
            raise ValueError("Model response is not a JSON object")
        return parsed

    def _list_value(self, value: Any, fallback: list[str]) -> list[str]:
        if isinstance(value, list):
            items = [str(item).strip() for item in value if str(item).strip()]
            return items or fallback
        if isinstance(value, str) and value.strip():
            return [value.strip()]
        return fallback

    def build_contract_review_mock(
        self,
        *,
        primary_file_name: str,
        secondary_file_name: str,
        contract_type: str,
        review_focus: str,
        notes: str,
        primary_text: str = "",
        secondary_text: str = "",
    ) -> dict[str, Any]:
        try:
            if primary_text.strip() and secondary_text.strip():
                prompt = f"""
你是企业合同审查助手。请对比两份合同文本，输出严格 JSON，不要输出 Markdown。
JSON 字段必须是：differences、risks、suggestions，三个字段都必须是字符串数组。
重点关注：付款条件、交付与验收、违约责任、保密与数据安全、争议解决，以及用户指定审查重点。

合同类型：{contract_type or '合同'}
审查重点：{review_focus or '付款条件、违约责任、交付边界、保密、验收'}
补充说明：{notes or '无'}

合同 A（{primary_file_name}）：
{primary_text[:30000]}

合同 B（{secondary_file_name}）：
{secondary_text[:30000]}
""".strip()
                parsed = self._json_from_model_response(self._ollama_generate(prompt))
                differences = self._list_value(parsed.get("differences"), ["模型未返回明确差异。"])
                risks = self._list_value(parsed.get("risks"), ["模型未返回明确风险。"])
                suggestions = self._list_value(parsed.get("suggestions"), ["建议补充人工复核。"])
                return {
                    "scene_type": "contract-review",
                    "title": f"{contract_type or '合同'}对比：{primary_file_name}",
                    "summary": f"已基于《{primary_file_name}》与《{secondary_file_name}》生成 AI 合同对比草稿。",
                    "output": {"differences": differences, "risks": risks, "suggestions": suggestions},
                    "citations": [
                        {
                            "document_name": primary_file_name,
                            "document_id": "contract-primary",
                            "segment_id": "ai-contract-primary",
                            "content": primary_text[:600],
                            "score": 0.9,
                        },
                        {
                            "document_name": secondary_file_name,
                            "document_id": "contract-secondary",
                            "segment_id": "ai-contract-secondary",
                            "content": secondary_text[:600],
                            "score": 0.9,
                        },
                    ],
                }
        except Exception:
            pass
        focus_items = [item.strip() for item in re.split(r"[，,、\n]+", review_focus) if item.strip()]
        type_label = contract_type or "合同"
        return {
            "scene_type": "contract-review",
            "title": f"{type_label}对比：{primary_file_name}",
            "summary": f"已基于《{primary_file_name}》与《{secondary_file_name}》生成{type_label}对比草稿。",
            "output": {
                "differences": [
                    f"已建立《{primary_file_name}》与《{secondary_file_name}》的并排审查入口。",
                    f"建议重点核对：{('、'.join(focus_items) if focus_items else '付款条件、违约责任、交付边界')}。",
                    "当前结果为沙箱 mock 返回，后续可替换为真实条款比对与原文定位。",
                ],
                "risks": [
                    "若模板版本未统一，可能导致审批口径不一致。",
                    "如存在补充条款或扫描件内容，建议在正式流程中保留人工复核。",
                    f"补充说明：{notes}" if notes else "建议补充交易背景、金额和业务边界。",
                ],
                "suggestions": [
                    "补充审批依据条款字段，便于后续追溯。",
                    "将比对结果统一定义为草稿，不直接替代法务结论。",
                    "支持一键提交审批确认页，形成受控闭环。",
                ],
            },
            "citations": [
                {
                    "document_name": secondary_file_name,
                    "document_id": "mock-template",
                    "segment_id": "mock-contract-segment",
                    "content": "建议对付款、违约、保密、交付与验收条款做结构化引用。",
                    "score": 0.82,
                }
            ],
        }

    def build_meeting_summary_mock(
        self,
        *,
        topic: str,
        meeting_date: str,
        attendees: str,
        notes: str,
    ) -> dict[str, Any]:
        lines = [line.strip() for line in notes.splitlines() if line.strip()]
        try:
            prompt = f"""
你是企业会议纪要助手。请根据原始会议记录生成结构化纪要，输出严格 JSON，不要输出 Markdown。
JSON 字段必须是：summary、decisions、todos、risks。
summary 是字符串；decisions、todos、risks 是字符串数组。待办应尽量包含责任人和事项。

会议主题：{topic}
会议日期：{meeting_date or '未填写'}
参会人员：{attendees or '未填写'}
原始记录：
{notes[:50000]}
""".strip()
            parsed = self._json_from_model_response(self._ollama_generate(prompt))
            summary = str(parsed.get("summary") or f"{topic} 已整理为纪要草稿。").strip()
            return {
                "scene_type": "meeting-summary",
                "title": f"纪要草稿：{topic}",
                "summary": summary,
                "output": {
                    "summary": summary,
                    "decisions": self._list_value(parsed.get("decisions"), ["暂无可提取决议，请补充原始记录。"]),
                    "todos": self._list_value(parsed.get("todos"), ["暂无可提取待办，请补充任务描述。"]),
                    "risks": self._list_value(parsed.get("risks"), ["如果原始记录来自语音转写，建议上线前补人工校对。"]),
                },
                "citations": [],
            }
        except Exception:
            summary = (
                f"{topic} 已整理为纪要草稿，参会人员：{attendees or '待补充'}。"
                f"主要内容基于原始记录前 {min(len(lines), 3) or 1} 条要点生成。"
            )
            return {
                "scene_type": "meeting-summary",
                "title": f"纪要草稿：{topic}",
                "summary": summary,
                "output": {
                    "summary": summary,
                    "decisions": [
                        f"决议 {idx + 1}：{line[:80]}" for idx, line in enumerate(lines[:3])
                    ] or ["暂无可提取决议，请补充原始记录。"],
                    "todos": [
                        f"待办 {idx + 1}：围绕“{line[:40]}”补充责任人与完成时间。"
                        for idx, line in enumerate(lines[:4])
                    ] or ["暂无可提取待办，请补充任务描述。"],
                    "risks": [
                        "如果原始记录来自语音转写，建议上线前补人工校对。",
                        f"当前会议日期为 {meeting_date}。" if meeting_date else "建议补充会议日期，便于后续归档与检索。",
                    ],
                },
                "citations": [],
            }

    def build_test_report_mock(
        self,
        *,
        project: str,
        version: str,
        scope: str,
        findings: str,
        conclusion: str,
    ) -> dict[str, Any]:
        scope_items = [line.strip() for line in scope.splitlines() if line.strip()]
        finding_items = [line.strip() for line in findings.splitlines() if line.strip()]
        version_label = f" {version}" if version else ""
        try:
            prompt = f"""
你是软件测试负责人。请根据输入生成结构化测试报告草稿，输出严格 JSON，不要输出 Markdown。
JSON 字段必须是：scope、findings、risks、releaseRecommendation。
scope、findings、risks 是字符串数组；releaseRecommendation 是字符串，需明确是否建议上线和前置条件。

项目名称：{project}
版本号：{version or '未填写'}
测试范围：
{scope[:30000]}

缺陷与现象：
{findings[:30000] or '暂无'}

测试结论：
{conclusion[:10000]}
""".strip()
            parsed = self._json_from_model_response(self._ollama_generate(prompt))
            recommendation = str(parsed.get("releaseRecommendation") or conclusion).strip()
            return {
                "scene_type": "test-report",
                "title": f"{project} 测试报告{version_label}",
                "summary": recommendation,
                "output": {
                    "scope": self._list_value(parsed.get("scope"), scope_items or [scope]),
                    "findings": self._list_value(parsed.get("findings"), finding_items or ["暂无录入缺陷，建议补充异常现象与影响范围。"]),
                    "risks": self._list_value(parsed.get("risks"), [f"本次报告针对版本 {version}。" if version else "建议补充版本号，便于后续追踪。"]),
                    "releaseRecommendation": recommendation,
                },
                "citations": [],
            }
        except Exception:
            return {
                "scene_type": "test-report",
                "title": f"{project} 测试报告{version_label}",
                "summary": conclusion,
                "output": {
                    "scope": scope_items or [scope],
                    "findings": finding_items or ["暂无录入缺陷，建议补充异常现象与影响范围。"],
                    "risks": [
                        "当前结果为沙箱 mock 返回，正式版建议接入历史缺陷与测试用例库。",
                        f"本次报告针对版本 {version}。" if version else "建议补充版本号，便于后续追踪。",
                    ],
                    "releaseRecommendation": conclusion,
                },
                "citations": [],
            }

    def _scene_session_key(self, item: dict[str, Any]) -> str:
        return str(item.get("conversationId") or item.get("conversation_id") or item.get("id") or "")

    def _scene_session_turns(self, item: dict[str, Any]) -> list[dict[str, Any]]:
        messages = item.get("messages")
        if isinstance(messages, list) and messages:
            return [dict(message) for message in messages if isinstance(message, dict)]
        input_payload = item.get("input") or {}
        output_payload = item.get("output") or {}
        question = str(input_payload.get("question") or input_payload.get("message") or input_payload.get("topic") or "").strip()
        answer = str(output_payload.get("answer") or item.get("summary") or "").strip()
        if not question and not answer:
            return []
        return [{
            "id": f"{item.get('id', 'scene')}-turn",
            "question": question,
            "answer": answer,
            "citations": list(item.get("citations") or []),
            "createdAt": item.get("createdAt") or item.get("created_at") or "",
        }]

    def _group_scene_sessions(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        groups: dict[str, dict[str, Any]] = {}
        for row in sorted(rows, key=lambda item: item.get("updatedAt") or item.get("updated_at") or ""):
            key = self._scene_session_key(row)
            group = groups.get(key)
            if group is None:
                group = dict(row)
                group["messages"] = []
                groups[key] = group
            group["messages"].extend(self._scene_session_turns(row))
            if not group.get("title") and row.get("title"):
                group["title"] = row.get("title")
            if (row.get("updatedAt") or row.get("updated_at") or "") >= (group.get("updatedAt") or group.get("updated_at") or ""):
                for field in ("output", "summary", "citations", "status", "approvalStatus"):
                    if field in row:
                        group[field] = row[field]
                group["updatedAt"] = row.get("updatedAt") or row.get("updated_at") or group.get("updatedAt", "")
                group["updated_at"] = row.get("updated_at") or row.get("updatedAt") or group.get("updated_at", "")
            created_values = [value for value in (group.get("createdAt"), row.get("createdAt"), group.get("created_at"), row.get("created_at")) if value]
            if created_values:
                group["createdAt"] = min(created_values)
                group["created_at"] = min(created_values)
        for group in groups.values():
            group["messages"] = sorted(group.get("messages", []), key=lambda item: item.get("createdAt") or item.get("created_at") or "")
        return sorted(groups.values(), key=lambda item: item.get("updatedAt") or item.get("updated_at") or "", reverse=True)

    def list_scene_sessions(self, user_id: str) -> list[dict[str, Any]]:
        state = self.state()
        rows = [item for item in state.get("scene_sessions", []) if item.get("owner_id") == user_id]
        return self._group_scene_sessions(rows)

    def get_scene_session(self, session_id: str, user_id: str) -> dict[str, Any] | None:
        state = self.state()
        target = next((item for item in state.get("scene_sessions", []) if item.get("id") == session_id and item.get("owner_id") == user_id), None)
        if target is None:
            return None
        key = self._scene_session_key(target)
        rows = [item for item in state.get("scene_sessions", []) if item.get("owner_id") == user_id and self._scene_session_key(item) == key]
        grouped = self._group_scene_sessions(rows)
        return grouped[0] if grouped else None

    def delete_scene_session(self, session_id: str, user_id: str) -> bool:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            session = next((item for item in state.get("scene_sessions", []) if item.get("id") == session_id and item.get("owner_id") == user_id), None)
            if session is None:
                return False
            key = self._scene_session_key(session)
            session_ids = {item.get("id") for item in state.get("scene_sessions", []) if item.get("owner_id") == user_id and self._scene_session_key(item) == key}
            pending = next((item for item in state.get("approvals", []) if item.get("sessionId") in session_ids and item.get("status") == "pending"), None)
            if pending is not None:
                raise ValueError("该会话存在待办审批，请先完成审批后再删除")
            state["scene_sessions"] = [item for item in state.get("scene_sessions", []) if item.get("id") not in session_ids]
            self._append_log(state, "scene.session.delete", session_id, f"删除历史会话《{session.get('title', '')}》", actor=user_id)
            self._write_state_unsafe(state)
            return True

    def create_scene_session(self, user: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            now = _utc_now()
            conversation_id = str(payload.get("conversation_id") or "")
            if conversation_id:
                existing = next((item for item in state.get("scene_sessions", []) if item.get("owner_id") == user["id"] and self._scene_session_key(item) == conversation_id), None)
                if existing is not None:
                    turn = {
                        "id": _new_id("turn"),
                        "question": str((payload.get("input") or {}).get("question") or (payload.get("input") or {}).get("message") or ""),
                        "answer": str((payload.get("output") or {}).get("answer") or payload.get("summary") or ""),
                        "citations": list(payload.get("citations") or []),
                        "createdAt": now,
                    }
                    updated = dict(existing)
                    updated["messages"] = self._scene_session_turns(existing) + [turn]
                    updated["output"] = payload.get("output", {})
                    updated["summary"] = payload.get("summary", "")
                    updated["citations"] = payload.get("citations", [])
                    updated["updatedAt"] = now
                    updated["updated_at"] = now
                    idx = state["scene_sessions"].index(existing)
                    state["scene_sessions"][idx] = updated
                    self._append_log(state, "scene.session.update", existing["id"], f"追加会话问答《{existing.get('title', '')}》", actor=user["id"])
                    self._write_state_unsafe(state)
                    return self._group_scene_sessions([updated])[0]
            session = {
                "id": _new_id("scene"),
                "sceneType": payload["scene_type"],
                "title": payload["title"],
                "input": payload.get("input", {}),
                "output": payload.get("output", {}),
                "summary": payload.get("summary", ""),
                "citations": payload.get("citations", []),
                "conversationId": payload.get("conversation_id", ""),
                "status": payload.get("status", "completed"),
                "approvalStatus": "not_submitted",
                "owner_id": user["id"],
                "ownerName": user.get("name", "未知用户"),
                "createdAt": now,
                "updatedAt": now,
                "created_at": now,
                "updated_at": now,
            }
            session["messages"] = self._scene_session_turns(session)
            state.setdefault("scene_sessions", []).insert(0, session)
            self._append_log(state, "scene.session.create", session["id"], f"创建场景结果《{session['title']}》", actor=user["id"])
            self._write_state_unsafe(state)
            return session

    def list_approvals(self, user_id: str) -> list[dict[str, Any]]:
        state = self.state()
        approvals = state.get("approvals", [])
        if self.is_admin(user_id):
            rows = approvals
        else:
            rows = [item for item in approvals if item.get("requester_id") == user_id]
        return sorted(rows, key=lambda item: item.get("updatedAt", ""), reverse=True)

    def get_approval(self, approval_id: str, user_id: str) -> dict[str, Any] | None:
        state = self.state()
        is_admin = self.is_admin(user_id)
        for item in state.get("approvals", []):
            if item.get("id") != approval_id:
                continue
            if is_admin or item.get("requester_id") == user_id:
                return item
            return None
        return None

    def create_approval(self, user: dict[str, Any], session_id: str, note: str) -> dict[str, Any]:
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            session = next(
                (
                    item for item in state.get("scene_sessions", [])
                    if item.get("id") == session_id and item.get("owner_id") == user["id"]
                ),
                None,
            )
            if session is None:
                raise ValueError("Scene session not found")
            existing = next(
                (
                    item for item in state.get("approvals", [])
                    if item.get("sessionId") == session_id and item.get("status") == "pending"
                ),
                None,
            )
            if existing is not None:
                raise ValueError("This scene result is already pending approval")
            now = _utc_now()
            approval = {
                "id": _new_id("approval"),
                "sessionId": session_id,
                "sceneType": session.get("sceneType", ""),
                "title": session.get("title", ""),
                "requester_id": user["id"],
                "requesterName": user.get("name", "未知用户"),
                "approverName": "待分配",
                "status": "pending",
                "summary": session.get("summary", ""),
                "decisionNote": note,
                "output": session.get("output", {}),
                "createdAt": now,
                "updatedAt": now,
                "submittedAt": now,
                "created_at": now,
                "updated_at": now,
                "submitted_at": now,
            }
            state.setdefault("approvals", []).insert(0, approval)
            session["approvalStatus"] = "pending"
            session["updatedAt"] = now
            session["updated_at"] = now
            self._append_log(state, "scene.approval.create", approval["id"], f"提交场景结果《{session['title']}》进入审批", actor=user["id"])
            self._write_state_unsafe(state)
            return approval

    def update_approval(
        self,
        approval_id: str,
        user: dict[str, Any],
        status: str,
        note: str,
    ) -> dict[str, Any] | None:
        if not self.is_admin(user.get("id")):
            raise ValueError("Admin access required")
        with self._lock:
            self.ensure_layout()
            state = self._read_state_unsafe()
            approval = next((item for item in state.get("approvals", []) if item.get("id") == approval_id), None)
            if approval is None:
                return None
            now = _utc_now()
            approval["status"] = status
            approval["decisionNote"] = note
            approval["approverName"] = user.get("name", approval.get("approverName", "待分配"))
            approval["updatedAt"] = now
            approval["updated_at"] = now
            session = next((item for item in state.get("scene_sessions", []) if item.get("id") == approval.get("sessionId")), None)
            if session is not None:
                session["approvalStatus"] = status
                session["updatedAt"] = now
                session["updated_at"] = now
            self._append_log(state, "scene.approval.update", approval_id, f"审批结果更新为 {status}", actor=user["id"])
            self._write_state_unsafe(state)
            return approval

    def ai_answer(self, question: str) -> dict[str, Any]:
        state = self.state()
        visible_docs = [d for d in state["documents"] if d.get("status") in {"uploaded", "indexed"}]
        citations = [{"document_id": d["id"], "title": d["title"]} for d in visible_docs[:3]]
        return {
            "answer": "AI 问答接口已预留。当前基础版只返回可见文档范围与引用占位；接入 LLM 后会在这里执行权限过滤、检索、组装上下文并生成回答。",
            "status": "reserved",
            "citations": citations,
        }


_store: ERPStore | None = None


def get_erp_store() -> ERPStore:
    global _store
    if _store is None:
        _store = ERPStore()
    return _store
