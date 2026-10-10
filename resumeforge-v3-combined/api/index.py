"""Vercel Serverless Function entrypoint for ResumeForge V3 FastAPI backend."""
from app.main import app

# Vercel's Python runtime expects the ASGI app at module level
__all__ = ["app"]
