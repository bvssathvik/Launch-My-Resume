"""Tests for RAG modules: fact-checking, trust score, de-hallucination."""
from app.rag.fact_checker import check_facts, remove_hallucinated_skills
from app.rag.resume_parser import parse_resume_facts
from app.rag.trust_scorer import calculate_trust_score, trust_color
from app.consistency.linkedin_check import check_linkedin_consistency

ORIGINAL = """Alex Rivera
alex@example.com | Austin, TX

Senior Backend Engineer at PayCore, Jan 2021 - Present
- Built payment APIs in Python using FastAPI
- Cut fraud losses by 23% with a real-time rule engine

Education: B.Sc. Computer Science, State University, 2015-2019
Skills: Python, FastAPI, TypeScript, AWS
AWS Certified Developer
"""

GENERATED = {
    "name": "Alex Rivera",
    "contact": "alex@example.com | Austin, TX",
    "experience": [{
        "title": "Senior Backend Engineer", "company": "PayCore",
        "location": "Austin, TX", "dates": "Jan 2021 – Present",
        "bullets": ["Built payment APIs in Python using FastAPI", "Cut fraud losses by 23%", "Reduced costs by 340%"],
    }],
    "education": [{"degree": "B.Sc. Computer Science", "school": "State University", "location": "Austin, TX", "dates": "Aug 2015 – May 2019"}],
    "skills": {"Languages": ["Python", "TypeScript"], "Frameworks": ["FastAPI"], "Invented": ["Quantum Blockchain"]},
    "certifications": ["AWS Certified Developer | Amazon | 2022"],
    "projects": [],
}


def test_parse_resume_facts():
    facts = parse_resume_facts(ORIGINAL)
    assert any("Jan 2021" in d for d in facts.date_ranges)
    assert any("23%" in m for m in facts.metrics_mentioned)
    assert any("Python" in c for c in facts.certifications)
    assert len(facts.raw_bullets) >= 2


def test_check_facts_flags_unrealistic_metric():
    claims = check_facts(GENERATED, ORIGINAL, parse_resume_facts(ORIGINAL), None)
    flagged = [c for c in claims if not c["verified"]]
    assert any("340%" in c["claim"] for c in flagged)
    assert any("Skill: Quantum Blockchain" in c["claim"] for c in flagged)


def test_remove_hallucinated_skills():
    cleaned = remove_hallucinated_skills(GENERATED, ORIGINAL)
    flat = [s for items in cleaned["skills"].values() for s in items]
    assert "Python" in flat
    assert "Quantum Blockchain" not in flat


def test_trust_score_and_color():
    claims = check_facts(GENERATED, ORIGINAL, parse_resume_facts(ORIGINAL), None)
    result = calculate_trust_score(claims, GENERATED, "ctx")
    assert 0 <= result["trust_score"] <= 100
    assert result["claims_checked"] == len(claims)
    assert trust_color(95) == "green"


def test_linkedin_consistency_flags_start_date():
    linkedin = "Senior Backend Engineer at PayCore | 2018 – Present"
    res = check_linkedin_consistency(GENERATED, linkedin)
    assert res["checked"] is True
    kinds = {f["type"] for f in res["flags"]}
    assert "date_mismatch" in kinds
