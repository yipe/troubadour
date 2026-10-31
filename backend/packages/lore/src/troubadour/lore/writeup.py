"""Session write-ups: the language model reads the whole session into notes, then writes the page from them.

1. read: one call over the whole labelled transcript (thinking on) returns notes: timestamped beats from the
   first scene to the last, what each player character did, the people, places and loot, what is still open,
   how it ended, and misheard spellings of glossary names.
2. write: one call that sees only the notes (thinking off; a thinking writer wrote short wrap-ups) and a
   made-up example page (writeup_example.md) for style and level of detail, returns the title, the "Last time"
   wrap-up, a spotlight per player character and the highlights.

Measured against four hand-checked gold pages (PLAN.md, "Session write-ups"): every extra stage tried after
the reading (checking each beat against its own minutes of transcript, chunked reading) lost facts or added
errors. Model output is untrusted: types and lengths are checked, timestamps must exist in the transcript.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path

from .campaign import norm
from .facts import Confidence, Fact

TEXT_MAX, NAME_MAX = 600, 80
LAST_TIME_MAX = 6000  # chars; the prompt asks for 350-550 words
BEATS_MAX, NAMED_MAX, LIST_MAX = 60, 40, 20
READ_TOKENS, WRITE_TOKENS = 9000, 4000
EXAMPLE = (Path(__file__).parent / "writeup_example.md").read_text(encoding="utf-8")


def _obj(props: dict) -> dict:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


STR = {"type": "string"}
STRS = {"type": "array", "items": STR}
BEAT = _obj({"at": STR, "text": STR})
NAMED = _obj({"name": STR, "what": STR})
PERSON = _obj({"name": STR, "kind": {"type": "string", "enum": ["npc", "creature", "faction"]}, "what": STR})

NOTES_SCHEMA = _obj(
    {
        "beats": {"type": "array", "items": BEAT},
        "characters": {"type": "array", "items": NAMED},
        "people": {"type": "array", "items": PERSON},
        "places": {"type": "array", "items": NAMED},
        "loot": STRS,
        "open": STRS,
        "ending": STR,
        "spellings": {"type": "array", "items": _obj({"heard": STR, "means": STR})},
    }
)

PAGE_SCHEMA = _obj(
    {
        "title": STR,
        "last_time": STR,
        "spotlight": {"type": "array", "items": NAMED},
        "highlights": {"type": "array", "items": BEAT},
    }
)

TABLE_RULES = """The transcript is speech-to-text: it mishears words and names; the glossary has the right spellings.
Lines are labelled with who spoke. The GM narrates and speaks for every NPC and monster. Players joke, plan,
speculate and talk about real life: only what actually happens in the game counts (usually what the GM narrates
or confirms). A joke is not an event. A plan is not an event until they do it."""

READ_SYSTEM = f"""You are the party's note-taker for a Dungeons & Dragons session. You get its whole transcript.
{TABLE_RULES}
Write careful notes, from the first scene to the last:
beats: 20 to 35 entries in order, covering the whole session evenly to its very end. Each: at = the timestamp
of the transcript line where it starts, copied exactly; text = one or two specific sentences: who did what, to
whom, why if someone said why, and what came of it. Name the NPCs, places and items. Keep numbers that matter
(money, damage that dropped someone, how many). A fight gets one or two beats: who fought whom, the turning
points, how it ended, who was knocked out, swallowed, cursed or killed. Reveals, decisions, deals, gifts and loot
are beats.
characters: each player character: name, and what they did that mattered.
people: each NPC, creature or group met or named in play: name as the glossary spells it; kind (npc, creature
or faction); what = who they are and what they did.
places: each place visited or named: name, and what happened there.
loot: what was found, given, bought, sold or spent, with amounts and who has it.
open: threads still unresolved at the end. Not plans, not guesses, not things already done.
ending: where and how the session ended.
spellings: where the transcript clearly mishears a glossary name: heard = the word exactly as written in the
transcript, means = the glossary name. Only clear cases.
Be accurate before being complete: when you are not sure who did something or a number, leave that detail out.
More rules:
- Rolls, saving throws, damage numbers, spell slots and hit points are not beats. Mention a number only when it
  decided something (someone dropped to 0, a huge hit, a natural 20 that turned a scene) or it is money or loot.
