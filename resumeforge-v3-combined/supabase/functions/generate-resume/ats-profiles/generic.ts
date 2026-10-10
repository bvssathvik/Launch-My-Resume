import type { ATSProfileRules } from "../types.ts";

export const genericProfile: ATSProfileRules = {
  name: "Generic",
  section_order: [
    "Professional Summary",
    "Work Experience",
    "Education",
    "Skills",
    "Projects",
    "Certifications",
  ],
  title_weight: 0.25,
  skills_position: "bottom",
  max_bullets_per_role: 5,
  prefer_docx: true,           // DOCX safest for unknown ATS
  extra_conservative: true,    // Maximum safety
  notes: `
    Generic / Unknown ATS rules:
    - Use most conservative formatting — plain single column
    - DOCX preferred over PDF for maximum parse compatibility
    - Standard section headers only
    - Simple date formats
    - No design elements whatsoever
    - Safe for: Taleo, iCIMS, BambooHR, ADP, SAP SuccessFactors
  `.trim(),
};

export const genericLatexRules = {
  skillsFormat: "flat_comma_list",
  dateFormat: "Month YYYY",
  maxPageLength: 2,
  headerStyle: "centered_minimal",
  useHrLines: true,
};

// Export all profiles for easy lookup
export { workdayProfile } from "./workday.ts";
export { greenhouseProfile } from "./greenhouse.ts";
export { leverProfile } from "./lever.ts";

import { workdayProfile } from "./workday.ts";
import { greenhouseProfile } from "./greenhouse.ts";
import { leverProfile } from "./lever.ts";
import type { ATSTarget } from "../types.ts";

export function getATSProfile(target: ATSTarget): ATSProfileRules {
  switch (target) {
    case "workday":    return workdayProfile;
    case "greenhouse": return greenhouseProfile;
    case "lever":      return leverProfile;
    default:           return genericProfile;
  }
}
