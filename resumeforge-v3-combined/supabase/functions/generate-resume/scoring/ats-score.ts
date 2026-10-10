// ─────────────────────────────────────────
// ats-score.ts — ATS Score Calculator (deterministic rubric)
//
// v3.2 — THREE-SCORE ARCHITECTURE
// ─────────────────────────────────────────
// A single 0-100 "ATS score" invites the reader to treat it as THE
// universal ATS score. There is no such thing — different platforms
// (Workday, Greenhouse, Lever, etc.) parse and weight differently, and
// none of them publish their exact algorithm. So this engine reports
// three separate, individually-explainable numbers instead of one
// composite:
//
//   1. matchScore       — how well the resume's content lines up with
//                          the specific job description (skills, title,
//                          experience, education, phrases).
//   2. parsabilityScore — whether the generated document itself is in a
//                          shape ATS parsers handle safely (this one is
//                          about OUR OWN output — see note below).
//   3. contentQualityScore — writing quality signals (quantified impact,
//                          action verbs, repetition, buzzwords) that
//                          reputable checkers (Jobscan) explicitly track
//                          as separate from match rate.
//
// `score` (top-level) is kept equal to `matchScore` for backward
// compatibility with existing frontend code that reads `atsScore.score`.
//
// NOTE on parsability: ResumeForge does not accept an arbitrary uploaded
// PDF/DOCX to scan for columns/tables/images — it GENERATES the document
// from ResumeJSON through our own fixed LaTeX/DOCX templates. So
// "parsability" here checks the things that are actually variable given
// that pipeline (contact/section/date extractability from the structured
// data) plus confirms the template-level guarantees (single column, no
// tables/images in body) that make our output ATS-safe by construction.
// It is not a scan of a third-party uploaded file.
//
// MATCHING: whole-word / whole-phrase only (no substring false
// positives — "react" must not match inside "reaction"), PLUS a small,
// explicit, hand-curated canonical/acronym dictionary (skills-canon.ts)
// so "AWS" on a resume matches "Amazon Web Services" on a job post.
// Semantic matching is deliberately controlled/whitelisted, never
// inferred — this engine never treats "data analysis" as equivalent to
// "Python", etc.
//
// Every deduction is explainable: `explanation` lists exactly why the
// match score is what it is, and `keywords_found` / `keywords_missing`
// are exact strings, not fuzzy buckets.
// ─────────────────────────────────────────

import type { ATSScoreResult, KeywordResult, ResumeJSON } from "../types.ts";
import { BUZZWORDS, expandCanonical, GENERIC_ACTION_VERBS } from "./skills-canon.ts";

const DISCLAIMER =
  "ResumeForge's ATS Match Score is an estimated compatibility score based on " +
  "this resume and this specific job description. There is no single universal " +
  "ATS algorithm — different platforms (Workday, Greenhouse, Lever, etc.) parse " +
  "and weight differently, and this score is not a guarantee of passing any " +
  "specific employer's system.";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Safe, explicit variant generation — NOT blind stemming. Only adds
// well-known, unambiguous surface forms so "manage" also matches
// "managed"/"manages"/"managing" without ever matching unrelated words.
function wordVariants(word: string): string[] {
  const w = word.trim();
  if (!w) return [];
  const variants = new Set<string>([w]);
  const lower = w.toLowerCase();
  if (/[a-z]$/i.test(lower)) {
    variants.add(w + "s");
    variants.add(w + "es");
    if (lower.endsWith("y") && lower.length > 2) variants.add(w.slice(0, -1) + "ies");
    if (lower.endsWith("e")) {
      variants.add(w + "d");
      variants.add(w.slice(0, -1) + "ing");
    } else {
      variants.add(w + "ed");
      variants.add(w + "ing");
    }
  }
  return [...variants];
}

/**
 * Whole-word / whole-phrase match only. A single-word keyword must match
 * as a complete word (`\bReact\b` — not inside "Reaction"). A multi-word
 * phrase must appear as a contiguous, whole-word sequence.
 */
