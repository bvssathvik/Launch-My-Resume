// ─────────────────────────────────────────
// types.ts — Shared interfaces for ResumeForge v3.1
// Every module imports from here
// ─────────────────────────────────────────

// ── INPUT ──
// NOTE: this interface previously had a `export type GenerateResponse = {...}`
// statement accidentally nested inside its body (invalid TypeScript — a type
// alias can't be declared inside an interface). That made this entire file
// fail to parse, which would have broken every module that imports from it
// (i.e. the whole function). Fixed: GenerateRequest is now a single, valid
// interface, and GenerateResponse is defined once, below, near the rest of
// the response types.
export interface GenerateRequest {
  resume: string;          // Original resume text
  job: string;             // Job description text
  linkedin?: string;       // Optional LinkedIn headline + dates
  ats_target: ATSTarget;   // Which ATS system to optimise for
  format: ResumeFormat;    // Visual template
  tone: string;            // professional | confident | concise
  generation_id?: string;  // Client job/request UUID — idempotency key, one per resume
  target?: string;         // Human-readable target role, for multi-resume display
}

export type ATSTarget = "workday" | "greenhouse" | "lever" | "generic";
export type ResumeFormat =
  // ── 8 templates ──
  | "moderncv-classic"
  | "ModernCV Classic"
  | "minimal-clean-tech"
  | "Minimal Clean Tech"
  | "faang-style-compact"
  | "FAANG-Style Compact"
  | "bold-header-modern"
  | "Bold Header Modern"
  | "ultra-clean-one-page"
  | "Ultra-Clean One-Page"
  | "tech-focused-dense"
  | "Tech-Focused Dense"
  | "premium-minimalist"
  | "Premium Minimalist"
  | "structured-executive-brief"
  | "Structured Executive Brief";

export type RiskLevel = "low" | "medium" | "high";

// ── PASS 1 — Keywords ──
export interface KeywordResult {
  job_title: string;
  company?: string;
  must_have: string[];       // Appear 3+ times or in requirements
  important: string[];       // Appear 1-2 times
  nice_to_have: string[];    // Mentioned in preferred/bonus section
  exact_phrases: string[];   // Multi-word phrases to use verbatim
  required_years?: string;
  education_required?: string;
  industry_terms: string[];
  action_verbs: string[];
}

// ── PASS 2 — Resume JSON (single source of truth) ──
export interface ResumeExperience {
  title: string;
  company: string;
  location: string;
  dates: string;             // Always "Month YYYY – Month YYYY"
  bullets: string[];
}

export interface ResumeEducation {
  degree: string;
  school: string;
  location: string;
  dates: string;
  details?: string;
}

export interface ResumeProject {
  name: string;
  tech: string;
  link?: string;
  bullets: string[];
}

// A dynamic, arbitrarily-named section — Awards, Publications, Research,
// Leadership, Volunteer Experience, Languages, Interests, or any custom
// section title the candidate's original resume actually contains.
// This exists so the pipeline never has to choose between "reject the
// resume" and "silently drop a section that isn't one of the hardcoded
// fields above" — see the template-adaptation master prompt: section
// count/shape must never be a validation error, and legitimate sections
// must never be deleted just because they're not one of the named
// fields on ResumeJSON. `entries` are pre-formatted lines (already
// human-readable — not raw objects), rendered as a bullet or plain list
// depending on the template.
export interface ResumeAdditionalSection {
  title: string;       // the section title AS FOUND in the original resume (don't rename it)
  entries: string[];   // one string per line/bullet — never empty strings
}

export interface ResumeJSON {
  name: string;
  contact: string;
  // Every field below except name/contact is genuinely optional. A
  // resume that legitimately has no summary, no projects, no
  // certifications, etc. is valid — omit the field/leave the array
  // empty rather than inventing placeholder content. See schema.ts
  // validateFinalResume() and the master prompt this pipeline follows.
  summary?: string;
  experience: ResumeExperience[];
  education: ResumeEducation[];
  skills: Record<string, string[]>;
  projects?: ResumeProject[];
  certifications?: string[];
  // Any other section present in the ORIGINAL resume that doesn't map
  // to one of the fields above (Awards, Publications, Research,
  // Leadership, Volunteer Experience, Languages, Interests, a fully
  // custom title, etc.). Never fabricated — only populated when the
  // original resume actually contains that content.
  additional_sections?: ResumeAdditionalSection[];
  keywords_embedded?: string[];
  keywords_missing?: string[];
  ats_score_estimate?: number;
  improvements_made?: string[];
}

// ── PASS 3 — Humanize result ──
export interface HumanizeResult {
  resume: ResumeJSON;
  buzzwords_removed: string[];
  changes_made: string[];
}

// ── PASS 4 — RAG Result ──
export interface RAGClaim {
  claim: string;
  verified: boolean;
  // NOTE: "model_knowledge" (not "web_search") — there is no live search
  // provider wired in; any background context comes from the LLM's own
  // training knowledge. See rag/web-search.ts.
  source: "original_resume" | "model_knowledge" | "linkedin" | "unverifiable";
  flag?: string;             // Explanation if not verified
}

export interface RAGResult {
  resume: ResumeJSON;
  claims_checked: number;
  claims_verified: number;
  trust_score: number;       // 0-100
  flags: RAGClaim[];
  // Background/model-knowledge context about the role & company (NOT
  // live-searched — see rag/web-search.ts). Supplementary only; never
  // authoritative over the original resume.
  web_context?: string;
}

