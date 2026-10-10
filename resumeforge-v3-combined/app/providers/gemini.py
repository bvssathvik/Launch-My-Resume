"""Gemini provider adapter — Google Generative Language API (generateContent).

Direct port of geminiCall() in ai-provider.ts. Key goes in the
x-goog-api-key header, never the URL, never logged.
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

RETRYABLE_STATUS = (429, 500, 501, 502, 503, 504)
SAFETY_FINISH_REASONS = ("SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII")


def _is_retryable(status: int) -> bool:
    return status == 429 or (500 <= status < 600)


def _parse_candidates(body: Any) -> str:
    try:
        candidates = (body or {}).get("candidates") or []
        parts = []
        for cand in candidates:
            content = (cand or {}).get("content") or {}
            for part in (content.get("parts") or []):
                parts.append((part or {}).get("text") or "")
        return "".join(parts).strip()
    except Exception:  # noqa: BLE001
        return ""


async def gemini_call(opts: ProviderCallOptions) -> ProviderCallResult:
    settings = get_settings()
    key = settings.gemini_api_key
    if not key:
        raise AIError(UNAVAILABLE, "Gemini is not configured (GEMINI_API_KEY missing).", provider="gemini")

    model = opts.model_override or settings.gemini_model
    url = f"{settings.gemini_base_url}/v1beta/models/{model}:generateContent"
    t0 = time.time() * 1000

    budget_ms = ms_left(opts.deadline)
    timeout_ms = min(settings.per_call_timeout_ms, budget_ms)
    if timeout_ms <= 0:
        raise AIError(TIMEOUT, f'Deadline exceeded before calling Gemini for "{opts.label}".', provider="gemini")

    payload = {
        "contents": [{"role": "user", "parts": [{"text": opts.prompt}]}],
        "generationConfig": {
            "temperature": opts.temperature,
            "maxOutputTokens": opts.max_tokens,
            **({"responseMimeType": "application/json"} if opts.json_mode else {}),
        },
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_ms / 1000) as client:
            res = await client.post(
                url,
                headers={"Content-Type": "application/json", "x-goog-api-key": key},
                json=payload,
            )
    except httpx.TimeoutException:
        raise AIError(TIMEOUT, f'Gemini request timed out for "{opts.label}".', provider="gemini")
    except httpx.HTTPError:
        raise AIError(SERVER_ERROR, f'Gemini network error for "{opts.label}".', provider="gemini")

    if res.status_code >= 400:
        err_msg = ""
        try:
            err_data = res.json()
            err_msg = str((err_data.get("error") or {}).get("message") or "")
        except Exception:
            pass

        # Detect safety blocks surfaced at HTTP 400
        if any(w in err_msg.lower() for w in ("safety", "blocked", "filter", "inappropriate", "prohibited")):
            raise AIError(CONTENT_FILTERED, f'Gemini rejected input as inappropriate/flagged for "{opts.label}": {err_msg}', provider="gemini")

        retry_after = res.headers.get("retry-after")
        retry_after_ms = float(retry_after) * 1000 if _safe_float(retry_after) is not None and retry_after is not None else None
        if res.status_code in (401, 403):
            raise AIError(AUTH_FAILED, f'Gemini key problem while running "{opts.label}".', provider="gemini")
        if _is_retryable(res.status_code):
            etype = RATE_LIMITED if res.status_code == 429 else SERVER_ERROR
            raise AIError(etype, f"Gemini returned HTTP {res.status_code} for \"{opts.label}\".", retry_after_ms, "gemini")
        raise AIError(SERVER_ERROR, f"Gemini returned HTTP {res.status_code} for \"{opts.label}\".", provider="gemini")

    try:
        data = res.json()
    except Exception:  # noqa: BLE001
        raise AIError(INVALID_RESPONSE, "Gemini returned a malformed (non-JSON) response.", provider="gemini")

    # Explicit check for prompt feedback blockReason (e.g. SAFETY)
    prompt_feedback = data.get("promptFeedback") or {}
    block_reason = prompt_feedback.get("blockReason")
    if block_reason and block_reason not in ("BLOCK_REASON_UNSPECIFIED", ""):
        raise AIError(CONTENT_FILTERED, f'Gemini prompt blocked due to {block_reason} for "{opts.label}".', provider="gemini")

    # Check candidate finishReason for safety refusal
    candidates = data.get("candidates") or []
    if candidates:
        first_cand = candidates[0] or {}
        finish_reason = first_cand.get("finishReason")
        if finish_reason in SAFETY_FINISH_REASONS:
            raise AIError(CONTENT_FILTERED, f'Gemini candidate generation refused due to {finish_reason} for "{opts.label}".', provider="gemini")

    text = _parse_candidates(data)
    if not text:
        raise AIError(INVALID_RESPONSE, "Gemini returned an empty completion.", provider="gemini")

    return ProviderCallResult(text=text, provider="gemini", model=model, duration_ms=int(time.time() * 1000 - t0))


def _safe_float(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
