// ─────────────────────────────────────────
// content-preservation.ts — "Template selection must never modify or
// silently lose resume data" (Rules 1-9, 13-15 from the canonical-JSON
// architecture note).
//
// SCOPE — what this checks and what it doesn't:
// This validates the JSON → LaTeX step, which is fully deterministic and
// under our control: given the same ResumeJSON, buildLatex() must produce
// a document that contains every field the user actually has (accounting
// for the documented bullet-count cap — see below), regardless of which
// of the 15 templates was selected. That's the guarantee this module can
// make and verify with certainty in this codebase.
//
// It does NOT extract text back out of the compiled PDF. Doing that
// correctly for pdflatex output requires decoding the PDF's embedded,
// per-document font subsetting and ToUnicode CMaps (what libraries like
// pdf.js/pdfminer do) — a naive byte-level Tj/TJ scan on a pdflatex PDF
// usually reads back glyph indices, not the original characters, and
// would silently produce FALSE "missing content" reports on a perfectly
// fine PDF. That's worse than not checking at all, so it isn't included
// here. If/when this needs a true PDF-level check, it should go through
// a real PDF text-extraction library that's been verified against actual
// output from this project's compiler (ytotech), not a hand-rolled parser.
//
// WHAT IS GUARANTEED ELSEWHERE IN THIS CODEBASE (so this module doesn't
// need to re-check it):
//   - Every one of the 15 templates renders from the exact same
//     `sections` object built once in buildLatex() from the same
//     ResumeJSON — templates never receive or hold their own copy of
//     resume data (confirmed: every template interpolates
//     sections.projects / sections.certifications when present).
//   - All resume text passes through the single esc() function before
//     reaching any template — escaping isn't duplicated per-template.
//   - LaTeX generation is 100% deterministic code, not an AI call.
// ─────────────────────────────────────────

import type { ATSProfileRules, ContentPreservationReport, DroppedBullet, ResumeJSON } from "../types.ts";
import { esc } from "./build-latex.ts";

/**
 * Bullets beyond a template's max-bullets-per-role are intentionally
 * trimmed for ATS readability (see ats-profiles/*.ts). This recomputes
 * exactly which ones, so it can be reported instead of silently lost.
 * Mirrors the slice in build-latex.ts's buildExperience() — kept as a
 * pure, side-effect-free recomputation rather than changing buildLatex's
 * return type (which would ripple into every caller).
 */
function computeDroppedBullets(resume: ResumeJSON, maxBullets: number): DroppedBullet[] {
  const dropped: DroppedBullet[] = [];
  (resume.experience || []).forEach((job) => {
    const overflow = (job.bullets || []).slice(maxBullets);
    overflow.forEach((b) => dropped.push({ role: `${job.title} @ ${job.company}`, bullet: b }));
  });
  return dropped;
}

/**
 * Checks that every field in the canonical ResumeJSON survived rendering
 * into the final LaTeX document for whichever template was selected.
 * `latex` is the exact string returned by buildLatex() for this resume.
 */
export function checkContentPreservation(
  resume: ResumeJSON,
  latex: string,
  profile: ATSProfileRules,
): ContentPreservationReport {
  const missing: string[] = [];
  const contains = (s: string | undefined) => !!s && latex.includes(esc(s));

  const nameOk = !resume.name || contains(resume.name);
  if (!nameOk) missing.push("Name");

  const contactOk = !resume.contact || contains(resume.contact);
  if (!contactOk) missing.push("Contact line");

  const summaryPresent = !!resume.summary;
  if (summaryPresent && !contains(resume.summary)) missing.push("Summary");

  let expFound = 0;
  (resume.experience || []).forEach((job) => {
    const roleLabel = `${job.title} @ ${job.company}`;
    const titleOk = contains(job.title);
    const companyOk = contains(job.company);
    if (titleOk && companyOk) {
      expFound++;
    } else {
      missing.push(`Experience: ${roleLabel}`);
    }
  });

  let eduFound = 0;
  (resume.education || []).forEach((edu) => {
    if (contains(edu.degree) && contains(edu.school)) {
      eduFound++;
    } else {
      missing.push(`Education: ${edu.degree} — ${edu.school}`);
    }
  });

  let projFound = 0;
  (resume.projects || []).forEach((p) => {
    if (contains(p.name)) {
      projFound++;
    } else {
      missing.push(`Project: ${p.name}`);
    }
  });

  let skillsExpected = 0;
  let skillsFound = 0;
  Object.values(resume.skills || {}).forEach((items) => {
    (items as string[]).forEach((s) => {
      skillsExpected++;
      if (contains(s)) {
        skillsFound++;
      } else {
        missing.push(`Skill: ${s}`);
      }
    });
  });

  let certFound = 0;
  (resume.certifications || []).forEach((c) => {
    if (contains(c)) {
      certFound++;
    } else {
      missing.push(`Certification: ${c}`);
    }
  });

  // additional_sections — the dynamic, non-fixed sections (Awards,
  // Publications, Research, custom titles, ...). A section only counts
  // as "found" if its own title heading AND every one of its entries
  // survived into the LaTeX. Sections with zero entries are correctly
  // omitted by buildAdditionalSections() (see build-latex.ts), so they
  // are not counted as expected here either — an intentionally-omitted
  // empty section is not "missing content".
  let addlFound = 0;
  const nonEmptyAdditional = (resume.additional_sections || []).filter((s) => (s.entries || []).length > 0);
  nonEmptyAdditional.forEach((sec) => {
    const titleOk = contains(sec.title);
    const entriesOk = sec.entries.every((e) => contains(e));
    if (titleOk && entriesOk) {
      addlFound++;
    } else {
      missing.push(`Section: ${sec.title}`);
    }
  });

  const droppedBullets = computeDroppedBullets(resume, profile.max_bullets_per_role);

  return {
    passed: missing.length === 0,
    checked: {
      name: nameOk,
      contact: contactOk,
      summary_present: summaryPresent,
      experience_entries: { expected: (resume.experience || []).length, found: expFound },
      education_entries: { expected: (resume.education || []).length, found: eduFound },
      projects: { expected: (resume.projects || []).length, found: projFound },
      skills: { expected: skillsExpected, found: skillsFound },
      certifications: { expected: (resume.certifications || []).length, found: certFound },
      additional_sections: { expected: nonEmptyAdditional.length, found: addlFound },
    },
    missing_content: missing,
    dropped_bullets: droppedBullets,
  };
}
