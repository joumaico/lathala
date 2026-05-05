import asyncio
from contextlib import suppress
from typing import List, Dict

from playwright.async_api import (
    async_playwright,
    Error as PlaywrightError,
    TimeoutError as PlaywrightTimeoutError,
)


async def load_urls_with_limit(
    urls: List[str],
    max_tabs: int = 3,
    timeout_sec: int = 15
) -> List[Dict[str, str]]:
    """Load multiple URLs concurrently using WebKit and return structured results."""

    semaphore = asyncio.Semaphore(max_tabs)

    results: List[Dict[str, str]] = [
        {"url": url, "html": "", "status": "pending"} for url in urls
    ]

    async def handle_url(browser, idx: int, url: str) -> None:
        context = None

        async with semaphore:
            try:
                print(f"Opening: {url}")

                context = await browser.new_context()
                page = await context.new_page()

                # Use Playwright's timeout, not asyncio.wait_for().
                await page.goto(
                    url,
                    wait_until="domcontentloaded",
                    timeout=timeout_sec * 1000,
                )

                # Optional: let late-rendered content appear.
                await page.wait_for_timeout(5_000)

                html = await page.content()

                results[idx] = {
                    "url": url,
                    "html": html,
                    "status": "ok",
                }

                print(f"Loaded: {url}")

            except PlaywrightTimeoutError:
                results[idx] = {
                    "url": url,
                    "html": "",
                    "status": "timeout",
                }
                print(f"Timeout: {url}")

            except PlaywrightError as err:
                results[idx] = {
                    "url": url,
                    "html": "",
                    "status": "error",
                }
                print(f"Playwright error ({url}): {err}")

            except Exception as err:
                results[idx] = {
                    "url": url,
                    "html": "",
                    "status": "error",
                }
                print(f"Unexpected error ({url}): {err}")

            finally:
                if context is not None:
                    with suppress(PlaywrightError):
                        await context.close()

                print(f"Closed: {url}")

    async with async_playwright() as playwright:
        browser = await playwright.webkit.launch(headless=True)

        try:
            tasks = [
                handle_url(browser, idx, url)
                for idx, url in enumerate(urls)
            ]

            await asyncio.gather(*tasks)

        finally:
            with suppress(PlaywrightError):
                await browser.close()

    return results


def process_urls(url_list: List[str]) -> List[Dict[str, str]]:
    """Synchronous wrapper for loading URLs and returning structured results."""
    return asyncio.run(load_urls_with_limit(url_list))
