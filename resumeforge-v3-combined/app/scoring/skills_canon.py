"""Controlled canonical/acronym matching dictionary — port of scoring/skills-canon.ts.

Plain substring matching means "Amazon Web Services" on a job post never
matches "AWS" on a resume, and "JavaScript" never matches "JS". This is a
small, hand-curated, EXPLICIT list of unambiguous acronym/full-form pairs —
no general synonym/embedding model.
"""
from __future__ import annotations

CANONICAL_GROUPS: list[list[str]] = [
    ["Amazon Web Services", "AWS"],
    ["Google Cloud Platform", "GCP", "Google Cloud"],
    ["Microsoft Azure", "Azure"],
    ["JavaScript", "JS"],
    ["TypeScript", "TS"],
    ["Node.js", "NodeJS", "Node"],
    ["React.js", "ReactJS", "React"],
    ["Vue.js", "VueJS", "Vue"],
    ["PostgreSQL", "Postgres"],
    ["MongoDB", "Mongo"],
    ["Kubernetes", "K8s"],
    ["Continuous Integration and Continuous Deployment", "CI/CD", "Continuous Integration/Continuous Deployment", "Continuous Integration and Continuous Delivery"],
    ["Machine Learning", "ML"],
    ["Artificial Intelligence", "AI"],
    ["Natural Language Processing", "NLP"],
    ["Deep Learning", "DL"],
    ["Application Programming Interface", "API"],
    ["User Interface", "UI"],
    ["User Experience", "UX"],
    ["Structured Query Language", "SQL"],
    ["Object-Oriented Programming", "OOP"],
    ["Representational State Transfer", "REST", "RESTful"],
    ["Extract, Transform, Load", "ETL"],
    ["Software Development Kit", "SDK"],
    ["Command Line Interface", "CLI"],
    ["Infrastructure as Code", "IaC"],
    ["Identity and Access Management", "IAM"],
    ["Virtual Private Cloud", "VPC"],
    ["Elastic Compute Cloud", "EC2"],
    ["Simple Storage Service", "S3"],
    ["Relational Database Management System", "RDBMS"],
    ["Customer Relationship Management", "CRM"],
    ["Enterprise Resource Planning", "ERP"],
    ["Microsoft Excel", "Excel", "MS Excel"],
    ["Microsoft Office", "MS Office"],
    ["Search Engine Optimization", "SEO"],
    ["Search Engine Marketing", "SEM"],
    ["Key Performance Indicator", "KPI"],
    ["Return on Investment", "ROI"],
    ["Quality Assurance", "QA"],
    ["Test-Driven Development", "TDD"],
    ["Continuous Integration", "CI"],
    ["Version Control System", "VCS"],
    [".NET", "DotNet", "Dot Net"],
    ["C#", "CSharp", "C Sharp"],
    ["C++", "CPlusPlus", "C Plus Plus"],
    ["Golang", "Go"],
    ["Objective-C", "ObjC"],
    ["Power BI", "PowerBI"],
    ["Amazon Redshift", "Redshift"],
    ["Google Analytics", "GA"],
    ["Project Management Professional", "PMP"],
    ["Bachelor of Technology", "B.Tech", "BTech", "Bachelor's in Technology"],
    ["Bachelor of Engineering", "B.E.", "BE"],
    ["Bachelor of Science", "B.Sc", "BSc"],
    ["Master of Technology", "M.Tech", "MTech"],
    ["Master of Science", "M.Sc", "MSc"],
    ["Master of Business Administration", "MBA"],
]

_LOOKUP: dict[str, int] = {}
for _idx, _group in enumerate(CANONICAL_GROUPS):
    for _term in _group:
        _LOOKUP[_term.lower()] = _idx


def expand_canonical(keyword: str) -> list[str]:
    """Every known equivalent surface form for a keyword (including itself).

    Returns the keyword unchanged if it isn't in the controlled dictionary —
    no guessing, no fuzzy fallback.
    """
    key = keyword.strip().lower()
    group_idx = _LOOKUP.get(key)
    if group_idx is None:
        return [keyword]
    return CANONICAL_GROUPS[group_idx]


BUZZWORDS: list[str] = [
    "hard worker",
    "team player",
    "go-getter",
    "results-driven",
    "results driven",
    "passionate professional",
    "detail-oriented",
    "detail oriented",
    "self-starter",
    "self starter",
    "think outside the box",
    "synergy",
    "fast-paced environment",
    "dynamic environment",
    "proven track record",
    "excellent communication skills",
    "highly motivated",
    "hardworking",
]

GENERIC_ACTION_VERBS: list[str] = [
    "led", "built", "designed", "developed", "implemented", "created",
    "launched", "managed", "architected", "engineered", "optimized",
    "improved", "reduced", "increased", "automated", "delivered",
    "drove", "spearheaded", "established", "streamlined", "deployed",
    "scaled", "migrated", "analyzed", "resolved", "mentored", "coordinated",
    "initiated", "authored", "presented", "negotiated", "researched",
]
