"""Local-only Flask control app for Lathala.

This Flask app intentionally does not serve the public Lathala website. The
public website is a separate static app in ``public/`` and can be deployed
to GitHub Pages or any static host.
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from threading import Event, Lock, Thread
from time import time
from typing import Any
from uuid import uuid4

from flask import Flask, jsonify, request, send_from_directory

from lathala.config import DEFAULT_RUNTIME_SETTINGS, Settings
from lathala.services.cancellation import JobCancelledError
from lathala.services.repository import ArticleRepository
from lathala.utils.urls import normalize_url, root_domain

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CONTROL_STATIC_DIR = PROJECT_ROOT / "static"
TEMPLATE_DIR = PROJECT_ROOT / "templates"
PUBLISHER_SOURCE_PREVIEW_LIMIT = 3
SOURCE_TEST_PREVIEW_LIMIT = 40


def create_app() -> Flask:
    """Create the local Flask control application."""
    app = Flask(
        __name__,
        static_folder=str(CONTROL_STATIC_DIR),
        static_url_path="/static",
        template_folder=str(TEMPLATE_DIR),
    )

    default_settings = Settings.from_env(
        require_gemini=False,
        require_supabase=False,
    )
    app.config["PUBLISHER_LOGO_BASE_URL"] = default_settings.publisher_logo_base_url
    app.config["PUBLISHER_LOGO_BASE_EXT"] = default_settings.publisher_logo_base_ext
    job_manager = ControlJobManager()

    @app.get("/")
    @app.get("/control")
    def control_site():
        """Serve the one-page local control UI."""
        return send_from_directory(TEMPLATE_DIR, "control.html")

    @app.get("/api/control/settings")
    def read_settings():
        settings, repository = _settings_and_repository(require_gemini=False)
        try:
            values = settings.with_runtime_values(repository.get_runtime_settings()).public_runtime_dict()
        except Exception:
            values = settings.public_runtime_dict()
        return jsonify({"settings": values, "defaults": DEFAULT_RUNTIME_SETTINGS})

    @app.route("/api/control/settings", methods=["POST", "PUT"])
    def update_settings():
        payload = _json_payload()
        base_settings, repository = _settings_and_repository(require_gemini=False)
        saved = repository.save_runtime_settings(payload)
        settings = base_settings.with_runtime_values(saved)
        return jsonify({"settings": settings.public_runtime_dict(), "defaults": DEFAULT_RUNTIME_SETTINGS})

    @app.get("/api/control/publishers")
    def read_publishers():
        repository = _repository(require_gemini=False)
        return jsonify({
            "publishers": repository.list_publishers(
                source_preview_limit=PUBLISHER_SOURCE_PREVIEW_LIMIT
            ),
            "source_preview_limit": PUBLISHER_SOURCE_PREVIEW_LIMIT,
        })

    @app.get("/api/control/publishers/<int:publisher_id>")
    def read_publisher(publisher_id: int):
        repository = _repository(require_gemini=False)
        return jsonify({"publisher": repository.get_publisher(publisher_id)})

    @app.post("/api/control/publishers")
    def create_publisher():
        repository = _repository(require_gemini=False)
        publisher = repository.create_publisher(_publisher_payload())
        return jsonify({"publisher": publisher}), 201

    @app.put("/api/control/publishers/<int:publisher_id>")
    def update_publisher(publisher_id: int):
        repository = _repository(require_gemini=False)
        publisher = repository.update_publisher(publisher_id, _publisher_payload())
        return jsonify({"publisher": publisher})

    @app.delete("/api/control/publishers/<int:publisher_id>")
    def delete_publisher(publisher_id: int):
        repository = _repository(require_gemini=False)
        repository.delete_publisher(publisher_id)
        return jsonify({"ok": True})

    @app.post("/api/control/test/source")
    def test_source():
        payload = _json_payload()
        url = normalize_url(str(payload.get("url") or ""))
        if not url:
            return _error("Source URL is required.", 400)

        pipeline = _pipeline(require_supabase=False, require_gemini=True)
        links = pipeline.extract_article_links_from_source(url)
        preview_links = links[:SOURCE_TEST_PREVIEW_LIMIT]
        return jsonify({
            "source_url": url,
            "domain": root_domain(url),
            "article_urls": preview_links,
            "count": len(links),
            "preview_count": len(preview_links),
            "truncated": len(links) > len(preview_links),
        })

    @app.post("/api/control/test/article")
    def test_article():
        payload = _json_payload()
        url = normalize_url(str(payload.get("url") or ""))
        if not url:
            return _error("Article URL is required.", 400)

        pipeline = _pipeline(require_supabase=False, require_gemini=True)
        data = pipeline.summarize_article_url(url)
        if data is None:
            return _error("No article JSON was generated.", 422)
        return jsonify({"article_url": url, "domain": root_domain(url), "data": data})

    @app.post("/api/control/run/collect")
    def run_collect():
        return _start_run_job(job_manager, "collect")

    @app.post("/api/control/run/summarize")
    def run_summarize():
        return _start_run_job(job_manager, "summarize")

    @app.post("/api/control/run/full")
    def run_full():
        return _start_run_job(job_manager, "full")

    @app.get("/api/control/run/status")
    def run_status():
        return jsonify({"task": job_manager.current_task()})

    @app.post("/api/control/run/cancel")
    def cancel_run():
        task = job_manager.cancel()
        if task is None:
            return _error("No running task to cancel.", 404)
        return jsonify({"task": task})

    @app.errorhandler(Exception)
    def handle_error(error: Exception):  # noqa: ANN001 - Flask passes generic exceptions.
        code = getattr(error, "code", 500)
        if not isinstance(code, int):
            code = 500
        if code < 400 or code > 599:
            code = 500
        return _error(str(error), code)

    return app


def _start_run_job(job_manager: "ControlJobManager", name: str):
    try:
        task = job_manager.start(name)
    except RuntimeError as error:
        return _error(str(error), 409)
    return jsonify({"task": task}), 202


def _pipeline(
    *,
    require_supabase: bool,
    require_gemini: bool,
    cancel_event: Event | None = None,
    ui: Any | None = None,
):
    from lathala.services.pipeline import NewsPipeline

    settings = _settings(require_supabase=require_supabase, require_gemini=require_gemini)
    return NewsPipeline(settings=settings, cancel_event=cancel_event, ui=ui)


@dataclass
class ControlTask:
    """Background control-panel task state."""

    id: str
    name: str
    cancel_event: Event
    status: str = "running"
    result: dict[str, Any] | None = None
    error: str | None = None
    message: str = "Starting..."
    logs: list[str] = field(default_factory=list)
    started_at: float = field(default_factory=time)
    finished_at: float | None = None
    thread: Thread | None = field(default=None, repr=False)

    def snapshot(self) -> dict[str, Any]:
        """Return JSON-safe task state."""
        return {
            "id": self.id,
            "name": self.name,
            "status": self.status,
            "result": self.result,
            "error": self.error,
            "message": self.message,
            "logs": self.logs[-60:],
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


class ControlJobManager:
    """Run one cancellable workflow task at a time."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._task: ControlTask | None = None

    def start(self, name: str) -> dict[str, Any]:
        """Start a workflow task in a background thread."""
        with self._lock:
            if self._task is not None and self._task.status in {"running", "cancelling"}:
                raise RuntimeError(f"{self._task.name} is already running.")

            task = ControlTask(id=uuid4().hex, name=name, cancel_event=Event())
            thread = Thread(target=self._run, args=(task,), daemon=True)
            task.thread = thread
            self._task = task
            thread.start()
            return task.snapshot()

    def cancel(self) -> dict[str, Any] | None:
        """Request cancellation for the active task."""
        with self._lock:
            if self._task is None or self._task.status not in {"running", "cancelling"}:
                return None
            self._task.cancel_event.set()
            self._task.status = "cancelling"
            self._task.message = "Cancelling at the next checkpoint..."
            self._append_log_locked(self._task, "Cancellation requested.")
            return self._task.snapshot()

    def current_task(self) -> dict[str, Any] | None:
        """Return the most recent task, if any."""
        with self._lock:
            return self._task.snapshot() if self._task is not None else None

    def _run(self, task: ControlTask) -> None:
        ui = WebJobEffects(lambda message: self._append_log(task, message))
        try:
            pipeline = _pipeline(
                require_supabase=True,
                require_gemini=True,
                cancel_event=task.cancel_event,
                ui=ui,
            )
            if task.name == "collect":
                result = {"saved_article_urls": pipeline.collect_article_links()}
            elif task.name == "summarize":
                result = {
                    "saved_article_summaries": pipeline.summarize_articles(
                        batch_size=pipeline.settings.batch_size
                    )
                }
            elif task.name == "full":
                pipeline.run()
                result = {"ok": True}
            else:
                raise ValueError(f"Unknown run task: {task.name}")

            with self._lock:
                task.status = "finished"
                task.result = result
                task.message = "Finished."
                task.finished_at = time()
                self._append_log_locked(task, "Finished.")
        except JobCancelledError:
            with self._lock:
                task.status = "cancelled"
                task.message = "Cancelled."
                task.finished_at = time()
                self._append_log_locked(task, "Cancelled.")
        except Exception as error:  # noqa: BLE001 - surface failures to the local UI.
            with self._lock:
                task.status = "error"
                task.error = str(error)
                task.message = "Failed."
                task.finished_at = time()
                self._append_log_locked(task, f"ERROR: {error}")

    def _append_log(self, task: ControlTask, message: str) -> None:
        with self._lock:
            self._append_log_locked(task, message)

    def _append_log_locked(self, task: ControlTask, message: str) -> None:
        task.message = message
        task.logs.append(message)
        if len(task.logs) > 100:
            del task.logs[: len(task.logs) - 100]


