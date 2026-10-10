// ─────────────────────────────────────────
// workday.ts — Workday ATS Profile
// Workday is the strictest major ATS
// Title match is weighted very heavily
// ─────────────────────────────────────────

import type { ATSProfileRules } from "../types.ts";

export const workdayProfile: ATSProfileRules = {
  name: "Workday",
  section_order: [
    "Professional Summary",
    "Work Experience",
    "Education",
    "Skills",
    "Certifications",
  ],
  title_weight: 0.40,           // 40% of score from job title match
  skills_position: "bottom",
  max_bullets_per_role: 5,
  prefer_docx: true,            // Workday parses DOCX more reliably
  extra_conservative: true,     // No creative formatting whatsoever
  notes: `
    Workday rules:
    - Job title in your resume MUST closely match the job posting title
    - Use "Work Experience" not "Experience" or "Professional Experience"
    - Dates must be in "MM/YYYY" or "Month YYYY" format — no ranges like "2020-22"
    - Education section MUST include full degree name and graduation year
    - Skills section: simple comma-separated list, no categories/headers inside
    - No tables, no text boxes, no columns — single column ONLY
    - Avoid headers/footers (Workday parser ignores them)
    - File size under 100KB preferred
  `.trim(),
};

// Workday-specific LaTeX overrides
export const workdayLatexRules = {
  skillsFormat: "flat_comma_list",    // No subcategories inside skills
  dateFormat: "Month YYYY",
  maxPageLength: 2,
  headerStyle: "centered_minimal",
  useHrLines: true,
};
