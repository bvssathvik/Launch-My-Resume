// ─────────────────────────────────────────
// providers/errors.ts — Normalized AI error types
//
// Every provider adapter (Gemini, Groq) throws ONLY this error type.
// Nothing else in the pipeline needs to know which provider failed or why
// at the HTTP level — it just switches on `.type`.
//
// NEVER put an API key, Authorization header value, or raw provider
// response body into an AIError message — these messages can reach the
// frontend and server logs.
// ─────────────────────────────────────────

export type AIErrorType =
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_SERVER_ERROR"
  | "PROVIDER_UNAVAILABLE" // key not configured for this provider
  | "INVALID_AI_RESPONSE" // malformed / empty completion body
  | "VALIDATION_ERROR" // completion parsed but failed schema validation
  | "INTERNAL_ERROR";

export class AIError extends Error {
  type: AIErrorType;
  retryAfterMs?: number;
  provider?: "gemini" | "groq";

  constructor(type: AIErrorType, message: string, retryAfterMs?: number, provider?: "gemini" | "groq") {
    super(message);
    this.name = "AIError";
    this.type = type;
    this.retryAfterMs = retryAfterMs;
    this.provider = provider;
  }
}

/** Maps a normalized error type to the HTTP status the client should see. */
export function statusForError(type: AIErrorType): number {
  switch (type) {
    case "PROVIDER_RATE_LIMITED":
      return 429;
    case "VALIDATION_ERROR":
      return 422;
    case "PROVIDER_TIMEOUT":
    case "PROVIDER_SERVER_ERROR":
    case "PROVIDER_UNAVAILABLE":
      return 502;
    case "PROVIDER_AUTH_FAILED":
      return 500;
    default:
      return 500;
  }
}

/** Safe, user-facing message per error type — never echoes provider internals. */
export function userMessageForError(type: AIErrorType, phaseName: string): string {
  switch (type) {
    case "PROVIDER_RATE_LIMITED":
      return `The AI provider rate limit was hit while running "${phaseName}". Please wait a minute and try again.`;
    case "PROVIDER_TIMEOUT":
      return `The AI provider took too long to respond while running "${phaseName}". Please try again.`;
    case "PROVIDER_AUTH_FAILED":
      return `Server configuration error: an AI provider key is invalid or missing. Please contact support.`;
    case "PROVIDER_SERVER_ERROR":
    case "PROVIDER_UNAVAILABLE":
      return `The AI provider is temporarily unavailable while running "${phaseName}". Please try again shortly.`;
    case "INVALID_AI_RESPONSE":
      return `The AI returned an unreadable response while running "${phaseName}". Please try again.`;
    case "VALIDATION_ERROR":
      return `The AI response for "${phaseName}" didn't match the expected format. Please try again.`;
    default:
      return `Something went wrong while running "${phaseName}". Please try again.`;
  }
}
