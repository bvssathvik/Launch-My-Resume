// ─────────────────────────────────────────
// fact-checker.ts — RAG Fact Checker
// Cross-checks every claim in generated resume
// against original resume + web context + LinkedIn
// ─────────────────────────────────────────

import type { ResumeJSON, RAGClaim } from "../types.ts";
import type { ParsedResumeFacts } from "./resume-parser.ts";

// Check if a string is mentioned anywhere in the original resume
function existsInOriginal(claim: string, originalResume: string): boolean {
  const claimWords = claim.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const resumeLower = originalResume.toLowerCase();

  // If more than 60% of meaningful words exist in original, consider verified
  const found = claimWords.filter(word => resumeLower.includes(word));
  return found.length / claimWords.length >= 0.6;
}

// Check if a metric is realistic
function isMetricRealistic(metric: string): boolean {
  // Extract percentage
  const pctMatch = metric.match(/(\d+)\s*%/);
  if (pctMatch) {
    const pct = parseInt(pctMatch[1]);
    // Percentages over 500% are almost certainly hallucinated
    if (pct > 500) return false;
    // Percentages over 200% are suspicious
    if (pct > 200) return false;
  }

  // Extract dollar amounts (billions are suspicious for most roles)
  const billionMatch = metric.match(/\$(\d+)\s*[Bb]illion/);
  if (billionMatch && parseInt(billionMatch[1]) > 1) return false;

  return true;
}

// Check if a skill exists in the original resume
function skillInOriginal(skill: string, originalResume: string): boolean {
  return originalResume.toLowerCase().includes(skill.toLowerCase());
}

// Main fact checking function
export function checkFacts(
  generated: ResumeJSON,
  originalResume: string,
  facts: ParsedResumeFacts,
  linkedinData?: string
): RAGClaim[] {
  const claims: RAGClaim[] = [];

  // Check job titles and companies
  generated.experience?.forEach(job => {
    const titleInOriginal = existsInOriginal(job.title, originalResume);
    claims.push({
      claim: `Job: ${job.title} at ${job.company}`,
      verified: titleInOriginal,
      source: "original_resume",
      flag: titleInOriginal ? undefined : `"${job.title}" at "${job.company}" not clearly found in original resume`,
    });

    // Check date ranges
    const dateInOriginal = facts.date_ranges.some(d =>
      originalResume.includes(job.dates.split("–")[0].trim()) ||
      originalResume.includes(job.dates.split("-")[0].trim())
    );
    claims.push({
      claim: `Dates: ${job.dates} at ${job.company}`,
      verified: dateInOriginal || facts.date_ranges.length === 0,
      source: "original_resume",
      flag: (!dateInOriginal && facts.date_ranges.length > 0)
        ? `Date "${job.dates}" may not match original resume dates`
        : undefined,
    });

    // Check each bullet point
    job.bullets?.forEach(bullet => {
      // Check for unrealistic metrics
      const metricMatch = bullet.match(/(\d+[\.,]?\d*\s*(?:%|percent|K|M|\$))/gi);
      if (metricMatch) {
        metricMatch.forEach(metric => {
          const realistic = isMetricRealistic(metric);
          claims.push({
            claim: `Metric in bullet: "${metric}"`,
            verified: realistic && existsInOriginal(bullet.split(" ").slice(0, 5).join(" "), originalResume),
            source: realistic ? "original_resume" : "unverifiable",
            flag: !realistic ? `Metric "${metric}" may be unrealistic — consider scaling back` : undefined,
          });
        });
      }
    });
  });

  // Check skills
  generated.skills && Object.entries(generated.skills).forEach(([category, skills]) => {
    (skills as string[]).forEach(skill => {
      const inOriginal = skillInOriginal(skill, originalResume);
      if (!inOriginal) {
        claims.push({
          claim: `Skill: ${skill} (${category})`,
          verified: false,
          source: "original_resume",
          flag: `Skill "${skill}" not found in original resume — may have been added by AI`,
        });
      } else {
        claims.push({
          claim: `Skill: ${skill}`,
          verified: true,
          source: "original_resume",
        });
      }
    });
  });

  // Check education
  generated.education?.forEach(edu => {
    const eduInOriginal = existsInOriginal(edu.school, originalResume) ||
                          existsInOriginal(edu.degree, originalResume);
    claims.push({
      claim: `Education: ${edu.degree} at ${edu.school}`,
      verified: eduInOriginal,
      source: "original_resume",
      flag: !eduInOriginal ? `Education entry not found in original resume` : undefined,
    });
  });

  // Check certifications
  generated.certifications?.forEach(cert => {
    const certInOriginal = existsInOriginal(cert.split("|")[0].trim(), originalResume);
    claims.push({
      claim: `Certification: ${cert}`,
      verified: certInOriginal,
      source: "original_resume",
      flag: !certInOriginal ? `Certification not found in original resume` : undefined,
    });
  });

  // LinkedIn cross-check if available
  if (linkedinData) {
    generated.experience?.forEach(job => {
      const liLower = linkedinData.toLowerCase();
      const companyInLI = liLower.includes(job.company.toLowerCase());
      if (!companyInLI) {
        claims.push({
          claim: `LinkedIn: ${job.company}`,
          verified: false,
          source: "linkedin",
          flag: `Company "${job.company}" not found in LinkedIn data — potential mismatch`,
        });
      }
    });
  }

  return claims;
}

// Remove hallucinated skills from generated resume
export function removeHallucinatedSkills(
  resume: ResumeJSON,
  originalResume: string
): ResumeJSON {
  const cleaned = { ...resume };

  if (cleaned.skills) {
    const cleanedSkills: Record<string, string[]> = {};
    Object.entries(cleaned.skills).forEach(([category, skills]) => {
      const verified = (skills as string[]).filter(skill =>
        skillInOriginal(skill, originalResume)
      );
      if (verified.length > 0) {
        cleanedSkills[category] = verified;
      }
    });
    cleaned.skills = cleanedSkills;
  }

  return cleaned;
}
