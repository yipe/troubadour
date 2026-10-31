"""The story so far: per-session places, talk, new entries and accepted facts, and how often an entry
turns up in each session.

Finding names means reading every transcript, so one pass per session is cached. The cache key is the
transcript's mtime plus a fingerprint of the names being searched for, so a new or renamed entry (made
here or in Obsidian) rescans, and a second request with nothing changed rescans nothing.
"""

import json
import re
import threading
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from .campaign import Entity, Vault, everyday

MAX_FALLBACK_PLACES = 3


@dataclass(frozen=True)
class Mentions:
    """What one transcript says about each entry: how many times, and where first (character offset)."""

    counts: dict[str, int]
    first: dict[str, int]


@dataclass(frozen=True)
class _Needles:
    owner: dict[str, str]  # casefolded name or alias -> entry name
    rx: re.Pattern[str] | None
    key: tuple[tuple[str, str], ...]  # the fingerprint a cached scan must match


_lock = threading.Lock()
_cache: dict[str, tuple[int, tuple[tuple[str, str], ...], Mentions]] = {}  # session id -> (mtime_ns, needles, result)


def _needles(entities: Iterable[Entity]) -> _Needles:
    """Same rules as campaign.mention_counts: an alias that is an ordinary word doesn't count."""
    entities = list(entities)
    owner: dict[str, str] = {}
    for e in entities:
        for alias in e.aliases:
            folded = alias.casefold()
            if len(folded) >= 2 and not everyday(folded):
                owner.setdefault(folded, e.name)
    for e in entities:
        if len(e.name) >= 2:
            owner[e.name.casefold()] = e.name
    if not owner:
        return _Needles(owner, None, ())
    alternatives = "|".join(re.escape(n) for n in sorted(owner, key=len, reverse=True))
    rx = re.compile(rf"(?<![a-z0-9])(?:{alternatives})(?![a-z0-9])")
    return _Needles(owner, rx, tuple(sorted(owner.items())))


def _transcript_text(path: Path) -> str | None:
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
        return "\n".join(str(m.get("text", "")) for m in record["messages"]).casefold()
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None


def _scan(text: str, needles: _Needles) -> Mentions:
    counts: dict[str, int] = {}
    first: dict[str, int] = {}
    if needles.rx is not None:
        for m in needles.rx.finditer(text):
            name = needles.owner[m.group()]
            counts[name] = counts.get(name, 0) + 1
            first.setdefault(name, m.start())
    return Mentions(counts, first)


def _notes_page(vault: Vault, sessions_dir: Path, sid: str) -> Path | None:
    """The vault page of a notes-only session (imported notes standing in for a recording), if `sid` is one."""
    try:
        meta = json.loads((sessions_dir / sid / "meta.json").read_text(encoding="utf-8"))
        if meta.get("kind") != "notes":
            return None
        root = vault.root.resolve()
        path = (root / str(meta["note"])).resolve()
    except (OSError, ValueError, KeyError, AttributeError):
        return None
    return path if path.is_relative_to(root) else None


def _page_text(path: Path) -> str | None:
    try:
        return re.sub(r"\A---\n.*?\n---\n", "", path.read_text(encoding="utf-8"), count=1, flags=re.S).casefold()
    except OSError:
        return None


def session_mentions(vault: Vault, sessions_dir: Path, sid: str, needles: _Needles) -> Mentions:
    """Names in a session: its transcript, or for a notes-only session its notes page."""
    path = sessions_dir / sid / "transcript.json"
    read = _transcript_text
    if not path.is_file() and (page := _notes_page(vault, sessions_dir, sid)) is not None:
        path, read = page, _page_text
    try:
        mtime = path.stat().st_mtime_ns
    except OSError:
        return Mentions({}, {})
    key = needles.key
    with _lock:
        hit = _cache.get(sid)
    if hit is not None and hit[0] == mtime and hit[1] == key:
        return hit[2]
    text = read(path)
    found = _scan(text, needles) if text is not None else Mentions({}, {})
    with _lock:
        _cache[sid] = (mtime, key, found)
    return found


