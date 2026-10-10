"""Content-preservation check — port of latex/content-preservation.ts.

Validates the deterministic JSON → LaTeX step: given the same ResumeJSON,
build_latex() must produce a document containing every field the user
actually has (accounting for the documented bullet-count cap), regardless
of the selected template. It does NOT extract text back out of the compiled
PDF (a naive scan would produce false "missing content" reports).
"""
from __future__ import annotations

from app.latex.build_latex import esc


def _compute_dropped_bullets(resume: dict, max_bullets: int) -> list[dict]:
    dropped: list[dict] = []
    for job in resume.get("experience") or []:
        overflow = (job.get("bullets") or [])[max_bullets:]
        for b in overflow:
            dropped.append({"role": f"{job.get('title','')} @ {job.get('company','')}", "bullet": b})
    return dropped


def check_content_preservation(resume: dict, latex: str, profile: dict) -> dict:
    missing: list[str] = []

    def contains(s: object) -> bool:
        return bool(s) and esc(s) in latex

    name_ok = (not resume.get("name")) or contains(resume["name"])
    if not name_ok:
        missing.append("Name")

    contact_ok = (not resume.get("contact")) or contains(resume["contact"])
    if not contact_ok:
        missing.append("Contact line")

    summary_present = bool(resume.get("summary"))
    if summary_present and not contains(resume["summary"]):
        missing.append("Summary")

    exp_found = 0
    for job in resume.get("experience") or []:
        role_label = f"{job.get('title','')} @ {job.get('company','')}"
        if contains(job.get("title")) and contains(job.get("company")):
            exp_found += 1
        else:
            missing.append(f"Experience: {role_label}")

    edu_found = 0
    for edu in resume.get("education") or []:
        if contains(edu.get("degree")) and contains(edu.get("school")):
            edu_found += 1
        else:
            missing.append(f"Education: {edu.get('degree','')} — {edu.get('school','')}")

    proj_found = 0
    for p in resume.get("projects") or []:
        if contains(p.get("name")):
            proj_found += 1
        else:
            missing.append(f"Project: {p.get('name','')}")

    skills_expected = 0
    skills_found = 0
    for items in (resume.get("skills") or {}).values():
        for s in items:
            skills_expected += 1
            if contains(s):
                skills_found += 1
            else:
                missing.append(f"Skill: {s}")

    cert_found = 0
    for c in resume.get("certifications") or []:
        if contains(c):
            cert_found += 1
        else:
            missing.append(f"Certification: {c}")

    addl_found = 0
    non_empty_additional = [s for s in (resume.get("additional_sections") or []) if s.get("entries")]
    for sec in non_empty_additional:
        if contains(sec.get("title")) and all(contains(e) for e in sec.get("entries", [])):
            addl_found += 1
        else:
            missing.append(f"Section: {sec.get('title','')}")

    dropped_bullets = _compute_dropped_bullets(resume, profile.get("max_bullets_per_role", 5))

    return {
        "passed": len(missing) == 0,
        "checked": {
            "name": name_ok,
            "contact": contact_ok,
            "summary_present": summary_present,
            "experience_entries": {"expected": len(resume.get("experience") or []), "found": exp_found},
            "education_entries": {"expected": len(resume.get("education") or []), "found": edu_found},
            "projects": {"expected": len(resume.get("projects") or []), "found": proj_found},
            "skills": {"expected": skills_expected, "found": skills_found},
            "certifications": {"expected": len(resume.get("certifications") or []), "found": cert_found},
            "additional_sections": {"expected": len(non_empty_additional), "found": addl_found},
        },
        "missing_content": missing,
        "dropped_bullets": dropped_bullets,
    }
