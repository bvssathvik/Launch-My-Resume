"""Pass 2 — JD-aware resume rewrite prompt (port of pass2-rewrite.ts)."""
from __future__ import annotations

import json
from typing import Any

FORMAT_GUIDES: dict[str, str] = {
    "moderncv-classic": """
      - Classic ModernCV layout with clean horizontal sections
      - Right-aligned dates and concise entry descriptions
      - Best for professional, academic, and experienced resumes
      - Keep contact and skills structured plainly""",
    "minimal-clean-tech": """
      - Single-column, understated styling with generous whitespace
      - Favor a small number of high-impact bullets per role over many short ones
      - Best for mid-level engineering profiles that want to look calm and confident""",
    "faang-style-compact": """
      - Dense single-column format built for fast recruiter screening
      - Bullet-first, metric-dense phrasing; front-load the outcome, not the task
      - Keep every bullet to one line where possible""",
    "bold-header-modern": """
      - Single-column with a bold colored header band — startup/product-facing
      - Keep the professional summary punchy since it sits right under a strong visual header
      - Sans-serif, modern phrasing; avoid overly formal/academic tone""",
    "ultra-clean-one-page": """
      - Single-column, extremely tight spacing aimed at fitting everything on one page
      - Trim aggressively: only the highest-relevance bullets per role
      - No filler phrasing — every line should earn its space""",
    "tech-focused-dense": """
      - The most compact single-column format — very small font, tight spacing
      - Maximize information density: short, punchy, technical bullets
      - Skills line is rendered in monospace, so keep it a clean comma-separated list""",
    "premium-minimalist": """
      - Single-column with generous margins and airy spacing — deliberately unhurried
      - Favor fewer, higher-quality bullets over a long exhaustive list
      - Refined, confident tone without sounding boastful""",
    "structured-executive-brief": """
      - Centered serif header, double hairline rule under each navy heading
      - Gravitas for senior candidates — no sidebar, no color block
      - Keep bullets concise and outcome-oriented; the layout reads best with fewer, stronger lines""",
}

FORMAT_ALIASES: dict[str, str] = {
    "Modern CV": "moderncv-classic",
    "ModernCV Classic": "moderncv-classic",
    "Executive Serif": "moderncv-classic",
    "Minimal Clean Tech": "minimal-clean-tech",
    "FAANG-Style Compact": "faang-style-compact",
    "Bold Header Modern": "bold-header-modern",
    "Ultra-Clean One-Page": "ultra-clean-one-page",
    "Tech-Focused Dense": "tech-focused-dense",
    "Premium Minimalist": "premium-minimalist",
    "Executive": "structured-executive-brief",
    "Structured Executive Brief": "structured-executive-brief",
}

PAGE_GUIDE = """
    Page count rules (follow strictly):
    - 0-3 years experience → 1 page maximum
    - 3-10 years experience → 1-2 pages
    - 10-15 years experience → 2 pages
    - 15+ years experience → 2-3 pages maximum
    Count experience from the resume provided."""