def _oldest_first(rows: list[dict]) -> list[dict]:
    return sorted(rows, key=lambda r: (r.get("started_at") or 0, r["id"]))


def _scenes_places(scenes: list[dict] | None) -> list[str]:
    places: list[str] = []
    for scene in scenes or []:
        place = scene.get("place")
        if place and (not places or places[-1] != place):
            places.append(place)
    return places


def timeline(
    vault: Vault,
    sessions_dir: Path,
    rows: list[dict],
    numbers: dict[str, int],
    titles: dict[str, str | None],
    ids_for: dict[str, str],
) -> list[dict]:
    """One entry per session, newest first. `rows` are the saved sessions (id, started_at, talk, scenes);
    `titles` the write-up titles; `ids_for` maps a session page name to its id for facts that only know the page."""
    entities = vault.entities()
    needles = _needles(entities)
    confirmed = [e for e in entities if e.status == "confirmed"]
    places = {e.name for e in confirmed if e.type == "place"}
    ordered = [r for r in _oldest_first(rows) if r["id"] in numbers]

    mentions = {r["id"]: session_mentions(vault, sessions_dir, r["id"], needles) for r in ordered}
    first_session: dict[str, str] = {}
    for r in ordered:
        for name in mentions[r["id"]].counts:
            first_session.setdefault(name, r["id"])

    accepted: dict[str, int] = {}
    facts = [f for e in confirmed for f in e.facts] + vault.campaign_facts()
    for fact in facts:
        src = fact.source
        sid = (src.session_id or ids_for.get(src.session_page)) if src else None
        if sid:
            accepted[sid] = accepted.get(sid, 0) + 1

    out = []
    for r in ordered:
        sid = r["id"]
        seen = mentions[sid]
        session_places = _scenes_places(r.get("scenes"))
        if not r.get("scenes"):
            by_first = sorted((n for n in seen.first if n in places), key=lambda n: seen.first[n])
            session_places = by_first[:MAX_FALLBACK_PLACES]
        out.append(
            {
                "id": sid,
                "n": numbers[sid],
                "date": datetime.fromtimestamp(r.get("started_at") or 0).strftime("%Y-%m-%d"),
                "title": titles.get(sid) or r.get("title") or None,
                "places": session_places,
                "kind": r.get("kind") or "recording",
                "talk": r.get("talk") or {},
                "new_entities": [{"name": e.name, "type": e.type} for e in confirmed if first_session.get(e.name) == sid],
                "facts_accepted": accepted.get(sid, 0),
            }
        )
    return out[::-1]


def appearances(vault: Vault, sessions_dir: Path, rows: list[dict], numbers: dict[str, int], name: str) -> list[dict]:
    """[{session_id, n, count}] for one entry: every numbered session, oldest first, zeros included."""
    needles = _needles(vault.entities())
    return [
        {
            "session_id": r["id"],
            "n": numbers[r["id"]],
            "count": session_mentions(vault, sessions_dir, r["id"], needles).counts.get(name, 0),
        }
        for r in _oldest_first(rows)
        if r["id"] in numbers
    ]


def all_appearances(vault: Vault, sessions_dir: Path, rows: list[dict], numbers: dict[str, int]) -> dict:
    """{sessions: [{id, n}], counts: {entry: [count per session]}} for every entry in one pass over the
    cached scans. Entries never mentioned are left out (the caller treats a missing entry as all zeros)."""
    needles = _needles(vault.entities())
    ordered = [r for r in _oldest_first(rows) if r["id"] in numbers]
    per_session = [session_mentions(vault, sessions_dir, r["id"], needles).counts for r in ordered]
    names = {name for counts in per_session for name in counts}
    return {
        "sessions": [{"id": r["id"], "n": numbers[r["id"]]} for r in ordered],
        "counts": {name: [counts.get(name, 0) for counts in per_session] for name in sorted(names)},
    }
