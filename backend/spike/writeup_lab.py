"""Write-up lab: run a write-up variant over gold sessions, score it, keep a ledger.

  uv run python spike/writeup_lab.py LAB VARIANT [SID ...]     # all sessions in LAB/lab.json if none given

LAB/lab.json: {"sessions": {"<sid>": {"session": "<dir with transcript.json>", "vault": "<campaign dir>",
"gold": "<gold page>", "exemplar": "<another campaign's gold page>"}}} (paths relative to LAB). Everything is
read from copies; each run works on a scratch copy of the vault. Output: LAB/runs/<variant>/<sid>/page.md,
calls.json, score.json, and a line in LAB/LEDGER.md.

Variants: "prod" is the app's own write-up (Memory._write_up). The rest are the notes -> page pipeline below,
configured in VARIANTS.
"""

from __future__ import annotations

import concurrent.futures
import json
import shutil
import sys
import tempfile
import time
from pathlib import Path

import writeup_score
from lab_llm import LabLLM

from troubadour import memory as m
from troubadour import transcript
from troubadour.campaign import Vault

# ------------------------------------------------------------------ the notes -> page pipeline

PART_CHARS = 12000  # ~15 min of table talk per stretch (read_parts)


def _seconds(clock: str) -> float:
    parts = [int(p) for p in clock.split(":")]
    return float(sum(p * 60**i for i, p in enumerate(reversed(parts))))


BEAT = m._obj({"at": m.STR, "text": m.STR})
NAMED = m._obj({"name": m.STR, "what": m.STR})
NOTES_SCHEMA = m._obj(
    {
        "beats": {"type": "array", "items": BEAT},
        "characters": {"type": "array", "items": NAMED},
        "people": {"type": "array", "items": NAMED},
        "places": {"type": "array", "items": NAMED},
        "loot": m.STRS,
        "open": m.STRS,
        "ending": m.STR,
    }
)

TABLE_RULES = """The transcript is speech-to-text: it mishears words and names; the glossary has the right spellings.
Lines are labelled with who spoke. The GM narrates and speaks for every NPC and monster. Players joke, plan,
speculate and talk about real life: only what actually happens in the game counts (usually what the GM narrates
or confirms). A joke is not an event. A plan is not an event until they do it."""

READ_SYSTEM = f"""You are the party's note-taker for a Dungeons & Dragons session. You get its whole transcript.
{TABLE_RULES}
Write careful notes, from the first scene to the last:
beats: {{beats}} entries in order, covering the whole session evenly to its very end. Each: at = the timestamp of
the transcript line where it starts, copied exactly; text = one or two specific sentences: who did what, to whom,
why if someone said why, and what came of it. Name the NPCs, places and items. Keep numbers that matter (money,
damage that dropped someone, how many). A fight gets one or two beats: who fought whom, the turning points, how
it ended, who was knocked out, swallowed, cursed or killed. Reveals, decisions, deals, gifts and loot are beats.
characters: each player character: name, and what they did that mattered.
people: each NPC, creature or group met or named in play: name as the glossary spells it, and what = who they
are and what they did.
places: each place visited or named: name, and what happened there.
loot: what was found, given, bought, sold or spent, with amounts and who has it.
open: threads still unresolved at the end. Not plans, not guesses, not things already done.
ending: where and how the session ended.
Be accurate before being complete: when you are not sure who did something or a number, leave that detail out.
Answer with JSON only."""

PART_SYSTEM = f"""You are the party's note-taker for a Dungeons & Dragons session. You get one stretch of its
transcript, the notes so far, and the cast.
{TABLE_RULES}
Write notes for THIS stretch only (the notes so far are already written; do not repeat them):
beats: 3 to 8 entries in order. Each: at = the timestamp of the transcript line where it starts, copied exactly;
text = one or two specific sentences: who did what, to whom, why if someone said why, and what came of it. Name
the NPCs, places and items. Keep numbers that matter. A fight gets one or two beats: who fought whom, turning
points, how it ended, who was knocked out, swallowed, cursed or killed. Reveals, decisions, deals, gifts and loot
are beats. A stretch with nothing but table talk gets no beats.
characters: player characters who did something that mattered here, and what.
people: NPCs, creatures or groups met or named in play here: name as the glossary spells it, and who they are.
places: places visited or named here, and what happened there.
loot: what was found, given, bought, sold or spent here, with amounts and who has it.
open: threads this stretch leaves unresolved.
ending: if this is the end of the session, where and how it ended; else "".
Be accurate before being complete: when you are not sure who did something or a number, leave it out.
Answer with JSON only."""

