"""Main news scraping and summarization pipeline."""

from __future__ import annotations

import html as html_lib
import json
import re
from threading import Event
from typing import Any
from urllib.parse import urlparse

from lathala.cli.effects import CliEffects
from lathala.config import Settings
from lathala.models import RedirectResult, ScrapeResult
from lathala.prompts import ARTICLE_PROMPT, LINKS_PROMPT
from lathala.services.cancellation import raise_if_cancelled
from lathala.services.gemini import GeminiService
from lathala.services.repository import ArticleRepository
from lathala.services.scraper import WebKitScraper
from lathala.utils.html import compact_html
from lathala.utils.json_utils import parse_first_json
from lathala.utils.urls import normalize_url


class NewsPipeline:
    """Coordinate scraping, summarization, and database writes."""

    def __init__(
        self,
        settings: Settings,
        repository: ArticleRepository | None = None,
        scraper: WebKitScraper | None = None,
        ai: GeminiService | None = None,
        ui: CliEffects | None = None,
        cancel_event: Event | None = None,
    ) -> None:
        """Initialize the pipeline.

        Args:
            settings: Application settings.
            repository: Optional repository instance for testing or customization.
            scraper: Optional scraper instance for testing or customization.
            ai: Optional Gemini service for testing or customization.
            ui: Optional CLI display helper.
        """
        self.settings = settings
        self.cancel_event = cancel_event
        self.ui = ui or CliEffects()
        self.repository: ArticleRepository | None = repository
        self.scraper = scraper or WebKitScraper(settings, on_status=self.ui.info, cancel_event=cancel_event)
        self.ai = ai or GeminiService(settings, on_retry=self.ui.warning, cancel_event=cancel_event)

    def run(self) -> None:
        """Run the full pipeline."""
        self._raise_if_cancelled()
        self.collect_article_links()
        self._raise_if_cancelled()
        self.summarize_articles(batch_size=self.settings.batch_size)

    def collect_article_links(self) -> int:
        """Scrape source pages, extract article links, and save them.

        Returns:
            Number of unique article URLs saved.
        """
        self._raise_if_cancelled()
        repository = self._repository()
        source_urls = repository.list_source_urls()
        if not source_urls:
            self.ui.warning("No source URLs found in Supabase.")
            return 0

        self.ui.info(f"Found {len(source_urls)} source URL(s).")

        with self.ui.status("Scraping source pages"):
            results = self.scraper.scrape_body_links(source_urls)

        self._report_scrape_failures(results)
        article_urls: set[str] = set()
        ok_results = [result for result in results if result.status == "ok" and result.html]
        link_batch_size = max(1, self.settings.gemini_link_batch_size)

        with self.ui.progress() as progress:
            task_id = progress.add_task("Extracting article links", total=len(ok_results))
            for batch in _chunks(ok_results, link_batch_size):
                self._raise_if_cancelled()
                urls = self._extract_links_batch(batch)
                article_urls.update(urls)
                for result in batch:
                    progress.advance(task_id, f"Extracted links from {result.url}")

        self._raise_if_cancelled()
        with self.ui.status("Resolving and validating article URLs"):
            article_urls = set(self._resolve_article_redirects(sorted(article_urls)))

        self._raise_if_cancelled()
        saved_count = repository.upsert_article_urls(article_urls)
        repository.normalize_article_authors()
        self.ui.success(f"Saved {saved_count} unique article URL(s).")
        return saved_count

    def summarize_articles(self, batch_size: int) -> int:
        """Summarize unsummarized article rows until no rows remain.

        Args:
            batch_size: Number of article rows fetched and scraped at a time.

        Returns:
            Number of articles successfully summarized and saved.
        """
        self._raise_if_cancelled()
        repository = self._repository()
        saved_count = 0
        seen_database_urls: set[str] = set()
        scraped_urls: set[str] = set()
        article_batch_size = max(1, self.settings.gemini_article_batch_size)
        fetch_batch_size = max(1, batch_size)

        while True:
            self._raise_if_cancelled()
            fetch_limit = fetch_batch_size + len(seen_database_urls)
            pending_urls = [
                url
                for url in repository.list_unsummarized_article_urls(limit=fetch_limit)
                if url not in seen_database_urls
            ][:fetch_batch_size]
            if not pending_urls:
                self.ui.success("No new unsummarized articles remain for this run.")
                break

            seen_database_urls.update(pending_urls)
            self._raise_if_cancelled()
            with self.ui.status("Resolving and validating article URLs"):
                resolved_urls = self._resolve_article_redirects(pending_urls, repository=repository)

            article_urls = []
            for resolved_url in resolved_urls:
                if resolved_url in scraped_urls:
                    continue
                article_urls.append(resolved_url)
                scraped_urls.add(resolved_url)

            if not article_urls:
                continue

            self.ui.info(f"Processing {len(article_urls)} article(s).")
            self._raise_if_cancelled()
            with self.ui.status("Scraping article pages"):
                results = self.scraper.scrape(article_urls)

            self._raise_if_cancelled()
            self._report_scrape_failures(results)
            for result in results:
                if result.status == "ok":
                    continue
                if _is_invalid_http_result(result):
                    repository.delete_article_url(_result_url(result))

            ok_results = [result for result in results if result.status == "ok" and result.html]
            with self.ui.progress() as progress:
                task_id = progress.add_task("Summarizing articles", total=len(ok_results))
                for batch in _chunks(ok_results, article_batch_size):
                    self._raise_if_cancelled()
                    summaries = self._summarize_articles_batch(batch)
                    save_items: list[tuple[str, dict[str, Any]]] = []
                    for result in batch:
                        result_url = _result_url(result)
                        data = summaries.get(result_url)
                        if data is not None:
                            if str(data.get("image") or "").strip():
                                save_items.append((result_url, data))
                            else:
                                self.ui.warning(
                                    f"Skipped saving {result_url} because the summary "
                                    "is missing an image URL"
                                )
                        progress.advance(task_id, f"Summarized {result_url}")

                    saved_count += repository.save_articles_data(save_items)

        self._raise_if_cancelled()
        repository.normalize_article_authors()
        self.ui.success(f"Saved {saved_count} article summary record(s).")
        return saved_count

    def extract_article_links_from_source(self, source_url: str) -> list[str]:
        """Extract article links from one source URL without saving anything.

        Args:
            source_url: Source page URL to test.

        Returns:
            Sorted article URLs found on the source page.
        """
        self.ui.info("Test mode: Supabase reads and writes are disabled.")
        self._raise_if_cancelled()

        with self.ui.status("Scraping test source page"):
            results = self.scraper.scrape_body_links([source_url])

        self._report_scrape_failures(results)
        result = results[0] if results else ScrapeResult(url=source_url, status="error")
        if result.status != "ok" or not result.html:
            return []

        return sorted(self._extract_links(result))

    def summarize_article_url(self, article_url: str) -> dict[str, Any] | None:
        """Scrape and summarize one article URL without saving anything.

        Args:
            article_url: Article page URL to test.

        Returns:
            Clean article JSON data, or ``None`` when scraping/summarizing fails.
        """
        self.ui.info("Test mode: Supabase reads and writes are disabled.")
        self._raise_if_cancelled()

        with self.ui.status("Resolving and validating test article URL"):
            resolved_urls = self._resolve_article_redirects([article_url])
        if not resolved_urls:
            return None

        with self.ui.status("Scraping test article page"):
            results = self.scraper.scrape(resolved_urls)

        self._report_scrape_failures(results)
        result = results[0] if results else ScrapeResult(url=article_url, status="error")
        if result.status != "ok" or not result.html:
            return None

        return self._summarize_article_data(result)

    def _repository(self) -> ArticleRepository:
        """Create the Supabase repository only when the normal pipeline needs it."""
        if self.repository is None:
            self.repository = ArticleRepository(self.settings)
        return self.repository

    def _raise_if_cancelled(self) -> None:
        """Stop long-running control jobs at cooperative checkpoints."""
        raise_if_cancelled(self.cancel_event)

    def _report_scrape_failures(self, results: list[ScrapeResult]) -> None:
        """Show warnings for pages that failed to scrape.

        Args:
            results: Scrape results to inspect.
        """
        for result in results:
            if result.status == "ok":
                continue

            detail = f": {result.error}" if result.error else ""
            message = f"Skipped {result.url} because scraping ended with {result.status}{detail}"
            self.ui.warning(message)

    def _resolve_article_redirects(
        self,
        urls: list[str],
        repository: ArticleRepository | None = None,
    ) -> list[str]:
        """Resolve redirects and keep only URLs with a final HTTP 200 response.

        Returns final URLs in input order with duplicates removed. Invalid or
        unverified URLs are skipped instead of being inserted as empty pending
        rows. When an existing database row is proven non-200, it is removed so
        future runs do not keep retrying a dead URL.
        """
        normalized_urls = list(dict.fromkeys(
            normalized
            for url in urls
            if (normalized := normalize_url(url))
        ))
        if not normalized_urls:
            return []

        resolved_urls: list[str] = []
        for result in self.scraper.resolve_redirects(normalized_urls):
            self._raise_if_cancelled()
            original_url = normalize_url(result.url)
            final_url = normalize_url(result.final_url)

            if result.status != "ok" or not final_url:
                detail = f": {result.error}" if result.error else ""
                self.ui.warning(f"Skipped invalid article URL {original_url}{detail}")
                if repository is not None and _is_invalid_http_result(result):
                    repository.delete_article_url(original_url)
                    if final_url and final_url != original_url:
                        repository.delete_article_url(final_url)
                continue

            resolved_urls.append(final_url)
            if final_url != original_url:
                self.ui.info(f"Redirected {original_url} -> {final_url}")
                if repository is not None:
                    repository.replace_article_url(original_url, final_url)

        return list(dict.fromkeys(resolved_urls))

    def _extract_links(self, result: ScrapeResult) -> set[str]:
        """Extract article links from one source page result.

        Args:
            result: Scraped source page.

        Returns:
            Set of normalized article URLs.
        """
        return self._extract_links_batch([result], allow_fallback=False)

    def _extract_links_batch(self, results: list[ScrapeResult], allow_fallback: bool = True) -> set[str]:
        """Extract article links from one Gemini request containing many source pages."""
        if not results:
            return set()

        self._raise_if_cancelled()
        payload = json.dumps(
            [
                {
                    "source_url": result.url,
                    "html": _compact_source_anchor_html(result.html),
                }
                for result in results
            ],
            ensure_ascii=False,
        )
        response = self.ai.generate(f"{LINKS_PROMPT}\n\n{payload}")
        parsed = parse_first_json(response, fallback=None)

        if isinstance(parsed, dict):
            parsed_items: list[Any] = [parsed]
        elif isinstance(parsed, list):
            parsed_items = parsed
        else:
            urls_text = ", ".join(result.url for result in results)
            self.ui.warning(f"Gemini did not return a link list for source batch: {urls_text}")
            if allow_fallback and len(results) > 1:
                return self._extract_links_one_by_one(results)
            return set()

        urls = _clean_link_items(parsed_items)
        return urls

    def _extract_links_one_by_one(self, results: list[ScrapeResult]) -> set[str]:
        """Retry link extraction one source page at a time after batch JSON fails."""
        urls: set[str] = set()
        for result in results:
            self._raise_if_cancelled()
            urls.update(self._extract_links_batch([result], allow_fallback=False))
        return urls

    def _summarize_and_save(self, result: ScrapeResult) -> bool:
        """Summarize one article and save its JSON data.

        Args:
            result: Scraped article page.

        Returns:
            True when data was saved, otherwise False.
        """
        data = self._summarize_article_data(result)
        if data is None:
            return False

        return self._repository().save_article_data(_result_url(result), data)

    def _summarize_article_data(self, result: ScrapeResult) -> dict[str, Any] | None:
        """Summarize one article without saving it.

        Args:
            result: Scraped article page.

        Returns:
            Clean article JSON data, or ``None`` when Gemini output is invalid.
        """
        summaries = self._summarize_articles_batch([result], allow_fallback=False)
        return summaries.get(_result_url(result))

    def _summarize_articles_batch(
        self,
        results: list[ScrapeResult],
        allow_fallback: bool = True,
    ) -> dict[str, dict[str, Any]]:
        """Summarize one Gemini request containing many article pages."""
        if not results:
            return {}

        self._raise_if_cancelled()
        payload = json.dumps(
            [
                {
                    "url": _result_url(result),
                    "html": result.html,
                }
                for result in results
            ],
            ensure_ascii=False,
        )
        response = self.ai.generate(f"{ARTICLE_PROMPT}\n\n{payload}")
        parsed = parse_first_json(response, fallback=None)

        if isinstance(parsed, dict):
            parsed_items: list[Any] = [parsed]
        elif isinstance(parsed, list):
            parsed_items = parsed
        else:
            urls_text = ", ".join(result.url for result in results)
            self.ui.warning(f"Gemini did not return article JSON for batch: {urls_text}")
            if allow_fallback and len(results) > 1:
                return self._summarize_articles_one_by_one(results)
            return {}

        summaries = _match_article_summaries(results, parsed_items)
        if allow_fallback and len(results) > 1 and len(summaries) < len(results):
            missing_results = [
                result
                for result in results
                if _result_url(result) not in summaries
            ]
            self.ui.warning(
                f"Gemini returned {len(summaries)} of {len(results)} article summaries; retrying missing articles individually."
            )
            summaries.update(self._summarize_articles_one_by_one(missing_results))

        return summaries

    def _summarize_articles_one_by_one(self, results: list[ScrapeResult]) -> dict[str, dict[str, Any]]:
        """Retry article summarization one page at a time after batch JSON fails."""
        summaries: dict[str, dict[str, Any]] = {}
        for result in results:
            self._raise_if_cancelled()
            summaries.update(self._summarize_articles_batch([result], allow_fallback=False))
        return summaries


