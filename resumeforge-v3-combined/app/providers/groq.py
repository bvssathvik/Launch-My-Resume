"""Groq provider adapter — OpenAI-compatible chat completions.

Direct port of groqCall() in ai-provider.ts. Bearer token in the
Authorization header, never logged.
"""
from __future__ import annotations

import time
from typing import Any

import httpx

from app.config import get_settings
from app.core.errors import (
    AUTH_FAILED, CONTENT_FILTERED, INVALID_RESPONSE, SERVER_ERROR, TIMEOUT, UNAVAILABLE,
    RATE_LIMITED, AIError,
)
from app.providers.base import ProviderCallOptions, ProviderCallResult, ms_left


def _is_retryable(status: int) -> bool:
    return status == 429 or (500 <= status < 600)


async def groq_call(opts: ProviderCallOptions) -> ProviderCallResult:
    settings = get_settings()
    key = settings.groq_api_key
    if not key:
        raise AIError(UNAVAILABLE, "Groq is not configured (GROQ_API_KEY missing).", provider="groq")

    model = opts.model_override or settings.groq_model
    url = f"{settings.groq_base_url}/chat/completions"
    t0 = time.time() * 1000

    budget_ms = ms_left(opts.deadline)
    timeout_ms = min(settings.per_call_timeout_ms, budget_ms)
    if timeout_ms <= 0:
        raise AIError(TIMEOUT, f'Deadline exceeded before calling Groq for "{opts.label}".', provider="groq")

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": opts.prompt}],
        "temperature": opts.temperature,
        "max_tokens": opts.max_tokens,
        **({"response_format": {"type": "json_object"}} if opts.json_mode else {}),
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_ms / 1000) as client:
            res = await client.post(
                url,
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
                json=payload,
            )
    except httpx.TimeoutException:
        raise AIError(TIMEOUT, f'Groq request timed out for "{opts.label}".', provider="groq")
    except httpx.HTTPError:
        raise AIError(SERVER_ERROR, f'Groq network error for "{opts.label}".', provider="groq")

    if res.status_code >= 400:
        retry_after = res.headers.get("retry-after")
        retry_after_ms = None
        if isinstance(retry_after, str):
            try:
                retry_after_ms = float(retry_after) * 1000
            except ValueError:
                retry_after_ms = None
        if res.status_code in (401, 403):
            raise AIError(AUTH_FAILED, f'Groq key problem while running "{opts.label}".', provider="groq")
        if _is_retryable(res.status_code):
            etype = RATE_LIMITED if res.status_code == 429 else SERVER_ERROR
            raise AIError(etype, f"Groq returned HTTP {res.status_code} for \"{opts.label}\".", retry_after_ms, "groq")
        raise AIError(SERVER_ERROR, f"Groq returned HTTP {res.status_code} for \"{opts.label}\".", provider="groq")

    try:
        data = res.json()
    except Exception:  # noqa: BLE001
        raise AIError(INVALID_RESPONSE, "Groq returned a malformed (non-JSON) response.", provider="groq")

    text = ""
    try:
        choices = (data or {}).get("choices") or []
        if choices:
            first_choice = choices[0] or {}
            finish_reason = first_choice.get("finish_reason")
            if finish_reason == "content_filter":
                raise AIError(CONTENT_FILTERED, f'Groq filtered content due to content_filter policy for "{opts.label}".', provider="groq")
            text = (first_choice.get("message") or {}).get("content") or ""
            text = text.strip()
    except AIError:
        raise
    except Exception:  # noqa: BLE001
        text = ""
    if not text:
        raise AIError(INVALID_RESPONSE, "Groq returned an empty completion.", provider="groq")

    return ProviderCallResult(text=text, provider="groq", model=model, duration_ms=int(time.time() * 1000 - t0))
