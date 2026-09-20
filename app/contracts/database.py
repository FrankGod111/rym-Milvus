"""SQLite database module for contract management."""
from __future__ import annotations

import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "contracts.db"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def get_db_path() -> Path:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return DB_PATH


@contextmanager
def get_conn():
    conn = sqlite3.connect(str(get_db_path()))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS contracts (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    party_a TEXT NOT NULL,
    party_b TEXT NOT NULL DEFAULT '上海月明信息系统有限公司',
    sign_date TEXT,
    effective_date TEXT,
    expire_date TEXT,
    dept TEXT,
    handler TEXT,
    amount REAL DEFAULT 0,
    subject TEXT,
    unit_price REAL DEFAULT 0,
    tax_rate REAL DEFAULT 13,
    payment_terms TEXT,
    deposit REAL DEFAULT 0,
    deliverables TEXT,
    acceptance_standard TEXT,
    service_period TEXT,
    renewal_conditions TEXT,
    stage TEXT DEFAULT 'S4_确认',
    status TEXT DEFAULT 'pending',
    file_path TEXT,
    ai_extracted TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

SEED_DATA = [
    {
        "id": "1", "code": "HT-2024-001", "party_a": "北京星辰科技有限公司",
        "party_b": "上海月明信息系统有限公司",
        "sign_date": "2024-03-18", "effective_date": "2024-03-28", "expire_date": "2025-01-31",
        "dept": "销售部", "handler": "张伟", "amount": 1280000, "subject": "智能监测系统采购及实施",
        "unit_price": 64000, "tax_rate": 13,
        "payment_terms": "签约30%，验收65%，质保金5%", "deposit": 64000,
        "deliverables": "设备交付、系统部署、操作培训",
        "acceptance_standard": "GB/T 19001-2016 质量管理体系标准",
        "service_period": "12个月质保期", "renewal_conditions": "续约需提前60日书面通知",
        "stage": "S6_履约", "status": "active",
    },
    {
        "id": "2", "code": "HT-2024-002", "party_a": "深圳华腾数据集团",
        "party_b": "上海月明信息系统有限公司",
        "sign_date": "2024-05-02", "effective_date": "2024-06-26", "expire_date": "2025-06-16",
        "dept": "技术部", "handler": "李娜", "amount": 3560000, "subject": "大数据平台运维服务",
        "unit_price": 890000, "tax_rate": 6,
        "payment_terms": "按季度付款，每季度末支付当季度服务费", "deposit": 0,
        "deliverables": "季度运维报告、月度巡检、故障响应",
        "acceptance_standard": "SLA 99.5%可用性",
        "service_period": "24个月（可按年续约）",
        "renewal_conditions": "自动续约除非任何一方在到期前30日通知不续约",
        "stage": "S5_签订", "status": "active",
    },
    {
        "id": "3", "code": "HT-2024-003", "party_a": "杭州云帆电子商务有限公司",
        "party_b": "上海月明信息系统有限公司",
        "sign_date": "2024-02-17", "effective_date": "2024-02-27", "expire_date": "2024-07-16",
        "dept": "客户二部", "handler": "王磊", "amount": 580000, "subject": "在线客服系统升级",
        "unit_price": 29000, "tax_rate": 13,
        "payment_terms": "签约50%，上线验收50%", "deposit": 0,
        "deliverables": "客服系统升级、数据迁移、人员培训",
        "acceptance_standard": "功能测试通过率100%",
        "service_period": "6个月质保期", "renewal_conditions": "无自动续约条款",
        "stage": "S6_履约", "status": "risk",
    },
    {
        "id": "4", "code": "HT-2024-004", "party_a": "广州东方制造集团",
        "party_b": "上海月明信息系统有限公司",
        "sign_date": "2024-07-01", "effective_date": "2024-07-06", "expire_date": "2025-07-06",
        "dept": "销售部", "handler": "陈静", "amount": 2100000, "subject": "MES制造执行系统定制开发",
        "unit_price": 1050000, "tax_rate": 13,
        "payment_terms": "签约20%，需求确认30%，上线验收45%，质保金5%", "deposit": 420000,
        "deliverables": "需求分析、系统开发、部署上线、培训交付",
        "acceptance_standard": "功能性测试、性能压测、用户验收",
        "service_period": "12个月免费维护",
        "renewal_conditions": "后续功能扩展需签订补充协议",
        "stage": "S4_确认", "status": "pending",
    },
    {
        "id": "5", "code": "HT-2023-089", "party_a": "成都西部科创有限公司",
        "party_b": "上海月明信息系统有限公司",
        "sign_date": "2023-05-12", "effective_date": "2023-05-22", "expire_date": "2024-05-27",
        "dept": "技术部", "handler": "赵强", "amount": 920000, "subject": "网络安全加固服务",
        "unit_price": 46000, "tax_rate": 6,
        "payment_terms": "签约100%", "deposit": 0,
        "deliverables": "安全评估报告、加固方案、渗透测试",
        "acceptance_standard": "等保2.0三级合规",
        "service_period": "合同履行完毕", "renewal_conditions": "无续约条款",
        "stage": "completed", "status": "completed",
    },
]


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(SCHEMA)
        # Seed only if table is empty
        count = conn.execute("SELECT COUNT(*) FROM contracts").fetchone()[0]
        if count == 0:
            now = utc_now()
            for row in SEED_DATA:
                conn.execute(
                    """INSERT INTO contracts
                    (id, code, party_a, party_b, sign_date, effective_date, expire_date,
                     dept, handler, amount, subject, unit_price, tax_rate, payment_terms,
                     deposit, deliverables, acceptance_standard, service_period,
                     renewal_conditions, stage, status, created_at, updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        row["id"], row["code"], row["party_a"], row["party_b"],
                        row.get("sign_date"), row.get("effective_date"), row.get("expire_date"),
                        row.get("dept"), row.get("handler"), row.get("amount", 0),
                        row.get("subject"), row.get("unit_price", 0), row.get("tax_rate", 13),
                        row.get("payment_terms"), row.get("deposit", 0),
                        row.get("deliverables"), row.get("acceptance_standard"),
                        row.get("service_period"), row.get("renewal_conditions"),
                        row.get("stage", "S4_确认"), row.get("status", "pending"),
                        now, now,
                    )
                )


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)
