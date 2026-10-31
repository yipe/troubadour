"""Facts as vault bullets: parse and render the trailer that carries source, speaker and confidence.

    - The tide turns at the second bell. ([[2026-10-22 The Drowned Abbey#1:38:02|S12 1:38]] · Orsa Vell · GM stated)
      - ~~Old text.~~ ([[2026-10-08 Debts#0:52:10|S10 0:52]] · Pip · Heard once)

Pure functions, no I/O. Parsing is lenient and never drops a bullet: whatever is not a recognised trailer stays
in the text. Rendering is canonical. The one exception to "canonical" is the old `text ([[Page]])` form, which
renders back as it came so an unchanged old note is never rewritten just to upgrade its format.
"""

import hashlib
import re
from dataclasses import dataclass, field
from typing import Literal

Confidence = Literal["gm", "theory", "once"]
LABELS: dict[Confidence, str] = {"gm": "GM stated", "theory": "Party theory", "once": "Heard once"}
_BY_LABEL: dict[str, Confidence] = {label: key for key, label in LABELS.items()}
SEP = " · "
REPLACES = "→ replaces: "


@dataclass
class Source:
    session_page: str
    session_id: str | None = None
    t: float | None = None
    label: str | None = None  # "S12 1:38"; kept as parsed when the session number is unknown


@dataclass
class Version:
    text: str
    said_by: str | None = None
    source: Source | None = None
    confidence: Confidence = "once"


@dataclass
class Fact:
    text: str
    about: str | None = None
    said_by: str | None = None
    source: Source | None = None
    confidence: Confidence = "once"
    history: list[Version] = field(default_factory=list)
    replaces: str | None = None  # suggestions only: the text this would replace

    @property
    def id(self) -> str:
        return fact_id(self.about, self.text)


def norm(text: str) -> str:
    """Comparison key: case-, punctuation- and leading-"the"-insensitive."""
    key = re.sub(r"[^a-z0-9]+", " ", str(text).casefold()).strip()
    return key[4:] if key.startswith("the ") else key


def fact_id(about: str | None, text: str) -> str:
    return hashlib.sha1(f"{about or ''}\n{norm(text)}".encode()).hexdigest()[:10]


