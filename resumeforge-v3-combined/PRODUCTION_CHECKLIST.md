# PRODUCTION_CHECKLIST.md

Legend: `[x]` verified in this pass · `[~]` implemented but not fully
exercised/tested · `[ ]` not done.

### AI
- [x] GPT-OSS 120B primary for all 4 quality passes
- [x] No silent downgrade to the 8B fallback model
- [x] Retry-After / "try again in Xs" handling, authoritative waits honored
- [x] Shared request deadline across all Groq calls in a request
- [x] JSON validation on every AI response (safe parse + fallback, never
      fabricates missing fields)
- [x] Explicit `humanizationStatus` / `verificationStatus` — no pass
      failure is ever reported as success
- [~] Factual safety (no invented companies/titles/metrics) — enforced via
      prompt instructions + `removeHallucinatedSkills` local safety net;
      not exercised against a live model in this pass

### Templates
- [x] All 14 requested templates present, correctly named
- [x] Correct UI name -> template ID -> LaTeX function mapping (no
      collisions, no accidental shared design among the 14)
- [x] All 21 templates (14 + 7 legacy) compile to a valid PDF with
      real `pdflatex` against representative + adversarial data
- [x] LaTeX special-character escaping verified across all 21 templates
- [x] Invalid template ID now returns a clear error instead of a silent
      `sb2nov` fallback

### PDF
- [x] YtoTech client handles HTTP errors, timeouts, and non-PDF bodies
      without reporting false success (code-reviewed)
- [ ] Not exercised against the live YtoTech API (network path to it was
      not available in this environment)

### DOCX
- [x] `build-docx.ts` diffed field-by-field against `build-latex.ts`.
      One real gap found and fixed: project `link` was rendered in PDF
      but dropped in DOCX. Every other field now confirmed 1:1.

### Security
- [x] No secrets committed (full-repo grep for key/token patterns; none
      found)
- [x] RLS policies read and confirmed scoped to `auth.uid() = user_id`
      on both tables, all operations
- [x] `GROQ_API_KEY` only ever read server-side (`Deno.env.get`), never
      referenced in frontend code
- [x] No sensitive content (resume/job/LinkedIn text, API keys) appears
      in any log statement

### Testing
- [x] Real LaTeX compilation harness (not "does the function exist" —
      actually invokes `pdflatex` and inspects the log/PDF)
- [ ] No unit-test suite (Jest/Deno test) checked into the repo
- [ ] No live integration test against a deployed Supabase project /
      real Groq key (unavailable in this environment)
- [ ] No production smoke test against a deployed instance

## Honest overall assessment

This pass found the backend's rate-limit engineering, RAG honesty, and
security posture already solid from prior fix rounds, and used the time
budget to (a) actually compile-test all 21 templates against adversarial
data rather than trust static review, which surfaced and fixed a real
layout bug in 5 templates, and (b) close two genuine gaps against the
stated hard requirements: silent template fallback, and Pass 3/4 failures
being indistinguishable from success. It did not attempt a live
end-to-end run (no credentials/network to Groq or Supabase here), so the
"production-ready" bar depends on someone re-running Section 32's
end-to-end test against a real deployment before shipping.
