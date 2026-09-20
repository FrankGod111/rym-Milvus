---
name: legal_contract_review
description: Reviews Chinese contract text using the local contracts AI endpoints backed by PaddleOCR, Ollama Qwen, and curated legal/regulation references in this repository. Use when you need OCR, field extraction, sensitive-word review, or compliance review for contract documents.
metadata: {openclaw: {emoji: "⚖️", requires: {bins: ["curl"]}}}
---

# legal_contract_review

Use this skill to call the local FastAPI contract AI endpoints exposed by this repository.

## Base URL

- Read from `OPENCLAW_KB_BASE_URL` when available.
- Otherwise use the same local service base as the app, typically `http://127.0.0.1:8000`.

All calls are under `{base}/api/contracts/ai`.

## Actions

| id | method | path | notes |
|---|---|---|---|
| `ocr` | POST | `/api/contracts/ai/ocr` | Multipart upload. Returns OCR text and line confidences. |
| `extract` | POST | `/api/contracts/ai/extract` | Accepts `{"raw_text": "..."}` and returns normalized contract fields. |
| `review` | POST | `/api/contracts/ai/review` | Accepts `{"text": "...", "fields": {...}}` and returns sensitive findings, compliance findings, and risk level. |

## Review Focus

- 格式条款、公平性、违约责任与争议解决应对等明确。
- 对免责、单方解释权、绕开验收、超范围数据使用等高风险表述进行重点审查。
- 高金额合同、系统交付、运维服务、采购/验收条款需要提高审查强度。

## Sensitive Patterns

- 免责一切
- 概不负责
- 最终解释权归甲方所有
- 绕开验收
- 永久保留全部数据
- 未经授权共享数据

## Workflow

1. Upload the PDF/scan to `ocr`.
2. Send `raw_text` to `extract` for field extraction.
3. Send text + edited fields to `review` for legal checks.
4. Use the returned findings as review guidance, not as a substitute for human legal approval.

## Example

```bash
BASE="${OPENCLAW_KB_BASE_URL:-http://127.0.0.1:8000}"

curl -sS -X POST "$BASE/api/contracts/ai/extract" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d '{"raw_text":"合同编号：HT-2024-001\n甲方：北京星辰科技有限公司"}'
```
