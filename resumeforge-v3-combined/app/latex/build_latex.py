"""JSON → LaTeX converter — port of latex/build-latex.ts.

Takes ResumeJSON + format + ATS profile and returns the complete LaTeX
document string. Fully deterministic. Content escaping happens once here,
through `esc()` — never per template.
"""
from __future__ import annotations

import logging

from app.ats_profiles.profiles import get_ats_profile
from app.latex import templates

log = logging.getLogger("resumeforge.latex")


def esc(s: object) -> str:
    """Escape special LaTeX characters (single canonical escape point)."""
    if not s:
        return ""
    out = (
        str(s)
        .replace("\\", "\\textbackslash{}")
        .replace("&", "\\&")
        .replace("%", "\\%")
        .replace("$", "\\$")
        .replace("#", "\\#")
        .replace("_", "\\_")
        .replace("{", "\\{")
        .replace("}", "\\}")
        .replace("~", "\\textasciitilde{}")
        .replace("^", "\\textasciicircum{}")
        .replace("<", "\\textless{}")
        .replace(">", "\\textgreater{}")
        .replace("|", "\\textbar{}")
        .replace('"', "''")
        # Normalize Unicode punctuation after escaping so inserted LaTeX
        # macros are not escaped as literal text.
        .replace("\u2010", "-")
        .replace("\u2011", "-")
        .replace("\u2012", "-")
        .replace("\u2212", "-")
        .replace("\u2013", "--")
        .replace("\u2014", "---")
        .replace("\u2018", "'")
        .replace("\u2019", "'")
        .replace("\u201c", "''")
        .replace("\u201d", "''")
        .replace("\u2026", "\\ldots{}")
        .replace("\u2022", "\\textbullet{}")
        .replace("\u25cf", "\\textbullet{}")
        .replace("\u00a0", " ")
    )
    return out


def build_header(resume: dict) -> str:
    return (
        "\\begin{center}\n"
        f"  {{\\LARGE\\bfseries {esc(resume.get('name'))}}}\\\\[5pt]\n"
        f"  {{\\small {esc(resume.get('contact'))}}}\n"
        "\\end{center}\n"
        "\\vspace{2pt}"
    )


def build_experience(resume: dict, max_bullets: int) -> str:
    blocks = []
    for job in resume.get("experience") or []:
        bullets = (job.get("bullets") or [])[:max_bullets]
        itemize = ""
        if bullets:
            itemize = "\n\\begin{itemize}\n" + "\n".join(f"  \\item {esc(b)}" for b in bullets) + "\n\\end{itemize}"
        blocks.append(
            rf"\noindent\textbf{{{esc(job.get('title'))}}} \hfill {{\small\textit{{{esc(job.get('dates'))}}}}}\\"
            "\n"
            rf"\textit{{{esc(job.get('company'))}}} $\cdot$ {{\small {esc(job.get('location'))}}}{itemize}\vspace{{1pt}}"
        )
    return "\n".join(blocks)


def build_education(resume: dict) -> str:
    blocks = []
    for edu in resume.get("education") or []:
        details = f"\\\\{{\\small {esc(edu.get('details'))}}}" if edu.get("details") else ""
        blocks.append(
            rf"\noindent\textbf{{{esc(edu.get('degree'))}}} \hfill {{\small\textit{{{esc(edu.get('dates'))}}}}}\\"
            "\n"
            rf"\textit{{{esc(edu.get('school'))}}} $\cdot$ {{\small {esc(edu.get('location'))}}}{details}\vspace{{2pt}}"
        )
    return "\n".join(blocks)


def build_skills(resume: dict, profile: dict) -> str:
    skills = resume.get("skills") or {}
    if profile.get("extra_conservative") or profile.get("name") == "Workday":
        all_skills = [s for items in skills.values() for s in items]
        return "\\noindent " + ", ".join(esc(s) for s in all_skills)
    parts = []
    for cat, items in skills.items():
        parts.append(rf"\noindent\textbf{{{esc(cat)}:}} {', '.join(esc(s) for s in items)}")
    return "\n\n".join(parts)