def hms(t: float) -> str:
    """Seconds as h:mm:ss, or m:ss under an hour. Fractions are floored."""
    s = max(0, int(t))
    h, rest = divmod(s, 3600)
    m, sec = divmod(rest, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"


def parse_hms(s: str) -> float | None:
    """Inverse of hms: "1:38:02" or "38:02"; None for anything else."""
    parts = s.strip().split(":")
    if not 2 <= len(parts) <= 3 or not all(p.isdigit() for p in parts):
        return None
    nums = [int(p) for p in parts]
    if any(n >= 60 for n in nums[1:]):
        return None
    total = 0
    for n in nums:
        total = total * 60 + n
    return float(total)


_LINK = re.compile(r"^\[\[([^\[\]|#]+)(?:#([^\[\]|]*))?(?:\|([^\[\]]*))?\]\]$")


def _parse_inner(inner: str) -> tuple[Source | None, str | None, Confidence | None] | None:
    """The inside of a candidate trailer, or None if it is not one."""
    parts = inner.split(SEP)
    source = None
    m = _LINK.match(parts[0].strip())
    if m:
        page, anchor, label = m.group(1).strip(), m.group(2), m.group(3)
        t = None
        if anchor is not None:
            t = parse_hms(anchor)
            if t is None:  # a heading link, not a time: leave the whole thing as text
                return None
        source = Source(page, None, t, label.strip() if label else None)
        parts = parts[1:]
    parts = [p.strip() for p in parts]
    confidence = None
    if parts and parts[-1] in _BY_LABEL:
        confidence = _BY_LABEL[parts.pop()]
    # Without a link or a confidence label, "(a rusty key)" is just a parenthetical in the text.
    if source is None and confidence is None:
        return None
    speaker = SEP.join(p for p in parts if p) or None
    return source, speaker, confidence


def parse_trailer(s: str) -> tuple[str, Source | None, str | None, Confidence | None]:
    """Split "text (trailer)" into (text, source, said_by, confidence). No trailer: (s, None, None, None)."""
    body = s.rstrip()
    if body.endswith(")"):
        pos = len(body)
        while (pos := body.rfind("(", 0, pos)) > 0:
            if body[pos - 1].isspace() and (parsed := _parse_inner(body[pos + 1 : -1])):
                return (body[:pos].rstrip(), *parsed)
    return s.strip(), None, None, None


_BULLET = re.compile(r"^(\s*)[-*+]\s+(.*)$")
_STRUCK = re.compile(r"^~~(.+?)~~\s*(.*)$")


def _resolve(source: Source | None, ids_for: dict[str, str]) -> Source | None:
    if source:
        source.session_id = ids_for.get(source.session_page)
    return source


def parse_bullets(lines: list[str], about: str | None, ids_for: dict[str, str] | None = None) -> list[Fact]:
    """The body of a "## Facts" section. `ids_for` maps session page names to session ids."""
    ids_for = ids_for or {}
    facts: list[Fact] = []
    for raw in lines:
        if not raw.strip():
            continue
        m = _BULLET.match(raw)
        if not m:  # a non-bullet line continues the previous item, as in campaign.bullets
            if facts:
                facts[-1].text += " " + raw.strip()
            else:
                facts.append(Fact(raw.strip(), about))
            continue
        indent, body = len(m.group(1)), m.group(2).strip()
        struck = _STRUCK.match(body)
        if indent and struck and facts:
            old, rest = struck.groups()
            # "x" stands in for the text so parse_trailer sees a trailer that follows something.
            marker, source, said_by, confidence = parse_trailer(f"x {rest}")
            if not rest or marker == "x":
                facts[-1].history.append(Version(old, said_by, _resolve(source, ids_for), confidence or "once"))
                continue
        text, source, said_by, confidence = parse_trailer(body)
        replaces = None
        if REPLACES in text:
            before, _, old = text.partition(REPLACES)
            text, replaces = before.strip(), old.strip()
        facts.append(Fact(text, about, said_by, _resolve(source, ids_for), confidence or "once", [], replaces))
    return facts


def _anchor(t: float) -> str:
    """The link's time is always h:mm:ss, unlike hms(), which drops a zero hour."""
    s = int(t)
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}"


def _label(source: Source, numbers: dict[str, int]) -> str | None:
    n = numbers.get(source.session_id) if source.session_id else None
    if n is None or source.t is None:
        return source.label
    return f"S{n} {int(source.t) // 3600}:{int(source.t) % 3600 // 60:02d}"


def _link(source: Source, numbers: dict[str, int], page_for: dict[str, str]) -> str:
    page = page_for.get(source.session_id or "", source.session_page)
    anchor = f"#{_anchor(source.t)}" if source.t is not None else ""
    label = _label(source, numbers)
    return f"[[{page}{anchor}{'|' + label if label else ''}]]"


def _trailer(
    source: Source | None,
    said_by: str | None,
    confidence: Confidence,
    numbers: dict[str, int],
    page_for: dict[str, str],
) -> str:
    # The old "([[Page]])" form renders as it came; anything richer states the confidence.
    old_form = source and not said_by and confidence == "once" and source.t is None and not source.label
    parts = []
    if source:
        parts.append(_link(source, numbers, page_for))
    if said_by:
        parts.append(said_by)
    if not old_form and (source or said_by or confidence != "once"):
        parts.append(LABELS[confidence])
    return f" ({SEP.join(parts)})" if parts else ""


def render_bullets(
    facts: list[Fact],
    numbers: dict[str, int] | None = None,
    page_for: dict[str, str] | None = None,
) -> list[str]:
    """Canonical bullets. `numbers` maps session id to its number, `page_for` session id to page name."""
    numbers, page_for = numbers or {}, page_for or {}
    out: list[str] = []
    for f in facts:
        text = f"{f.text} {REPLACES}{f.replaces}" if f.replaces else f.text
        out.append(f"- {text}{_trailer(f.source, f.said_by, f.confidence, numbers, page_for)}")
        for v in f.history:
            out.append(f"  - ~~{v.text}~~{_trailer(v.source, v.said_by, v.confidence, numbers, page_for)}")
    return out
