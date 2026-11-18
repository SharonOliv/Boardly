"""Structured JSON logging and basic Prometheus-style request metrics (no extra dependencies)."""
import json
import logging
import os
import sys
import threading
import time
from collections import defaultdict
from contextvars import ContextVar
from datetime import datetime, timezone

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")
_STANDARD = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {"message", "asctime", "color_message"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        data = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_ctx.get(),
        }
        for key, value in record.__dict__.items():  # fields passed via logging's `extra=`
            if key not in _STANDARD and not key.startswith("_"):
                data[key] = value
        if record.exc_info:
            data["exc"] = self.formatException(record.exc_info)
        return json.dumps(data, default=str)


def setup_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())
    for name in ("uvicorn", "uvicorn.error"):
        logger = logging.getLogger(name)
        logger.handlers = []
        logger.propagate = True
    logging.getLogger("uvicorn.access").disabled = True  # replaced by our own request log line


class Metrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._requests: dict[tuple, int] = defaultdict(int)
        self._dur_sum: dict[tuple, float] = defaultdict(float)
        self._dur_count: dict[tuple, int] = defaultdict(int)
        self.started = time.time()

    def observe(self, method: str, route: str, status: int, seconds: float) -> None:
        with self._lock:
            self._requests[(method, route, str(status))] += 1
            self._dur_sum[(method, route)] += seconds
            self._dur_count[(method, route)] += 1

    def render(self, gauges: dict[str, float]) -> str:
        lines = ["# HELP boardly_http_requests_total Total HTTP requests.",
                 "# TYPE boardly_http_requests_total counter"]
        with self._lock:
            for (method, route, status), n in sorted(self._requests.items()):
                lines.append(f'boardly_http_requests_total{{method="{method}",route="{route}",status="{status}"}} {n}')
            lines += ["# HELP boardly_http_request_duration_seconds Time spent handling requests.",
                      "# TYPE boardly_http_request_duration_seconds summary"]
            for (method, route), total in sorted(self._dur_sum.items()):
                labels = f'method="{method}",route="{route}"'
                lines.append(f"boardly_http_request_duration_seconds_sum{{{labels}}} {total:.6f}")
                lines.append(f"boardly_http_request_duration_seconds_count{{{labels}}} {self._dur_count[(method, route)]}")
        for name, value in {**gauges, "uptime_seconds": time.time() - self.started}.items():
            lines += [f"# TYPE boardly_{name} gauge", f"boardly_{name} {value:g}"]
        return "\n".join(lines) + "\n"


metrics = Metrics()