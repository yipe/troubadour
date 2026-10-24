"""Campaign memory jobs: the local LLM reads pasted notes and played sessions into the vault.

- import_notes: pasted session notes → Notes/<title>.md (verbatim) + entities and facts.
  The notes are the user's own, so what they name is added as confirmed.
- write_up: a saved session's transcript → Sessions/<date> <title>.md. Each chunk becomes a
  plain log (what happened, an aside, a correction, a retraction, or still open). Asides and
  retracted lines never reach the note. A second pass writes the paragraph and the scenes
  from that log only, plus *suggested* facts, entities and heard-as spellings for review in
  the Campaign tab. The transcript is copied to Sessions/Transcripts/.
- spelling_suggestions: no LLM; transcript words that look like misspellings of a glossary
  name ("Dilara" for Elara), and frequent unknown names worth adding.

Jobs run one at a time on a worker thread and report progress as `campaign.job` events;
every change to the vault is followed by `campaign.updated`. Model output is untrusted:
names, types and lengths are validated before anything is written.
"""

import collections
import concurrent.futures
import difflib
import json
import logging
import queue
import re
import threading
import time
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from . import config, dnd_terms, transcript
from .campaign import TYPES, Entity, Vault, add_unique, everyday, norm, safe_name, write_atomic

log = logging.getLogger("troubadour")

CHUNK_CHARS = 6000  # notes per extraction call; small enough for a fast, careful answer
# Per transcript part, whatever the model returns. The last part gets more room so the ending
# and anything still unresolved can land as their own claims.
PART_FACTS, PART_NAMES, PART_CLAIMS, FINAL_PART_CLAIMS = 5, 8, 20, 30
NOTE_MAX = 16  # scenes on the session page; the claim list is notes for that pass, not the page
STORY_SO_FAR = 15  # earlier log lines shown to each later part
PART_MOMENTS, MAX_MOMENTS = 5, 12
REASONING_HEADROOM = 12000  # extra max_tokens for a thinking model's reasoning
NOTE_SEGMENT_PARTS = 4  # parts (~15 min each) per note call on a long session
MOMENT_WORKERS = 2
VERIFY_WORKERS = 4  # scene/moment checks at once (LM Studio --parallel 4)
EVIDENCE_LINES, EVIDENCE_CHARS = (
    40,
    6000,
)  # transcript window a scene is checked against  # pass B calls at once, beside pass A; LM Studio is loaded with --parallel 4  # dice/combat brag lines per part and per page
BRIEF_DESCRIPTION_MAX = 80  # chars of each glossary entry's description in LLM prompts
MAX_SUGGESTED_FACTS = 30  # per write-up: more than anyone will review
# A passing state, not a fact ("Elara has one third-level spell slot remaining").
FLEETING = re.compile(
    r"\b("
    r"hit points?|\bhp\b|spell slots?|currently|right now|at the moment|for now|this turn|"
    r"concentration|temporary hit|"
    r"is (standing|sitting|walking|holding|filling|unconscious|prone|stunned|paralyzed|concentrating)|"
    r"until (the )?(next )?(rest|dawn|morning|tomorrow)|"
    r"(has|have|had) (only |just )?(one|two|three|four|five|\d+|no|a) (\w+ ){0,4}(spell slot|hit point)"
    r")\b",
    re.I,
)
TRANSCRIPT_CHUNK_CHARS = 12000  # ~15 min of table talk per write-up call
MAX_ITEMS = 40
NAME_MAX, TEXT_MAX = 80, 300
CLAIM_TEXT_MAX = 600  # one settled scene; 300 cut a finale off mid-sentence
CLAIM_STATUS = {"happened", "open", "joke", "retracted", "corrected"}
_KIND = {
    "did": "happened",
    "aside": "joke",
    "happened": "happened",
    "joke": "joke",
    "open": "open",
    "retracted": "retracted",
    "corrected": "corrected",
}


# ------------------------------------------------------------------ LLM


class MemoryLLM:
    """OpenAI-compatible chat with a JSON schema (LM Studio supports structured output)."""

    def __init__(self, url: str = config.LLM_URL, model: str = config.MEMORY_LLM_MODEL, timeout: float = 600, api_key: str = ""):
        self.url = url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.client = httpx.Client(timeout=timeout)

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

    def healthy(self) -> bool:
        """The server answers and has this model."""
        try:
            r = self.client.get(f"{self.url}/models", headers=self._headers(), timeout=3)
            data = r.json().get("data", []) if r.status_code == 200 else []
            return any(isinstance(m, dict) and m.get("id") == self.model for m in data)
        except Exception:  # down, wrong service on the port, non-JSON reply: all mean "not usable"
            return False

    def json(self, system: str, user: str, schema: dict, max_tokens: int = 4000) -> dict:
        thinking = config.MEMORY_REASONING not in ("", "none")
        payload = {
            "model": self.model,
            "temperature": 0,
            # Thinking tokens count against max_tokens; without room the JSON is cut off and parses to {}.
            "max_tokens": max_tokens + (REASONING_HEADROOM if thinking else 0),
            "reasoning_effort": config.MEMORY_REASONING,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "response_format": {"type": "json_schema", "json_schema": {"name": "out", "strict": True, "schema": schema}},
        }
        r = self.client.post(f"{self.url}/chat/completions", headers=self._headers(), json=payload)
        # OpenRouter and some local servers reject reasoning_effort or strict json_schema.
        if r.status_code == 400:
            payload.pop("reasoning_effort", None)
            payload.pop("response_format", None)
            r = self.client.post(f"{self.url}/chat/completions", headers=self._headers(), json=payload)
        if r.is_error:
            raise RuntimeError(f"The model server couldn't answer ({r.status_code}): {_server_error(r)}")
        choice = r.json()["choices"][0]
        content = choice["message"]["content"] or ""
        if choice.get("finish_reason") == "length":
            log.warning("model reply cut off at %s tokens; that part of the job is lost", payload["max_tokens"])
        match = re.search(r"\{.*\}", content, re.S)
        try:
            out = json.loads(match.group(0)) if match else {}
        except json.JSONDecodeError:
            log.warning("model reply was not JSON (%d chars); that part of the job is lost", len(content))
            out = {}
        return out if isinstance(out, dict) else {}


def _server_error(r: httpx.Response) -> str:
    """LM Studio's reason, short: its last line ("The model has crashed…"), not a 400 with a docs link."""
    try:
        err = r.json().get("error")
    except ValueError:
        err = r.text
    if isinstance(err, dict):
        err = err.get("message")
    lines = [line.strip() for line in str(err or "").splitlines() if line.strip()]
    return (lines[-1] if lines else "no details")[:200]


def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or list(props), "additionalProperties": False}


STR = {"type": "string"}
STRS = {"type": "array", "items": STR}
KIND = {"type": "string", "enum": list(TYPES)}

NOTES_SCHEMA = _obj(
    {
        "entities": {
            "type": "array",
            "items": _obj({"name": STR, "type": KIND, "aliases": STRS, "description": STR, "facts": STRS}),
        },
        "campaign_facts": STRS,
    }
)

NOTES_SYSTEM = """You build the glossary for a Dungeons & Dragons campaign from the players' or GM's notes.
List every NAMED thing in the notes: player characters (pc), NPCs (npc), places, factions, items,
creatures, spells, and campaign-specific terms (term). Skip generic words (the party, a goblin, initiative).
For each: the exact spelling used in the notes; other names the notes use for it (aliases); one short
sentence saying what it is; and up to 5 short facts the notes state about it. Never guess or invent.
If a name matches one in the existing glossary, use the glossary's spelling.
campaign_facts: up to 5 facts about the campaign as a whole (where the party is, the main quest).
Answer with JSON only."""

