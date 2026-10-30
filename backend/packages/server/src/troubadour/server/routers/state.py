"""Live state: the snapshot, memory stats and the WebSocket."""

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from troubadour.engine import OVERFLOW
from troubadour.server import deps

router = APIRouter()


@router.get("/api/state")
def state():
    return deps.engine.snapshot()


@router.get("/api/debug/memory")
def debug_memory():
    return deps.engine.memory_stats()


@router.websocket("/ws")
async def ws(socket: WebSocket):
    if not deps._origin_ok(socket.headers.get("origin")):
        await socket.close(code=1008)
        return
    await socket.accept()
    q = deps.bus.subscribe()  # before the snapshot, so nothing is missed (the UI applies events idempotently)

    async def until_disconnect():
        while True:
            await socket.receive_text()  # raises WebSocketDisconnect when the tab goes away

    gone = asyncio.create_task(until_disconnect())
    try:
        await socket.send_json({"type": "snapshot", "data": deps.engine.snapshot()})
        while True:
            nxt = asyncio.create_task(q.get())
            done, _ = await asyncio.wait({nxt, gone}, return_when=asyncio.FIRST_COMPLETED)
            if gone in done:
                nxt.cancel()
                break
            msg = nxt.result()
            if msg == OVERFLOW:
                await socket.close(code=1013)  # client fell behind; it reconnects and gets a fresh snapshot
                break
            await socket.send_text(msg)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        gone.cancel()
        deps.bus.unsubscribe(q)
