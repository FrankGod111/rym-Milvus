"""Pydantic schemas for contract API."""
from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel, Field


class ContractCreate(BaseModel):
    code: str = Field(..., min_length=1)
    party_a: str = Field(..., min_length=1)
    party_b: str = "上海月明信息系统有限公司"
    sign_date: Optional[str] = None
    effective_date: Optional[str] = None
    expire_date: Optional[str] = None
    dept: Optional[str] = None
    handler: Optional[str] = None
    amount: float = 0
    subject: Optional[str] = None
    unit_price: float = 0
    tax_rate: float = 13
    payment_terms: Optional[str] = None
    deposit: float = 0
    deliverables: Optional[str] = None
    acceptance_standard: Optional[str] = None
    service_period: Optional[str] = None
    renewal_conditions: Optional[str] = None
    stage: str = "S4_确认"
    status: str = "pending"
    ai_extracted: Optional[Any] = None


class ContractUpdate(BaseModel):
    code: Optional[str] = None
    party_a: Optional[str] = None
    party_b: Optional[str] = None
    sign_date: Optional[str] = None
    effective_date: Optional[str] = None
    expire_date: Optional[str] = None
    dept: Optional[str] = None
    handler: Optional[str] = None
    amount: Optional[float] = None
    subject: Optional[str] = None
    unit_price: Optional[float] = None
    tax_rate: Optional[float] = None
    payment_terms: Optional[str] = None
    deposit: Optional[float] = None
    deliverables: Optional[str] = None
    acceptance_standard: Optional[str] = None
    service_period: Optional[str] = None
    renewal_conditions: Optional[str] = None
    stage: Optional[str] = None
    status: Optional[str] = None
    ai_extracted: Optional[Any] = None


class ContractOut(BaseModel):
    id: str
    code: str
    party_a: str
    party_b: str
    sign_date: Optional[str]
    effective_date: Optional[str]
    expire_date: Optional[str]
    dept: Optional[str]
    handler: Optional[str]
    amount: float
    subject: Optional[str]
    unit_price: float
    tax_rate: float
    payment_terms: Optional[str]
    deposit: float
    deliverables: Optional[str]
    acceptance_standard: Optional[str]
    service_period: Optional[str]
    renewal_conditions: Optional[str]
    stage: str
    status: str
    file_path: Optional[str]
    ai_extracted: Optional[Any]
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}