# Extra reading rules (v3): what the v2 pages got wrong.
READ_RULES_V3 = """
More rules:
- Rolls, saving throws, damage numbers, spell slots and hit points are not beats. Mention a number only when it
  decided something (someone dropped to 0, a huge hit, a natural 20 that turned a scene) or it is money or loot.
- Who did what is the most important thing to get right: copy who acted and who it happened to from the
  transcript. If two characters could be meant, name neither.
- Use names, not he/she, unless the transcript makes it clear.
- Do not say how something was done (on a wall, with a spell, in a language) unless the transcript says so."""

READ_RULES_V4 = """
- A name a player jokes about or guesses is not a name until the GM uses it.
- Players' guesses about what something is ("it's probably a mimic") are not facts."""

READ_RULES_V5 = """
- Write only what a speaker says or does. Do not add a cause, reason, motive or next step ("apparently",
  "so that", "because" only when a speaker says it). No inferences about what something meant.
- ending: the last thing that happened, as the transcript stops (mid-scene is fine). Do not add a rest, a
  departure or a plan that the transcript doesn't show.
- A count said before an event is not the count after it: give a number only when the GM states it after the
  event; otherwise say "some".
- Name a group only as the GM names it in that scene ("your newly allied tribe" stays "the allied tribe")."""

# v3 without its first rule (rolls and numbers are not beats): v5b keeps the rolls the GM acted on instead.
READ_RULES_V3_DENSE = "\n" + READ_RULES_V3.split("\n- Who did what", 1)[1].join(["- Who did what", ""])

READ_RULES_V5B = """
- Keep a roll result the GM acted on: a check that revealed something, a persuasion that worked, damage that
  dropped someone, a natural 20 that mattered.
- No stretch of play longer than 8 minutes without a beat."""

WEIGHT_RULE = """
- weight: 3 = a session that misses it is wrong (a turn of the story, a fight's outcome, someone downed,
  swallowed, cursed or killed, a key NPC, big loot, a deal, the ending); 2 = worth telling; 1 = a detail.
- kind: decision, fight, reveal, loot, deal, outcome, travel, character or other."""

GAP_SCHEMA = m._obj({"beats": {"type": "array", "items": BEAT}})

GAP_SYSTEM = f"""You check a note-taker's beats for a Dungeons & Dragons session against its whole transcript.
{TABLE_RULES}
Find what the beats missed that a player would want in the recap: events that changed the story, reveals,
decisions, deals, loot and money, who was knocked out, swallowed, cursed or badly hurt, how each fight ended,
NPCs met and what they said that mattered, and how the session ended. Skip rolls and rules talk.
beats: 0 to 12 NEW entries (never repeat or reword a beat already there), each at = the timestamp of the
transcript line where it starts, copied exactly; text = one or two specific sentences.
Be accurate before being complete: leave out a detail you are not sure of. Answer with JSON only."""

CRITIC_SCHEMA = m._obj(
    {"fixes": {"type": "array", "items": m._obj({"n": {"type": "integer"}, "problem": m.STR, "corrected": m.STR})}}
)

CRITIC_SYSTEM = f"""You proofread a note-taker's numbered beats for a Dungeons & Dragons session against its whole
transcript. {TABLE_RULES}
Find beats that are clearly wrong: the wrong person did it or it happened to someone else, a wrong outcome, a
wrong number, things in the wrong order inside the beat, a joke, guess or plan written as if it happened, or a
player's joke name used as an NPC's real name.
fixes: one entry per wrong beat: n = its number; problem = what is wrong, briefly; corrected = the beat rewritten
with only that part fixed (keep every other detail and name). Leave right beats out. Do not fix wording,
spelling or missing detail. If nothing is clearly wrong, return no fixes. Answer with JSON only."""

VERIFY_SCHEMA = m._obj(
    {
        "checks": {"type": "array", "items": m._obj({"question": m.STR, "answer": m.STR, "agrees": {"type": "boolean"}})},
        "verdict": {"type": "string", "enum": ["ok", "fixed", "unsupported"]},
        "note": m.STR,
    }
)

