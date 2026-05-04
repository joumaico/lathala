"""Simple rate-limiting helpers."""

from __future__ import annotations

import time


class RateLimiter:
    """Enforce a minimum delay between API calls.

    Attributes:
        delay_sec: Minimum number of seconds between calls.
    """

    def __init__(self, delay_sec: float) -> None:
        """Initialize the limiter.

        Args:
            delay_sec: Minimum number of seconds between calls.
        """
        self.delay_sec = max(0.0, delay_sec)
        self._last_call = 0.0

    def wait(self) -> None:
        """Sleep until the next call is allowed."""
        if self.delay_sec <= 0:
            self._last_call = time.monotonic()
            return

        elapsed = time.monotonic() - self._last_call
        remaining = self.delay_sec - elapsed
        if remaining > 0:
            time.sleep(remaining)
        self._last_call = time.monotonic()
