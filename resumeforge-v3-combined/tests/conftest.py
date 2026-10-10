"""Shared test fixtures — no network, deterministic fake providers."""
from __future__ import annotations

import os

# Environment must be set BEFORE app.config is first imported so the
# pydantic-settings cache picks it up.
os.environ.setdefault("GEMINI_API_KEY", "test-gemini-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")
os.environ.setdefault("PDF_ENABLED", "false")
os.environ.setdefault("JOB_STORE_PATH", "")

import pytest  # noqa: E402

from app.config import get_settings  # noqa: E402


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
