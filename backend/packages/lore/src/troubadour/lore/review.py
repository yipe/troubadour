"""Post-session review: the suggestions a session produced, each anchored to a transcript line.

Three kinds of item: a suggested fact (an entry's or the campaign's), a spelling (a misheard glossary name
or an unknown word) and an entry the write-up proposed. The first GET freezes the list in
`sessions/<id>/review.json`, so "5 of 14" stays 14 after a reject removes the suggestion from the vault.
Later GETs only add suggestions that appeared since (a re-run write-up). Decisions are recorded there too.

review.json: {"items": [{id, kind, key, line_id, t, data}], "decisions": {item id: "accepted" | "rejected"}}
`data` is a snapshot of the item's payload, used once the vault no longer has the suggestion.

This module knows nothing of HTTP or the engine: the router hands it a `Context`.
"""

import hashlib
import json
import re
import threading
from collections.abc import Iterable
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Literal

from troubadour.core.fsutil import write_atomic

from .campaign import Vault, same_fact
from .facts import Fact, Source, norm
from .memory import spelling_suggestions

Kind = Literal["fact", "spelling", "entry"]
Status = Literal["open", "accepted", "rejected"]
KINDS: tuple[Kind, ...] = ("fact", "spelling", "entry")


class AlreadyDecided(Exception):
    """The item is no longer open."""


@dataclass
class Context:
    vault: Vault
    session_dir: Path  # sessions/<id>/
    campaign_sessions: list[Path]  # every saved session of the open campaign (their folders)
    page: str | None  # the session's write-up page name; None = not written up
    notebook: list[dict] = field(default_factory=list)  # the saved notebook's items

    @property
    def sid(self) -> str:
        return self.session_dir.name


@dataclass
class Item:
    id: str
    kind: Kind
    key: str
    line_id: str | None = None
    t: float | None = None
    status: Status = "open"
    preaccepted: bool = False
    fact: Fact | None = None
    heard: str | None = None  # spelling
    entity: str | None = None  # spelling: the glossary name it was heard for; None = an unknown word
    count: int = 0
    entry: dict | None = None  # {name, type, description}


# ------------------------------------------------------------------ ids and snapshots


def item_id(kind: Kind, key: str) -> str:
    """Stable and URL-safe: a fact's own id, else a short hash of the normalised key."""
    return f"{kind}:{key if kind == 'fact' else hashlib.sha1(norm(key).encode()).hexdigest()[:10]}"


def _fact_data(f: Fact) -> dict:
    src = f.source
    source = {"page": src.session_page, "session_id": src.session_id, "t": src.t, "label": src.label} if src else None
    return {
        "text": f.text,
        "about": f.about,
        "said_by": f.said_by,
        "source": source,
        "confidence": f.confidence,
        "replaces": f.replaces,
    }


def _fact_from(data: dict) -> Fact:
    s = data.get("source")
    source = Source(s["page"], s.get("session_id"), s.get("t"), s.get("label")) if s else None
    return Fact(
        data["text"],
        data.get("about"),
        data.get("said_by"),
        source,
        data.get("confidence") or "once",
        replaces=data.get("replaces"),
    )


def _data(it: Item) -> dict:
    if it.kind == "fact" and it.fact:
        return _fact_data(it.fact)
    if it.kind == "spelling":
        return {"heard": it.heard, "entity": it.entity, "count": it.count}
    return dict(it.entry or {})


def _restore(row: dict) -> Item:
    kind, data = row["kind"], row.get("data") or {}
    it = Item(row["id"], kind, row["key"], row.get("line_id"), row.get("t"))
    if kind == "fact":
        it.fact = _fact_from(data)
    elif kind == "spelling":
        it.heard, it.entity, it.count = data.get("heard"), data.get("entity"), int(data.get("count") or 0)
    else:
        it.entry = data
    return it


# ------------------------------------------------------------------ transcript anchors


def _messages(session_dir: Path) -> list[dict]:
    try:
        raw = json.loads((session_dir / "transcript.json").read_text(encoding="utf-8")).get("messages", [])
    except (OSError, ValueError, AttributeError):
        return []
    return [m for m in raw if isinstance(m, dict) and isinstance(m.get("text"), str)]