class WebJobEffects:
    """Small UI adapter that stores pipeline progress for polling."""

    def __init__(self, on_log) -> None:  # noqa: ANN001 - small callback protocol.
        self._on_log = on_log

    def info(self, message: str) -> None:
        self._on_log(message)

    def success(self, message: str) -> None:
        self._on_log(message)

    def warning(self, message: str) -> None:
        self._on_log(f"WARN: {message}")

    def error(self, message: str) -> None:
        self._on_log(f"ERROR: {message}")

    @contextmanager
    def status(self, message: str):
        self._on_log(message)
        yield

    @contextmanager
    def progress(self):
        yield WebJobProgress(self._on_log)


class WebJobProgress:
    """Progress adapter for background admin jobs."""

    def __init__(self, on_log) -> None:  # noqa: ANN001 - small callback protocol.
        self._on_log = on_log
        self._next_id = 1
        self._counts: dict[int, int] = {}
        self._totals: dict[int, int] = {}

    def add_task(self, description: str, total: int) -> int:
        task_id = self._next_id
        self._next_id += 1
        self._counts[task_id] = 0
        self._totals[task_id] = total
        self._on_log(f"{description}: 0/{total}")
        return task_id

    def advance(self, task_id: int, description: str | None = None) -> None:
        self._counts[task_id] += 1
        total = self._totals[task_id]
        label = description or "Progress"
        self._on_log(f"{label}: {self._counts[task_id]}/{total}")


