from __future__ import annotations

from typing import Any

from app.contracts.skills.loader import flatten_skill_rules, load_skill_document


DEFAULT_SENSITIVE_WORDS = [
    "独家经营",
    "保证最低",
    "霸王条款",
    "免责一切",
    "概不负责",
    "最终解释权",
    "放弃索赔",
    "无理由退款",
    "包销",
    "垄断",
]


def _selected_topics(contract_fields: dict[str, Any]) -> list[str]:
    subject = str(contract_fields.get("合同标的物") or contract_fields.get("subject") or "")
    text = str(contract_fields.get("text") or "")
    amount_raw = contract_fields.get("合同总金额") or contract_fields.get("amount") or 0
    combined = f"{subject} {text}"
    amount = 0.0
    try:
        amount = float(amount_raw)
    except Exception:
        digits = "".join(ch for ch in str(amount_raw) if ch.isdigit() or ch == ".")
        if digits:
            amount = float(digits)

    topics: list[str] = []
    if amount >= 1_000_000:
        topics.append("高金额合同")
    if any(keyword in combined for keyword in ["采购", "招标", "验收"]):
        topics.append("政府采购与验收")
    if any(keyword in combined for keyword in ["数据", "隐私", "客户信息"]):
        topics.append("数据安全")
    if any(keyword in combined for keyword in ["网络", "系统", "运维", "安全", "部署"]):
        topics.append("网络与系统安全")
    if not topics:
        topics.append("一般合同条款")
    return topics


def get_review_context(contract_fields: dict[str, Any]) -> str:
    legal_skill = load_skill_document("legal_contract_review")
    regulation_skill = load_skill_document("national_regulations")
    sections = flatten_skill_rules([legal_skill, regulation_skill])
    topic_lines = [f"- {topic}" for topic in _selected_topics(contract_fields)]
    sensitive_lines = [f"- {word}" for word in DEFAULT_SENSITIVE_WORDS]
    return "\n".join(
        [
            "本次合同评审应重点参考以下技能上下文：",
            *sections,
            "",
            "根据当前合同自动选择的重点主题：",
            *topic_lines,
            "",
            "默认高风险敏感词：",
            *sensitive_lines,
        ]
    )
