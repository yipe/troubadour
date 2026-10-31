"""Tonight's notebook, the LLM half: turn a few minutes of transcript into candidate facts, fact updates,
new entries and (without any model) spelling fixes. Pure: the model is passed in, nothing is stored here.

Everything the model says is untrusted. Each item is checked against the window it was given (line numbers,
names that must appear in the text, known fact numbers) before it becomes an item, and the counts per pass
are capped.
"""

import hashlib
import re
from typing import TypedDict

from troubadour.core.transcript import clock, utf16_to_py

from .campaign import TYPES, same_fact
from .facts import Fact, norm
from .memory import fleeting
from .writeup import TABLE_RULES, clean

MAX_FACTS, MAX_UPDATES, MAX_ENTRIES = 8, 3, 5
MAX_KNOWN_FACTS = 40
FACT_CHARS = 200
NAME_CHARS = 100
CONFIDENCES = ("gm", "theory", "once")
_BAD_NAME = re.compile(r'[\\/:*?"<>|#^\[\]\n\r\t]')


class Line(TypedDict):
    id: str
    t: float
    speaker: str
    player_id: str | None
    is_gm: bool
    text: str


class Known(TypedDict):
    entities: list[tuple[str, str, list[str]]]  # (name, type, aliases)
    facts: list[tuple[str, str]]  # (about, text), only for entities named in the window


SYSTEM = f"""You are the party's note-taker for a Dungeons & Dragons session, reading the last few minutes of
the transcript while the game goes on. Lines are numbered.
{TABLE_RULES}
Return JSON with three lists, each possibly empty. Prefer an empty list to a guess.
facts: lasting things that will still be true next session. about = the exact name of a known entity (or of a
new entry you list below); text = one sentence under {FACT_CHARS} characters that names who or what it is
about; line = the number of the line it came from; confidence = gm if the GM narrated or confirmed it, theory
if a player guessed it, once if it was said once and nobody confirmed it. Not facts: hit points, spell slots,
conditions, positions, rolls, jokes, plans not yet carried out, anything already in the known facts.
updates: a known fact that this passage changes. replaces = the number of that known fact (F1, F2... as listed;
give just the number); text = the new sentence; line = the number of the line.
entries: a person, place, faction, item, creature or spell that is named in the passage and is not in the known
entities. name = copied exactly as the transcript says it; type = one of {", ".join(TYPES)}; line.
Answer with JSON only."""

SCHEMA = {
    "type": "object",
    "properties": {
        "facts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "about": {"type": "string"},
                    "text": {"type": "string"},
                    "line": {"type": "integer"},
                    "confidence": {"type": "string", "enum": list(CONFIDENCES)},
                },
                "required": ["about", "text", "line", "confidence"],
                "additionalProperties": False,
            },
        },
        "updates": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"replaces": {"type": "integer"}, "text": {"type": "string"}, "line": {"type": "integer"}},
                "required": ["replaces", "text", "line"],
                "additionalProperties": False,
            },
        },
        "entries": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "type": {"type": "string", "enum": list(TYPES)},
                    "line": {"type": "integer"},
                },
                "required": ["name", "type", "line"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["facts", "updates", "entries"],
    "additionalProperties": False,
}


def prompt(lines: list[Line], known: Known) -> str:
    entities = "\n".join(
        f"- {name} ({kind})" + (f", also {', '.join(aliases)}" if aliases else "") for name, kind, aliases in known["entities"]
    )
    facts = "\n".join(f"F{i}. {about}: {text}" for i, (about, text) in enumerate(known["facts"][:MAX_KNOWN_FACTS], 1))
    numbered = "\n".join(
        f"{i}. [{clock(line['t'])}] {line['speaker']}{' (GM)' if line['is_gm'] else ''}: {line['text']}"
        for i, line in enumerate(lines, 1)
    )
    return f"Known entities:\n{entities or '(none)'}\n\nKnown facts:\n{facts or '(none)'}\n\nTranscript:\n{numbered}"


def _int(value) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _said_by(line: Line) -> dict | None:
    return {"name": line["speaker"], "player_id": line["player_id"]} if line["speaker"] else None


def _anchor(item: dict, line: Line) -> dict:
    return {**item, "said_by": _said_by(line), "t": line["t"], "line_id": line["id"]}


def _confidence(value) -> str:
    return value if value in CONFIDENCES else "once"  # a wrong value is the cautious one, not a reason to drop


