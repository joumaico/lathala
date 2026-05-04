"""Concurrent URL validator and WebKit page scraper."""

from __future__ import annotations

import asyncio
import html as html_lib
from contextlib import suppress
from html.parser import HTMLParser
from threading import Event
from typing import Any, Awaitable, Callable
from urllib.parse import urljoin, urlparse, urlunparse
from xml.etree import ElementTree

import httpx
from playwright.async_api import (
    Error as PlaywrightError,
    Request,
    Route,
    TimeoutError as PlaywrightTimeoutError,
    async_playwright,
)

from lathala.config import Settings
from lathala.models import RedirectResult, ScrapeResult
from lathala.services.cancellation import raise_if_cancelled
from lathala.utils.html import compact_html
from lathala.utils.urls import normalize_url

StatusCallback = Callable[[str], None]
PageExtractor = Callable[[Any], Awaitable[str]]

_BLOCKED_RESOURCE_TYPES = {"image", "media", "font", "stylesheet"}
_BLOCKED_URL_PARTS = (
    "doubleclick.net",
    "googlesyndication.com",
    "google-analytics.com",
    "googletagmanager.com",
    "facebook.net",
    "hotjar.com",
    "scorecardresearch.com",
    "taboola.com",
    "outbrain.com",
)
_BROWSER_FALLBACK_STATUSES = {401, 403, 408, 409, 425, 429, 500, 502, 503, 504}
_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
_BASE_HEADERS = {
    "User-Agent": _USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml;q=0.9,application/atom+xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Upgrade-Insecure-Requests": "1",
}


