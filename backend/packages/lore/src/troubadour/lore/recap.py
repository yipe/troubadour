"""A session recap to share with the players: one model call over the session page and its reviewed facts.

The model sees the write-up's title and wrap-up, the facts the GM confirmed from this session (never a
suggestion nobody has reviewed), up to 30 numbered quote candidates and the players who were there. Its answer
is untrusted: the quote is a number we look up (so it can only be a line somebody said), moments only name
present players, and every length is capped before anything is stored in `sessions/<id>/recap.json`.
"""

from __future__ import annotations

import json
import re
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Literal, Protocol

from troubadour.core.fsutil import write_atomic
from troubadour.core.transcript import clock

from .campaign import Vault
from .facts import LABELS, Fact
from .pages import session_page
from .writeup import TABLE_RULES

if TYPE_CHECKING:
    from .memory import Job, Memory

Voice = Literal["narrator", "chronicle", "bullets"]


class JsonLLM(Protocol):
    def json(
        self,
        system: str,
        user: str,
        schema: dict,
        max_tokens: int = ...,
        think: bool = ...,
        progress: Callable[[dict], None] | None = ...,
    ) -> dict: ...


WORDS_PER_SECOND = 2.6  # read aloud
TITLE_MAX, MOMENT_MAX, QUESTION_MAX = 80, 70, 100
QUESTIONS_MAX, FACTS_MAX, FACT_CHARS = 3, 60, 300
CANDIDATES_MAX, QUOTE_WORDS = 30, (6, 25)
BULLETS = (3, 6)
RECAP_TOKENS = 2500

SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "body": {"type": "string"},
        "quote": {"type": "integer"},
        "moments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"player_id": {"type": "string"}, "text": {"type": "string"}},
                "required": ["player_id", "text"],
                "additionalProperties": False,
            },
        },
        "questions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["title", "body", "quote", "moments", "questions"],
    "additionalProperties": False,
}

VOICES: dict[str, str] = {
    "narrator": "Tell it as a storyteller opening the next session, in the second person plural ('you'): "
    "what the party did and where they left off. Start with 'Previously...' only if it reads naturally.",
    "chronicle": "Write it as an in-world chronicle: past tense, third person, as a scribe of this world would "
    "set it down. Name the characters, not the players.",
    "bullets": f"Write {BULLETS[0]} to {BULLETS[1]} short bullet lines, one per line, each one a thing that "
    "happened or was learned. No other text in the body.",
}


@dataclass
class Include:
    happened: bool = True
    quote: bool = True
    moments: bool = True
    questions: bool = True


@dataclass
class Options:
    voice: Voice = "narrator"
    length_s: int = 45
    include: Include = field(default_factory=Include)

    def to_json(self) -> dict:
        t = self.include
        return {
            "voice": self.voice,
            "length_s": self.length_s,
            "include": {"happened": t.happened, "quote": t.quote, "moments": t.moments, "questions": t.questions},
        }


def max_words(length_s: int) -> int:
    return int(length_s * WORDS_PER_SECOND)


def system_prompt(options: Options) -> str:
    inc = options.include
    parts = [
        "You write the recap a Dungeons & Dragons group shares before their next session, from their session "
        "page and the facts the GM confirmed. Use only the facts and the page; add nothing else, no guessed "
        "motives and no invented details.",
        TABLE_RULES,
        "Facts marked 'Party theory' are guesses: word them as theories ('Velis is sure the diamond is...'), never "
        "as things that are true. 'Heard once' facts are unconfirmed: say so or leave them out.",
        f"title: at most {TITLE_MAX} characters, no date.",
        f"body: at most {max_words(options.length_s)} words (about {options.length_s} seconds read aloud). "
        + VOICES[options.voice],
    ]
    if not inc.happened:
        parts.append("Do not retell the events. The body is only a short hook: the mood and what is at stake next.")
    parts.append(
        "quote: the number of one quote candidate that is the best line of the night." if inc.quote else "quote: always -1."
    )
    parts.append(
        f"moments: one per present player at most, {{player_id, text}}: a thing that player did or said, at most "
        f"{MOMENT_MAX} characters. Use only the player ids given."
        if inc.moments
        else "moments: always an empty list."
    )
    parts.append(
        f"questions: at most {QUESTIONS_MAX} open questions for next time, each at most {QUESTION_MAX} characters."
        if inc.questions
        else "questions: always an empty list."
    )
    parts.append("Answer with JSON only. quote is -1 when no candidate fits.")
    return "\n".join(parts)


