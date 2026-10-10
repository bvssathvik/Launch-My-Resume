"""Shared provider contracts, mirroring providers/ai-provider.ts.

Both providers return the SAME normalized shape and raise the SAME AIError
type on failure — phase logic never branches on which provider it talks to.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable, Optional

ProviderName = str  # "gemini" | "groq"

ALL_PROVIDERS: tuple[str, ...] = ("gemini", "groq")


@dataclass
class ProviderCallOptions:
    prompt: str
    temperature: float
    max_tokens: int
    label: str
    deadline: float  # shared epoch-ms budget for the whole request
    json_mode: bool = False
    model_override: Optional[str] = None


@dataclass
class ProviderCallResult:
    text: str
    provider: ProviderName
    model: str
    duration_ms: int


def ms_left(deadline: float) -> float:
    return max(0.0, deadline - time.time() * 1000)


def ms_now() -> float:
    return time.time() * 1000