VERIFY_SYSTEM = """You check one note about a Dungeons & Dragons session against the transcript lines it came from
(speech-to-text: words and names can be misheard; the glossary has the right spellings; the GM narrates and
speaks for every NPC and monster; players joke and plan, and only what happens in the game counts).
checks: turn each claim in the note into a short question (who did it, who it happened to, what, how many, how
it ended, where) and answer it from the lines alone, without looking at the note again; agrees = whether the
answer matches the note.
verdict: "ok" if every check agrees. "fixed" if any check disagrees or a claim is not in the lines: note = the
note rewritten with each wrong part corrected from the lines and each part the lines don't show removed; keep
everything the lines do show, and keep it about as long. "unsupported" if the lines show none of it.
Answer with JSON only."""

PAGE_SCHEMA = m._obj(
    {
        "title": m.STR,
        "last_time": m.STR,
        "spotlight": {"type": "array", "items": NAMED},
        "highlights": {"type": "array", "items": BEAT},
    }
)

WRITE_SYSTEM = """You write the session page a Dungeons & Dragons group reads before their next game, from their
note-taker's notes. You do not have the transcript: everything you write must come from the notes.
title: 2 to 5 words about the session's main event, no date.
last_time: the wrap-up, {paragraphs} paragraphs, {words} words, past tense: a story a player enjoys reading. Where
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


def notes_text(notes: dict) -> str:
    out = ["Beats:", *(f"- [{b.get('at', '')}] {b.get('text', '')}" for b in notes.get("beats", []))]
    for key, label in (("characters", "Player characters"), ("people", "People and creatures"), ("places", "Places")):
        out += ["", f"{label}:", *(f"- {x.get('name', '')}: {x.get('what', '')}" for x in notes.get(key, []))]
    out += ["", "Loot and deals:", *(f"- {x}" for x in notes.get("loot", []))]
    out += ["", "Still open:", *(f"- {x}" for x in notes.get("open", []))]
    out += ["", f"Ending: {notes.get('ending', '')}"]
    if notes.get("must"):
        out += [
            "",
            "Must be in the wrap-up (the session's key beats):",
            *(f"- [{b.get('at', '')}] {b.get('text', '')}" for b in notes["must"]),
        ]
    return "\n".join(out)


def example_from(gold_path: Path) -> str:
    sec = writeup_score.sections(gold_path.read_text(encoding="utf-8"))
    return "\n\n".join(f"## {h}\n{sec[h]}" for h in ("Last time", "Spotlight", "Highlights") if sec.get(h))


def _merge_named(into: list[dict], more: list[dict]) -> None:
    seen = {m.norm(x.get("name", "")): x for x in into}
    for x in more:
        key = m.norm(x.get("name", ""))
        if not key:
            continue
        if key in seen:
            if x.get("what") and x["what"] not in seen[key].get("what", ""):
                seen[key]["what"] = f"{seen[key].get('what', '')} {x['what']}".strip()
        else:
            seen[key] = dict(x)
            into.append(seen[key])


def _rules(system: str, cfg: dict) -> str:
    extra = {
        "v3": READ_RULES_V3,
        "v4": READ_RULES_V3 + READ_RULES_V4,
        "v5": READ_RULES_V3 + READ_RULES_V4 + READ_RULES_V5,
        "v5b": READ_RULES_V3_DENSE + READ_RULES_V4 + READ_RULES_V5 + READ_RULES_V5B,
    }.get(cfg.get("rules", ""), "")
    if cfg.get("beat_weights"):
        extra += WEIGHT_RULE
    return system.replace("\nAnswer with JSON only.", extra + "\nAnswer with JSON only.") if extra else system


def _read_system(cfg: dict) -> str:
    return _rules(READ_SYSTEM.replace("{beats}", cfg.get("beats", "20 to 35")), cfg)


def _at(b: dict) -> float:
    try:
        return _seconds(str(b.get("at", "")).strip("[] "))
    except ValueError:
        return float("inf")


def fill_gaps(llm, notes: dict, lines: list[str], cast: str, glossary: str, cfg: dict) -> dict:
    """One more reading of the whole transcript for what the beats missed; new beats go in by time."""
    have = "\n".join(f"- [{b.get('at', '')}] {b.get('text', '')}" for b in notes.get("beats") or [])
    user = f"Who is at the table:\n{cast}\n\nGlossary:\n{glossary}\n\nBeats so far:\n{have}\n\nTranscript:\n" + "\n".join(lines)
    out = llm.json(_rules(GAP_SYSTEM, cfg), user, GAP_SCHEMA, 3000)
    new = [{**b, "gap": True} for b in out.get("beats") or [] if isinstance(b, dict) and m._text(b.get("text"))]
    return {**notes, "beats": sorted([*(notes.get("beats") or []), *new], key=_at)}


WEIGHTED_BEAT = m._obj({"at": m.STR, "text": m.STR, "weight": {"type": "integer"}, "kind": m.STR})
WEIGHTED_NOTES_SCHEMA = {
    **NOTES_SCHEMA,
    "properties": {**NOTES_SCHEMA["properties"], "beats": {"type": "array", "items": WEIGHTED_BEAT}},
}


def read_whole(llm, lines: list[str], cast: str, glossary: str, cfg: dict) -> dict:
    if cfg.get("cast_extra"):
        cast += "\n" + cfg["cast_extra"]
    user = f"Who is at the table:\n{cast}\n\nGlossary:\n{glossary}\n\nTranscript:\n" + "\n".join(lines)
    schema = WEIGHTED_NOTES_SCHEMA if cfg.get("beat_weights") else NOTES_SCHEMA
    system = _read_system(cfg)
    if cfg.get("beat_weights"):
        system = system.replace("text = one or two specific sentences", "text = one or two specific sentences; weight and kind")
    return llm.json(system, user, schema, cfg.get("read_tokens", 9000))


def critic(llm, notes: dict, lines: list[str], cast: str, glossary: str, cfg: dict) -> dict:
    """One proofreading pass over all beats with the whole transcript in view (not a few minutes of it: a narrow
    window loses the names the transcript mishears and the context of who is who)."""
    beats = [dict(b) for b in notes.get("beats") or []]
    listed = "\n".join(f"{i + 1}. [{b.get('at', '')}] {b.get('text', '')}" for i, b in enumerate(beats))
    user = f"Who is at the table:\n{cast}\n\nGlossary:\n{glossary}\n\nBeats:\n{listed}\n\nTranscript:\n" + "\n".join(lines)
    out = llm.json(_rules(CRITIC_SYSTEM, cfg), user, CRITIC_SCHEMA, 4000)
    for f in out.get("fixes") or []:
        n, fixed = f.get("n"), m._text(f.get("corrected"))
        if isinstance(n, int) and 1 <= n <= len(beats) and fixed:
            beats[n - 1] = {**beats[n - 1], "text": fixed, "was": beats[n - 1].get("text"), "problem": f.get("problem", "")}
    return {**notes, "beats": beats}


def window(at: str, lines: list[str], before: float = 60, after: float = 300, limit: int = 12000) -> str:
    """The transcript from a minute before a beat's timestamp to five minutes after (a beat starts at `at`)."""
    try:
        t = _seconds(at.strip("[] "))
    except ValueError:
        return ""
    near = []
    for line in lines:
        try:
            if -before <= _seconds(line.split(" ", 1)[0]) - t <= after:
                near.append(line)
        except ValueError:
            continue
    return "\n".join(near)[:limit]


