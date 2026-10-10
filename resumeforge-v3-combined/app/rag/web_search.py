"""Background/model-knowledge context (port of rag/web-search.ts).

⚠️ NOT live web search — asks an LLM to answer from its own training data.
Supplementary color only; never overrides the original resume. Non-fatal:
a failure here returns a safe fallback string, never fails the job.
"""
from __future__ import annotations

import logging

from app.config import get_settings
from app.providers.failover import RunAIPhaseOptions, run_ai_phase

log = logging.getLogger("resumeforge.rag")


def fallback_text(job_title: str, company: str | None) -> str:
    return f"No background context available for {job_title}{f' at {company}' if company else ''}."


async def search_role_context(job_title: str, company: str | None, label: str = "background-context", deadline: float = 0.0) -> str:
    questions = [
        f"1. What does {company} do (products/services)?" if company else None,
        f'2. What are the typical responsibilities and required skills for a "{job_title}" role?',
        f"3. What is {company}'s engineering culture and tech stack like, if publicly known?" if company else None,
        f'4. What are realistic salary ranges and achievement metrics for a "{job_title}" role?',
    ]
    questions = [q for q in questions if q]

    prompt = (
        "Based on what you know, answer each numbered question below in 2-3 sentences each. "
        "Keep answers factual and concise — this is background context for a resume-writing tool, "
        "not the resume itself. If you don't have reliable information for a question, say so "
        "briefly rather than guessing.\n\n" + "\n".join(questions) +
        "\n\nAnswer each question under its own number, in order."
    )

    settings = get_settings()
    groq_configured = bool(settings.groq_api_key)
    default_provider = "groq" if groq_configured else "gemini"
    fallback_provider = "gemini" if groq_configured else "groq"

    try:
        result = await run_ai_phase(RunAIPhaseOptions(
            generation_id="background",
            phase=0,
            name=label,
            prompt=prompt,
            temperature=0.1,
            max_tokens=600,
            deadline=deadline,
            default_provider=default_provider,
            fallback_provider=fallback_provider,
            json_mode=False,
            model_override=(settings.groq_context_model if default_provider == "groq" else None),
            parse=lambda text: text,  # plain text, not JSON
            validate=lambda v: isinstance(v, str) and len(v.strip()) > 0,
        ))
        text = result.parsed
        return text if isinstance(text, str) and text.strip() else fallback_text(job_title, company)
    except Exception as exc:  # noqa: BLE001 — never fatal
        log.warning("background context lookup failed (non-fatal): %s", exc)
        return fallback_text(job_title, company)
