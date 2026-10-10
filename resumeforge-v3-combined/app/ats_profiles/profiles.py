"""ATS platform profiles — port of ats-profiles/{generic,workday,greenhouse,lever}.ts.

Each profile drives the LaTeX builders (skills format, bullet caps) and
documents which ATS conventions matter for that platform. The scorer itself
is platform-independent (see scoring/ats_score.py).
"""
from __future__ import annotations

GENERIC_PROFILE: dict = {
    "name": "Generic",
    "section_order": [
        "Professional Summary",
        "Work Experience",
        "Education",
        "Skills",
        "Projects",
        "Certifications",
    ],
    "title_weight": 0.25,
    "skills_position": "bottom",
    "max_bullets_per_role": 5,
    "prefer_docx": True,  # DOCX safest for unknown ATS
    "extra_conservative": True,  # Maximum safety
    "notes": (
        "Generic / Unknown ATS rules:\n"
        "- Use most conservative formatting — plain single column\n"
        "- DOCX preferred over PDF for maximum parse compatibility\n"
        "- Standard section headers only\n"
        "- Simple date formats\n"
        "- No design elements whatsoever\n"
        "- Safe for: Taleo, iCIMS, BambooHR, ADP, SAP SuccessFactors"
    ),
}

WORKDAY_PROFILE: dict = {
    "name": "Workday",
    "section_order": [
        "Professional Summary",
        "Work Experience",
        "Education",
        "Skills",
        "Certifications",
    ],
    "title_weight": 0.40,  # 40% of score from job title match
    "skills_position": "bottom",
    "max_bullets_per_role": 5,
    "prefer_docx": True,  # Workday parses DOCX more reliably
    "extra_conservative": True,  # No creative formatting whatsoever
    "notes": (
        "Workday rules:\n"
        "- Job title in your resume MUST closely match the job posting title\n"
        '- Use "Work Experience" not "Experience" or "Professional Experience"\n'
        '- Dates must be in "MM/YYYY" or "Month YYYY" format — no ranges like "2020-22"\n'
        "- Education section MUST include full degree name and graduation year\n"
        "- Skills section: simple comma-separated list, no categories/headers inside\n"
        "- No tables, no text boxes, no columns — single column ONLY\n"
        "- Avoid headers/footers (Workday parser ignores them)\n"
        "- File size under 100KB preferred"
    ),
}

GREENHOUSE_PROFILE: dict = {
    "name": "Greenhouse",
    "section_order": [
        "Professional Summary",
        "Skills",
        "Work Experience",
        "Projects",
        "Education",
        "Certifications",
    ],
    "title_weight": 0.25,
    "skills_position": "after_summary",  # Greenhouse scans Skills first
    "max_bullets_per_role": 6,
    "prefer_docx": False,  # Greenhouse handles clean PDFs well
    "extra_conservative": False,
    "notes": (
        "Greenhouse rules:\n"
        "- Skills section immediately after summary (Greenhouse AI scans this first)\n"
        "- Format tolerant — clean PDF or DOCX both work well\n"
        "- Greenhouse uses semantic matching — context matters more than exact keywords\n"
        "- Structured data (JSON resume) is ideal but plain text PDF works fine\n"
        "- More lenient on formatting than Workday\n"
        "- Works well with modern single-column layouts"
    ),
}

LEVER_PROFILE: dict = {
    "name": "Lever",
    "section_order": [
        "Professional Summary",
        "Work Experience",
        "Skills",
        "Projects",
        "Education",
        "Certifications",
    ],
    "title_weight": 0.20,
    "skills_position": "bottom",
    "max_bullets_per_role": 6,
    "prefer_docx": False,
    "extra_conservative": False,
    "notes": (
        "Lever rules:\n"
        "- Most modern and flexible of the major ATS platforms\n"
        "- Good semantic understanding — context counts\n"
        "- Clean PDF parses reliably\n"
        "- Balanced weighting between title, skills, and experience\n"
        "- Works well with both clean and modern visual layouts"
    ),
}

PROFILES: dict[str, dict] = {
    "generic": GENERIC_PROFILE,
    "workday": WORKDAY_PROFILE,
    "greenhouse": GREENHOUSE_PROFILE,
    "lever": LEVER_PROFILE,
}


def get_ats_profile(target: str) -> dict:
    return PROFILES.get(target, GENERIC_PROFILE)
