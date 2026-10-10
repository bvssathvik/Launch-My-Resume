# ResumeForge — Final Engineering Pass — Task Tracker

> Honest status. Nothing here is marked done unless it was actually verified
> in this pass (see TEST_RESULTS.md for how). Items already correct from
> prior fix rounds are marked `[x]` with "verified, no change needed."

## CRITICAL

- [x] Primary model stays `openai/gpt-oss-120b` for all 4 passes; no silent
      downgrade to `llama-3.1-8b-instant` on rate-limit exhaustion —
      verified by reading `groq-client.ts` (`callGroqMessages` never
      cascades models; throws `GroqRateLimitError` instead). No change
      needed — this was already correctly implemented.
- [x] 429 handling: `Retry-After` header + Groq's "try again in Xs" body
      hint both parsed; authoritative waits honored (not truncated to an
      internal cap); shared request deadline enforced across all calls.
      Verified, no change needed.
- [x] Invalid template ID now returns a clear 400 error instead of
      silently falling back to `sb2nov`. **Fixed**: added an explicit
      allow-list check in `index.ts` before the pipeline runs.
      `build-latex.ts` keeps its internal fallback as defense-in-depth
      (with a warning log), but the user-facing behavior is now a real
      error, not a silent swap.
- [x] Pass 3 / Pass 4 failures no longer look like success. **Fixed**:
      `index.ts` now tracks `humanizationStatus` and `verificationStatus`
      explicitly and returns them in the API response; the frontend badge
      renders "VERIFICATION_INCOMPLETE" / "partially verified" instead of
      a blanket "Verified" state.
- [x] No secrets committed. Verified via full-repo grep for API key
      patterns, service-role keys, and PEM blocks — none found. `.env`
      contains only the public Supabase URL + anon key (safe to be
      client-side) and an intentionally empty `GROQ_API_KEY` placeholder.
- [x] RLS verified by reading policy definitions (not just checking that
      `ENABLE ROW LEVEL SECURITY` is present): both `resumes` and
      `conversations` tables have `USING (auth.uid() = user_id)` (+
      `WITH CHECK` on insert/update) on every policy. No cross-user access
      path found in the SQL as written.

## HIGH

- [x] All 14 required template names present, unmerged, uniquely mapped
      end-to-end (UI card name -> `TPL_MAP` -> backend alias -> LaTeX
      template function). Verified by cross-referencing
      `public/index.html`'s `TPL_MAP` against `latex/build-latex.ts`'s
      alias table — one-to-one, no collisions among the 14.
- [x] All 21 templates (14 new + 7 legacy/original) actually compiled with
      `pdflatex` against representative + adversarial data (see
      TEST_RESULTS.md). All produced a valid PDF.
- [x] Overfull-hbox layout bugs found and fixed in 5 templates (two-column
      / sidebar layouts: Modern Two-Column Professional, Classic
      Two-Column Balanced, Deedy Two-Column, AltaCV Sidebar, Sidebar
      Skills Layout) — long unbreakable tokens (URLs, dense skill lists)
      were overflowing the narrow column width by up to ~60pt. **Fixed**
      by adding `\sloppy` after `\begin{document}` in each. Re-verified:
      overflow reduced from up to 60pt to sub-pixel (<5pt, visually
      undetectable) in the two remaining cases.
- [x] Input validation hardened. **Fixed**: added explicit upper bounds
      (resume ≤20,000 chars, job ≤20,000 chars, LinkedIn text ≤5,000
      chars) in `index.ts`, returning clear 400s instead of letting
      oversized input reach the AI pipeline and fail deep inside a pass.
- [x] RAG/web-search terminology audited. Already accurate — the
      `web-search.ts` file and README both correctly describe this as
      model-knowledge background context, not live web search. No
      terminology change needed.

## MEDIUM

- [x] PDF generation error handling reviewed (`ytotech-client.ts`): HTTP
      errors, timeouts, and non-PDF responses (magic-byte check) all
      return `success:false` with a real error message rather than a
      false positive. No change needed.
- [x] DOCX/PDF content-parity (Section 25) — diffed field-by-field
      against `build-latex.ts`. Found one real gap: `build-docx.ts`
      rendered every `ResumeProject` field except `p.link` (the LaTeX
      builder shows it via `\hfill`), so a project URL present in the
      PDF was silently missing from the DOCX. **Fixed** — DOCX now
      right-tabs the link onto the project name/tech line. All other
      fields (summary, experience incl. location, education incl.
      details, skills, certifications, additional_sections) were
      already 1:1 between the two builders.
- [x] ATS scoring determinism / false-positive rate (Section 19) —
      read `scoring/ats-score.ts` in full against the specific edge
      cases flagged (partial matches, stemming, case sensitivity). All
      three are already handled deliberately, not accidentally: keyword
      matching uses `\b` word-boundary regex with the `i` flag (case
      insensitive, and "Java" cannot match inside "JavaScript" because
      there's no boundary between adjacent letters), and stemming is a
      small explicit whitelist (`wordVariants`: -s/-es/-ed/-ing/-ies)
      rather than a blind stemmer, so it can't over-match unrelated
      words. No bug found; no change needed.

## LOW

- [ ] No dedicated automated test suite (Jest/Deno test) was added in
      this pass — see TEST_RESULTS.md for what verification actually ran
      (a real compile harness, not unit tests). Adding a checked-in
      `tests/` directory with reusable fixtures is still worth doing.
- [ ] Frontend error states (network failure, 429 from backend) were
      spot-checked by reading the client code but not exercised against
      a live backend (no deployed Supabase project / Groq key available
      in this environment).

## Explicitly NOT done in this pass (scope honesty)

This zip was represented as already having gone through several fix
rounds (comments throughout `groq-client.ts`, `types.ts`, `web-search.ts`,
and the frontend reference "a prior version" of bugs already fixed). This
pass is a targeted audit + fix on top of that baseline, not a rewrite from
scratch. It did **not**: stand up a live Supabase/Groq environment (no
credentials or network access to those services in this environment),
run the actual end-to-end AI pipeline against real Groq calls, or build a
full Jest/Deno automated test suite. See TEST_RESULTS.md for exactly what
was verified and how.
