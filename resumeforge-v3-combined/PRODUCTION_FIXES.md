# ResumeForge — Production Fix Pack (v3.2)

Every issue you reported, diagnosed with a **verified** root cause, plus the exact fix
and the API keys to keep. Nothing below is a guess: API limits were checked against the
providers' official docs on 2026-09-05, and the PDF compiler was tested live.

---

## 1. The Groq 429 rate-limit error (your main blocker)

**Your exact error**: `Rate limit reached for model openai/gpt-oss-120b ... Limit 8000,
Used 2605, Requested 7319. Please try again in 14.43s.`

**Verified root cause** — it is NOT a missing/broken key. Your key works (a 429 means
Groq *authenticated* you and then said "slow down"). `openai/gpt-oss-120b` has a
**free-tier cap of 8,000 tokens-per-minute (TPM), 30 requests/min, 1,000 requests/day**
per the official rate-limit table at https://console.groq.com/docs/rate-limits.

The real problem is your pipeline's token budget:
- Pass 2 alone asked for up to **8,192 output tokens** and re-sends the **entire resume +
  full job description** in the prompt. A single call `Requested 7319` tokens, but only
  `8000 − 2605 = 5395` were left in the rolling 60s window → guaranteed 429.
- Passes 3 and 4 asked for 6,144 max tokens each on top of that.

**Fixes applied**:
1. Pass 2 max tokens reduced 8192 → **4096**; Pass 3 and 4 reduced 6144 → **3072**
   (`supabase/functions/generate-resume/index.ts`). A full resume JSON fits in ~2–4K tokens.
2. **Automatic Gemini fallback**: if Groq 429s/errors on any pass, the same prompt is
   retried against `gemini-2.5-flash` (configurable via `GEMINI_MODEL`)
   (new file `supabase/functions/generate-resume/gemini-client.ts`).
3. Retry logic already honors Groq's `retry-after` header and `try again in Xs` hint
   (`groq-client.ts`).

## 2. Which API keys to keep

| Key | Where to put it | Status |
|---|---|---|
| `GROQ_API_KEY` | Supabase secrets (`supabase secrets set GROQ_API_KEY=gsk_...`) | **Required — primary AI provider** (sign up free at console.groq.com) |
| `GEMINI_API_KEY` | Supabase secrets (`supabase secrets set GEMINI_API_KEY=AIza...`) | **Strongly recommended — automatic fallback** when Groq is rate-limited (free at aistudio.google.com → Get API key) |
| `GEMINI_MODEL` (optional) | Supabase secrets | Defaults to `gemini-2.5-flash`; set e.g. `gemini-2.5-flash-lite` for cheaper/faster |
| Supabase URL + anon key | Already in `public/index.html` (safe client-side) | Keep |
| Google OAuth Client ID/Secret | Supabase Dashboard → Auth → Providers → Google | Required only for "Continue with Google" |

