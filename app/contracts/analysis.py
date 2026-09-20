from __future__ import annotations

from collections import Counter
from statistics import mean, median
from typing import Any
import re

from .database import get_conn, row_to_dict


def _normalize_text(value: Any) -> str:
    return str(value or "").strip().lower()


def _parse_amount(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value)
    digits = "".join(ch for ch in text if ch.isdigit() or ch == ".")
    try:
        return float(digits) if digits else 0.0
    except Exception:
        return 0.0


def _format_money(value: float) -> str:
    return f"¥{value:,.0f}" if value else "N/A"


def _tokenize(text: str) -> set[str]:
    tokens: set[str] = set()
    for chunk in re.split(r"[^0-9A-Za-z一-鿿]+", text.lower()):
        chunk = chunk.strip()
        if not chunk:
            continue
        if len(chunk) > 1:
            tokens.add(chunk)
        if re.search(r"[一-鿿]", chunk) and len(chunk) > 2:
            for idx in range(len(chunk) - 1):
                tokens.add(chunk[idx : idx + 2])
    return tokens


def _get_first(payload: dict[str, Any], *keys: str, default: Any = "") -> Any:
    for key in keys:
        value = payload.get(key)
        if value not in (None, ""):
            return value
    return default


def _normalize_contract_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _get_first(payload, "id", default=""),
        "code": _get_first(payload, "code", "合同编号", default=""),
        "dept": _get_first(payload, "dept", "department", "经办部门", default=""),
        "stage": _get_first(payload, "stage", "合同阶段", default=""),
        "subject": _get_first(payload, "subject", "合同标的物", default=""),
        "payment_terms": _get_first(payload, "paymentTerms", "payment_terms", "付款条件", default=""),
        "amount": _parse_amount(_get_first(payload, "amount", "合同总金额", default=0)),
    }


def _peer_score(current: dict[str, Any], row: dict[str, Any]) -> float:
    score = 0.0
    row_dept = _normalize_text(row.get("dept"))
    row_stage = _normalize_text(row.get("stage"))
    row_subject = _normalize_text(row.get("subject"))
    row_payment = _normalize_text(row.get("payment_terms"))
    row_amount = _parse_amount(row.get("amount"))

    current_dept = _normalize_text(current.get("dept"))
    current_stage = _normalize_text(current.get("stage"))
    current_subject = _normalize_text(current.get("subject"))
    current_payment = _normalize_text(current.get("payment_terms"))
    current_amount = _parse_amount(current.get("amount"))

    if current_dept and row_dept and current_dept == row_dept:
        score += 3
    if current_stage and row_stage and current_stage == row_stage:
        score += 1.5

    if current_amount > 0 and row_amount > 0:
        ratio = row_amount / current_amount
        if 0.85 <= ratio <= 1.15:
            score += 3
        elif 0.7 <= ratio <= 1.3:
            score += 2
        elif 0.5 <= ratio <= 1.5:
            score += 1

    current_tokens = _tokenize(f"{current_subject} {current_payment}")
    row_tokens = _tokenize(f"{row_subject} {row_payment}")
    overlap = len(current_tokens & row_tokens)
    if overlap:
        score += min(4.0, overlap * 0.8)

    if current_subject and row_subject and (current_subject in row_subject or row_subject in current_subject):
        score += 2

    return score


def _most_common_text(values: list[str]) -> str:
    items = [item for item in values if item]
    if not items:
        return ""
    return Counter(items).most_common(1)[0][0]