function singleTermPresent(keyword: string, text: string): boolean {
  const kw = keyword.trim();
  if (!kw) return false;
  const isPhrase = /\s/.test(kw) || /[./#+]/.test(kw);

  if (isPhrase) {
    const pattern = new RegExp(`\\b${escapeRegExp(kw).replace(/\s+/g, "\\s+")}`, "i");
    return pattern.test(text);
  }

  const variants = wordVariants(kw);
  const pattern = new RegExp(`\\b(${variants.map(escapeRegExp).join("|")})\\b`, "i");
  return pattern.test(text);
}

/** Whole-word/phrase match, expanded across the controlled canonical dictionary. */
function keywordPresent(keyword: string, text: string): boolean {
  return expandCanonical(keyword).some((term) => singleTermPresent(term, text));
}

type Evidence = "experience" | "skills-only" | "none";

/** Where a matched keyword actually shows up — used for evidence strength, not scoring. */
function keywordEvidence(keyword: string, skillsText: string, experienceText: string): Evidence {
  const terms = expandCanonical(keyword);
  const inExperience = terms.some((t) => singleTermPresent(t, experienceText));
  if (inExperience) return "experience";
  const inSkills = terms.some((t) => singleTermPresent(t, skillsText));
  if (inSkills) return "skills-only";
  return "none";
}

function resumeSkillsText(resume: ResumeJSON): string {
  const parts: string[] = [];
  resume.skills && Object.entries(resume.skills).forEach(([cat, items]) => {
    parts.push(cat);
    (items as string[]).forEach((s) => parts.push(s));
  });
  (resume.certifications || []).forEach((c) => parts.push(c));
  return parts.join(" | ");
}

function resumeExperienceText(resume: ResumeJSON): string {
  const parts: string[] = [resume.summary || ""];
  resume.experience?.forEach((job) => {
    parts.push(job.title, job.company);
    job.bullets?.forEach((b) => parts.push(b));
  });
  resume.projects?.forEach((p) => {
    parts.push(p.name, p.tech);
    p.bullets?.forEach((b) => parts.push(b));
  });
  return parts.join(" | ");
}

function resumeToText(resume: ResumeJSON): string {
  return [
    resume.name || "",
    resume.contact || "",
    resumeExperienceText(resume),
    resumeSkillsText(resume),
    (resume.education || []).map((e) => `${e.degree} ${e.school} ${e.details || ""}`).join(" "),
  ].join(" ");
}

function checkSectionHeaders(resume: ResumeJSON): boolean {
  return !!(resume.experience?.length && resume.education?.length && resume.skills);
}

const MONTH_YEAR = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}/i;

function checkDateFormat(resume: ResumeJSON): boolean {
  let allCorrect = true;
  resume.experience?.forEach((job) => {
    if (!MONTH_YEAR.test(job.dates)) allCorrect = false;
  });
  resume.education?.forEach((edu) => {
    if (edu.dates && !MONTH_YEAR.test(edu.dates) && !/\d{4}/.test(edu.dates)) {
      allCorrect = false;
    }
  });
  return allCorrect;
}

/** Sums up the approximate total years of experience from "Mon YYYY – Mon YYYY" / "Present" ranges. */
function estimateExperienceYears(resume: ResumeJSON): number {
  const MONTHS: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  let totalMonths = 0;
  const now = new Date();

  resume.experience?.forEach((job) => {
    const range = (job.dates || "").split(/[–—-]/).map((s) => s.trim());
    if (range.length < 2) return;
    const start = range[0].match(/([A-Za-z]{3,})[a-z]*\s+(\d{4})/);
    const isPresent = /present|current/i.test(range[1]);
    const end = range[1].match(/([A-Za-z]{3,})[a-z]*\s+(\d{4})/);
    if (!start) return;

    const startMonthKey = start[1].slice(0, 3).toLowerCase();
    const startMonth = MONTHS[startMonthKey];
    const startYear = parseInt(start[2], 10);
    if (startMonth === undefined || isNaN(startYear)) return;

    let endMonth: number, endYear: number;
    if (isPresent) {
      endMonth = now.getMonth();
      endYear = now.getFullYear();
    } else if (end) {
      const endMonthKey = end[1].slice(0, 3).toLowerCase();
      endMonth = MONTHS[endMonthKey];
      endYear = parseInt(end[2], 10);
      if (endMonth === undefined || isNaN(endYear)) return;
    } else {
      return;
    }

    const months = (endYear - startYear) * 12 + (endMonth - startMonth);
    if (months > 0) totalMonths += months;
  });

  return Math.round((totalMonths / 12) * 10) / 10;
}

type TitleMatch = "exact" | "related" | "none";

