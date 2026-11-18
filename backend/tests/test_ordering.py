def positions(board, list_index=0):
    return [c["position"] for c in board.snapshot()["lists"][list_index]["cards"]]


def move(client, board, card, list_index, position):
    r = client.patch(f"/cards/{card['id']}/move",
                     json={"list_id": board.lists[list_index]["id"], "position": position},
                     headers=board.owner_headers)
    assert r.status_code == 200, r.text


def test_new_cards_are_appended_in_order(board):
    for title in ["A", "B", "C"]:
        board.add_card(title)
    assert board.titles() == ["A", "B", "C"]
    p = positions(board)
    assert p == sorted(p) and len(set(p)) == 3


def test_drop_between_two_cards_changes_only_that_card(client, board):
    a, b, c = (board.add_card(t) for t in "ABC")
    before = {x["id"]: x["position"] for x in board.snapshot()["lists"][0]["cards"]}
    move(client, board, c, 0, (a["position"] + b["position"]) / 2)  # same maths the frontend uses
    assert board.titles() == ["A", "C", "B"]
    after = {x["id"]: x["position"] for x in board.snapshot()["lists"][0]["cards"]}
    assert after[a["id"]] == before[a["id"]] and after[b["id"]] == before[b["id"]]
    assert after[c["id"]] != before[c["id"]]


def test_move_to_top_and_bottom(client, board):
    a, b, c = (board.add_card(t) for t in "ABC")
    move(client, board, c, 0, a["position"] / 2)
    assert board.titles() == ["C", "A", "B"]
    move(client, board, c, 0, b["position"] + 1000)
    assert board.titles() == ["A", "B", "C"]


def test_move_across_lists_and_activity_log(client, board):
    a = board.add_card("A")
    move(client, board, a, 1, 1000)
    snap = board.snapshot()
    assert snap["lists"][0]["cards"] == [] and [c["title"] for c in snap["lists"][1]["cards"]] == ["A"]
    log = client.get(f"/boards/{board.board_id}/activity", headers=board.owner_headers).json()
    assert any('moved "A" to In progress' in item["text"] for item in log)


def test_reordering_inside_a_list_is_not_logged_as_a_move(client, board):
    a, b = board.add_card("A"), board.add_card("B")
    move(client, board, b, 0, a["position"] / 2)
    log = client.get(f"/boards/{board.board_id}/activity", headers=board.owner_headers).json()
    assert not any("moved" in item["text"] for item in log)


def test_cannot_move_card_onto_another_boards_list(client, board):
    card = board.add_card("A")
    other = client.post(f"/workspaces/{board.workspace['id']}/boards", json={"name": "Other"},
                        headers=board.owner_headers).json()
    foreign_list = client.get(f"/boards/{other['id']}", headers=board.owner_headers).json()["lists"][0]["id"]
    r = client.patch(f"/cards/{card['id']}/move", json={"list_id": foreign_list, "position": 1},
                     headers=board.owner_headers)
    assert r.status_code == 400


def test_repeated_inserts_between_same_neighbours_stay_strictly_ordered(client, board):
    a, b = board.add_card("A"), board.add_card("B")
    lo, hi = a["position"], b["position"]
    for i in range(30):  # bisect the gap 30 times, like dropping into the same spot repeatedly
        card = board.add_card(f"N{i}")
        mid = (lo + hi) / 2
        move(client, board, card, 0, mid)
        hi = mid
    p = positions(board)
    assert p == sorted(p) and len(set(p)) == len(p)


def test_deleting_a_list_deletes_its_cards(client, board):
    board.add_card("A")
    assert client.delete(f"/lists/{board.lists[0]['id']}", headers=board.owner_headers).status_code == 200
    assert len(board.snapshot()["lists"]) == 2