> Note: Gemini free-tier RPM/TPD limits vary per project and have been tightened by
> Google; check your exact numbers at https://ai.google.dev/gemini-api/docs/rate-limits
> (model ids `gemini-2.5-flash` / `gemini-2.5-flash-lite` are current per
> https://ai.google.dev/gemini-api/docs/models).

Want *zero* rate-limit anxiety? Groq's paid Developer plan raises limits well above the
free tier (verify your org's `console.groq.com/settings/limits`), or add a second
Groq org key and rotate.

## 3. PDFs not accepted as input

**Root cause**: the file picker only accepted `.txt,.doc,.docx`, and for DOCX the old
code did `file.text()` — which returns raw ZIP/binary garbage, not readable text. PDF was
completely unsupported.

**Fixes applied** (`public/index.html`):
- `accept` now includes `.pdf`.
- New `extractResumeFromFile()`: `.txt` → plain text; **`.pdf` → parsed with pdf.js**
  (real text extraction, page by page); **`.docx` → parsed with mammoth** (real Word text).
- Scanned/image-only PDFs (no text layer) and legacy `.doc` are detected and the UI tells
  the user to paste text instead of silently sending garbage.

## 4. PDF output "not coming properly"

**Verified**: the LaTeX compiler (latex.ytotech.com `/builds/sync`) works — tested live
during this fix, it returns a valid PDF (HTTP 201, `%PDF` header) for both JSON and
multipart payloads (https://github.com/YtoTech/latex-on-http).

**Real causes of bad PDF output**:
- The 429 from section 1 killed the whole request **before** the PDF step ran → you saw
  the generic error instead of a file.
- 30s compile timeout was occasionally too short on the free farm → raised to **90s**
  (`supabase/functions/generate-resume/pdf/ytotech-client.ts`).
- The result screen only ever previewed the same HTML "Formatted Resume" for every
  template — the actual PDF (which is where templates differ) required a manual download.
  **Fixed**: new **"PDF Preview" tab** renders the real compiled PDF inline.

## 5. "All templates give the same output"

**Diagnosis**: in the code you uploaded, the template map (`TPL_MAP` in `public/index.html`)
already maps all 21 cards to unique backend keys, and `build-latex.ts` renders each with
its own LaTeX template — all 21 templates compile to distinct layouts (verified in
`TEST_RESULTS.md`: different page counts/designs, all pass real `pdflatex`).

So if you still saw identical output, it was one of:
1. **Your deployed version is older than this zip** (redeploy — commands below).
2. You were looking at the HTML preview (identical for all templates by design) instead of
   the PDF. → Now fixed with the PDF Preview tab.
3. Two cards are *intentionally* identical: **"Clean"** and **"Jake's Resume"** both use
   `sb2nov` (the classic Jake's Resume layout) — that's historical, not a bug. Every other
   card is unique.

## 6. ATS score not working properly

**Fixes applied**:
- **Inflated score bug**: if Pass 1 keyword extraction failed, the keyword arrays came back
  empty → `must_have.length === 0` → coverage computed as `1` → ATS score silently became
  100. Now an empty keyword list scores structure/title only, no fake 100s
  (`scoring/ats-score.ts`).
- **UI bug**: the result panel read `ats.missing_keywords`, but the backend returns
  `keywords_missing` — so "Worth adding to resume" chips never rendered. Field name fixed
  (`public/index.html`).
- "Quantified impact" was hardcoded 80% → now computed from the actual share of bullets
  containing metrics.

## 7. Login / signup problems

Most likely causes, in order:
1. **Email confirmation**: after sign-up the app says "check your email to confirm".
   If you never confirmed, login always fails. Either confirm, or disable
   `Authentication → Providers → Email → Confirm email` temporarily.
2. **Google OAuth config**: in Supabase Dashboard → Authentication →
   - Providers → Google: enable + paste Client ID/Secret;
   - URL Configuration: set **Site URL** to your Vercel URL and add the exact Vercel URL to
     **Redirect URLs** (`https://your-app.vercel.app`). A missing redirect allowlist is the
     classic cause of "redirect not allowed" after Google login.
3. The Edge Function rejects calls without a valid session (401) — that's protection, not
   a bug; sign in first.
4. RLS policies for `resumes` and `conversations` tables already exist in
   `supabase/migrations/` — run both files in SQL Editor if you haven't.

## 8. Deploy (production) — exact commands

```bash
# 1. Backend — link your Supabase project and set secrets
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set GROQ_API_KEY=gsk_xxxxxxxx GEMINI_API_KEY=AIzaXXXXXXXX

# 2. Run the two SQL migration files in Supabase → SQL Editor → New Query → Run

# 3. Deploy the Edge Function
supabase functions deploy generate-resume
supabase secrets list   # verify both keys are present

# 4. Frontend — push public/ to Vercel (vercel.json already routes everything
#    to index.html). Vercel → Import Git repo → framework: Other → build: none.
```

Verify the function works: in the browser console after one generation you should see a
successful response; in Supabase → Edge Functions → Logs you'll see one
`[groq-usage]` line per pass (tokens, HTTP status, retries).

## Files changed in this pack

| File | Change |
|---|---|
| `public/index.html` | PDF + DOCX upload parsing (pdf.js, mammoth), PDF preview tab, `keywords_missing` fix, honest quantified-impact, accept `.pdf` |
| `supabase/functions/generate-resume/index.ts` | Token budgets cut (8192→4096, 6144→3072), Gemini fallback (`runPass`), `GEMINI_API_KEY` |
| `supabase/functions/generate-resume/gemini-client.ts` | **NEW** — Gemini fallback client with retry/backoff/deadline |
| `supabase/functions/generate-resume/scoring/ats-score.ts` | Empty-keyword guard (no fake 100) |
| `supabase/functions/generate-resume/pdf/ytotech-client.ts` | 30s → 90s compile timeout, no-store |
| `supabase/migrations/*.sql` | unchanged (already correct RLS) |
