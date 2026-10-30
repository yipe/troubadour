"""Tonight's notebook: what the table said that is worth keeping, plus the GM's pins.

One `Notebook` belongs to one live session. Every change is checked against "is this still the live
session?" first, so an abandoned session never emits or saves. The notebook's own small lock guards its
lists; the engine lock is only taken (briefly, by the `is_live` callback) and never while the notebook
lock is held.
"""

import json
import logging
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path

from troubadour.core.fsutil import write_atomic

log = logging.getLogger("troubadour")

KINDS = ("fact", "update", "entry", "spelling")
STATUSES = ("open", "kept", "dismissed")
CONFIDENCES = ("gm", "theory", "once")
MAX_PIN_TEXT = 500
MAX_TEXT = 1000  # an item's text; LLM output is cut here


@dataclass
class NotebookItem:
    id: str
    kind: str
    text: str
    old: str | None = None
    about: str | None = None
    entry_type: str | None = None
    said_by: dict | None = None  # {"name", "player_id"}
    t: float | None = None
    line_id: str | None = None
    confidence: str | None = None
    count: int | None = None
    status: str = "open"

    @classmethod
    def from_dict(cls, raw: dict) -> "NotebookItem | None":
        """An item from untrusted input (the LLM pass), or None when it isn't usable."""
        kind, text = raw.get("kind"), raw.get("text")
        if kind not in KINDS or not isinstance(text, str) or not text.strip():
            return None

        def opt_str(key: str, cap: int = 200) -> str | None:
            value = raw.get(key)
            return value.strip()[:cap] or None if isinstance(value, str) else None

        said_by = raw.get("said_by")
        if isinstance(said_by, dict) and isinstance(said_by.get("name"), str) and said_by["name"].strip():
            player_id = said_by.get("player_id")
            said_by = {"name": said_by["name"].strip()[:100], "player_id": player_id if isinstance(player_id, str) else None}
        else:
            said_by = None
        t, count = raw.get("t"), raw.get("count")
        confidence = raw.get("confidence")
        return cls(
            id=uuid.uuid4().hex[:12],
            kind=kind,
            text=text.strip()[:MAX_TEXT],
            old=opt_str("old", MAX_TEXT),
            about=opt_str("about"),
            entry_type=opt_str("entry_type", 40),
            said_by=said_by,
            t=float(t) if isinstance(t, (int, float)) and not isinstance(t, bool) and t >= 0 else None,
            line_id=opt_str("line_id", 40),
            confidence=confidence if confidence in CONFIDENCES else None,
            count=count if isinstance(count, int) and not isinstance(count, bool) and count >= 0 else None,
        )


@dataclass
class Pin:
    id: str
    t: float
    text: str
    created_at: float


@dataclass
class Notebook:
    session_id: str | None
    items: list[NotebookItem] = field(default_factory=list)
    pins: list[Pin] = field(default_factory=list)
    updating: bool = False
    # Wired by the engine for a live session; a loaded or empty notebook never emits.
    emit: Callable[[dict], None] | None = field(default=None, repr=False)
    is_live: Callable[[], bool] = field(default=lambda: True, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def to_json(self) -> dict:
        with self._lock:
            return self._json()

    def _json(self) -> dict:
        return {
            "session_id": self.session_id,
            "items": [asdict(i) for i in self.items],
            "pins": [asdict(p) for p in self.pins],
            "updating": self.updating,
        }

    def _publish(self, snapshot: dict) -> None:
        """Announce a change, unless the session was abandoned meanwhile."""
        if self.emit is not None and self.is_live():
            self.emit(snapshot)

    def add_items(self, items: list[dict]) -> list[dict]:
        """Append items from the notebook pass (C4). Unusable entries are dropped. Returns the added ones."""
        if not self.is_live():
            return []
        added = [i for raw in items if (i := NotebookItem.from_dict(raw)) is not None]
        with self._lock:
            self.items.extend(added)
            snapshot = self._json()
        self._publish(snapshot)
        return [asdict(i) for i in added]

    def set_updating(self, updating: bool) -> None:
        if not self.is_live():
            return
        with self._lock:
            if self.updating == updating:
                return
            self.updating = updating
            snapshot = self._json()
        self._publish(snapshot)

    def set_status(self, item_id: str, status: str) -> dict:
        """KeyError for an unknown item or an abandoned session; ValueError for a bad status."""
        if status not in STATUSES:
            raise ValueError(f"status must be one of {', '.join(STATUSES)}")
        if not self.is_live():
            raise KeyError(item_id)
        with self._lock:
            item = next((i for i in self.items if i.id == item_id), None)
            if item is None:
                raise KeyError(item_id)
            item.status = status
            snapshot, out = self._json(), asdict(item)
        self._publish(snapshot)
        return out

    def add_pin(self, t: float, text: str) -> dict:
        if not self.is_live():
            raise ValueError("no session is running")
        pin = Pin(id=uuid.uuid4().hex[:12], t=t, text=text, created_at=time.time())
        with self._lock:
            self.pins.append(pin)
            snapshot = self._json()
        self._publish(snapshot)
        return asdict(pin)

    def save(self, path: Path) -> None:
        """Write the notebook for a session that ended; nothing for one that was abandoned."""
        if not self.is_live():
            return
        with self._lock:
            snapshot = self._json()
        snapshot["updating"] = False
        write_atomic(path, json.dumps(snapshot, ensure_ascii=False))

    @classmethod
    def load(cls, path: Path, session_id: str | None = None) -> "Notebook":
        """A saved notebook; an empty one when the file is missing or unreadable."""
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            items = [i for r in raw["items"] if isinstance(r, dict) and (i := _stored_item(r)) is not None]
            pins = [Pin(str(p["id"]), float(p["t"]), str(p["text"]), float(p["created_at"])) for p in raw["pins"]]
        except FileNotFoundError:
            return cls(session_id)
        except (OSError, ValueError, KeyError, TypeError) as e:
            log.warning("unreadable notebook %s: %s", path, e)
            return cls(session_id)
        return cls(session_id, items, pins)


def _stored_item(raw: dict) -> NotebookItem | None:
    item = NotebookItem.from_dict(raw)
    if item is None:
        return None
    if isinstance(raw.get("id"), str) and raw["id"]:
        item.id = raw["id"]
    if raw.get("status") in STATUSES:
        item.status = raw["status"]
    return item
