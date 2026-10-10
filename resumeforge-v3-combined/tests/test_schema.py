"""Tests for the schema validators (port of the schema.ts contracts)."""
from app.schemas import validate_final_resume, validate_keywords, validate_rag, validate_resume


def test_validate_keywords_ok():
    v = {
        "job_title": "Senior Backend Engineer",
        "company": "Acme",
        "must_have": ["Python", "FastAPI"],
        "important": ["Docker"],
        "nice_to_have": ["GraphQL"],
        "exact_phrases": ["cross-functional teams"],
        "industry_terms": ["fintech"],
        "action_verbs": ["built", "led"],
    }
    assert validate_keywords(v) is True


def test_validate_keywords_rejects_bad_types():
    assert validate_keywords({"job_title": "X", "must_have": "not-a-list", "important": []}) is False
    assert validate_keywords({"job_title": "", "must_have": [], "important": []}) is False
    assert validate_keywords({"must_have": [], "important": []}) is False


def test_validate_resume_allows_missing_sections():
    # A student with no experience/education is a NORMAL resume.
    v = {"name": "Alex Rivera", "contact": "x@y.com", "skills": {"Langs": ["Python"]}}
    assert validate_resume(v) is True


def test_validate_resume_rejects_malformed():
    assert validate_resume({"name": "A", "experience": "not-a-list"}) is False
    assert validate_resume({"name": "A", "experience": [{"title": 42}]}) is False
    assert validate_resume({}) is False


def test_validate_rag():
    v = {"resume": {"name": "A", "contact": "x@y.com"}, "claims_checked": 3, "flags": []}
    assert validate_rag(v) is True
    assert validate_rag({"resume": {}}) is False


def test_validate_final_resume_gate():
    ok = {"name": "A", "contact": "x@y.com", "experience": [{"title": "Dev", "bullets": ["b"]}]}
    res = validate_final_resume(ok)
    assert res["ok"] is True and res["reasons"] == []

    bad = {"contact": "x@y.com"}
    res = validate_final_resume(bad)
    assert res["ok"] is False and "missing candidate name" in res["reasons"]

    sparse = {"name": "A", "contact": "x@y.com", "experience": []}
    res = validate_final_resume(sparse)
    assert res["ok"] is True and any("experience" in w for w in res["warnings"])
