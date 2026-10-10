"""Original-resume parser — extracts structured facts (port of rag/resume-parser.ts).

These facts become the SOURCE OF TRUTH for RAG verification. Deterministic
regex extraction, no AI involved.
"""
from __future__ import annotations

import re
from typing import List

DATE_REGEX = re.compile(
    r"(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)?\s*\d{4}\s*[-–—]\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)?\s*(?:\d{4}|Present|present|Current|current))",
    re.IGNORECASE,
)
METRIC_REGEX = re.compile(
    r"(\d+[\.,]?\d*\s*(?:%|percent|K|M|B|\$|USD|users|customers|requests|ms|seconds|hours|days|weeks|engineers|developers|team members|employees|clients|projects|APIs|services|repos|deployments))",
    re.IGNORECASE,
)
BULLET_REGEX = re.compile(r"^[-•*▸►]\s+.+|^\d+[\.\)]\s+.+")
BULLET_STRIP = re.compile(r"^[-•*▸►\d\.\)]\s+")

CERT_KEYWORDS = ("certified", "certification", "certificate", "aws", "google cloud", "azure", "pmp", "cpa", "cfa", "ielts", "toefl")
EDU_KEYWORDS = ("bachelor", "master", "phd", "b.tech", "m.tech", "b.sc", "m.sc", "mba", "university", "college", "institute", "degree")
PROJ_KEYWORDS = ("project", "built", "developed", "created", "designed", "implemented", "github.com", "app:", "platform:", "system:")


class ParsedResumeFacts:
    def __init__(self) -> None:
        self.companies: List[str] = []
        self.job_titles: List[str] = []
        self.date_ranges: List[str] = []
        self.skills_mentioned: List[str] = []
        self.metrics_mentioned: List[str] = []
        self.projects: List[str] = []
        self.certifications: List[str] = []
        self.education: List[str] = []
        self.raw_bullets: List[str] = []


def parse_resume_facts(raw_resume: str) -> ParsedResumeFacts:
    facts = ParsedResumeFacts()
    lines = [l.strip() for l in raw_resume.split("\n") if l.strip()]

    facts.date_ranges = sorted(set(DATE_REGEX.findall(raw_resume)))
    facts.metrics_mentioned = sorted(set(METRIC_REGEX.findall(raw_resume)))

    for line in lines:
        if BULLET_REGEX.match(line):
            facts.raw_bullets.append(BULLET_STRIP.sub("", line))

    for line in lines:
        lower = line.lower()
        if any(k in lower for k in CERT_KEYWORDS):
            facts.certifications.append(line)

    for line in lines:
        lower = line.lower()
        if any(k in lower for k in EDU_KEYWORDS):
            facts.education.append(line)

    for line in lines:
        lower = line.lower()
        if any(k in lower for k in PROJ_KEYWORDS) and len(line) > 20:
            facts.projects.append(line)

    return facts


def build_verification_context(facts: ParsedResumeFacts) -> str:
    return "\n".join([
        "VERIFIED FACTS FROM ORIGINAL RESUME:",
        f"- Date ranges found: {', '.join(facts.date_ranges) or 'none'}",
        f"- Metrics actually mentioned: {', '.join(facts.metrics_mentioned) or 'none'}",
        f"- Certifications: {' | '.join(facts.certifications) or 'none'}",
        f"- Education lines: {' | '.join(facts.education) or 'none'}",
        f"- Projects mentioned: {' | '.join(facts.projects[:5]) or 'none'}",
        f"- Total bullet points in original: {len(facts.raw_bullets)}",
    ])
