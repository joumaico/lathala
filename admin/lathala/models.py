"""Shared data models used by the application."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

ScrapeStatus = Literal["pending", "ok", "timeout", "error"]


@dataclass(frozen=True)
class RedirectResult:
    """Final URL discovered after loading a requested URL.

    Attributes:
        url: URL that was requested.
        final_url: Browser URL after redirects. Empty when resolving fails.
        status: Resolve result status.
        status_code: Final main-document HTTP status when available.
        error: Optional error details when resolving fails.
    """

    url: str
    final_url: str = ""
    status: ScrapeStatus = "pending"
    status_code: int | None = None
    error: str = ""


@dataclass(frozen=True)
class ScrapeResult:
    """Result produced after loading a URL with Playwright.

    Attributes:
        url: Source URL that was requested.
        html: Page HTML after cleanup.
        status: Load result status.
        final_url: Browser URL after redirects. Empty when it matches ``url``
            or when the request fails before a final URL is known.
        status_code: Final main-document HTTP status when available.
        error: Optional error details when the request fails.
    """

    url: str
    html: str = ""
    status: ScrapeStatus = "pending"
    final_url: str = ""
    status_code: int | None = None
    error: str = ""


ArticleData = dict[str, Any]
