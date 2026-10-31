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
from typing import TYPE_CHECKING

from troubadour.core import config
from troubadour.core.fsutil import write_atomic
from troubadour.lore import notebook as llm_pass

if TYPE_CHECKING:
    from .core import Engine
    from .live_session import LiveSession

log = logging.getLogger("troubadour")

KINDS = ("fact", "update", "entry", "spelling")
STATUSES = ("open", "kept", "dismissed")
CONFIDENCES = ("gm", "theory", "once")
MAX_PIN_TEXT = 500
MAX_TEXT = 1000  # an item's text; LLM output is cut here
WAKE_S = 10  # how often the pass loop looks
MIN_SPEECH_S = 180  # new speech that makes a pass worth running
CONTEXT_S = 60  # earlier speech shown to the model for context
MAX_LINES = 120  # lines in one pass, context included
RETRY_S = 60  # wait after a pass whose model call failed


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
    before_save: Callable[[], None] | None = field(default=None, repr=False)  # the pass loop's last refresh
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

    def sync_spellings(self, spellings: list[dict]) -> None:
        """Bring the spelling items up to date. An item is addressed by its stable id, so a pair already
        listed gets its new count (and keeps its status, even a dismissed one) instead of a duplicate."""
        if not self.is_live():
            return
        with self._lock:
            by_id = {i.id: i for i in self.items if i.kind == "spelling"}
            changed = False
            for raw in spellings:
                raw_id = raw.get("id")
                existing = by_id.get(raw_id) if isinstance(raw_id, str) else None
                if existing is not None:
                    changed |= existing.count != raw.get("count")
                    existing.count = raw.get("count")
                elif isinstance(raw_id, str) and (item := NotebookItem.from_dict(raw)) is not None:
                    item.id = raw_id
                    self.items.append(item)
                    changed = True
            snapshot = self._json() if changed else None
        if snapshot is not None:
            self._publish(snapshot)

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
        if self.before_save is not None:
            self.before_save()
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


class NotebookLoop:
    """Fills one live session's notebook: every WAKE_S it checks whether MIN_SPEECH_S of speech has
    accumulated since the last pass and, if so, asks the live model (the one spelling cleanup uses) for
    candidate facts. The model is never called with the engine lock held, and a down model only means
    the speech keeps counting; transcription never waits for any of this."""

    def __init__(self, engine: "Engine", sess: "LiveSession", clock: Callable[[], float] = time.monotonic):
        self.engine, self.sess, self._clock = engine, sess, clock
        self._passed: set[str] = set()  # ids of lines an earlier pass has read
        self._busy = threading.Lock()  # one pass at a time
        self._retry_at = 0.0
        self._stop = threading.Event()
        self._closing = False  # the session ended: a pass finishing late saves the notebook itself

    def start(self) -> None:
        if config.env("NOTEBOOK", "1") == "0":
            return
        self.sess.notebook.before_save = self.refresh_spellings
        threading.Thread(target=self._run, name="notebook", daemon=True).start()

    def _run(self) -> None:
        while not self._stop.wait(WAKE_S):
            with self.engine.lock:
                running = self.sess is self.engine.live and self.engine.status in ("running", "paused")
            if not running:
                return
            try:
                self.tick()
            except Exception:
                log.exception("notebook pass failed")

    def drain(self, timeout: float) -> bool:
        """The session is ending: start no more passes and wait up to `timeout` s for the one in flight,
        so its items are in the notebook before the final save. False if it was still running; it then
        saves the notebook itself when it finishes (`_pass`)."""
        self._closing = True
        self._stop.set()
        if not self._busy.acquire(timeout=timeout):
            return False
        self._busy.release()
        return True

    def tick(self) -> bool:
        """One wake-up. True when a pass ran."""
        if self._stop.is_set():
            return False
        if not self.engine.llm_ok or self._clock() < self._retry_at:
            return False
        if not self._busy.acquire(blocking=False):
            return False
        try:
            return self._pass()
        finally:
            self._busy.release()

    def _pass(self) -> bool:
        eng, nb = self.engine, self.sess.notebook
        with eng.lock:
            if self.sess is not eng.live:
                return False
            msgs = list(eng.messages.values())
            new = [m for m in msgs if m.id not in self._passed]
            if sum(m.t_end - m.t_start for m in new) < MIN_SPEECH_S:
                return False
            window = new[:MAX_LINES]  # a backlog is read over several passes, oldest first
            budget = MAX_LINES - len(window)
            before = msgs[: msgs.index(window[0])]
            context = [m for m in before if m.t_end >= window[0].t_start - CONTEXT_S][-budget:] if budget else []
            lines = [self._line(m) for m in (*context, *window)]
        nb.set_updating(True)
        try:
            items = llm_pass.propose(eng.cleanup_llm, lines, self._known(lines))
        except Exception as e:  # LLM down, bad reply, vault unreadable: try again later, never stop the session
            log.warning("notebook pass failed: %s", e)
            self._retry_at = self._clock() + RETRY_S
            nb.set_updating(False)
            return False
        with eng.lock:
            if self.sess is not eng.live:
                return False  # abandoned meanwhile: its result must not reach shared state
            self._passed.update(m.id for m in window)
        nb.add_items(items)
        self.refresh_spellings()
        nb.set_updating(False)
        if self._closing:  # the final save already happened without these items
            nb.save(eng.sessions_dir() / self.sess.id / "notebook.json")
        return True

    def _line(self, m) -> llm_pass.Line:
        """A transcript line for the model. Called with the engine lock held."""
        eng = self.engine
        v = eng.voices.get(m.voice_id) if m.voice_id else None
        pid = v.player_id if v else None
        p = eng.players.get(pid) if pid else None
        speaker = p.name if p else (v.label if v and v.label else "")
        return {
            "id": m.id,
            "t": m.t_start,
            "speaker": speaker or "Unknown",
            "player_id": p.id if p else None,
            "is_gm": bool(p and p.is_gm),
            "text": m.text,
        }

    def _known(self, lines: list[llm_pass.Line]) -> llm_pass.Known:
        vault = self.engine.vault
        entities = vault.entities() if vault is not None else []
        said = "\n".join(line["text"] for line in lines).casefold()
        facts = [(e.name, f.text) for e in entities if any(n.casefold() in said for n in e.names()) for f in e.facts]
        return {"entities": [(e.name, e.type, e.aliases) for e in entities], "facts": facts[: llm_pass.MAX_KNOWN_FACTS]}

    def refresh_spellings(self) -> None:
        """Spelling items from the fixes applied so far (no model). Also run just before the notebook is saved."""
        with self.engine.lock:
            if self.sess is not self.engine.live:
                return
            data = [{"text": m.text, "fixes": list(m.fixes)} for m in self.engine.messages.values()]
        self.sess.notebook.sync_spellings(llm_pass.spellings(data))