def build_projects(resume: dict) -> str:
    if not resume.get("projects"):
        return ""
    blocks = []
    for p in resume["projects"]:
        bullets = p.get("bullets") or []
        itemize = ""
        if bullets:
            itemize = "\n\\begin{itemize}\n" + "\n".join(f"  \\item {esc(b)}" for b in bullets) + "\n\\end{itemize}"
        link = rf" \hfill {{\small\url{{{esc(p.get('link'))}}}}}" if p.get("link") else ""
        blocks.append(
            rf"\noindent\textbf{{{esc(p.get('name'))}}}{link}\\"
            "\n"
            rf"{{\small\textit{{{esc(p.get('tech'))}}}}}{itemize}\vspace{{1pt}}"
        )
    return "\n".join(blocks)


def build_certifications(resume: dict) -> str:
    certs = resume.get("certifications") or []
    if not certs:
        return ""
    items = "\n".join(f"  \\item {esc(c)}" for c in certs)
    return f"\\begin{{itemize}}\n{items}\n\\end{{itemize}}\n"


def build_additional_sections(resume: dict) -> str:
    out = []
    for sec in resume.get("additional_sections") or []:
        if not (sec.get("title", "").strip() and sec.get("entries")):
            continue
        items = "\n".join(f"  \\item {esc(e)}" for e in sec["entries"])
        out.append(f"\\section{{{esc(sec['title'])}}}\n\\begin{{itemize}}\n{items}\n\\end{{itemize}}\n")
    return "\n".join(out)


ALIASES: dict[str, str] = {
    "modern cv": "moderncv-classic",
    "moderncv classic": "moderncv-classic",
    "moderncv-classic": "moderncv-classic",
    "executive serif": "moderncv-classic",
    "minimal clean tech": "minimal-clean-tech",
    "minimal-clean-tech": "minimal-clean-tech",
    "faang-style compact": "faang-style-compact",
    "faang style compact": "faang-style-compact",
    "faang-style-compact": "faang-style-compact",
    "bold header modern": "bold-header-modern",
    "bold-header-modern": "bold-header-modern",
    "ultra-clean one-page": "ultra-clean-one-page",
    "ultra clean one page": "ultra-clean-one-page",
    "ultra-clean-one-page": "ultra-clean-one-page",
    "tech-focused dense": "tech-focused-dense",
    "tech focused dense": "tech-focused-dense",
    "tech-focused-dense": "tech-focused-dense",
    "premium minimalist": "premium-minimalist",
    "premium-minimalist": "premium-minimalist",
    "executive": "structured-executive-brief",
    "structured executive brief": "structured-executive-brief",
    "structured-executive-brief": "structured-executive-brief",
}

RENDERERS: dict[str, callable] = {
    "moderncv-classic": templates.moderncv_classic,
    "minimal-clean-tech": templates.minimal_clean_tech,
    "faang-style-compact": templates.faang_style_compact,
    "bold-header-modern": templates.bold_header_modern,
    "ultra-clean-one-page": templates.ultra_clean_one_page,
    "tech-focused-dense": templates.tech_focused_dense,
    "premium-minimalist": templates.premium_minimalist,
    "structured-executive-brief": templates.structured_executive_brief,
}


def build_latex(resume: dict, format_name: str, profile: dict | None = None) -> str:
    """Build the complete LaTeX document for a ResumeJSON + format + ATS profile."""
    profile = profile or get_ats_profile("generic")
    sections = {
        "header": build_header(resume),
        "summary": esc(resume.get("summary") or ""),
        "experience": build_experience(resume, profile.get("max_bullets_per_role", 5)),
        "education": build_education(resume),
        "skills": build_skills(resume, profile) if resume.get("skills") and len(resume["skills"]) else "",
        "projects": build_projects(resume) or None,
        "certifications": build_certifications(resume) or None,
        "additional_sections": build_additional_sections(resume) or None,
    }

    requested_key = str(format_name).strip().lower()
    normalized = ALIASES.get(requested_key)
    if not normalized:
        log.warning(
            '[build-latex] Unrecognized format "%s" — falling back to minimal-clean-tech. '
            "Check the frontend's TPL_MAP / formatAliases for a mismatch.",
            format_name,
        )
    resolved = normalized or "minimal-clean-tech"
    return RENDERERS[resolved](sections)
