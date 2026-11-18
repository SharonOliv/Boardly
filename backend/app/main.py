import logging
import os
import time
import uuid

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from sqlalchemy import text

from .db import engine
from .observability import metrics, request_id_ctx, setup_logging
from .routes import router
from .ws import hub

setup_logging()
log = logging.getLogger("boardly")

app = FastAPI(title="Boardly API")

origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
app.add_middleware(
    CORSMiddleware, allow_origins=origins, allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"], expose_headers=["X-Request-ID"],
)
app.include_router(router)


@app.middleware("http")
async def observe(request: Request, call_next):
    """Give every request an id, time it, count it, and write one structured log line."""
    rid = (request.headers.get("x-request-id") or uuid.uuid4().hex[:12])[:64]
    token = request_id_ctx.set(rid)
    start, status = time.perf_counter(), 500
    try:
        response = await call_next(request)
        status = response.status_code
        response.headers["X-Request-ID"] = rid
        return response
    except Exception:
        log.exception("unhandled_error", extra={"method": request.method, "path": request.url.path})
        raise
    finally:
        seconds = time.perf_counter() - start
        route = getattr(request.scope.get("route"), "path", "unmatched")  # template, not raw URL
        metrics.observe(request.method, route, status, seconds)
        quiet = request.url.path in ("/health", "/metrics")
        log.log(logging.DEBUG if quiet else logging.INFO, "request", extra={
            "method": request.method, "path": request.url.path, "route": route,
            "status": status, "duration_ms": round(seconds * 1000, 1),
        })
        request_id_ctx.reset(token)


@app.get("/health")
def health(response: Response):
    """Liveness + readiness: confirms the API is up and the database answers."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ok", "db": "ok"}
    except Exception:
        log.exception("health_check_failed")
        response.status_code = 503
        return {"status": "degraded", "db": "down"}


@app.get("/metrics", response_class=PlainTextResponse)
def prometheus_metrics(request: Request):
    """Prometheus text format. Set METRICS_TOKEN in production to require a bearer token."""
    expected = os.getenv("METRICS_TOKEN")
    if expected and request.headers.get("authorization") != f"Bearer {expected}":
        raise HTTPException(401, "Metrics token required")
    ws_connections = sum(len(room) for room in hub.rooms.values())
    return PlainTextResponse(
        metrics.render({"websocket_connections": ws_connections}),
        media_type="text/plain; version=0.0.4",
    )