def compare_contract_history(payload: dict[str, Any]) -> dict[str, Any]:
    current = _normalize_contract_payload(payload)
    with get_conn() as conn:
        rows = [row_to_dict(row) for row in conn.execute("SELECT * FROM contracts ORDER BY created_at DESC LIMIT 500").fetchall()]

    scored_rows: list[tuple[float, dict[str, Any]]] = []
    for row in rows:
        if current["id"] and row.get("id") == current["id"]:
            continue
        if current["code"] and row.get("code") == current["code"]:
            continue
        scored_rows.append((_peer_score(current, row), row))

    scored_rows.sort(key=lambda item: (item[0], item[1].get("updated_at") or ""), reverse=True)
    selected = [row for score, row in scored_rows if score > 0][:20]
    if not selected:
        selected = [row for _, row in scored_rows[:20]]

    peer_amounts = [amount for amount in (_parse_amount(row.get("amount")) for row in selected) if amount > 0]
    peer_payment_terms = [_normalize_text(row.get("payment_terms")) for row in selected if row.get("payment_terms")]
    peer_subjects = [_normalize_text(row.get("subject")) for row in selected if row.get("subject")]

    current_amount = float(current.get("amount") or 0)
    current_payment = str(current.get("payment_terms") or "").strip()
    current_subject = str(current.get("subject") or "").strip()
    avg_amount = mean(peer_amounts) if peer_amounts else 0.0
    med_amount = median(peer_amounts) if peer_amounts else 0.0
    common_payment = _most_common_text(peer_payment_terms)
    common_subject = _most_common_text(peer_subjects)

    if avg_amount > 0 and current_amount > 0:
        delta = (current_amount - avg_amount) / avg_amount
        amount_deviation = f"{('高于' if delta > 0 else '低于')}平均值 {abs(delta) * 100:.1f}%"
        if abs(delta) >= 0.3:
            amount_advice = "金额与历史同类合同偏离较大，建议复核预算、范围边界和付款节点。"
        elif abs(delta) >= 0.15:
            amount_advice = "金额存在明显差异，建议确认是否有特殊约定或补充条款。"
        else:
            amount_advice = "金额与同类合同基本一致，可继续按当前方案推进。"
    else:
        amount_deviation = "样本不足"
        amount_advice = "历史样本不足，建议扩大检索范围后再复核。"

    if current_payment and common_payment:
        payment_match = _normalize_text(current_payment) == common_payment
        payment_deviation = "与样本主流付款条件一致" if payment_match else "与样本主流付款条件不同"
        payment_advice = (
            "付款条件与历史样本一致，可继续执行。"
            if payment_match
            else "付款条件与历史同类合同差异较大，建议复核签约/验收/质保金比例。"
        )
    else:
        payment_deviation = "样本不足"
        payment_advice = "历史付款样本不足，建议人工复核。"

    subject_deviation = f"历史样本 {len(selected)} 份"
    subject_advice = (
        f"样本中最常见标的是 {common_subject}，请确认当前合同标的、交付范围和验收标准是否一致。"
        if common_subject
        else "历史样本不足，建议结合具体业务场景人工复核。"
    )

    peer_samples = [
        {
            "id": row.get("id"),
            "code": row.get("code"),
            "subject": row.get("subject"),
            "amount": _format_money(_parse_amount(row.get("amount"))),
            "dept": row.get("dept"),
            "stage": row.get("stage"),
            "payment_terms": row.get("payment_terms"),
        }
        for row in selected[:5]
    ]

    return {
        "peer_count": len(selected),
        "basis": {
            "dept": current.get("dept"),
            "stage": current.get("stage"),
            "subject": current.get("subject"),
            "amount": _format_money(current_amount),
        },
        "results": [
            {
                "field": "合同总金额",
                "current": _format_money(current_amount),
                "avgHistory": _format_money(avg_amount) if avg_amount else "N/A",
                "deviation": amount_deviation,
                "advice": amount_advice,
                "medianHistory": _format_money(med_amount) if med_amount else "N/A",
            },
            {
                "field": "付款条件",
                "current": current_payment or "N/A",
                "avgHistory": common_payment or "N/A",
                "deviation": payment_deviation,
                "advice": payment_advice,
            },
            {
                "field": "合同标的物",
                "current": current_subject or "N/A",
                "avgHistory": common_subject or "N/A",
                "deviation": subject_deviation,
                "advice": subject_advice,
            },
        ],
        "peer_samples": peer_samples,
    }
