// ─────────────────────────────────────────
// pass1-keywords.ts — JD Keyword Extraction
// PASS 1 of 4
// Goal: Extract and rank every keyword from the job description
// ─────────────────────────────────────────

export function buildPass1Prompt(jd: string): string {
  return `You are an expert ATS keyword analyst with 15 years of experience in HR tech.

Analyze this job description with extreme precision. Your goal is to extract EVERY keyword, phrase, skill, and requirement that an ATS system will scan for.

JOB DESCRIPTION:
---
${jd}
---

EXTRACTION RULES:
1. must_have = keywords that appear 3+ times OR are in "Required" / "Must have" sections
2. important = keywords that appear 1-2 times OR are in "Preferred" sections
3. nice_to_have = mentioned once in bonus/plus sections only
4. exact_phrases = multi-word phrases that MUST be used verbatim (e.g. "cross-functional teams", "agile methodology")
5. industry_terms = domain-specific jargon unique to this field
6. action_verbs = specific verbs used in the JD (these signal what they value)
7. Do NOT include generic words like "team player", "motivated", "passionate"
8. DO include specific tools, technologies, frameworks, methodologies, certifications

Return ONLY valid JSON — no markdown, no explanation, no text before or after:
{
  "job_title": "exact job title as written in the posting",
  "company": "company name if mentioned, else null",
  "must_have": [
    "skill or keyword that is absolutely required"
  ],
  "important": [
    "skill or keyword that is preferred but not mandatory"
  ],
  "nice_to_have": [
    "mentioned as a bonus or plus"
  ],
  "exact_phrases": [
    "multi-word phrases to use word-for-word"
  ],
  "required_years": "e.g. '3+ years' or null if not specified",
  "education_required": "e.g. 'Bachelor in CS' or null",
  "industry_terms": [
    "domain-specific technical terms"
  ],
  "action_verbs": [
    "verbs from the JD that signal what they value"
  ]
}`;
}
