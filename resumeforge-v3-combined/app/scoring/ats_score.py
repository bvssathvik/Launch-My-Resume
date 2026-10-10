"""ATS Score Calculator (deterministic rubric) — port of scoring/ats-score.ts.

THREE-SCORE ARCHITECTURE:
  - matchScore            — content match vs the specific job description.
  - parsabilityScore      — whether the generated document parses safely.
  - contentQualityScore   — writing quality signals (quantified impact,
                            action verbs, repetition, buzzwords).
`score` (top-level) equals `matchScore` for backward compatibility.

MATCHING: whole-word/whole-phrase only (no substring false positives),
plus a small explicit canonical/acronym dictionary. Every deduction is
explainable via `explanation`.
"""
from __future__ import annotations

import re
from datetime import datetime

from app.scoring.skills_canon import BUZZWORDS, GENERIC_ACTION_VERBS, expand_canonical

DISCLAIMER = (
    "ResumeForge's ATS Match Score is an estimated compatibility score based on "
    "this resume and this specific job description. There is no single universal "
    "ATS algorithm — different platforms (Workday, Greenhouse, Lever, etc.) parse "
    "and weight differently, and this score is not a guarantee of passing any "
    "specific employer's system."
)


def _escape_regex(s: str) -> str:
    return re.escape(s)


def _word_variants(word: str) -> list[str]:
    """Safe, explicit variant generation — NOT blind stemming."""
    w = word.strip()
    if not w:
        return []
    variants = {w}
    lower = w.lower()
    if re.search(r"[a-z]$", lower):
        variants.add(w + "s")
        variants.add(w + "es")
        if lower.endswith("y") and len(lower) > 2:
            variants.add(w[:-1] + "ies")
        if lower.endswith("e"):
            variants.add(w + "d")
            variants.add(w[:-1] + "ing")
        else:
            variants.add(w + "ed")
            variants.add(w + "ing")
    return list(variants)


def _single_term_present(keyword: str, text: str) -> bool:
    kw = keyword.strip()
    if not kw:
        return False
    is_phrase = bool(re.search(r"\s", kw)) or bool(re.search(r"[./#+]", kw))
    if is_phrase:
        pattern = re.compile(rf"\b{_escape_regex(kw).replace(chr(92)+'s', chr(92)+'s')}", re.IGNORECASE)
        # whole-phrase, whitespace-tolerant: \bAmazon\s+Web\s+Services
        escaped = _escape_regex(kw)
        pattern = re.compile(r"\b" + re.sub(r"\\\s", r"\\s+", escaped), re.IGNORECASE)
        return bool(pattern.search(text))
    variants = _word_variants(kw)
    pattern = re.compile(rf"\b({'|'.join(_escape_regex(v) for v in variants)})\b", re.IGNORECASE)
    return bool(pattern.search(text))


def _keyword_present(keyword: str, text: str) -> bool:
    return any(_single_term_present(term, text) for term in expand_canonical(keyword))


def _keyword_evidence(keyword: str, skills_text: str, experience_text: str) -> str:
    terms = expand_canonical(keyword)
    if any(_single_term_present(t, experience_text) for t in terms):
        return "experience"
    if any(_single_term_present(t, skills_text) for t in terms):
        return "skills-only"
    return "none"


def _resume_skills_text(resume: dict) -> str:
    parts: list[str] = []
    for cat, items in (resume.get("skills") or {}).items():
        parts.append(cat)
        parts.extend(items)
    parts.extend(resume.get("certifications") or [])
    return " | ".join(parts)


def _resume_experience_text(resume: dict) -> str:
    parts: list[str] = [resume.get("summary") or ""]
    for job in resume.get("experience") or []:
        parts.append(job.get("title", ""))
        parts.append(job.get("company", ""))
        parts.extend(job.get("bullets") or [])
    for proj in resume.get("projects") or []:
        parts.append(proj.get("name", ""))
        parts.append(proj.get("tech", ""))
        parts.extend(proj.get("bullets") or [])
    return " | ".join(parts)


def _resume_to_text(resume: dict) -> str:
    return " ".join([
        resume.get("name") or "",
        resume.get("contact") or "",
        _resume_experience_text(resume),
        _resume_skills_text(resume),
        " ".join(f"{e.get('degree','')} {e.get('school','')} {e.get('details') or ''}" for e in resume.get("education") or []),
    ])


