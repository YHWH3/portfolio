"""Anthropic Claude client wrapper.

All AI calls in the product go through this module. When ANTHROPIC_API_KEY is
not configured (local development), each call falls back to the caller-supplied
mock function, which returns realistic data so the full product flow works
offline.
"""
import logging
from collections.abc import Callable

from app.config import settings

logger = logging.getLogger(__name__)

_sync_client = None
_async_client = None


def _get_sync_client():
    global _sync_client
    if _sync_client is None and settings.ANTHROPIC_API_KEY:
        from anthropic import Anthropic

        _sync_client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _sync_client


def _get_async_client():
    global _async_client
    if _async_client is None and settings.ANTHROPIC_API_KEY:
        from anthropic import AsyncAnthropic

        _async_client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _async_client


def ai_enabled() -> bool:
    return bool(settings.ANTHROPIC_API_KEY)


def complete_sync(
    *,
    system: str,
    user: str,
    model: str | None = None,
    max_tokens: int = 1024,
    temperature: float = 0.7,
    mock: Callable[[], str],
) -> str:
    client = _get_sync_client()
    if client is None:
        return mock()
    try:
        response = client.messages.create(
            model=model or settings.ANTHROPIC_SONNET_MODEL,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return response.content[0].text.strip()
    except Exception:
        logger.exception("Anthropic call failed, using mock fallback")
        return mock()


async def complete(
    *,
    system: str,
    user: str,
    model: str | None = None,
    max_tokens: int = 1024,
    temperature: float = 0.7,
    mock: Callable[[], str],
) -> str:
    client = _get_async_client()
    if client is None:
        return mock()
    try:
        response = await client.messages.create(
            model=model or settings.ANTHROPIC_SONNET_MODEL,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return response.content[0].text.strip()
    except Exception:
        logger.exception("Anthropic call failed, using mock fallback")
        return mock()


def extract_json(text: str) -> str:
    """Strip markdown code fences from a model response that should be JSON."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        if text.endswith("```"):
            text = text[: -3]
    return text.strip()
