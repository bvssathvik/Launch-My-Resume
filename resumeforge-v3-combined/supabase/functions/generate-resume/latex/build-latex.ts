// ─────────────────────────────────────────
// build-latex.ts — JSON → LaTeX Converter
// Takes ResumeJSON + format + ATS profile
// Returns complete LaTeX document string
// ─────────────────────────────────────────

import type { ResumeJSON, ResumeFormat, ATSProfileRules } from "../types.ts";
import { modernCvClassicTemplate } from "./templates/ModernCV Classic.ts";
import { minimalCleanTechTemplate } from "./templates/Minimal Clean Tech.ts";
import { faangStyleCompactTemplate } from "./templates/FAANG-Style Compact.ts";
import { boldHeaderModernTemplate } from "./templates/Bold Header Modern.ts";
import { ultraCleanOnePageTemplate } from "./templates/Ultra-Clean One-Page.ts";
import { techFocusedDenseTemplate } from "./templates/Tech-Focused Dense.ts";
import { premiumMinimalistTemplate } from "./templates/Premium Minimalist.ts";
import { structuredExecutiveBriefTemplate } from "./templates/Structured Executive Brief.ts";

// Escape special LaTeX characters
export function esc(s: unknown): string {
  if (!s) return "";
  return String(s)
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/&/g, "\\&")
    .replace(/%/g, "\\%")
    .replace(/\$/g, "\\$")
    .replace(/#/g, "\\#")
    .replace(/_/g, "\\_")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/</g, "\\textless{}")
    .replace(/>/g, "\\textgreater{}")
    .replace(/\|/g, "\\textbar{}")
    .replace(/"/g, "''")
    // Normalize Unicode punctuation after escaping so inserted LaTeX macros
    // are not escaped as literal text.
    .replace(/[\u2010\u2011\u2012\u2212]/g, "-")
    .replace(/\u2013/g, "--")
    .replace(/\u2014/g, "---")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, "''")
    .replace(/\u2026/g, "\\ldots{}")
    .replace(/[\u2022\u25CF]/g, "\\textbullet{}")
    .replace(/\u00A0/g, " ");
}

// Build header section
function buildHeader(resume: ResumeJSON): string {
  return `\\begin{center}
  {\\LARGE\\bfseries ${esc(resume.name)}}\\\\[5pt]
  {\\small ${esc(resume.contact)}}
\\end{center}
\\vspace{2pt}`;
}

// Build experience section
// NOTE: a role with no bullets renders WITHOUT an \itemize block at all —
// it used to insert a placeholder "No details provided" bullet, which is
// exactly the kind of fabricated filler the content rules forbid (there's
// nothing wrong with a role entry that's just title/company/dates; that's
// truthful, not empty).
function buildExperience(resume: ResumeJSON, maxBullets: number): string {
  return (resume.experience || []).map(job => {
    const bullets = (job.bullets || []).slice(0, maxBullets);
    const itemizeBlock = bullets.length
      ? `\n\\begin{itemize}\n${bullets.map(b => `  \\item ${esc(b)}`).join("\n")}\n\\end{itemize}`
      : "";
    return `\\noindent\\textbf{${esc(job.title)}} \\hfill {\\small\\textit{${esc(job.dates)}}}\\\\
\\textit{${esc(job.company)}} $\\cdot$ {\\small ${esc(job.location)}}${itemizeBlock}\\vspace{1pt}`;
  }).join("\n");
}

// Build education section
function buildEducation(resume: ResumeJSON): string {
  return (resume.education || []).map(edu => {
    const detailsLine = edu.details ? `\\\\{\\small ${esc(edu.details)}}` : "";
    return `\\noindent\\textbf{${esc(edu.degree)}} \\hfill {\\small\\textit{${esc(edu.dates)}}}\\\\
\\textit{${esc(edu.school)}} $\\cdot$ {\\small ${esc(edu.location)}}${detailsLine}\\vspace{2pt}`;
  }).join("\n");
}

// Build skills section — respects ATS profile format
function buildSkills(resume: ResumeJSON, profile: ATSProfileRules): string {
  const skills = resume.skills || {};

  if (profile.extra_conservative || profile.name === "Workday") {
    // Flat comma-separated list for maximum ATS safety
    const allSkills = Object.values(skills).flat() as string[];
    return `\\noindent ${allSkills.map(esc).join(", ")}`;
  }

  // Categorized format. NOTE: categories are joined with a BLANK line
  // (i.e. a LaTeX paragraph break), not a single "\n". A single newline
  // is not a line break in LaTeX — it's still the same paragraph — so a
  // prior version of this joined every category onto one continuous,
  // hard-to-read line (confirmed visually while compile-testing the new
  // templates). A blank line is also safer than a trailing "\\" here,
  // which can throw "There's no line here to end" if a category ever
  // ends up empty or immediately precedes certain constructs.
  return Object.entries(skills)
    .map(([cat, items]) =>
      `\\noindent\\textbf{${esc(cat)}:} ${(items as string[]).map(esc).join(", ")}`
    ).join("\n\n");
}

