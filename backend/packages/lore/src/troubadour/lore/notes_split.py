"""Splitting pasted notes into sessions by their headings. Pure: no LLM, no files.

A heading is a line on its own (a Markdown `#` to `###` heading or plain text) that reads as a session:
"Session 3", "S3 - Oct 2", "Session 12: The Drowned Abbey", "Session 3 (Sept 14, 2026)", "2026-09-14",
"Sept 14, 2026 - The Abbey". Notes are only split when there are at least two, so one stray "Session 1"
in a long document never turns it into a single session. Shared cases: shared/test-vectors/notes-split.json.
"""

import re
from dataclasses import dataclass
from datetime import date

MIN_HEADINGS = 2
MAX_HEADING = 120  # a longer line is prose, not a heading
YEAR_RANGE = (1970, 2100)

_MONTHS = {
    name: i
    for i, names in enumerate(
        [
            ("january", "jan"),
            ("february", "feb"),
            ("march", "mar"),
            ("april", "apr"),
            ("may",),
            ("june", "jun"),
            ("july", "jul"),
            ("august", "aug"),
            ("september", "sept", "sep"),
            ("october", "oct"),
            ("november", "nov"),
            ("december", "dec"),
        ],
        start=1,
    )
    for name in names
}
_MONTH = r"(?P<{}>" + "|".join(sorted(_MONTHS, key=len, reverse=True)) + r")\.?"

_ISO = re.compile(r"(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)")
_MDY = re.compile(_MONTH.format("m") + r"\s+(?P<d>\d{1,2})(?:st|nd|rd|th)?,?\s+(?P<y>\d{4})\b", re.I)
_DMY = re.compile(r"\b(?P<d>\d{1,2})(?:st|nd|rd|th)?\s+" + _MONTH.format("m") + r",?\s+(?P<y>\d{4})\b", re.I)
_MD = re.compile(r"\b" + _MONTH.format("m") + r"\s+(?P<d>\d{1,2})(?:st|nd|rd|th)?\b", re.I)  # no year: matched to strip it
_SESSION = re.compile(r"^(?:session|sess\.?|s)\s*#?\s*(?P<n>\d{1,3})(?![\d\w])(?P<rest>.*)$", re.I)
_SEPARATORS = " \t-–—:.,;|()[]*_#"


@dataclass(frozen=True)
class NotesSession:
    n: int | None  # "Session 3" -> 3
    date: str | None  # YYYY-MM-DD; None when the heading has none, or none with a year
    title: str | None
    text: str  # what follows the heading, up to the next one


def _valid(year: int, month: int, day: int) -> str | None:
    if not YEAR_RANGE[0] <= year <= YEAR_RANGE[1]:
        return None
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def _take_date(text: str) -> tuple[str | None, str, bool]:
    """(ISO date or None, the text without the date, whether a date was there at all)."""
    for rx, order in ((_ISO, "ymd"), (_MDY, "mdy"), (_DMY, "dmy")):
        if m := rx.search(text):
            if order == "ymd":
                y, mo, d = int(m[1]), int(m[2]), int(m[3])
            else:
                y, mo, d = int(m["y"]), _MONTHS[m["m"].lower()], int(m["d"])
            return _valid(y, mo, d), text[: m.start()] + " " + text[m.end() :], True
    if m := _MD.search(text):  # "Oct 2": a date, but with no year it can't be filled in
        return None, text[: m.start()] + " " + text[m.end() :], True
    return None, text, False


def _title(rest: str) -> str | None:
    rest = rest.strip(_SEPARATORS + " ")
    return re.sub(r"\s+", " ", rest) or None


def _heading(line: str) -> tuple[int | None, str | None, str | None] | None:
    """(n, date, title) when the line is a session heading, else None."""
    md = re.match(r"^#{1,3}\s+(.*)$", line.strip())
    body = (md.group(1) if md else line.strip()).strip(" *_#\t")
    if not body or len(body) > MAX_HEADING:
        return None
    if m := _SESSION.match(body):
        rest = m["rest"].lstrip()
        # "Session 12 was great." is a sentence; a heading goes on with a separator, a date, or nothing.
        if rest and rest[0] not in _SEPARATORS and _date_start(rest) != 0:
            return None
        when, rest, _ = _take_date(m["rest"])
        return int(m["n"]), when, _title(rest)
    when, rest, _ = _take_date(body)
    # A heading of only a date has to start with one that includes the year ("Sept 14, 2026 - The Abbey").
    # In plain text it is the whole line: "Oct 2: met the queen" is a sentence in the notes, not a heading.
    start = _date_start(body)
    if when is None or start is None or not re.match(r"^[" + re.escape(_SEPARATORS) + r"]*$", body[:start]):
        return None
    title = _title(rest)
    return (None, when, title) if md or title is None else None


def _date_start(body: str) -> int | None:
    for rx in (_ISO, _MDY, _DMY, _MD):
        if m := rx.search(body):
            return m.start()
    return None


def split_sessions(text: str) -> list[NotesSession]:
    """The sessions in `text`, or [] when it has fewer than two session headings (then it is not "clearly"
    split). Text before the first heading belongs to no session and is dropped."""
    lines = text.splitlines()
    found = [(i, h) for i, line in enumerate(lines) if (h := _heading(line)) is not None]
    if len(found) < MIN_HEADINGS:
        return []
    out = []
    for k, (i, (n, when, title)) in enumerate(found):
        end = found[k + 1][0] if k + 1 < len(found) else len(lines)
        out.append(NotesSession(n, when, title, "\n".join(lines[i + 1 : end]).strip()))
    return out