def build_pass2_prompt(resume: str, jd: str, keywords: dict, format_name: str, tone: str) -> str:
    normalized_format = format_name if format_name in FORMAT_GUIDES else FORMAT_ALIASES.get(format_name, "minimal-clean-tech")
    format_guide = FORMAT_GUIDES.get(normalized_format, FORMAT_GUIDES["minimal-clean-tech"])

    return f"""You are a senior resume strategist and career coach. Your task is to rewrite this resume so it passes ATS screening AND reads naturally to a human recruiter.

CANDIDATE'S ORIGINAL RESUME:
---
{resume}
---

TARGET JOB DESCRIPTION:
---
{jd}
---

KEYWORDS TO EMBED (from Pass 1 analysis):
- Must-have (embed in context, 1-2 times each): {json.dumps(keywords.get('must_have', []))}
- Important (embed where genuinely relevant, once each): {json.dumps(keywords.get('important', []))}
- Exact phrases (use these verbatim where they fit): {json.dumps(keywords.get('exact_phrases', []))}
- Industry terms (use naturally): {json.dumps(keywords.get('industry_terms', []))}
- Action verbs from JD (use these specifically): {json.dumps(keywords.get('action_verbs', []))}
- Job title to target: "{keywords.get('job_title', '')}"

  FORMAT: {format_guide}
TONE: {tone}
{PAGE_GUIDE}

CRITICAL REWRITE RULES:
1. TARGET 60-80% keyword coverage — NOT 100%. Over-stuffing gets flagged by modern ATS
2. Every keyword must appear in CONTEXT — not forced, not repeated unnaturally
3. Open the summary with a VALUE PROPOSITION: what you did, for whom, measured how
   NEVER use: "Seeking a challenging role" or "Looking for an opportunity"
   ALWAYS use: "Software engineer with 5 years building scalable APIs for fintech..."
4. EVERY bullet must contain a specific metric ONLY IF the original resume already contains or clearly implies that metric (%, $, users, time, team size)
   If the original resume has NO verifiable metric for an accomplishment, do NOT invent, estimate, or guess one — rewrite the bullet using only the facts that are actually supported by the original resume (scope, tools used, outcome described in words, etc.)
5. Start EVERY bullet with an action verb — USE the verbs from the JD list above
6. The rendered section labels for "experience", "education", "skills", "projects", and "certifications" are fixed by the template layer downstream — write natural content for those JSON fields; don't worry about the printed heading text.
   SECTION COUNT/SHAPE IS NEVER A REASON TO ADD OR REMOVE CONTENT:
   - If the original resume has NO experience yet (a student/new grad), NO projects, or NO certifications, leave the matching JSON field an empty array. Do NOT invent a role, project, or certification to fill it.
   - If the original resume has a section that doesn't fit "experience", "education", "skills", "projects", or "certifications" — e.g. Awards, Publications, Research, Leadership, Volunteer Experience, Languages, Interests, or any custom title — put it in "additional_sections" using the ORIGINAL section title (don't rename it) and its real content as a list of short entries. Never drop a section from the original resume just because it isn't one of the named fields.
   - Never fabricate a placeholder like "N/A", "None", or "No experience" for a section that's genuinely empty — omit the field/array instead.
7. NO tables, NO columns, NO icons, NO graphics — single column plain text only
8. ALL dates in format: "Month YYYY – Month YYYY" or "Month YYYY – Present"
9. Skills section = comma-separated plain text grouped by category — no ratings/bars. If the candidate has no skills to list, omit the "skills" field rather than inventing entries.
10. NEVER invent a job, degree, company, technology, metric, percentage, revenue figure, user count, team size, ranking, award, publication, or any other factual claim not present in or clearly implied by the original resume
11. DO reframe and elevate existing experience using JD language

Return ONLY valid JSON — nothing before or after:
{{
  "name": "Full Name from resume",
  "contact": "email | phone | linkedin URL | city, country",
  "summary": "4-sentence value proposition. S1: years + exact JD job title + top domain. S2: biggest achievement with metric. S3: 3 core skills matching JD must-haves. S4: what you bring to this specific company/role.",
  "experience": [
    {{
      "title": "Job Title",
      "company": "Company Name",
      "location": "City, Country",
      "dates": "Jan 2021 – Mar 2024",
      "bullets": [
        "Action verb + what + how + measurable result (e.g. Reduced API response time by 62% by rewriting database query layer, serving 40K daily requests with zero downtime)",
        "Action verb + JD keyword + context + metric",
        "Action verb + JD keyword + context + metric"
      ]
    }}
  ],
  "education": [
    {{
      "degree": "Bachelor of Technology in Computer Science",
      "school": "University Name",
      "location": "City, Country",
      "dates": "Aug 2017 – May 2021",
      "details": "CGPA: 8.4/10 | Relevant: Data Structures, Algorithms, DBMS"
    }}
  ],
  "skills": {{
    "Programming Languages": ["Python", "JavaScript", "TypeScript"],
    "Frameworks": ["React", "Node.js", "FastAPI"],
    "Cloud & DevOps": ["AWS", "Docker", "Kubernetes"],
    "Databases": ["PostgreSQL", "MongoDB", "Redis"],
    "Tools": ["Git", "Jira", "Postman"]
  }},
  "projects": [
    {{
      "name": "Project Name",
      "tech": "React, Node.js, AWS",
      "link": "github.com/handle/project",
      "bullets": [
        "Built X serving Y users with Z% uptime",
        "Implemented W reducing A by B%"
      ]
    }}
  ],
  "certifications": [
    "Certification Name | Issuer | Year"
  ],
  "additional_sections": [
    {{
      "title": "Publications (use the EXACT title from the original resume — Awards, Research, Leadership, Volunteer Experience, Languages, etc. are all valid; only include this field if the original resume actually has a section like this)",
      "entries": ["One real entry from the original resume, lightly rewritten — never invented"]
    }}
  ],
  "keywords_embedded": ["list of JD keywords you actually used"],
  "keywords_missing": ["JD keywords candidate genuinely does not have experience with"],
  "ats_score_estimate": 88,
  "improvements_made": [
    "Added metric to bullet about X",
    "Embedded 'microservices' keyword in 2 places naturally",
    "Rewrote summary to target Senior Backend Engineer role"
  ]
}}"""
