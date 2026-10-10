"""Tests for LaTeX build + content preservation."""
from app.ats_profiles.profiles import get_ats_profile
from app.latex.build_latex import esc, build_latex
from app.latex.content_preservation import check_content_preservation

RESUME = {
    "name": "Alex Rivera",
    "contact": "alex@example.com | linkedin.com/in/alex | Austin, TX",
    "summary": "Backend engineer with 5 years building scalable APIs.",
    "experience": [{
        "title": "Senior Backend Engineer", "company": "PayCore",
        "location": "Austin, TX", "dates": "Jan 2021 – Present",
        "bullets": ["Built payment APIs in Python", "Cut fraud losses by 23%"],
    }],
    "education": [{
        "degree": "B.Sc. Computer Science", "school": "State University",
        "location": "Austin, TX", "dates": "Aug 2015 – May 2019",
    }],
    "skills": {"Languages": ["Python", "TypeScript"], "Frameworks": ["FastAPI"]},
    "projects": [{"name": "Ledger", "tech": "Python, AWS", "link": "github.com/alex/ledger", "bullets": ["Served 10K users"]}],
    "certifications": ["AWS Certified Developer | Amazon | 2022"],
    "additional_sections": [{"title": "Awards", "entries": ["Best Engineer 2022 — PayCore"]}],
}


def test_escapes_latex_specials():
    assert esc("a&b") == "a\\&b"
    assert esc("100%") == "100\\%"
    assert esc("x_y") == "x\\_y"
    assert esc("") == ""


def test_build_latex_all_templates():
    from app.latex.build_latex import RENDERERS
    assert set(RENDERERS) == {
        "moderncv-classic", "minimal-clean-tech", "faang-style-compact",
        "bold-header-modern", "ultra-clean-one-page", "tech-focused-dense",
        "premium-minimalist", "structured-executive-brief",
    }
    for fmt in RENDERERS:
        latex = build_latex(RESUME, fmt, get_ats_profile("generic"))
        assert "\\begin{document}" in latex
        assert "\\end{document}" in latex
        assert "PayCore" in latex


def test_content_preservation_passes():
    profile = get_ats_profile("generic")
    latex = build_latex(RESUME, "minimal-clean-tech", profile)
    report = check_content_preservation(RESUME, latex, profile)
    assert report["passed"] is True, report["missing_content"]
    assert report["checked"]["experience_entries"]["found"] == 1
    assert report["checked"]["skills"]["found"] == 3
    assert report["checked"]["additional_sections"]["found"] == 1


def test_content_preservation_detects_bullet_cap_trim():
    big = {
        **RESUME,
        "experience": [{
            "title": "Senior Backend Engineer", "company": "PayCore",
            "location": "Austin, TX", "dates": "Jan 2021 – Present",
            "bullets": [f"Bullet number {i} with plenty of words" for i in range(9)],
        }],
    }
    profile = get_ats_profile("generic")  # max_bullets_per_role = 5
    latex = build_latex(big, "minimal-clean-tech", profile)
    report = check_content_preservation(big, latex, profile)
    assert report["passed"] is True  # trimming is EXPECTED, not missing content
    assert len(report["dropped_bullets"]) == 4