def _check_section_headers(resume: dict) -> bool:
    return bool(resume.get("experience") and resume.get("education") and resume.get("skills"))


MONTH_YEAR = re.compile(r"^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}", re.IGNORECASE)


def _check_date_format(resume: dict) -> bool:
    all_correct = True
    for job in resume.get("experience") or []:
        if not MONTH_YEAR.match(job.get("dates", "")):
            all_correct = False
    for edu in resume.get("education") or []:
        dates = edu.get("dates")
        if dates and not MONTH_YEAR.match(dates) and not re.search(r"\d{4}", dates):
            all_correct = False
    return all_correct


_MONTHS = {
    "jan": 0, "feb": 1, "mar": 2, "apr": 3, "may": 4, "jun": 5,
    "jul": 6, "aug": 7, "sep": 8, "oct": 9, "nov": 10, "dec": 11,
}


def _estimate_experience_years(resume: dict) -> float:
    total_months = 0
    now = datetime.now()
    for job in resume.get("experience") or []:
        range_ = re.split(r"[–—-]", job.get("dates") or "")
        if len(range_) < 2:
            continue
        start_m = re.match(r"([A-Za-z]{3,})[a-z]*\s+(\d{4})", range_[0].strip())
        is_present = bool(re.search(r"present|current", range_[1], re.IGNORECASE))
        end_m = re.match(r"([A-Za-z]{3,})[a-z]*\s+(\d{4})", range_[1].strip())
        if not start_m:
            continue
        start_month = _MONTHS.get(start_m.group(1)[:3].lower())
        start_year = int(start_m.group(2))
        if start_month is None:
            continue
        if is_present:
            end_month, end_year = now.month - 1, now.year
        elif end_m:
            end_month = _MONTHS.get(end_m.group(1)[:3].lower())
            end_year = int(end_m.group(2))
            if end_month is None:
                continue
        else:
            continue
        months = (end_year - start_year) * 12 + (end_month - start_month)
        if months > 0:
            total_months += months
    return round((total_months / 12) * 10) / 10


def _match_job_title(required_title: str, resume: dict) -> str:
    title = (required_title or "").strip()
    if not title:
        return "none"
    most_recent = (resume.get("experience") or [{}])[0].get("title") or ""
    haystacks = [most_recent, resume.get("summary") or ""]
    for h in haystacks:
        if h and _single_term_present(title, h):
            return "exact"
    title_words = [w for w in title.lower().split() if len(w) > 3]
    if not title_words:
        return "none"
    resume_text = " ".join(haystacks).lower()
    overlap = sum(1 for w in title_words if w in resume_text)
    ratio = overlap / len(title_words)
    return "related" if ratio >= 0.5 else "none"


def _parse_required_years(required_years: str | None) -> float | None:
    if not required_years:
        return None
    m = re.search(r"(\d+(\.\d+)?)", required_years)
    return float(m.group(1)) if m else None


def _all_experience_bullets(resume: dict) -> list[str]:
    bullets: list[str] = []
    for job in resume.get("experience") or []:
        bullets.extend(job.get("bullets") or [])
    for proj in resume.get("projects") or []:
        bullets.extend(proj.get("bullets") or [])
    return bullets


def _score_content_quality(resume: dict, keywords: dict) -> dict:
    bullets = _all_experience_bullets(resume)
    warnings: list[str] = []

    quantified = [b for b in bullets if re.search(r"\d", b)]
    quantified_pct = round(len(quantified) / len(bullets) * 100) if bullets else 100
    if bullets and quantified_pct < 50:
        warnings.append(f"{len(bullets) - len(quantified)} of {len(bullets)} bullets have no measurable outcome (number, %, or metric).")

    action_verbs = [v.lower() for v in (keywords.get("action_verbs") or GENERIC_ACTION_VERBS)]
    starts_with_verb = []
    for b in bullets:
        first_word = re.sub(r"[^a-z]", "", (b.strip().split() or [""])[0].lower())
        hit = first_word and any(
            first_word == v
            or first_word == v[:-1] + "ed" if v.endswith("e") else first_word == v + "ed"
            or first_word == v
            or (v and first_word.startswith(v[: max(4, len(v) - 2)]))
            for v in action_verbs
        )
        if hit:
            starts_with_verb.append(b)
    action_verb_pct = round(len(starts_with_verb) / len(bullets) * 100) if bullets else 100
    if bullets and action_verb_pct < 50:
        warnings.append("Several bullets don't open with a strong action verb.")

    seen: dict[str, int] = {}
    for b in bullets:
        norm = b.strip().lower()
        seen[norm] = seen.get(norm, 0) + 1
    repeated_bullets = sum(1 for c in seen.values() if c > 1)
    if repeated_bullets > 0:
        warnings.append(f"{repeated_bullets} duplicate bullet(s) detected across sections.")

    full_text = " \n ".join([resume.get("summary") or "", *bullets]).lower()
    buzzwords_found = [b for b in BUZZWORDS if b.lower() in full_text]
    if buzzwords_found:
        warnings.append(f"Generic filler phrase(s) detected: {', '.join(buzzwords_found)}.")

    repetition_penalty = min(15, repeated_bullets * 5)
    buzzword_penalty = min(15, len(buzzwords_found) * 5)

    score = round(
        (quantified_pct * 0.40)
        + (action_verb_pct * 0.30)
        + (15 - repetition_penalty)
        + (15 - buzzword_penalty)
    )
    return {
        "score": max(0, min(100, score)),
        "quantified_pct": quantified_pct,
        "action_verb_pct": action_verb_pct,
        "buzzwords_found": buzzwords_found,
        "repeated_bullets": repeated_bullets,
        "warnings": warnings,
    }


