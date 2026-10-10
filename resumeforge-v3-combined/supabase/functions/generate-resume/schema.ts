// ─────────────────────────────────────────
// schema.ts — Typed JSON contracts between pipeline phases
//
// Each phase's raw AI output is parsed, then validated here BEFORE it is
// allowed to become the next phase's input. Malformed output never flows
// forward — runAIPhase() treats a failed validate() as a repairable
// failure (one retry, then failover to the other provider).
// ─────────────────────────────────────────

export function parseJSON(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in AI response");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** Phase 1 contract — job-description keyword/requirement extraction. */
export function validateKeywords(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.job_title !== "string" || !o.job_title.trim()) return false;
  if (!isStringArray(o.must_have)) return false;
  if (!isStringArray(o.important)) return false;
  // nice_to_have / exact_phrases / industry_terms / action_verbs are
  // optional arrays — tolerate missing, but reject wrong types.
  for (const key of ["nice_to_have", "exact_phrases", "industry_terms", "action_verbs"]) {
    if (o[key] !== undefined && !isStringArray(o[key])) return false;
  }
  return true;
}

/**
 * Phase 2 & 3 contract — a resume document (rewritten / humanized).
 *
 * This checks STRUCTURE (are the fields that exist well-formed?), never
 * WHICH sections are present. A candidate whose original resume has no
 * work experience yet (a student), or no projects, or an extra section
 * like "Publications" this schema doesn't name, is a normal, valid
 * resume — not a validation failure. See the template-adaptation
 * master prompt: section count/shape must never be a rejection reason.
 */
export function validateResume(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== "string" || !o.name.trim()) return false;
  // experience/education/skills must be well-formed IF PRESENT, but a
  // resume legitimately omitting one entirely is not malformed — treat
  // a missing field the same as an empty array/object rather than
  // failing the whole document.
  if (o.experience !== undefined && !Array.isArray(o.experience)) return false;
  if (o.education !== undefined && !Array.isArray(o.education)) return false;
  if (o.skills !== undefined && typeof o.skills !== "object") return false;
  // Each experience entry needs at minimum a title and bullets array.
  for (const job of (o.experience as unknown[]) || []) {
    if (!job || typeof job !== "object") return false;
    const j = job as Record<string, unknown>;
    if (typeof j.title !== "string") return false;
    if (j.bullets !== undefined && !isStringArray(j.bullets)) return false;
  }
  // additional_sections, when present, must be an array of
  // { title: string, entries: string[] } — a section with no entries
  // is meaningless and dropped later (see build-latex.ts), not treated
  // as invalid here.
  if (o.additional_sections !== undefined) {
    if (!Array.isArray(o.additional_sections)) return false;
    for (const sec of o.additional_sections as unknown[]) {
      if (!sec || typeof sec !== "object") return false;
      const s = sec as Record<string, unknown>;
      if (typeof s.title !== "string" || !s.title.trim()) return false;
      if (s.entries !== undefined && !isStringArray(s.entries)) return false;
    }
  }
  return true;
}

/** Phase 4 contract — { resume: ResumeJSON, claims_checked…, flags… }. */
export function validateRag(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (!validateResume(o.resume)) return false;
  return true;
}

/**
 * Final output-validation gate — runs AFTER phase 4, BEFORE any PDF/DOCX
 * work starts.
 *
 * Per the template-adaptation master prompt this pipeline follows:
 * section count/shape is NEVER a rejection reason. A resume with no
 * work experience (a student/new grad), no formal education entry, or
 * no skills block is a normal, legitimate resume — this gate must not
 * throw it out for that. What this DOES still check is genuine
 * structural corruption: no name/contact at all (nothing to put on the
 * page), or a field that's the wrong TYPE (which would break LaTeX
 * rendering downstream, not just look sparse).
 *
 * `warnings` carries the same "this section looks sparse" signals the
 * old hard-fail list used to check, but they're informational — surfaced
 * to the caller/logs, never used to block generation.
 */
export function validateFinalResume(
  resume: Record<string, unknown>,
): { ok: boolean; reasons: string[]; warnings: string[] } {
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (!resume) {
    return { ok: false, reasons: ["missing resume object"], warnings };
  }
  if (typeof resume.name !== "string" || !resume.name.trim()) reasons.push("missing candidate name");
  if (typeof resume.contact !== "string" || !resume.contact.trim()) reasons.push("missing contact information");

  const experience = resume.experience as unknown[] | undefined;
  if (experience !== undefined && !Array.isArray(experience)) reasons.push("experience field is malformed (not a list)");
  else if (!experience || experience.length === 0) warnings.push("no work experience section — leaving it out rather than fabricating one");
  else {
    for (const job of experience) {
      const j = job as Record<string, unknown>;
      if (!j || typeof j !== "object" || typeof j.title !== "string") {
        reasons.push("an experience entry is malformed");
      } else if (!Array.isArray(j.bullets) || (j.bullets as unknown[]).length === 0) {
        warnings.push(`no bullets for role "${j.title}" — role kept, bullets omitted rather than invented`);
      }
    }
  }

  const education = resume.education as unknown[] | undefined;
  if (education !== undefined && !Array.isArray(education)) reasons.push("education field is malformed (not a list)");
  else if (!education || education.length === 0) warnings.push("no education section — leaving it out rather than fabricating one");

  const skills = resume.skills as Record<string, unknown> | undefined;
  if (skills !== undefined && typeof skills !== "object") reasons.push("skills field is malformed");
  else if (!skills || Object.keys(skills).length === 0) warnings.push("no skills section — leaving it out rather than fabricating one");

  const additional = resume.additional_sections as unknown[] | undefined;
  if (additional !== undefined && !Array.isArray(additional)) reasons.push("additional_sections field is malformed (not a list)");

  return { ok: reasons.length === 0, reasons, warnings };
}
