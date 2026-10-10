"""End-to-end pipeline test with fake providers (no network)."""
from __future__ import annotations

import asyncio
import json

import pytest

from app.config import get_settings
from app.core.errors import JobInProgressError
from app.core.jobs import JobRegistry, new_job
from app.pipeline import run_generation
from app.providers import failover
from app.providers.base import ProviderCallResult

ORIGINAL = """Alex Rivera
alex@example.com | linkedin.com/in/alex | Austin, TX

Senior Backend Engineer at PayCore, Jan 2021 - Present
- Built payment APIs in Python using FastAPI and React
- Cut fraud losses by 23% with a real-time rule engine
- Lead a team of 4 engineers

Education: B.Sc. Computer Science, State University, 2015-2019
Skills: Python, FastAPI, TypeScript, AWS, React
AWS Certified Developer
"""

JD = """Senior Backend Engineer at a fintech company. Must have Python, FastAPI,
microservices, AWS. Preferred: TypeScript, React, Docker. 3+ years experience.
"""

RESUME_JSON = {
    "name": "Alex Rivera",
    "contact": "alex@example.com | linkedin.com/in/alex | Austin, TX",
    "summary": "Backend engineer with 5 years building scalable APIs for fintech.",
    "experience": [{
        "title": "Senior Backend Engineer", "company": "PayCore",
        "location": "Austin, TX", "dates": "Jan 2021 – Present",
        "bullets": ["Built payment APIs in Python using FastAPI and React", "Cut fraud losses by 23% with a real-time rule engine"],
    }],
    "education": [{"degree": "B.Sc. Computer Science", "school": "State University", "location": "Austin, TX", "dates": "Aug 2015 – May 2019"}],
    "skills": {"Languages": ["Python", "TypeScript"], "Frameworks": ["FastAPI", "React"]},
    "projects": [],
    "certifications": ["AWS Certified Developer | Amazon | 2022"],
    "improvements_made": ["Embedded 'microservices' naturally"],
}

KEYWORDS = {
    "job_title": "Senior Backend Engineer",
    "company": "PayCore",
    "must_have": ["Python", "FastAPI", "AWS"],
    "important": ["TypeScript", "Docker"],
    "nice_to_have": ["GraphQL"],
    "exact_phrases": ["cross-functional teams"],
    "required_years": "3+ years",
    "industry_terms": ["fintech"],
    "action_verbs": ["built", "led"],
}


def _fake_result_for(label: str) -> ProviderCallResult:
    provider = "gemini" if label in ("pass1-keywords", "pass2-rewrite") else "groq"
    if label == "pass1-keywords":
        text = json.dumps(KEYWORDS)
    elif label == "background-context":
        text = "PayCore is a fintech company focused on payments. Senior Backend Engineers build APIs in Python."
    elif label in ("pass2-rewrite", "pass3-humanize"):
        text = json.dumps(RESUME_JSON)
    elif label == "pass4-rag-verify":
        text = json.dumps({
            "resume": RESUME_JSON,
            "claims_checked": 4,
            "claims_verified": 4,
            "trust_score": 98,
            "flags": [],
            "web_context_used": "none",
        })
    else:  # pragma: no cover
        text = "{}"
    return ProviderCallResult(text=text, provider=provider, model="fake", duration_ms=1)


@pytest.fixture
def fake_provider(monkeypatch):
    async def fake(provider, opts):
        return _fake_result_for(opts.label)

    monkeypatch.setattr(failover, "call_provider", fake)


def _registry() -> JobRegistry:
    return JobRegistry(store_path="")  # in-memory only


def _run(coro):
    return asyncio.run(coro)


def test_full_pipeline_success(fake_provider):
    registry = _registry()
    resp = _run(run_generation({
        "resume": ORIGINAL, "job": JD, "ats_target": "generic", "format": "minimal-clean-tech",
        "tone": "professional",
    }, registry, get_settings()))

    assert resp["success"] is True
    assert resp["replay"] is False
    assert resp["generation_id"]
    assert resp["template_name"] == "minimal-clean-tech"
    assert resp["resumeJSON"]["name"] == "Alex Rivera"
    assert len(resp["phaseLog"]) == 4
    assert resp["atsScore"]["score"] >= 0
    assert resp["ragResult"]["trust_score"] == 100
    assert resp["verificationStatus"] == "VERIFIED"
    assert resp["humanizationStatus"] == "completed"
    assert resp["docxAvailable"] is True and resp["docxBase64"]
    assert resp["pdfAvailable"] is False  # PDF_ENABLED=false in tests
    assert resp["contentPreservation"]["passed"] is True
    assert any("microservices" in i for i in resp["improvements"])

    # completed job is stored
    stored = registry.load(resp["generation_id"])
    assert stored["status"] == "COMPLETED"


def test_pipeline_passes_target_title_to_keyword_prompt(fake_provider, monkeypatch):
    captured = {}
    original_call = failover.call_provider

    async def capture_prompt(provider, opts):
        if opts.label == "pass1-keywords":
            captured["prompt"] = opts.prompt
        return await original_call(provider, opts)

    async def no_background_lookup(*_args, **_kwargs):
        return ""

    monkeypatch.setattr(failover, "call_provider", capture_prompt)
    monkeypatch.setattr("app.pipeline.search_role_context", no_background_lookup)
    _run(run_generation({
        "resume": ORIGINAL,
        "job": JD,
        "target": "Principal Data Engineer",
        "format": "minimal-clean-tech",
    }, _registry(), get_settings()))

    assert "USER-PROVIDED TARGET JOB TITLE:\nPrincipal Data Engineer" in captured["prompt"]


def test_idempotent_replay(fake_provider):
    registry = _registry()
    body = {"resume": ORIGINAL, "job": JD, "format": "minimal-clean-tech", "generation_id": "11111111-1111-4111-8111-111111111111"}
    first = _run(run_generation(body, registry, get_settings()))
    assert first["replay"] is False
    second = _run(run_generation({**body, "format": "tech-focused-dense"}, registry, get_settings()))
    assert second["replay"] is True
    assert second["generation_id"] == first["generation_id"]
    assert second["template_name"] == first["template_name"]  # stored result, not re-run


def test_in_progress_rejected_409(fake_provider):
    registry = _registry()
    gid = "22222222-2222-4222-8222-222222222222"
    registry.save(new_job(gid))  # RUNNING, not stale
    with pytest.raises(JobInProgressError):
        _run(run_generation({"resume": ORIGINAL, "job": JD, "generation_id": gid}, registry, get_settings()))


def test_pipeline_fails_cleanly_when_provider_down(monkeypatch):
    async def fake(provider, opts):
        from app.core.errors import AIError, SERVER_ERROR
        raise AIError(SERVER_ERROR, "provider down")

    monkeypatch.setattr(failover, "call_provider", fake)
    registry = _registry()
    from app.core.errors import AIError as AIE
    with pytest.raises(AIE):
        _run(run_generation({"resume": ORIGINAL, "job": JD}, registry, get_settings()))
    failed = [j for j in registry.all().values()]
    assert failed and failed[0]["status"] == "FAILED"
