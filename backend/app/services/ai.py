"""
Claude for the guest chat and the host description writer. One async client,
a short timeout, and no exceptions leaking to callers: if the AI is off or
fails, `ask` returns None and the caller shows a plain fallback.
"""
import logging

from app.core.config import settings

log = logging.getLogger(__name__)
_client = None


def enabled() -> bool:
    return bool(settings.CLAUDE_API_KEY)


def _get_client():
    global _client
    if _client is None:
        import anthropic
        _client = anthropic.AsyncAnthropic(api_key=settings.CLAUDE_API_KEY, timeout=25, max_retries=1)
    return _client


async def ask(*, system: str, messages: list[dict], max_tokens: int = 400) -> str | None:
    if not enabled():
        return None
    try:
        resp = await _get_client().messages.create(
            model=settings.CLAUDE_MODEL, max_tokens=max_tokens, system=system, messages=messages,
        )
    except Exception:   # network, rate limit, bad key… never break the page
        log.exception("Claude request failed")
        return None
    text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
    return text or None
