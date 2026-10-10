"""RAG trust score (port of rag/trust-scorer.ts)."""
from __future__ import annotations


def calculate_trust_score(claims: list, resume: dict, web_context: str) -> dict:
    total = len(claims)
    verified = sum(1 for c in claims if c.get("verified"))
    trust_score = round(verified / total * 100) if total > 0 else 100
    flags = [c for c in claims if not c.get("verified") and c.get("flag")]
    return {
        "resume": resume,
        "claims_checked": total,
        "claims_verified": verified,
        "trust_score": trust_score,
        "flags": flags,
        "web_context": web_context,
    }


def trust_label(score: int) -> str:
    if score >= 90:
        return "High Trust — almost all claims verified from original resume"
    if score >= 75:
        return "Medium Trust — most claims verified, review flagged items"
    return "Low Trust — several claims could not be verified — review carefully before submitting"


def trust_color(score: int) -> str:
    if score >= 90:
        return "green"
    if score >= 75:
        return "yellow"
    return "red"