_ANCHOR_RE = re.compile(r'<a\s+[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.IGNORECASE | re.DOTALL)
_STATIC_EXTENSIONS = (
    ".css",
    ".gif",
    ".ico",
    ".jpeg",
    ".jpg",
    ".js",
    ".mp3",
    ".mp4",
    ".pdf",
    ".png",
    ".svg",
    ".webm",
    ".webp",
    ".xml",
    ".zip",
)
_NON_ARTICLE_PATH_PARTS = (
    "/about",
    "/advertise",
    "/author",
    "/authors",
    "/category",
    "/contact",
    "/event",
    "/events",
    "/gallery",
    "/live-tv",
    "/login",
    "/newsletter",
    "/privacy",
    "/profile",
    "/promo",
    "/search",
    "/shows",
    "/signin",
    "/signup",
    "/subscribe",
    "/tag/",
    "/tags/",
    "/terms",
    "/topic/",
    "/topics/",
    "/video",
    "/videos",
    "lotto",
)
_ARTICLE_HINT_RE = re.compile(r"/(?:19|20)\d{2}(?:/|-)|/\d{5,}(?:/|-|$)|-\d{5,}(?:/|$)")
_MAX_LINK_PROMPT_ANCHORS = 250
_MAX_LINK_TEXT_CHARS = 120


def _compact_source_anchor_html(anchor_html: str) -> str:
    """Shrink source-page anchors before Gemini sees them.

    The scraper already returns only body ``<a>`` tags, but source pages can have
    hundreds of duplicated navigation links. This keeps unique, likely article
    URLs and removes obvious nav/static/video/lotto links to reduce tokens and
    link-extraction latency without touching the original prompt.
    """
    anchors: list[str] = []
    seen: set[str] = set()

    for href, raw_text in _ANCHOR_RE.findall(anchor_html or ""):
        normalized = normalize_url(html_lib.unescape(href))
        if normalized in seen or not _is_possible_article_url(normalized):
            continue

        text = compact_html(html_lib.unescape(re.sub(r"<[^>]+>", " ", raw_text)))
        text = text[:_MAX_LINK_TEXT_CHARS].strip()
        anchors.append(
            f'<a href="{html_lib.escape(normalized, quote=True)}">'
            f'{html_lib.escape(text)}</a>'
        )
        seen.add(normalized)

        if len(anchors) >= _MAX_LINK_PROMPT_ANCHORS:
            break

    return " ".join(anchors) if anchors else anchor_html


def _is_possible_article_url(url: str) -> bool:
    """Filter obvious non-article URLs before LLM link extraction."""
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc:
        return False

    path = parsed.path.lower()
    if not path or path == "/":
        return False
    if path.endswith(_STATIC_EXTENSIONS):
        return False
    if any(part in path for part in _NON_ARTICLE_PATH_PARTS):
        return False

    path_parts = [part for part in path.split("/") if part]
    if len(path_parts) < 2:
        return False

    return bool(_ARTICLE_HINT_RE.search(path)) or len(path_parts) >= 3


def _result_url(result: ScrapeResult) -> str:
    """Return the final browser URL for a scrape result when available."""
    return normalize_url(result.final_url or result.url)


def _is_invalid_http_result(result: RedirectResult | ScrapeResult) -> bool:
    """Return True when a URL was reached but did not return HTTP 200."""
    return result.status_code is not None and result.status_code != 200


def _clean_link_items(items: list[Any]) -> set[str]:
    """Normalize link-extraction JSON into a unique URL set."""
    urls: set[str] = set()

    for item in items:
        if isinstance(item, str):
            candidates = [item]
        elif isinstance(item, dict):
            links = item.get("links", [])
            candidates = links if isinstance(links, list) else []
        else:
            candidates = []

        for candidate in candidates:
            if not isinstance(candidate, str):
                continue
            normalized = normalize_url(candidate)
            if normalized.startswith("https://"):
                urls.add(normalized)

    return urls


def _match_article_summaries(
    results: list[ScrapeResult],
    items: list[Any],
) -> dict[str, dict[str, Any]]:
    """Match model article summaries back to their input URLs."""
    summaries: dict[str, dict[str, Any]] = {}
    input_urls = [_result_url(result) for result in results]
    input_url_set = set(input_urls)

    for index, item in enumerate(items):
        if not isinstance(item, dict):
            continue

        item_url = normalize_url(str(item.get("url") or ""))
        if item_url in input_url_set:
            matched_url = item_url
        elif len(results) == 1:
            matched_url = input_urls[0]
        elif index < len(input_urls):
            matched_url = input_urls[index]
        else:
            continue

        summaries[matched_url] = _clean_article_data(item)

    return summaries


def _clean_article_data(data: dict[str, Any]) -> dict[str, Any]:
    """Keep only supported article summary fields.

    Args:
        data: Raw model-generated article summary.

    Returns:
        Clean dictionary suitable for storage in Supabase.
    """
    return {
        "title": data.get("title", ""),
        "author": data.get("author", ""),
        "date": data.get("date", ""),
        "image": data.get("image", ""),
        "tag": data.get("tag", ""),
        "bullets": data.get("bullets", []),
    }


def _chunks(items: list[ScrapeResult], size: int) -> list[list[ScrapeResult]]:
    """Split a list into fixed-size chunks."""
    chunk_size = max(1, size)
    return [items[index:index + chunk_size] for index in range(0, len(items), chunk_size)]
