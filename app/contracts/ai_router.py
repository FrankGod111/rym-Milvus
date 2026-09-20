from __future__ import annotations

import asyncio
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.contracts.analysis import compare_contract_history
from app.contracts.skills.legal_knowledge import DEFAULT_SENSITIVE_WORDS, get_review_context

router = APIRouter(prefix="/api/contracts/ai", tags=["contracts-ai"])

_ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif"}
_MAX_UPLOAD_SIZE = 50 * 1024 * 1024
_OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
_OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:8b")
_ocr_instance = None


class ExtractRequest(BaseModel):
    raw_text: str = Field(..., min_length=1)


class ReviewRequest(BaseModel):
    text: str = ""
    fields: dict[str, Any] = Field(default_factory=dict)


class HistoryCompareRequest(BaseModel):
    id: str | None = None
    code: str | None = None
    dept: str | None = None
    stage: str | None = None
    subject: str | None = None
    paymentTerms: str | None = None
    payment_terms: str | None = None
    amount: float | None = None
    合同编号: str | None = None
    经办部门: str | None = None
    合同阶段: str | None = None
    合同标的物: str | None = None
    付款条件: str | None = None
    合同总金额: str | None = None


def _validate_upload(filename: str, size: int) -> None:
    suffix = Path(filename).suffix.lower()
    if suffix not in _ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    if size > _MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="File is too large")


def _get_ocr():
    global _ocr_instance
    if _ocr_instance is None:
        try:
            from paddleocr import PaddleOCR
        except ImportError as exc:
            raise HTTPException(
                status_code=503,
                detail="PaddleOCR is not installed. Please install requirements first.",
            ) from exc
        _ocr_instance = PaddleOCR(use_angle_cls=True, lang="ch", use_gpu=False)
    return _ocr_instance


async def _ollama_generate(prompt: str, *, temperature: float = 0.1) -> str:
    payload = {
        "model": _OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": temperature},
    }
    async with httpx.AsyncClient(timeout=180, trust_env=False) as client:
        response = await client.post(f"{_OLLAMA_URL.rstrip('/')}/api/generate", json=payload)
    try:
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Ollama request failed: {exc}") from exc
    return str(response.json().get("response") or "").strip()


def _extract_json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    match = re.search(r"\{.*\}", cleaned, re.S)
    candidate = match.group(0) if match else cleaned
    try:
        return json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Ollama did not return valid JSON") from exc


def _normalize_fields(payload: dict[str, Any]) -> list[dict[str, Any]]:
    expected = [
        "合同编号",
        "甲方名称",
        "乙方名称",
        "签订日期",
        "合同总金额",
        "付款条件",
        "服务期限",
        "交付物",
        "验收标准",
        "续约条件",
    ]
    results: list[dict[str, Any]] = []
    confidence_map = payload.get("confidence") if isinstance(payload.get("confidence"), dict) else {}
    for field in expected:
        value = payload.get(field, "")
        confidence = confidence_map.get(field, 0.85 if value else 0)
        try:
            confidence = float(confidence)
        except Exception:
            confidence = 0.85 if value else 0
        results.append(
            {
                "field": field,
                "value": value,
                "confidence": max(0.0, min(confidence, 1.0)),
                "source": "ollama",
            }
        )
    return results


def _parse_sensitive_response(text: str) -> list[dict[str, Any]]:
    data = _extract_json_object(text)
    findings = data.get("findings", [])
    results: list[dict[str, Any]] = []
    if isinstance(findings, list):
        for item in findings:
            if not isinstance(item, dict):
                continue
            word = str(item.get("word") or item.get("phrase") or "").strip()
            if not word:
                continue
            results.append(
                {
                    "word": word,
                    "found": True,
                    "suggestion": str(item.get("suggestion") or item.get("reason") or "建议人工复核该表述。"),
                }
            )
    if not results:
        normalized = text.lower()
        for word in DEFAULT_SENSITIVE_WORDS:
            if word.lower() in normalized:
                results.append(
                    {
                        "word": word,
                        "found": True,
                        "suggestion": f'发现敏感词"{word}"，建议修改为更审慎、对等的条款表述。',
                    }
                )
    return results


