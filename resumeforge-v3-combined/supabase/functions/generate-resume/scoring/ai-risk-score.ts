// ─────────────────────────────────────────
// ai-risk-score.ts — AI Detection Risk Scorer
// Checks if resume will be flagged as AI-generated
// Green (safe) / Yellow (review) / Red (likely flagged)
// ─────────────────────────────────────────

import type { AIRiskResult, RiskLevel, ResumeJSON } from "../types.ts";
import { AI_BUZZWORDS } from "../prompts/pass3-humanize.ts";

// Additional AI-tell patterns specific to resumes
const AI_RESUME_PATTERNS = [
  /\b(spearheaded|orchestrated|leveraged|championed|catalyzed)\b/gi,
  /\b(cutting-edge|state-of-the-art|best-in-class|world-class|industry-leading)\b/gi,
  /\b(seamlessly|holistically|strategically|dynamically|proactively)\b/gi,
  /\b(passionate about|dedicated to|committed to|driven by)\b/gi,
  /\b(synerg|paradigm|ecosystem|bandwidth|ideation)\b/gi,
  /\b(thought leader|visionary|innovative|game.changer)\b/gi,
];

// Check if bullets have uniform rhythm (all same length/structure = AI tell)
function detectUniformRhythm(bullets: string[]): boolean {
  if (bullets.length < 3) return false;

  const lengths = bullets.map(b => b.split(" ").length);
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((sum, l) => sum + Math.pow(l - avg, 2), 0) / lengths.length;
  const stdDev = Math.sqrt(variance);

  // If std deviation < 3 words, bullets are too uniform
  return stdDev < 3;
}

// Check for generic phrases that add no value
const GENERIC_PHRASES = [
  "results-driven", "self-starter", "team player", "hard-working",
  "go-getter", "detail-oriented", "fast learner", "quick learner",
  "strong communication", "excellent communication", "multi-tasker",
  "outside the box", "value-add", "move the needle", "deep dive",
];

function checkGenericPhrases(text: string): string[] {
  return GENERIC_PHRASES.filter(p => text.toLowerCase().includes(p.toLowerCase()));
}

// Extract all bullets from resume
function extractAllBullets(resume: ResumeJSON): string[] {
  const bullets: string[] = [];
  resume.experience?.forEach(job => {
    job.bullets?.forEach(b => bullets.push(b));
  });
  resume.projects?.forEach(p => {
    p.bullets?.forEach(b => bullets.push(b));
  });
  return bullets;
}

// Convert resume to flat text
function resumeToText(resume: ResumeJSON): string {
  const parts = [resume.summary || ""];
  resume.experience?.forEach(job => {
    job.bullets?.forEach(b => parts.push(b));
  });
  return parts.join(" ");
}

export function calculateAIRiskScore(resume: ResumeJSON): AIRiskResult {
  const text = resumeToText(resume);
  const bullets = extractAllBullets(resume);

  // 1. Count AI buzzwords found
  const buzzwordsFound: string[] = [];
  AI_BUZZWORDS.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    if (regex.test(text)) buzzwordsFound.push(word);
  });

  AI_RESUME_PATTERNS.forEach(pattern => {
    const matches = text.match(pattern);
    if (matches) buzzwordsFound.push(...matches.map(m => m.toLowerCase()));
  });

  const uniqueBuzzwords = [...new Set(buzzwordsFound)];

  // 2. Check bullet uniformity
  const uniformRhythm = detectUniformRhythm(bullets);

  // 3. Check generic phrases
  const genericPhrases = checkGenericPhrases(text);

  // 4. Calculate risk score (0-100, lower = safer)
  const buzzwordPenalty = Math.min(40, uniqueBuzzwords.length * 5);
  const rhythmPenalty = uniformRhythm ? 25 : 0;
  const genericPenalty = Math.min(20, genericPhrases.length * 5);
  const lengthPenalty = bullets.length > 0 && bullets.every(b => b.split(" ").length > 15) ? 15 : 0;

  const riskScore = Math.min(100, buzzwordPenalty + rhythmPenalty + genericPenalty + lengthPenalty);

  // 5. Determine level
  let level: RiskLevel;
  let recommendation: string;

  if (riskScore <= 20) {
    level = "low";
    recommendation = "Resume reads naturally. Low risk of AI detection. Safe to submit.";
  } else if (riskScore <= 50) {
    level = "medium";
    recommendation = `Review and manually edit: ${uniqueBuzzwords.slice(0, 3).join(", ")}. Vary bullet lengths.`;
  } else {
    level = "high";
    recommendation = `High AI detection risk. Manually rewrite at least 30% of bullets. Remove: ${uniqueBuzzwords.slice(0, 5).join(", ")}.`;
  }

  return {
    score: riskScore,
    level,
    buzzwords_found: uniqueBuzzwords,
    uniform_rhythm: uniformRhythm,
    generic_phrases: genericPhrases,
    recommendation,
  };
}