def _line_at(messages: list[dict], t: float) -> dict | None:
    """The line whose span contains t, else the one starting nearest to it."""
    timed = [m for m in messages if isinstance(m.get("t_start"), (int, float))]
    for m in timed:
        if m["t_start"] <= t <= (m.get("t_end") or m["t_start"]):
            return m
    return min(timed, key=lambda m: abs(m["t_start"] - t), default=None)


def _needle(names: Iterable[str]) -> re.Pattern[str] | None:
    folded = sorted({n.casefold() for n in names if len(n.strip()) >= 2}, key=len, reverse=True)
    if not folded:
        return None
    return re.compile(r"(?<![a-z0-9])(?:" + "|".join(re.escape(n) for n in folded) + r")(?![a-z0-9])")


def _first_line(messages: list[dict], names: Iterable[str]) -> dict | None:
    rx = _needle(names)
    return next((m for m in messages if rx and rx.search(m["text"].casefold())), None) if rx else None


def _mentions(messages: list[dict], word: str) -> int:
    rx = _needle([word])
    return sum(len(rx.findall(m["text"].casefold())) for m in messages) if rx else 0


# ------------------------------------------------------------------ building the live candidates


def _source_session(vault: Vault, src: Source | None) -> str | None:
    return (src.session_id or vault.index().ids_for.get(src.session_page)) if src else None


def _fact_item(f: Fact, messages: list[dict]) -> Item:
    t = f.source.t if f.source else None
    line = _line_at(messages, t) if t is not None else None
    return Item(item_id("fact", f.id), "fact", f.id, line["id"] if line else None, t, fact=f)


def _fact_candidates(ctx: Context, messages: list[dict]) -> list[Item]:
    vault, out = ctx.vault, []
    for e in vault.entities():
        out += [_fact_item(f, messages) for f in e.suggested_facts if _source_session(vault, f.source) == ctx.sid]
    out += [_fact_item(f, messages) for f in vault.campaign_facts() if _source_session(vault, f.source) == ctx.sid]
    return out


def _notebook_fact(raw: dict, ctx: Context) -> Fact:
    said = raw.get("said_by")
    source = Source(ctx.page, ctx.sid, raw.get("t")) if ctx.page else None
    return Fact(
        raw["text"],
        raw.get("about"),
        said["name"] if isinstance(said, dict) and said.get("name") else None,
        source,
        raw.get("confidence") or "once",
        replaces=raw.get("old") if raw.get("kind") == "update" else None,
    )


def _spelling_candidates(ctx: Context, messages: list[dict]) -> list[Item]:
    found = spelling_suggestions(ctx.vault, ctx.campaign_sessions)
    wanted = [(s["heard"], s["entity"], s["count"]) for s in found["misheard"]]
    wanted += [(s["heard"], None, s["count"]) for s in found["unknown"]]
    seen = {norm(h) for h, _, _ in wanted}
    for e in ctx.vault.entities():  # proposed by the write-up
        for h in e.heard_as_suggested:
            if norm(h) not in seen:
                seen.add(norm(h))
                wanted.append((h, e.name, _mentions(messages, h)))
    out = []
    for heard, entity, count in wanted:
        line = _first_line(messages, [heard])
        if line is None:
            continue
        out.append(
            Item(
                item_id("spelling", heard),
                "spelling",
                heard,
                line["id"],
                line.get("t_start"),
                heard=heard,
                entity=entity,
                count=count,
            )
        )
    return out


def _earliest_mention(ctx: Context, names: list[str]) -> str | None:
    rx = _needle(names)
    if rx is None:
        return None
    for folder in sorted(ctx.campaign_sessions, key=lambda p: p.name):
        if any(rx.search(m["text"].casefold()) for m in _messages(folder)):
            return folder.name
    return None


def _entry_candidates(ctx: Context, messages: list[dict]) -> list[Item]:
    out = []
    for e in ctx.vault.entities():
        if e.status != "suggested" or e.read_only or _earliest_mention(ctx, e.names()) != ctx.sid:
            continue
        line = _first_line(messages, e.names())
        entry = {"name": e.name, "type": e.type, "description": e.description}
        out.append(
            Item(
                item_id("entry", e.name),
                "entry",
                e.name,
                line["id"] if line else None,
                line.get("t_start") if line else None,
                entry=entry,
            )
        )
    return out