def _repository(*, require_gemini: bool) -> ArticleRepository:
    settings = _settings(require_supabase=True, require_gemini=require_gemini)
    return ArticleRepository(settings)


def _settings_and_repository(*, require_gemini: bool) -> tuple[Settings, ArticleRepository]:
    settings = Settings.from_env(require_supabase=True, require_gemini=require_gemini)
    repository = ArticleRepository(settings)
    return settings, repository


def _settings(*, require_supabase: bool, require_gemini: bool) -> Settings:
    settings = Settings.from_env(
        require_supabase=require_supabase,
        require_gemini=require_gemini,
    )
    if settings.supabase_url and settings.supabase_service_role_key:
        try:
            repository = ArticleRepository(settings)
            return settings.with_runtime_values(repository.get_runtime_settings())
        except Exception:
            if require_supabase:
                raise
    return settings


def _json_payload() -> dict[str, Any]:
    payload = request.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


def _publisher_payload() -> dict[str, Any]:
    payload = _json_payload()
    source_urls = payload.get("source_urls")
    if isinstance(source_urls, str):
        source_urls = source_urls.splitlines()
    if not isinstance(source_urls, list):
        source_urls = []
    return {
        "name": payload.get("name"),
        "domain": payload.get("domain"),
        "source_urls": source_urls,
    }


def _error(message: str, status_code: int):
    return jsonify({"error": message}), status_code