class WebKitScraper:
    """Validate URLs quickly with HTTP and load pages concurrently with WebKit."""

    def __init__(
        self,
        settings: Settings,
        on_status: StatusCallback | None = None,
        cancel_event: Event | None = None,
    ) -> None:
        """Initialize the scraper.

        Args:
            settings: Application settings.
            on_status: Optional callback for status messages.
        """
        self._concurrency = settings.scrape_concurrency
        self._http_concurrency = settings.http_concurrency
        self._timeout_ms = settings.scrape_timeout_sec * 1000
        self._http_timeout_sec = settings.http_timeout_sec
        self._render_wait_ms = settings.render_wait_ms
        self._on_status = on_status
        self._cancel_event = cancel_event

    def scrape(self, urls: list[str]) -> list[ScrapeResult]:
        """Synchronously scrape article pages for LLM prompts.

        Args:
            urls: Article URLs to scrape.

        Returns:
            Scrape results in the same order as the input URLs.
        """
        raise_if_cancelled(self._cancel_event)
        return self._scrape_with_extractor(urls, self._extract_prompt_text)

    def scrape_body_links(self, urls: list[str]) -> list[ScrapeResult]:
        """Synchronously scrape source pages as body anchor tags only.

        Fast path: fetch raw HTML with async HTTP and parse ``<body>`` anchors.
        Fallback: use Playwright only for blocked, failed, or JS-rendered pages.

        Args:
            urls: Source page URLs to scrape.

        Returns:
            Scrape results containing only ``<body>`` anchor tags.
        """
        if not urls:
            return []
        raise_if_cancelled(self._cancel_event)
        return asyncio.run(self._scrape_body_links_http_first(urls))

    def resolve_redirects(self, urls: list[str]) -> list[RedirectResult]:
        """Synchronously resolve and validate URLs with fast HTTP first.

        The common case never launches a browser: HTTP follows redirects and
        returns the final URL/status. Browser fallback is used only when a site
        blocks or fails the lightweight HTTP probe.
        """
        if not urls:
            return []
        raise_if_cancelled(self._cancel_event)
        return asyncio.run(self._resolve_all(urls))

    async def _scrape_body_links_http_first(self, urls: list[str]) -> list[ScrapeResult]:
        """Scrape source-page anchors with HTTP first and Playwright fallback."""
        raise_if_cancelled(self._cancel_event)
        request_urls = [url.strip() for url in urls]
        results = await self._scrape_body_links_http(request_urls)
        await self._fill_source_feed_fallbacks(request_urls, results)

        fallback_indices = [
            index
            for index, result in enumerate(results)
            if _needs_source_browser_fallback(result)
        ]
        if not fallback_indices:
            return results

        fallback_urls = [request_urls[index] for index in fallback_indices]
        if self._on_status:
            self._on_status(f"Browser fallback for {len(fallback_urls)} source page(s)")

        browser_results = await self._scrape_all(fallback_urls, self._extract_body_links)
        for index, result in zip(fallback_indices, browser_results):
            results[index] = result

        await self._fill_source_feed_fallbacks(request_urls, results)
        return results

    async def _scrape_body_links_http(self, urls: list[str]) -> list[ScrapeResult]:
        """Fetch source pages with async HTTP and parse body anchors."""
        raise_if_cancelled(self._cancel_event)
        semaphore = asyncio.Semaphore(self._http_concurrency)
        results = [ScrapeResult(url=url) for url in urls]
        timeout = httpx.Timeout(
            connect=self._http_timeout_sec,
            read=self._http_timeout_sec,
            write=self._http_timeout_sec,
            pool=self._http_timeout_sec,
        )
        limits = httpx.Limits(
            max_connections=self._http_concurrency,
            max_keepalive_connections=self._http_concurrency,
        )
        headers = dict(_BASE_HEADERS)

        async with httpx.AsyncClient(
            follow_redirects=True,
            headers=headers,
            timeout=timeout,
            limits=limits,
        ) as client:
            tasks = [
                self._scrape_body_links_one_http(client, semaphore, results, index, url)
                for index, url in enumerate(urls)
            ]
            await asyncio.gather(*tasks)

        return results

    async def _scrape_body_links_one_http(
        self,
        client: httpx.AsyncClient,
        semaphore: asyncio.Semaphore,
        results: list[ScrapeResult],
        index: int,
        url: str,
    ) -> None:
        """Fetch and parse body anchors from one source page with HTTP."""
        async with semaphore:
            raise_if_cancelled(self._cancel_event)
            try:
                if self._on_status:
                    self._on_status(f"Fetching source {url}")

                response = await client.get(url)
                status_code = response.status_code
                final_url = normalize_url(str(response.url))
                if status_code != 200:
                    results[index] = ScrapeResult(
                        url=url,
                        status="error",
                        final_url=final_url if final_url != normalize_url(url) else "",
                        status_code=status_code,
                        error=f"HTTP status {status_code}",
                    )
                    return

                content_type = response.headers.get("content-type", "").lower()
                response_text = response.text
                if _is_feed_response(content_type, response_text):
                    body_links = _extract_feed_links_from_xml(response_text, str(response.url))
                elif "html" in content_type or "<html" in response_text[:500].lower():
                    body_links = _extract_body_links_from_html(response_text, str(response.url))
                else:
                    results[index] = ScrapeResult(
                        url=url,
                        status="error",
                        final_url=final_url if final_url != normalize_url(url) else "",
                        status_code=status_code,
                        error=f"Unexpected content type {content_type or 'unknown'}",
                    )
                    return
                results[index] = ScrapeResult(
                    url=url,
                    html=body_links,
                    status="ok",
                    final_url=final_url if final_url != normalize_url(url) else "",
                    status_code=status_code,
                )
            except httpx.TimeoutException as err:
                results[index] = ScrapeResult(url=url, status="timeout", error=str(err))
            except httpx.HTTPError as err:
                results[index] = ScrapeResult(url=url, status="error", error=str(err))
            except Exception as err:  # noqa: BLE001 - keep pipeline resilient per URL.
                results[index] = ScrapeResult(url=url, status="error", error=str(err))

    async def _fill_source_feed_fallbacks(
        self,
        urls: list[str],
        results: list[ScrapeResult],
    ) -> None:
        """Replace failed/empty source results with RSS/Atom feed data when available."""
        raise_if_cancelled(self._cancel_event)
        fallback_indices = [
            index
            for index, result in enumerate(results)
            if _needs_source_feed_fallback(result)
        ]
        if not fallback_indices:
            return

        if self._on_status:
            self._on_status(f"RSS fallback for {len(fallback_indices)} source page(s)")

        semaphore = asyncio.Semaphore(self._http_concurrency)
        timeout = httpx.Timeout(
            connect=self._http_timeout_sec,
            read=self._http_timeout_sec,
            write=self._http_timeout_sec,
            pool=self._http_timeout_sec,
        )
        limits = httpx.Limits(
            max_connections=self._http_concurrency,
            max_keepalive_connections=self._http_concurrency,
        )

        async with httpx.AsyncClient(
            follow_redirects=True,
            headers=dict(_BASE_HEADERS),
            timeout=timeout,
            limits=limits,
        ) as client:
            tasks = [
                self._fill_one_source_feed_fallback(client, semaphore, urls, results, index)
                for index in fallback_indices
            ]
            await asyncio.gather(*tasks)

    async def _fill_one_source_feed_fallback(
        self,
        client: httpx.AsyncClient,
        semaphore: asyncio.Semaphore,
        urls: list[str],
        results: list[ScrapeResult],
        index: int,
    ) -> None:
        """Try RSS/Atom feed candidates for one failed source URL."""
        original_url = urls[index]
        async with semaphore:
            for feed_url in _source_feed_candidates(original_url):
                raise_if_cancelled(self._cancel_event)
                try:
                    response = await client.get(feed_url)
                    if response.status_code != 200:
                        continue

                    content_type = response.headers.get("content-type", "").lower()
                    if not _is_feed_response(content_type, response.text):
                        continue

                    links = _extract_feed_links_from_xml(response.text, str(response.url))
                    if not links:
                        continue

                    final_url = normalize_url(str(response.url))
                    results[index] = ScrapeResult(
                        url=original_url,
                        html=links,
                        status="ok",
                        final_url=final_url if final_url != normalize_url(original_url) else "",
                        status_code=response.status_code,
                    )
                    return
                except httpx.HTTPError:
                    continue
                except Exception:  # noqa: BLE001 - keep fallback best-effort.
                    continue

    def _scrape_with_extractor(
        self,
        urls: list[str],
        extractor: PageExtractor,
    ) -> list[ScrapeResult]:
        """Synchronously scrape URLs with the requested page extractor."""
        if not urls:
            return []
        raise_if_cancelled(self._cancel_event)
        return asyncio.run(self._scrape_all(urls, extractor))

    async def _scrape_all(
        self,
        urls: list[str],
        extractor: PageExtractor,
    ) -> list[ScrapeResult]:
        """Scrape all URLs asynchronously.

        Args:
            urls: URLs to scrape.
            extractor: Page extraction function to run after rendering.

        Returns:
            Scrape results in the same order as the input URLs.
        """
        raise_if_cancelled(self._cancel_event)
        semaphore = asyncio.Semaphore(self._concurrency)
        results = [ScrapeResult(url=url) for url in urls]

        async with async_playwright() as playwright:
            browser = await playwright.webkit.launch(headless=True)
            context = await browser.new_context(
                user_agent=_USER_AGENT,
                ignore_https_errors=True,
                extra_http_headers={key: value for key, value in _BASE_HEADERS.items() if key != "User-Agent"},
            )
            await context.route("**/*", self._block_unneeded_resources)

            try:
                tasks = [
                    self._scrape_one(context, semaphore, results, index, url, extractor)
                    for index, url in enumerate(urls)
                ]
                await asyncio.gather(*tasks)
            finally:
                with suppress(PlaywrightError):
                    await context.close()
                with suppress(PlaywrightError):
                    await browser.close()

        return results

    async def _resolve_all(self, urls: list[str]) -> list[RedirectResult]:
        """Resolve all URLs asynchronously using HTTP first, browser fallback second."""
        raise_if_cancelled(self._cancel_event)
        request_urls = [normalize_url(url) for url in urls]
        results = [RedirectResult(url=url) for url in request_urls]
        if not request_urls:
            return results

        http_results = await self._resolve_all_http(request_urls)
        for index, result in enumerate(http_results):
            results[index] = result

        fallback_indices = [
            index
            for index, result in enumerate(http_results)
            if _needs_browser_fallback(result)
        ]
        if not fallback_indices:
            return results

        fallback_urls = [request_urls[index] for index in fallback_indices]
        if self._on_status:
            self._on_status(f"Browser fallback for {len(fallback_urls)} URL(s)")

        browser_results = await self._resolve_all_browser(fallback_urls)
        for index, result in zip(fallback_indices, browser_results):
            results[index] = result

        return results

    async def _resolve_all_http(self, urls: list[str]) -> list[RedirectResult]:
        """Resolve redirects with async HTTP without downloading full bodies."""
        raise_if_cancelled(self._cancel_event)
        semaphore = asyncio.Semaphore(self._http_concurrency)
        results = [RedirectResult(url=url) for url in urls]
        timeout = httpx.Timeout(
            connect=self._http_timeout_sec,
            read=self._http_timeout_sec,
            write=self._http_timeout_sec,
            pool=self._http_timeout_sec,
        )
        limits = httpx.Limits(
            max_connections=self._http_concurrency,
            max_keepalive_connections=self._http_concurrency,
        )
        headers = dict(_BASE_HEADERS)

        async with httpx.AsyncClient(
            follow_redirects=True,
            headers=headers,
            timeout=timeout,
            limits=limits,
        ) as client:
            tasks = [
                self._resolve_one_http(client, semaphore, results, index, url)
                for index, url in enumerate(urls)
            ]
            await asyncio.gather(*tasks)

        return results

    async def _resolve_one_http(
        self,
        client: httpx.AsyncClient,
        semaphore: asyncio.Semaphore,
        results: list[RedirectResult],
        index: int,
        url: str,
    ) -> None:
        """Resolve one URL with HTTP and avoid reading the full response body."""
        async with semaphore:
            raise_if_cancelled(self._cancel_event)
            try:
                if self._on_status:
                    self._on_status(f"Validating {url}")

                async with client.stream("GET", url) as response:
                    status_code = response.status_code
                    final_url = normalize_url(str(response.url))

                if status_code == 200:
                    results[index] = RedirectResult(
                        url=url,
                        final_url=final_url,
                        status="ok",
                        status_code=status_code,
                    )
                    return

                results[index] = RedirectResult(
                    url=url,
                    final_url=final_url,
                    status="error",
                    status_code=status_code,
                    error=f"HTTP status {status_code}",
                )
            except httpx.TimeoutException as err:
                results[index] = RedirectResult(url=url, status="timeout", error=str(err))
            except httpx.HTTPError as err:
                results[index] = RedirectResult(url=url, status="error", error=str(err))
            except Exception as err:  # noqa: BLE001 - keep pipeline resilient per URL.
                results[index] = RedirectResult(url=url, status="error", error=str(err))

    async def _resolve_all_browser(self, urls: list[str]) -> list[RedirectResult]:
        """Resolve URLs with Playwright only when HTTP validation is not enough."""
        raise_if_cancelled(self._cancel_event)
        semaphore = asyncio.Semaphore(self._concurrency)
        results = [RedirectResult(url=url) for url in urls]

        async with async_playwright() as playwright:
            browser = await playwright.webkit.launch(headless=True)
            context = await browser.new_context(
                user_agent=_USER_AGENT,
                ignore_https_errors=True,
                extra_http_headers={key: value for key, value in _BASE_HEADERS.items() if key != "User-Agent"},
            )
            await context.route("**/*", self._block_unneeded_resources)

            try:
                tasks = [
                    self._resolve_one_browser(context, semaphore, results, index, url)
                    for index, url in enumerate(urls)
                ]
                await asyncio.gather(*tasks)
            finally:
                with suppress(PlaywrightError):
                    await context.close()
                with suppress(PlaywrightError):
                    await browser.close()

        return results

    async def _resolve_one_browser(
        self,
        context,
        semaphore: asyncio.Semaphore,
        results: list[RedirectResult],
        index: int,
        url: str,
    ) -> None:
        """Resolve one requested URL into the browser-final URL."""
        async with semaphore:
            raise_if_cancelled(self._cancel_event)
            page = None
            try:
                if self._on_status:
                    self._on_status(f"Resolving {url}")

                page = await context.new_page()
                response = await page.goto(
                    url,
                    wait_until="domcontentloaded",
                    timeout=self._timeout_ms,
                )
                final_url = normalize_url(page.url)
                status_code = response.status if response is not None else None

                if status_code != 200:
                    status_text = status_code if status_code is not None else "no response"
                    results[index] = RedirectResult(
                        url=url,
                        final_url=final_url,
                        status="error",
                        status_code=status_code,
                        error=f"HTTP status {status_text}",
                    )
                    return

                results[index] = RedirectResult(
                    url=url,
                    final_url=final_url,
                    status="ok",
                    status_code=status_code,
                )
            except PlaywrightTimeoutError as err:
                results[index] = RedirectResult(url=url, status="timeout", error=str(err))
            except PlaywrightError as err:
                results[index] = RedirectResult(url=url, status="error", error=str(err))
            except Exception as err:  # noqa: BLE001 - keep pipeline resilient per URL.
                results[index] = RedirectResult(url=url, status="error", error=str(err))
            finally:
                if page is not None:
                    with suppress(PlaywrightError):
                        await page.close()

    async def _scrape_one(
        self,
        context,
        semaphore: asyncio.Semaphore,
        results: list[ScrapeResult],
        index: int,
        url: str,
        extractor: PageExtractor,
    ) -> None:
        """Scrape one URL and store the result by index.

        Args:
            context: Shared Playwright browser context.
            semaphore: Concurrency limiter.
            results: Mutable result list.
            index: Position of the URL in the original URL list.
            url: URL to scrape.
            extractor: Page extraction function to run after rendering.
        """
        async with semaphore:
            raise_if_cancelled(self._cancel_event)
            page = None
            try:
                if self._on_status:
                    self._on_status(f"Scraping {url}")

                page = await context.new_page()
                response = await page.goto(
                    url,
                    wait_until="domcontentloaded",
                    timeout=self._timeout_ms,
                )
                final_url = normalize_url(page.url)
                status_code = response.status if response is not None else None

                if status_code != 200:
                    status_text = status_code if status_code is not None else "no response"
                    results[index] = ScrapeResult(
                        url=url,
                        status="error",
                        final_url=final_url if final_url != normalize_url(url) else "",
                        status_code=status_code,
                        error=f"HTTP status {status_text}",
                    )
                    return

                await self._wait_for_useful_dom(page)

                html = await extractor(page)
                results[index] = ScrapeResult(
                    url=url,
                    html=html,
                    status="ok",
                    final_url=final_url if final_url != normalize_url(url) else "",
                    status_code=status_code,
                )
            except PlaywrightTimeoutError as err:
                results[index] = ScrapeResult(url=url, status="timeout", error=str(err))
            except PlaywrightError as err:
                results[index] = ScrapeResult(url=url, status="error", error=str(err))
            except Exception as err:  # noqa: BLE001 - keep pipeline resilient per URL.
                results[index] = ScrapeResult(url=url, status="error", error=str(err))
            finally:
                if page is not None:
                    with suppress(PlaywrightError):
                        await page.close()

    async def _wait_for_useful_dom(self, page) -> None:
        """Wait briefly for useful article/source content without a fixed 5s tax."""
        with suppress(PlaywrightError, PlaywrightTimeoutError):
            await page.wait_for_selector("body", timeout=min(self._timeout_ms, 1_500))

        if self._render_wait_ms <= 0:
            return

        # Runtime configs from older installs may still be 5000ms. Cap the
        # unconditional wait so each successful page does not pay a 5s penalty.
        await page.wait_for_timeout(min(self._render_wait_ms, 750))

    async def _block_unneeded_resources(self, route: Route, request: Request) -> None:
        """Skip heavy assets and trackers that are unnecessary for text scraping."""
        url = request.url.lower()
        if request.resource_type in _BLOCKED_RESOURCE_TYPES or any(part in url for part in _BLOCKED_URL_PARTS):
            with suppress(PlaywrightError):
                await route.abort()
            return

        with suppress(PlaywrightError):
            await route.continue_()

    async def _extract_body_links(self, page) -> str:
        """Return all ``<a>`` tags from inside ``<body>`` only."""
        content = await page.evaluate(
            """
            () => {
                const escapeAttribute = value => String(value)
                    .replace(/&/g, '&amp;')
                    .replace(/"/g, '&quot;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');

                return Array.from(document.body?.querySelectorAll('a') || [])
                    .map(anchor => {
                        const attrs = Array.from(anchor.attributes)
                            .filter(attr => attr.name.toLowerCase() !== 'href')
                            .map(attr => `${attr.name}="${escapeAttribute(attr.value)}"`);

                        if (anchor.href) {
                            attrs.unshift(`href="${escapeAttribute(anchor.href)}"`);
                        }

                        const text = anchor.innerText.trim();
                        const attrText = attrs.length ? ` ${attrs.join(' ')}` : '';
                        return `<a${attrText}>${escapeAttribute(text)}</a>`;
                    })
                    .join(' ');
            }
            """
        )
        return compact_html(content)

    async def _extract_prompt_text(self, page) -> str:
        """Return all ``<meta>`` tags followed by rendered body text."""
        content = await page.evaluate(
            """
            () => {
                const escapeAttribute = value => String(value)
                    .replace(/&/g, '&amp;')
                    .replace(/"/g, '&quot;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');

                const metaTags = Array.from(document.querySelectorAll('meta'))
                    .map(meta => {
                        const attrs = Array.from(meta.attributes)
                            .map(attr => `${attr.name}="${escapeAttribute(attr.value)}"`)
                            .join(' ');
                        return attrs ? `<meta ${attrs}/>` : '<meta/>';
                    })
                    .join(' ');

                const bodyText = document.body?.innerText || '';
                return [metaTags, bodyText].filter(Boolean).join(' ');
            }
            """
        )
        return compact_html(content)