def propose(llm, lines: list[Line], known: Known) -> list[dict]:
    """NotebookItem dicts (status is left to the notebook: open) for one window of lines."""
    if not lines:
        return []
    known_facts = known["facts"][:MAX_KNOWN_FACTS]
    raw = llm.json(SYSTEM, prompt(lines, known), SCHEMA, max_tokens=3000)
    if not isinstance(raw, dict):
        return []

    def rows(key: str) -> list[dict]:
        value = raw.get(key)
        return [r for r in value if isinstance(r, dict)] if isinstance(value, list) else []

    def line_at(value) -> Line | None:
        n = _int(value)
        return lines[n - 1] if n is not None and 1 <= n <= len(lines) else None

    window = "\n".join(line["text"] for line in lines).casefold()
    names: dict[str, str] = {}  # norm(name or alias) -> the entity's name
    for name, _kind, aliases in known["entities"]:
        for n in (name, *aliases):
            names[norm(n)] = name
    known_text = [Fact(text=text, about=about) for about, text in known_facts]

    entries: list[dict] = []
    new_names: dict[str, str] = {}
    for row in rows("entries"):
        name, line = clean(row.get("name"), NAME_CHARS), line_at(row.get("line"))
        kind = row.get("type")
        if not name or line is None or _BAD_NAME.search(name) or norm(name) in names or norm(name) in new_names:
            continue
        if name.casefold() not in window:  # verbatim, so a model can't invent a name
            continue
        new_names[norm(name)] = name
        entries.append(
            _anchor({"kind": "entry", "text": name, "about": name, "entry_type": kind if kind in TYPES else "term"}, line)
        )
    entries = entries[:MAX_ENTRIES]
    new_names = {norm(e["text"]): e["text"] for e in entries}

    facts: list[dict] = []
    for row in rows("facts"):
        text, line = clean(row.get("text"), FACT_CHARS), line_at(row.get("line"))
        about = clean(row.get("about"), NAME_CHARS)
        about = names.get(norm(about)) or new_names.get(norm(about))
        if not text or line is None or about is None or fleeting(text):
            continue
        candidate = Fact(text=text, about=about)
        if any(same_fact(candidate, k) for k in known_text) or any(
            same_fact(candidate, Fact(text=f["text"], about=about)) for f in facts
        ):
            continue
        facts.append(
            _anchor({"kind": "fact", "text": text, "about": about, "confidence": _confidence(row.get("confidence"))}, line)
        )
    facts = facts[:MAX_FACTS]

    updates: list[dict] = []
    for row in rows("updates"):
        text, line, n = clean(row.get("text"), FACT_CHARS), line_at(row.get("line")), _int(row.get("replaces"))
        if not text or line is None or n is None or not 1 <= n <= len(known_facts) or fleeting(text):
            continue
        about, old = known_facts[n - 1]
        if same_fact(Fact(text=text, about=about), known_text[n - 1]) or any(u["old"] == old for u in updates):
            continue
        updates.append(
            _anchor(
                {"kind": "update", "text": text, "old": old, "about": about, "confidence": _confidence(row.get("confidence"))},
                line,
            )
        )
    return [*facts, *updates[:MAX_UPDATES], *entries]


def spellings(messages: list[dict]) -> list[dict]:
    """One `spelling` item per (heard -> fixed) pair among the applied fixes of these lines ({text, fixes}).
    The id depends only on the pair, so a later run updates the count instead of adding a duplicate."""
    counts: dict[tuple[str, str], int] = {}
    for m in messages:
        text = m.get("text", "")
        pairs = {
            (f["heard"], text[utf16_to_py(text, f["start"]) : utf16_to_py(text, f["end"])])
            for f in m.get("fixes") or []
            if isinstance(f.get("heard"), str) and isinstance(f.get("start"), int) and isinstance(f.get("end"), int)
        }
        for pair in pairs:  # a pair twice in one line still counts that line once
            counts[pair] = counts.get(pair, 0) + 1
    out = []
    for (heard, fixed), n in sorted(counts.items()):
        if not heard.strip() or not fixed.strip() or heard == fixed:
            continue
        key = hashlib.sha1(f"{heard}\n{fixed}".encode()).hexdigest()[:12]
        out.append({"id": f"sp{key}", "kind": "spelling", "text": fixed, "old": heard, "count": n})
    return out
