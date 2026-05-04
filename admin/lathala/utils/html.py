"""HTML cleanup helpers for smaller LLM prompts."""

from __future__ import annotations

import re

_WHITESPACE_RE = re.compile(r"\s+")


def compact_html(html: str) -> str:
    """Collapse repeated whitespace in HTML before sending it to an LLM.

    Args:
        html: Raw or browser-rendered HTML.

    Returns:
        HTML with repeated whitespace reduced to single spaces.
    """
    return _WHITESPACE_RE.sub(" ", html).strip()
