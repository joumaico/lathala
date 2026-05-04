"""Shared cooperative cancellation helpers for long-running jobs."""

from __future__ import annotations

from threading import Event


class JobCancelledError(RuntimeError):
    """Raised when a control-panel job has been cancelled."""


def raise_if_cancelled(cancel_event: Event | None) -> None:
    """Stop work when the caller has requested cancellation."""
    if cancel_event is not None and cancel_event.is_set():
        raise JobCancelledError("Task cancelled.")
