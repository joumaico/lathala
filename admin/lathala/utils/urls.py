"""URL normalization helpers."""

from __future__ import annotations

from urllib.parse import urldefrag, urlparse, urlunparse

_COMPOUND_PUBLIC_SUFFIXES = {
    "com.ph",
    "net.ph",
    "org.ph",
    "gov.ph",
    "edu.ph",
    "co.uk",
    "org.uk",
    "ac.uk",
    "gov.uk",
    "com.au",
    "net.au",
    "org.au",
    "co.nz",
    "com.sg",
    "com.my",
    "co.jp",
}


def normalize_url(url: str) -> str:
    """Normalize a URL for duplicate detection."""
    clean_url, _ = urldefrag(url.strip())
    parsed = urlparse(clean_url)

    if not parsed.scheme or not parsed.netloc:
        return clean_url

    return urlunparse(
        (
            parsed.scheme.lower(),
            parsed.netloc.lower(),
            parsed.path.rstrip("/"),
            "",
            parsed.query,
            "",
        )
    )


def root_domain(raw_url: str) -> str:
    """Return the registrable/root domain used to group publisher links.

    Examples:
        https://www.abs-cbn.com/lifestyle -> abs-cbn.com
        https://news.example.com.ph/path -> example.com.ph
    """
    value = raw_url.strip().lower()
    if not value:
        return ""

    parsed = urlparse(value if "://" in value else f"https://{value}")
    host = (parsed.netloc or parsed.path.split("/", 1)[0]).split("@")[-1]
    host = host.split(":", 1)[0].removeprefix("www.").strip(".")
    parts = [part for part in host.split(".") if part]

    if len(parts) <= 2:
        return host

    suffix = ".".join(parts[-2:])
    if suffix in _COMPOUND_PUBLIC_SUFFIXES and len(parts) >= 3:
        return ".".join(parts[-3:])

    return ".".join(parts[-2:])
