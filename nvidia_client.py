"""
ModelPilot — NVIDIA NIM transport layer
=======================================

Thin wrapper around the OpenAI Python SDK pointed at NVIDIA's NIM inference
endpoint (https://integrate.api.nvidia.com/v1). This module is pure transport:
which model to call, and at what price, is decided by router.py.

The API key is supplied per request by the caller (never stored globally),
with a server-side fallback configured in config.py.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Iterator

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError,
    BadRequestError,
    NotFoundError,
    OpenAI,
    OpenAIError,
    RateLimitError,
)

NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"

# Neutral system prompt — routing already guarantees model competence per tier.
SYSTEM_PROMPT = (
    "You are a helpful, precise assistant. Answer directly, use clean markdown "
    "formatting, and honor any output constraints the user specifies."
)

DEFAULT_TEMPERATURE = 0.6
DEFAULT_MAX_TOKENS = 1024
# Set request ceiling with generous buffer for long reasoning/generation prompts
DEFAULT_TIMEOUT_SECONDS = 150.0


class NVIDIAAuthError(Exception):
    """The supplied API key was rejected (surfaced as HTTP 401)."""


class NVIDIARequestError(Exception):
    """Any other transport/upstream failure (surfaced as HTTP 502)."""


@dataclass
class GenerationResult:
    text: str
    tokens_in: int
    tokens_out: int


def _estimate_tokens(text: str) -> int:
    """Rough fallback (~4 chars/token) when upstream omits usage stats."""
    return max(1, len(text) // 4)


def _describe_error(exc: Exception) -> tuple[str, bool] | None:
    """Map an OpenAI SDK exception to (user message, is_auth_error)."""
    if isinstance(exc, AuthenticationError):
        return ("Invalid NVIDIA API key. Get one at build.nvidia.com and paste it again.", True)
    if isinstance(exc, NotFoundError):
        return (f"Model is not available on this NIM endpoint.", False)
    if isinstance(exc, BadRequestError):
        return (f"NIM rejected the request: {exc.message}", False)
    if isinstance(exc, RateLimitError):
        return ("Rate limited by NVIDIA NIM — wait a moment and retry.", False)
    if isinstance(exc, APITimeoutError):
        return ("NVIDIA NIM timed out — try a shorter prompt or retry.", False)
    if isinstance(exc, APIConnectionError):
        return ("Could not reach the NVIDIA NIM endpoint. Check your network.", False)
    if isinstance(exc, APIStatusError):
        return (f"NVIDIA NIM returned an error (HTTP {exc.status_code}).", False)
    if isinstance(exc, OpenAIError):
        return (f"Unexpected error talking to NVIDIA NIM: {exc}", False)
    return None


FALLBACK_MODELS = ["meta/llama-3.1-70b-instruct", "openai/gpt-oss-20b"]


def _client(api_key: str, timeout: float) -> OpenAI:
    return OpenAI(base_url=NVIDIA_BASE_URL, api_key=api_key, timeout=timeout)


def generate(
    api_key: str,
    model_id: str,
    prompt: str,
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> GenerationResult:
    """Send one chat completion to NVIDIA NIM and return text + token usage."""
    client = _client(api_key, timeout)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]

    candidate_models = [model_id] + [m for m in FALLBACK_MODELS if m != model_id]
    last_exc: Exception | None = None

    for target_model in candidate_models:
        try:
            completion = client.chat.completions.create(
                model=target_model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=False,
            )
            text = (completion.choices[0].message.content or "").strip() if completion.choices else ""
            usage = getattr(completion, "usage", None)
            tokens_in = usage.prompt_tokens if usage and usage.prompt_tokens else _estimate_tokens(prompt)
            tokens_out = usage.completion_tokens if usage and usage.completion_tokens else _estimate_tokens(text)
            return GenerationResult(text=text, tokens_in=int(tokens_in), tokens_out=int(tokens_out))
        except AuthenticationError as exc:
            raise NVIDIAAuthError("Invalid NVIDIA API key. Check config.py.") from exc
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            print(f"[nvidia_client] Model '{target_model}' failed: {exc}. Trying fallback...")
            continue

    if last_exc:
        mapped = _describe_error(last_exc)
        if mapped:
            message, is_auth = mapped
            raise (NVIDIAAuthError if is_auth else NVIDIARequestError)(message) from last_exc
        raise NVIDIARequestError(f"All models failed: {last_exc}") from last_exc

    raise NVIDIARequestError("No response from NVIDIA NIM.")


def generate_stream(
    api_key: str,
    model_id: str,
    prompt: str,
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> Iterator[dict[str, Any]]:
    """Stream one chat completion as a sequence of event dicts.

    Events yielded:
      {"type": "delta", "text": str}             — incremental output
      {"type": "done",  ...usage + full text...} — terminal success
      {"type": "error", "detail": str}           — terminal failure
    """
    client = _client(api_key, timeout)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]

    started = time.perf_counter()
    candidate_models = [model_id] + [m for m in FALLBACK_MODELS if m != model_id]
    last_exc = None
    stream = None
    active_model = model_id

    for candidate in candidate_models:
        def _create(target: str) -> Iterator[Any]:
            try:
                return client.chat.completions.create(
                    model=target,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    stream=True,
                    stream_options={"include_usage": True},
                )
            except BadRequestError:
                return client.chat.completions.create(
                    model=target,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    stream=True,
                )

        try:
            stream = _create(candidate)
            active_model = candidate
            break
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            print(f"[nvidia_client] Stream Model '{candidate}' failed: {exc}. Trying fallback...")
            continue

    if stream is None:
        mapped = _describe_error(last_exc) if last_exc else None
        yield {"type": "error", "detail": mapped[0] if mapped else f"Failed to reach NVIDIA NIM: {last_exc}"}
        return

    parts: list[str] = []
    tokens_in = 0
    tokens_out = 0
    try:
        for chunk in stream:
            usage = getattr(chunk, "usage", None)
            if usage:
                tokens_in = usage.prompt_tokens or tokens_in
                tokens_out = usage.completion_tokens or tokens_out
            if chunk.choices:
                content = getattr(chunk.choices[0].delta, "content", None)
                if content:
                    parts.append(content)
                    yield {"type": "delta", "text": content}
    except Exception as exc:  # noqa: BLE001 - mapped below
        mapped = _describe_error(exc)
        yield {"type": "error", "detail": mapped[0] if mapped else f"Stream interrupted: {exc}"}
        return

    full_text = "".join(parts).strip()
    if not tokens_in:
        tokens_in = _estimate_tokens(prompt)
    if not tokens_out:
        tokens_out = _estimate_tokens(full_text)
    yield {
        "type": "done",
        "text": full_text,
        "tokens_in": int(tokens_in),
        "tokens_out": int(tokens_out),
        "latency_ms": round((time.perf_counter() - started) * 1000.0, 2),
    }
