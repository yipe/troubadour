"""The `_Overview/` pages: a read-only summary of the campaign that Troubadour Cloud shows to players.

They are rebuilt from the vault right before each backup scan and written into the vault, so they show in
Obsidian too. Troubadour owns only these files, and only while they carry the `troubadour: generated`
front-matter key: a file there without it is the user's own and is left alone. Only confirmed facts and
written-up sessions are used; nothing merely suggested ever appears.

`generate` is pure (Markdown by path); `write` is the only part that touches disk.
"""

import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any

from troubadour.core.fsutil import write_atomic

if TYPE_CHECKING:
    from troubadour.lore.campaign import Entity, Vault
    from troubadour.lore.facts import Fact

log = logging.getLogger("troubadour")

FOLDER = "_Overview"
RECAPS = f"{FOLDER}/Recaps"  # vault_format's recap pages
MARKER = "troubadour: generated"
NOTICE = "This page is rebuilt on every backup. Changes made here are lost."
RECENT_FACTS = 10
GROUPS = (("npc", "NPCs"), ("place", "Places"), ("faction", "Factions"))


def _front(title: str) -> str:
    return f"---\n{MARKER}\n---\n# {title}\n\n*{NOTICE}*\n\n"


def _link(page: str, label: str | None = None) -> str:
    return f"[[{page}|{label}]]" if label and label != page else f"[[{page}]]"


def _session_link(row: dict[str, Any]) -> str:
    return _link(row["page"], row.get("title") or row["page"])


def _one_line(text: str) -> str:
    return " ".join(text.split())


class _Facts:
    """Confirmed facts (entries' and the campaign's), each placed in a written-up session where known."""

    def __init__(self, vault: "Vault", sessions: list[dict[str, Any]], numbers: dict[str, int]):
        self.numbers = numbers
        self.by_page = {s["page"]: s["id"] for s in sessions}
        self.pages = {s["id"]: s["page"] for s in sessions}
        entities = [e for e in vault.entities() if e.status == "confirmed"]
        self.items: list[tuple[str | None, Fact]] = [(e.name, f) for e in entities for f in e.facts]
        self.items += [(None, f) for f in vault.campaign_facts()]

    def session_of(self, fact: "Fact") -> str | None:
        src = fact.source
        if src is None:
            return None
        sid = src.session_id or self.by_page.get(src.session_page)
        return sid if sid in self.numbers else None

    def source(self, fact: "Fact") -> str:
        """The fact's source as a link, "S12 1:38" when it knows the time."""
        src = fact.source
        if src is None:
            return ""
        sid = self.session_of(fact)
        page = self.pages.get(sid or "", src.session_page)
        n = self.numbers.get(sid or "")
        label = None
        if n is not None:
            label = f"S{n}"
            if src.t is not None:
                label += f" {int(src.t) // 3600}:{int(src.t) % 3600 // 60:02d}"
        return _link(page, label)

    def line(self, about: str | None, fact: "Fact", with_source: bool) -> str:
        subject = f"{_link(about)}: " if about else ""
        source = self.source(fact) if with_source else ""
        return f"- {subject}{_one_line(fact.text)}" + (f" ({source})" if source else "")


def _overview(
    vault: "Vault", sessions: list[dict[str, Any]], timeline: list[dict[str, Any]], numbers: dict[str, int], facts: _Facts
) -> str:
    out = [_front("Campaign overview")]
    by_id = {s["id"]: s for s in sessions}
    last = next((t for t in timeline if t["id"] in by_id), None)  # newest first
    out.append("## Last session\n")
    if last:
        row = by_id[last["id"]]
        out.append(f"S{last['n']} · {last['date']} · {_session_link(row)}\n")
        if row.get("summary"):
            out.append(f"{_one_line(row['summary'])}\n")
    else:
        out.append("No session has been written up yet.\n")

    pcs = [e for e in vault.entities() if e.type == "pc" and e.status == "confirmed"]
    out.append("## The party\n")
    for e in pcs:
        details = [str(v) for v in (e.extra_meta.get("class"), e.extra_meta.get("player")) if v]
        out.append(f"- {_link(e.name)}" + (f" ({', '.join(details)})" if details else ""))
    if not pcs:
        out.append("Nobody yet.")
    out.append("")

    def newest(item: tuple[str | None, "Fact"]) -> tuple[int, float]:
        sid = facts.session_of(item[1])
        t = item[1].source.t if item[1].source else None
        return (numbers.get(sid or "", 0), t or 0.0)

    recent = sorted(facts.items, key=newest, reverse=True)[:RECENT_FACTS]
    out.append("## Recently learned\n")
    out += [facts.line(about, f, True) for about, f in recent] or ["Nothing yet."]
    return "\n".join(out) + "\n"


