from datetime import datetime, timedelta, timezone

import jwt

from app.auth import SECRET


def test_signup_returns_token_and_user(client):
    r = client.post("/auth/signup", json={"email": "Ann@Example.com", "name": "Ann", "password": "secret1"})
    assert r.status_code == 200
    assert r.json()["user"]["email"] == "ann@example.com"  # normalised to lowercase
    assert "password" not in r.text


def test_password_is_hashed_in_database(client):
    client.post("/auth/signup", json={"email": "a@x.com", "name": "Ann", "password": "secret1"})
    from app import models as m
    from app.db import SessionLocal
    with SessionLocal() as db:
        stored = db.query(m.User).one().password_hash
    assert stored != "secret1" and stored.startswith("$2")  # bcrypt


def test_duplicate_email_rejected(client):
    body = {"email": "a@x.com", "name": "Ann", "password": "secret1"}
    assert client.post("/auth/signup", json=body).status_code == 200
    assert client.post("/auth/signup", json=body).status_code == 400


def test_signup_validation(client):
    assert client.post("/auth/signup", json={"email": "nope", "name": "A", "password": "secret1"}).status_code == 400
    assert client.post("/auth/signup", json={"email": "a@x.com", "name": "A", "password": "123"}).status_code == 400
    assert client.post("/auth/signup", json={"email": "a@x.com", "name": "  ", "password": "secret1"}).status_code == 400


def test_login_success_and_failure(client, signup):
    signup("Ann")
    ok = client.post("/auth/login", data={"username": "ann@example.com", "password": "secret1"})
    assert ok.status_code == 200 and ok.json()["access_token"]
    assert client.post("/auth/login", data={"username": "ann@example.com", "password": "wrong"}).status_code == 401
    assert client.post("/auth/login", data={"username": "ghost@example.com", "password": "secret1"}).status_code == 401


def test_me_requires_valid_token(client, signup):
    headers, user = signup("Ann")
    assert client.get("/auth/me", headers=headers).json()["id"] == user["id"]
    assert client.get("/auth/me").status_code == 401
    assert client.get("/auth/me", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_tampered_and_expired_tokens_rejected(client, signup):
    headers, user = signup("Ann")
    forged = jwt.encode({"sub": str(user["id"]), "exp": datetime.now(timezone.utc) + timedelta(days=1)},
                        "x" * 40, algorithm="HS256")
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    expired = jwt.encode({"sub": str(user["id"]), "exp": datetime.now(timezone.utc) - timedelta(minutes=1)},
                         SECRET, algorithm="HS256")
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {expired}"}).status_code == 401


def test_protected_routes_need_login(client):
    for path in ("/workspaces", "/boards/1", "/cards/1"):
        assert client.get(path).status_code == 401