WRITEUP_SCHEMA = _obj(
    {
        "log": {
            "type": "array",
            "items": _obj({"text": STR, "kind": {"type": "string"}, "fixes": STR}),
        },
        "facts": {"type": "array", "items": _obj({"about": STR, "text": STR})},
        "new_names": {"type": "array", "items": _obj({"name": STR, "type": KIND, "description": STR})},
        "spellings": {"type": "array", "items": _obj({"heard": STR, "means": STR})},
    }
)

VERIFY_SCHEMA = _obj({"verdict": STR, "sentence": STR})

VERIFY_SYSTEM = """You check one sentence from a Dungeons & Dragons session note against the transcript lines it
came from (speech-to-text, so names and words can be misheard; the glossary has the right spellings).
Check: who did it and who it happened to, who acted first, the order of events, numbers and counts, and
names. verdict: "ok" if the transcript supports it; "fixed" if part of it is wrong, with sentence = the
corrected sentence (same meaning otherwise, no longer, nothing added that the lines do not show);
"unsupported" if these lines do not show it at all. Answer with JSON only."""

RECAP_SCHEMA = _obj({"summary": STR})

TOP_SCHEMA = _obj({"title": STR, "summary": STR, "highlights": STRS})

TOP_SYSTEM = """You get the scenes of a Dungeons & Dragons session, in order. Write:
summary: one paragraph, at most 120 words, past tense, plain, using only these scenes. End where the last scene ends.
highlights: 3 to 6 sentences copied from the scenes, the ones the players will retell. Not the scenery.
title: 2-5 words, no date.
Answer with JSON only."""

RECAP_SYSTEM = """You get the scenes of a Dungeons & Dragons session, in order. Write summary: one paragraph, at
most 120 words, past tense, plain, using only these scenes. End where the last scene ends. Answer with JSON only."""

WRITEUP_SYSTEM = """You turn a piece of a Dungeons & Dragons session's speech-to-text transcript into a
plain log. You also get the campaign glossary. The transcript mishears names; spell them as the glossary
does. Do not decide what was important. Do not write a story. Write what a careful note-taker would, in
order, one sentence per thing that happened.
log: each line has text, kind, and fixes.
kind is one of:
- did: the table settled it. The GM narrated it, or a player did it and nobody took it back. A fight is
  one line: who fought whom, why if someone said why, and how it ended, including anyone knocked out or
  nearly killed. Not the rolls. "The party rolled initiative" is not a log line. Neither is a single
  attack, a hit or miss, damage, a saving throw, or a spell list.
- open: still unresolved (a letter not delivered, a question left hanging). Not a plan and not a guess.
- aside: a joke, real-life talk, rules chatter, a guess, or "someone could do X" when they did not.
- retracted: the table took an earlier line back. fixes = a short quote from that line. Do not restate
  the false version.
- corrected: the settled truth that replaces an earlier line. fixes = a short quote from the line it
  replaces. Say what was wrong when that matters ("Magenta was at about one hit point; she did not die.").
Do not merge two different things because they share a word. A body, an arm, or a creature the party
found is not a person who has been traveling with them. If you are not sure they are the same, write
them as separate lines. "Can repair" or "offered to" is an aside, not a did, unless the transcript shows
they did it.
Lines are labelled with who spoke. "Auggie (played by Kris)" is a player character speaking. A player
character's name is never the name of something the party finds: a dead or broken autognome (a kind of
creature) is not the player character Auggie, even if the names sound alike. The GM speaks for every NPC
and monster; a familiar belongs to the player whose character has it. Say who did a thing and who it
happened to exactly as the transcript does; if you cannot tell, leave the person out. Keep the proper
name of every NPC the table meets. Do not treat a word you cannot place (a place name that is not in the
glossary and was said once) as a real place: write it as the GM said it or leave it out. Do not say
why something happened unless someone in the transcript said why.
Someone new who arrives is not a known NPC unless the transcript names them as that NPC. Numbers like
"10-02" or "9.13" may be map hexes or the in-game time; say which only if the transcript makes it clear.
fixes is "" except on retracted and corrected. Never invent anything that is not in the transcript.
facts: up to 5 lasting things learned about someone or something, that will still be true next session,
each a full sentence naming its subject ("Magenta is afraid of heights."); about = that name as the
glossary spells it, or as the transcript does if it's new. Never passing states (hit points, where
someone is standing, what they're doing right now), rules, or trivia ("is a player character").
new_names: named NPCs, places, items, factions or creatures that matter in this part and are NOT in the
glossary (and are not a misspelling of a glossary name), with a one-sentence description. Up to 10.
spellings: when the transcript clearly misspells a glossary name, the misspelled word exactly as it appears
(heard) and the glossary name it means (means). Only clear cases.
Players joke, plan, speculate and talk about real life; only what actually happens in the game counts,
usually what the GM narrates or confirms ("They assassinate her." as a joke is not an event).
Never invent anything that isn't in the transcript. Answer with JSON only."""

MOMENTS_SCHEMA = _obj({"moments": {"type": "array", "items": _obj({"at": STR, "text": STR})}})

MOMENTS_SYSTEM = """You pick out the moments a Dungeons & Dragons table will retell from a piece of a session's
speech-to-text transcript. Lines are labelled with who spoke; the GM speaks for every NPC and monster.
moments: up to 5, in order, each one sentence naming who did it or who it happened to:
- a natural 20 or natural 1, a critical hit, unusually big damage in one turn (give the number), someone
  dropped to 0 hit points or killed, a clutch save;
- what set the table off at a listed loud moment: a twist, a disaster, a joke that landed. Say what
  caused it, not that people laughed.
Not ordinary hits, misses or rolls. Only what the transcript shows; jokes about what could happen are
not moments. Every listed loud moment gets one moment unless it was only crosstalk about something else.
at = the timestamp of the line where it happened, exactly as written (e.g. 2:06:23).
If nothing qualifies, return no moments. Answer with JSON only."""

FACT_SCHEMA = _obj({"facts": STRS})

FACT_SYSTEM = """You extract lasting facts about one named thing in a Dungeons & Dragons campaign.
You get its name, the facts already known, and a passage from a transcript or from imported notes.
facts: sentences that will still be true next session. Who they are, what they can do, what they own
that they will still own, who they owe, what they want, where they are from, what happened to them
that changed them. Each sentence names them.
Not a fact: hit points, spell slots remaining, conditions, concentration, where they are standing,
what they are doing in this scene, a roll, a joke, or a plan they have not carried out.
"Elara has one third-level spell slot remaining" is not a fact. "Elara is a cleric" is.
Skip anything already in the known facts. Never invent. If the passage says nothing lasting, return
no facts. Answer with JSON only."""


SESSION_END = (
    "This part is the end of the session. The last did lines should say where they stopped and what they "
    "came away with. Anything still unresolved is open, not a plan."
)

NOTE_SCHEMA = _obj(
    {
        "title": STR,
        "summary": STR,
        "scenes": STRS,
        "open": STRS,
        "highlights": STRS,
    }
)

