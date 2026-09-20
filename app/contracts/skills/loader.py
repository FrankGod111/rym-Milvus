from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class SkillRule:
    title: str
    bullets: list[str]


@dataclass(frozen=True)
class SkillDocument:
    name: str
    description: str
    rules: list[SkillRule]


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent.parent


def _skills_dir() -> Path:
    return _repo_root() / "skills"


def _extract_frontmatter(text: str) -> tuple[str, str]:
    match = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not match:
        return "", text
    return match.group(1), match.group(2)


def _frontmatter_value(frontmatter: str, key: str) -> str:
    match = re.search(rf"^{re.escape(key)}:\s*(.+)$", frontmatter, re.M)
    return match.group(1).strip() if match else ""


def _parse_rules(body: str) -> list[SkillRule]:
    lines = body.splitlines()
    rules: list[SkillRule] = []
    current_title: str | None = None
    current_bullets: list[str] = []

    def flush() -> None:
        nonlocal current_title, current_bullets
        if current_title and current_bullets:
            rules.append(SkillRule(title=current_title, bullets=current_bullets[:]))
        current_title = None
        current_bullets = []

    for raw_line in lines:
        line = raw_line.strip()
        if line.startswith("## "):
            flush()
            current_title = line[3:].strip()
            continue
        if current_title and line.startswith("- "):
            current_bullets.append(line[2:].strip())
    flush()
    return rules


def load_skill_document(skill_name: str) -> SkillDocument:
    path = _skills_dir() / skill_name / "SKILL.md"
    text = path.read_text(encoding="utf-8")
    frontmatter, body = _extract_frontmatter(text)
    name = _frontmatter_value(frontmatter, "name") or skill_name
    description = _frontmatter_value(frontmatter, "description") or ""
    return SkillDocument(
        name=name,
        description=description,
        rules=_parse_rules(body),
    )


def flatten_skill_rules(documents: Iterable[SkillDocument]) -> list[str]:
    lines: list[str] = []
    for document in documents:
        if document.description:
            lines.append(f"技能：{document.name} — {document.description}")
        for rule in document.rules:
            lines.append(f"{rule.title}：")
            lines.extend(f"- {bullet}" for bullet in rule.bullets)
    return lines
