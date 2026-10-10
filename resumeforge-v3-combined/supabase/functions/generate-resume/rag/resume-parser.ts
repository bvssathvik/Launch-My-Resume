// ─────────────────────────────────────────
// resume-parser.ts — Original Resume Parser
// Extracts structured facts from raw resume text
// This becomes the SOURCE OF TRUTH for RAG verification
// ─────────────────────────────────────────

export interface ParsedResumeFacts {
  companies: string[];
  job_titles: string[];
  date_ranges: string[];
  skills_mentioned: string[];
  metrics_mentioned: string[];
  projects: string[];
  certifications: string[];
  education: string[];
  raw_bullets: string[];
}

// Extract structured facts from raw resume text
export function parseResumeFacts(rawResume: string): ParsedResumeFacts {
  const lines = rawResume.split("\n").map(l => l.trim()).filter(Boolean);

  const facts: ParsedResumeFacts = {
    companies: [],
    job_titles: [],
    date_ranges: [],
    skills_mentioned: [],
    metrics_mentioned: [],
    projects: [],
    certifications: [],
    education: [],
    raw_bullets: [],
  };

  // Extract date ranges (e.g. "Jan 2020 – Mar 2023", "2019-2022", "2020 - Present")
  const dateRegex = /(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)?\s*\d{4}\s*[-–—]\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)?\s*(?:\d{4}|Present|present|Current|current))/gi;
  const dateMatches = rawResume.match(dateRegex) || [];
  facts.date_ranges = [...new Set(dateMatches)];

  // Extract metrics (numbers with %, $, K, M, users, etc.)
  const metricRegex = /(\d+[\.,]?\d*\s*(?:%|percent|K|M|B|\$|USD|users|customers|requests|ms|seconds|hours|days|weeks|engineers|developers|team members|employees|clients|projects|APIs|services|repos|deployments))/gi;
  const metricMatches = rawResume.match(metricRegex) || [];
  facts.metrics_mentioned = [...new Set(metricMatches)];

  // Extract bullet points (lines starting with -, •, *, or numbers)
  const bulletRegex = /^[-•*▸►]\s+.+|^\d+[\.\)]\s+.+/;
  lines.forEach(line => {
    if (bulletRegex.test(line)) {
      facts.raw_bullets.push(line.replace(/^[-•*▸►\d\.\)]\s+/, ""));
    }
  });

  // Extract certification indicators
  const certKeywords = ["certified", "certification", "certificate", "aws", "google cloud", "azure", "pmp", "cpa", "cfa", "ielts", "toefl"];
  lines.forEach(line => {
    const lower = line.toLowerCase();
    if (certKeywords.some(k => lower.includes(k))) {
      facts.certifications.push(line);
    }
  });

  // Extract education indicators
  const eduKeywords = ["bachelor", "master", "phd", "b.tech", "m.tech", "b.sc", "m.sc", "mba", "university", "college", "institute", "degree"];
  lines.forEach(line => {
    const lower = line.toLowerCase();
    if (eduKeywords.some(k => lower.includes(k))) {
      facts.education.push(line);
    }
  });

  // Extract project indicators
  const projKeywords = ["project", "built", "developed", "created", "designed", "implemented", "github.com", "app:", "platform:", "system:"];
  lines.forEach(line => {
    const lower = line.toLowerCase();
    if (projKeywords.some(k => lower.includes(k)) && line.length > 20) {
      facts.projects.push(line);
    }
  });

  return facts;
}

// Build a verification context string for the RAG prompt
export function buildVerificationContext(facts: ParsedResumeFacts): string {
  return `
VERIFIED FACTS FROM ORIGINAL RESUME:
- Date ranges found: ${facts.date_ranges.join(", ") || "none"}
- Metrics actually mentioned: ${facts.metrics_mentioned.join(", ") || "none"}
- Certifications: ${facts.certifications.join(" | ") || "none"}
- Education lines: ${facts.education.join(" | ") || "none"}
- Projects mentioned: ${facts.projects.slice(0, 5).join(" | ") || "none"}
- Total bullet points in original: ${facts.raw_bullets.length}
`.trim();
}
