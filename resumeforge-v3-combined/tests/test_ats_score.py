"""Tests for the deterministic ATS scorer."""
from app.scoring.ats_score import calculate_ats_score
from app.scoring.skills_canon import expand_canonical

RESUME = {
    "name": "Alex Rivera",
    "contact": "alex@example.com | Austin, TX",
    "summary": "Backend engineer with 5 years building scalable APIs for fintech.",
    "experience": [{
        "title": "Senior Backend Engineer",
        "company": "PayCore",
        "location": "Austin, TX",
        "dates": "Jan 2021 – Present",
        "bullets": ["Built payment APIs in Python serving 40K daily requests", "Cut fraud losses by 23%"],
    }],
    "education": [{
        "degree": "Bachelor of Science in Computer Science",
        "school": "State University", "location": "Austin, TX", "dates": "Aug 2015 – May 2019",
    }],
    "skills": {"Languages": ["Python", "TypeScript"], "Frameworks": ["FastAPI"]},
    "projects": [],
    "certifications": [],
}


def test_canonical_expansion():
    assert "Amazon Web Services" in expand_canonical("AWS")
    assert "JavaScript" in expand_canonical("JS")
    assert expand_canonical("Python") == ["Python"]


def test_aws_matches_full_form():
    resume_text = " ".join([
        RESUME.get("name", ""), RESUME.get("contact", ""),
        " | ".join(RESUME["experience"][0]["bullets"]),
        " | ".join(RESUME["skills"]["Languages"]),
    ])
    # "Amazon Web Services" is in the canonical group of AWS
    from app.scoring.ats_score import _keyword_present
    assert _keyword_present("AWS", "Worked with Amazon Web Services") is True


def test_score_shapes_and_ranges():
    keywords = {
        "job_title": "Senior Backend Engineer",
        "company": "PayCore",
        "must_have": ["Python", "FastAPI"],
        "important": ["Docker"],
        "nice_to_have": ["GraphQL"],
        "exact_phrases": [],
        "industry_terms": [],
        "action_verbs": ["built"],
    }
    res = calculate_ats_score(RESUME, keywords, "generic")
    assert 0 <= res["score"] <= 100
    assert res["score"] == res["matchScore"]
    assert "Python" in res["required_skills_found"]
    assert res["job_title_match"] in ("exact", "related", "none")
    assert 0 <= res["parsabilityScore"] <= 100
    assert 0 <= res["contentQualityScore"] <= 100
    assert res["disclaimer"]  # always present
    assert isinstance(res["explanation"], list) and len(res["explanation"]) > 0


def test_no_keywords_still_scores():
    res = calculate_ats_score(RESUME, {"job_title": "", "must_have": [], "important": []}, "generic")
    assert 0 <= res["score"] <= 100