def _needs_browser_fallback(result: RedirectResult) -> bool:
    """Return True when HTTP probing may be blocked rather than truly invalid."""
    if result.status == "ok":
        return False
    if result.status == "timeout" or result.status_code is None:
        return True
    return result.status_code in _BROWSER_FALLBACK_STATUSES


class _BodyAnchorParser(HTMLParser):
    """Small stdlib parser that extracts body anchors from raw HTML."""

    def __init__(self, base_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.in_body = False
        self.current_href = ""
        self.current_text: list[str] = []
        self.anchors: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag == "body":
            self.in_body = True
            return
        if tag != "a" or not self.in_body or self.current_href:
            return

        attrs_dict = {name.lower(): value or "" for name, value in attrs}
        href = attrs_dict.get("href", "").strip()
        if not href:
            return
        absolute_href = normalize_url(urljoin(self.base_url, href))
        if not absolute_href.startswith("http"):
            return
        self.current_href = absolute_href
        self.current_text = []

    def handle_data(self, data: str) -> None:
        if self.current_href:
            self.current_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "body":
            self.in_body = False
            return
        if tag != "a" or not self.current_href:
            return

        text = compact_html(" ".join(self.current_text))
        self.anchors.append(
            f'<a href="{html_lib.escape(self.current_href, quote=True)}">'
            f'{html_lib.escape(text)}</a>'
        )
        self.current_href = ""
        self.current_text = []


def _extract_body_links_from_html(raw_html: str, base_url: str) -> str:
    """Return compact body-anchor HTML from a raw HTML document."""
    parser = _BodyAnchorParser(base_url)
    parser.feed(raw_html or "")
    parser.close()
    return compact_html(" ".join(parser.anchors))


def _is_feed_response(content_type: str, text: str) -> bool:
    """Return True when an HTTP response looks like RSS, Atom, or XML feed data."""
    content_type = content_type.lower()
    head = (text or "")[:500].lstrip().lower()
    if any(feed_type in content_type for feed_type in ("application/rss+xml", "application/atom+xml")):
        return True
    if "xml" not in content_type and not head.startswith(("<?xml", "<rss", "<feed")):
        return False
    return "<rss" in head or "<feed" in head or "<rdf" in head or "<item" in head or "<entry" in head


def _extract_feed_links_from_xml(raw_xml: str, base_url: str) -> str:
    """Convert RSS/Atom feed entries into compact anchor HTML for link extraction."""
    try:
        root = ElementTree.fromstring(raw_xml.encode("utf-8"))
    except ElementTree.ParseError:
        return ""

    anchors: list[str] = []
    seen: set[str] = set()

    for entry in list(root.findall(".//item")) + list(root.findall(".//{*}item")):
        link = _xml_child_text(entry, "link") or _xml_child_text(entry, "guid")
        title = _xml_child_text(entry, "title") or link
        _append_feed_anchor(anchors, seen, base_url, link, title)

    for entry in list(root.findall(".//entry")) + list(root.findall(".//{*}entry")):
        link = _atom_entry_link(entry) or _xml_child_text(entry, "id")
        title = _xml_child_text(entry, "title") or link
        _append_feed_anchor(anchors, seen, base_url, link, title)

    return compact_html(" ".join(anchors))


def _xml_child_text(parent: ElementTree.Element, child_name: str) -> str:
    """Return stripped child text, ignoring XML namespaces."""
    for child in parent:
        if _xml_local_name(child.tag) == child_name:
            return compact_html(child.text or "")
    return ""


def _atom_entry_link(entry: ElementTree.Element) -> str:
    """Return the best link from an Atom entry."""
    fallback = ""
    for child in entry:
        if _xml_local_name(child.tag) != "link":
            continue
        href = (child.attrib.get("href") or "").strip()
        if not href:
            continue
        rel = (child.attrib.get("rel") or "alternate").lower()
        if rel == "alternate":
            return href
        fallback = fallback or href
    return fallback


def _xml_local_name(tag: str) -> str:
    """Return an XML tag name without its namespace."""
    return tag.rsplit("}", 1)[-1].lower()


def _append_feed_anchor(
    anchors: list[str],
    seen: set[str],
    base_url: str,
    link: str,
    title: str,
) -> None:
    """Append a unique feed item as an HTML anchor."""
    normalized = normalize_url(urljoin(base_url, html_lib.unescape(link or "")))
    if not normalized.startswith("http") or normalized in seen:
        return

    text = compact_html(html_lib.unescape(title or normalized))
    anchors.append(
        f'<a href="{html_lib.escape(normalized, quote=True)}">'
        f'{html_lib.escape(text)}</a>'
    )
    seen.add(normalized)


def _needs_source_feed_fallback(result: ScrapeResult) -> bool:
    """Return True when a source page may be recoverable through an RSS/Atom feed."""
    if result.status == "ok":
        return not bool(result.html)
    if result.status == "timeout" or result.status_code is None:
        return True
    return result.status_code in _BROWSER_FALLBACK_STATUSES


def _source_feed_candidates(source_url: str) -> list[str]:
    """Return likely RSS/Atom feed URLs for a source/category page."""
    parsed = urlparse(source_url)
    if not parsed.scheme or not parsed.netloc:
        return []

    path = parsed.path.rstrip("/")
    candidates: list[str] = []
    if path:
        candidates.append(urlunparse((parsed.scheme, parsed.netloc, f"{path}/feed", "", "", "")))
    candidates.append(urlunparse((parsed.scheme, parsed.netloc, "/feed", "", "", "")))

    return list(dict.fromkeys(normalize_url(candidate) for candidate in candidates))


def _needs_source_browser_fallback(result: ScrapeResult) -> bool:
    """Return True when HTTP source scraping needs browser rendering fallback."""
    if result.status == "ok":
        return not bool(result.html)
    if result.status == "timeout" or result.status_code is None:
        return True
    return result.status_code in _BROWSER_FALLBACK_STATUSES
