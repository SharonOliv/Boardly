import json
import logging

from app.observability import JsonFormatter


def test_health_reports_ok(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json() == {"status": "ok", "db": "ok"}


def test_health_reports_503_when_database_is_down(client, monkeypatch):
    class BrokenEngine:
        def connect(self):
            raise RuntimeError("db down")
    monkeypatch.setattr("app.main.engine", BrokenEngine())
    r = client.get("/health")
    assert r.status_code == 503 and r.json()["db"] == "down"


def test_every_response_carries_a_request_id(client):
    assert client.get("/health").headers["x-request-id"]
    assert client.get("/health", headers={"X-Request-ID": "abc123"}).headers["x-request-id"] == "abc123"


def test_metrics_count_requests_by_route_template(client, board):
    client.get(f"/boards/{board.board_id}", headers=board.owner_headers)
    client.get("/does-not-exist")
    text = client.get("/metrics").text
    assert 'route="/boards/{bid}"' in text            # template, so ids don't explode cardinality
    assert f'route="/boards/{board.board_id}"' not in text
    assert 'status="404"' in text and 'route="unmatched"' in text
    assert "boardly_http_request_duration_seconds_count" in text
    assert "boardly_websocket_connections" in text


def test_metrics_can_require_a_token(client, monkeypatch):
    monkeypatch.setenv("METRICS_TOKEN", "s3cret")
    assert client.get("/metrics").status_code == 401
    assert client.get("/metrics", headers={"Authorization": "Bearer s3cret"}).status_code == 200


def test_logs_are_valid_json_with_extra_fields():
    record = logging.LogRecord("boardly", logging.INFO, __file__, 1, "request", (), None)
    record.status, record.duration_ms = 200, 12.5
    data = json.loads(JsonFormatter().format(record))
    assert data["msg"] == "request" and data["status"] == 200 and data["duration_ms"] == 12.5
    assert {"ts", "level", "logger", "request_id"} <= set(data)