// Build projects section
function buildProjects(resume: ResumeJSON): string {
  if (!resume.projects?.length) return "";

  return resume.projects.map(p => {
    const bullets = (p.bullets || []);
    const itemizeBlock = bullets.length
      ? `\n\\begin{itemize}\n${bullets.map(b => `  \\item ${esc(b)}`).join("\n")}\n\\end{itemize}`
      : "";
    const link = p.link ? ` \\hfill {\\small\\url{${esc(p.link)}}}` : "";

    return `\\noindent\\textbf{${esc(p.name)}}${link}\\\\
{\\small\\textit{${esc(p.tech)}}}${itemizeBlock}\\vspace{1pt}`;
  }).join("\n");
}

// Build certifications section
function buildCertifications(resume: ResumeJSON): string {
  if (!resume.certifications?.length) return "";

  const items = resume.certifications
    .map(c => `  \\item ${esc(c)}`)
    .join("\n");

  return `\\begin{itemize}\n${items}\n\\end{itemize}\n`;
}

// Build any sections that don't map to one of the named fields above
// (Awards, Publications, Research, Leadership, Volunteer Experience,
// Languages, Interests, or any fully custom title the original resume
// used). Each renders as a plain \section using the section's OWN
// title — never renamed — with its entries as a bullet list. A section
// with no entries is skipped entirely rather than rendered as an empty
// heading (see the master prompt's "empty section rule").
function buildAdditionalSections(resume: ResumeJSON): string {
  const sections = resume.additional_sections || [];
  return sections
    .filter(sec => sec.title?.trim() && sec.entries?.length)
    .map(sec => {
      const items = sec.entries.map(e => `  \\item ${esc(e)}`).join("\n");
      return `\\section{${esc(sec.title)}}\n\\begin{itemize}\n${items}\n\\end{itemize}\n`;
    })
    .join("\n");
}

// Main function — build complete LaTeX document
export function buildLatex(
  resume: ResumeJSON,
  format: ResumeFormat,
  profile: ATSProfileRules
): string {
  // Each of these renders to "" when the resume genuinely has nothing for
  // that section (no experience yet, no formal education, etc.) — every
  // template treats an empty string as "omit this section, including its
  // heading" (see each template's conditional `sections.x ? ... : ""`).
  // A resume having fewer sections than another candidate's is normal,
  // not an error — see the template-adaptation master prompt.
  const sections = {
    header: buildHeader(resume),
    summary: esc(resume.summary || ""),
    experience: buildExperience(resume, profile.max_bullets_per_role),
    education: buildEducation(resume),
    skills: (resume.skills && Object.keys(resume.skills).length) ? buildSkills(resume, profile) : "",
    projects: buildProjects(resume) || undefined,
    certifications: buildCertifications(resume) || undefined,
    // Extra sections beyond the named fields (Awards, Publications,
    // Research, Leadership, Languages, custom titles, ...) — every
    // template appends this, already fully rendered with its own
    // \section headings, right before \end{document}.
    additionalSections: buildAdditionalSections(resume) || undefined,
  };

  const aliases: Record<string, ResumeFormat> = {
    "modern cv": "moderncv-classic",
    "moderncv classic": "moderncv-classic",
    "moderncv-classic": "moderncv-classic",
    "executive serif": "moderncv-classic",
    "minimal clean tech": "minimal-clean-tech",
    "minimal-clean-tech": "minimal-clean-tech",
    "faang-style compact": "faang-style-compact",
    "faang style compact": "faang-style-compact",
    "faang-style-compact": "faang-style-compact",
    "bold header modern": "bold-header-modern",
    "bold-header-modern": "bold-header-modern",
    "ultra-clean one-page": "ultra-clean-one-page",
    "ultra clean one page": "ultra-clean-one-page",
    "ultra-clean-one-page": "ultra-clean-one-page",
    "tech-focused dense": "tech-focused-dense",
    "tech focused dense": "tech-focused-dense",
    "tech-focused-dense": "tech-focused-dense",
    "premium minimalist": "premium-minimalist",
    "premium-minimalist": "premium-minimalist",
    "executive": "structured-executive-brief",
    "structured executive brief": "structured-executive-brief",
    "structured-executive-brief": "structured-executive-brief",
  };

  // NOTE: an unrecognized format still falls back (a resume must render in
  // *some* template), but we now log it, so a future naming mismatch
  // shows up in the function logs instead of just looking like "the
  // templates don't work."
  const requestedKey = String(format).trim().toLowerCase();
  const normalizedFormat = aliases[requestedKey];
  if (!normalizedFormat) {
    console.warn(`[build-latex] Unrecognized format "${format}" — falling back to minimal-clean-tech. Check the frontend's TPL_MAP / formatAliases for a mismatch.`);
  }
  const resolvedFormat = normalizedFormat || "minimal-clean-tech";

  switch (resolvedFormat) {
    case "moderncv-classic":           return modernCvClassicTemplate(sections);
    case "minimal-clean-tech":         return minimalCleanTechTemplate(sections);
    case "faang-style-compact":        return faangStyleCompactTemplate(sections);
    case "bold-header-modern":         return boldHeaderModernTemplate(sections);
    case "ultra-clean-one-page":       return ultraCleanOnePageTemplate(sections);
    case "tech-focused-dense":         return techFocusedDenseTemplate(sections);
    case "premium-minimalist":         return premiumMinimalistTemplate(sections);
    case "structured-executive-brief": return structuredExecutiveBriefTemplate(sections);

    default:                           return minimalCleanTechTemplate(sections);
  }
}
