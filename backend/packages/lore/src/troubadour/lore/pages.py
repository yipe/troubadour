"""Reading a session's write-up page (title and wrap-up) and numbering sessions."""

import re
from pathlib import Path

SUMMARY_MAX = 600
WRAP_UP_MAX = 5000  # chars; a wrap-up is asked for at 350-550 words

# Unknown date: notes sessions with no date, which always come before every dated one. They start a day or two
# into 1970 (one second apart, in the order they were added); a real date is never before 1971-01-01
# (notes_split.YEAR_RANGE), so anything earlier than PAST_BEFORE has an unknown date. The client's `isPast` follows the same rule.
PAST_START = 2 * 86400.0
PAST_BEFORE = 350 * 86400.0


def is_past(started_at: float) -> bool:
    return started_at < PAST_BEFORE


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


def _body(vault_dir: Path, rel_path: str) -> str | None:
    """A vault page without its frontmatter; None when it is missing, unreadable or outside the vault."""
    try:
        root = vault_dir.resolve()
        path = (root / rel_path).resolve()
        if not path.is_relative_to(root):
            return None
        text = path.read_text(encoding="utf-8")
    except (OSError, ValueError):
        return None
    return re.sub(r"\A---\n.*?\n---\n", "", text, count=1, flags=re.S)


def _last_time(body: str) -> str | None:
    """The "Last time" section's text; None when the page has no such section (imported notes)."""
    wrap = re.search(r"^## +Last time\s*$(.*?)(?=^#{1,2} |\Z)", body, re.M | re.S)
    if not wrap:
        return None
    text = wrap.group(1).strip()
    return "" if text == "(no wrap-up)" else text  # what the write-up prints when the model gave none


def session_page(vault_dir: Path, rel_path: str) -> dict[str, str | None]:
    """{"title", "summary"} of a write-up page. The title is the page's own heading without the date the
    write-up puts in front of it; the summary is the first paragraph of "Last time" (the wrap-up), links
    stripped, at most 600 characters. A missing or unreadable page gives Nones."""
    out: dict[str, str | None] = {"title": None, "summary": None}
    body = _body(vault_dir, rel_path)
    if body is None:
        return out
    heading = re.search(r"^# +(.+?)\s*$", body, re.M)
    if heading:
        out["title"] = _DATE_PREFIX.sub("", _plain(heading.group(1))).strip() or None
    first = next((p for p in re.split(r"\n\s*\n", _last_time(body) or "") if p.strip()), "")
    out["summary"] = " ".join(_plain(first).split())[:SUMMARY_MAX].rstrip() or None
    return out


def wrap_up(vault_dir: Path, rel_path: str) -> str:
    """The whole "Last time" wrap-up of a write-up page, links stripped, paragraphs kept. A page without that
    section (an older write-up, imported notes) gives its text before the first "## " section, or all of it when
    there is none. "" when the page is missing or its wrap-up is empty."""
    body = _body(vault_dir, rel_path)
    if body is None:
        return ""
    text = _last_time(body)
    if text is None:
        body = re.sub(r"\A\s*# .*\n", "", body)
        text = re.split(r"^## ", body, maxsplit=1, flags=re.M)[0].strip() or body
    paragraphs = (" ".join(_plain(p).split()) for p in re.split(r"\n\s*\n", text.strip()))
    return "\n\n".join(p for p in paragraphs if p)[:WRAP_UP_MAX].rstrip()
