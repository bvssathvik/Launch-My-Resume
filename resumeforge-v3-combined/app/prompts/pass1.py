"""Pass 1 — JD keyword extraction prompt (port of pass1-keywords.ts)."""


def build_pass1_prompt(jd: str, target_title: str = "") -> str:
    target_hint = target_title.strip() or "Not provided; infer it from the job description."
    return f"""You are an expert ATS keyword analyst with 15 years of experience in HR tech.

Analyze this job description with extreme precision. Your goal is to extract EVERY keyword, phrase, skill, and requirement that an ATS system will scan for.

JOB DESCRIPTION:
---
{jd}
---

USER-PROVIDED TARGET JOB TITLE:
{target_hint}
Use this exact title for job_title when one was provided.

EXTRACTION RULES:
1. must_have = keywords that appear 3+ times OR are in "Required" / "Must have" sections
2. important = keywords that appear 1-2 times OR are in "Preferred" sections
3. nice_to_have = mentioned once in bonus/plus sections only
4. exact_phrases = multi-word phrases that MUST be used verbatim (e.g. "cross-functional teams", "agile methodology")
5. industry_terms = domain-specific jargon unique to this field
6. action_verbs = specific verbs used in the JD (these signal what they value)
7. Do NOT include generic words like "team player", "motivated", "passionate"
8. DO include specific tools, technologies, frameworks, methodologies, certifications

Return ONLY valid JSON — no markdown, no explanation, no text before or after.
Use exactly the field names shown below. must_have and important MUST always be
arrays of strings (use [] when none apply), never null or a single string:
{{
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
}}"""
