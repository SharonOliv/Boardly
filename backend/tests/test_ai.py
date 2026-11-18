import pytest

from app import ai


@pytest.mark.parametrize("raw, expected", [
    ('["Write copy", "Review copy"]', ["Write copy", "Review copy"]),
    ('```json\n["One", "Two"]\n```', ["One", "Two"]),
    ('Sure! Here you go: ["One", "Two"] Hope it helps', ["One", "Two"]),
    ('["Same", "same", "  Same  "]', ["Same"]),
    ('["a", 3, null, {"x": 1}, "b"]', ["a", "b"]),
    ("not json at all", []),
    ('{"not": "a list"}', []),
    ("", []),
])
def test_parse_suggestions(raw, expected):
    assert ai.parse_suggestions(raw) == expected


def test_parse_suggestions_caps_count_and_length():
    out = ai.parse_suggestions(str([f"task {i}" for i in range(20)]).replace("'", '"'))
    assert len(out) == ai.MAX_SUGGESTIONS
    assert len(ai.parse_suggestions('["' + "x" * 500 + '"]')[0]) == 120


def test_config_reports_ai_off_without_key(client):
    assert client.get("/config").json() == {"ai_enabled": False}


def test_suggest_returns_503_when_not_configured(client, board):
    card = board.add_card("Plan launch")
    r = client.post(f"/cards/{card['id']}/suggest-subtasks", headers=board.owner_headers)
    assert r.status_code == 503


@pytest.fixture
def fake_ai(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    calls = []

    def fake(title, description):
        calls.append((title, description))
        return ["Draft copy", "Get review", "Publish"]
    monkeypatch.setattr(ai, "suggest_subtasks", fake)
    return calls


def test_suggestions_are_drafts_and_create_no_cards(client, board, fake_ai):
    card = board.add_card("Plan launch")
    r = client.post(f"/cards/{card['id']}/suggest-subtasks", headers=board.owner_headers)
    assert r.status_code == 200 and r.json()["suggestions"] == ["Draft copy", "Get review", "Publish"]
    assert board.titles() == ["Plan launch"]  # human approval is required before anything is created
    assert fake_ai == [("Plan launch", "")]


def test_approved_subtasks_become_cards_right_after_the_parent(client, board, fake_ai):
    a = board.add_card("A")
    board.add_card("B")
    r = client.post(f"/cards/{a['id']}/subtasks", json={"titles": ["S1", "S2", "  "], "source": "ai"},
                    headers=board.owner_headers)
    assert r.status_code == 200 and [c["title"] for c in r.json()] == ["S1", "S2"]
    assert board.titles() == ["A", "S1", "S2", "B"]
    assert all(c["labels"] == ["subtask"] for c in r.json())
    log = client.get(f"/boards/{board.board_id}/activity", headers=board.owner_headers).json()
    assert any("AI-suggested" in item["text"] and "approved by Olivia" in item["text"] for item in log)


def test_subtasks_need_at_least_one_title(client, board):
    a = board.add_card("A")
    assert client.post(f"/cards/{a['id']}/subtasks", json={"titles": ["", " "]}, headers=board.owner_headers).status_code == 400


def test_viewer_and_outsider_cannot_use_ai_or_add_subtasks(client, board, add_member, signup, fake_ai):
    viewer, _ = add_member("Vera", "viewer")
    outsider, _ = signup("Eve")
    card = board.add_card("A")
    for headers in (viewer, outsider):
        assert client.post(f"/cards/{card['id']}/suggest-subtasks", headers=headers).status_code == 403
        assert client.post(f"/cards/{card['id']}/subtasks", json={"titles": ["x"]}, headers=headers).status_code == 403
    assert fake_ai == []


def test_ai_endpoint_is_rate_limited(client, board, fake_ai):
    card = board.add_card("A")
    codes = [client.post(f"/cards/{card['id']}/suggest-subtasks", headers=board.owner_headers).status_code
             for _ in range(11)]
    assert codes[:10] == [200] * 10 and codes[10] == 429


def test_ai_failure_returns_502_not_a_crash(client, board, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

    def boom(title, description):
        raise RuntimeError("upstream down")
    monkeypatch.setattr(ai, "suggest_subtasks", boom)
    card = board.add_card("A")
    assert client.post(f"/cards/{card['id']}/suggest-subtasks", headers=board.owner_headers).status_code == 502