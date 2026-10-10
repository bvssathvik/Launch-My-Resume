"""FastAPI routers — /health, /v1/generate, /v1/jobs/{id}."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.config import get_settings
from app.core.errors import AIError, InputValidationError, JobInProgressError, ServerConfigError, status_for_error
from app.core.jobs import JobRegistry
from app.pipeline import error_response_body, run_generation

import logging

log = logging.getLogger("resumeforge.api")

router = APIRouter()


class GenerateRequest(BaseModel):
    resume: str = Field(..., description="Original resume text")
    job: str = Field(..., description="Job description text")
    linkedin: str | None = None
    ats_target: str = "generic"
    format: str = "minimal-clean-tech"
    tone: str = "professional"
    generation_id: str | None = None
    target: str | None = None


def _get_registry(request: Request) -> JobRegistry:
    if not hasattr(request.app.state, "registry") or request.app.state.registry is None:
        settings = get_settings()
        request.app.state.registry = JobRegistry(
            store_path=settings.job_store_path,
            supabase_url=settings.supabase_url,
            supabase_key=settings.supabase_service_role_key,
            supabase_table=settings.supabase_table,
        )
    return request.app.state.registry


def check_auth(
    x_api_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> None:
    settings = get_settings()
    allowed = settings.api_key_list
    if not allowed:
        return  # auth disabled (dev mode)
    provided = ""
    if x_api_key:
        provided = x_api_key.strip()
    elif authorization and authorization.lower().startswith("bearer "):
        provided = authorization[len("bearer "):].strip()
    if not provided or provided not in allowed:
        raise HTTPException(
            status_code=401,
            detail="Unauthorized — valid API key required in X-API-Key header or Authorization: Bearer <key>.",
        )


@router.get("/health")
async def health() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "service": "resumeforge-v3",
        "version": "3.0.0",
        "auth_enabled": bool(settings.api_key_list),
        "providers": {
            "gemini": bool(settings.gemini_api_key),
            "groq": bool(settings.groq_api_key),
        },
    }


@router.post("/v1/generate", status_code=200, dependencies=[Depends(check_auth)])
async def generate(body: GenerateRequest, registry: JobRegistry = Depends(_get_registry)) -> dict:
    settings = get_settings()
    try:
        return await run_generation(body.model_dump(), registry, settings)
    except JobInProgressError:
        return JSONResponse(
            status_code=409,
            content={
                "error": "This resume generation is already in progress. Please wait for it to finish.",
                "generation_id": body.generation_id or "",
            },
        )
    except InputValidationError as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})
    except ServerConfigError as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})
    except AIError as exc:
        return JSONResponse(
            status_code=status_for_error(exc.error_type),
            content=error_response_body(exc, body.generation_id or ""),
        )


@router.get("/v1/jobs/{generation_id}", dependencies=[Depends(check_auth)])
async def get_job(generation_id: str, registry: JobRegistry = Depends(_get_registry)) -> dict:
    job = registry.load(generation_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"No job found for generation_id {generation_id}")
    # Strip the full result by default (it can be large); a ?full=1 flag
    # returns the stored GenerateResponse for idempotent client recovery.
    return job
