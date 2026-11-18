from collections import defaultdict

from fastapi import WebSocket


class BoardHub:
    """Keeps track of who is connected to each board and fans out events."""

    def __init__(self):
        self.rooms: dict[int, dict[WebSocket, dict]] = defaultdict(dict)

    def users(self, board_id: int) -> list[dict]:
        return list({u["id"]: u for u in self.rooms[board_id].values()}.values())

    async def connect(self, board_id: int, ws: WebSocket, user: dict):
        await ws.accept()
        self.rooms[board_id][ws] = user
        await self.broadcast(board_id, {"type": "presence", "users": self.users(board_id)})

    async def disconnect(self, board_id: int, ws: WebSocket):
        self.rooms[board_id].pop(ws, None)
        if not self.rooms[board_id]:
            self.rooms.pop(board_id, None)
            return
        await self.broadcast(board_id, {"type": "presence", "users": self.users(board_id)})

    async def broadcast(self, board_id: int, message: dict, exclude: WebSocket | None = None):
        for ws in list(self.rooms.get(board_id, {})):
            if ws is exclude:
                continue
            try:
                await ws.send_json(message)
            except Exception:
                self.rooms[board_id].pop(ws, None)


hub = BoardHub()