def verify_beats(llm, notes: dict, lines: list[str], glossary: str) -> dict:
    """Each beat checked against its own minutes of transcript; wrong parts fixed, unshown parts cut."""
    beats = notes.get("beats") or []

    def check(b: dict) -> dict:
        excerpt = window(b.get("at", ""), lines)
        if not excerpt:
            return b
        user = f"Glossary:\n{glossary}\n\nTranscript lines:\n{excerpt}\n\nNote: {b.get('text', '')}"
        out = llm.json(VERIFY_SYSTEM, user, VERIFY_SCHEMA, 2500)
        if out.get("verdict") == "fixed" and m._text(out.get("note")):
            return {**b, "text": m._text(out["note"]), "was": b.get("text")}
        if out.get("verdict") == "unsupported":
            return {**b, "dropped": True}
        return b

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        checked = list(pool.map(check, beats))
    return {**notes, "beats": [b for b in checked if not b.get("dropped")], "dropped": [b for b in checked if b.get("dropped")]}


def read_parts(llm, lines: list[str], cast: str, glossary: str, cfg: dict) -> dict:
    parts = m.chunks("\n".join(lines).replace("\n", "\n\n"), cfg.get("chunk", PART_CHARS))
    notes: dict = {"beats": [], "characters": [], "people": [], "places": [], "loot": [], "open": [], "ending": ""}
    for i, part in enumerate(parts):
        so_far = "\n".join(f"- [{b.get('at', '')}] {b.get('text', '')}" for b in notes["beats"][-cfg.get("so_far", 20) :])
        end = "\nThis stretch is the END of the session.\n" if i == len(parts) - 1 else ""
        user = f"Who is at the table:\n{cast}\n\nGlossary:\n{glossary}\n\nNotes so far:\n{so_far or '(none yet)'}\n{end}\nTranscript stretch {i + 1} of {len(parts)}:\n{part}"
        out = llm.json(_rules(PART_SYSTEM, cfg), user, NOTES_SCHEMA, cfg.get("part_tokens", 2500))
        notes["beats"] += [b for b in out.get("beats") or [] if isinstance(b, dict) and b.get("text")]
        for key in ("characters", "people", "places"):
            _merge_named(notes[key], [x for x in out.get(key) or [] if isinstance(x, dict)])
        notes["loot"] += [x for x in out.get("loot") or [] if isinstance(x, str)]
        notes["open"] = [x for x in out.get("open") or [] if isinstance(x, str)] if i == len(parts) - 1 else notes["open"]
        if out.get("ending"):
            notes["ending"] = out["ending"]
    return notes


