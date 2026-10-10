"""Normalized AI error types — direct port of providers/errors.ts.

Every provider adapter throws ONLY AIError. Nothing else in the pipeline
needs to know which provider failed at the HTTP level; it switches on
.error_type. Messages must NEVER contain API keys, headers, or raw provider
bodies — they can reach clients and logs.
"""
from __future__ import annotations

from typing import Optional

RATE_LIMITED = "PROVIDER_RATE_LIMITED"
AUTH_FAILED = "PROVIDER_AUTH_FAILED"
TIMEOUT = "PROVIDER_TIMEOUT"
SERVER_ERROR = "PROVIDER_SERVER_ERROR"
UNAVAILABLE = "PROVIDER_UNAVAILABLE"  # key not configured for this provider
INVALID_RESPONSE = "INVALID_AI_RESPONSE"  # malformed / empty completion body
VALIDATION = "VALIDATION_ERROR"  # parsed but failed schema validation
INTERNAL = "INTERNAL_ERROR"
CONTENT_FILTERED = "CONTENT_FILTERED"  # safety filter / moderation refusal

ALL_ERROR_TYPES = (
    RATE_LIMITED, AUTH_FAILED, TIMEOUT, SERVER_ERROR,
    UNAVAILABLE, INVALID_RESPONSE, VALIDATION, INTERNAL,
    CONTENT_FILTERED,
)


class AIError(Exception):
    def __init__(
        self,
        error_type: str,
        message: str,
        retry_after_ms: Optional[int] = None,
        provider: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.error_type = error_type
        self.message = message
        self.retry_after_ms = retry_after_ms
        self.provider = provider


class JobInProgressError(Exception):
    """Another request is already processing this generation_id."""


class InputValidationError(Exception):
    """Client-supplied input failed a business rule (min length, template)."""


class ServerConfigError(Exception):
    """Server misconfiguration (e.g. no AI provider configured)."""


def status_for_error(error_type: str) -> int:
    if error_type == RATE_LIMITED:
        return 429
    if error_type in (VALIDATION, CONTENT_FILTERED):
        return 422
    if error_type in (TIMEOUT, SERVER_ERROR, UNAVAILABLE):
        return 502
    if error_type == AUTH_FAILED:
        return 500
    return 500


def user_message_for_error(error_type: str, phase_name: str) -> str:
    if error_type == CONTENT_FILTERED:
        return f'The input content was flagged by AI safety moderation while running "{phase_name}". Please check the resume or job description for sensitive or prohibited terms and try again.'
    if error_type == RATE_LIMITED:
        return f'The AI provider rate limit was hit while running "{phase_name}". Please wait a minute and try again.'
    if error_type == TIMEOUT:
        return f'The AI provider took too long to respond while running "{phase_name}". Please try again.'
    if error_type == AUTH_FAILED:
        return "Server configuration error: an AI provider key is invalid or missing. Please contact support."
    if error_type in (SERVER_ERROR, UNAVAILABLE):
        return f'The AI provider is temporarily unavailable while running "{phase_name}". Please try again shortly.'
    if error_type == INVALID_RESPONSE:
        return f'The AI returned an unreadable response while running "{phase_name}". Please try again.'
    if error_type == VALIDATION:
        return f'The AI response for "{phase_name}" didn\'t match the expected format. Please try again.'
    return f'Something went wrong while running "{phase_name}". Please try again.'