function matchJobTitle(requiredTitle: string, resume: ResumeJSON): TitleMatch {
  const title = (requiredTitle || "").trim();
  if (!title) return "none";

  const mostRecentTitle = resume.experience?.[0]?.title || "";
  const haystacks = [mostRecentTitle, resume.summary || ""];

  for (const h of haystacks) {
    if (h && singleTermPresent(title, h)) return "exact";
  }

  // "Related" — meaningful word overlap (ignoring short filler words),
  // e.g. "Machine Learning Engineer" vs "Machine Learning Intern".
  const titleWords = title.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  if (titleWords.length === 0) return "none";
  const resumeText = haystacks.join(" ").toLowerCase();
  const overlap = titleWords.filter((w) => resumeText.includes(w)).length;
  const ratio = overlap / titleWords.length;
  return ratio >= 0.5 ? "related" : "none";
}

/** "3+ years" / "at least 2 years" / "5 years" -> 3 / 2 / 5. Returns null if unparsable. */
function parseRequiredYears(requiredYears?: string): number | null {
  if (!requiredYears) return null;
  const m = requiredYears.match(/(\d+(\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function allExperienceBullets(resume: ResumeJSON): string[] {
  const bullets: string[] = [];
  resume.experience?.forEach((j) => j.bullets?.forEach((b) => bullets.push(b)));
  resume.projects?.forEach((p) => p.bullets?.forEach((b) => bullets.push(b)));
  return bullets;
}

interface ContentQualityResult {
  score: number;
  quantified_pct: number;
  action_verb_pct: number;
  buzzwords_found: string[];
  repeated_bullets: number;
  warnings: string[];
}

function scoreContentQuality(resume: ResumeJSON, keywords: KeywordResult): ContentQualityResult {
  const bullets = allExperienceBullets(resume);
  const warnings: string[] = [];

  const quantified = bullets.filter((b) => /\d/.test(b));
  const quantifiedPct = bullets.length ? Math.round((quantified.length / bullets.length) * 100) : 100;
  if (bullets.length && quantifiedPct < 50) {
    warnings.push(`${bullets.length - quantified.length} of ${bullets.length} bullets have no measurable outcome (number, %, or metric).`);
  }

  const actionVerbs = (keywords.action_verbs?.length ? keywords.action_verbs : GENERIC_ACTION_VERBS)
    .map((v) => v.toLowerCase());
  const startsWithVerb = bullets.filter((b) => {
    const firstWord = b.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "");
    return firstWord && actionVerbs.some((v) => firstWord === v || firstWord === v.replace(/e$/, "ed") || firstWord.startsWith(v.slice(0, Math.max(4, v.length - 2))));
  });
  const actionVerbPct = bullets.length ? Math.round((startsWithVerb.length / bullets.length) * 100) : 100;
  if (bullets.length && actionVerbPct < 50) {
    warnings.push("Several bullets don't open with a strong action verb.");
  }

  const seen = new Map<string, number>();
  bullets.forEach((b) => {
    const norm = b.trim().toLowerCase();
    seen.set(norm, (seen.get(norm) || 0) + 1);
  });
  const repeatedBullets = [...seen.values()].filter((c) => c > 1).length;
  if (repeatedBullets > 0) {
    warnings.push(`${repeatedBullets} duplicate bullet(s) detected across sections.`);
  }

  const fullText = [resume.summary || "", ...bullets].join(" \n ").toLowerCase();
  const buzzwordsFound = BUZZWORDS.filter((b) => fullText.includes(b.toLowerCase()));
  if (buzzwordsFound.length) {
    warnings.push(`Generic filler phrase(s) detected: ${buzzwordsFound.join(", ")}.`);
  }

  const repetitionPenalty = Math.min(15, repeatedBullets * 5);
  const buzzwordPenalty = Math.min(15, buzzwordsFound.length * 5);

  const score = Math.round(
    (quantifiedPct * 0.40) +
    (actionVerbPct * 0.30) +
    (15 - repetitionPenalty) +
    (15 - buzzwordPenalty),
  );

  return {
    score: Math.max(0, Math.min(100, score)),
    quantified_pct: quantifiedPct,
    action_verb_pct: actionVerbPct,
    buzzwords_found: buzzwordsFound,
    repeated_bullets: repeatedBullets,
    warnings,
  };
}

interface ParsabilityResult {
  score: number;
  checks: Record<string, boolean>;
  warnings: string[];
}

function scoreParsability(resume: ResumeJSON): ParsabilityResult {
  const warnings: string[] = [];

  const hasEmail = /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/.test(resume.contact || "");
  const contactExtractable = !!(resume.contact && resume.contact.trim().length > 0);
  if (contactExtractable && !hasEmail) {
    warnings.push("No email address detected in contact line — some ATS parsers rely on this for candidate matching.");
  }

  const headersOk = checkSectionHeaders(resume);
  if (!headersOk) {
    warnings.push("Missing one or more standard sections (experience, education, or skills).");
  }

  const datesOk = checkDateFormat(resume);
  if (!datesOk) {
    warnings.push("One or more dates aren't in a standard 'Mon YYYY' format.");
  }

  const skillsPresent = !!(resume.skills && Object.keys(resume.skills).length > 0);

  // Guaranteed true by our own generation pipeline — all 15+ templates
  // are single-column body text with no tables/images in the content
  // flow. Reported here as an explicit check rather than assumed silently.
  const singleColumn = true;
  const noTablesOrImages = true;

  const checks = {
    contact_extractable: contactExtractable && hasEmail,
    section_headers_present: headersOk,
    dates_parseable: datesOk,
    skills_section_present: skillsPresent,
    single_column_layout: singleColumn,
    no_tables_or_images_in_body: noTablesOrImages,
  };

  const weights: Record<keyof typeof checks, number> = {
    contact_extractable: 20,
    section_headers_present: 20,
    dates_parseable: 15,
    skills_section_present: 15,
    single_column_layout: 15,
    no_tables_or_images_in_body: 15,
  };

  let score = 0;
  (Object.keys(checks) as (keyof typeof checks)[]).forEach((k) => {
    if (checks[k]) score += weights[k];
  });

  return { score, checks, warnings };
}

/**
 * Match Score rubric (documented so the number is explainable):
 *   required (must_have) keyword coverage    — 35%
 *   preferred (important) keyword coverage   — 20%
 *   exact_phrases coverage                   — 10%
 *   job title alignment                      — 15%
 *   experience-years alignment               — 10%
 *   structure (headers + dates)              — 5%
 *   nice_to_have / bonus keyword coverage     — 5%
 * All keyword matching is whole-word / whole-phrase, expanded through a
 * small controlled canonical/acronym dictionary — no uncontrolled
 * semantic guessing, no substring false positives.
 */
export function calculateATSScore(
  resume: ResumeJSON,
  keywords: KeywordResult,
  atsTarget: string,
): ATSScoreResult {
  const resumeText = resumeToText(resume);
  const skillsText = resumeSkillsText(resume);
  const experienceText = resumeExperienceText(resume);

  const requiredFound = keywords.must_have.filter((kw) => keywordPresent(kw, resumeText));
  const requiredMissing = keywords.must_have.filter((kw) => !keywordPresent(kw, resumeText));
  const requiredCoverage = keywords.must_have.length > 0 ? requiredFound.length / keywords.must_have.length : 1;

  const preferredFound = keywords.important.filter((kw) => keywordPresent(kw, resumeText));
  const preferredMissing = keywords.important.filter((kw) => !keywordPresent(kw, resumeText));
  const preferredCoverage = keywords.important.length > 0 ? preferredFound.length / keywords.important.length : 1;

  const bonusFound = (keywords.nice_to_have || []).filter((kw) => keywordPresent(kw, resumeText));
  const bonusCoverage = (keywords.nice_to_have || []).length > 0
    ? bonusFound.length / keywords.nice_to_have.length
    : 1;

  const phrasesFound = (keywords.exact_phrases || []).filter((p) => keywordPresent(p, resumeText));
  const phrasesCoverage = (keywords.exact_phrases || []).length > 0
    ? phrasesFound.length / keywords.exact_phrases.length
    : 1;

  const headersOk = checkSectionHeaders(resume);
  const datesOk = checkDateFormat(resume);
  const structuralScore = ((headersOk ? 1 : 0) + (datesOk ? 1 : 0)) / 2;

  const titleMatch = matchJobTitle(keywords.job_title, resume);
  const titleScore = titleMatch === "exact" ? 1 : titleMatch === "related" ? 0.6 : 0;

  const requiredYears = parseRequiredYears(keywords.required_years);
  const estimatedYears = estimateExperienceYears(resume);
  let experienceScore = 1; // no requirement stated -> don't penalize
  let experienceNote: string | null = null;
  if (requiredYears !== null) {
    if (estimatedYears >= requiredYears) {
      experienceScore = 1;
    } else if (estimatedYears >= requiredYears * 0.66) {
      experienceScore = 0.6;
      experienceNote = `Estimated ${estimatedYears} yrs experience vs ${requiredYears}+ requested.`;
    } else {
      experienceScore = 0.25;
      experienceNote = `Estimated ${estimatedYears} yrs experience is below the ${requiredYears}+ requested.`;
    }
  }

  const hasKeywords =
    keywords.must_have.length > 0 ||
    keywords.important.length > 0 ||
    (keywords.exact_phrases || []).length > 0;

  const weights = {
    required: 0.35,
    preferred: 0.20,
    phrases: 0.10,
    title: 0.15,
    experience: 0.10,
    structure: 0.05,
    bonus: 0.05,
  };

  const rawScore = !hasKeywords
    ? (structuralScore * 0.8) + (titleScore * 0.2)
    : (requiredCoverage * weights.required) +
      (preferredCoverage * weights.preferred) +
      (phrasesCoverage * weights.phrases) +
      (titleScore * weights.title) +
      (experienceScore * weights.experience) +
      (structuralScore * weights.structure) +
      (bonusCoverage * weights.bonus);

  const matchScore = Math.min(100, Math.round(rawScore * 100));

  // Evidence: does a matched keyword show up backed by experience/project
  // bullets, or only sitting in the skills list? Reported for transparency
  // — does not change the score (avoids double-penalizing skills-section
  // candidates, which is common and not inherently dishonest).
  const evidenceWarnings: string[] = [];
  [...requiredFound, ...preferredFound].forEach((kw) => {
    const ev = keywordEvidence(kw, skillsText, experienceText);
    if (ev === "skills-only") {
      evidenceWarnings.push(`"${kw}" only appears in the skills list — no supporting experience or project bullet.`);
    }
  });

  const explanation: string[] = [];
  if (hasKeywords) {
    explanation.push(`Required skills matched: ${requiredFound.length}/${keywords.must_have.length} (${Math.round(requiredCoverage * 100)}%)`);
    explanation.push(`Preferred skills matched: ${preferredFound.length}/${keywords.important.length} (${Math.round(preferredCoverage * 100)}%)`);
    if ((keywords.exact_phrases || []).length) {
      explanation.push(`Exact phrases matched: ${phrasesFound.length}/${keywords.exact_phrases.length}`);
    }
  }
  explanation.push(`Job title alignment: ${titleMatch}`);
  if (experienceNote) explanation.push(experienceNote);
  if (!headersOk) explanation.push("Missing a standard section (experience/education/skills).");
  if (!datesOk) explanation.push("Date formatting inconsistent with 'Mon YYYY' standard.");

  const contentQuality = scoreContentQuality(resume, keywords);
  const parsability = scoreParsability(resume);

  return {
    // ── backward-compatible fields (existing frontend reads these) ──
    score: matchScore,
    must_have_coverage: Math.round(requiredCoverage * 100),
    important_coverage: Math.round(preferredCoverage * 100),
    keywords_found: [...requiredFound, ...preferredFound, ...phrasesFound],
    keywords_missing: [...requiredMissing, ...preferredMissing],
    section_headers_ok: headersOk,
    single_column: true,
    date_format_ok: datesOk,
    breakdown: {
      required: Math.round(requiredCoverage * weights.required * 100),
      preferred: Math.round(preferredCoverage * weights.preferred * 100),
      phrases: Math.round(phrasesCoverage * weights.phrases * 100),
      title: Math.round(titleScore * weights.title * 100),
      experience: Math.round(experienceScore * weights.experience * 100),
      structure: Math.round(structuralScore * weights.structure * 100),
      bonus: Math.round(bonusCoverage * weights.bonus * 100),
    },

    // ── new, explicit three-score architecture ──
    matchScore,
    parsabilityScore: parsability.score,
    contentQualityScore: contentQuality.score,

    required_skills_found: requiredFound,
    required_skills_missing: requiredMissing,
    preferred_skills_found: preferredFound,
    preferred_skills_missing: preferredMissing,

    job_title_match: titleMatch,
    experience_match: {
      required_years: requiredYears,
      estimated_years: estimatedYears,
    },

    parsing_warnings: parsability.warnings,
    content_warnings: [...contentQuality.warnings, ...evidenceWarnings],

    explanation,
    disclaimer: DISCLAIMER,
  };
}