def _mark_preaccepted(items: list[Item], ctx: Context) -> None:
    """Items the GM kept in the live notebook; a kept fact with no suggestion becomes an item of its own."""
    kept = [n for n in ctx.notebook if n.get("status") == "kept"]
    have = {i.id for i in items}
    for raw in kept:
        kind = raw.get("kind")
        if kind in ("fact", "update"):
            nb = _notebook_fact(raw, ctx)
            match = next(
                (
                    i
                    for i in items
                    if i.fact and same_fact(i.fact, nb) and (nb.about is None or norm(nb.about) == norm(i.fact.about or ""))
                ),
                None,
            )
            if match:
                match.preaccepted = True
            elif (iid := item_id("fact", nb.id)) not in have:
                have.add(iid)
                items.append(Item(iid, "fact", nb.id, raw.get("line_id"), raw.get("t"), preaccepted=True, fact=nb))
        elif kind == "entry":
            for i in items:
                if i.entry and norm(i.entry["name"]) == norm(raw["text"]):
                    i.preaccepted = True
        elif kind == "spelling":
            heard = raw["text"].split("→")[0]
            for i in items:
                if i.heard and norm(i.heard) == norm(heard):
                    i.preaccepted = True


# ------------------------------------------------------------------ status


def _settled(it: Item, vault: Vault) -> Status:
    """What an undecided item that is no longer suggested became: accepted if the vault now has it, else rejected."""
    if it.kind == "fact" and it.fact:
        pool = vault.campaign_facts() if it.fact.about is None else _facts_of(vault, it.fact.about)
        return "accepted" if any(same_fact(it.fact, f) for f in pool) else "rejected"
    if it.kind == "spelling" and it.heard:
        return "accepted" if vault.find(it.heard) is not None else "rejected"
    if it.entry:
        e = vault.find(it.entry["name"])
        return "accepted" if e is not None and e.status == "confirmed" else "rejected"
    return "rejected"


def _facts_of(vault: Vault, name: str) -> list[Fact]:
    try:
        return vault.get(name).facts
    except KeyError:
        return []


# ------------------------------------------------------------------ the frozen list

_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()


def _lock_for(sid: str) -> threading.Lock:
    with _guard:
        return _locks.setdefault(sid, threading.Lock())


def _load(path: Path) -> dict:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(raw.get("items"), list) and isinstance(raw.get("decisions"), dict):
            return raw
    except (OSError, ValueError, AttributeError):
        pass
    return {"items": [], "decisions": {}}


def _sync(ctx: Context) -> tuple[dict, list[Item]]:
    """The saved file brought up to date, and its items with their current payload and status."""
    path = ctx.session_dir / "review.json"
    saved = _load(path)
    messages = _messages(ctx.session_dir)
    live: list[Item] = []
    if ctx.page:
        live = [*_fact_candidates(ctx, messages), *_spelling_candidates(ctx, messages), *_entry_candidates(ctx, messages)]
    _mark_preaccepted(live, ctx)
    by_id = {i.id: i for i in live}
    known = {row["id"] for row in saved["items"]}
    fresh = [i for i in live if i.id not in known]
    if fresh:
        saved["items"] += [
            {"id": i.id, "kind": i.kind, "key": i.key, "line_id": i.line_id, "t": i.t, "data": _data(i)} for i in fresh
        ]
    out = []
    for row in saved["items"]:
        decided = saved["decisions"].get(row["id"])
        it = by_id.get(row["id"]) if decided is None else None
        if it is None:
            it = _restore(row)
            it.preaccepted = any(i.id == it.id and i.preaccepted for i in live)
            it.status = decided or _settled(it, ctx.vault)
        else:
            it.line_id, it.t = row.get("line_id"), row.get("t")  # the anchors frozen with the list
        out.append(it)
    if fresh or not path.exists():
        write_atomic(path, json.dumps(saved, ensure_ascii=False))
    return saved, out


def counts(items: list[Item]) -> dict[str, int]:
    return {
        "total": len(items),
        "done": sum(i.status != "open" for i in items),
        **{k: sum(i.kind == k for i in items) for k in KINDS},
    }


def review(ctx: Context) -> list[Item]:
    with _lock_for(ctx.sid):
        return _sync(ctx)[1]


# ------------------------------------------------------------------ actions