def _session_log(sessions: list[dict[str, Any]], timeline: list[dict[str, Any]]) -> str:
    by_id = {s["id"]: s for s in sessions}
    out = [_front("Session log")]
    rows = [t for t in timeline if t["id"] in by_id]
    for t in rows:
        row = by_id[t["id"]]
        out.append(f"## S{t['n']} · {t['date']} · {_session_link(row)}\n")
        out.append(f"{_one_line(row['summary'])}\n" if row.get("summary") else "")
    if not rows:
        out.append("No session has been written up yet.\n")
    return "\n".join(out).rstrip("\n") + "\n"


def _people_and_places(entities: list["Entity"]) -> str:
    out = [_front("People and places")]
    for kind, heading in GROUPS:
        group = sorted((e for e in entities if e.type == kind), key=lambda e: e.name.casefold())
        if not group:
            continue
        out.append(f"## {heading}\n")
        for e in group:
            out.append(f"- {_link(e.name)}" + (f": {_one_line(e.description)}" if e.description.strip() else ""))
        out.append("")
    if len(out) == 1:
        out.append("Nothing yet.\n")
    return "\n".join(out).rstrip("\n") + "\n"


def _facts_by_session(sessions: list[dict[str, Any]], timeline: list[dict[str, Any]], facts: _Facts) -> str:
    out = [_front("Facts by session")]
    grouped: dict[str | None, list[str]] = {}
    for about, fact in facts.items:
        grouped.setdefault(facts.session_of(fact), []).append(facts.line(about, fact, False))
    by_id = {s["id"]: s for s in sessions}
    for t in timeline:
        if t["id"] in grouped and t["id"] in by_id:
            out.append(f"## S{t['n']} · {t['date']} · {_session_link(by_id[t['id']])}\n")
            out += [*grouped[t["id"]], ""]
    if None in grouped:
        out += ["## Other\n", *grouped[None], ""]
    if len(out) == 1:
        out.append("Nothing yet.\n")
    return "\n".join(out).rstrip("\n") + "\n"


def _journey(sessions: list[dict[str, Any]], timeline: list[dict[str, Any]]) -> str:
    by_id = {s["id"]: s for s in sessions}
    out = [_front("The journey")]
    for t in reversed(timeline):  # oldest first: it is a trip
        if t["id"] not in by_id:
            continue
        out.append(f"## S{t['n']} · {t['date']} · {_session_link(by_id[t['id']])}\n")
        out += [f"{i}. {_link(p)}" for i, p in enumerate(t.get("places") or [], start=1)] or ["No places recorded."]
        out.append("")
    if len(out) == 1:
        out.append("No session has been written up yet.\n")
    return "\n".join(out).rstrip("\n") + "\n"


def generate(
    vault: "Vault", sessions: list[dict[str, Any]], timeline: list[dict[str, Any]], numbers: dict[str, int]
) -> dict[str, str]:
    """Vault-relative path -> Markdown. `sessions` are the written-up sessions ({id, page, title, summary}:
    `page` is the write-up page's name); `timeline` is lore.timeline.timeline() output (newest first);
    `numbers` maps session id to its number."""
    facts = _Facts(vault, sessions, numbers)
    entities = [e for e in vault.entities() if e.status == "confirmed"]
    pages = {
        "Campaign overview": _overview(vault, sessions, timeline, numbers, facts),
        "Session log": _session_log(sessions, timeline),
        "People and places": _people_and_places(entities),
        "Facts by session": _facts_by_session(sessions, timeline, facts),
        "The journey": _journey(sessions, timeline),
    }
    return {f"{FOLDER}/{name}.md": text for name, text in pages.items()}


def _generated(path: Path) -> bool:
    """True when the file's front matter carries the marker."""
    try:
        head = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return False
    if not head.startswith("---\n"):
        return False
    front = head[4:].split("\n---", 1)[0]
    return MARKER in front.splitlines()


def write(root: Path, pages: dict[str, str]) -> list[str]:
    """Write the pages under `root/_Overview/` (and its `Recaps/` folder); returns the paths that changed. A file
    that is already right is not touched (its mtime stays), and a file without the marker is the user's: skipped.
    A generated recap no longer in `pages` (its session was deleted or merged) is removed."""
    folder = (root / FOLDER).resolve()
    allowed = {folder, (root / RECAPS).resolve()}
    changed: list[str] = []
    for rel, text in pages.items():
        path = (root / rel).resolve()
        if path.parent not in allowed or folder.parent != root.resolve():
            log.warning("overview: refusing to write outside %s: %s", FOLDER, rel)
            continue
        if path.exists():
            if not _generated(path):
                log.warning("overview: %s is not generated by Troubadour; left alone", rel)
                continue
            try:
                if path.read_text(encoding="utf-8") == text:
                    continue
            except (OSError, UnicodeDecodeError):
                pass
        path.parent.mkdir(parents=True, exist_ok=True)
        write_atomic(path, text)
        changed.append(rel)
    recaps = root / RECAPS
    wanted = {(root / rel).resolve() for rel in pages}
    for path in recaps.glob("*.md") if recaps.is_dir() else []:
        if path.resolve() not in wanted and _generated(path):
            path.unlink()
            changed.append(path.relative_to(root).as_posix())
    return changed
