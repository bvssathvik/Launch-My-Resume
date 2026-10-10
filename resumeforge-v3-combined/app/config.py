"""Central configuration — everything is read from environment variables.

Never hardcode API keys. Set GEMINI_API_KEY / GROQ_API_KEY in the
environment or .env (see .env.example). Provider base URLs and model ids
are overridable so tests can point at fake servers and operators can pin
models without code changes.
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # ── AI providers ──
    gemini_api_key: str = ""
    groq_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    groq_model: str = "openai/gpt-oss-120b"
    groq_context_model: str = "llama-3.1-8b-instant"
    gemini_base_url: str = "https://generativelanguage.googleapis.com"
    groq_base_url: str = "https://api.groq.com/openai/v1"

    # ── Timeouts / budget — ported from the edge function ──
    per_call_timeout_ms: int = 45_000
    request_deadline_budget_ms: int = 120_000  # shared budget across all phases
    max_attempts_per_phase: int = 4            # hard ceiling per phase
    max_json_repair_per_provider: int = 1

    # ── Auth & CORS ──
    # Comma-separated list of allowed API keys (X-API-Key header).
    # Empty string = auth disabled (dev mode). In production set at least one.
    api_keys: str = ""
    # Comma-separated list of allowed CORS origins (e.g. "https://resumeforge.vercel.app,http://localhost:3000")
    allowed_origins: str = "*"

    # ── Rendering ──
    pdf_enabled: bool = True
    ytotech_url: str = "https://latex.ytotech.com/builds/sync"

    # ── Input limits (same contract as the edge function) ──
    max_resume_chars: int = 20_000
    max_job_chars: int = 20_000
    max_linkedin_chars: int = 5_000

    # ── Job store — backend options: "json", "supabase", "memory" ──
    #    "json": atomic local JSON file store (default: data/jobs.json)
    #    "supabase": persistent Supabase/PostgreSQL generation_jobs table
    #    "memory": transient in-process memory only
    job_store_backend: str = "json"
    job_store_path: str = "data/jobs.json"
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_table: str = "generation_jobs"

    @property
    def api_key_list(self) -> list[str]:
        return [k.strip() for k in self.api_keys.split(",") if k.strip()]

    @property
    def cors_origins(self) -> list[str]:
        if not self.allowed_origins or self.allowed_origins.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def any_provider_configured(self) -> bool:
        return bool(self.gemini_api_key or self.groq_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
