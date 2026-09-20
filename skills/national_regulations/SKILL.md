---
name: national_regulations
description: Reads and applies the curated national regulations and standards used by the local contract AI review flow, including Civil Code contract rules, government procurement, data security, and cybersecurity requirements.
metadata: {openclaw: {emoji: "📜", requires: {bins: ["curl"]}}}
---

# national_regulations

This skill documents the regulation set used by the local contract review flow.

## Covered references

- 中华人民共和国民法典·合同编
- 中华人民共和国政府采购法
- 中华人民共和国数据安全法
- 网络安全等级保护基本要求 GB/T 22239-2019

## Regulatory priorities

- 一般合同条款：审查公平性、提示义务、违约责任、解除条件、争议解决。
- 政府采购与验收：审查采购范围一致性、付款节点可审计性、验收流程完整性。
- 数据安全：审查数据访问权限、日志留存、事件通报、删除返还机制。
- 网络与系统安全：审查安全基线、漏洞修复、访问控制、审计能力。

## Usage guidance

- Use together with `legal_contract_review` when reviewing contracts.
- Treat these references as review context, not final legal advice.
- If the contract touches system delivery, operations, data handling, procurement, or liability clauses, prioritize these references during review.

## Source in repo

The current curated rule set lives in the repository skill documents and is loaded by the backend review layer.

Primary files:

- `skills/legal_contract_review/SKILL.md`
- `skills/national_regulations/SKILL.md`
- `app/contracts/skills/legal_knowledge.py`
- `app/contracts/skills/loader.py`

Update the skill markdown first when regulation content changes, then keep the backend loader aligned with that structure.
