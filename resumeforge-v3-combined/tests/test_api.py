"""Tests for FastAPI endpoints, auth checking, and CORS settings."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.main import app


@pytest.mark.asyncio
async def test_health_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "auth_enabled" in data


@pytest.mark.asyncio
async def test_auth_enforced_when_api_keys_configured(monkeypatch):
    # Enable API keys
    import app.api.routes as routes_mod

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Mock settings with an active API key
        fake_settings = Settings(api_keys="secret-key-123")
        monkeypatch.setattr(routes_mod, "get_settings", lambda: fake_settings)

        # Calling without header should fail with 401
        res = await client.get("/v1/jobs/test-id")
        assert res.status_code == 401

        # Calling with invalid key should fail with 401
        res = await client.get("/v1/jobs/test-id", headers={"X-API-Key": "wrong-key"})
        assert res.status_code == 401

        # Calling with valid Bearer token should pass through auth check
        # (It will return 404 because job doesn't exist, which proves auth passed!)
        res = await client.get("/v1/jobs/test-id", headers={"Authorization": "Bearer secret-key-123"})
        assert res.status_code == 404
