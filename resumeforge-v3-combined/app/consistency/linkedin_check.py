"""LinkedIn Consistency Checker — port of consistency/linkedin-check.ts.

Flags date/title/company mismatches between the generated resume and the
user's LinkedIn headline+date lines. Recruiters cross-check this.
"""
from __future__ import annotations

import re


def _extract_year(date_str: str) -> int | None:
    m = re.search(r"\d{4}", date_str)
    return int(m.group(0)) if m else None


def _fuzzy_match(a: str, b: str) -> bool:
    def normalize(s: str) -> str:
        return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s]", "", s.lower())).strip()

    na, nb = normalize(a), normalize(b)
    if na == nb:
        return True
    if na and nb and (na in nb or nb in na):
        return True
    words_a = na.split()
    words_b = nb.split()
    if not words_a or not words_b:
        return False
    common = [w for w in words_a if w in words_b and len(w) > 2]
    return len(common) / max(len(words_a), len(words_b)) >= 0.6


def _parse_linkedin_data(linkedin_text: str) -> list[dict]:
    lines = [l.strip() for l in linkedin_text.split("\n") if l.strip()]
    entries: list[dict] = []
    for line in lines:
        at_match = re.match(r"^(.+?)\s+at\s+(.+?)\s*[|\–\-]\s*(.+)$", line, re.IGNORECASE)
        if at_match:
            date_range = re.split(r"\s*[–\-]\s*", at_match.group(3))
            entries.append({
                "title": at_match.group(1).strip(),
                "company": at_match.group(2).strip(),
                "start": date_range[0].strip() if date_range else "",
                "end": date_range[1].strip() if len(date_range) > 1 else "Present",
            })
            continue
        pipe_match = [s.strip() for s in line.split("|")]
        if len(pipe_match) >= 3:
            date_range = re.split(r"\s*[–\-]\s*", pipe_match[2])
            entries.append({
                "title": pipe_match[0],
                "company": pipe_match[1],
                "start": date_range[0].strip() if date_range else "",
                "end": date_range[1].strip() if len(date_range) > 1 else "Present",
            })
    return entries


def check_linkedin_consistency(resume: dict, linkedin_data: str | None = None) -> dict:
    if not linkedin_data or not linkedin_data.strip():
        return {"checked": False, "flags": [], "all_clear": True}

    li_entries = _parse_linkedin_data(linkedin_data)
    if not li_entries:
        return {"checked": False, "flags": [], "all_clear": True}

    flags: list[dict] = []
    for job in resume.get("experience") or []:
        li_match = next(
            (li for li in li_entries if _fuzzy_match(li["company"], job.get("company", "")) or _fuzzy_match(li["title"], job.get("title", ""))),
            None,
        )
        if not li_match:
            continue

        if not _fuzzy_match(job.get("title", ""), li_match["title"]):
            flags.append({
                "type": "title_mismatch",
                "resume_value": job.get("title", ""),
                "linkedin_value": li_match["title"],
                "severity": "warning",
                "message": f'Job title differs: Resume says "{job.get("title")}" but LinkedIn shows "{li_match["title"]}" at {job.get("company")}',
            })

        resume_start_year = _extract_year(re.split(r"[–\-]", job.get("dates", ""))[0])
        li_start_year = _extract_year(li_match["start"])
        if resume_start_year and li_start_year and abs(resume_start_year - li_start_year) > 1:
            flags.append({
                "type": "date_mismatch",
                "resume_value": job.get("dates", ""),
                "linkedin_value": f"{li_match['start']} – {li_match['end']}",
                "severity": "critical",
                "message": f"Start date differs by more than 1 year: Resume says {resume_start_year}, LinkedIn shows {li_start_year} at {job.get('company')}",
            })

        if not _fuzzy_match(job.get("company", ""), li_match["company"]):
            flags.append({
                "type": "company_mismatch",
                "resume_value": job.get("company", ""),
                "linkedin_value": li_match["company"],
                "severity": "warning",
                "message": f'Company name differs: Resume says "{job.get("company")}", LinkedIn shows "{li_match["company"]}"',
            })

    return {"checked": True, "flags": flags, "all_clear": len(flags) == 0}
