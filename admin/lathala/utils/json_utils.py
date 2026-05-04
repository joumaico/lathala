"""JSON extraction helpers for LLM responses."""

from __future__ import annotations

import json
from typing import Any, TypeVar

from jsonfinder import jsonfinder

T = TypeVar("T")


def parse_first_json(text: str, fallback: T | None = None) -> Any | T | None:
    """Parse the first JSON object or array found in text.

    Args:
        text: Raw text that may contain JSON.
        fallback: Value returned when parsing fails.

    Returns:
        Parsed JSON object, parsed JSON list, or the fallback value.
    """
    cleaned = _strip_markdown_fences(text).strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    for _, _, obj in jsonfinder(cleaned):
        if isinstance(obj, (dict, list)):
            return obj

    return fallback


def _strip_markdown_fences(text: str) -> str:
    """Remove common Markdown code fences around JSON responses.

    Args:
        text: Raw model response.

    Returns:
        Text without leading and trailing Markdown fences.
    """
    value = text.strip()
    if not value.startswith("```"):
        return text

    lines = value.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines)
