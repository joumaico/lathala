"""CLI status effects with Rich support and a plain-text fallback."""

from __future__ import annotations

from contextlib import contextmanager
from typing import TYPE_CHECKING, Iterator

if TYPE_CHECKING:
    from rich.progress import Progress as RichProgressType

try:
    from rich.console import Console as RichConsole
    from rich.progress import (
        BarColumn,
        Progress as RichProgress,
        SpinnerColumn,
        TextColumn,
        TimeElapsedColumn,
    )
except ImportError:  # pragma: no cover - fallback only runs without Rich installed.
    RichConsole = None  # type: ignore[assignment]
    RichProgress = None  # type: ignore[assignment]


class CliEffects:
    """Display progress and status messages in the terminal.

    The class uses Rich when it is installed. When Rich is unavailable, it falls
    back to clean plain-text output so the application still works.
    """

    def __init__(self) -> None:
        """Initialize the terminal output helper."""
        self._console = RichConsole() if RichConsole is not None else None

    def info(self, message: str) -> None:
        """Print an informational message.

        Args:
            message: Message shown to the user.
        """
        if self._console:
            self._console.print(f"[cyan]›[/cyan] {message}")
        else:
            print(f"> {message}")

    def success(self, message: str) -> None:
        """Print a success message.

        Args:
            message: Message shown to the user.
        """
        if self._console:
            self._console.print(f"[green]✓[/green] {message}")
        else:
            print(f"OK: {message}")

    def warning(self, message: str) -> None:
        """Print a warning message.

        Args:
            message: Message shown to the user.
        """
        if self._console:
            self._console.print(f"[yellow]![/yellow] {message}")
        else:
            print(f"WARN: {message}")

    def error(self, message: str) -> None:
        """Print an error message.

        Args:
            message: Message shown to the user.
        """
        if self._console:
            self._console.print(f"[red]✗[/red] {message}")
        else:
            print(f"ERROR: {message}")

    @contextmanager
    def status(self, message: str) -> Iterator[None]:
        """Show a spinner while a block of work runs.

        Args:
            message: Status text displayed beside the spinner.

        Yields:
            None while the caller's work executes.
        """
        if self._console:
            with self._console.status(f"[bold cyan]{message}[/bold cyan]", spinner="dots"):
                yield
        else:
            print(f"... {message}")
            yield

    @contextmanager
    def progress(self) -> Iterator["CliProgress"]:
        """Create a progress renderer for batch work.

        Yields:
            A progress helper compatible with Rich or plain-text output.
        """
        if RichProgress is not None:
            progress = RichProgress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                BarColumn(),
                TextColumn("{task.completed}/{task.total}"),
                TimeElapsedColumn(),
            )
            with progress:
                yield RichCliProgress(progress)
        else:
            yield PlainCliProgress()


class CliProgress:
    """Small progress interface used by the pipeline."""

    def add_task(self, description: str, total: int) -> int:
        """Create a progress task.

        Args:
            description: Text describing the task.
            total: Number of work units.

        Returns:
            Task identifier.
        """
        raise NotImplementedError

    def advance(self, task_id: int, description: str | None = None) -> None:
        """Advance a task by one unit.

        Args:
            task_id: Task identifier returned by add_task.
            description: Optional updated task description.
        """
        raise NotImplementedError


class RichCliProgress(CliProgress):
    """Rich-backed progress adapter."""

    def __init__(self, progress: RichProgressType) -> None:
        """Initialize the Rich progress adapter.

        Args:
            progress: Rich Progress instance.
        """
        self._progress = progress

    def add_task(self, description: str, total: int) -> int:
        """Create a Rich progress task.

        Args:
            description: Text describing the task.
            total: Number of work units.

        Returns:
            Rich task identifier.
        """
        task_id = self._progress.add_task(description, total=total)
        return int(task_id)

    def advance(self, task_id: int, description: str | None = None) -> None:
        """Advance a Rich progress task.

        Args:
            task_id: Rich task identifier.
            description: Optional updated task description.
        """
        if description:
            self._progress.update(task_id, advance=1, description=description)
        else:
            self._progress.update(task_id, advance=1)


class PlainCliProgress(CliProgress):
    """Plain-text progress adapter used when Rich is not installed."""

    def __init__(self) -> None:
        """Initialize the plain progress adapter."""
        self._totals: dict[int, int] = {}
        self._counts: dict[int, int] = {}
        self._next_id = 1

    def add_task(self, description: str, total: int) -> int:
        """Create a plain progress task.

        Args:
            description: Text describing the task.
            total: Number of work units.

        Returns:
            Plain task identifier.
        """
        task_id = self._next_id
        self._next_id += 1
        self._totals[task_id] = total
        self._counts[task_id] = 0
        print(f"{description}: 0/{total}")
        return task_id

    def advance(self, task_id: int, description: str | None = None) -> None:
        """Advance a plain progress task.

        Args:
            task_id: Plain task identifier.
            description: Optional updated task description.
        """
        self._counts[task_id] += 1
        total = self._totals[task_id]
        label = description or "Progress"
        print(f"{label}: {self._counts[task_id]}/{total}")
