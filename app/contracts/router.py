"""Contract CRUD router."""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from .database import get_conn, init_db, row_to_dict, utc_now
from .schemas import ContractCreate, ContractOut, ContractUpdate
from .storage import get_storage

router = APIRouter(prefix="/api/contracts", tags=["contracts"])

_ALLOWED_UPLOAD_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif"}
_MAX_UPLOAD_SIZE = 50 * 1024 * 1024

# Initialize DB on import
init_db()


def _get_or_404(conn, contract_id: str) -> dict:
    row = conn.execute("SELECT * FROM contracts WHERE id=?", (contract_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Contract not found")
    d = row_to_dict(row)
    if d.get("ai_extracted"):
        try:
            d["ai_extracted"] = json.loads(d["ai_extracted"])
        except Exception:
            pass
    return d


@router.get("", response_model=list[ContractOut])
def list_contracts(
    stage: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
):
    with get_conn() as conn:
        sql = "SELECT * FROM contracts WHERE 1=1"
        params: list = []
        if stage:
            sql += " AND stage=?"; params.append(stage)
        if status:
            sql += " AND status=?"; params.append(status)
        if q:
            sql += " AND (code LIKE ? OR party_a LIKE ? OR subject LIKE ?)"
            like = f"%{q}%"; params += [like, like, like]
        sql += " ORDER BY created_at DESC"
        rows = conn.execute(sql, params).fetchall()
        result = []
        for row in rows:
            d = row_to_dict(row)
            if d.get("ai_extracted"):
                try:
                    d["ai_extracted"] = json.loads(d["ai_extracted"])
                except Exception:
                    pass
            result.append(d)
        return result


@router.get("/{contract_id}", response_model=ContractOut)
def get_contract(contract_id: str):
    with get_conn() as conn:
        return _get_or_404(conn, contract_id)


@router.post("", response_model=ContractOut, status_code=201)
def create_contract(body: ContractCreate):
    now = utc_now()
    cid = str(uuid.uuid4())
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO contracts
            (id, code, party_a, party_b, sign_date, effective_date, expire_date,
             dept, handler, amount, subject, unit_price, tax_rate, payment_terms,
             deposit, deliverables, acceptance_standard, service_period,
             renewal_conditions, stage, status, ai_extracted, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                cid, body.code, body.party_a, body.party_b,
                body.sign_date, body.effective_date, body.expire_date,
                body.dept, body.handler, body.amount, body.subject,
                body.unit_price, body.tax_rate, body.payment_terms,
                body.deposit, body.deliverables, body.acceptance_standard,
                body.service_period, body.renewal_conditions,
                body.stage, body.status,
                json.dumps(body.ai_extracted, ensure_ascii=False) if body.ai_extracted is not None else None,
                now, now,
            ),
        )
        return _get_or_404(conn, cid)


@router.put("/{contract_id}", response_model=ContractOut)
def update_contract(contract_id: str, body: ContractUpdate):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "ai_extracted" in data and data["ai_extracted"] is not None:
        data["ai_extracted"] = json.dumps(data["ai_extracted"], ensure_ascii=False)
    data["updated_at"] = utc_now()
    set_clause = ", ".join(f"{k}=?" for k in data)
    params = list(data.values()) + [contract_id]
    with get_conn() as conn:
        _get_or_404(conn, contract_id)  # ensure exists
        conn.execute(f"UPDATE contracts SET {set_clause} WHERE id=?", params)
        return _get_or_404(conn, contract_id)


@router.patch("/{contract_id}", response_model=ContractOut)
def patch_contract(contract_id: str, body: ContractUpdate):
    return update_contract(contract_id, body)


@router.post("/{contract_id}/upload", response_model=ContractOut)
async def upload_contract_file(contract_id: str, file: UploadFile = File(...)):
    contents = await file.read()
    filename = file.filename or "contract-file.pdf"
    suffix = Path(filename).suffix.lower()
    if suffix not in _ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    if len(contents) > _MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="File is too large")

    storage = get_storage()
    stored_path = storage.save(contents, filename)
    with get_conn() as conn:
        _get_or_404(conn, contract_id)
        conn.execute(
            "UPDATE contracts SET file_path=?, updated_at=? WHERE id=?",
            (stored_path, utc_now(), contract_id),
        )
        return _get_or_404(conn, contract_id)


@router.delete("/{contract_id}", status_code=204)
def delete_contract(contract_id: str):
    with get_conn() as conn:
        _get_or_404(conn, contract_id)
        conn.execute("DELETE FROM contracts WHERE id=?", (contract_id,))
