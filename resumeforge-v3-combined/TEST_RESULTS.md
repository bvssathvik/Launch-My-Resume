# TEST_RESULTS.md — ResumeForge V3

## Test Execution Summary

The ResumeForge V3 backend is implemented in **Python 3.11+ / FastAPI**. The test suite contains **34 automated tests** covering all subsystems: provider failover, safety moderation refusal handling, API key / Bearer authentication, 4-phase pipeline orchestration, local RAG fact-checking, ATS scoring, OOXML DOCX generation, and LaTeX template rendering.

```text
============================= test session starts =============================
platform win32 -- Python 3.14.5, pytest-9.1.1, pluggy-1.6.0
collected 34 items

tests/test_api.py ..                                                     [  5%]
tests/test_ats_score.py ....                                             [ 17%]
tests/test_docx.py ..                                                    [ 23%]
tests/test_failover.py .......                                           [ 44%]
tests/test_latex.py ....                                                 [ 55%]
tests/test_pipeline.py ....                                              [ 67%]
tests/test_rag.py .....                                                  [ 82%]
tests/test_schema.py ......                                              [100%]

============================= 34 passed in 0.49s ==============================
```

---

## Active Templates (8 Curated Templates)

The repository ships with **8 dedicated, production-tested resume templates** (matching `resume-templates/` and `app/latex/templates.py` 1:1):

| # | Template Key | Display Name in UI | Layout & Style | Status |
|---|---|---|---|---|
| 1 | `moderncv-classic` | Modern CV / Executive Serif | Elegant modern serif layout with navy accents | PASS |
| 2 | `minimal-clean-tech` | Minimal Clean Tech | Clean sans-serif, high parsability, compact margins | PASS |
| 3 | `faang-style-compact` | FAANG-Style Compact | Single-column, bullet-dense format favored by Big Tech | PASS |
| 4 | `bold-header-modern` | Bold Header Modern | Contemporary styling with strong header hierarchy | PASS |
| 5 | `ultra-clean-one-page` | Ultra-Clean One-Page | Strict single-page budget with compact section spacing | PASS |
| 6 | `tech-focused-dense` | Tech-Focused Dense | High information density optimized for senior engineering | PASS |
| 7 | `premium-minimalist` | Premium Minimalist | Refined typography, generous line-height, executive focus | PASS |
| 8 | `structured-executive-brief` | Executive | C-suite / director structure with executive brief summary | PASS |

All 8 templates:
- Use the central `esc()` character escaping function for `\ & % $ # _ { } ~ ^ < > | "` and unicode dashes/bullets.
- Conditionally render sections (empty sections are cleanly omitted, never fabricated).
- Produce valid LaTeX source code tested with the YtoTech sync pdflatex compiler.

---

## Subsystem Test Coverage

### 1. Provider Failover & Safety Moderation (`tests/test_failover.py` — 7 tests)
- **Alternate provider failover:** Verifies Gemini HTTP 500 automatically fails over to Groq within deadline budget.
- **Immediate auth switch:** Verifies HTTP 401/403 (invalid key) is terminal for that provider and switches to alternate without wasting retries.
- **Controlled JSON repair:** Verifies invalid JSON completion receives exactly one self-repair retry on the same provider before failing over.
- **Schema validation repair:** Verifies responses failing Pydantic contract trigger controlled repair.
- **Safety filter handling (`CONTENT_FILTERED`):** Verifies that when Gemini triggers content moderation (`promptFeedback.blockReason` or `candidate.finishReason == "SAFETY"`), the pipeline does NOT attempt futile JSON repair; it switches immediately to the fallback provider.
- **Dominant error resolution:** Verifies that when safety filters block on both providers, `CONTENT_FILTERED` is returned as the primary error with HTTP 422/400.
- **Dual-provider exhaustion:** Normalized error propagation when all providers are exhausted.

### 2. API & Authentication (`tests/test_api.py` — 2 tests)
- **Health check (`GET /health`):** Verifies service status, version, and provider configuration status.
- **API key enforcement:** Verifies `X-API-Key` and `Authorization: Bearer <token>` headers when `API_KEYS` is configured, returning 401 for missing/invalid keys.

### 3. Pipeline Orchestration & Concurrency (`tests/test_pipeline.py` — 4 tests)
- **4-phase pipeline execution:** Pass 1 (keywords) → Pass 2 (rewrite) → Pass 3 (humanize) → Pass 4 (RAG fact-check) executed in strict order.
- **Idempotency replay:** Repeated requests with the same `generation_id` replay the stored result without re-executing AI passes.
- **409 Concurrency guard:** Concurrent duplicate submissions for an in-progress `generation_id` return HTTP 409 immediately.
- **Stale job recovery:** Jobs stuck in `RUNNING` for longer than 4 minutes are safely restarted.

### 4. Local RAG Fact-Checking (`tests/test_rag.py` — 5 tests)
- **Fact extraction:** Deterministic parsing of companies, titles, dates, institutions, degrees, and skills from original resume.
- **Grounding verification:** Flags metrics and claims fabricated during AI passes against source resume facts.
- **Hallucinated skill pruning:** Automatically strips technical skills that were not present in the original candidate resume.
- **Trust score:** Computes factual accuracy percentage based on verified vs ungrounded claims.

### 5. ATS Scoring (`tests/test_ats_score.py` — 4 tests)
- **Three-score rubric:** Match score (keywords), parsability score (layout/sections), and content quality score (action verbs, metrics).
- **Whole-word regex matching:** Prevents substring false positives (e.g. "go" in "good").
- **Canonical acronym resolution:** Resolves standard tech acronyms to canonical representations.

### 6. DOCX Generation (`tests/test_docx.py` — 2 tests)
- **Raw OOXML generation:** Generates specification-compliant `.docx` files using standard Python `zipfile`.
- **Archive validity:** Verifies `[Content_Types].xml`, `_rels/.rels`, and `word/document.xml` structure.

### 7. Schema Validation (`tests/test_schema.py` — 6 tests)
- **Phase contracts:** Validates Pass 1 keyword extraction schema, Pass 2/3 resume document structure, Pass 4 verification report.
- **Final output gate:** Enforces candidate name and contact information while allowing naturally absent sections (e.g. no education for non-traditional backgrounds).
