"""Application configuration.

Secrets stay in environment variables. Runtime values are stored in
Supabase ``variables`` and fall back to the defaults below before the
SQL schema is initialized.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from typing import Any, Mapping, Optional

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional local convenience dependency.
    load_dotenv = None  # type: ignore[assignment]


PUBLISHER_LOGO_BASE_URL = "https://ruludjzcqacclehqkppk.supabase.co/storage/v1/object/public/lathala/images/sources"
PUBLISHER_LOGO_BASE_EXT = "webp"


DEFAULT_RUNTIME_SETTINGS: dict[str, Any] = {
    "GEMINI_MODEL_ID": "gemini-2.5-flash",
    "GEMINI_LINK_BATCH_SIZE": 4,
    "GEMINI_ARTICLE_BATCH_SIZE": 6,
    "PUBLISHER_LOGO_BASE_URL": PUBLISHER_LOGO_BASE_URL,
    "PUBLISHER_LOGO_BASE_EXT": PUBLISHER_LOGO_BASE_EXT,
    "SCRAPE_CONCURRENCY": 3,
    "HTTP_CONCURRENCY": 30,
    "SCRAPE_TIMEOUT_SEC": 15,
    "HTTP_TIMEOUT_SEC": 8,
    "RENDER_WAIT_MS": 500,
    "BATCH_SIZE": 10,
    "REQUEST_DELAY_SEC": 15.0,
    "MAX_AI_RETRIES": 3,
    "RETRY_BACKOFF_SEC": 2.0,
}

RUNTIME_SETTING_TYPES: dict[str, type] = {
    "GEMINI_MODEL_ID": str,
    "GEMINI_LINK_BATCH_SIZE": int,
    "GEMINI_ARTICLE_BATCH_SIZE": int,
    "PUBLISHER_LOGO_BASE_URL": str,
    "PUBLISHER_LOGO_BASE_EXT": str,
    "SCRAPE_CONCURRENCY": int,
    "HTTP_CONCURRENCY": int,
    "SCRAPE_TIMEOUT_SEC": int,
    "HTTP_TIMEOUT_SEC": int,
    "RENDER_WAIT_MS": int,
    "BATCH_SIZE": int,
    "REQUEST_DELAY_SEC": float,
    "MAX_AI_RETRIES": int,
    "RETRY_BACKOFF_SEC": float,
}


@dataclass(frozen=True)
class Settings:
    """Runtime settings for scraping, summarizing, and database access.

    Secret values are environment-backed only. Editable operational values
    are database-backed through ``variables`` and initialized by
    ``schema.sql``.
    """

    gemini_api_key: str = ""
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    publisher_logo_base_url: str = PUBLISHER_LOGO_BASE_URL
    publisher_logo_base_ext: str = PUBLISHER_LOGO_BASE_EXT
    gemini_model_id: str = DEFAULT_RUNTIME_SETTINGS["GEMINI_MODEL_ID"]
    gemini_link_batch_size: int = DEFAULT_RUNTIME_SETTINGS["GEMINI_LINK_BATCH_SIZE"]
    gemini_article_batch_size: int = DEFAULT_RUNTIME_SETTINGS["GEMINI_ARTICLE_BATCH_SIZE"]
    scrape_concurrency: int = DEFAULT_RUNTIME_SETTINGS["SCRAPE_CONCURRENCY"]
    http_concurrency: int = DEFAULT_RUNTIME_SETTINGS["HTTP_CONCURRENCY"]
    scrape_timeout_sec: int = DEFAULT_RUNTIME_SETTINGS["SCRAPE_TIMEOUT_SEC"]
    http_timeout_sec: int = DEFAULT_RUNTIME_SETTINGS["HTTP_TIMEOUT_SEC"]
    render_wait_ms: int = DEFAULT_RUNTIME_SETTINGS["RENDER_WAIT_MS"]
    batch_size: int = DEFAULT_RUNTIME_SETTINGS["BATCH_SIZE"]
    request_delay_sec: float = DEFAULT_RUNTIME_SETTINGS["REQUEST_DELAY_SEC"]
    max_ai_retries: int = DEFAULT_RUNTIME_SETTINGS["MAX_AI_RETRIES"]
    retry_backoff_sec: float = DEFAULT_RUNTIME_SETTINGS["RETRY_BACKOFF_SEC"]

    @classmethod
    def from_env(
        cls,
        *,
        require_gemini: bool = True,
        require_supabase: bool = True,
    ) -> "Settings":
        """Create settings from environment secrets plus built-in defaults."""
        if load_dotenv:
            load_dotenv()

        return cls(
            gemini_api_key=(
                _required_env("GEMINI_API_KEY")
                if require_gemini
                else os.getenv("GEMINI_API_KEY", "")
            ),
            supabase_url=(
                _required_env("SUPABASE_URL")
                if require_supabase
                else os.getenv("SUPABASE_URL", "")
            ),
            supabase_service_role_key=(
                _required_env("SUPABASE_SERVICE_ROLE_KEY")
                if require_supabase
                else os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
            ),
            publisher_logo_base_url=os.getenv("PUBLISHER_LOGO_BASE_URL", PUBLISHER_LOGO_BASE_URL).rstrip("/"),
            publisher_logo_base_ext=_clean_logo_extension(os.getenv("PUBLISHER_LOGO_BASE_EXT", PUBLISHER_LOGO_BASE_EXT)),
        )

    def with_runtime_values(self, values: Mapping[str, Any]) -> "Settings":
        """Return a copy with database-backed runtime values applied."""
        payload = _coerce_runtime_values(values)
        return replace(
            self,
            gemini_model_id=payload["GEMINI_MODEL_ID"],
            gemini_link_batch_size=max(1, payload["GEMINI_LINK_BATCH_SIZE"]),
            gemini_article_batch_size=max(1, payload["GEMINI_ARTICLE_BATCH_SIZE"]),
            publisher_logo_base_url=str(payload["PUBLISHER_LOGO_BASE_URL"]).strip().rstrip("/") or PUBLISHER_LOGO_BASE_URL,
            publisher_logo_base_ext=_clean_logo_extension(payload["PUBLISHER_LOGO_BASE_EXT"]),
            scrape_concurrency=payload["SCRAPE_CONCURRENCY"],
            http_concurrency=payload["HTTP_CONCURRENCY"],
            scrape_timeout_sec=payload["SCRAPE_TIMEOUT_SEC"],
            http_timeout_sec=payload["HTTP_TIMEOUT_SEC"],
            render_wait_ms=payload["RENDER_WAIT_MS"],
            batch_size=payload["BATCH_SIZE"],
            request_delay_sec=payload["REQUEST_DELAY_SEC"],
            max_ai_retries=payload["MAX_AI_RETRIES"],
            retry_backoff_sec=payload["RETRY_BACKOFF_SEC"],
        )

    def public_runtime_dict(self) -> dict[str, Any]:
        """Return editable runtime settings for the control UI."""
        return {
            "GEMINI_MODEL_ID": self.gemini_model_id,
            "GEMINI_LINK_BATCH_SIZE": self.gemini_link_batch_size,
            "GEMINI_ARTICLE_BATCH_SIZE": self.gemini_article_batch_size,
            "PUBLISHER_LOGO_BASE_URL": self.publisher_logo_base_url,
            "PUBLISHER_LOGO_BASE_EXT": self.publisher_logo_base_ext,
            "SCRAPE_CONCURRENCY": self.scrape_concurrency,
            "HTTP_CONCURRENCY": self.http_concurrency,
            "SCRAPE_TIMEOUT_SEC": self.scrape_timeout_sec,
            "HTTP_TIMEOUT_SEC": self.http_timeout_sec,
            "RENDER_WAIT_MS": self.render_wait_ms,
            "BATCH_SIZE": self.batch_size,
            "REQUEST_DELAY_SEC": self.request_delay_sec,
            "MAX_AI_RETRIES": self.max_ai_retries,
            "RETRY_BACKOFF_SEC": self.retry_backoff_sec,
        }


def _coerce_runtime_values(values: Mapping[str, Any]) -> dict[str, Any]:
    payload = dict(DEFAULT_RUNTIME_SETTINGS)

    for key, default_value in DEFAULT_RUNTIME_SETTINGS.items():
        if key not in values or values[key] is None:
            continue

        value = values[key]
        expected_type = RUNTIME_SETTING_TYPES[key]
        try:
            if expected_type is int:
                payload[key] = max(1, int(value))
            elif expected_type is float:
                payload[key] = float(value)
            else:
                payload[key] = str(value).strip() or default_value
        except (TypeError, ValueError):
            payload[key] = default_value

    return payload


def _clean_logo_extension(value: Any) -> str:
    """Normalize a publisher logo extension from runtime config."""
    extension = str(value or PUBLISHER_LOGO_BASE_EXT).strip().lstrip(".")
    return extension or PUBLISHER_LOGO_BASE_EXT


def _required_env(name: str) -> str:
    """Read a required environment variable."""
    value: Optional[str] = os.getenv(name)
    if not value:
        raise ValueError(f"Missing required environment variable: {name}")
    return value
