// ─────────────────────────────────────────
// trust-scorer.ts — RAG Trust Score Calculator
// Calculates what % of resume claims are verified
// ─────────────────────────────────────────

import type { RAGClaim, RAGResult, ResumeJSON } from "../types.ts";

export function calculateTrustScore(
  claims: RAGClaim[],
  resume: ResumeJSON,
  webContext: string
): RAGResult {
  const total = claims.length;
  const verified = claims.filter(c => c.verified).length;
  const trustScore = total > 0 ? Math.round((verified / total) * 100) : 100;

  // Only return flags for unverified claims
  const flags = claims.filter(c => !c.verified && c.flag);

  return {
    resume,
    claims_checked: total,
    claims_verified: verified,
    trust_score: trustScore,
    flags,
    web_context: webContext,
  };
}

// Label the trust score
export function trustLabel(score: number): string {
  if (score >= 90) return "High Trust — almost all claims verified from original resume";
  if (score >= 75) return "Medium Trust — most claims verified, review flagged items";
  return "Low Trust — several claims could not be verified — review carefully before submitting";
}

// Colour for UI
export function trustColor(score: number): "green" | "yellow" | "red" {
  if (score >= 90) return "green";
  if (score >= 75) return "yellow";
  return "red";
}