// ── SCORING ──
// v3.2: three-score architecture (match / parsability / content quality)
// instead of one composite "ATS score" — see scoring/ats-score.ts for why.
// All original fields are kept as-is for backward compatibility with the
// existing frontend (score, must_have_coverage, keywords_missing, etc.);
// everything below `breakdown` is additive.
export interface ATSScoreResult {
  score: number;             // 0-100 — same value as matchScore
  must_have_coverage: number;
  important_coverage: number;
  keywords_found: string[];
  keywords_missing: string[];
  section_headers_ok: boolean;
  single_column: boolean;
  date_format_ok: boolean;
  breakdown: Record<string, number>;

  // Explicit three-score architecture
  matchScore: number;            // 0-100 — job/resume content match (same as `score`)
  parsabilityScore: number;      // 0-100 — can our generated document be safely parsed
  contentQualityScore: number;   // 0-100 — writing quality (quantified impact, action verbs, etc.)

  required_skills_found: string[];
  required_skills_missing: string[];
  preferred_skills_found: string[];
  preferred_skills_missing: string[];

  job_title_match: "exact" | "related" | "none";
  experience_match: {
    required_years: number | null;
    estimated_years: number;
  };

  parsing_warnings: string[];
  content_warnings: string[];

  explanation: string[];     // human-readable, auditable list of what drove the match score
  disclaimer: string;        // "this is an estimate, not a universal ATS score" — always shown
}

export interface AIRiskResult {
  score: number;             // 0-100 (lower = safer)
  level: RiskLevel;          // low | medium | high
  buzzwords_found: string[];
  uniform_rhythm: boolean;
  generic_phrases: string[];
  recommendation: string;
}

// ── CONSISTENCY ──
export interface LinkedInFlag {
  type: "date_mismatch" | "title_mismatch" | "company_mismatch";
  resume_value: string;
  linkedin_value: string;
  severity: "warning" | "critical";
  message: string;
}

export interface ConsistencyResult {
  checked: boolean;
  flags: LinkedInFlag[];
  all_clear: boolean;
}

// ── FINAL RESPONSE ──
// Per-phase provider attribution, returned so the UI/logs can show exactly
// which provider ran which phase (and whether a fallback/repair happened).
export interface PhaseLogEntry {
  phase: 1 | 2 | 3 | 4;
  provider: "gemini" | "groq";
  attempts: number;
  repaired: boolean;
  durationMs: number;
}

export interface DroppedBullet {
  role: string;
  bullet: string;
}

export interface ContentPreservationReport {
  passed: boolean;
  checked: {
    name: boolean;
    contact: boolean;
    summary_present: boolean;
    experience_entries: { expected: number; found: number };
    education_entries: { expected: number; found: number };
    projects: { expected: number; found: number };
    skills: { expected: number; found: number };
    certifications: { expected: number; found: number };
    additional_sections: { expected: number; found: number };
  };
  missing_content: string[];
  dropped_bullets: DroppedBullet[];
}

export interface GenerateResponse {
  success: boolean;
  generation_id: string;        // job key — every phase ran under this ID, echoed for idempotency
  replay?: boolean;             // true when this is an idempotent replay of an already-COMPLETED job
  phaseLog?: PhaseLogEntry[];   // which provider actually ran each phase
  template_name: string;        // backend-resolved template key actually used for LaTeX/PDF —
                                 // the frontend must display THIS, never a locally-cached guess
  resumeJSON: ResumeJSON;
  latex: string;
  pdfBase64: string | null;
  pdfAvailable: boolean;
  pdfError?: string;
  docxBase64: string | null;
  docxAvailable: boolean;
  atsScore: ATSScoreResult;
  aiRisk: AIRiskResult;
  ragResult: RAGResult;
  consistency: ConsistencyResult;
  keywords: KeywordResult;
  improvements: string[];
  error?: string;
  // Set when generation failed specifically because Groq's account-level
  // rate limit couldn't be cleared within this request's time budget (see
  // groq-client.ts). Lets the frontend show a "try again shortly" message
  // instead of a generic error / the "check your Edge Function" hint.
  rateLimited?: boolean;
  // Explicit, honest status for Pass 3 (humanization). "failed" means the
  // model's Pass-3 output couldn't be parsed and the pipeline fell back to
  // the pre-humanization draft — the resume is still usable, but it did
  // NOT go through the de-AI humanization step. Never silently reported
  // as "completed" when this happened.
  humanizationStatus: "completed" | "failed";
  // Explicit, honest status for Pass 4 (AI-assisted RAG verification) +
  // the local fact-check that always runs regardless of Pass 4's outcome.
  // The frontend must show one of these states rather than a generic
  // "Verified" badge, so a failed AI verification pass is never displayed
  // as if it succeeded:
  //   VERIFIED              - Pass 4 completed AND local fact-check trust
  //                            score is high (>=95).
  //   PARTIALLY_VERIFIED     - Pass 4 completed but some claims were
  //                            flagged (trust score < 95), OR Pass 4
  //                            failed but the local fact-check still ran.
  //   VERIFICATION_INCOMPLETE - Pass 4's AI verification step failed to
  //                            produce usable output; only the local
  //                            heuristic fact-check ran.
  verificationStatus: "VERIFIED" | "PARTIALLY_VERIFIED" | "VERIFICATION_INCOMPLETE";
  // Deterministic JSON→LaTeX content-preservation report — see
  // latex/content-preservation.ts. Confirms template selection didn't
  // silently drop any canonical resume field, and surfaces any bullets
  // trimmed by the per-template bullet cap instead of hiding them.
  contentPreservation: ContentPreservationReport;
}

// ── ATS PROFILE ──
export interface ATSProfileRules {
  name: string;
  section_order: string[];
  title_weight: number;      // 0-1, how heavily title match is weighted
  skills_position: "top" | "bottom" | "after_summary";
  max_bullets_per_role: number;
  prefer_docx: boolean;
  extra_conservative: boolean;
  notes: string;
}
