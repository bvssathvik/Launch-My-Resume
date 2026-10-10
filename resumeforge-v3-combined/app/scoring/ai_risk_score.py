"""AI Detection Risk Scorer — port of scoring/ai-risk-score.ts.

Checks whether the resume will be flagged as AI-generated.
Green (safe) / Yellow (review) / Red (likely flagged). Lower score = safer.
"""
from __future__ import annotations

import re

from app.prompts.pass3 import AI_BUZZWORDS

AI_RESUME_PATTERNS = [
    re.compile(r"\b(spearheaded|orchestrated|leveraged|championed|catalyzed)\b", re.IGNORECASE),
    re.compile(r"\b(cutting-edge|state-of-the-art|best-in-class|world-class|industry-leading)\b", re.IGNORECASE),
    re.compile(r"\b(seamlessly|holistically|strategically|dynamically|proactively)\b", re.IGNORECASE),
    re.compile(r"\b(passionate about|dedicated to|committed to|driven by)\b", re.IGNORECASE),
    re.compile(r"\b(synerg|paradigm|ecosystem|bandwidth|ideation)\b", re.IGNORECASE),
    re.compile(r"\b(thought leader|visionary|innovative|game.changer)\b", re.IGNORECASE),
]

GENERIC_PHRASES = [
    "results-driven", "self-starter", "team player", "hard-working",
    "go-getter", "detail-oriented", "fast learner", "quick learner",
    "strong communication", "excellent communication", "multi-tasker",
    "outside the box", "value-add", "move the needle", "deep dive",
]


def _detect_uniform_rhythm(bullets: list[str]) -> bool:
    if len(bullets) < 3:
        return False
    lengths = [len(b.split()) for b in bullets]
    avg = sum(lengths) / len(lengths)
    variance = sum((l - avg) ** 2 for l in lengths) / len(lengths)
    std_dev = variance ** 0.5
    return std_dev < 3


def _check_generic_phrases(text: str) -> list[str]:
    low = text.lower()
    return [p for p in GENERIC_PHRASES if p.lower() in low]


def _extract_all_bullets(resume: dict) -> list[str]:
    bullets: list[str] = []
    for job in resume.get("experience") or []:
        bullets.extend(job.get("bullets") or [])
    for proj in resume.get("projects") or []:
        bullets.extend(proj.get("bullets") or [])
    return bullets


def _resume_to_text(resume: dict) -> str:
    parts = [resume.get("summary") or ""]
    for job in resume.get("experience") or []:
        parts.extend(job.get("bullets") or [])
    return " ".join(parts)


def calculate_ai_risk_score(resume: dict) -> dict:
    text = _resume_to_text(resume)
    bullets = _extract_all_bullets(resume)

    buzzwords_found: list[str] = []
    for word in AI_BUZZWORDS:
        if re.search(rf"\b{re.escape(word)}\b", text, re.IGNORECASE):
            buzzwords_found.append(word)
    for pattern in AI_RESUME_PATTERNS:
        matches = pattern.findall(text)
        if matches:
            buzzwords_found.extend(m.lower() for m in matches)

    unique_buzzwords = list(dict.fromkeys(buzzwords_found))

    uniform_rhythm = _detect_uniform_rhythm(bullets)
    generic_phrases = _check_generic_phrases(text)

    buzzword_penalty = min(40, len(unique_buzzwords) * 5)
    rhythm_penalty = 25 if uniform_rhythm else 0
    generic_penalty = min(20, len(generic_phrases) * 5)
    length_penalty = 15 if bullets and all(len(b.split()) > 15 for b in bullets) else 0

    risk_score = min(100, buzzword_penalty + rhythm_penalty + generic_penalty + length_penalty)

    if risk_score <= 20:
        level = "low"
        recommendation = "Resume reads naturally. Low risk of AI detection. Safe to submit."
    elif risk_score <= 50:
        level = "medium"
        recommendation = f"Review and manually edit: {', '.join(unique_buzzwords[:3])}. Vary bullet lengths."
    else:
        level = "high"
        recommendation = f"High AI detection risk. Manually rewrite at least 30% of bullets. Remove: {', '.join(unique_buzzwords[:5])}."

    return {
        "score": risk_score,
        "level": level,
        "buzzwords_found": unique_buzzwords,
        "uniform_rhythm": uniform_rhythm,
        "generic_phrases": generic_phrases,
        "recommendation": recommendation,
    }