NOTE_SYSTEM = """You write the session note a Dungeons & Dragons player would tell a friend who missed the game.
You get a log of what the table settled, already in order, and a short list of what is still open. You do
not have the transcript. If the log does not say it, it did not happen.

scenes: 6 to 14 sentences, in order. One scene or one fight is one sentence: what changed and how it
ended. Keep two log lines separate when they are about different things, even if they share a name. A
found body or a found object is not a person who was already with the party. Keep the proper name of
every named NPC the log mentions. Join two events with "then", never "leading to" or "prompting", unless
the log itself says one caused the other. Leave out travel that changed nothing, and leave out a detail
that only explains how they reached the thing that mattered.
open: copy only the unresolved items. Not a plan, not a guess, not something the log already says was done,
and not someone's arrival that the log goes on to describe.
highlights: 3 to 6 sentences copied from scenes, the ones the players will retell. Not the scenery.
summary: one paragraph, at most 120 words, past tense, plain, using only the scenes. End where the log ends.
"(fight detail)" lines are blow-by-blow combat. Never copy them; turn each fight into one scene: who
fought whom, why if the log says why, any standout damage (give the number), and how it ended.
The last scene says where the session ended: where they stopped, camped or rested.
title: 2-5 words, no date.
Answer with JSON only."""


# ------------------------------------------------------------------ validation


def fleeting(text: str) -> bool:
    """True when a sentence is a moment in the session, not something still true next time."""
    return bool(FLEETING.search(text))


def passages_about(vault: Vault, sessions_dir: Path, names: list[str]) -> list[tuple[str, str]]:
    """(label, text) for each transcript and imported note that mentions one of these names.

    A long transcript contributes only the lines that say the name, not the whole sitting.
    """
    needles = [n.casefold() for n in names if len(n) >= 2 and not (n.casefold() != names[0].casefold() and everyday(n))]
    if not needles:
        return []
    rx = re.compile(
        r"(?<![a-z0-9])(?:" + "|".join(re.escape(n) for n in sorted(set(needles), key=len, reverse=True)) + r")(?![a-z0-9])"
    )
    out: list[tuple[str, str]] = []

    def keep(label: str, lines: list[str]) -> None:
        hit = [line for line in lines if rx.search(line.casefold())]
        if not hit:
            return
        text = "\n".join(hit)
        # One call per source, split only when the mentions themselves are long.
        while text:
            out.append((label, text[:8000]))
            text = text[8000:]

    if sessions_dir.is_dir():
        for path in sorted(sessions_dir.glob("*/transcript.json")):
            try:
                record = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            lines = [m.get("text", "") for m in record.get("messages") or [] if isinstance(m, dict)]
            keep(path.parent.name, [ln for ln in lines if isinstance(ln, str)])
    notes = vault.root / "Notes"
    if notes.is_dir():
        for path in sorted(notes.glob("*.md")):
            try:
                body = path.read_text(encoding="utf-8")
            except OSError:
                continue
            keep(path.stem, body.splitlines())
    return out


def _text(value, limit: int = TEXT_MAX) -> str:
    return re.sub(r"\s+", " ", value).strip()[:limit] if isinstance(value, str) else ""


# Rules talk and single actions. A prompt asks the model to skip these; it often does not.
_PLAY = re.compile(
    r"\b("
    r"initiatives?|saving throws?|bonus actions?|spell slots?|"
    r"attacks?|attacked|dealing \d+|\d+ damage|"
    r"casts?|cast|"
    r"(?:fails?|succeeds?|succeeded|failed) (?:a |an |on |another )?(?:\w+ ){0,2}(?:saving throw|check|save)|"
    r"rolls? (?:a |an )?(?:dexterity|strength|constitution|intelligence|wisdom|charisma)"
    r")\b",
    re.I,
)
# How a fight or scene ended. A line with one of these is the story, even if it mentions an attack.
_OUTCOME = re.compile(
    r"\b(downed|knocked (?:out|unconscious)|nearly (?:killed|died|dead)|badly (?:hurt|wounded|injured)|"
    r"gravely|killed|died|defeated|fled|retreated|surrendered|escaped|wanted \w+ dead|because)\b",
    re.I,
)
_NOT_OPEN = re.compile(r"\b(plans to|wants to|is going to|hopes to|might|maybe|possibly|could be)\b", re.I)
_CONTENT = re.compile(r"[A-Za-z][A-Za-z'-]{3,}")
_STOP = frozenset(
    "that this with from they them their there then than were been have into over after before about "
    "session party still just only when what your into onto also back".split()
)


def _play_by_play(text: str) -> bool:
    if _OUTCOME.search(text):
        return False
    return bool(_PLAY.search(text)) or bool(re.search(r"\bis present\b", text, re.I))


def _words(text: str) -> set[str]:
    return {w.casefold() for w in _CONTENT.findall(text) if w.casefold() not in _STOP}


def _grounded(text: str, source: str) -> bool:
    """A sentence earns its place when its content words actually occur in the claims it came from."""
    words = _words(text)
    if not words:
        return False
    have = _words(source)
    return len(words & have) >= min(2, len(words))


def _touches(fixes: str, text: str) -> bool:
    needle = _text(fixes).casefold()
    return bool(needle) and needle in text.casefold()


def _settle(claims: list[dict], fights: list[tuple[int, str]] | None = None) -> tuple[list[str], list[str]]:
    """What the table left standing, then what is still open.

    A joke never lands. A retraction removes the earlier claim it quotes and does not itself become
    a fact. A correction replaces the claim it quotes; if nothing matches, the correction is the fact.
    A blow-by-blow combat line is not a scene; with a fights list, it is kept there as (where it falls in
    happened, text), so the note can still say who fought, why and how it ended.
    """
    happened: list[str] = []
    open_: list[str] = []
    for claim in claims:
        status = _KIND.get(claim.get("kind") or claim.get("status"))
        text = _text(claim.get("text"), CLAIM_TEXT_MAX)
        if status not in CLAIM_STATUS or not text:
            continue
        fixes = claim.get("fixes") if isinstance(claim.get("fixes"), str) else ""
        if status == "joke":
            continue
        if _play_by_play(text):
            if fights is not None and status == "happened":
                fights.append((len(happened), text))
            continue
        if status == "open" and _NOT_OPEN.search(text):
            continue
        if status == "retracted":
            for i in range(len(happened) - 1, -1, -1):
                if _touches(fixes, happened[i]):
                    del happened[i]
                    break
            continue
        if status == "corrected":
            for i in range(len(happened) - 1, -1, -1):
                if _touches(fixes, happened[i]):
                    happened[i] = text
                    break
            else:
                happened.append(text)
            continue
        (open_ if status == "open" else happened).append(text)
    return happened, open_


def _spread(items: list[str], n: int) -> list[str]:
    """n of items, in order, evenly across the list and always ending with the last: the first n
    would end the page partway through the session."""
    if len(items) <= n:
        return items
    return [items[round(i * (len(items) - 1) / (n - 1))] for i in range(n)]


def _lines(value, limit: int = NOTE_MAX) -> list[str]:
    out = []
    for item in value if isinstance(value, list) else []:
        if isinstance(item, str) and (text := _text(item, CLAIM_TEXT_MAX)):
            out.append(text)
        if len(out) >= limit:
            break
    return out


# Shouts, laughs and gasps in table talk ("No!", "oh my god", "ha ha").
_REACTION = re.compile(
    r"!|\b(oh my god|oh no|holy|ha(?: ?ha)+|let'?s go|amazing|wow|whoa|what the)\b",
    re.I,
)
HOT_WINDOW_S, HOT_GAP_S, HOT_SPOTS = 30.0, 120.0, 10


