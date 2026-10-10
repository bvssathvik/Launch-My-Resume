"""FastAPI application entrypoint."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import get_settings
from app.core.jobs import JobRegistry


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.registry = JobRegistry(
        store_path=settings.job_store_path,
        supabase_url=settings.supabase_url,
        supabase_key=settings.supabase_service_role_key,
        supabase_table=settings.supabase_table,
    )
    yield


settings = get_settings()

app = FastAPI(
    title="ResumeForge V3 API",
    description=(
        "Production-oriented resume-generation platform: 4-phase AI pipeline "
        "(Gemini/Groq with bounded failover), local RAG fact-checking, ATS "
        "scoring, AI-detection risk scoring, LinkedIn consistency, "
        "LaTeX/PDF + DOCX rendering. Idempotent per generation_id."
    ),
    version="3.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import os
from fastapi.staticfiles import StaticFiles

app.include_router(router)

public_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "public")
if os.path.exists(public_dir):
    app.mount("/", StaticFiles(directory=public_dir, html=True), name="static")
else:
    @app.get("/")
    async def root() -> dict:
        return {
            "service": "ResumeForge V3 FastAPI service",
            "docs": "/docs",
            "health": "/health",
            "generate": "POST /v1/generate",
        }
