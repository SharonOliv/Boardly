import os
import tempfile

# Must be set before the app is imported: tests run on a throwaway SQLite file, never your real database.
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/test.db"
os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ.pop("METRICS_TOKEN", None)
os.environ.pop("ENV", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import routes  # noqa: E402
from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_database():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    routes._ai_calls.clear()
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def signup(client):
    """signup("Ann") -> (auth headers, user dict)."""
    def _signup(name: str, password: str = "secret1"):
        email = f"{name.lower()}@example.com"
        r = client.post("/auth/signup", json={"email": email, "name": name, "password": password})
        assert r.status_code == 200, r.text
        body = r.json()
        return {"Authorization": f"Bearer {body['access_token']}"}, body["user"]
    return _signup


@pytest.fixture
def board(client, signup):
    """An owner (Olivia) with one workspace, one board with three lists, and a helper to add cards."""
    headers, user = signup("Olivia")
    ws = client.post("/workspaces", json={"name": "Team"}, headers=headers).json()
    b = client.post(f"/workspaces/{ws['id']}/boards", json={"name": "Sprint"}, headers=headers).json()
    data = client.get(f"/boards/{b['id']}", headers=headers).json()

    class World:
        owner_headers, owner, workspace, board_id = headers, user, ws, b["id"]
        lists = data["lists"]

        @staticmethod
        def add_card(title: str, list_index: int = 0, hdrs=None):
            r = client.post(f"/lists/{World.lists[list_index]['id']}/cards", json={"title": title},
                            headers=hdrs or headers)
            assert r.status_code == 200, r.text
            return r.json()

        @staticmethod
        def snapshot(hdrs=None):
            return client.get(f"/boards/{World.board_id}", headers=hdrs or headers).json()

        @staticmethod
        def titles(list_index: int = 0):
            return [c["title"] for c in World.snapshot()["lists"][list_index]["cards"]]

    return World


@pytest.fixture
def add_member(client, board, signup):
    """add_member("Mia", "member"|"viewer") -> (headers, user) already inside the board's workspace."""
    def _add(name: str, role: str = "member"):
        headers, user = signup(name)
        r = client.post(f"/workspaces/{board.workspace['id']}/members",
                        json={"email": user["email"], "role": role}, headers=board.owner_headers)
        assert r.status_code == 200, r.text
        return headers, user
    return _add