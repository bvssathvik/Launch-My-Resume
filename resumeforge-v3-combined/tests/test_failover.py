"""Tests for the bounded retry / failover core (run_ai_phase)."""
from __future__ import annotations

import asyncio
import json

import pytest

from app.core.errors import AUTH_FAILED, SERVER_ERROR, AIError
from app.providers.base import ProviderCallResult, ms_now
from app.providers import failover
from app.providers.failover import RunAIPhaseOptions, run_ai_phase


def _ok(text: str = '{"ok": true}', provider: str = "gemini") -> ProviderCallResult:
    return ProviderCallResult(text=text, provider=provider, model="fake", duration_ms=1)


def _run(coro):
    return asyncio.run(coro)


def _opts(**kw) -> RunAIPhaseOptions:
    base = dict(
        generation_id="g1", phase=1, name="test-phase", prompt="prompt",
        temperature=0.1, max_tokens=100, deadline=ms_now() + 60_000,
        default_provider="gemini", fallback_provider="groq", json_mode=True,
    )
    base.update(kw)
    return RunAIPhaseOptions(**base)


def test_falls_back_to_alternate_provider(monkeypatch):
    calls = []

    async def fake(provider, opts):
        calls.append(provider)
        if provider == "gemini":
            raise AIError(SERVER_ERROR, "Gemini 500")
        return _ok(provider="groq")

    monkeypatch.setattr(failover, "call_provider", fake)
    res = _run(run_ai_phase(_opts()))
    assert res.provider_used == "groq"
    assert res.attempts == 2
    assert calls == ["gemini", "groq"]


def test_auth_failure_switches_immediately(monkeypatch):
    calls = []

    async def fake(provider, opts):
        calls.append(provider)
        if provider == "gemini":
            raise AIError(AUTH_FAILED, "bad key")
        return _ok(provider="groq")

    monkeypatch.setattr(failover, "call_provider", fake)
    res = _run(run_ai_phase(_opts()))
    assert res.provider_used == "groq"
    assert calls == ["gemini", "groq"]


def test_json_repair_retries_same_provider(monkeypatch):
    tries = {"gemini": 0}

    async def fake(provider, opts):
        if provider == "gemini":
            tries["gemini"] += 1
            if tries["gemini"] == 1:
                return _ok(text="not json at all", provider="gemini")
            return _ok(provider="gemini")
        raise AssertionError("should not reach fallback")

    monkeypatch.setattr(failover, "call_provider", fake)
    res = _run(run_ai_phase(_opts()))
    assert res.provider_used == "gemini"
    assert res.repaired is True
    assert res.attempts == 2


def test_validation_failure_triggers_repair(monkeypatch):
    tries = {"gemini": 0}

    async def fake(provider, opts):
        if provider == "gemini":
            tries["gemini"] += 1
            return _ok(text='{"job_title": "X", "must_have": [], "important": []}') if tries["gemini"] == 1 else _ok(provider="gemini")
        raise AssertionError("no fallback expected")

    monkeypatch.setattr(failover, "call_provider", fake)

    def validate(v):
        return v.get("ok") is True

    res = _run(run_ai_phase(_opts(validate=validate)))
    assert res.provider_used == "gemini"
    assert res.repaired is True


def test_both_providers_fail_raises_normalized_error(monkeypatch):
    async def fake(provider, opts):
        raise AIError(SERVER_ERROR, f"{provider} down")

    monkeypatch.setattr(failover, "call_provider", fake)
    with pytest.raises(AIError) as ei:
        _run(run_ai_phase(_opts()))
    assert ei.value.error_type == SERVER_ERROR
    assert "failed on both providers" in ei.value.message


def test_content_filter_skips_repair_and_switches_immediately(monkeypatch):
    calls = []

    async def fake(provider, opts):
        calls.append(provider)
        if provider == "gemini":
            from app.core.errors import CONTENT_FILTERED
            raise AIError(CONTENT_FILTERED, "Gemini safety refusal", provider="gemini")
        return _ok(provider="groq")

    monkeypatch.setattr(failover, "call_provider", fake)
    res = _run(run_ai_phase(_opts()))
    assert res.provider_used == "groq"
    # Must switch directly to groq without attempting JSON repair on gemini
    assert calls == ["gemini", "groq"]


def test_content_filter_dominant_when_both_fail(monkeypatch):
    async def fake(provider, opts):
        from app.core.errors import CONTENT_FILTERED
        raise AIError(CONTENT_FILTERED, f"{provider} safety refusal")

    monkeypatch.setattr(failover, "call_provider", fake)
    with pytest.raises(AIError) as ei:
        _run(run_ai_phase(_opts()))
    from app.core.errors import CONTENT_FILTERED
    assert ei.value.error_type == CONTENT_FILTERED
