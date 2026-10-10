"""run_ai_phase — the bounded retry/failover loop used by every phase.

Direct port of runAIPhase() in providers/ai-provider.ts:

  1. Try the phase's default provider (deadline-bounded timeout).
  2. On retryable failure (429 / 5xx / timeout / malformed JSON), try
     ONCE more on the same provider for malformed-JSON repair, then fail
     over to the alternate provider.
  3. Never more than MAX_ATTEMPTS_PER_PHASE total provider attempts.
  4. Auth failures (401/403) are terminal for that provider immediately.

`call_provider` is a module-level hook so tests can inject fake providers
without network access — production behavior is unchanged.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

from app.config import get_settings
from app.core.errors import (
    AUTH_FAILED, CONTENT_FILTERED, INVALID_RESPONSE, INTERNAL, RATE_LIMITED, SERVER_ERROR,
    TIMEOUT, UNAVAILABLE, VALIDATION, AIError,
)
from app.providers.base import (
    ProviderCallOptions, ProviderCallResult, ProviderName, ms_left, ms_now,
)
from app.providers.gemini import gemini_call
from app.providers.groq import groq_call

log = logging.getLogger("resumeforge.providers")

# Test hook — monkeypatched by tests; delegates to the real adapters by default.
async def call_provider(provider: ProviderName, opts: ProviderCallOptions) -> ProviderCallResult:
    if provider == "gemini":
        return await gemini_call(opts)
    return await groq_call(opts)


def default_parse(raw: str) -> Any:
    """Strip code fences and slice the outermost JSON object (schema.ts parseJSON)."""
    cleaned = raw.replace("```json", "").replace("```", "").strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON object found in AI response")
    import json as _json

    return _json.loads(cleaned[start : end + 1])


@dataclass
class RunAIPhaseOptions:
    generation_id: str
    phase: int
    name: str  # human label, e.g. "pass1-keywords"
    prompt: str
    temperature: float
    max_tokens: int
    deadline: float
    default_provider: ProviderName
    fallback_provider: Optional[ProviderName] = None
    json_mode: bool = False
    model_override: Optional[str] = None
    validate: Optional[Callable[[Any], bool]] = None
    parse: Optional[Callable[[str], Any]] = None  # defaults to default_parse


@dataclass
class RunAIPhaseResult:
    text: str
    parsed: Any
    provider_used: ProviderName
    attempts: int
    repaired: bool
    duration_ms: int


def _log_attempt(entry: dict) -> None:
    parts = [
        f"generation_id={entry['generation_id']}",
        f"phase={entry['phase']}",
        f"provider={entry['provider']}",
        f"attempt={entry['attempt']}",
        f"status={entry['status']}",
        f"duration_ms={entry['duration_ms']}",
    ]
    if entry.get("error_type"):
        parts.append(f"error_type={entry['error_type']}")
    if entry.get("fallback"):
        parts.append(f"fallback={entry['fallback']}")
    log.info(" ".join(parts))


def _build_failure_message(name: str, log_: list) -> str:
    summary = ", ".join(f"{l[0]}:{l[1]}" for l in log_)
    return f'AI phase "{name}" failed on both providers after bounded retries ({summary}). Please try again in a minute.'


async def run_ai_phase(opts: RunAIPhaseOptions) -> RunAIPhaseResult:
    settings = get_settings()
    providers: list[ProviderName] = [opts.default_provider] + ([opts.fallback_provider] if opts.fallback_provider else [])
    parse_fn = opts.parse or default_parse
    attempt_log: list[tuple[str, str]] = []  # (provider, error_type)
    total_attempts = 0
    overall_start = ms_now()

    for provider in providers:
        last_raw = ""
        for _pass in range(settings.max_json_repair_per_provider + 1):
            if total_attempts >= settings.max_attempts_per_phase:
                break
            if ms_left(opts.deadline) <= 0:
                raise AIError(TIMEOUT, f'Deadline exceeded running "{opts.name}".', provider=provider)
            total_attempts += 1

            prompt_for_attempt = (
                opts.prompt
                if _pass == 0
                else f"{opts.prompt}\n\nYour previous response could not be parsed as valid JSON or did not match "
                     f"the required schema. Previous response:\n---\n{last_raw[:2000]}\n---\n"
                     "Return ONLY corrected, valid JSON — no markdown, no commentary."
            )

            try:
                result = await call_provider(
                    provider,
                    ProviderCallOptions(
                        prompt=prompt_for_attempt,
                        temperature=opts.temperature,
                        max_tokens=opts.max_tokens,
                        label=opts.name,
                        deadline=opts.deadline,
                        json_mode=opts.json_mode,
                        model_override=opts.model_override,
                    ),
                )

                try:
                    parsed = parse_fn(result.text)
                except Exception:
                    last_raw = result.text
                    _log_attempt({
                        "generation_id": opts.generation_id, "phase": opts.phase, "provider": provider,
                        "attempt": total_attempts, "status": "failed", "duration_ms": result.duration_ms,
                        "error_type": INVALID_RESPONSE,
                    })
                    attempt_log.append((provider, INVALID_RESPONSE))
                    continue  # one controlled repair retry on same provider

                if opts.validate and not opts.validate(parsed):
                    last_raw = result.text
                    _log_attempt({
                        "generation_id": opts.generation_id, "phase": opts.phase, "provider": provider,
                        "attempt": total_attempts, "status": "failed", "duration_ms": result.duration_ms,
                        "error_type": VALIDATION,
                    })
                    attempt_log.append((provider, VALIDATION))
                    continue

                _log_attempt({
                    "generation_id": opts.generation_id, "phase": opts.phase, "provider": provider,
                    "attempt": total_attempts, "status": "success", "duration_ms": result.duration_ms,
                })
                return RunAIPhaseResult(
                    text=result.text,
                    parsed=parsed,
                    provider_used=provider,
                    attempts=total_attempts,
                    repaired=_pass > 0,
                    duration_ms=int(ms_now() - overall_start),
                )
            except AIError as aerr:
                _log_attempt({
                    "generation_id": opts.generation_id, "phase": opts.phase, "provider": provider,
                    "attempt": total_attempts, "status": "failed", "duration_ms": 0,
                    "error_type": aerr.error_type,
                    "fallback": opts.fallback_provider if provider == opts.default_provider else None,
                })
                attempt_log.append((provider, aerr.error_type))

                # Auth failures and content safety filtering are terminal for this provider
                # — move straight to alternate provider without futile repair retries.
                if aerr.error_type in (AUTH_FAILED, CONTENT_FILTERED):
                    break

                # Malformed/empty provider response: worth ONE controlled repair retry.
                if aerr.error_type == INVALID_RESPONSE and _pass < settings.max_json_repair_per_provider:
                    last_raw = ""
                    continue

                # Respect Retry-After when short enough to fit the deadline.
                if (
                    aerr.error_type == RATE_LIMITED
                    and aerr.retry_after_ms
                    and aerr.retry_after_ms < ms_left(opts.deadline)
                    and aerr.retry_after_ms < 15_000
                ):
                    await asyncio.sleep(aerr.retry_after_ms / 1000)
                    continue

                break  # provider attempt failed at HTTP level -> move to alternate provider
            except Exception as exc:  # noqa: BLE001
                aerr = AIError(INTERNAL, str(exc))
                _log_attempt({
                    "generation_id": opts.generation_id, "phase": opts.phase, "provider": provider,
                    "attempt": total_attempts, "status": "failed", "duration_ms": 0,
                    "error_type": INTERNAL,
                })
                attempt_log.append((provider, INTERNAL))
                break

    # Both providers exhausted -> fail the job with a normalized error.
    types = [t for _, t in attempt_log]
    all_same = len(types) > 0 and all(t == types[0] for t in types)
    dominant = (
        CONTENT_FILTERED if CONTENT_FILTERED in types else
        RATE_LIMITED if all_same and types[0] == RATE_LIMITED else
        TIMEOUT if all_same and types[0] == TIMEOUT else
        SERVER_ERROR if all_same and types[0] == SERVER_ERROR else
        UNAVAILABLE if all_same and types[0] == UNAVAILABLE else
        AUTH_FAILED if all_same and types[0] == AUTH_FAILED else
        RATE_LIMITED if RATE_LIMITED in types else
        INTERNAL
    )
    retry_after = 60_000 if RATE_LIMITED in types else None
    raise AIError(dominant, _build_failure_message(opts.name, attempt_log), retry_after)
