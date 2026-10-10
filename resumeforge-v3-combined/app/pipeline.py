"""Pipeline orchestrator — Python port of the Supabase edge function index.ts.

Four-phase pipeline, each phase executed EXACTLY ONCE per generation_id:
  Phase 1 — Parse candidate + extract JD keyword requirements  -> Gemini (fallback Groq)
  Phase 2 — Analyze job description / rewrite resume against it -> Gemini (fallback Groq)
  Phase 3 — Tailor / humanize resume for the target role         -> Groq   (fallback Gemini)
  Phase 4 — Final optimization, RAG validation & formatting data -> Groq   (fallback Gemini)
  Final   — PDF/DOCX generation (runs ONLY after Phase 4 succeeds)

Idempotency: every request carries (or is assigned) a generation_id.
A COMPLETED job replays its stored result. A RUNNING job is rejected
with 409 (stops double-click / duplicate frontend submits).
"""
from __future__ import annotations

import logging
import re
import uuid
from typing import Any, Optional

from app.ats_profiles.profiles import get_ats_profile
from app.config import Settings, get_settings
from app.consistency.linkedin_check import check_linkedin_consistency
from app.core.errors import (
    AIError, INTERNAL, SERVER_ERROR, VALIDATION, InputValidationError,
    JobInProgressError, ServerConfigError, UNAVAILABLE, status_for_error,
)
from app.core.jobs import JobRegistry, classify_existing, new_job
from app.docx.build_docx import build_docx
from app.latex.build_latex import build_latex
from app.latex.content_preservation import check_content_preservation
from app.pdf.ytotech import compile_to_pdf
from app.prompts.pass1 import build_pass1_prompt
from app.prompts.pass2 import build_pass2_prompt
from app.prompts.pass3 import build_pass3_prompt
from app.prompts.pass4 import build_pass4_prompt
from app.providers.base import ms_now
from app.providers.failover import RunAIPhaseOptions, run_ai_phase
from app.rag.fact_checker import check_facts, remove_hallucinated_skills
from app.rag.resume_parser import build_verification_context, parse_resume_facts
from app.rag.trust_scorer import calculate_trust_score
from app.rag.web_search import search_role_context
from app.schemas import validate_final_resume, validate_keywords, validate_rag, validate_resume
from app.scoring.ai_risk_score import calculate_ai_risk_score
from app.scoring.ats_score import calculate_ats_score

log = logging.getLogger("resumeforge.pipeline")

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)

# Matches the frontend's TPL_MAP values exactly. An unrecognized format is
# a clear 400, never a silent fallback to a different template.
KNOWN_FORMATS = {
    "modern cv", "moderncv-classic", "moderncv classic", "executive serif",
    "minimal clean tech", "minimal-clean-tech",
    "faang-style compact", "faang style compact", "faang-style-compact",
    "bold header modern", "bold-header-modern",
    "ultra-clean one-page", "ultra clean one page", "ultra-clean-one-page",
    "tech-focused dense", "tech focused dense", "tech-focused-dense",
    "premium minimalist", "premium-minimalist",
    "executive", "structured executive brief", "structured-executive-brief",
}


def _prefer(primary: str, settings: Settings) -> tuple[Optional[str], Optional[str]]:
    """Default + fallback provider per phase; single-key deploys still run."""
    primary_ok = bool(settings.gemini_api_key) if primary == "gemini" else bool(settings.groq_api_key)
    alt = "groq" if primary == "gemini" else "gemini"
    alt_ok = bool(settings.groq_api_key) if primary == "gemini" else bool(settings.gemini_api_key)
    default = primary if primary_ok else (alt if alt_ok else primary)
    fallback = alt if (primary_ok and alt_ok) else None
    return default, fallback