def _score_parsability(resume: dict) -> dict:
    warnings: list[str] = []
    has_email = bool(re.search(r"[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}", resume.get("contact") or ""))
    contact_extractable = bool(resume.get("contact") and resume["contact"].strip())
    if contact_extractable and not has_email:
        warnings.append("No email address detected in contact line — some ATS parsers rely on this for candidate matching.")

    headers_ok = _check_section_headers(resume)
    if not headers_ok:
        warnings.append("Missing one or more standard sections (experience, education, or skills).")

    dates_ok = _check_date_format(resume)
    if not dates_ok:
        warnings.append("One or more dates aren't in a standard 'Mon YYYY' format.")

    skills_present = bool(resume.get("skills") and len(resume["skills"]) > 0)

    # Guaranteed true by our own generation pipeline (single-column, no
    # tables/images in the body) — reported explicitly rather than assumed.
    single_column = True
    no_tables_or_images = True

    checks = {
        "contact_extractable": contact_extractable and has_email,
        "section_headers_present": headers_ok,
        "dates_parseable": dates_ok,
        "skills_section_present": skills_present,
        "single_column_layout": single_column,
        "no_tables_or_images_in_body": no_tables_or_images,
    }
    weights = {
        "contact_extractable": 20,
        "section_headers_present": 20,
        "dates_parseable": 15,
        "skills_section_present": 15,
        "single_column_layout": 15,
        "no_tables_or_images_in_body": 15,
    }
    score = sum(weights[k] for k, v in checks.items() if v)
    return {"score": score, "checks": checks, "warnings": warnings}


