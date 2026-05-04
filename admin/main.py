"""Run the production Lathala scraping pipeline.

Interactive source/article tests were moved to the Flask control UI at
``/control`` so this file stays focused on the normal scheduled workflow.
"""

from __future__ import annotations

from lathala.config import Settings
from lathala.services.pipeline import NewsPipeline
from lathala.services.repository import ArticleRepository


def main() -> None:
    """Run the normal Supabase-backed workflow."""
    base_settings = Settings.from_env(require_gemini=True, require_supabase=True)
    repository = ArticleRepository(base_settings)
    settings = base_settings.with_runtime_values(repository.get_runtime_settings())
    pipeline = NewsPipeline(settings=settings, repository=repository)
    pipeline.run()


if __name__ == "__main__":
    main()
