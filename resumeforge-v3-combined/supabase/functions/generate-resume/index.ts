// ─────────────────────────────────────────
// index.ts — ResumeForge v4.0 Main Orchestrator
//
// Four-phase pipeline, each phase executed EXACTLY ONCE per generation_id:
//   Phase 1 — Parse candidate + extract JD keyword requirements  -> Gemini (fallback Groq)
//   Phase 2 — Analyze job description / rewrite resume against it -> Gemini (fallback Groq)
//   Phase 3 — Tailor / humanize resume for the target role         -> Groq   (fallback Gemini)
//   Phase 4 — Final optimization, RAG validation & formatting data -> Groq   (fallback Gemini)
//   Final   — PDF/DOCX generation (runs ONLY after Phase 4 succeeds)
//
// Idempotency: every request carries (or is assigned) a generation_id.
// A COMPLETED job replays its stored result. A RUNNING job is rejected
// with 409 (stops double-click / duplicate frontend submits from starting
// a second generation job for the same resume).
// ─────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import type { GenerateRequest, GenerateResponse, ResumeJSON, KeywordResult, PhaseLogEntry } from "./types.ts";

import { runAIPhase, REQUEST_DEADLINE_BUDGET_MS, type ProviderName } from "./providers/ai-provider.ts";
import { AIError } from "./providers/errors.ts";
import { parseJSON, validateKeywords, validateResume, validateRag, validateFinalResume } from "./schema.ts";
import { createRegistry, newJob, classifyExisting, type JobRecord } from "./jobs-registry.ts";

import { buildPass1Prompt } from "./prompts/pass1-keywords.ts";
import { buildPass2Prompt } from "./prompts/pass2-rewrite.ts";
import { buildPass3Prompt } from "./prompts/pass3-humanize.ts";
import { buildPass4Prompt } from "./prompts/pass4-rag-verify.ts";

import { parseResumeFacts, buildVerificationContext } from "./rag/resume-parser.ts";
import { searchRoleContext } from "./rag/web-search.ts";
import { checkFacts, removeHallucinatedSkills } from "./rag/fact-checker.ts";
import { calculateTrustScore } from "./rag/trust-scorer.ts";

import { getATSProfile } from "./ats-profiles/generic.ts";
import { calculateATSScore } from "./scoring/ats-score.ts";
import { calculateAIRiskScore } from "./scoring/ai-risk-score.ts";
import { checkLinkedInConsistency } from "./consistency/linkedin-check.ts";

import { buildLatex } from "./latex/build-latex.ts";
import { checkContentPreservation } from "./latex/content-preservation.ts";
import { compileToPDF } from "./pdf/ytotech-client.ts";
import { buildDOCX } from "./docx/build-docx.ts";

// ── CORS ──
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Known template keys — matches the frontend's TPL_MAP values exactly.
// An unrecognized format is a clear 400, never a silent fallback to a
// different template than the one the user picked.
const KNOWN_FORMATS = new Set([
  "modern cv", "moderncv-classic", "moderncv classic", "executive serif",
  "minimal clean tech", "minimal-clean-tech",
  "faang-style compact", "faang style compact", "faang-style-compact",
  "bold header modern", "bold-header-modern",
  "ultra-clean one-page", "ultra clean one page", "ultra-clean-one-page",
  "tech-focused dense", "tech focused dense", "tech-focused-dense",
  "premium minimalist", "premium-minimalist",
  "executive", "structured executive brief", "structured-executive-brief",
]);