- Who did what is the most important thing to get right: copy who acted and who it happened to from the
  transcript. If two characters could be meant, name neither.
- Use names, not he/she, unless the transcript makes it clear.
- Do not say how something was done (on a wall, with a spell, in a language) unless the transcript says so.
- A name a player jokes about or guesses is not a name until the GM uses it.
- Players' guesses about what something is ("it's probably a mimic") are not facts.
Answer with JSON only."""

WRITE_SYSTEM = """You write the session page a Dungeons & Dragons group reads before their next game, from their
note-taker's notes. You do not have the transcript: everything you write must come from the notes.
title: 2 to 5 words about the session's main event, no date.
last_time: the wrap-up, 2 or 3 paragraphs, 350 to 550 words, past tense: a story a player enjoys reading. Where
the party started and what they set out to do; each turn of the session in order; the climax; how it ended; what
they carry forward (loot, deals, threats, open questions). Name the player characters and NPCs. Fit in as many of
the notes' specific facts as you can: who did what, names, places, numbers that mattered, deals. No rules talk
(rolls, DCs, hit points, spell slots) unless a roll changed the story. Add nothing the notes do not say: no
guessed motives, no invented details.
spotlight: one entry per player character: name, and what = what they did that mattered, one or two sentences.
highlights: 4 to 8 moments the table will retell (twists, reveals, decisions, character moments, jokes that
landed; a roll only if it changed the story), each with at copied from the note it comes from.
Answer with JSON only."""

EXAMPLE_INTRO = """Here is a great page from another campaign, for its style and level of detail only (different
people and events: never copy its content):
"""


@dataclass
class Beat:
    at: str
    text: str


@dataclass
class Named:
    name: str
    what: str
    kind: str = ""


@dataclass
class Notes:
    beats: list[Beat] = field(default_factory=list)
    characters: list[Named] = field(default_factory=list)
    people: list[Named] = field(default_factory=list)
    places: list[Named] = field(default_factory=list)
    loot: list[str] = field(default_factory=list)
    open: list[str] = field(default_factory=list)
    ending: str = ""
    spellings: list[tuple[str, str]] = field(default_factory=list)

    def text(self) -> str:
        """The notes as the writer reads them."""
        out = ["Beats:", *(f"- [{b.at}] {b.text}" for b in self.beats)]
        for label, items in (
            ("Player characters", self.characters),
            ("People and creatures", self.people),
            ("Places", self.places),
        ):
            out += ["", f"{label}:", *(f"- {x.name}: {x.what}" for x in items)]
        out += ["", "Loot and deals:", *(f"- {x}" for x in self.loot)]
        out += ["", "Still open:", *(f"- {x}" for x in self.open)]
        out += ["", f"Ending: {self.ending}"]
        return "\n".join(out)


@dataclass
class Page:
    title: str
    last_time: str
    spotlight: list[Named]
    highlights: list[Beat]


def clean(value, limit: int = TEXT_MAX) -> str:
    return re.sub(r"\s+", " ", value).strip()[:limit] if isinstance(value, str) else ""


def _stamp(value, stamps: set[str]) -> str:
    """A timestamp the transcript really has (a model's made-up one is dropped)."""
    at = clean(value, 12).strip("[] ")
    return at if at in stamps else ""


def _named(items, kinds: set[str] | None = None) -> list[Named]:
    out, seen = [], set()
    for x in items if isinstance(items, list) else []:
        if not isinstance(x, dict):
            continue
        name, what = clean(x.get("name"), NAME_MAX), clean(x.get("what"))
        kind = x.get("kind") if kinds and x.get("kind") in kinds else ""
        if name and norm(name) not in seen:
            seen.add(norm(name))
            out.append(Named(name, what, kind))
    return out[:NAMED_MAX]


def as_list(value) -> list:
    """A list the model sent as a list; anything else ("none", 3, null, an object) is no items."""
    return value if isinstance(value, list) else []


def _strings(items, limit: int = LIST_MAX) -> list[str]:
    return [t for x in (items if isinstance(items, list) else []) if (t := clean(x))][:limit]


def parse_notes(raw: dict, stamps: set[str]) -> Notes:
    beats = [
        Beat(_stamp(b.get("at"), stamps), text)
        for b in as_list(raw.get("beats"))
        if isinstance(b, dict) and (text := clean(b.get("text")))
    ][:BEATS_MAX]
    spellings = [
        (heard, means)
        for s in as_list(raw.get("spellings"))
        if isinstance(s, dict) and (heard := clean(s.get("heard"), NAME_MAX)) and (means := clean(s.get("means"), NAME_MAX))
    ][:LIST_MAX]
    return Notes(
        beats=beats,
        characters=_named(raw.get("characters")),
        people=_named(raw.get("people"), {"npc", "creature", "faction"}),
        places=_named(raw.get("places")),
        loot=_strings(raw.get("loot")),
        open=_strings(raw.get("open"), 8),
        ending=clean(raw.get("ending")),
        spellings=spellings,
    )


def parse_page(raw: dict, stamps: set[str]) -> Page:
    highlights = [
        Beat(_stamp(h.get("at"), stamps), text)
        for h in as_list(raw.get("highlights"))
        if isinstance(h, dict) and (text := clean(h.get("text")))
    ][:8]
    last_time = raw.get("last_time") if isinstance(raw.get("last_time"), str) else ""
    # Paragraphs matter in a wrap-up: keep its line breaks, tidy the rest.
    paragraphs = [clean(p, LAST_TIME_MAX) for p in re.split(r"\n\s*\n", last_time)]
    return Page(
        title=clean(raw.get("title"), 60),
        last_time="\n\n".join(p for p in paragraphs if p)[:LAST_TIME_MAX],
        spotlight=_named(raw.get("spotlight"))[:8],
        highlights=highlights,
    )


def read(llm, lines: list[str], cast: str, glossary: str, progress=None) -> Notes:
    """The whole session in one call, thinking on (more of the session's facts, measured). `progress` hears a
    streaming call's progress (Job.model_progress)."""
    user = f"Who is at the table:\n{cast}\n\nGlossary:\n{glossary}\n\nTranscript:\n" + "\n".join(lines)

    end = _clock_seconds(lines[-1].split(" ", 1)[0]) if lines else 0.0
    reached = [0.0]  # the furthest beat so far (the bar never goes back)

    def heard(info: dict) -> None:
        if progress is None:
            return
        found = snippets(info.get("text", ""))
        # The beats come in session order: the last one's time says how far through the session the notes are.
        reached[0] = max([reached[0], *(_clock_seconds(s["at"]) for s in found if s["kind"] == "beat")])
        fraction = {"fraction": round(min(1.0, reached[0] / end), 3)} if end and reached[0] else {}
        progress({**info, **fraction, "snippets": found})

    raw = llm.json(READ_SYSTEM, user, NOTES_SCHEMA, READ_TOKENS, think=True, progress=heard)
    return parse_notes(raw, {line.split(" ", 1)[0] for line in lines})


WRITE_EXPECTED_CHARS = 5000  # a page reply is usually ~4-6k chars: the write step's bar is an estimate


def write(llm, notes: Notes, stamps: set[str], progress=None) -> Page:
    user = f"{EXAMPLE_INTRO}{EXAMPLE}\n\n---\n\nThe note-taker's notes for this session:\n{notes.text()}"

    def heard(info: dict) -> None:
        if progress is not None:
            written = len(info.get("text", ""))
            progress({**info, "fraction": round(min(0.95, written / WRITE_EXPECTED_CHARS), 3)} if written else info)

    return parse_page(llm.json(WRITE_SYSTEM, user, PAGE_SCHEMA, WRITE_TOKENS, progress=heard), stamps)


def _clock_seconds(at: str) -> float:
    try:
        parts = [int(p) for p in at.strip("[] ").split(":")]
    except ValueError:
        return 0.0
    return float(sum(p * 60**i for i, p in enumerate(reversed(parts))))


CONFIDENCES: tuple[Confidence, ...] = ("gm", "theory", "once")
KNOWN_MAX = 40  # known facts shown to the facts step: more would crowd out the notes

FACTS_SCHEMA = _obj(
    {
        "facts": {
            "type": "array",
            "items": _obj(
                {
                    "about": STR,
                    "text": STR,
                    "confidence": {"type": "string", "enum": list(CONFIDENCES)},
                    "replaces": {"type": "integer"},
                }
            ),
        }
    }
)

FACTS_SYSTEM = """You keep the glossary of a Dungeons & Dragons campaign. You get a session's notes, and the facts
the glossary already holds about the names in them (numbered).
facts: up to 15 lasting things the notes show about a named person, creature, group, place or item: still true
next session, each a full sentence naming its subject ("Mudge the ogre now guards the Greyfen bridge.");
about = that name as the notes write it. Never passing states (hit points, where someone is standing, what they
are doing right now), rules, or trivia ("is a player character").
confidence: gm = the GM narrated or confirmed it; theory = a player's guess or theory; once = said once,
unconfirmed.
replaces: the number of a known fact this one changes or overturns (a debt paid, an ally turned enemy); -1 when
it is new, or only repeats a known fact (then leave it out).
Answer with JSON only."""


@dataclass
class Suggestion:
    about: str
    text: str
    confidence: Confidence = "once"
    replaces: str | None = None  # the text of the known fact it changes


def facts(llm, notes: Notes, known: list[Fact] | None = None, progress=None) -> list[Suggestion]:
    """Suggested facts from the notes alone: cheap, and nothing the reading didn't already find. `known` are the
    facts the vault already holds about names in the notes; the model may say a new fact changes one."""
    known = (known or [])[:KNOWN_MAX]
    block = "\n".join(f"{i}. [{f.about}] {f.text}" for i, f in enumerate(known, start=1)) or "(none)"
    raw = llm.json(FACTS_SYSTEM, f"Known facts:\n{block}\n\nNotes:\n{notes.text()}", FACTS_SCHEMA, 2000, progress=progress)
    out = []
    for f in as_list(raw.get("facts")):
        if not isinstance(f, dict) or not (about := clean(f.get("about"), NAME_MAX)) or not (text := clean(f.get("text"))):
            continue
        confidence: Confidence = "gm" if f.get("confidence") == "gm" else "theory" if f.get("confidence") == "theory" else "once"
        n = f.get("replaces")
        # bool is an int in Python; an out-of-range or non-integer number means "new".
        old = known[n - 1].text if isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= len(known) else None
        out.append(Suggestion(about, text, confidence, old))
    return out[:LIST_MAX]


# ------------------------------------------------------------------ where a fact was said (no model)

SOURCE_MIN = 0.35  # share of the fact's IDF weight a line must carry; see source_line
NAME_BONUS = 0.1


def source_line(fact_text: str, about: str, aliases: list[str], lines: list[dict]) -> dict | None:
    """The transcript line a fact most likely came from, or None.

    A line scores the share of the fact's words (IDF-weighted over this session's lines, `ask.tokens`) it
    contains, plus NAME_BONUS when it names `about` or an alias. Ties go to the earlier line. A best score under
    SOURCE_MIN gives None: no line is better than a wrong one. 0.35 comes from the fixtures in
    test_writeup_sources.py: a real source shares at least about half the fact's weight, an unrelated line that
    only repeats the subject's name scores 0.1-0.25."""
    from .ask import tokens  # ask imports memory, which imports this module: a top-level import is a cycle

    wanted = set(tokens(fact_text))
    if not wanted or not lines:
        return None
    line_tokens = [set(tokens(m.get("text", ""))) for m in lines]
    idf = {w: math.log(1 + len(lines) / (1 + sum(w in t for t in line_tokens))) for w in wanted}
    total = sum(idf.values())
    names = [n for n in (about, *aliases) if norm(n)]
    best, best_score = None, 0.0
    for m, have in zip(lines, line_tokens, strict=True):
        score = sum(idf[w] for w in wanted & have) / total
        text = norm(m.get("text", ""))
        if score and any(re.search(rf"\b{re.escape(norm(n))}\b", text) for n in names):
            score += NAME_BONUS
        if score > best_score:  # strictly: the earlier line wins a tie
            best, best_score = m, score
    return best if best_score >= SOURCE_MIN else None


def said_by(line: dict) -> str | None:
    """Who spoke a line: the character when spoken in character, else the player; None for an unnamed voice."""
    return line.get("character") or (line.get("speaker") if line.get("player_id") else None) or None


# ------------------------------------------------------------------ scenes

SCENES_MIN, SCENES_MAX, TITLE_WORDS = 2, 8, 8
SCENES_SCHEMA = _obj({"scenes": {"type": "array", "items": _obj({"start": {"type": "integer"}, "title": STR, "place": STR})}})
SCENES_SYSTEM = """You split a Dungeons & Dragons session into scenes, from its numbered beats.
scenes: 3 to 8, in order. start = the number of the beat where the scene begins (the first scene starts at beat
1, every start is later than the one before); title = at most 8 words naming what the scene is about, no
timestamps; place = the place where it happens, only if it is one of the known places, else an empty string.
Answer with JSON only."""


def scenes(llm, notes: Notes, places: dict[str, str], progress=None) -> list[dict] | None:
    """[{t, title, place}] from the beats, or None when the reply has too few usable scenes. `places` maps
    norm(name or alias) to the Place's name. Everything the model says is checked: starts must be beat numbers
    in strictly increasing order (a start that goes back is dropped), the first scene is moved to beat 1, titles
    are cleaned and cut to 8 words, an unknown place becomes null, and a scene needs a beat that has a real
    timestamp (beats whose time the transcript doesn't have can't start one)."""
    if not notes.beats:
        return None
    listing = "\n".join(f"{i}. [{b.at or '?'}] {b.text}" for i, b in enumerate(notes.beats, start=1))
    known = ", ".join(sorted(set(places.values()))) or "(none)"
    raw = llm.json(SCENES_SYSTEM, f"Known places: {known}\n\nBeats:\n{listing}", SCENES_SCHEMA, 1000, progress=progress)
    out: list[dict] = []
    last_start, last_t = 0, -1.0
    for s in as_list(raw.get("scenes")):
        if not isinstance(s, dict) or not isinstance(s.get("start"), int) or isinstance(s.get("start"), bool):
            continue
        start = s["start"]
        title = " ".join(clean(s.get("title"), 120).split()[:TITLE_WORDS])
        if not out:
            start = 1  # the first scene always opens the session
        beat = notes.beats[start - 1] if 1 <= start <= len(notes.beats) else None
        if not title or beat is None or start <= last_start:
            continue
        t = _clock_seconds(beat.at) if beat.at else 0.0 if start == 1 else None
        if t is None or t <= last_t:
            continue
        place = places.get(norm(clean(s.get("place"), NAME_MAX)))
        out.append({"t": t, "title": title, "place": place})
        last_start, last_t = start, t
        if len(out) == SCENES_MAX:
            break
    return out if len(out) >= SCENES_MIN else None


# ------------------------------------------------------------------ while it runs (no extra model calls)

SNIPPET_MAX = 160
_STRING = r'"((?:[^"\\]|\\.)*)"'
_SECTION = re.compile(r'"(beats|characters|people|places|loot|open|ending|spellings)"\s*:')
_BEAT = re.compile(r'\{\s*"at"\s*:\s*' + _STRING + r'\s*,\s*"text"\s*:\s*' + _STRING + r"\s*\}")
_NAMED = re.compile(
    r'\{\s*"name"\s*:\s*' + _STRING + r'\s*,\s*(?:"kind"\s*:\s*' + _STRING + r'\s*,\s*)?"what"\s*:\s*' + _STRING + r"\s*\}"
)
_ITEM = re.compile(_STRING + r"\s*[,\]]")


def _unescape(s: str) -> str:
    try:
        text = clean(json.loads(f'"{s}"'), 10_000)
    except ValueError:
        text = clean(s, 10_000)
    if len(text) <= SNIPPET_MAX:
        return text
    return text[:SNIPPET_MAX].rsplit(" ", 1)[0].rstrip(",;:") + "…"


def snippets(partial: str) -> list[dict]:
    """Finished entries in a notes reply that is still streaming: beats, the people met, places, loot. Shown
    while the model writes (the same text it is writing anyway). An entry still being written is skipped."""
    marks = [(m.start(), m.group(1)) for m in _SECTION.finditer(partial)]
    out = []
    for i, (start, section) in enumerate(marks):
        body = partial[start : marks[i + 1][0] if i + 1 < len(marks) else len(partial)]
        if section == "beats":
            out += [{"kind": "beat", "at": _unescape(at), "text": _unescape(t)} for at, t in _BEAT.findall(body)]
        elif section in ("people", "places", "characters"):
            kind = {"people": "person", "places": "place", "characters": "character"}[section]
            out += [{"kind": kind, "at": "", "text": f"{_unescape(n)}: {_unescape(w)}"} for n, _, w in _NAMED.findall(body)]
        elif section == "loot":
            out += [{"kind": "loot", "at": "", "text": _unescape(x)} for x in _ITEM.findall(body.split("[", 1)[-1])]
    return [s for s in out if s["text"]]


_NAT = re.compile(r"\bnat(?:ural)?[ -]?(20|twenty|1|one)\b", re.I)


def table_stats(record: dict, names: list[str]) -> list[str]:
    """Things about the session code can count in a moment, to show while the model is still reading."""
    msgs = [m for m in record.get("messages") or [] if isinstance(m, dict) and isinstance(m.get("text"), str)]
    s = record.get("session") or {}
    out = []
    if msgs:
        players = {p.get("id"): p for p in record.get("players") or []}
        out.append(f"{_clock(s.get('duration_s', 0))} of play, {len(msgs):,} lines, {len(players)} at the table")
        talk: dict[str, float] = {}
        for m in msgs:
            who = m.get("speaker") or ""
            if who and m.get("player_id"):
                talk[who] = talk.get(who, 0.0) + max(0.0, float(m.get("t_end", 0)) - float(m.get("t_start", 0)))
        total = sum(talk.values())
        if total:
            top = sorted(talk.items(), key=lambda kv: -kv[1])[:2]
            out.append("Most talk: " + ", ".join(f"{who} {round(100 * t / total)}%" for who, t in top))
        text = "\n".join(m["text"] for m in msgs)
        counted = sorted(((len(re.findall(rf"\b{re.escape(n)}\b", text, re.I)), n) for n in names if len(n) >= 3), reverse=True)
        if counted and counted[0][0] >= 3:
            out.append(f"Most-said name: {counted[0][1]} ({counted[0][0]} times)")
        nats = [m.group(1).lower() for m in _NAT.finditer(text)]
        twenties = sum(n in ("20", "twenty") for n in nats)
        ones = len(nats) - twenties
        if nats:
            out.append(f"Natural 20s called out: {twenties}; natural 1s: {ones}")
        loud = [m for m in msgs if isinstance(m.get("level_db"), (int, float)) and len(m["text"].split()) >= 4]
        if loud:
            top = max(loud, key=lambda m: m["level_db"])
            out.append(
                f"Loudest moment, {_clock(top.get('t_start', 0))}: {top.get('speaker') or 'someone'}: “{clean(top['text'], 100)}”"
            )
    return out


def _clock(seconds) -> str:
    s = int(seconds or 0)
    h, m, s = s // 3600, s % 3600 // 60, s % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"