PARA_SCHEMA = m._obj({"paragraph": m.STR})

PARA_SYSTEM = """You write one paragraph of the "Last time" wrap-up a Dungeons & Dragons group reads before their next
game, from their note-taker's notes. You do not have the transcript: everything must come from the notes.
paragraph: {words} words, past tense, a story a player enjoys reading, about ONLY the beats marked >> (this part of
the session), in order. Name the player characters and NPCs. Fit in as many of those beats' specific facts as you
can: who did what, names, places, numbers that mattered, deals. No rules talk (rolls, DCs, hit points) unless a roll
changed the story. Add nothing the notes do not say: no guessed motives, causes or next steps.
{position}
Answer with JSON only."""

PARA_POSITION = [
    "This is the first paragraph: open with where the party started and what they set out to do.",
    "This is the middle paragraph: continue from the previous paragraph without repeating it.",
    "This is the last paragraph: continue from the previous paragraph, end with where and how the session ended "
    "(the notes' Ending, nothing after it) and what the party carries forward (loot, deals, threats, open questions).",
]


def last_time_by_thirds(llm, notes: dict, cfg: dict, example: str) -> str:
    beats = sorted(notes.get("beats") or [], key=_at)
    n = len(beats)
    cuts = [0, round(n / 3), round(2 * n / 3), n]
    paragraphs: list[str] = []
    for k in range(3):
        mine = {id(b) for b in beats[cuts[k] : cuts[k + 1]]}
        key = cfg.get("must_include")
        marked = "\n".join(
            f"{'>> ' if id(b) in mine else '   '}{'(key) ' if key and b.get('weight') == 3 else ''}[{b.get('at', '')}] {b.get('text', '')}"
            for b in beats
        )
        rest = notes_text({**notes, "beats": []})
        before = f"The previous paragraph:\n{paragraphs[-1]}\n\n" if paragraphs else ""
        intro = EXAMPLE_INTRO + example + "\n\n---\n\n" if example and k == 0 else ""
        user = f"{intro}{before}Beats (write about the >> ones only):\n{marked}\n\nOther notes:\n{rest}"
        system = PARA_SYSTEM.replace("{words}", cfg.get("para_words", "130 to 180")).replace("{position}", PARA_POSITION[k])
        if key:
            system = system.replace(
                "\nAnswer with JSON only.", "\nEvery >> beat marked (key) must be in the paragraph.\nAnswer with JSON only."
            )
        out = llm.json(system, user, PARA_SCHEMA, 1500)
        if m._text(out.get("paragraph"), 3000):
            paragraphs.append(m._text(out["paragraph"], 3000))
    return "\n\n".join(paragraphs)


