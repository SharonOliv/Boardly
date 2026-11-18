import pytest


def token_of(headers):
    return headers["Authorization"].removeprefix("Bearer ")


def test_board_events_reach_connected_clients(client, board):
    card = board.add_card("A")
    with client.websocket_connect(f"/ws/boards/{board.board_id}?token={token_of(board.owner_headers)}") as ws:
        presence = ws.receive_json()
        assert presence["type"] == "presence" and presence["users"][0]["name"] == "Olivia"

        client.patch(f"/cards/{card['id']}/move",
                     json={"list_id": board.lists[1]["id"], "position": 500}, headers=board.owner_headers)
        event = ws.receive_json()
        assert event["type"] == "card_moved" and event["card_id"] == card["id"]

        client.post(f"/cards/{card['id']}/comments", json={"body": "hi"}, headers=board.owner_headers)
        assert ws.receive_json()["type"] == "comment_added"


def test_typing_is_relayed_to_others_but_not_stored(client, board, add_member):
    member, _ = add_member("Mia")
    card = board.add_card("A")
    url = f"/ws/boards/{board.board_id}?token="
    with client.websocket_connect(url + token_of(board.owner_headers)) as owner_ws:
        owner_ws.receive_json()  # own presence
        with client.websocket_connect(url + token_of(member)) as member_ws:
            member_ws.receive_json()  # presence (both users)
            owner_ws.receive_json()   # presence update
            member_ws.send_json({"type": "typing", "card_id": card["id"]})
            event = owner_ws.receive_json()
            assert event["type"] == "typing" and event["user"]["name"] == "Mia"
    log = client.get(f"/boards/{board.board_id}/activity", headers=board.owner_headers).json()
    assert not any("typing" in item["text"] for item in log)


def test_socket_rejects_bad_token_and_outsiders(client, board, signup):
    outsider, _ = signup("Eve")
    with pytest.raises(Exception):
        with client.websocket_connect(f"/ws/boards/{board.board_id}?token=garbage"):
            pass
    with pytest.raises(Exception):
        with client.websocket_connect(f"/ws/boards/{board.board_id}?token={token_of(outsider)}"):
            pass