"""Local RAG fact-checker (port of rag/fact-checker.ts).

Cross-checks every claim in the generated resume against the ORIGINAL resume
text + LinkedIn data. Pure, deterministic, no AI calls — this always runs
regardless of Pass 4's outcome.
"""
from __future__ import annotations

import re
from typing import List

from app.rag.resume_parser import ParsedResumeFacts

METRIC_IN_BULLET = re.compile(r"(\d+[\.,]?\d*\s*(?:%|percent|K|M|\$))", re.IGNORECASE)


def _exists_in_original(claim: str, original_resume: str) -> bool:
    claim_words = [w for w in claim.lower().split() if len(w) > 3]
    if not claim_words:
        return True
    resume_lower = original_resume.lower()
    found = [w for w in claim_words if w in resume_lower]
    return len(found) / len(claim_words) >= 0.6


def _is_metric_realistic(metric: str) -> bool:
    pct = re.search(r"(\d+)\s*%", metric)
    if pct:
        value = int(pct.group(1))
        if value > 200:
            return False
    billion = re.search(r"\$(\d+)\s*[Bb]illion", metric)
    if billion and int(billion.group(1)) > 1:
        return False
    return True


def _skill_in_original(skill: str, original_resume: str) -> bool:
    return skill.lower() in original_resume.lower()


def check_facts(generated: dict, original_resume: str, facts: ParsedResumeFacts, linkedin_data: str | None = None) -> List[dict]:
    claims: List[dict] = []

    for job in generated.get("experience") or []:
        title_in_original = _exists_in_original(job.get("title", ""), original_resume)
        claims.append({
            "claim": f"Job: {job.get('title', '')} at {job.get('company', '')}",
            "verified": title_in_original,
            "source": "original_resume",
            "flag": None if title_in_original else f'"{job.get("title")}" at "{job.get("company")}" not clearly found in original resume',
        })

        dates = job.get("dates", "")
        start_part = dates.split("–")[0].strip() or dates.split("-")[0].strip()
        date_in_original = any(start_part in original_resume for _ in [0]) or start_part in original_resume
        claims.append({
            "claim": f"Dates: {dates} at {job.get('company', '')}",
            "verified": date_in_original or len(facts.date_ranges) == 0,
            "source": "original_resume",
            "flag": None if (date_in_original or len(facts.date_ranges) == 0) else f'Date "{dates}" may not match original resume dates',
        })

        for bullet in job.get("bullets") or []:
            for metric in METRIC_IN_BULLET.findall(bullet):
                realistic = _is_metric_realistic(metric)
                claims.append({
                    "claim": f'Metric in bullet: "{metric}"',
                    "verified": realistic and _exists_in_original(" ".join(bullet.split()[:5]), original_resume),
                    "source": "original_resume" if realistic else "unverifiable",
                    "flag": None if realistic else f'Metric "{metric}" may be unrealistic — consider scaling back',
                })

    for category, skills in (generated.get("skills") or {}).items():
        for skill in skills:
            in_original = _skill_in_original(skill, original_resume)
            claims.append({
                "claim": f"Skill: {skill} ({category})" if not in_original else f"Skill: {skill}",
                "verified": in_original,
                "source": "original_resume",
                "flag": None if in_original else f'Skill "{skill}" not found in original resume — may have been added by AI',
            })

    for edu in generated.get("education") or []:
        edu_in_original = _exists_in_original(edu.get("school", ""), original_resume) or _exists_in_original(edu.get("degree", ""), original_resume)
        claims.append({
            "claim": f"Education: {edu.get('degree', '')} at {edu.get('school', '')}",
            "verified": edu_in_original,
            "source": "original_resume",
            "flag": None if edu_in_original else "Education entry not found in original resume",
        })

    for cert in generated.get("certifications") or []:
        cert_in_original = _exists_in_original(cert.split("|")[0].strip(), original_resume)
        claims.append({
            "claim": f"Certification: {cert}",
            "verified": cert_in_original,
            "source": "original_resume",
            "flag": None if cert_in_original else "Certification not found in original resume",
        })

    if linkedin_data:
        li_lower = linkedin_data.lower()
        for job in generated.get("experience") or []:
            company_in_li = job.get("company", "").lower() in li_lower
            if not company_in_li:
                claims.append({
                    "claim": f"LinkedIn: {job.get('company', '')}",
                    "verified": False,
                    "source": "linkedin",
                    "flag": f'Company "{job.get("company")}" not found in LinkedIn data — potential mismatch',
                })

    return claims


def remove_hallucinated_skills(resume: dict, original_resume: str) -> dict:
    cleaned = dict(resume)
    skills = cleaned.get("skills")
    if isinstance(skills, dict):
        cleaned_skills: dict = {}
        for category, items in skills.items():
            verified = [s for s in items if _skill_in_original(s, original_resume)]
            if verified:
                cleaned_skills[category] = verified
        cleaned["skills"] = cleaned_skills
    return cleaned