def write_page(llm, notes: dict, cfg: dict, example: str) -> dict:
    if cfg.get("must_include"):  # importance-tagged beats: every weight-3 beat goes in the wrap-up
        must = [b for b in notes.get("beats") or [] if b.get("weight") == 3]
        if must:
            notes = {**notes, "must": must}
    system = WRITE_SYSTEM.replace("{paragraphs}", cfg.get("paragraphs", "2 or 3")).replace(
        "{words}", cfg.get("words", "250 to 400")
    )
    if notes.get("must"):
        system = system.replace(
            "\nspotlight:", '\nEvery beat listed under "Must be in the wrap-up" must be in last_time, in order.\nspotlight:'
        )
    user = (
        (EXAMPLE_INTRO + example + "\n\n---\n\n" if example else "")
        + "The note-taker's notes for this session:\n"
        + notes_text(notes)
    )
    return llm.json(system, user, PAGE_SCHEMA, cfg.get("write_tokens", 4000))


def render(sid: str, record: dict, notes: dict, page: dict) -> str:
    s = record["session"]
    date = time.strftime("%Y-%m-%d", time.localtime(s["started_at"]))
    out = [
        f"---\nsession_id: {sid}\ndate: {date}\nduration: {transcript.clock(s.get('duration_s', 0))}\n---",
        f"# {page.get('title') or 'Session'}",
        "",
        "## Last time",
        page.get("last_time", ""),
        "",
        "## Spotlight",
        *(f"- **{x.get('name', '')}:** {x.get('what', '')}" for x in page.get("spotlight") or []),
        "",
        "## Highlights",
        *(f"- [{x.get('at', '')}] {x.get('text', '')}" for x in page.get("highlights") or []),
        "",
        "## What happened",
        *(f"- [{b.get('at', '')}] {b.get('text', '')}" for b in notes.get("beats") or []),
        "",
        "## People and creatures met",
        *(f"- **{x.get('name', '')}:** {x.get('what', '')}" for x in notes.get("people") or []),
        "",
        "## Places",
        *(f"- **{x.get('name', '')}:** {x.get('what', '')}" for x in notes.get("places") or []),
        "",
        "## Loot, money and deals",
        *(f"- {x}" for x in notes.get("loot") or []),
        "",
        "## Still open",
        *(f"- {x}" for x in notes.get("open") or []),
        "",
    ]
    return "\n".join(out)


def run_notes(llm, sid: str, session_dir: Path, vault_dir: Path, example: str, cfg: dict) -> tuple[str, dict]:
    record = json.loads((session_dir / "transcript.json").read_text())
    vault = Vault(vault_dir)
    lines, cast = m.transcript_lines(record)
    lines = m.apply_heard_as(lines, vault.entities())
    glossary = m.glossary_brief(vault)
    reader = read_parts if cfg.get("read") == "parts" else read_whole
    notes = reader(llm, lines, cast, glossary, cfg)
    if cfg.get("gaps"):
        notes = fill_gaps(llm, notes, lines, cast, glossary, cfg)
    if cfg.get("critic"):
        notes = critic(llm, notes, lines, cast, glossary, cfg)
    if cfg.get("verify"):
        notes = verify_beats(llm, notes, lines, glossary)
    writer = llm
    if cfg.get("think_read_only"):  # a thinking writer wrote short wrap-ups; think while reading only
        writer = LabLLM(url=llm.url, model=llm.model, thinking=False)
        writer.calls = llm.calls
    if cfg.get("sort_beats"):
        notes = {**notes, "beats": sorted(notes.get("beats") or [], key=_at)}
    page = write_page(writer, notes, cfg, example)
    if cfg.get("last_mode") == "thirds":
        page = {**page, "last_time": last_time_by_thirds(writer, notes, cfg, example) or page.get("last_time", "")}
    return render(sid, record, notes, page), {"notes": notes, "page": page}


_SYNTH = {
    "read": "whole",
    "rules": "v4",
    "thinking": True,
    "think_read_only": True,
    "words": "350 to 550",
    "example": "synthetic",
}

