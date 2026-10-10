import type { ATSProfileRules } from "../types.ts";

export const greenhouseProfile: ATSProfileRules = {
  name: "Greenhouse",
  section_order: [
    "Professional Summary",
    "Skills",
    "Work Experience",
    "Projects",
    "Education",
    "Certifications",
  ],
  title_weight: 0.25,
  skills_position: "after_summary",  // Greenhouse scans Skills first
  max_bullets_per_role: 6,
  prefer_docx: false,                // Greenhouse handles clean PDFs well
  extra_conservative: false,
  notes: `
    Greenhouse rules:
    - Skills section immediately after summary (Greenhouse AI scans this first)
    - Format tolerant — clean PDF or DOCX both work well
    - Greenhouse uses semantic matching — context matters more than exact keywords
    - Structured data (JSON resume) is ideal but plain text PDF works fine
    - More lenient on formatting than Workday
    - Works well with modern single-column layouts
  `.trim(),
};

export const greenhouseLatexRules = {
  skillsFormat: "categorized",
  dateFormat: "Month YYYY",
  maxPageLength: 2,
  headerStyle: "left_aligned",
  useHrLines: true,
};
