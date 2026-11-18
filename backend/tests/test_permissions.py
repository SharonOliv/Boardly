import pytest


def test_outsider_cannot_see_or_touch_anything(client, board, signup):
    outsider, _ = signup("Eve")
    card = board.add_card("Secret")
    assert client.get(f"/boards/{board.board_id}", headers=outsider).status_code == 403
    assert client.get(f"/cards/{card['id']}", headers=outsider).status_code == 403
    assert client.post(f"/lists/{board.lists[0]['id']}/cards", json={"title": "x"}, headers=outsider).status_code == 403
    assert client.patch(f"/cards/{card['id']}", json={"title": "pwn"}, headers=outsider).status_code == 403
    assert client.get(f"/workspaces/{board.workspace['id']}/members", headers=outsider).status_code == 403
    assert client.get("/workspaces", headers=outsider).json() == []


def test_viewer_can_read_but_not_write(client, board, add_member):
    viewer, _ = add_member("Vera", "viewer")
    card = board.add_card("Task")
    assert client.get(f"/boards/{board.board_id}", headers=viewer).json()["role"] == "viewer"
    assert client.get(f"/cards/{card['id']}", headers=viewer).status_code == 200
    list_id = board.lists[0]["id"]
    assert client.post(f"/lists/{list_id}/cards", json={"title": "x"}, headers=viewer).status_code == 403
    assert client.post(f"/boards/{board.board_id}/lists", json={"title": "x"}, headers=viewer).status_code == 403
    assert client.patch(f"/cards/{card['id']}", json={"title": "x"}, headers=viewer).status_code == 403
    assert client.patch(f"/cards/{card['id']}/move", json={"list_id": list_id, "position": 5}, headers=viewer).status_code == 403
    assert client.post(f"/cards/{card['id']}/comments", json={"body": "hi"}, headers=viewer).status_code == 403
    assert client.delete(f"/cards/{card['id']}", headers=viewer).status_code == 403
    assert board.titles() == ["Task"]  # nothing changed


def test_member_can_edit(client, board, add_member):
    member, _ = add_member("Mia")
    card = board.add_card("By Mia", hdrs=member)
    assert client.patch(f"/cards/{card['id']}", json={"priority": "high"}, headers=member).json()["priority"] == "high"
    assert client.post(f"/cards/{card['id']}/comments", json={"body": "hi"}, headers=member).status_code == 200


def test_only_owner_can_invite(client, board, add_member, signup):
    member, _ = add_member("Mia")
    _, newcomer = signup("Nia")
    url = f"/workspaces/{board.workspace['id']}/members"
    assert client.post(url, json={"email": newcomer["email"]}, headers=member).status_code == 403
    assert client.post(url, json={"email": newcomer["email"]}, headers=board.owner_headers).status_code == 200


def test_invite_edge_cases(client, board, add_member):
    _, mia = add_member("Mia")
    url = f"/workspaces/{board.workspace['id']}/members"
    assert client.post(url, json={"email": "ghost@example.com"}, headers=board.owner_headers).status_code == 404
    assert client.post(url, json={"email": mia["email"]}, headers=board.owner_headers).status_code == 400  # already in
    assert client.post(url, json={"email": mia["email"], "role": "owner"}, headers=board.owner_headers).status_code == 400


def test_only_owner_can_delete_board(client, board, add_member):
    member, _ = add_member("Mia")
    assert client.delete(f"/boards/{board.board_id}", headers=member).status_code == 403
    assert client.delete(f"/boards/{board.board_id}", headers=board.owner_headers).status_code == 200
    assert client.get(f"/boards/{board.board_id}", headers=board.owner_headers).status_code == 404


def test_assignee_must_belong_to_workspace(client, board, signup, add_member):
    _, outsider = signup("Eve")
    _, mia = add_member("Mia")
    card = board.add_card("Task")
    url = f"/cards/{card['id']}"
    assert client.patch(url, json={"assignee_id": outsider["id"]}, headers=board.owner_headers).status_code == 400
    assert client.patch(url, json={"assignee_id": mia["id"]}, headers=board.owner_headers).json()["assignee_id"] == mia["id"]
    assert client.patch(url, json={"assignee_id": None}, headers=board.owner_headers).json()["assignee_id"] is None


def test_only_author_can_delete_comment(client, board, add_member):
    ann, _ = add_member("Ann")
    bob, _ = add_member("Bob")
    card = board.add_card("Task")
    cid = client.post(f"/cards/{card['id']}/comments", json={"body": "mine"}, headers=ann).json()["id"]
    assert client.delete(f"/comments/{cid}", headers=bob).status_code == 403
    assert client.delete(f"/comments/{cid}", headers=ann).status_code == 200


@pytest.mark.parametrize("priority", ["urgent", "", "HIGH"])
def test_invalid_priority_rejected(client, board, priority):
    card = board.add_card("Task")
    r = client.patch(f"/cards/{card['id']}", json={"priority": priority}, headers=board.owner_headers)
    assert r.status_code == 400