# ResumeForge V3 — FastAPI Service

Production-oriented resume-generation platform. This is a faithful Python/FastAPI
implementation of the master upgrade prompt applied to the original ResumeForge
codebase (Supabase Edge Functions in TypeScript). The pipeline logic, prompts,
rubrics, and ATS/RAG behavior are ported 1:1; the runtime is a standard,
horizontally-scalable FastAPI service instead of serverless functions.

## What it does (mapped to the master prompt)

| Master-prompt requirement | Implementation |
|---|---|
| 4-phase AI pipeline | `app/pipeline.py` — Pass 1 keywords → Pass 2 rewrite → Pass 3 humanize → Pass 4 RAG verify |
| AI failover (Gemini ↔ Groq) | `app/providers/failover.py` — bounded retries, JSON repair, `Retry-After` honoring, auth-fail fast-switch |
| RAG (grounded in the original resume) | `app/rag/` — deterministic local fact-checker, trust score, hallucinated-skill removal; Pass 4 LLM verification |
| ATS scoring | `app/scoring/ats_score.py` — three-score architecture (match / parsability / content quality), whole-word + canonical-acronym matching |
| LaTeX generation (8 templates) | `app/latex/` — `build_latex.py` + 8 template renderers ported verbatim, content-preservation check |
| PDF rendering | `app/pdf/ytotech.py` — YtoTech pdflatex compile (front-end of the pdf.ytotech client), graceful degradation |
| DOCX (primary output) | `app/docx/build_docx.py` — raw OOXML + stdlib zipfile (spec-correct, unlike the old Deno zip writer) |
| LinkedIn consistency | `app/consistency/linkedin_check.py` |
| AI-detection risk | `app/scoring/ai_risk_score.py` |
| Idempotency / concurrency | `app/core/jobs.py` — replay completed, 409 in-progress, stale-RUNNING recovery; JSON file store |
| Template count | All **8 templates** (`resume-templates/*`) plus their previews and PDFs remain in the repo untouched |
| No fabricated features | Prompts, rubrics, and validators run only on real extracted data; empty sections are omitted, never invented |

## Combined package contents

This combined package includes the production FastAPI backend **plus** the original frontend/templates bundle in one repository:

- `app/` — FastAPI backend service
- `tests/` — backend test suite
- `public/` — static frontend and template preview images
- `resume-templates/` — 8 LaTeX template projects with sample PDFs
- `supabase/` — original Supabase Edge Function implementation kept for reference/migration
- `vercel.json` — static frontend deployment config

## Quick start

```bash
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env        # then fill in GEMINI_API_KEY and/or GROQ_API_KEY
uvicorn app.main:app --reload --port 8000
```

Env vars (see `.env.example`): `GEMINI_API_KEY`, `GROQ_API_KEY`,
`GEMINI_MODEL`, `GROQ_MODEL`, `GROQ_CONTEXT_MODEL`, `PER_CALL_TIMEOUT_MS`,
`REQUEST_DEADLINE_BUDGET_MS`, `MAX_ATTEMPTS_PER_PHASE`,
`MAX_JSON_REPAIR_PER_PROVIDER`, `API_KEYS` (comma-separated; empty = auth off),
`ALLOWED_ORIGINS` (comma-separated origins or `*`),
`PDF_ENABLED`, `YTOTECH_URL`,
`JOB_STORE_BACKEND` (`json` | `supabase` | `memory`), `JOB_STORE_PATH`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_TABLE`.

Docker:

```bash
docker build -t resumeforge-v3 .
docker run -p 8000:8000 --env-file .env resumeforge-v3
```

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness + which providers are configured |
| GET | `/docs` | OpenAPI interactive docs |
| POST | `/v1/generate` | Run the generation pipeline |
| GET | `/v1/jobs/{generation_id}` | Poll a job record (for idempotent recovery) |

`POST /v1/generate` body:

```json
{
  "resume": "Your full original resume (≥80 chars)...",
  "job": "The job description (≥50 chars)...",
  "linkedin": "optional 'Title at Company | Jan 2020 – Present' lines",
  "ats_target": "generic | workday | greenhouse | lever",
  "format": "minimal-clean-tech | moderncv-classic | faang-style-compact | bold-header-modern | ultra-clean-one-page | tech-focused-dense | premium-minimalist | structured-executive-brief",
  "tone": "professional | confident | concise",
  "generation_id": "optional client UUID — idempotency key"
}
```

Response mirrors the original `GenerateResponse` (camelCase):
`success, generation_id, replay, phaseLog, template_name, resumeJSON, latex,
pdfBase64, pdfAvailable, docxBase64, docxAvailable, atsScore, aiRisk,
ragResult, consistency, keywords, improvements, humanizationStatus,
verificationStatus, contentPreservation`.

## Tests

```bash
python -m pytest tests -q
```

Covered: schema validators, provider failover (JSON repair, auth fast-switch,
cross-provider fallback), ATS scoring + canonical matching (AWS ↔ Amazon Web
Services), LaTeX build + content preservation, DOCX zip validity, RAG
fact-checking / trust score / skill de-hallucination, LinkedIn consistency,
and the full pipeline end-to-end with fake providers (idempotent replay,
409 in-progress).

## Reliability notes (honest limits)

- **RAG is NOT live web search.** Background context is model knowledge only
  (`app/rag/web_search.py`) — same stance as the original codebase. The source
  of truth for every claim is the user's original resume text.
- **PDF** depends on the free YtoTech compile API; on failure the response
  returns `pdfAvailable: false` with LaTeX + DOCX still delivered.
- **ATS score is an estimate** with an explicit disclaimer; no universal ATS
  algorithm exists.
- The 8 LaTeX templates and `public/` front-end from the original zip are
  shipped unchanged — this service is the backend the frontend can call
  instead of the edge function.
