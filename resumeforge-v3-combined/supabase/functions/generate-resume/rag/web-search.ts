// ─────────────────────────────────────────
// web-search.ts — Background/Model-Knowledge Context Module
//
// IMPORTANT — THIS IS NOT LIVE WEB SEARCH:
// There is no real search provider wired in here. This module asks an LLM
// to answer from its own training data. Do not describe its output as
// "live web-grounded RAG" anywhere (UI copy, prompts, logs, docs) — it is
// model knowledge/background context only, and like any model output it
// can be stale, incomplete, or wrong. If you need real grounding, wire in
// an actual search API (Tavily, Serper, Bing) and pass its results into
// the prompt yourself.
//
// PRECEDENCE: this context is supplementary color (typical duties, market
// norms) for the writing/verification passes. It must never override or
// supersede facts (titles, dates, employers, skills) stated in the user's
// original resume — the original resume is the sole source of truth for
// verification (see prompts/pass4-rag-verify.ts).
//
// SCHEDULING: runs to completion BEFORE Phase 2 starts (see index.ts), so
// it never overlaps a Phase 1/2/3/4 provider call. Uses the cheap Groq
// model when Groq is configured (keeps this off the Gemini phase budget),
// falling back to Gemini only if Groq isn't configured. Non-fatal: a
// failure here never fails the whole generation job.
// ─────────────────────────────────────────

import { runAIPhase } from "../providers/ai-provider.ts";

function fallbackText(jobTitle: string, company: string | null): string {
  return `No background context available for ${jobTitle}${company ? ` at ${company}` : ""}.`;
}

/**
 * Fetches company/role background context (model knowledge only). Never
 * throws — returns a safe fallback string on any failure so it can never
 * fail the pipeline.
 */
export async function searchRoleContext(
  jobTitle: string,
  company: string | null,
  _unusedKey: string, // retained for call-site compatibility; providers read their own env keys
  label = "background-context",
  deadline: number,
): Promise<string> {
  const questions = [
    company ? `1. What does ${company} do (products/services)?` : null,
    `2. What are the typical responsibilities and required skills for a "${jobTitle}" role?`,
    company ? `3. What is ${company}'s engineering culture and tech stack like, if publicly known?` : null,
    `4. What are realistic salary ranges and achievement metrics for a "${jobTitle}" role?`,
  ].filter(Boolean) as string[];

  const prompt = `Based on what you know, answer each numbered question below in 2-3 sentences each. Keep answers factual and concise — this is background context for a resume-writing tool, not the resume itself. If you don't have reliable information for a question, say so briefly rather than guessing.

${questions.join("\n")}

Answer each question under its own number, in order.`;

  const groqConfigured = !!Deno.env.get("GROQ_API_KEY");
  const defaultProvider = groqConfigured ? "groq" : "gemini";
  const fallbackProvider = groqConfigured ? "gemini" : "groq";

  try {
    const result = await runAIPhase({
      generationId: "background",
      phase: 0,
      name: label,
      prompt,
      temperature: 0.1,
      maxTokens: 600,
      deadline,
      defaultProvider,
      fallbackProvider,
      jsonMode: false,
      modelOverride: defaultProvider === "groq" ? (Deno.env.get("GROQ_CONTEXT_MODEL") || "llama-3.1-8b-instant") : undefined,
      parse: (text: string) => text, // plain text, not JSON — skip JSON parsing
      validate: (v: unknown) => typeof v === "string" && v.trim().length > 0,
    });
    return (result.parsed as string) || fallbackText(jobTitle, company);
  } catch {
    return fallbackText(jobTitle, company);
  }
}
