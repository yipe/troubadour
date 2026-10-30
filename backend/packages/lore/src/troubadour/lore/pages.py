"""Reading a session's write-up page (title and wrap-up) and numbering sessions."""

import re
from pathlib import Path

SUMMARY_MAX = 600

_DATE_PREFIX = re.compile(r"^\d{4}-\d{2}-\d{2}\s+")
_LINK = re.compile(r"\[\[([^\]|]*)(?:\|([^\]]*))?\]\]|\[([^\]]*)\]\([^)]*\)")


def session_numbers(sessions: list[dict]) -> dict[str, int]:
    """Session id → its 1-based number: oldest first (ties by id), not counting sessions merged into
    another (listed in a survivor's `merged_from`). The client's `sessionNumbers` follows the same rule;
    both pass shared/test-vectors/session-numbers.json."""
    absorbed = {sid for s in sessions for sid in s.get("merged_from") or []}
    kept = sorted((s for s in sessions if s["id"] not in absorbed), key=lambda s: (s.get("started_at", 0), s["id"]))
    return {s["id"]: i for i, s in enumerate(kept, start=1)}


def _plain(text: str) -> str:
    """Markdown links and wiki-links reduced to their words."""
    return _LINK.sub(lambda m: m.group(2) or m.group(1) or m.group(3) or "", text)


def session_page(vault_dir: Path, rel_path: str) -> dict[str, str | None]:
    """{"title", "summary"} of a write-up page. The title is the page's own heading without the date the
    write-up puts in front of it; the summary is the first paragraph of "Last time" (the wrap-up), links
    stripped, at most 600 characters. A missing or unreadable page gives Nones."""
    out: dict[str, str | None] = {"title": None, "summary": None}
    try:
        root = vault_dir.resolve()
        path = (root / rel_path).resolve()
        if not path.is_relative_to(root):
            return out
        text = path.read_text(encoding="utf-8")
    except (OSError, ValueError):
        return out
    body = re.sub(r"\A---\n.*?\n---\n", "", text, count=1, flags=re.S)
    heading = re.search(r"^# +(.+?)\s*$", body, re.M)
    if heading:
        out["title"] = _DATE_PREFIX.sub("", _plain(heading.group(1))).strip() or None
    wrap = re.search(r"^## +Last time\s*$(.*?)(?=^#{1,2} |\Z)", body, re.M | re.S)
    if wrap:
        first = next((p for p in re.split(r"\n\s*\n", wrap.group(1).strip()) if p.strip()), "")
        summary = " ".join(_plain(first).split())
        if summary != "(no wrap-up)":  # what the write-up prints when the model gave none
            out["summary"] = summary[:SUMMARY_MAX].rstrip() or None
    return out