def _parse_compliance_response(text: str) -> list[dict[str, Any]]:
    data = _extract_json_object(text)
    findings = data.get("findings", [])
    results: list[dict[str, Any]] = []
    if isinstance(findings, list):
        for item in findings:
            if not isinstance(item, dict):
                continue
            regulation = str(item.get("regulation") or item.get("code") or "").strip()
            if not regulation:
                continue
            compliant = bool(item.get("compliant", False))
            results.append(
                {
                    "regulation": regulation,
                    "compliant": compliant,
                    "note": str(item.get("note") or item.get("reason") or ""),
                }
            )
    return results


@router.post("/ocr")
async def run_ocr(file: UploadFile = File(...)) -> dict[str, Any]:
    contents = await file.read()
    _validate_upload(file.filename or "upload.pdf", len(contents))
    suffix = Path(file.filename or "upload.pdf").suffix or ".pdf"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(contents)
        tmp_path = tmp.name
    try:
        ocr = _get_ocr()
        result = ocr.ocr(tmp_path, cls=True)
    finally:
        Path(tmp_path).unlink(missing_ok=True)
    lines: list[str] = []
    structured_lines: list[dict[str, Any]] = []
    for page in result or []:
        if not page:
            continue
        for row in page:
            if not row or len(row) < 2:
                continue
            text = str(row[1][0] or "").strip()
            score = float(row[1][1] or 0)
            if not text:
                continue
            lines.append(text)
            structured_lines.append({"text": text, "confidence": score})
    return {"raw_text": "\n".join(lines), "lines": structured_lines}


@router.post("/extract")
async def extract_fields(body: ExtractRequest) -> dict[str, Any]:
    prompt = (
        "你是合同要素抽取助手。请从下面的中文合同 OCR 文本中提取字段，并严格只返回 JSON 对象。"
        "JSON 键必须包含：合同编号、甲方名称、乙方名称、签订日期、合同总金额、付款条件、服务期限、交付物、验收标准、续约条件。"
        "如果没有提取到值，请返回空字符串。可选提供 confidence 对象，键同上，值为 0 到 1。\n\n"
        f"合同文本：\n{body.raw_text}"
    )
    response_text = await _ollama_generate(prompt, temperature=0.05)
    payload = _extract_json_object(response_text)
    return {"fields": _normalize_fields(payload), "raw": payload}


@router.post("/review")
async def review_contract(body: ReviewRequest) -> dict[str, Any]:
    combined_fields = {**body.fields, "text": body.text}
    review_context = get_review_context(combined_fields)
    sensitive_prompt = (
        "你是合同法务审查助手。请在给定文本中识别敏感词、霸王条款、明显失衡或高风险表述。"
        "严格只返回 JSON：{\"findings\":[{\"word\":\"...\",\"suggestion\":\"...\"}]}。"
        "如果没有发现，请返回 {\"findings\":[]}。\n\n"
        f"待审查文本：\n{body.text or json.dumps(body.fields, ensure_ascii=False)}"
    )
    compliance_prompt = (
        "你是合同合规审查助手。请仅依据以下法规/规范上下文评估合同字段，"
        "严格只返回 JSON：{\"findings\":[{\"regulation\":\"...\",\"compliant\":true,\"note\":\"...\"}]}。"
        "如果证据不足，也请给出需复核项。\n\n"
        f"法规上下文：\n{review_context}\n\n合同字段：\n{json.dumps(body.fields, ensure_ascii=False)}"
    )
    sensitive_text, compliance_text = await asyncio.gather(
        _ollama_generate(sensitive_prompt, temperature=0.05),
        _ollama_generate(compliance_prompt, temperature=0.1),
    )
    sensitive = _parse_sensitive_response(sensitive_text)
    compliance = _parse_compliance_response(compliance_text)
    non_compliant = sum(1 for item in compliance if not item.get("compliant"))
    if sensitive or non_compliant >= 2:
        risk_level = "high"
    elif non_compliant == 1:
        risk_level = "medium"
    else:
        risk_level = "low"
    return {
        "sensitive": sensitive,
        "compliance": compliance,
        "risk_level": risk_level,
    }


@router.post("/history-compare")
async def history_compare(body: HistoryCompareRequest) -> dict[str, Any]:
    return compare_contract_history(body.model_dump())
