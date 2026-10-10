// ─────────────────────────────────────────
// linkedin-check.ts — LinkedIn Consistency Checker
// Flags date/title mismatches between resume and LinkedIn
// Recruiters cross-check this — mismatches = red flag
// ─────────────────────────────────────────

import type { ResumeJSON, LinkedInFlag, ConsistencyResult } from "../types.ts";

// Extract years from a date string
function extractYear(dateStr: string): number | null {
  const match = dateStr.match(/\d{4}/);
  return match ? parseInt(match[0]) : null;
}

// Fuzzy match two strings (for title/company comparison)
function fuzzyMatch(a: string, b: string): boolean {
  const normalize = (s: string) =>
    s.toLowerCase()
     .replace(/[^a-z0-9\s]/g, "")
     .replace(/\s+/g, " ")
     .trim();

  const na = normalize(a);
  const nb = normalize(b);

  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  // Check word overlap (60%+ words match)
  const wordsA = na.split(" ");
  const wordsB = nb.split(" ");
  const common = wordsA.filter(w => wordsB.includes(w) && w.length > 2);
  return common.length / Math.max(wordsA.length, wordsB.length) >= 0.6;
}

// Parse LinkedIn data (user pastes their LinkedIn headline + dates)
// Expected format: "Job Title at Company | Start – End\nJob Title at Company | Start – End"
function parseLinkedInData(linkedinText: string): Array<{
  title: string;
  company: string;
  start: string;
  end: string;
}> {
  const lines = linkedinText.split("\n").map(l => l.trim()).filter(Boolean);
  const entries = [];

  for (const line of lines) {
    // Try to parse "Title at Company | Date – Date"
    const atMatch = line.match(/^(.+?)\s+at\s+(.+?)\s*[|\–\-]\s*(.+)$/i);
    if (atMatch) {
      const dateRange = atMatch[3].split(/\s*[–\-]\s*/);
      entries.push({
        title: atMatch[1].trim(),
        company: atMatch[2].trim(),
        start: dateRange[0]?.trim() || "",
        end: dateRange[1]?.trim() || "Present",
      });
      continue;
    }

    // Try "Title | Company | Date – Date"
    const pipeMatch = line.split("|").map(s => s.trim());
    if (pipeMatch.length >= 3) {
      const dateRange = pipeMatch[2].split(/\s*[–\-]\s*/);
      entries.push({
        title: pipeMatch[0],
        company: pipeMatch[1],
        start: dateRange[0]?.trim() || "",
        end: dateRange[1]?.trim() || "Present",
      });
    }
  }

  return entries;
}

export function checkLinkedInConsistency(
  resume: ResumeJSON,
  linkedinData?: string
): ConsistencyResult {
  if (!linkedinData || !linkedinData.trim()) {
    return { checked: false, flags: [], all_clear: true };
  }

  const liEntries = parseLinkedInData(linkedinData);
  if (liEntries.length === 0) {
    return { checked: false, flags: [], all_clear: true };
  }

  const flags: LinkedInFlag[] = [];

  resume.experience?.forEach(job => {
    // Find matching LinkedIn entry
    const liMatch = liEntries.find(li =>
      fuzzyMatch(li.company, job.company) || fuzzyMatch(li.title, job.title)
    );

    if (!liMatch) return; // No matching entry — can't compare

    // Check title match
    if (!fuzzyMatch(job.title, liMatch.title)) {
      flags.push({
        type: "title_mismatch",
        resume_value: job.title,
        linkedin_value: liMatch.title,
        severity: "warning",
        message: `Job title differs: Resume says "${job.title}" but LinkedIn shows "${liMatch.title}" at ${job.company}`,
      });
    }

    // Check date match (compare years)
    const resumeStartYear = extractYear(job.dates.split(/[–\-]/)[0]);
    const liStartYear = extractYear(liMatch.start);

    if (resumeStartYear && liStartYear && Math.abs(resumeStartYear - liStartYear) > 1) {
      flags.push({
        type: "date_mismatch",
        resume_value: job.dates,
        linkedin_value: `${liMatch.start} – ${liMatch.end}`,
        severity: "critical",
        message: `Start date differs by more than 1 year: Resume says ${resumeStartYear}, LinkedIn shows ${liStartYear} at ${job.company}`,
      });
    }

    // Check company name
    if (!fuzzyMatch(job.company, liMatch.company)) {
      flags.push({
        type: "company_mismatch",
        resume_value: job.company,
        linkedin_value: liMatch.company,
        severity: "warning",
        message: `Company name differs: Resume says "${job.company}", LinkedIn shows "${liMatch.company}"`,
      });
    }
  });

  return {
    checked: true,
    flags,
    all_clear: flags.length === 0,
  };
}