def act(
    ctx: Context,
    item_id_: str,
    action: Literal["accept", "reject"],
    text: str | None = None,
    about: str | None = None,
    about_given: bool = False,
) -> Item:
    """Do what the GM chose, through the same vault calls as the campaign endpoints, and record it.

    KeyError: no such item. AlreadyDecided: the item is no longer open. ValueError: the vault refused.
    `about_given` tells "move to the campaign" (about=None) from "leave it where it is"."""
    with _lock_for(ctx.sid):
        saved, items = _sync(ctx)
        it = next((i for i in items if i.id == item_id_), None)
        if it is None:
            raise KeyError(item_id_)
        if it.status != "open":
            raise AlreadyDecided(item_id_)
        with ctx.vault.lock:
            if it.kind == "fact":
                _fact_action(ctx.vault, it, action, text, about, about_given)
            elif it.kind == "spelling":
                _spelling_action(ctx.vault, it, action, text)
            else:
                _entry_action(ctx.vault, it, action)
        it.status = "accepted" if action == "accept" else "rejected"
        saved["decisions"][it.id] = it.status
        for row in saved["items"]:
            if row["id"] == it.id:
                row["data"] = _data(it)
        write_atomic(ctx.session_dir / "review.json", json.dumps(saved, ensure_ascii=False))
        return it


def _where(vault: Vault, f: Fact) -> Literal["suggested", "campaign"] | None:
    """Where the vault holds this fact as a pending item, if it does (a kept notebook fact is in neither)."""
    if f.about is None:
        return "campaign" if any(c.id == f.id for c in vault.campaign_facts()) else None
    try:
        return "suggested" if any(s.id == f.id for s in vault.get(f.about).suggested_facts) else None
    except KeyError:
        return None


def _add_accepted(vault: Vault, fact: Fact, target: str | None) -> None:
    if target is None:
        vault.add_campaign_fact(replace(fact, about=None, replaces=None))
    else:
        vault.add_fact(target, replace(fact, about=target, replaces=None))


def _fact_action(vault: Vault, it: Item, action: str, text: str | None, about: str | None, about_given: bool) -> None:
    assert it.fact is not None
    f, where = it.fact, _where(vault, it.fact)
    if action == "reject":
        if where == "suggested":
            vault.review(f.about or "", reject_facts=[f.id])
        elif where == "campaign":
            vault.delete_campaign_fact(f.id)
        return
    target = about if about_given else f.about
    if target is not None:
        vault.get(target)  # a bad target is refused before anything changes
    new_text = (text or "").strip()
    if new_text and new_text != f.text:
        if not norm(new_text):
            raise ValueError("A fact needs some text.")
        if where == "suggested":
            vault.edit_fact(f.about or "", f.id, text=new_text)
        elif where == "campaign":
            vault.edit_campaign_fact(f.id, text=new_text)
        f = replace(f, text=new_text)
    if where == "suggested":
        if target == f.about:
            vault.review(f.about or "", accept_facts=[f.id])
        else:
            _add_accepted(vault, f, target)
            vault.review(f.about or "", reject_facts=[f.id])
    elif where == "campaign":
        if target is not None:
            _add_accepted(vault, f, target)
            vault.delete_campaign_fact(f.id)
    elif target is None:
        vault.add_campaign_fact(replace(f, about=None, replaces=None))
    else:
        # Through the suggestions so an update replaces the old fact and keeps it as history.
        f = replace(f, about=target)
        vault.add_fact(target, f, suggested=True)
        vault.review(target, accept_facts=[f.id])
    it.fact = replace(f, about=target)


def _spelling_action(vault: Vault, it: Item, action: str, text: str | None) -> None:
    heard = it.heard or ""
    if it.entity:
        if action == "accept":
            vault.review(it.entity, accept_spellings=[heard])
        else:
            vault.review(it.entity, reject_spellings=[heard])
    elif action == "reject":
        vault.ignore([heard])
    else:
        name = (text or "").strip()
        if not name:
            raise ValueError("Name the entry for this word.")
        e = vault.create(name, "term")
        if norm(name) != norm(heard):
            vault.update(e.name, heard_as=[heard])


def _entry_action(vault: Vault, it: Item, action: str) -> None:
    name = (it.entry or {}).get("name", "")
    if action == "accept":
        vault.update(name, status="confirmed")
    else:
        vault.delete(name)