async def run_generation(body: dict, registry: JobRegistry, settings: Optional[Settings] = None) -> dict:
    """Run the full generation pipeline for one request. Returns the GenerateResponse."""
    settings = settings or get_settings()
    generation_id = ""
    job: Optional[dict] = None

    try:
        # ── 1. Parse & validate input ──
        resume = body.get("resume") or ""
        jd = body.get("job") or ""
        linkedin = body.get("linkedin")
        target_title = str(body.get("target") or "").strip()
        ats_target = body.get("ats_target", "generic")
        format_name = body.get("format", "minimal-clean-tech")
        tone = body.get("tone", "professional")

        if len(resume.strip()) < 80:
            raise InputValidationError("Please paste your full resume (minimum 80 characters).")
        if len(jd.strip()) < 50:
            raise InputValidationError("Please paste the complete job description.")

        if len(resume) > settings.max_resume_chars:
            raise InputValidationError(
                f"Resume text is too long ({len(resume)} chars). Please shorten it to under {settings.max_resume_chars} characters."
            )
        if len(jd) > settings.max_job_chars:
            raise InputValidationError(
                f"Job description is too long ({len(jd)} chars). Please shorten it to under {settings.max_job_chars} characters."
            )
        if isinstance(linkedin, str) and len(linkedin) > settings.max_linkedin_chars:
            raise InputValidationError(
                f"LinkedIn text is too long. Please shorten it to under {settings.max_linkedin_chars} characters."
            )
        fmt_key = str(format_name).strip().lower()
        if fmt_key not in KNOWN_FORMATS:
            raise InputValidationError(f'Unknown template "{format_name}". Please pick a valid template from the list.')

        if not settings.any_provider_configured:
            raise ServerConfigError("Server configuration error: no AI provider is configured.")

        # ── 2. generation_id + idempotency ──
        supplied_id = (body.get("generation_id") or "").strip()
        generation_id = supplied_id if UUID_RE.match(supplied_id) else str(uuid.uuid4())

        existing = registry.load(generation_id)
        classification = classify_existing(existing)

        if classification == "replay" and existing and existing.get("result"):
            log.info("generation_id=%s replay=true (job already COMPLETED)", generation_id)
            return {**existing["result"], "replay": True}
        if classification == "in_progress":
            raise JobInProgressError(generation_id)

        job = new_job(generation_id)
        registry.save(job)

        async def mark_phase(phase: int, status: str, provider: Optional[str] = None) -> None:
            if not job:
                return
            entry = {"status": status}
            if provider:
                entry["provider"] = provider
            job["phases"][str(phase)] = entry
            job["updated_at"] = int(ms_now())
            registry.save(job)

        # ── 3. ATS profile + resume-facts (RAG source of truth) ──
        ats_profile = get_ats_profile(ats_target)
        resume_facts = parse_resume_facts(resume)
        build_verification_context(resume_facts)

        phase_log: list[dict] = []
        deadline = ms_now() + settings.request_deadline_budget_ms

        # ── 4. Phase 1 — keywords (Gemini -> Groq) ──
        await mark_phase(1, "RUNNING")
        default_p, fallback_p = _prefer("gemini", settings)
        result = await run_ai_phase(RunAIPhaseOptions(
            generation_id=generation_id, phase=1, name="pass1-keywords",
            prompt=build_pass1_prompt(jd, target_title), temperature=0.1, max_tokens=2048,
            deadline=deadline, default_provider=default_p, fallback_provider=fallback_p,
            json_mode=True, validate=validate_keywords,
        ))
        keywords = result.parsed
        phase_log.append({"phase": 1, "provider": result.provider_used, "attempts": result.attempts,
                          "repaired": result.repaired, "durationMs": result.duration_ms})
        await mark_phase(1, "COMPLETED", result.provider_used)

        # ── 5. Background/model-knowledge context — sequential, non-fatal ──
        web_context = ""
        try:
            web_context = await search_role_context(
                keywords.get("job_title", ""), keywords.get("company"), deadline=deadline
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("background context lookup failed (non-fatal): %s", exc)

        # ── 6. Phase 2 — rewrite against JD (Gemini -> Groq) ──
        await mark_phase(2, "RUNNING")
        default_p, fallback_p = _prefer("gemini", settings)
        result = await run_ai_phase(RunAIPhaseOptions(
            generation_id=generation_id, phase=2, name="pass2-rewrite",
            prompt=build_pass2_prompt(resume, jd, keywords, format_name, tone),
            temperature=0.35, max_tokens=4096,
            deadline=deadline, default_provider=default_p, fallback_provider=fallback_p,
            json_mode=True, validate=validate_resume,
        ))
        draft_resume = result.parsed
        phase_log.append({"phase": 2, "provider": result.provider_used, "attempts": result.attempts,
                          "repaired": result.repaired, "durationMs": result.duration_ms})
        await mark_phase(2, "COMPLETED", result.provider_used)

        # ── 7. Phase 3 — humanize (Groq -> Gemini); falls back to draft ──
        await mark_phase(3, "RUNNING")
        humanized_resume = draft_resume
        humanization_status = "completed"
        default_p, fallback_p = _prefer("groq", settings)
        try:
            result = await run_ai_phase(RunAIPhaseOptions(
                generation_id=generation_id, phase=3, name="pass3-humanize",
                prompt=build_pass3_prompt(draft_resume), temperature=0.4, max_tokens=3072,
                deadline=deadline, default_provider=default_p, fallback_provider=fallback_p,
                json_mode=True, validate=validate_resume,
            ))
            humanized_resume = result.parsed
            phase_log.append({"phase": 3, "provider": result.provider_used, "attempts": result.attempts,
                              "repaired": result.repaired, "durationMs": result.duration_ms})
            await mark_phase(3, "COMPLETED", result.provider_used)
        except Exception as exc:  # noqa: BLE001 — soft failure, keep draft
            humanization_status = "failed"
            log.warning("phase=3 failed, falling back to pre-humanization draft: %s", exc)
            await mark_phase(3, "FAILED")

        # ── 8. RAG — local fact-check against original resume (no AI call) ──
        rag_claims = check_facts(humanized_resume, resume, resume_facts, linkedin)

        # ── 9. Phase 4 — RAG validation & formatting (Groq -> Gemini) ──
        await mark_phase(4, "RUNNING")
        verified_resume = humanized_resume
        pass4_failed = False
        default_p, fallback_p = _prefer("groq", settings)
        try:
            result = await run_ai_phase(RunAIPhaseOptions(
                generation_id=generation_id, phase=4, name="pass4-rag-verify",
                prompt=build_pass4_prompt(resume, humanized_resume, web_context, linkedin),
                temperature=0.1, max_tokens=3072,
                deadline=deadline, default_provider=default_p, fallback_provider=fallback_p,
                json_mode=True, validate=validate_rag,
            ))
            p4_data = result.parsed
            verified_resume = p4_data.get("resume") or humanized_resume
            phase_log.append({"phase": 4, "provider": result.provider_used, "attempts": result.attempts,
                              "repaired": result.repaired, "durationMs": result.duration_ms})
            await mark_phase(4, "COMPLETED", result.provider_used)
        except Exception as exc:  # noqa: BLE001 — soft failure, keep humanized
            verified_resume = humanized_resume
            pass4_failed = True
            log.warning("phase=4 failed, falling back to pre-verification resume: %s", exc)
            await mark_phase(4, "FAILED")

        verified_resume = remove_hallucinated_skills(verified_resume, resume)

        # ── 10. Output validation gate — BEFORE any PDF/DOCX work ──
        final_check = validate_final_resume(verified_resume)
        if not final_check["ok"]:
            raise AIError(VALIDATION, f"Final resume failed validation: {'; '.join(final_check['reasons'])}")
        if final_check["warnings"]:
            log.info("final resume warnings (non-blocking): %s", "; ".join(final_check["warnings"]))

        rag_result = calculate_trust_score(rag_claims, verified_resume, web_context)
        if pass4_failed:
            verification_status = "VERIFICATION_INCOMPLETE"
        elif rag_result["trust_score"] >= 95:
            verification_status = "VERIFIED"
        else:
            verification_status = "PARTIALLY_VERIFIED"

        consistency = check_linkedin_consistency(verified_resume, linkedin)

        ats_score = calculate_ats_score(verified_resume, keywords, ats_target)
        ai_risk = calculate_ai_risk_score(verified_resume)

        # ── 11. PDF/DOCX — runs ONLY after Phase 4 attempted + validation passed ──
        latex = build_latex(verified_resume, format_name, ats_profile)
        content_preservation = check_content_preservation(verified_resume, latex, ats_profile)
        if not content_preservation["passed"]:
            log.warning("content-preservation check found missing content: %s", content_preservation["missing_content"])
        if content_preservation["dropped_bullets"]:
            log.warning("%d bullet(s) trimmed by template's bullet cap", len(content_preservation["dropped_bullets"]))

        if settings.pdf_enabled:
            pdf_result = await compile_to_pdf(latex)
        else:
            pdf_result = {"success": False, "pdfBase64": None, "error": "PDF compilation disabled"}
        docx_base64 = build_docx(verified_resume)

        improvements = [
            *(verified_resume.get("improvements_made") or []),
            *(f"⚠️ {f['flag']}" for f in rag_result["flags"]),
            *(f"🔗 LinkedIn: {f['message']}" for f in consistency["flags"]),
        ]

        response = {
            "success": True,
            "generation_id": generation_id,
            "replay": False,
            "phaseLog": phase_log,
            "template_name": format_name,
            "resumeJSON": verified_resume,
            "latex": latex,
            "pdfBase64": pdf_result.get("pdfBase64"),
            "pdfAvailable": bool(pdf_result.get("success")),
            "docxBase64": docx_base64,
            "docxAvailable": bool(docx_base64),
            "atsScore": ats_score,
            "aiRisk": ai_risk,
            "ragResult": rag_result,
            "consistency": consistency,
            "keywords": keywords,
            "improvements": improvements,
            "humanizationStatus": humanization_status,
            "verificationStatus": verification_status,
            "contentPreservation": content_preservation,
        }

        job["status"] = "COMPLETED"
        job["result"] = response
        job["updated_at"] = int(ms_now())
        registry.save(job)
        log.info("generation_id=%s job COMPLETED", generation_id)
        return response

    except Exception as exc:
        aerr = exc if isinstance(exc, AIError) else AIError(INTERNAL, str(exc))
        if job and generation_id:
            for key in job.get("phases") or {}:
                if job["phases"][key].get("status") != "COMPLETED":
                    job["phases"][key]["status"] = "FAILED"
            job["status"] = "FAILED"
            job["updated_at"] = int(ms_now())
            try:
                registry.save(job)
            except Exception:  # noqa: BLE001 — best-effort
                pass
            log.error("generation_id=%s job FAILED type=%s: %s", generation_id, aerr.error_type, aerr.message)
        else:
            log.error("ResumeForge error (%s): %s", aerr.error_type, aerr.message)
        raise


def error_response_body(aerr: AIError, generation_id: str) -> dict:
    return {
        "error": aerr.message,
        "error_type": aerr.error_type,
        "rateLimited": aerr.error_type == "PROVIDER_RATE_LIMITED",
        "contentFiltered": aerr.error_type == "CONTENT_FILTERED",
        "generation_id": generation_id or None,
    }
