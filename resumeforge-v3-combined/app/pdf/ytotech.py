"""LaTeX → PDF via YtoTech — port of pdf/ytotech-client.ts.

Same pdflatex engine as Overleaf, free compile API. Returns a result dict
(success / pdfBase64 / error / fileSizeKB); never raises — a failed or
timeout compile degrades to pdfAvailable=false, never a failed job.
"""
from __future__ import annotations

import base64
import logging

import httpx

from app.config import get_settings

log = logging.getLogger("resumeforge.pdf")


async def compile_to_pdf(latex_code: str) -> dict:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            res = await client.post(
                settings.ytotech_url,
                files=[("filecontents[]", ("resume.tex", latex_code.encode("utf-8"), "text/plain"))],
                data={"filename[]": "resume.tex", "compiler": "pdflatex", "return": "pdf"},
                headers={"cache-control": "no-store"},
            )

        if res.status_code >= 400:
            snippet = res.text[:200]
            return {
                "success": False,
                "pdfBase64": None,
                "error": f"YtoTech compilation failed: {res.status_code} — {snippet}",
            }

        body = res.content
        # Verify it's actually a PDF (starts with %PDF)
        if body[:4] != b"%PDF":
            return {
                "success": False,
                "pdfBase64": None,
                "error": "YtoTech returned invalid PDF. LaTeX code may have errors.",
            }

        return {
            "success": True,
            "pdfBase64": base64.b64encode(body).decode("ascii"),
            "fileSizeKB": len(body) // 1024,
        }
    except httpx.TimeoutException:
        return {
            "success": False,
            "pdfBase64": None,
            "error": "PDF compilation timed out. YtoTech may be slow — try again or download LaTeX file.",
        }
    except Exception as exc:  # noqa: BLE001 — graceful degradation
        log.warning("PDF compilation failed: %s", exc)
        return {"success": False, "pdfBase64": None, "error": str(exc)}
