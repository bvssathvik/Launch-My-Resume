"""Typed JSON contracts between pipeline phases — port of schema.ts.

Each phase's raw AI output is parsed then validated here BEFORE it becomes
the next phase's input. Malformed output never flows forward — run_ai_phase
treats a failed validate as repairable (one retry, then failover).
"""
from __future__ import annotations

import json
from typing import Any, Optional


def parse_json(raw: str) -> dict:
    """Strip code fences and slice the outermost JSON object."""
    cleaned = raw.replace("```json", "").replace("```", "").strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON object found in AI response")
    return json.loads(cleaned[start : end + 1])


def _is_string_array(v: Any) -> bool:
    return isinstance(v, list) and all(isinstance(x, str) for x in v)


def validate_keywords(v: Any) -> bool:
    """Phase 1 contract — JD keyword/requirement extraction."""
    if not isinstance(v, dict):
        return False
    if not isinstance(v.get("job_title"), str) or not v["job_title"].strip():
        return False
    if not _is_string_array(v.get("must_have")):
        return False
    if not _is_string_array(v.get("important")):
        return False
    for key in ("nice_to_have", "exact_phrases", "industry_terms", "action_verbs"):
        if v.get(key) is not None and not _is_string_array(v[key]):
            return False
    return True


def validate_resume(v: Any) -> bool:
    """Phase 2 & 3 contract — a resume document (structure only, never which sections exist)."""
    if not isinstance(v, dict):
        return False
    if not isinstance(v.get("name"), str) or not v["name"].strip():
        return False
    if v.get("experience") is not None and not isinstance(v["experience"], list):
        return False
    if v.get("education") is not None and not isinstance(v["education"], list):
        return False
    if v.get("skills") is not None and not isinstance(v["skills"], dict):
        return False
    for job in v.get("experience") or []:
        if not isinstance(job, dict):
            return False
        if not isinstance(job.get("title"), str):
            return False
        if job.get("bullets") is not None and not _is_string_array(job["bullets"]):
            return False
    if v.get("additional_sections") is not None:
        if not isinstance(v["additional_sections"], list):
            return False
        for sec in v["additional_sections"]:
            if not isinstance(sec, dict):
                return False
            if not isinstance(sec.get("title"), str) or not sec["title"].strip():
                return False
            if sec.get("entries") is not None and not _is_string_array(sec["entries"]):
                return False
    return True


def validate_rag(v: Any) -> bool:
    """Phase 4 contract — { resume: ResumeJSON, claims_checked…, flags… }."""
    if not isinstance(v, dict):
        return False
    return validate_resume(v.get("resume"))


def validate_final_resume(resume: Any) -> dict:
    """Final output-validation gate — runs after phase 4, before PDF/DOCX.

    Section count/shape is NEVER a rejection reason (a student with no work
    experience is a normal resume). This only rejects genuine structural
    corruption: no name/contact, or a field of the wrong type.
    """
    reasons: list[str] = []
    warnings: list[str] = []

    if not isinstance(resume, dict):
        return {"ok": False, "reasons": ["missing resume object"], "warnings": warnings}
    if not isinstance(resume.get("name"), str) or not resume["name"].strip():
        reasons.append("missing candidate name")
    if not isinstance(resume.get("contact"), str) or not resume["contact"].strip():
        reasons.append("missing contact information")

    experience = resume.get("experience")
    if experience is not None and not isinstance(experience, list):
        reasons.append("experience field is malformed (not a list)")
    elif not experience or len(experience) == 0:
        warnings.append("no work experience section — leaving it out rather than fabricating one")
    else:
        for job in experience:
            if not isinstance(job, dict) or not isinstance(job.get("title"), str):
                reasons.append("an experience entry is malformed")
            elif not isinstance(job.get("bullets"), list) or len(job["bullets"]) == 0:
                warnings.append(f'no bullets for role "{job["title"]}" — role kept, bullets omitted rather than invented')

    education = resume.get("education")
    if education is not None and not isinstance(education, list):
        reasons.append("education field is malformed (not a list)")
    elif not education or len(education) == 0:
        warnings.append("no education section — leaving it out rather than fabricating one")

    skills = resume.get("skills")
    if skills is not None and not isinstance(skills, dict):
        reasons.append("skills field is malformed")
    elif not skills or len(skills) == 0:
        warnings.append("no skills section — leaving it out rather than fabricating one")

    additional = resume.get("additional_sections")
    if additional is not None and not isinstance(additional, list):
        reasons.append("additional_sections field is malformed (not a list)")

    return {"ok": len(reasons) == 0, "reasons": reasons, "warnings": warnings}