def calculate_ats_score(resume: dict, keywords: dict, ats_target: str) -> dict:
    """Deterministic ATS match rubric (see module docstring for weighting)."""
    resume_text = _resume_to_text(resume)
    skills_text = _resume_skills_text(resume)
    experience_text = _resume_experience_text(resume)

    required_found = [kw for kw in keywords.get("must_have") or [] if _keyword_present(kw, resume_text)]
    required_missing = [kw for kw in keywords.get("must_have") or [] if not _keyword_present(kw, resume_text)]
    required_coverage = len(required_found) / len(keywords.get("must_have") or []) if keywords.get("must_have") else 1

    preferred_found = [kw for kw in keywords.get("important") or [] if _keyword_present(kw, resume_text)]
    preferred_missing = [kw for kw in keywords.get("important") or [] if not _keyword_present(kw, resume_text)]
    preferred_coverage = len(preferred_found) / len(keywords.get("important") or []) if keywords.get("important") else 1

    bonus_found = [kw for kw in keywords.get("nice_to_have") or [] if _keyword_present(kw, resume_text)]
    bonus_coverage = len(bonus_found) / len(keywords.get("nice_to_have") or []) if keywords.get("nice_to_have") else 1

    phrases_found = [p for p in keywords.get("exact_phrases") or [] if _keyword_present(p, resume_text)]
    phrases_coverage = len(phrases_found) / len(keywords.get("exact_phrases") or []) if keywords.get("exact_phrases") else 1

    headers_ok = _check_section_headers(resume)
    dates_ok = _check_date_format(resume)
    structural_score = ((1 if headers_ok else 0) + (1 if dates_ok else 0)) / 2

    title_match = _match_job_title(keywords.get("job_title", ""), resume)
    title_score = 1 if title_match == "exact" else (0.6 if title_match == "related" else 0)

    required_years = _parse_required_years(keywords.get("required_years"))
    estimated_years = _estimate_experience_years(resume)
    experience_score = 1.0
    experience_note = None
    if required_years is not None:
        if estimated_years >= required_years:
            experience_score = 1.0
        elif estimated_years >= required_years * 0.66:
            experience_score = 0.6
            experience_note = f"Estimated {estimated_years} yrs experience vs {required_years}+ requested."
        else:
            experience_score = 0.25
            experience_note = f"Estimated {estimated_years} yrs experience is below the {required_years}+ requested."

    has_keywords = bool(
        keywords.get("must_have")
        or keywords.get("important")
        or keywords.get("exact_phrases")
    )

    weights = {
        "required": 0.35,
        "preferred": 0.20,
        "phrases": 0.10,
        "title": 0.15,
        "experience": 0.10,
        "structure": 0.05,
        "bonus": 0.05,
    }

    if not has_keywords:
        raw_score = (structural_score * 0.8) + (title_score * 0.2)
    else:
        raw_score = (
            (required_coverage * weights["required"])
            + (preferred_coverage * weights["preferred"])
            + (phrases_coverage * weights["phrases"])
            + (title_score * weights["title"])
            + (experience_score * weights["experience"])
            + (structural_score * weights["structure"])
            + (bonus_coverage * weights["bonus"])
        )

    match_score = min(100, round(raw_score * 100))

    evidence_warnings: list[str] = []
    for kw in [*required_found, *preferred_found]:
        ev = _keyword_evidence(kw, skills_text, experience_text)
        if ev == "skills-only":
            evidence_warnings.append(f'"{kw}" only appears in the skills list — no supporting experience or project bullet.')

    explanation: list[str] = []
    if has_keywords:
        explanation.append(f"Required skills matched: {len(required_found)}/{len(keywords.get('must_have') or [])} ({round(required_coverage * 100)}%)")
        explanation.append(f"Preferred skills matched: {len(preferred_found)}/{len(keywords.get('important') or [])} ({round(preferred_coverage * 100)}%)")
        if keywords.get("exact_phrases"):
            explanation.append(f"Exact phrases matched: {len(phrases_found)}/{len(keywords['exact_phrases'])}")
    explanation.append(f"Job title alignment: {title_match}")
    if experience_note:
        explanation.append(experience_note)
    if not headers_ok:
        explanation.append("Missing a standard section (experience/education/skills).")
    if not dates_ok:
        explanation.append("Date formatting inconsistent with 'Mon YYYY' standard.")

    content_quality = _score_content_quality(resume, keywords)
    parsability = _score_parsability(resume)

    return {
        # backward-compatible fields
        "score": match_score,
        "must_have_coverage": round(required_coverage * 100),
        "important_coverage": round(preferred_coverage * 100),
        "keywords_found": [*required_found, *preferred_found, *phrases_found],
        "keywords_missing": [*required_missing, *preferred_missing],
        "section_headers_ok": headers_ok,
        "single_column": True,
        "date_format_ok": dates_ok,
        "breakdown": {
            "required": round(required_coverage * weights["required"] * 100),
            "preferred": round(preferred_coverage * weights["preferred"] * 100),
            "phrases": round(phrases_coverage * weights["phrases"] * 100),
            "title": round(title_score * weights["title"] * 100),
            "experience": round(experience_score * weights["experience"] * 100),
            "structure": round(structural_score * weights["structure"] * 100),
            "bonus": round(bonus_coverage * weights["bonus"] * 100),
        },
        # explicit three-score architecture
        "matchScore": match_score,
        "parsabilityScore": parsability["score"],
        "contentQualityScore": content_quality["score"],
        "required_skills_found": required_found,
        "required_skills_missing": required_missing,
        "preferred_skills_found": preferred_found,
        "preferred_skills_missing": preferred_missing,
        "job_title_match": title_match,
        "experience_match": {
            "required_years": required_years,
            "estimated_years": estimated_years,
        },
        "parsing_warnings": parsability["warnings"],
        "content_warnings": [*content_quality["warnings"], *evidence_warnings],
        "explanation": explanation,
        "disclaimer": DISCLAIMER,
    }