VARIANTS: dict[str, dict] = {
    "prod": {},
    "app": {},
    "v2-whole": {"read": "whole"},
    "v2-parts": {"read": "parts"},
    "v2-whole-rep": {"read": "whole"},  # a second run of v2-whole: how much a score moves on its own
    "v2-whole-noex": {"read": "whole", "example": False},
    "v2-whole-think": {"read": "whole", "thinking": True},
    "v3-whole": {"read": "whole", "rules": "v3"},
    "v3-whole-verify": {"read": "whole", "rules": "v3", "verify": True},
    "v3-think-verify": {"read": "whole", "rules": "v3", "verify": True, "thinking": True},
    "v3-parts-verify": {"read": "parts", "rules": "v3", "verify": True},
    "v4-gaps-verify": {"read": "whole", "rules": "v4", "gaps": True, "verify": True},
    "v4-more-verify": {"read": "whole", "rules": "v4", "beats": "30 to 45", "verify": True},
    "v4-gaps-verify-long": {"read": "whole", "rules": "v4", "gaps": True, "verify": True, "words": "350 to 500"},
    "v4-whole": {"read": "whole", "rules": "v4"},
    "v4-gaps": {"read": "whole", "rules": "v4", "gaps": True},
    "v4-more": {"read": "whole", "rules": "v4", "beats": "30 to 45"},
    "v4-think": {"read": "whole", "rules": "v4", "thinking": True, "words": "350 to 550"},
    "v4-thinkread": {"read": "whole", "rules": "v4", "thinking": True, "think_read_only": True, "words": "350 to 550"},
    "v4-thinkread-synth": {
        "read": "whole",
        "rules": "v4",
        "thinking": True,
        "think_read_only": True,
        "words": "350 to 550",
        "example": "synthetic",
    },
    "v2-thinkread": {"read": "whole", "thinking": True, "think_read_only": True},
    "v4-critic": {"read": "whole", "rules": "v4", "critic": True},
    # Fable's plan (FABLE_PLAN.md), all from v4-thinkread-synth:
    "v5-thirds": {**_SYNTH, "last_mode": "thirds", "sort_beats": True},
    "v5-noinfer": {**_SYNTH, "last_mode": "thirds", "sort_beats": True, "rules": "v5"},
    "v5-weights": {
        **_SYNTH,
        "last_mode": "thirds",
        "sort_beats": True,
        "rules": "v5",
        "beat_weights": True,
        "must_include": True,
    },
    "v5-dense": {**_SYNTH, "last_mode": "thirds", "sort_beats": True, "rules": "v5b"},
    "v5-voice": {**_SYNTH, "last_mode": "thirds", "sort_beats": True, "rules": "v5", "cast_extra": True},
    "v5-critic": {**_SYNTH, "last_mode": "thirds", "sort_beats": True, "rules": "v5", "critic": True},
    "v4-think-critic": {"read": "whole", "rules": "v4", "thinking": True, "critic": True, "words": "350 to 550"},
    "v4-think-gaps": {"read": "whole", "rules": "v4", "thinking": True, "gaps": True, "words": "350 to 550"},
}


def run_app(llm, sid: str, session_dir: Path, vault_dir: Path) -> tuple[str, dict]:
    """The app's writeup module (read, then write), rendered like the other variants."""
    import dataclasses

    from troubadour import writeup

    record = json.loads((session_dir / "transcript.json").read_text())
    vault = Vault(vault_dir)
    lines, cast = m.transcript_lines(record)
    lines = m.apply_heard_as(lines, vault.entities())
    notes = writeup.read(llm, lines, cast, m.glossary_brief(vault))
    page = writeup.write(llm, notes, {line.split(" ", 1)[0] for line in lines})
    n, pg = dataclasses.asdict(notes), dataclasses.asdict(page)
    return render(sid, record, n, pg), {"notes": n, "page": pg}


# ------------------------------------------------------------------ the app's own write-up


class _Bus:
    def emit(self, *_):
        pass


def run_prod(llm, sid: str, session_dir: Path, vault_dir: Path) -> tuple[str, dict]:
    work = Path(tempfile.mkdtemp(prefix="wulab-"))
    try:
        shutil.copytree(vault_dir, work / "campaign")
        (work / "sessions").mkdir()
        shutil.copytree(session_dir, work / "sessions" / sid)
        mem = m.Memory(Vault(work / "campaign"), _Bus(), llm=llm, sessions_dir=lambda: work / "sessions")
        job = mem.write_up(sid)
        while job.state in ("queued", "running"):
            time.sleep(1)
        note = mem._session_note(sid)
        page = note.read_text() if note else f"FAILED: {job.message}"
        return page, {"state": job.state, "message": job.message, "created": job.created, "updated": job.updated}
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ------------------------------------------------------------------ the lab


