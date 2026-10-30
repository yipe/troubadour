"""The in-process event bus: the engine emits, each WebSocket reads its own queue."""

import asyncio
import json
import threading

OVERFLOW = "__overflow__"  # queued to a WebSocket whose client fell behind: server closes it, client resyncs


class Bus:
    """Fan-out of events from any thread to every WebSocket's asyncio queue."""

    QUEUE_MAX = 2000

    def __init__(self):
        self.loop: asyncio.AbstractEventLoop | None = None
        self._subs: set[asyncio.Queue] = set()
        self._lock = threading.Lock()

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=self.QUEUE_MAX)
        with self._lock:
            self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        with self._lock:
            self._subs.discard(q)

    def emit(self, type_: str, data) -> None:
        loop = self.loop
        if loop is None or loop.is_closed():
            return
        msg = json.dumps({"type": type_, "data": data})
        with self._lock:
            subs = list(self._subs)
        for q in subs:
            try:
                loop.call_soon_threadsafe(self._put, q, msg)
            except RuntimeError:  # loop shut down between the check and the call
                return

    @staticmethod
    def _put(q: asyncio.Queue, msg: str) -> None:
        try:
            q.put_nowait(msg)
        except asyncio.QueueFull:
            # The client missed events; replace its backlog with a marker so the
            # server closes the socket and the client reconnects to a fresh snapshot.
            while not q.empty():
                q.get_nowait()
            q.put_nowait(OVERFLOW)
