"""Gemini API wrapper with retry and rate-limit handling."""

from __future__ import annotations

import time
from threading import Event
from typing import Callable

from google.genai import Client

from lathala.config import Settings
from lathala.services.cancellation import raise_if_cancelled
from lathala.utils.rate_limit import RateLimiter

StatusCallback = Callable[[str], None]


class GeminiService:
    """Generate text responses using Gemini.

    The client is created once and reused across requests to avoid repeatedly
    opening client objects for every prompt.
    """

    def __init__(
        self,
        settings: Settings,
        on_retry: StatusCallback | None = None,
        cancel_event: Event | None = None,
    ) -> None:
        """Initialize the Gemini service.

        Args:
            settings: Application settings.
            on_retry: Optional callback invoked when a request is retried.
        """
        self._client = Client(api_key=settings.gemini_api_key)
        self._model_id = settings.gemini_model_id
        self._max_retries = settings.max_ai_retries
        self._retry_backoff_sec = settings.retry_backoff_sec
        self._rate_limiter = RateLimiter(settings.request_delay_sec)
        self._on_retry = on_retry
        self._cancel_event = cancel_event

    def generate(self, prompt: str) -> str:
        """Generate a text response for a prompt.

        Args:
            prompt: Prompt sent to Gemini.

        Returns:
            Response text from Gemini.

        Raises:
            RuntimeError: If all retry attempts fail.
        """
        last_error: Exception | None = None

        for attempt in range(1, self._max_retries + 1):
            raise_if_cancelled(self._cancel_event)
            self._rate_limiter.wait()
            raise_if_cancelled(self._cancel_event)

            try:
                response = self._client.models.generate_content(
                    model=self._model_id,
                    contents=prompt,
                )
                return response.text or ""
            except Exception as err:  # noqa: BLE001 - SDK raises several runtime errors.
                last_error = err
                if attempt >= self._max_retries:
                    break

                delay = self._retry_backoff_sec * attempt
                if self._on_retry:
                    self._on_retry(f"Gemini request failed. Retrying in {delay:.1f}s: {err}")
                self._sleep_with_cancel(delay)

        message = f"Gemini request failed after {self._max_retries} attempts"
        raise RuntimeError(message) from last_error

    def _sleep_with_cancel(self, delay: float) -> None:
        """Sleep in short chunks so cancellation can interrupt retries."""
        deadline = time.monotonic() + max(0.0, delay)
        while time.monotonic() < deadline:
            raise_if_cancelled(self._cancel_event)
            time.sleep(min(0.2, deadline - time.monotonic()))