# ------------------------------------------------------------------ inputs


def session_facts(vault: Vault, sid: str) -> list[Fact]:
    """The confirmed facts whose source is this session, in the order they were said. Suggested facts are
    never read: the recap is built from what the GM reviewed."""
    ids_for = vault.index().ids_for
    out = []
    for fact in [f for e in vault.entities() for f in e.facts] + vault.campaign_facts():
        src = fact.source
        if src and (src.session_id or ids_for.get(src.session_page)) == sid:
            out.append(fact)
    out.sort(key=lambda f: f.source.t if f.source and f.source.t is not None else float("inf"))
    return out[:FACTS_MAX]


def present_players(record: dict) -> list[dict]:
    """The player characters at the table: not the GM, and only those marked present when that was recorded."""
    present = set(record["session"].get("present_player_ids") or [])
    return [p for p in record.get("players") or [] if not p.get("is_gm") and (not present or p["id"] in present)]


def quote_candidates(record: dict, players: list[dict]) -> list[dict]:
    """Player lines of 6-25 words, evenly spread across the session (at most 30)."""
    ids = {p["id"] for p in players}
    lo, hi = QUOTE_WORDS
    lines = [m for m in record["messages"] if m.get("player_id") in ids and lo <= len(str(m.get("text", "")).split()) <= hi]
    if len(lines) > CANDIDATES_MAX:
        lines = [lines[i * len(lines) // CANDIDATES_MAX] for i in range(CANDIDATES_MAX)]
    return lines


def _fact_line(fact: Fact) -> str:
    about = f"{fact.about}: " if fact.about else ""
    return f"- [{LABELS[fact.confidence]}] {about}{fact.text[:FACT_CHARS]}"


def user_prompt(
    page: Mapping[str, str | None], facts: list[Fact], players: list[dict], candidates: list[dict], options: Options
) -> str:
    inc = options.include
    out = [f"Session page title: {page.get('title') or '(none)'}", f"Wrap-up: {page.get('summary') or '(none)'}", ""]
    out += ["Confirmed facts from this session:", *(_fact_line(f) for f in facts), ""]
    if inc.moments:
        out.append("Players present (player_id: character, played by player):")
        for p in players:
            out.append(f"- {p['id']}: {p.get('character') or p['name']}, played by {p['name']}")
        out.append("")
    if inc.quote:
        out.append("Quote candidates:")
        for i, m in enumerate(candidates, start=1):
            out.append(f'{i}. {_who(m)} ({clock(m["t_start"])}): "{m["text"]}"')
    return "\n".join(out).strip()


def _who(m: dict) -> str:
    return str(m.get("character") or m["speaker"])


# ------------------------------------------------------------------ validation


def _short(text, limit: int) -> str:
    """A string cut to `limit` characters at a word boundary."""
    s = " ".join(str(text).split()) if isinstance(text, str) else ""
    if len(s) <= limit:
        return s
    cut = s[:limit]
    return (cut.rsplit(" ", 1)[0] if " " in cut else cut).rstrip(" ,;:-")


def cut_words(text: str, cap: int) -> str:
    """At most `cap` words, ending at a sentence boundary when there is one in what is kept."""
    ends = [m.end() for m in re.finditer(r"\S+", text)]
    if len(ends) <= cap:
        return text.strip()
    kept = text[: ends[cap - 1]]
    sentence = re.match(r"(.*[.!?][\"')\]]*)(?:\s|$)", kept, re.S)
    return (sentence.group(1) if sentence else kept).strip()


def clean_body(raw, voice: Voice, cap: int) -> str:
    text = str(raw).strip() if isinstance(raw, str) else ""
    if voice != "bullets":
        return cut_words(text, cap)
    lines = [re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", line).strip() for line in text.splitlines()]
    lines = [line for line in lines if line][: BULLETS[1]]
    kept, used = [], 0
    for line in lines:
        n = len(line.split())
        if used + n > cap:
            if not kept:
                kept.append(cut_words(line, cap))
            break
        kept.append(line)
        used += n
    return "\n".join(f"- {line}" for line in kept)


def validate(out: dict, options: Options, page_title: str | None, players: list[dict], candidates: list[dict]) -> dict:
    """The model's answer as the recap we store. Raises ValueError when there is no usable body."""
    inc = options.include
    body = clean_body(out.get("body"), options.voice, max_words(options.length_s))
    if not body:
        raise ValueError("The language model's recap came back empty; nothing was saved.")
    title = _short(out.get("title"), TITLE_MAX) or page_title or "Session recap"

    quote = None
    pick = out.get("quote")
    if inc.quote and isinstance(pick, int) and not isinstance(pick, bool) and 1 <= pick <= len(candidates):
        m = candidates[pick - 1]
        quote = {"text": m["text"], "speaker": _who(m), "player_id": m["player_id"], "t": m["t_start"]}

    moments, seen = [], set()
    ids = {p["id"] for p in players}
    raw_moments, raw_questions = out.get("moments"), out.get("questions")
    for item in raw_moments if inc.moments and isinstance(raw_moments, list) else []:
        pid = item.get("player_id") if isinstance(item, dict) else None
        text = _short(item.get("text"), MOMENT_MAX) if isinstance(item, dict) else ""
        if isinstance(pid, str) and pid in ids and pid not in seen and text:
            seen.add(pid)
            moments.append({"player_id": pid, "text": text})

    questions = []
    for q in raw_questions if inc.questions and isinstance(raw_questions, list) else []:
        if text := _short(q, QUESTION_MAX):
            questions.append(text)
    return {"title": title, "body": body, "quote": quote, "moments": moments, "questions": questions[:QUESTIONS_MAX]}


# ------------------------------------------------------------------ the job


def recap_path(sessions_dir: Path, sid: str) -> Path:
    return sessions_dir / sid / "recap.json"


def read(sessions_dir: Path, sid: str) -> dict | None:
    """The stored recap, or None when there is none (or it can't be read)."""
    try:
        data = json.loads(recap_path(sessions_dir, sid).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def build(llm: JsonLLM, vault: Vault, page_path: str | None, record: dict, options: Options, job: Job | None = None) -> dict:
    """The recap for one session record (not yet stored)."""
    sid = record["session"]["id"]
    page: Mapping[str, str | None] = session_page(vault.root, page_path) if page_path else {"title": None, "summary": None}
    facts = session_facts(vault, sid)
    if not facts and not page["summary"]:
        raise ValueError("Nothing reviewed to build a recap from: write up the session and review its facts first.")
    players = present_players(record)
    candidates = quote_candidates(record, players) if options.include.quote else []
    out = llm.json(
        system_prompt(options),
        user_prompt(page, facts, players, candidates, options),
        SCHEMA,
        max_tokens=RECAP_TOKENS,
        progress=job.model_progress if job else None,
    )
    return validate(out, options, page["title"], players, candidates)


_submit = threading.Lock()  # the running-check and the submit are one step


def start(memory: Memory, sessions_dir: Path, sid: str, options: Options) -> Job:
    """Queue a recap job for a saved session. KeyError: no such session. RuntimeError: one is already queued
    or running for it."""
    path = sessions_dir / sid / "transcript.json"
    if not path.is_file():
        raise KeyError(sid)
    record = json.loads(path.read_text(encoding="utf-8"))

    def work(job: Job) -> None:
        job.plan("Write the recap")
        job.step(0, "Writing the recap…")
        built = build(memory.llm, memory.vault, memory.written_up().get(sid), record, options, job)
        stored = {**built, "options": options.to_json(), "built_at": time.time()}
        write_atomic(recap_path(sessions_dir, sid), json.dumps(stored, ensure_ascii=False, indent=1))
        job.step(1, "Recap saved")

    with _submit:
        if any(j["kind"] == "recap" and j["title"] == sid and j["state"] in ("queued", "running") for j in memory.list_jobs()):
            raise RuntimeError(f"A recap of {sid} is already being written.")
        return memory.submit("recap", sid, work)
