"""Supabase repositories for articles, publishers, source links, and variables."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Iterable

from supabase import Client, create_client

from lathala.config import DEFAULT_RUNTIME_SETTINGS, PUBLISHER_LOGO_BASE_EXT, RUNTIME_SETTING_TYPES, Settings
from lathala.utils.urls import normalize_url, root_domain

ARTICLE_TAGS = {
    "World",
    "National",
    "Politics",
    "Business",
    "Technology",
    "Health",
    "Sports",
    "Entertainment",
}
AUTHOR_LETTER_RE = re.compile(r"[A-Za-z]")


class ArticleRepository:
    """Read and write application data in Supabase."""

    def __init__(self, settings: Settings) -> None:
        """Initialize the repository with service-role credentials."""
        self.settings = settings
        self._client: Client = create_client(
            settings.supabase_url,
            settings.supabase_service_role_key,
        )

    # ------------------------------------------------------------------
    # Runtime settings
    # ------------------------------------------------------------------
    def get_runtime_settings(self) -> dict[str, Any]:
        """Fetch editable runtime settings from ``variables``."""
        rows = self._client.table("variables").select("key,value").execute().data or []
        values = dict(DEFAULT_RUNTIME_SETTINGS)
        for row in rows:
            key = row.get("key")
            if key in values:
                values[key] = row.get("value")
        return values

    def save_runtime_settings(self, values: dict[str, Any]) -> dict[str, Any]:
        """Persist editable runtime variables and return the saved values.

        Supabase/PostgREST upserts can behave like inserts when a variable row is
        missing. The ``variables`` table has required metadata columns, so each
        row includes that metadata instead of sending only ``key`` and ``value``.
        This keeps Save reliable after a fresh schema install, partial data reset,
        or manual deletion of one variable row.
        """
        rows = [
            {
                "key": key,
                "value": _coerce_setting_value(key, values[key]),
                **_setting_metadata(key),
            }
            for key in sorted(values)
            if key in DEFAULT_RUNTIME_SETTINGS
        ]
        if rows:
            self._client.table("variables").upsert(rows, on_conflict="key").execute()
        return self.get_runtime_settings()

    # ------------------------------------------------------------------
    # Source URLs and publishers
    # ------------------------------------------------------------------
    def list_source_urls(self) -> list[str]:
        """Fetch source URLs from ``sources``."""
        rows = (
            self._client.table("sources")
            .select("url")
            .order("id")
            .execute()
            .data
            or []
        )
        return [row["url"] for row in rows if row.get("url")]

    def list_publishers(self, source_preview_limit: int | None = None) -> list[dict[str, Any]]:
        """Return publishers and source-link previews for the control UI.

        ``source_preview_limit`` keeps the local browser control page light by
        sending only a small source-link preview for each publisher list card.
        ``get_publisher`` still returns the complete source-link list when the
        user opens a publisher for editing.
        """
        publishers = (
            self._client.table("publishers")
            .select("id,name,domain")
            .order("name")
            .execute()
            .data
            or []
        )
        links = (
            self._client.table("sources")
            .select("id,publisher_id,url")
            .order("id")
            .execute()
            .data
            or []
        )

        links_by_publisher: dict[int, list[dict[str, Any]]] = {}
        for link in links:
            publisher_id = link.get("publisher_id")
            if publisher_id is not None:
                links_by_publisher.setdefault(int(publisher_id), []).append(link)

        for publisher in publishers:
            _add_computed_publisher_logo(publisher, self.settings.publisher_logo_base_ext)
            source_links = links_by_publisher.get(int(publisher["id"]), [])
            publisher["source_count"] = len(source_links)
            publisher["sources"] = (
                source_links[:source_preview_limit]
                if source_preview_limit is not None
                else source_links
            )
        return publishers

    def create_publisher(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Create a publisher with one or more source links."""
        name, domain, urls = _clean_publisher_payload(payload)
        row = {"name": name, "domain": domain}
        response = self._client.table("publishers").insert(row).execute()
        publisher = (response.data or [])[0]
        self._replace_source_links(int(publisher["id"]), urls)
        self.assign_publishers_to_articles()
        return self.get_publisher(int(publisher["id"]))

    def update_publisher(self, publisher_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        """Update publisher metadata and replace its source links."""
        name, domain, urls = _clean_publisher_payload(payload)
        self._client.table("publishers").update(
            {"name": name, "domain": domain}
        ).eq("id", publisher_id).execute()
        self._replace_source_links(publisher_id, urls)
        self.assign_publishers_to_articles()
        return self.get_publisher(publisher_id)

    def delete_publisher(self, publisher_id: int) -> None:
        """Delete a publisher and cascade-delete its source links."""
        self._client.table("publishers").delete().eq("id", publisher_id).execute()
        self.assign_publishers_to_articles()

    def get_publisher(self, publisher_id: int) -> dict[str, Any]:
        """Return one publisher with source links."""
        publisher_rows = (
            self._client.table("publishers")
            .select("id,name,domain")
            .eq("id", publisher_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        if not publisher_rows:
            raise ValueError(f"Publisher not found: {publisher_id}")
        link_rows = (
            self._client.table("sources")
            .select("id,publisher_id,url")
            .eq("publisher_id", publisher_id)
            .order("id")
            .execute()
            .data
            or []
        )
        publisher = publisher_rows[0]
        _add_computed_publisher_logo(publisher, self.settings.publisher_logo_base_ext)
        publisher["sources"] = link_rows
        return publisher

    def _replace_source_links(self, publisher_id: int, urls: list[str]) -> None:
        self._client.table("sources").delete().eq("publisher_id", publisher_id).execute()
        if not urls:
            return
        rows = [
            {
                "publisher_id": publisher_id,
                "url": normalize_url(url),
            }
            for url in urls
        ]
        self._client.table("sources").insert(rows).execute()

    # ------------------------------------------------------------------
    # Article pipeline
    # ------------------------------------------------------------------
    def upsert_article_urls(self, urls: Iterable[str]) -> int:
        """Insert discovered article URLs without storing duplicated JSON blobs."""
        unique_urls = sorted({normalize_url(url) for url in urls if normalize_url(url)})
        if not unique_urls:
            return 0

        rows = [{"url": url} for url in unique_urls]
        self._client.table("articles").upsert(rows, on_conflict="url").execute()
        self.assign_publishers_to_articles()
        return len(rows)

    def list_unsummarized_article_urls(self, limit: int) -> list[str]:
        """Fetch article URLs that still need Gemini summaries."""
        rows = (
            self._client.table("articles")
            .select("url")
            .filter("bullets", "eq", "{}")
            .order("url")
            .limit(limit)
            .execute()
            .data
            or []
        )
        return [row["url"] for row in rows if row.get("url")]

    def replace_article_url(self, old_url: str, new_url: str) -> None:
        """Merge a redirected article URL into its canonical/final URL row.

        If the old URL is pending and the final URL already exists, the pending
        duplicate is removed. If the final URL does not exist, the old row is
        renamed to the final URL so the later scrape only targets that final URL.
        If the old row already has data and the final row is empty, that data is
        preserved on the final row before deleting the duplicate.
        """
        old_url = normalize_url(old_url)
        new_url = normalize_url(new_url)
        if not old_url or not new_url or old_url == new_url:
            return

        old_rows = (
            self._client.table("articles")
            .select("*")
            .eq("url", old_url)
            .limit(1)
            .execute()
            .data
            or []
        )
        if not old_rows:
            return

        new_rows = (
            self._client.table("articles")
            .select("*")
            .eq("url", new_url)
            .limit(1)
            .execute()
            .data
            or []
        )

        if not new_rows:
            self._client.table("articles").update({"url": new_url}).eq("url", old_url).execute()
            self.assign_publishers_to_articles()
            return

        old_row = old_rows[0]
        new_row = new_rows[0]
        if _article_has_summary(old_row) and not _article_has_summary(new_row):
            merged_row = {
                "url": new_url,
                "title": old_row.get("title"),
                "author": _clean_author(old_row.get("author")),
                "published_at": old_row.get("published_at"),
                "image_url": old_row.get("image_url"),
                "tag": old_row.get("tag"),
                "bullets": old_row.get("bullets") or [],
            }
            self._client.table("articles").update(merged_row).eq("url", new_url).execute()

        self._client.table("articles").delete().eq("url", old_url).execute()
        self.assign_publishers_to_articles()

    def save_article_data(self, url: str, data: dict[str, Any]) -> bool:
        """Save one cleaned article summary record."""
        return self.save_articles_data([(url, data)]) == 1

    def save_articles_data(self, items: Iterable[tuple[str, dict[str, Any]]]) -> int:
        """Save many article summaries in one Supabase upsert.

        Batching removes one network round-trip and one publisher-assignment RPC
        per article, which matters when a summarize run handles many rows.
        """
        rows = [
            row
            for url, data in items
            if (row := _article_summary_row(url, data)) is not None
        ]
        if not rows:
            return 0

        self._client.table("articles").upsert(rows, on_conflict="url").execute()
        self.normalize_article_authors()
        self.assign_publishers_to_articles()
        return len(rows)

    def delete_article_url(self, url: str) -> None:
        """Delete one invalid article URL row from Supabase."""
        normalized = normalize_url(url)
        if not normalized:
            return
        self._client.table("articles").delete().eq("url", normalized).execute()

    def assign_publishers_to_articles(self) -> None:
        """Match article URLs to publisher domains and source-link URL domains in SQL."""
        try:
            self._client.rpc("assign_article_publishers").execute()
        except Exception:
            # This should exist after schema.sql is applied, but do not break
            # no-save source/article tests when the database is being prepared.
            pass

    def normalize_article_authors(self) -> None:
        """Set article authors without ASCII letters to SQL null."""
        try:
            self._client.rpc("normalize_article_authors").execute()
            return
        except Exception:
            # Older databases may not have the RPC yet; keep a client-side
            # fallback so saved rows are still cleaned after scrape runs.
            pass

        page_size = 1000
        offset = 0
        while True:
            rows = (
                self._client.table("articles")
                .select("url,author")
                .order("url")
                .range(offset, offset + page_size - 1)
                .execute()
                .data
                or []
            )
            if not rows:
                break

            for row in rows:
                url = row.get("url")
                if url and row.get("author") is not None and _clean_author(row.get("author")) is None:
                    self._client.table("articles").update({"author": None}).eq("url", url).execute()

            offset += page_size

    def get_articles_by_tag(self, tag: str | None = None) -> list[dict[str, Any]]:
        """Return public article JSON used by the mobile site."""
        params = {"tag": tag} if tag else {}
        response = self._client.rpc("get_articles_by_tag", params).execute()
        rows = response.data or []
        return [row.get("get_articles_by_tag", row) if isinstance(row, dict) else row for row in rows]


_SETTING_LABELS: dict[str, str] = {
    "GEMINI_MODEL_ID": "Gemini model ID",
    "GEMINI_LINK_BATCH_SIZE": "Gemini link batch size",
    "GEMINI_ARTICLE_BATCH_SIZE": "Gemini article batch size",
    "PUBLISHER_LOGO_BASE_URL": "Publisher logo base URL",
    "PUBLISHER_LOGO_BASE_EXT": "Publisher logo file extension",
    "SCRAPE_CONCURRENCY": "Scrape concurrency",
    "HTTP_CONCURRENCY": "HTTP validation concurrency",
    "SCRAPE_TIMEOUT_SEC": "Scrape timeout seconds",
    "HTTP_TIMEOUT_SEC": "HTTP validation timeout seconds",
    "RENDER_WAIT_MS": "Render wait milliseconds",
    "BATCH_SIZE": "Batch size",
    "REQUEST_DELAY_SEC": "Request delay seconds",
    "MAX_AI_RETRIES": "Max AI retries",
    "RETRY_BACKOFF_SEC": "Retry backoff seconds",
}

_SETTING_DESCRIPTIONS: dict[str, str] = {
    "GEMINI_MODEL_ID": "Model used for link extraction and article summaries.",
    "GEMINI_LINK_BATCH_SIZE": "Number of scraped source pages sent to Gemini in one link-extraction prompt.",
    "GEMINI_ARTICLE_BATCH_SIZE": "Number of scraped article pages sent to Gemini in one summary prompt.",
    "PUBLISHER_LOGO_BASE_URL": "Static folder URL used to build publisher logo paths from domain filenames.",
    "PUBLISHER_LOGO_BASE_EXT": "File extension used for publisher logo filenames, such as webp or png.",
    "SCRAPE_CONCURRENCY": "Number of browser pages loaded at the same time.",
    "HTTP_CONCURRENCY": "Number of URLs validated at the same time before browser scraping.",
    "SCRAPE_TIMEOUT_SEC": "Page navigation timeout.",
    "HTTP_TIMEOUT_SEC": "Timeout for fast HTTP redirect/status validation.",
    "RENDER_WAIT_MS": "Small capped wait after DOMContentLoaded for JavaScript-rendered pages.",
    "BATCH_SIZE": "Unsummarized article rows processed per run.",
    "REQUEST_DELAY_SEC": "Delay between Gemini requests.",
    "MAX_AI_RETRIES": "Maximum retry attempts for AI requests.",
    "RETRY_BACKOFF_SEC": "Base delay before retrying AI requests.",
}


def _setting_metadata(key: str) -> dict[str, str]:
    expected_type = RUNTIME_SETTING_TYPES[key]
    if expected_type is str:
        value_type = "string"
    elif expected_type is int:
        value_type = "integer"
    elif expected_type is float:
        value_type = "number"
    else:
        value_type = "string"

    return {
        "value_type": value_type,
        "label": _SETTING_LABELS.get(key, key.replace("_", " ").title()),
        "description": _SETTING_DESCRIPTIONS.get(key, ""),
    }


def _coerce_setting_value(key: str, value: Any) -> Any:
    default = DEFAULT_RUNTIME_SETTINGS[key]
    expected_type = RUNTIME_SETTING_TYPES[key]
    try:
        if expected_type is int:
            return max(1, int(value))
        if expected_type is float:
            return float(value)
        clean_value = str(value).strip() or default
        if key == "PUBLISHER_LOGO_BASE_URL":
            return clean_value.rstrip("/")
        if key == "PUBLISHER_LOGO_BASE_EXT":
            return clean_value.lstrip(".") or PUBLISHER_LOGO_BASE_EXT
        return clean_value
    except (TypeError, ValueError):
        return default


def _add_computed_publisher_logo(publisher: dict[str, Any], extension: str = PUBLISHER_LOGO_BASE_EXT) -> None:
    """Attach the expected logo filename derived from the publisher domain."""
    domain = root_domain(str(publisher.get("domain") or ""))
    clean_extension = str(extension or PUBLISHER_LOGO_BASE_EXT).strip().lstrip(".")
    publisher["logo_filename"] = f"{domain}.{clean_extension}" if domain else ""


def _clean_publisher_payload(payload: dict[str, Any]) -> tuple[str, str, list[str]]:
    urls = [normalize_url(str(url)) for url in payload.get("source_urls", []) if str(url).strip()]
    urls = sorted(dict.fromkeys(urls))

    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValueError("Publisher name is required.")

    raw_domain = str(payload.get("domain") or "").strip() or (urls[0] if urls else "")
    domain = root_domain(raw_domain)
    if not domain:
        raise ValueError("Publisher domain or at least one source URL is required.")

    return name, domain, urls


def _clean_bullets(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()][:5]


def _clean_author(value: Any) -> str | None:
    author = str(value or "").strip()
    if not AUTHOR_LETTER_RE.search(author):
        return None
    return author


def _article_summary_row(url: str, data: dict[str, Any]) -> dict[str, Any] | None:
    """Build a typed article row from model output, or None when unusable."""
    image_url = str(data.get("image") or "").strip()
    if not image_url:
        return None

    tag = str(data.get("tag") or "").strip()
    if tag not in ARTICLE_TAGS:
        tag = "National"

    return {
        "url": normalize_url(url),
        "title": str(data.get("title") or "").strip(),
        "author": _clean_author(data.get("author")),
        "published_at": _parse_article_datetime(data.get("date")),
        "image_url": image_url,
        "tag": tag,
        "bullets": _clean_bullets(data.get("bullets")),
    }


def _article_has_summary(row: dict[str, Any]) -> bool:
    """Return True when an article row contains useful summary data."""
    bullets = row.get("bullets")
    return isinstance(bullets, list) and any(str(item).strip() for item in bullets)


def _parse_article_datetime(value: Any) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None

    normalized = raw.replace("Z", "+00:00")
    if normalized.endswith("+0800"):
        normalized = normalized[:-5] + "+08:00"

    try:
        return datetime.fromisoformat(normalized).isoformat()
    except ValueError:
        return None