// ════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  let generationId = "";
  let job: JobRecord | null = null;
  let registry: ReturnType<typeof createRegistry> | null = null;

  try {
    // ── 1. Auth verification ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonRes({ error: "Unauthorized — please sign in." }, 401);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authErr } = await sb.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !user) return jsonRes({ error: "Invalid session. Please sign in again." }, 401);

    // ── 2. Parse & validate input ──
    const body: GenerateRequest = await req.json();
    const { resume, job: jd, linkedin, ats_target = "generic", format = "minimal-clean-tech", tone = "professional" } = body;

    if (!resume || resume.trim().length < 80)
      return jsonRes({ error: "Please paste your full resume (minimum 80 characters)." }, 400);
    if (!jd || jd.trim().length < 50)
      return jsonRes({ error: "Please paste the complete job description." }, 400);

    const MAX_RESUME_CHARS = 20_000;
    const MAX_JOB_CHARS = 20_000;
    const MAX_LINKEDIN_CHARS = 5_000;
    if (resume.length > MAX_RESUME_CHARS)
      return jsonRes({ error: `Resume text is too long (${resume.length} chars). Please shorten it to under ${MAX_RESUME_CHARS} characters.` }, 400);
    if (jd.length > MAX_JOB_CHARS)
      return jsonRes({ error: `Job description is too long (${jd.length} chars). Please shorten it to under ${MAX_JOB_CHARS} characters.` }, 400);
    if (typeof linkedin === "string" && linkedin.length > MAX_LINKEDIN_CHARS)
      return jsonRes({ error: `LinkedIn text is too long. Please shorten it to under ${MAX_LINKEDIN_CHARS} characters.` }, 400);

    if (!KNOWN_FORMATS.has(String(format).trim().toLowerCase())) {
      return jsonRes({ error: `Unknown template "${format}". Please pick a valid template from the list.` }, 400);
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY")?.trim() || "";
    const groqKey = Deno.env.get("GROQ_API_KEY")?.trim() || "";
    if (!geminiKey && !groqKey) {
      console.error("Neither GEMINI_API_KEY nor GROQ_API_KEY is set in Supabase Edge Function secrets.");
      return jsonRes({ error: "Server configuration error: no AI provider is configured." }, 500);
    }

    // ── 3. generation_id + idempotency ──
    const suppliedId = typeof body.generation_id === "string" ? body.generation_id.trim() : "";
    generationId = UUID_RE.test(suppliedId) ? suppliedId : crypto.randomUUID();

    registry = createRegistry({
      async load(id: string) {
        const { data } = await sb.from("generation_jobs").select("record").eq("generation_id", id).maybeSingle();
        return (data?.record as JobRecord) || null;
      },
      async save(record: JobRecord) {
        await sb.from("generation_jobs").upsert({
          generation_id: record.generation_id,
          user_id: user.id,
          record,
          updated_at: new Date().toISOString(),
        });
      },
    });

    const existing = await registry.load(generationId);
    const classification = classifyExisting(existing);

    if (classification === "replay" && existing?.result) {
      console.log(`generation_id=${generationId} replay=true (job already COMPLETED)`);
      return jsonRes({ ...(existing.result as GenerateResponse), replay: true });
    }
    if (classification === "in_progress") {
      return jsonRes({ error: "This resume generation is already in progress. Please wait for it to finish.", generation_id: generationId }, 409);
    }

    job = newJob(generationId);
    await registry.save(job);

    const markPhase = async (phase: number, status: "RUNNING" | "COMPLETED" | "FAILED", provider?: ProviderName) => {
      if (!job || !registry) return;
      job.phases[phase] = { status, provider };
      job.updated_at = Date.now();
      await registry.save(job);
    };

    // ── 4. ATS profile + resume-facts (RAG source of truth) ──
    const atsProfile = getATSProfile(ats_target);
    const resumeFacts = parseResumeFacts(resume);
    void buildVerificationContext(resumeFacts);

    const phaseLog: PhaseLogEntry[] = [];
    const deadline = Date.now() + REQUEST_DEADLINE_BUDGET_MS;

    // Default provider per phase: 1,2 -> Gemini; 3,4 -> Groq. The alternate
    // is the automatic fallback. If the preferred provider is NOT
    // configured (no secret set), the configured one becomes the default
    // so a single-key deployment still runs.
    const prefer = (primary: ProviderName) => {
      const primaryOk = primary === "gemini" ? !!geminiKey : !!groqKey;
      const alt: ProviderName = primary === "gemini" ? "groq" : "gemini";
      const altOk = primary === "gemini" ? !!groqKey : !!geminiKey;
      return {
        defaultProvider: primaryOk ? primary : (altOk ? alt : primary),
        fallbackProvider: primaryOk ? (altOk ? alt : null) : (altOk ? alt : null),
      };
    };

    // ── 5. Phase 1 — Parse candidate + extract JD keyword requirements (Gemini -> Groq) ──
    await markPhase(1, "RUNNING");
    console.log(`generation_id=${generationId} phase=1 starting`);
    let keywords: KeywordResult;
    {
      const { defaultProvider, fallbackProvider } = prefer("gemini");
      const result = await runAIPhase({
        generationId,
        phase: 1,
        name: "pass1-keywords",
        prompt: buildPass1Prompt(jd),
        temperature: 0.1,
        maxTokens: 2048,
        deadline,
        defaultProvider,
        fallbackProvider,
        jsonMode: true,
        validate: validateKeywords,
        parse: parseJSON,
      });
      keywords = result.parsed as unknown as KeywordResult;
      phaseLog.push({ phase: 1, provider: result.providerUsed, attempts: result.attempts, repaired: result.repaired, durationMs: result.durationMs });
      await markPhase(1, "COMPLETED", result.providerUsed);
    }

    // ── 6. Background/model-knowledge context — sequential, non-fatal ──
    console.log(`generation_id=${generationId} fetching background role/company context`);
    let webContext = "";
    try {
      webContext = await searchRoleContext(keywords.job_title, keywords.company || null, groqKey || geminiKey, "background-context", deadline);
    } catch (e) {
      console.warn(`generation_id=${generationId} background context lookup failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
    }

    // ── 7. Phase 2 — Analyze JD + rewrite resume against it (Gemini -> Groq) ──
    await markPhase(2, "RUNNING");
    console.log(`generation_id=${generationId} phase=2 starting`);
    let draftResume: ResumeJSON;
    {
      const { defaultProvider, fallbackProvider } = prefer("gemini");
      const result = await runAIPhase({
        generationId,
        phase: 2,
        name: "pass2-rewrite",
        prompt: buildPass2Prompt(resume, jd, keywords, format, tone),
        temperature: 0.35,
        maxTokens: 8192,
        deadline,
        defaultProvider,
        fallbackProvider,
        jsonMode: true,
        validate: validateResume,
        parse: parseJSON,
      });
      draftResume = result.parsed as unknown as ResumeJSON;
      phaseLog.push({ phase: 2, provider: result.providerUsed, attempts: result.attempts, repaired: result.repaired, durationMs: result.durationMs });
      await markPhase(2, "COMPLETED", result.providerUsed);
    }

    // ── 8. Phase 3 — Tailor/humanize resume for the target role (Groq -> Gemini) ──
    await markPhase(3, "RUNNING");
    console.log(`generation_id=${generationId} phase=3 starting`);
    let humanizedResume: ResumeJSON;
    let humanizationStatus: "completed" | "failed" = "completed";
    {
      const { defaultProvider, fallbackProvider } = prefer("groq");
      try {
        const result = await runAIPhase({
          generationId,
          phase: 3,
          name: "pass3-humanize",
          prompt: buildPass3Prompt(draftResume),
          temperature: 0.4,
          maxTokens: 3072,
          deadline,
          defaultProvider,
          fallbackProvider,
          jsonMode: true,
          validate: validateResume,
          parse: parseJSON,
        });
        humanizedResume = result.parsed as unknown as ResumeJSON;
        phaseLog.push({ phase: 3, provider: result.providerUsed, attempts: result.attempts, repaired: result.repaired, durationMs: result.durationMs });
        await markPhase(3, "COMPLETED", result.providerUsed);
      } catch (e) {
        humanizedResume = draftResume;
        humanizationStatus = "failed";
        console.warn(`generation_id=${generationId} phase=3 failed, falling back to pre-humanization draft: ${e instanceof Error ? e.message : String(e)}`);
        await markPhase(3, "FAILED");
      }
    }

    // ── 9. RAG — local fact-check against the original resume (no AI call) ──
    console.log(`generation_id=${generationId} running local RAG fact-check`);
    const ragClaims = checkFacts(humanizedResume, resume, resumeFacts, linkedin);

    // ── 10. Phase 4 — Final optimization, RAG validation & formatting data (Groq -> Gemini) ──
    await markPhase(4, "RUNNING");
    console.log(`generation_id=${generationId} phase=4 starting`);
    let verifiedResume: ResumeJSON;
    let pass4Failed = false;
    {
      const { defaultProvider, fallbackProvider } = prefer("groq");
      try {
        const result = await runAIPhase({
          generationId,
          phase: 4,
          name: "pass4-rag-verify",
          prompt: buildPass4Prompt(resume, humanizedResume, webContext, linkedin),
          temperature: 0.1,
          maxTokens: 3072,
          deadline,
          defaultProvider,
          fallbackProvider,
          jsonMode: true,
          validate: validateRag,
          parse: parseJSON,
        });
        const p4Data = result.parsed as Record<string, unknown>;
        verifiedResume = (p4Data.resume as ResumeJSON) || humanizedResume;
        phaseLog.push({ phase: 4, provider: result.providerUsed, attempts: result.attempts, repaired: result.repaired, durationMs: result.durationMs });
        await markPhase(4, "COMPLETED", result.providerUsed);
      } catch (e) {
        verifiedResume = humanizedResume;
        pass4Failed = true;
        console.warn(`generation_id=${generationId} phase=4 failed, falling back to pre-verification resume: ${e instanceof Error ? e.message : String(e)}`);
        await markPhase(4, "FAILED");
      }
    }

    verifiedResume = removeHallucinatedSkills(verifiedResume, resume);

    // ── 11. Output validation gate — BEFORE any PDF/DOCX work ──
    // Only genuine structural corruption blocks generation (see
    // schema.ts). A resume that simply has fewer sections than another
    // candidate's — no experience yet, no formal education, whatever —
    // is not an error; those show up as non-blocking `warnings` instead.
    const finalCheck = validateFinalResume(verifiedResume as unknown as Record<string, unknown>);
    if (!finalCheck.ok) {
      throw new AIError("VALIDATION_ERROR", `Final resume failed validation: ${finalCheck.reasons.join("; ")}`);
    }
    if (finalCheck.warnings.length > 0) {
      console.log(`generation_id=${generationId} final resume warnings (non-blocking): ${finalCheck.warnings.join("; ")}`);
    }

    const ragResult = calculateTrustScore(ragClaims, verifiedResume, webContext);
    const verificationStatus: "VERIFIED" | "PARTIALLY_VERIFIED" | "VERIFICATION_INCOMPLETE" =
      pass4Failed
        ? "VERIFICATION_INCOMPLETE"
        : ragResult.trust_score >= 95
        ? "VERIFIED"
        : "PARTIALLY_VERIFIED";

    console.log(`generation_id=${generationId} checking LinkedIn consistency`);
    const consistency = checkLinkedInConsistency(verifiedResume, linkedin);

    console.log(`generation_id=${generationId} calculating scores`);
    const atsScore = calculateATSScore(verifiedResume, keywords, ats_target);
    const aiRisk = calculateAIRiskScore(verifiedResume);

    // ── 12. PDF/DOCX generation — runs ONLY after Phase 4 has been attempted
    //         and the final resume has passed structural validation. A
    //         "soft" pass4Failed (verification incomplete but structurally
    //         valid resume) still renders, with verificationStatus surfaced
    //         honestly — a hard validation failure above already threw. ──
    console.log(`generation_id=${generationId} building LaTeX (template=${format})`);
    const latex = buildLatex(verifiedResume, format, atsProfile);

    // ── Content-preservation check — template selection must never
    //         silently drop resume content. Deterministic, runs on the
    //         JSON→LaTeX step (see content-preservation.ts for why this
    //         checks that step and not the compiled PDF). Never blocks
    //         generation — this codebase's templates are expected to
    //         pass — but it's reported honestly rather than assumed. ──
    const contentPreservation = checkContentPreservation(verifiedResume, latex, atsProfile);
    if (!contentPreservation.passed) {
      console.warn(`generation_id=${generationId} content-preservation check found missing content:`, contentPreservation.missing_content);
    }
    if (contentPreservation.dropped_bullets.length) {
      console.warn(`generation_id=${generationId} ${contentPreservation.dropped_bullets.length} bullet(s) trimmed by template's bullet cap`);
    }

    console.log(`generation_id=${generationId} compiling PDF and DOCX`);
    const [pdfResult, docxBase64] = await Promise.all([
      compileToPDF(latex),
      buildDOCX(verifiedResume),
    ]);

    const improvements = [
      ...(verifiedResume.improvements_made || []),
      ...(ragResult.flags.map((f) => `⚠️ ${f.flag}`)),
      ...(consistency.flags.map((f) => `🔗 LinkedIn: ${f.message}`)),
    ];

    const response: GenerateResponse = {
      success: true,
      generation_id: generationId,
      replay: false,
      phaseLog,
      template_name: format,
      resumeJSON: verifiedResume,
      latex,
      pdfBase64: pdfResult.pdfBase64,
      pdfAvailable: pdfResult.success,
      pdfError: pdfResult.error,
      docxBase64,
      docxAvailable: !!docxBase64,
      atsScore,
      aiRisk,
      ragResult,
      consistency,
      keywords,
      improvements,
      humanizationStatus,
      verificationStatus,
      contentPreservation,
    };

    if (!job || !registry) throw new Error("generation job state missing");
    job.status = "COMPLETED";
    job.result = response;
    job.updated_at = Date.now();
    await registry.save(job);

    console.log(`generation_id=${generationId} job COMPLETED`);
    return jsonRes(response);
  } catch (err) {
    const aerr = err instanceof AIError ? err : new AIError("INTERNAL_ERROR", err instanceof Error ? err.message : String(err));

    if (job && generationId) {
      for (const ph of Object.keys(job.phases).map(Number)) {
        if (job.phases[ph] && job.phases[ph].status !== "COMPLETED") job.phases[ph].status = "FAILED";
      }
      job.status = "FAILED";
      job.updated_at = Date.now();
      try {
        if (registry) await registry.save(job);
      } catch {
        /* best-effort */
      }
      console.error(`generation_id=${generationId} job FAILED type=${aerr.type}: ${aerr.message}`);
    } else {
      console.error(`ResumeForge error (${aerr.type}):`, aerr.message);
    }

    const status = aerr.type === "PROVIDER_RATE_LIMITED"
      ? 429
      : aerr.type === "VALIDATION_ERROR"
      ? 422
      : (aerr.type === "PROVIDER_TIMEOUT" || aerr.type === "PROVIDER_SERVER_ERROR" || aerr.type === "PROVIDER_UNAVAILABLE")
      ? 502
      : 500;

    return jsonRes({
      error: aerr.message,
      error_type: aerr.type,
      rateLimited: aerr.type === "PROVIDER_RATE_LIMITED",
      generation_id: generationId || undefined,
    }, status);
  }
});
