import json
import time

from api import flash, supabase, webkit


ARTICLE_PROMPT = """
ROLE:
You are a seasoned English broadcast journalist with 20+ years of experience.

TASK:
Using only the transcript provided, create a concise news article summary in JSON format.

You must:
- Write a direct headline.
- Select the strongest single tag from this list only:
    Politics, Business, Technology, Health, Sports, Entertainment.
- Keep each bullet to one sentence only.
- Keep each bullet between 20 and 30 words.
- Use only facts supported by the article.
- Do not invent names, numbers, places, dates, URLs, or image links.
- If the image URL is not provided in the article, use an empty string.

STRICT STYLE RULES:
- Vary sentence openings. Do not start two consecutive bullets with the same structure.
- Do not begin any bullet with "Meanwhile" or "In addition."
- Avoid filler phrases such as:
    "escalating conflict", "reverberating globally", "vital", "grapples with",
    "repercussions", "amidst", and "intensified".
- Say the facts plainly.
- Do not use en dashes or em dashes.
- Prefer active voice.
- Use passive voice only when necessary.
- Anchor claims with specific numbers, names, and places when they appear in the article.
- The headline must be direct, natural, and 9 to 11 words long.
- The headline must not sound like a press release.

OUTPUT FORMAT:
Return valid JSON only.
Do not include markdown fences, explanations, comments, or extra text.

{
    "image": "<full image URL of the article>",
    "title": "<headline, 9 to 11 words>",
    "tag": "<one selected tag>",
    "bullets": [
        "<one-sentence summary, 20 to 30 words>",
    ],
    "date": "<YYYY-MM-DD>"
}

ARTICLE:
"""


LINKS_PROMPT = """
Extract news article links exclusively from the main content section
of the webpage. Do not include links from sidebars, headers, footers,
or any non-primary content areas.

Only collect links that lead to full news articles. Exclude:

- Video content or video pages
- Article compilations, summaries, or roundup posts
- Lotto results articles

Ensure that all extracted links are unique. If multiple links refer to
the same or highly similar news story, include only one representative
link—the most complete or authoritative version.

The output must only be a list of complete urls (w/ https:// prefix): ["url", "url",...]

This is the HTML contents:
"""


def parse_json(text, fallback=None):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return fallback


def collect_article_links():
    sources = supabase.table("sources").select("url").execute().data or []
    source_urls = [source["url"] for source in sources if source.get("url")]

    results = webkit(source_urls)

    article_urls = set()

    for result in results:
        if result.get("status") != "ok":
            continue

        html = result.get("html")
        if not html:
            continue

        links = parse_json(flash(LINKS_PROMPT + html), fallback=[])

        if isinstance(links, list):
            article_urls.update(links)

        time.sleep(3)

    if not article_urls:
        return

    rows = [{"url": url} for url in article_urls]

    (
        supabase
        .table("articles")
        .upsert(rows, on_conflict="url")
        .execute()
    )


def summarize_articles(batch_size=10):
    while True:
        articles = (
            supabase
            .table("articles")
            .select("url")
            .is_("data", None)
            .limit(batch_size)
            .execute()
            .data
            or []
        )

        article_urls = [article["url"] for article in articles if article.get("url")]

        if not article_urls:
            break

        results = webkit(article_urls)

        for result in results:
            if result.get("status") != "ok":
                continue

            url = result.get("url")
            html = result.get("html")

            if not url or not html:
                continue

            article_data = parse_json(flash(ARTICLE_PROMPT + html))

            if not isinstance(article_data, dict):
                continue

            (
                supabase
                .table("articles")
                .update({"data": article_data})
                .eq("url", url)
                .execute()
            )

            time.sleep(3)


def main():
    collect_article_links()
    summarize_articles()


if __name__ == "__main__":
    main()
