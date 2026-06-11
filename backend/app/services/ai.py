"""Claude AI provider layer.

All AI calls in the product go through this module. Three providers:

- "api"        — Anthropic API via the SDK (requires ANTHROPIC_API_KEY)
- "claude_cli" — headless Claude Code (`claude -p`), authenticated with the
                 user's Claude subscription (interactive `claude` login on the
                 host, or a CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`).
                 No API key needed. Note: print mode does not expose
                 temperature/max_tokens, so those hints are ignored here.
- "mock"       — realistic deterministic fallbacks supplied by each caller, so
                 the full product flow works offline.

AI_PROVIDER=auto picks: api if a key is set, else claude_cli if the CLI is on
PATH, else mock. Any provider error falls back to the caller's mock.
"""
import asyncio
import logging
import shutil
import subprocess
from collections.abc import Callable

from app.config import settings

logger = logging.getLogger(__name__)

CLI_TIMEOUT_SECONDS = 180

_sync_client = None
_async_client = None
_cli_path: str | None = None
_cli_checked = False


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


def _find_cli() -> str | None:
    global _cli_path, _cli_checked
    if not _cli_checked:
        _cli_path = shutil.which(settings.CLAUDE_CLI_PATH)
        _cli_checked = True
    return _cli_path


def resolve_provider() -> str:
    configured = settings.AI_PROVIDER.lower()
    if configured in ("api", "claude_cli", "mock"):
        return configured
    # auto
    if settings.ANTHROPIC_API_KEY:
        return "api"
    if _find_cli() is not None:
        return "claude_cli"
    return "mock"


def ai_enabled() -> bool:
    return resolve_provider() != "mock"


def _cli_command(system: str, model: str) -> list[str]:
    # --system-prompt replaces Claude Code's default coding prompt entirely and
    # --disallowedTools "*" strips every tool, leaving pure text inference.
    # The prompt itself is passed on stdin: --disallowedTools is variadic and
    # would swallow a trailing positional argument.
    return [
        _find_cli() or settings.CLAUDE_CLI_PATH,
        "-p",
        "--output-format", "text",
        "--model", model,
        "--system-prompt", system,
        "--disallowedTools", "*",
    ]


def _cli_complete_sync(system: str, user: str, model: str) -> str:
    result = subprocess.run(
        _cli_command(system, model),
        input=user,
        capture_output=True,
        text=True,
        timeout=CLI_TIMEOUT_SECONDS,
    )
    if result.returncode != 0:
        raise RuntimeError(f"claude CLI exited {result.returncode}: {result.stderr.strip()[:500]}")
    output = result.stdout.strip()
    if not output:
        raise RuntimeError("claude CLI returned empty output")
    return output


async def _cli_complete(system: str, user: str, model: str) -> str:
    process = await asyncio.create_subprocess_exec(
        *_cli_command(system, model),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(input=user.encode()), timeout=CLI_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        process.kill()
        raise RuntimeError("claude CLI timed out")
    if process.returncode != 0:
        raise RuntimeError(f"claude CLI exited {process.returncode}: {stderr.decode().strip()[:500]}")
    output = stdout.decode().strip()
    if not output:
        raise RuntimeError("claude CLI returned empty output")
    return output


def complete_sync(
    *,
    system: str,
    user: str,
    model: str | None = None,
    max_tokens: int = 1024,
    temperature: float = 0.7,
    mock: Callable[[], str],
) -> str:
    provider = resolve_provider()
    model = model or settings.ANTHROPIC_SONNET_MODEL
    try:
        if provider == "api":
            client = _get_sync_client()
            response = client.messages.create(
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
            return response.content[0].text.strip()
        if provider == "claude_cli":
            return _cli_complete_sync(system, user, model)
    except Exception:
        logger.exception("AI call failed (provider=%s), using mock fallback", provider)
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
    provider = resolve_provider()
    model = model or settings.ANTHROPIC_SONNET_MODEL
    try:
        if provider == "api":
            client = _get_async_client()
            response = await client.messages.create(
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
            return response.content[0].text.strip()
        if provider == "claude_cli":
            return await _cli_complete(system, user, model)
    except Exception:
        logger.exception("AI call failed (provider=%s), using mock fallback", provider)
    return mock()


def extract_json(text: str) -> str:
    """Strip markdown code fences from a model response that should be JSON."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        if text.endswith("```"):
            text = text[: -3]
    return text.strip()
