"""Pass 4 — RAG verification prompt (port of pass4-rag-verify.ts)."""
from __future__ import annotations

import json


def build_pass4_prompt(original_resume: str, generated_resume: dict, web_context: str, linkedin_data: str | None = None) -> str:
    linkedin_section = f"\nLINKEDIN DATA:\n---\n{linkedin_data}\n---" if linkedin_data else ""
    return f"""You are a strict fact-checker and resume verification expert.

Your job is to verify EVERY claim in the generated resume against the original source material.
This is a 2-step verification system — the AI wrote the resume, NOW you must verify it is truthful.

ORIGINAL RESUME (SOURCE OF TRUTH):
---
{original_resume}
---

GENERATED RESUME TO VERIFY:
---
{json.dumps(generated_resume, indent=2)}
---

BACKGROUND CONTEXT (general knowledge about the role/company, from the
model's own training data — NOT a live web search, may be stale or
incomplete. This is supplementary color only. It NEVER overrides the
ORIGINAL RESUME above — the original resume is the only source of truth
for verifying titles, dates, employers, skills, and metrics):
---
{web_context or "No background context available"}
---
{linkedin_section}

VERIFICATION RULES — Check EVERY field:

1. JOBS & DATES
   - Does each job title exist in the original resume? ✅ or ❌
   - Do the dates match the original? ✅ or ❌
   - Was the candidate actually at each company? ✅ or ❌
   {"- Do dates match LinkedIn? ✅ or ❌" if linkedin_data else ""}

2. METRICS & NUMBERS
   - Is the metric mentioned or implied in the original? ✅ or ❌
   - Is the number in a realistic range for this role/industry? ✅ or ❌
   - NEVER allow invented metrics — if not verifiable against the original resume, REMOVE the number/metric entirely and rewrite the bullet using only supported facts. Do not "mark as estimated" — either it's grounded in the original resume or it doesn't appear.

3. SKILLS
   - Is each skill actually mentioned in the original resume? ✅ or ❌
   - Remove any skill NOT in the original resume

4. PROJECTS
   - Does each project exist in the original? ✅ or ❌
   - Are tech stack claims accurate to original? ✅ or ❌

5. EDUCATION
   - Does degree/school match exactly? ✅ or ❌
   - Are dates correct? ✅ or ❌

6. CERTIFICATIONS
   - Are these mentioned in the original? ✅ or ❌

7. ADDITIONAL / CUSTOM SECTIONS (Awards, Publications, Research, Leadership,
   Volunteer Experience, Languages, Interests, or any other section title
   that isn't one of the fields above)
   - Does each "additional_sections" entry exist in the original resume? ✅ or ❌
   - Is the section TITLE still the one from the original resume (don't rename it)? ✅ or ❌
   - NEVER remove a legitimate additional_sections entry just because it's
     unusual or doesn't fit the other categories — verify it the same way
     you'd verify a skill or certification, against the original resume text.

FOR EACH ISSUE FOUND:
- If the claim is clearly invented → REMOVE IT
- If the metric is inflated but the achievement exists → SCALE BACK to realistic
- If a skill is added but not in original → REMOVE IT
- If dates are off → CORRECT to original dates
- If a whole section (experience, projects, additional_sections, etc.) is
  legitimately empty in the original resume, leave it empty/omitted in the
  output — do NOT invent content to fill it, and do NOT treat the empty
  section itself as something to flag or remove other sections over.

Return ONLY valid JSON:
{{
  "resume": {{ ... corrected resume JSON with same structure ... }},
  "claims_checked": 24,
  "claims_verified": 22,
  "trust_score": 91,
  "flags": [
    {{
      "claim": "Reduced costs by 340%",
      "verified": false,
      "source": "original_resume",
      "flag": "Original says 'reduced costs' with no percentage — changed to 'reduced operational costs significantly'"
    }},
    {{
      "claim": "Led team of 50 engineers",
      "verified": false,
      "source": "original_resume",
      "flag": "Original says 'small team' — corrected to 'team of 4-6 engineers'"
    }}
  ],
  "web_context_used": "Brief note on what background/model-knowledge context (not live search) was referenced about the company/role"
}}"""