def run(lab: Path, variant: str, sids: list[str], thinking: bool = False, rescore: bool = False) -> None:
    spec = json.loads((lab / "lab.json").read_text())
    sids = sids or list(spec["sessions"])
    judge = LabLLM()
    rows = []

    def one(sid: str) -> dict:
        s = spec["sessions"][sid]
        llm = LabLLM(thinking=thinking or VARIANTS[variant].get("thinking", False))
        out = lab / "runs" / variant / sid
        out.mkdir(parents=True, exist_ok=True)
        t = time.monotonic()
        if variant == "prod":
            page, extra = run_prod(llm, sid, lab / s["session"], lab / s["vault"])
        elif variant == "app":
            page, extra = run_app(llm, sid, lab / s["session"], lab / s["vault"])
        else:
            kind = VARIANTS[variant].get("example", True)
            if kind == "synthetic":  # the made-up example the app would ship (no campaign content)
                example = (Path(m.__file__).parent / "writeup_example.md").read_text()
            else:
                example = example_from(lab / s["exemplar"]) if kind and s.get("exemplar") else ""
            cfg = dict(VARIANTS[variant])
            if cfg.get("cast_extra"):
                cfg["cast_extra"] = s.get("cast_extra", "")  # campaign-specific, from lab.json
            page, extra = run_notes(llm, sid, lab / s["session"], lab / s["vault"], example, cfg)
        seconds = time.monotonic() - t
        (out / "page.md").write_text(page)
        (out / "extra.json").write_text(json.dumps(extra, indent=1, ensure_ascii=False))
        (out / "calls.json").write_text(json.dumps(llm.calls, indent=1, ensure_ascii=False))
        result = writeup_score.score(lab / s["gold"], out / "page.md", judge, writeup_score.vault_spellings(lab / s["vault"]))
        result["seconds"] = round(seconds)
        result["out_tokens"] = sum((c.get("usage") or {}).get("completion_tokens", 0) for c in llm.calls)
        (out / "score.json").write_text(json.dumps(result, indent=1, ensure_ascii=False))
        brief = {k: v for k, v in result.items() if not isinstance(v, list)}
        print(sid, json.dumps(brief), flush=True)
        return {"sid": sid, **brief}

    def rescored(sid: str) -> dict:
        s = spec["sessions"][sid]
        out = lab / "runs" / variant / sid
        old = json.loads((out / "score.json").read_text())
        result = writeup_score.score(lab / s["gold"], out / "page.md", judge, writeup_score.vault_spellings(lab / s["vault"]))
        result["seconds"], result["out_tokens"] = old.get("seconds", 0), old.get("out_tokens", 0)
        (out / "score.json").write_text(json.dumps(result, indent=1, ensure_ascii=False))
        brief = {k: v for k, v in result.items() if not isinstance(v, list)}
        print(sid, json.dumps(brief), flush=True)
        return {"sid": sid, **brief}

    # Two sessions at a time: the server batches up to four requests.
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(rescored if rescore else one, sids))
    keys = ("score", "recall_story", "recall_last", "recall_page", "errors", "errors_distinct", "names", "last_words", "seconds")
    mean = {k: round(sum(r[k] for r in rows) / len(rows), 3) for k in keys}
    (lab / "runs" / variant / "summary.json").write_text(json.dumps({"rows": rows, "mean": mean}, indent=1))
    line = (
        f"| {time.strftime('%m-%d %H:%M')} | {variant}{' +think' if thinking else ''} | "
        + " | ".join(str(mean[k]) for k in keys)
        + " | "
        + ", ".join(f"{r['sid'][:10]} {r['score']}" for r in rows)
        + " |\n"
    )
    ledger = lab / "LEDGER.md"
    if not ledger.exists():
        ledger.write_text("| when | variant | " + " | ".join(keys) + " | per session |\n|" + "---|" * (len(keys) + 3) + "\n")
    with ledger.open("a") as f:
        f.write(line)
    print(line, end="")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    run(Path(args[0]), args[1], args[2:], thinking="--think" in sys.argv, rescore="--rescore" in sys.argv)