def hot_spots(messages: list[dict], n: int = HOT_SPOTS) -> list[float]:
    """Start times of the n liveliest 30 s stretches, at least 2 min apart, in order.

    Lively = reactions (shouts, laughs), several people talking, louder than the session's usual level,
    many short lines. Weights tuned by eye on a real session, where the top spots were the big fight,
    a trap going off and a tense roll.
    """
    levels = sorted(m["level_db"] for m in messages if m.get("level_db") is not None)
    usual = levels[len(levels) // 2] if levels else 0.0
    scored = []
    j = 0
    for i, m in enumerate(messages):
        j = max(j, i)
        while j < len(messages) and messages[j]["t_start"] < m["t_start"] + HOT_WINDOW_S:
            j += 1
        window = messages[i:j]
        loud = [x["level_db"] - usual for x in window if x.get("level_db") is not None]
        score = (
            sum(bool(_REACTION.search(x["text"])) for x in window)
            + 0.5 * len({x["speaker"] for x in window})
            + 0.3 * (sum(loud) / len(loud) if loud else 0.0)
            + 0.2 * len(window)
        )
        scored.append((score, m["t_start"]))
    picked: list[float] = []
    for _, t in sorted(scored, key=lambda st: -st[0]):
        if all(abs(t - p) > HOT_GAP_S for p in picked):
            picked.append(t)
        if len(picked) == n:
            break
    return sorted(picked)


# A brag-worthy moment names a roll, a number or a knockout; anything else is a scene, not a moment.
_MOMENT = re.compile(
    r"\b(nat(?:ural)? ?(?:20|1|one|twenty)|crit(?:ical)?s?|\d+ (?:points of )?damage|one[- ]shot\w*|"
    r"dropped to 0|down(?:ed)?|unconscious|killed|died|death saves?|saving throw|save)\b",
    re.I,
)


def _seconds(clock: str) -> float:
    parts = [int(p) for p in clock.split(":")]
    return float(sum(p * 60**i for i, p in enumerate(reversed(parts))))


def _moments(value, part: str, loud: list[float], seen: set[str]) -> list[tuple[str, str]]:
    """(at, text) pairs at a real line of this part. A moment is kept when it names a roll, a number or a
    knockout, or when it falls in a stretch where the table was loud (whatever set them off counts).
    A model's "moment" at a time that isn't in the transcript is made up."""
    out = []
    for m in value if isinstance(value, list) else []:
        if not isinstance(m, dict):
            continue
        at, text = _text(m.get("at"), 10), _text(m.get("text"))
        if not (re.fullmatch(r"\d{1,2}:\d{2}(?::\d{2})?", at) and re.search(rf"(?m)^{re.escape(at)} ", part)):
            continue
        hot = any(t <= _seconds(at) < t + HOT_WINDOW_S for t in loud)
        if not text or not (hot or _MOMENT.search(text)) or norm(text) in seen:
            continue
        seen.add(norm(text))
        out.append((at, text))
    return out


def _note(
    value: dict, happened: list[str], open_: list[str], fight_details: list[str] = ()
) -> tuple[list[str], list[str], list[str]]:
    """Scenes, still-open, highlights for the page.

    A scene that does not use the claims' own words is dropped. A highlight that is not one of the
    scenes is dropped. If the model returns nothing usable, the page gets the claims themselves,
    capped, never the unfiltered list.
    """
    source = "\n".join([*happened, *open_, *fight_details])
    scenes = [s for s in _lines(value.get("scenes") if isinstance(value, dict) else None) if _grounded(s, source)]
    if not scenes:
        scenes = _spread(happened, NOTE_MAX)
    scene_blob = "\n".join(scenes)
    highlights = [
        h
        for h in _lines(value.get("highlights") if isinstance(value, dict) else None, 6)
        if _grounded(h, scene_blob) and not _play_by_play(h)
    ]
    open_source = "\n".join(open_)
    still = [
        s
        for s in _lines(value.get("open") if isinstance(value, dict) else None, 8)
        if open_source and _grounded(s, open_source) and not _NOT_OPEN.search(s)
    ]
    if isinstance(value, dict) and value.get("open") is None and not still:
        still = open_[:8]
    return scenes, still or (open_[:8] if not (isinstance(value, dict) and "open" in value) else still), highlights


_SMALL = {"of", "the", "and", "de", "du", "da", "von", "van", "a", "an", "in", "on", "to"}


def _name(value) -> str:
    """A plausible proper name, or "": short; not a list ("Willie, Ollie, and Wally"); not a
    description ("The rooster", "the party"): its words are capitalised, small words aside."""
    name = _text(value, NAME_MAX).strip(" .,:;\"'")
    if not name or not norm(name) or "," in name or ";" in name:
        return ""
    words = name.split()
    if words[0].casefold() == "the" and len(words) > 1:
        words = words[1:]
    big = [w for w in words if w.casefold() not in _SMALL]
    if not big or not big[0][0].isupper() or sum(w[0].isupper() for w in big) * 2 < len(big):
        return ""
    return name


def _kind(value) -> str:
    return value if value in TYPES else "term"


def chunks(text: str, size: int) -> list[str]:
    """Paragraph-aligned pieces of at most ~size chars (a single huge paragraph is split hard)."""
    out, cur = [], ""
    for para in re.split(r"\n\s*\n", text.strip()):
        if len(para) > size:
            if cur:
                out.append(cur)
                cur = ""
            while len(para) > size:
                out.append(para[:size])
                para = para[size:]
        if cur and len(cur) + len(para) + 2 > size:
            out.append(cur)
            cur = ""
        cur = f"{cur}\n\n{para}" if cur else para
    if cur.strip():
        out.append(cur)
    return out


def transcript_lines(record: dict) -> tuple[list[str], str]:
    """(lines, cast) for the LLM, from the session's roster: the GM, each character with its player, and
    unidentified voices are labelled so "Kris as Auggie" can't be read as Auggie being a thing in the
    scene. Roster, not per-line tags: the app tags a few of the GM's lines with an NPC they voiced."""
    roster = {p["id"]: p for p in record.get("players") or []}
    gms = {p["name"] for p in roster.values() if p.get("is_gm")}
    characters = {p["name"]: p["character"] for p in roster.values() if not p.get("is_gm") and p.get("character")}

    def who(m: dict) -> str:
        if not m.get("player_id"):
            return "Unknown voice"
        if m["speaker"] in gms:
            return f"GM {m['speaker']} voicing {m['character']}" if m.get("character") else f"GM {m['speaker']}"
        char = characters.get(m["speaker"])
        return f"{char} (played by {m['speaker']})" if char else m["speaker"]

    lines = [f"{transcript.clock(m['t_start'])} {who(m)}: {m['text']}" for m in record["messages"]]
    cast = [f"- {g} is the GM: they narrate and speak for every NPC and monster." for g in sorted(gms)]
    cast += [f"- {c} is a player character, played by {p}." for p, c in sorted(characters.items())]
    cast.append('- "Unknown voice" is a speaker the app could not identify.')
    return lines, "\n".join(cast)


def evidence(sentence: str, lines: list[str], width: int = EVIDENCE_LINES) -> str:
    """The stretch of transcript lines that shares the most of a sentence's content words, or "".

    Distinctive words (names, "mallet", "alarms") pin a scene to where it was played; the window is
    wide enough to hold who did what first. Fewer than 3 shared words: no evidence.
    """
    want = _words(sentence)
    if not want or not lines:
        return ""
    has = [_words(line) & want for line in lines]
    best, best_at = 0, 0
    for start in range(0, max(1, len(lines) - width + 1), max(1, width // 4)):
        covered = len(set().union(*has[start : start + width]))
        if covered > best:
            best, best_at = covered, start
    if best < min(3, len(want)):
        return ""
    return "\n".join(lines[best_at : best_at + width])[:EVIDENCE_CHARS]


def around(at: str, lines: list[str], seconds: float = 60.0) -> str:
    """Transcript lines within a minute either side of a timestamp like 2:04:53."""
    try:
        t = _seconds(at)
    except ValueError:
        return ""
    near = []
    for line in lines:
        clock = line.split(" ", 1)[0]
        try:
            if abs(_seconds(clock) - t) <= seconds:
                near.append(line)
        except ValueError:
            continue
    return "\n".join(near)[:EVIDENCE_CHARS]


def glossary_brief(vault: Vault, limit: int = 300) -> str:
    rows = []
    for e in vault.entities()[:limit]:
        also = f" (also {', '.join(e.aliases)})" if e.aliases else ""
        # Who they are, so "Delara" reads as the party's companion, not a mishearing of Elara.
        what = f": {e.description[:BRIEF_DESCRIPTION_MAX]}" if e.description else ""
        rows.append(f"- {e.name} [{e.type}]{also}{what}")
    return "\n".join(rows) or "(empty)"


# ------------------------------------------------------------------ jobs


@dataclass
class Job:
    id: str
    kind: str  # "import" | "writeup" | "facts" | "improve" | "spelling" | "retranscribe" | "backup" | "restore"
    title: str
    state: str = "queued"  # queued | running | done | error
    done: int = 0
    total: int = 0
    message: str = ""
    created: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    suggested: int = 0
    note: str | None = None  # vault-relative path of the note it wrote

    def to_json(self) -> dict:
        return dict(self.__dict__)


class Memory:
    def __init__(self, vault: Vault, bus, llm: MemoryLLM | None = None, sessions_dir=None, seed=lambda: []):
        self.vault = vault
        self.bus = bus
        self.llm = llm or MemoryLLM()
        self.sessions_dir = sessions_dir or (lambda: config.DATA_DIR / "sessions")
        self.seed = seed  # () -> [(name, type, description)]: names Troubadour already knows (Setup, voices panel)
        self.jobs: dict[str, Job] = {}
        self._q: queue.Queue = queue.Queue()
        self._lock = threading.Lock()
        threading.Thread(target=self._run, name="memory", daemon=True).start()

    # ---------------------------------------------------------------- job plumbing

    def emit(self, job: Job) -> None:
        self.bus.emit("campaign.job", job.to_json())

    def changed(self) -> None:
        try:
            self.vault.write_index()
        except OSError:
            log.exception("couldn't write Glossary.md")
        self.bus.emit("campaign.updated", {})

    def submit(self, kind: str, title: str, work) -> Job:
        """Queue work(job) on the job thread (one job at a time); progress goes out as campaign.job."""
        job = Job(id=uuid.uuid4().hex[:8], kind=kind, title=title)
        with self._lock:
            self.jobs[job.id] = job
            for old in sorted(self.jobs.values(), key=lambda j: j.id)[:-20]:
                if old.state in ("done", "error"):
                    del self.jobs[old.id]
        self.emit(job)
        self._q.put((job, work))
        return job

    def _run(self) -> None:
        while True:
            job, work = self._q.get()
            job.state = "running"
            self.emit(job)
            try:
                work(job)
                job.state = "done"
            except Exception as e:
                log.exception("campaign job %s failed", job.kind)
                job.state, job.message = "error", f"{type(e).__name__}: {e}"
            self.emit(job)
            self.changed()

    def list_jobs(self) -> list[dict]:
        with self._lock:
            return [j.to_json() for j in self.jobs.values()]

    def busy(self) -> bool:
        """A job is queued or running (they write the open campaign's notes and sessions)."""
        with self._lock:
            return any(j.state in ("queued", "running") for j in self.jobs.values())

    # ---------------------------------------------------------------- seeding

    def seed_known(self) -> list[str]:
        """Names Troubadour already knows become entries: Setup's characters (pc) and the character or
        NPC names given to voices in the voices panel (npc). The most certain names there are."""
        added = []
        for name, kind, description in self.seed():
            name = (name or "").strip()
            if not name or norm(name) in ("dm", "gm") or self.vault.find(name):
                continue
            try:
                self.vault.create(name, kind, description=description)
                added.append(name)
            except ValueError:
                continue
        if added:
            self.changed()
        return added

    # ---------------------------------------------------------------- import notes

    def import_notes(self, title: str, text: str) -> Job:
        title = safe_name(title or time.strftime("Notes %Y-%m-%d"))
        text = text.strip()
        if not text:
            raise ValueError("Paste some notes first.")
        return self.submit("import", title, lambda job: self._import(job, title, text))

    def _import(self, job: Job, title: str, text: str) -> None:
        self.seed_known()
        stamp = time.strftime("%Y-%m-%d")
        path = self.vault.write_note(
            "Notes", title, f"---\ntype: notes\nimported: {stamp}\ntags: [troubadour/notes]\n---\n# {title}\n\n{text}\n"
        )
        note = path.stem
        job.note = str(path.relative_to(self.vault.root))
        parts = chunks(text, CHUNK_CHARS)
        job.total = len(parts)
        self.emit(job)
        for part in parts:
            out = self.llm.json(NOTES_SYSTEM, f"Existing glossary:\n{glossary_brief(self.vault)}\n\nNotes:\n{part}", NOTES_SCHEMA)
            self._merge_notes(job, out, note)
            job.done += 1
            job.message = f"Read part {job.done} of {job.total}"
            self.emit(job)
            self.bus.emit("campaign.updated", {})
        job.message = f"{len(job.created)} new, {len(job.updated)} updated"

    def _merge_notes(self, job: Job, out: dict, note: str) -> None:
        source = f" ([[{note}]])"
        items = out.get("entities") if isinstance(out.get("entities"), list) else []
        for item in items[:MAX_ITEMS]:
            if not isinstance(item, dict) or not (name := _name(item.get("name"))):
                continue
            aliases = [a for a in (_name(a) for a in item.get("aliases") or [] if isinstance(a, str)) if a]
            facts = [f + source for f in (_text(f) for f in item.get("facts") or [] if isinstance(f, str)) if f][:5]
            description = _text(item.get("description"))
            existing = self.vault.find(name) or next((e for a in aliases if (e := self.vault.find(a))), None)
            # An alias that already names a *different* entry would make two notes claim one name.
            aliases = [a for a in aliases if (o := self.vault.find(a)) is None or (existing and o.path == existing.path)]
            if existing is None:
                try:
                    e = self.vault.create(name, _kind(item.get("type")), aliases=aliases, description=description, facts=facts)
                except ValueError:
                    continue
                job.created.append(e.name)
            else:
                # The user's own notes outrank a write-up's guess: a suggested entry they mention is
                # confirmed, and their description replaces the AI's.
                guessed = existing.status == "suggested"
                self.vault.update(
                    existing.name,
                    aliases=[
                        *existing.aliases,
                        *aliases,
                        *([name] if norm(name) not in {norm(n) for n in existing.names()} else []),
                    ],
                    facts=add_unique(existing.facts, facts),
                    description=(description or existing.description) if guessed else (existing.description or description),
                    status="confirmed",
                )
                if existing.name not in job.created and existing.name not in job.updated:
                    job.updated.append(existing.name)
        for fact in (out.get("campaign_facts") or [])[:5]:
            if text := _text(fact):
                self.vault.add_campaign_fact(text + source)

    # ---------------------------------------------------------------- session write-up

    def seek_facts(self, name: str) -> Job:
        """Read every transcript and imported note that mentions this entry, and suggest lasting facts."""
        if self.vault.find(name) is None:
            raise KeyError(name)
        return self.submit("facts", name, lambda job: self._seek_facts(job, name))

    def _seek_facts(self, job: Job, name: str) -> None:
        entity = self.vault.find(name)
        if entity is None:
            raise KeyError(name)
        passages = passages_about(self.vault, self.sessions_dir(), entity.names())
        if not passages:
            job.message = f"Nothing mentions {entity.name}"
            return
        known = "\n".join(f"- {f}" for f in [*entity.facts, *entity.suggested_facts]) or "- (none)"
        job.total = len(passages)
        self.emit(job)
        added = 0
        for label, text in passages:
            if added >= MAX_SUGGESTED_FACTS:
                break
            out = self.llm.json(
                FACT_SYSTEM,
                f"Name: {entity.name}\n\nKnown facts:\n{known}\n\nPassage ({label}):\n{text}",
                FACT_SCHEMA,
            )
            for raw in out.get("facts") or []:
                fact = _text(raw)
                if not fact or fleeting(fact):
                    continue
                before = self.vault.find(entity.name)
                if before is None:
                    return
                prior = len(before.facts) + len(before.suggested_facts)
                self.vault.add_fact(entity.name, f"{fact} ([[{label}]])", suggested=True)
                if len(self.vault.get(entity.name).facts) + len(self.vault.get(entity.name).suggested_facts) > prior:
                    added += 1
                    job.suggested += 1
                    if entity.name not in job.updated:
                        job.updated.append(entity.name)
                if added >= MAX_SUGGESTED_FACTS:
                    break
            job.done += 1
            job.message = f"Read {job.done} of {len(passages)}"
            self.emit(job)
        job.message = f"{added} new fact{'s' if added != 1 else ''} to review" if added else f"No new facts about {entity.name}"

    def write_up(self, sid: str) -> Job:
        path = self.sessions_dir() / sid / "transcript.json"
        if not path.is_file():
            raise KeyError(sid)
        record = json.loads(path.read_text())
        return self.submit("writeup", sid, lambda job: self._write_up(job, record))

    def _write_up(self, job: Job, record: dict) -> None:
        self.seed_known()
        s = record["session"]
        lines, cast = transcript_lines(record)
        if not lines:
            raise ValueError("That session has no lines.")
        body = "\n".join(lines)
        heard_text = norm(body)
        parts = chunks(body.replace("\n", "\n\n"), TRANSCRIPT_CHUNK_CHARS)
        loud = hot_spots(record["messages"])
        job.total = len(parts) + 1
        self.emit(job)
        claims: list[dict] = []
        facts: list[tuple[str, str]] = []
        new_names: dict[str, tuple[str, str]] = {}
        spellings: list[tuple[str, str]] = []
        hints = misspelling_hints(body, self.vault.entities())

        def find_moments(part: str) -> tuple[str, list[float], dict]:
            # Pass B: its own call, so the log's "what changed" reading doesn't crowd out "what made the
            # table erupt" (one combined prompt dropped the session's big fight).
            here = [t for t in loud if re.search(rf"(?m)^{re.escape(transcript.clock(t))} ", part)]
            mprompt = f"Who is at the table:\n{cast}\n\n"
            if here:
                mprompt += (
                    "Loud moments (shouting, laughing, crosstalk) start at: "
                    + ", ".join(transcript.clock(t) for t in here)
                    + "\n\n"
                )
            return part, here, self.llm.json(MOMENTS_SYSTEM, mprompt + f"Transcript:\n{part}", MOMENTS_SCHEMA, 800)

        # Pass B needs no story so far, so it runs beside pass A (LM Studio serves several predictions at once).
        pool = concurrent.futures.ThreadPoolExecutor(max_workers=MOMENT_WORKERS, thread_name_prefix="moments")
        pass_b = [pool.submit(find_moments, part) for part in parts]
        pool.shutdown(wait=False)  # queued calls still run; their results are read after pass A
        by_part: list[list[dict]] = []  # each part's log, so a long session's note can be written in segments
        for i, part in enumerate(parts):
            prompt = f"Who is at the table:\n{cast}\n\nGlossary:\n{glossary_brief(self.vault)}\n\n"
            # The previous parts' log, so a part that starts mid-scene knows who is who (the rider
            # who shows up is not the NPC who stayed behind) and doesn't re-log what already happened.
            so_far = [c["text"] for c in claims if c.get("kind") in ("did", "corrected")][-STORY_SO_FAR:]
            if so_far:
                prompt += "Story so far (already logged; do not repeat):\n" + "\n".join(f"- {t}" for t in so_far) + "\n\n"
            if hints:
                prompt += f"Likely misspellings of glossary names in this transcript:\n{hints}\n\n"
            last = i == len(parts) - 1
            if last:
                prompt += f"{SESSION_END}\n\n"
            out = self.llm.json(WRITEUP_SYSTEM, prompt + f"Transcript:\n{part}", WRITEUP_SCHEMA)
            raw = out.get("log") or out.get("claims") or []
            part_claims = [c for c in raw if isinstance(c, dict) and _text(c.get("text"), CLAIM_TEXT_MAX)]
            by_part.append(part_claims[: FINAL_PART_CLAIMS if last else PART_CLAIMS])
            claims += by_part[-1]
            part_facts = [
                (about, text)
                for f in out.get("facts") or []
                if isinstance(f, dict)
                and (about := _name(f.get("about")))
                and (text := _text(f.get("text")))
                and not fleeting(text)
            ]
            facts += part_facts[:PART_FACTS]
            part_names = [n for n in out.get("new_names") or [] if isinstance(n, dict) and _name(n.get("name"))]
            for n in part_names[:PART_NAMES]:
                name = _name(n.get("name"))
                new_names.setdefault(norm(name), (name, _kind(n.get("type")), _text(n.get("description"))))
            for sp in out.get("spellings") or []:
                if isinstance(sp, dict) and (heard := _name(sp.get("heard"))) and (means := _name(sp.get("means"))):
                    spellings.append((heard, means))
            job.done += 1
            job.message = f"Read part {job.done} of {len(parts)}"
            self.emit(job)
        moments: list[tuple[str, str]] = []
        seen_moments: set[str] = set()
        for f in pass_b:
            part, here, found = f.result()
            moments += _moments(found.get("moments"), part, here, seen_moments)[:PART_MOMENTS]

        moments = moments[:MAX_MOMENTS]
        summary, scenes, open_, highlights = self._write_note(by_part)
        scenes, moments, fixed = self._verify(scenes, moments, lines)
        if fixed:  # the paragraph was written from the unchecked scenes
            recap = self.llm.json(RECAP_SYSTEM, "\n".join(f"- {s}" for s in scenes), RECAP_SCHEMA, 600)
            if _grounded(_text(recap.get("summary"), 2000), "\n".join(scenes)):
                summary["summary"] = recap["summary"]
        title = _text(summary.get("title"), 60) or "Session"
        date = time.strftime("%Y-%m-%d", time.localtime(s["started_at"]))
        sid = s["id"]
        existing = self._session_note(sid)
        # A re-run keeps the page's name: facts elsewhere link to it.
        note_title = existing.stem if existing else safe_name(f"{date} {title}")

        # Suggestions first, so the session page can link the new names. A "new" name that sounds
        # like a known one is a misspelling, not a new character ("Dallara" is Elara); among new
        # names, later spellings of an earlier one fold into it ("Willy Olly Wally").
        kept: list[str] = []
        for name, kind, description in new_names.values():
            known = self.vault.find(name) or next(
                (e for e in self.vault.entities() if any(looks_like(name, n) for n in e.names())), None
            )
            if known is not None:
                if not self.vault.find(name):
                    spellings.append((name, known.name))
                continue
            twin = next(
                (k for k in kept if looks_like(name, k) or difflib.SequenceMatcher(None, norm(name), norm(k)).ratio() >= 0.85),
                None,
            )
            if twin is not None:
                spellings.append((name, twin))
                continue
            try:
                self.vault.create(name, kind, status="suggested", description=description)
            except ValueError:
                continue
            kept.append(name)
            job.created.append(name)
            job.suggested += 1
        for about, text in facts[:MAX_SUGGESTED_FACTS]:
            e = self.vault.find(about)
            if e is not None and not e.read_only:
                before = len(e.suggested_facts) + len(e.facts)
                e = self.vault.add_fact(e.name, f"{text} ([[{note_title}]])", suggested=True)
                if len(e.suggested_facts) + len(e.facts) > before:
                    job.suggested += 1
                    if e.name not in job.created and e.name not in job.updated:
                        job.updated.append(e.name)
        for heard, means in spellings:
            e = self.vault.find(means)
            # Only words that really occur in this transcript, sound like the name they're said to
            # mean ("Elkari" is El-Khari, not Elara), and aren't already a known name.
            if e is None or e.read_only or norm(heard) not in heard_text or self.vault.find(heard) is not None:
                continue
            if not any(looks_like(heard, n) for n in e.names()):
                continue
            if norm(heard) in {norm(h) for h in (*e.heard_as, *e.heard_as_suggested, *e.heard_as_rejected)}:
                continue
            self.vault.update(e.name, heard_as_suggested=[*e.heard_as_suggested, heard])
            job.suggested += 1

        linked = [link_names(t, self.vault) for t in scenes]
        open_linked = [link_names(t, self.vault) for t in open_]
        highlights = [link_names(h, self.vault) for h in highlights]
        moments_linked = [f"{at} {link_names(t, self.vault)}" for at, t in moments]
        mentioned = sorted(
            {
                e.name
                for e in self.vault.entities()
                if any(f"[[{e.name}]]" in x for x in [*linked, *open_linked, *highlights, *moments_linked])
            }
        )
        tdir = self.vault.root / "Sessions" / "Transcripts"
        tdir.mkdir(parents=True, exist_ok=True)
        (tdir / f"{sid}.md").write_text(transcript.markdown(record), encoding="utf-8")
        page = [
            f"---\ntype: session\nsession_id: {sid}\ndate: {date}\nduration: {transcript.clock(s.get('duration_s', 0))}\ntags: [troubadour/session]\n---",
            f"# {note_title}",
            "",
            link_names(_text(summary.get("summary"), 2000), self.vault),
            "",
            # Highlights are copies of scenes; a session with table moments shows those instead of repeating itself.
            *(
                ["## Table moments", *(f"- {m}" for m in moments_linked), ""]
                if moments_linked
                else ["## Highlights", *(f"- {h}" for h in highlights), ""]
            ),
            "## Still open",
            *(f"- {e}" for e in open_linked),
            "",
            "## What happened",
            *(f"- {e}" for e in linked),
            "",
            "## Mentioned",
            ", ".join(f"[[{n}]]" for n in mentioned) or "(nobody from the glossary)",
            "",
            "## Transcript",
            f"[[Transcripts/{sid}|Full transcript]] · {s.get('lines', len(lines))} lines",
            "",
        ]
        path = existing or self.vault.root / "Sessions" / f"{note_title}.md"
        write_atomic(path, "\n".join(page))
        job.note = str(path.relative_to(self.vault.root))
        job.done = job.total
        job.message = f"Wrote {path.stem}; {job.suggested} suggestions to review"

    def _write_note(self, by_part: list[list[dict]]) -> tuple[dict, list[str], list[str], list[str]]:
        """(note reply, scenes, still open, highlights) from each part's log.

        One note call over a long session's whole log covers its first half and drops the rest (8k-char
        parts, 18 of them: the page stopped at the bone field). So a long session is noted in segments of
        NOTE_SEGMENT_PARTS parts, side by side, and one last call titles and sums up their scenes.
        """
        segments = [sum(by_part[i : i + NOTE_SEGMENT_PARTS], []) for i in range(0, len(by_part), NOTE_SEGMENT_PARTS)]
        if len(segments) > 1 and len(by_part) % NOTE_SEGMENT_PARTS == 1:  # a lone last part joins the one before
            segments[-2:] = [segments[-2] + segments[-1]]

        def note(k: int) -> tuple[dict, list[str], list[str], list[str]]:
            fights: list[tuple[int, str]] = []
            happened, open_ = _settle(segments[k], fights)
            rows = [f"- {e}" for e in happened]
            for at, text in reversed(fights):  # in place: between what led to each fight and what followed
                rows.insert(at, f"- (fight detail) {text}")
            settled = "\n".join(rows) or "- (nothing happened)"
            if open_:
                settled += "\n\nStill open:\n" + "\n".join(f"- {e}" for e in open_)
            if len(segments) > 1:
                ends = "It is the end of the session." if k == len(segments) - 1 else "The session goes on after it."
                settled = f"This log is part {k + 1} of {len(segments)} of the session. {ends} Write 3 to 6 scenes.\n\n{settled}"
            reply = self.llm.json(NOTE_SYSTEM, settled, NOTE_SCHEMA)
            return (reply, *_note(reply, happened, open_, [t for _, t in fights]))

        if len(segments) == 1:
            return note(0)
        with concurrent.futures.ThreadPoolExecutor(max_workers=VERIFY_WORKERS, thread_name_prefix="note") as pool:
            notes = list(pool.map(note, range(len(segments))))
        scenes = [s for _, sc, _, _ in notes for s in sc]
        open_ = list(dict.fromkeys(o for _, _, op, _ in notes for o in op))
        top = self.llm.json(TOP_SYSTEM, "\n".join(f"- {s}" for s in scenes), TOP_SCHEMA, 1500)
        blob = "\n".join(scenes)
        highlights = [h for h in _lines(top.get("highlights"), 6) if _grounded(h, blob) and not _play_by_play(h)]
        summary = _text(top.get("summary"), 2000)
        return {"title": top.get("title"), "summary": summary if _grounded(summary, blob) else ""}, scenes, open_[:8], highlights

    def _verify(
        self, scenes: list[str], moments: list[tuple[str, str]], lines: list[str]
    ) -> tuple[list[str], list[tuple[str, str]], bool]:
        """Check each scene and moment against the transcript lines it came from; apply corrections.

        The note is written from one-line log entries, never the transcript, so a wrong actor or count in
        the log survives to the page. Each check is small and independent, so they run side by side. A
        correction must still be grounded in its lines; "unsupported" keeps the sentence (the window
        may simply be the wrong one), "fixed" replaces it.
        """
        glossary = glossary_brief(self.vault)
        jobs = [("scene", i, s, evidence(s, lines)) for i, s in enumerate(scenes)]
        jobs += [("moment", i, t, around(at, lines)) for i, (at, t) in enumerate(moments)]

        def check(job):
            _, _, sentence, excerpt = job
            if not excerpt:
                return job, {}
            user = f"Glossary:\n{glossary}\n\nTranscript lines:\n{excerpt}\n\nSentence: {sentence}"
            return job, self.llm.json(VERIFY_SYSTEM, user, VERIFY_SCHEMA, 400)

        scenes, moments = list(scenes), list(moments)
        fixed = False
        with concurrent.futures.ThreadPoolExecutor(max_workers=VERIFY_WORKERS, thread_name_prefix="verify") as pool:
            for (kind, i, sentence, excerpt), out in pool.map(check, jobs):
                better = _text(out.get("sentence"), CLAIM_TEXT_MAX)
                if out.get("verdict") != "fixed" or not better or better == sentence:
                    continue
                if not _grounded(better, f"{excerpt}\n{sentence}"):
                    continue
                fixed = True
                if kind == "scene":
                    scenes[i] = better
                else:
                    moments[i] = (moments[i][0], better)
        return scenes, moments, fixed

    def _session_note(self, sid: str) -> Path | None:
        """A session's existing write-up (re-running one replaces it instead of adding another)."""
        for path in (self.vault.root / "Sessions").glob("*.md"):
            try:
                head = path.read_text(encoding="utf-8")[:400]
            except OSError:
                continue
            if f"session_id: {sid}\n" in head:
                return path
        return None

    def written_up(self) -> dict[str, str]:
        """session id → vault-relative path of its write-up."""
        out = {}
        for path in (self.vault.root / "Sessions").glob("*.md"):
            try:
                m = re.search(r"^session_id: (\S+)$", path.read_text(encoding="utf-8")[:400], re.M)
            except OSError:
                continue
            if m:
                out[m.group(1)] = str(path.relative_to(self.vault.root))
        return out


def link_names(text: str, vault: Vault, entities: list[Entity] | None = None) -> str:
    """Turn the first mention of each glossary name (or alias) into an Obsidian [[link]]:
    [[Elara]] when the text spells it that way, [[Elara|Ellie]] for an alias."""
    for e in sorted(entities if entities is not None else vault.entities(), key=lambda e: -len(e.name)):
        if f"[[{e.name}]]" in text or f"[[{e.name}|" in text:
            continue  # already linked once
        hits = []
        for n in e.names():
            # An alias that is an ordinary word ("Dead" for Hank) must not eat that word in a sentence.
            if n.casefold() != e.name.casefold() and everyday(n):
                continue
            if m := re.search(rf"(?<![\[\w|]){re.escape(n)}(?![\w\]|])", text, re.I):
                hits.append(m)
        if not hits:
            continue
        first = min(hits, key=lambda m: (m.start(), -len(m.group(0))))  # earliest; longest name there
        said = first.group(0)
        link = f"[[{e.name}]]" if said == e.name else f"[[{e.name}|{said}]]"
        text = text[: first.start()] + link + text[first.end() :]
    return text


# ------------------------------------------------------------------ spelling suggestions (no LLM)


FILLERS = frozenset(
    [
        "okay",
        "ok",
        "yeah",
        "yep",
        "yup",
        "nope",
        "nah",
        "hmm",
        "hm",
        "mm",
        "mmm",
        "uh",
        "um",
        "huh",
        "oh",
        "ooh",
        "ah",
        "aha",
        "wow",
        "oops",
        "yay",
        "hey",
        "gotcha",
        "alright",
        "mm-hmm",
        "uh-huh",
        "uh-oh",
        "lol",
        "whoa",
        "bye-bye",
    ]
)


@dataclass
class Word:
    spelling: str  # its most common capitalised form
    count: int = 0
    cap_mid: int = 0  # capitalised away from a sentence start
    low_mid: int = 0
    example: str = ""


def ordinary(word: str) -> bool:
    """An everyday word (or a form of one, or a filler): never a name candidate."""
    return word.casefold() in FILLERS or everyday(word)


def scan_words(texts) -> dict[str, Word]:
    """Words of 3+ letters by lowercase key, with how often they're capitalised mid-sentence:
    names are, ordinary words aren't (a sentence start says nothing either way)."""
    out: dict[str, Word] = {}
    caps: dict[str, collections.Counter] = {}
    for text in texts:
        for m in re.finditer(r"[A-Za-z][A-Za-z'-]{2,}", text):
            word = m.group(0).removesuffix("'s").strip("'-")
            if len(word) < 3:
                continue
            key = word.casefold()
            w = out.setdefault(key, Word(spelling=word, example=text[:160]))
            w.count += 1
            before = text[: m.start()].rstrip()
            if before and before[-1] not in '.!?"':
                if word[0].isupper():
                    w.cap_mid += 1
                else:
                    w.low_mid += 1
            if word[0].isupper():
                caps.setdefault(key, collections.Counter())[word] += 1
    for key, c in caps.items():
        out[key].spelling = c.most_common(1)[0][0]
    return out


def name_like(w: Word) -> bool:
    if ordinary(w.spelling):
        return False
    mid = w.cap_mid + w.low_mid
    return mid == 0 or w.cap_mid / mid >= 0.6


def misspelling_hints(text: str, entities: list[Entity]) -> str:
    """ "- Dallara, Dilara → Elara" lines: words in this text that look like a glossary name."""
    words = [w for w in scan_words(text.splitlines()).values() if name_like(w)]
    rows = []
    for e in entities:
        names = {norm(n) for n in e.names()}
        heard = {norm(h) for h in e.heard_as}
        seen = [
            w
            for w in sorted(words, key=lambda w: -w.count)
            if norm(w.spelling) not in names and (norm(w.spelling) in heard or any(looks_like(w.spelling, n) for n in e.names()))
        ]
        if seen:
            rows.append(f"- {', '.join(w.spelling for w in seen[:8])} → {e.name}")
    return "\n".join(rows)


def skeleton(word: str) -> str:
    """A crude sound-alike key: c/k, z/s, ph/f, y/i merged, vowels and doubled letters dropped."""
    w = norm(word).replace(" ", "").replace("ph", "f")
    w = w.translate(str.maketrans("czy", "ksi"))
    w = re.sub(r"(.)\1+", r"\1", w)
    return w[:1] + re.sub(r"[aeiou]", "", w[1:])


def looks_like(heard: str, name: str) -> bool:
    a, b = norm(heard).replace(" ", ""), norm(name).replace(" ", "")
    if a == b or len(a) < 3 or len(b) < 3:
        return False
    if difflib.SequenceMatcher(None, a, b).ratio() >= 0.75:
        return True
    if abs(len(a) - len(b)) > 3 or len(a) < 4:  # "SLR" isn't Elara
        return False
    ka, kb = skeleton(a), skeleton(b)
    # Same sounds ("Cassia"/"Kessia"), or same sounds after a different first letter ("Dilara"/"Elara").
    return (len(kb) >= 2 and ka == kb) or (len(kb) >= 3 and ka[1:] == kb[1:])


def spelling_suggestions(vault: Vault, sessions: Iterable[Path], min_count: int = 2) -> dict:
    """{"misheard": [{entity, heard, count, example}], "unknown": [{heard, count, example}]} from the
    transcripts in the given session folders."""
    texts = []
    for folder in sessions:
        try:
            texts += [m.get("text", "") for m in json.loads((folder / "transcript.json").read_text()).get("messages", [])]
        except (OSError, json.JSONDecodeError, AttributeError):
            continue
    words = [w for w in scan_words(texts).values() if w.count >= min_count and name_like(w)]
    entities = vault.entities()
    known = {norm(n) for e in entities for n in (*e.names(), *e.heard_as)}
    handled = {norm(n) for e in entities for n in (*e.heard_as_suggested, *e.heard_as_rejected)}
    handled |= {norm(w) for w in vault.ignored()}
    misheard, matched = [], set()
    for e in entities:
        if e.read_only:
            continue
        for w in words:
            key = norm(w.spelling)
            if key in known or key in handled or key in matched:
                continue
            if any(looks_like(w.spelling, name) for name in e.names()):
                misheard.append({"entity": e.name, "heard": w.spelling, "count": w.count, "example": w.example})
                matched.add(key)
    vocabulary = {norm(t) for t, _ in dnd_terms.terms()}  # known already: the cleanup spells these
    unknown = [
        {"heard": w.spelling, "count": w.count, "example": w.example}
        for w in sorted(words, key=lambda w: -w.count)
        if w.spelling[0].isupper()
        and not w.spelling.isupper()  # "NPC", "MLM": acronyms, not names
        and norm(w.spelling) not in known | handled | matched | vocabulary
    ][:50]
    misheard.sort(key=lambda s: -s["count"])
    return {"misheard": misheard[:100], "unknown": unknown}
