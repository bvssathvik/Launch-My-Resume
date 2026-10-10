import type { ATSProfileRules } from "../types.ts";

export const leverProfile: ATSProfileRules = {
  name: "Lever",
  section_order: [
    "Professional Summary",
    "Work Experience",
    "Skills",
    "Projects",
    "Education",
    "Certifications",
  ],
  title_weight: 0.20,
  skills_position: "bottom",
  max_bullets_per_role: 6,
  prefer_docx: false,
  extra_conservative: false,
  notes: `
    Lever rules:
    - Most modern and flexible of the major ATS platforms
    - Good semantic understanding — context counts
    - Clean PDF parses reliably
    - Balanced weighting between title, skills, and experience
    - Works well with both clean and modern visual layouts
  `.trim(),
};

export const leverLatexRules = {
  skillsFormat: "categorized",
  dateFormat: "Month YYYY",
  maxPageLength: 2,
  headerStyle: "left_aligned",
  useHrLines: false,
};
