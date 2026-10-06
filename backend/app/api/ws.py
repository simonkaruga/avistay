from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from collections import defaultdict

router = APIRouter(tags=["ws"])

# property_id → set of connected WebSockets
_connections: dict[str, set[WebSocket]] = defaultdict(set)


# The socket endpoint is not mounted (main.py): nothing uses it, and it accepted
# unlimited anonymous connections. broadcast_booking stays a harmless no-op
# until a live calendar is built with limits.
async def property_calendar_ws(websocket: WebSocket, property_id: str):
    await websocket.accept()
    _connections[property_id].add(websocket)
    try:
        while True:
            await websocket.receive_text()  # keep-alive ping from client
    except WebSocketDisconnect:
        _connections[property_id].discard(websocket)


async def broadcast_booking(property_id: str, check_in: str, check_out: str) -> None:
    """Called after payment confirmed — pushes blocked dates to all open browsers."""
    dead = set()
    for ws in _connections.get(property_id, set()):
        try:
            await ws.send_json({
                "event": "dates_blocked",
                "property_id": property_id,
                "check_in": check_in,
                "check_out": check_out,
            })
        except Exception:
            dead.add(ws)
    _connections[property_id] -= dead
