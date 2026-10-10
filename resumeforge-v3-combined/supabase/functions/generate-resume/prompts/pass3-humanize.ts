// ─────────────────────────────────────────
// pass3-humanize.ts — De-AI / Humanize Pass
// PASS 3 of 4
// Goal: Strip AI-tell buzzwords, vary rhythm,
//       make it sound like a real human wrote it
// ─────────────────────────────────────────

import type { ResumeJSON } from "../types.ts";

// Words that instantly signal AI generation to recruiters (2026 research)
export const AI_BUZZWORDS = [
  // Stanford flagged AI-tell words
  "realm", "intricate", "showcasing", "pivotal", "embark", "commendable",
  "meticulous", "adept", "ever-evolving", "dynamic", "innovative", "robust",
  "cutting-edge", "state-of-the-art", "seamlessly", "synergy", "leverage",
  "leveraged", "leveraging", "spearheaded", "orchestrated", "championed",
  "architected", "evangelized", "socialized", "ideated", "actioned",
  "upleveled", "supercharged", "revolutionized", "transformed", "disrupted",
  "game-changing", "best-in-class", "world-class", "industry-leading",
  "thought leader", "visionary", "passionate", "dedicated", "driven",
  "results-driven", "self-starter", "go-getter", "team player", "synergize",
  "paradigm", "holistic", "strategic", "impactful", "scalable solutions",
  "mission-critical", "key stakeholder", "cross-pollinate", "bandwidth",
  "circle back", "deep dive", "drill down", "move the needle", "low-hanging fruit",
  "boil the ocean", "bleeding edge", "value-add", "core competency"
];

export function buildPass3Prompt(resumeJSON: ResumeJSON): string {
  return `You are a professional resume editor and human writing coach. Your job is to make this AI-generated resume sound like it was genuinely written by a thoughtful human professional.

CURRENT RESUME JSON:
---
${JSON.stringify(resumeJSON, null, 2)}
---

THE PROBLEM: In 2026, 80% of recruiters can spot AI-written resumes within 20 seconds.
They look for:
1. Overused buzzwords (spearheaded, leveraged, orchestrated, pivotal, realm, seamlessly...)
2. Uniform bullet rhythm (every bullet is exactly the same length and structure)
3. Generic superlatives (world-class, cutting-edge, industry-leading)
4. Perfect polish that no human would write naturally
5. Vague claims without specific, checkable details

YOUR TASK — Fix all 5 problems:

RULE 1 — STRIP THESE WORDS COMPLETELY (replace with plain language):
${AI_BUZZWORDS.join(", ")}

Replace with simple, direct verbs:
- "spearheaded" → "led", "started", "ran"
- "leveraged" → "used", "applied", "built on"
- "orchestrated" → "coordinated", "managed", "ran"
- "pivotal" → "key", "central", "critical"
- "seamlessly" → just remove it
- "robust" → just remove it or be specific
- "innovative" → describe WHAT was innovative specifically

RULE 2 — VARY BULLET RHYTHM:
Do NOT make every bullet: "[Verb] [thing] by [metric]%"
Mix it up:
- Some bullets: start with the outcome ("Cut costs by $50K by...")
- Some bullets: start with the method ("Using Python and AWS Lambda,...")
- Some bullets: be brief (8 words). Some be detailed (20 words).
- Not every bullet needs a percentage — some use absolute numbers, time, users, dollars

RULE 3 — REPLACE GENERIC CLAIMS with specifics:
- "Improved system performance" → "Cut dashboard load time from 4.2s to 0.8s"
- "Led a team" → "Managed 6 backend engineers across 3 time zones"
- "Worked with stakeholders" → "Coordinated weekly with product, design, and 2 enterprise clients"

RULE 4 — SUMMARY must sound human:
- Should read like how a confident professional talks about themselves
- NOT a list of adjectives ("dynamic, results-driven, passionate...")
- YES a specific claim ("I spent 4 years building payment APIs at fintech startups, cutting fraud losses by 23%...")

RULE 5 — VERIFY every claim still exists in the original resume content. Do NOT add new facts.

Return ONLY valid JSON with the SAME structure as input, plus two new fields:
{
  ... (all original fields, now humanized) ...,
  "buzzwords_removed": ["list of AI words you replaced"],
  "changes_made": ["brief description of each major change you made"]
}`;
}
