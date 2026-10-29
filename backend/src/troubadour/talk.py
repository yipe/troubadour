"""How a player talks, from their saved transcripts: a speech profile, and text restyled to sound like them.

Part of the voice clone and under the same consent (`Player.clone_ok`); stored beside the voice
(`data/clones/<player>/profile.json`), so turning the clone off deletes it.

The numbers are counted, not guessed: pace (words per minute of speech), line length, how often
lines are questions or exclamations, how much is in character, the words lines open with, and pet
phrases (word sequences they use far more than everyone else at the table, by log-odds with an
informative Dirichlet prior: Monroe, Colaresi & Quinn 2008, "Fightin' Words"). Whisper drops most
"um"s and "uh"s and filler-only lines aren't saved, so hesitation can't be measured.

The memory LLM (local, or the hosted one the user picked) adds a short description, writes the
voice's preview line, and for "in their words" rewrites text paragraph by paragraph. All untrusted:
a description is plain text with a length cap; a preview line must be about the right length and
use no name they never used; a rewrite must keep every number and every campaign name it was given
and add none, or that paragraph keeps the original wording.
"""

import math
import re
import time
from collections import Counter
from collections.abc import Callable, Iterable

from . import ask
from .transcript import character_voices

MIN_LINES = 30
MIN_WORDS = 300
PAD_S = 0.2  # each saved line carries ~this much VAD padding at both ends (segment.SegmentConfig.pad_ms)
MIN_PACE_S = 1.5  # shorter lines are mostly padding: their pace is noise
MAX_N = 3  # pet phrases are 1-3 words
MIN_PHRASE_COUNT = 3
MIN_PHRASE_LINES = 3
PRIOR = 500.0  # Dirichlet prior strength (alpha_0) for a big table; scaled down for a small one
PHRASE_Z = 2.0  # log-odds z-score a pet phrase must reach (about p < 0.05)
PHRASE_RATIO = 2.0  # and they must use it at least this many times as often as the others
SAME_COUNT = 1.25  # counts this close are the same habit (a phrase and the words inside it)
MAX_SAYING = 8  # words, once overlapping phrases are merged
MAX_PHRASES = 8
OPENER_SHARE = 0.05  # a first word that starts this share of their lines
OPENER_RATIO = 1.3  # ... and this many times the table's share
MAX_OPENERS = 3
EXAMPLE_WORDS = (6, 30)
EXAMPLE_CONFIDENCE = 0.6  # an example line must be confidently theirs
MAX_EXAMPLES = 12
DESCRIPTION_CHARS = 600
LENGTH_RANGE = (0.6, 1.6)  # a rewrite's length against the text's
LENGTH_SLACK = 25  # characters: room for an "Okay so," on a short line
RESTYLE_MIN_WORDS = 4  # headings and one-liners are read as written
TEMPO_RANGE = (0.85, 1.15)  # beyond this, time-stretching starts to sound processed
PREVIEW_S = 20.0  # the voice's sample: long enough to hear how they talk
DEFAULT_WPM = 160
PREVIEW_WORDS = (0.6, 1.5)  # a written sample's word count against the target
RUN_GAP_S = 4.0  # their lines this close, with nobody else between, are one stretch of talk

# Discourse words are how people talk ("okay", "like", "literally"): they may be pet words. Other
# function words ("the", "of") say nothing about style and are never one on their own.
DISCOURSE = frozenset(
    {"oh", "ok", "okay", "like", "just", "know", "yeah", "yes", "so", "well", "right", "actually", "literally"}
    | {"basically", "really", "totally", "wait", "alright", "dude", "guys", "man", "wow", "hey", "huh"}
)
FUNCTION = ask.STOP - DISCOURSE
WORD = re.compile(r"[a-z0-9]+(?:'[a-z]+)?")


def tokens(text: str) -> list[str]:
    return WORD.findall(text.lower())


def ngrams(words: list[str]) -> Iterable[tuple[str, ...]]:
    for n in range(1, MAX_N + 1):
        for i in range(len(words) - n + 1):
            gram = tuple(words[i : i + n])
            if n == 1 and gram[0] in FUNCTION:
                continue
            yield gram


def _line_counts(lines: list[str]) -> tuple[Counter, Counter]:
    """(occurrences, lines containing it) of every n-gram."""
    total, per_line = Counter(), Counter()
    for line in lines:
        grams = list(ngrams(tokens(line)))
        total.update(grams)
        per_line.update(set(grams))
    return total, per_line


def pet_phrases(mine: list[str], others: list[str], limit: int = MAX_PHRASES) -> list[str]:
    """Word sequences this player says distinctly more than the rest of the table."""
    y_i, lines_i = _line_counts(mine)
    y_j, _ = _line_counts(others)
    n_i, n_j = sum(y_i.values()), sum(y_j.values())
    n = n_i + n_j
    if not n_i:
        return []
    # A tenth of the counts, at most PRIOR: smooths rare words without swamping a small table's numbers.
    prior = min(PRIOR, max(10.0, 0.1 * n))
    scored = []
    for gram, a in y_i.items():
        if a < MIN_PHRASE_COUNT or lines_i[gram] < MIN_PHRASE_LINES:
            continue
        b = y_j.get(gram, 0)
        alpha = prior * (a + b) / n
        delta = math.log((a + alpha) / (n_i + prior - a - alpha)) - math.log((b + alpha) / (n_j + prior - b - alpha))
        z = delta / math.sqrt(1 / (a + alpha) + 1 / (b + alpha))
        rate_i, rate_j = a / n_i, (b + 1) / (n_j + 1)
        if z >= PHRASE_Z and rate_i >= PHRASE_RATIO * rate_j:
            scored.append((z, gram, a))
    scored.sort(key=lambda s: (-s[0], -len(s[1]), s[1]))
    picked: list[tuple[tuple[str, ...], int]] = []
    for _, gram, count in scored:
        # "you know what" says it; "you know" alone, used barely more, doesn't add anything.
        if any(_contains(longer, gram) and count <= SAME_COUNT * c for longer, c in picked):
            continue
        picked = [(g, c) for g, c in picked if not (_contains(gram, g) and c <= SAME_COUNT * count)]
        picked.append((gram, count))
    said = [f" {' '.join(tokens(line))} " for line in mine]
    return [" ".join(g) for g, _ in _merge_overlaps(picked, said)][:limit]


def _merge_overlaps(picked: list[tuple[tuple[str, ...], int]], said: list[str]) -> list[tuple[tuple[str, ...], int]]:
    """Overlapping picks said about as often are one longer saying, if they really are said together:
    "you know what" + "know what I" + "what I mean" → "you know what I mean" (n-grams stop at MAX_N
    words; sayings needn't). said: their lines as space-padded tokens."""
    out = list(picked)
    merged = True
    while merged:
        merged = False
        for i, j in ((i, j) for i in range(len(out)) for j in range(len(out)) if i != j):
            (p, pc), (q, qc) = out[i], out[j]
            k = next((k for k in range(min(len(p), len(q)) - 1, 1, -1) if p[-k:] == q[:k]), 0)
            if not k or len(p) + len(q) - k > MAX_SAYING:
                continue
            whole = p + q[k:]
            count = sum(f" {' '.join(whole)} " in line for line in said)
            if count >= MIN_PHRASE_LINES and min(pc, qc) <= SAME_COUNT * count:
                out[i] = (whole, count)
                del out[j]
                merged = True
                break
    return out


def _contains(longer: tuple[str, ...], shorter: tuple[str, ...]) -> bool:
    k = len(shorter)
    return len(longer) > k and any(longer[i : i + k] == shorter for i in range(len(longer) - k + 1))


def openers(mine: list[str], others: list[str]) -> list[str]:
    """First words that start a good share of their lines, more than they start everyone else's."""

    def shares(lines: list[str]) -> Counter:
        firsts = Counter(t[0] for t in map(tokens, lines) if t)
        total = sum(firsts.values()) or 1
        return Counter({w: c / total for w, c in firsts.items()})

    mine_s, other_s = shares(mine), shares(others)
    out = [w for w, s in mine_s.most_common() if s >= OPENER_SHARE and s >= OPENER_RATIO * other_s.get(w, 0.0)]
    return out[:MAX_OPENERS]


def _share(lines: list[dict], test: Callable[[dict], bool]) -> float:
    return round(sum(map(test, lines)) / len(lines), 3)


def profile(records: list[dict], pid: str) -> dict:
    """Counted speech patterns of player `pid` across saved transcript records (transcript.build shape)."""
    mine, others = [], []
    for r in records:
        characters = character_voices(r)
        for m in r["messages"]:
            if m.get("player_id") == pid:
                mine.append(m | {"session": r["session"]["id"], "in_character": m.get("voice_id") in characters})
            elif m.get("player_id") is not None:
                others.append(m)
    words = sum(len(tokens(m["text"])) for m in mine)
    if len(mine) < MIN_LINES or words < MIN_WORDS:
        raise ValueError(
            f"Not enough of their lines yet ({len(mine)} lines, {words} words; "
            f"need {MIN_LINES} and {MIN_WORDS}). Profile them after another session."
        )
    timed = [(len(tokens(m["text"])), m["t_end"] - m["t_start"] - 2 * PAD_S) for m in mine]
    timed = [(w, s) for w, s in timed if s >= MIN_PACE_S and w >= 3]
    speech_s = sum(s for _, s in timed)
    texts, other_texts = [m["text"] for m in mine], [m["text"] for m in others]
    phrases = pet_phrases(texts, other_texts)
    sessions = {m["session"] for m in mine}
    wpm = round(60 * sum(w for w, _ in timed) / speech_s) if speech_s >= 30 else None
    return {
        "player_id": pid,
        "built_at": int(time.time()),
        "sessions": len(sessions),
        "lines": len(mine),
        "words": words,
        "wpm": wpm,
        "words_per_line": round(words / len(mine), 1),
        "questions": _share(mine, lambda m: m["text"].rstrip().endswith("?")),
        "exclamations": _share(mine, lambda m: m["text"].rstrip().endswith("!")),
        "in_character": _share(mine, lambda m: m["in_character"]),
        "phrases": phrases,
        "openers": openers(texts, other_texts),
        "examples": examples(mine, phrases),
        "monologue": monologue(records, pid, round(PREVIEW_S * (wpm or DEFAULT_WPM) / 60)),
        "description": None,
    }


def monologue(records: list[dict], pid: str, max_words: int) -> str:
    """Their longest stretch of talk: consecutive confident lines of theirs in one session, nobody else
    in between, under RUN_GAP_S apart, its whole lines up to max_words. One train of thought reads
    as something they'd say; good lines from different evenings stitched together don't."""
    best, best_words = [], 0
    for r in records:
        run, run_words, last_end = [], 0, None
        for m in sorted(r["messages"], key=lambda m: m["t_start"]):
            if m.get("player_id") != pid or m.get("provisional") or (m.get("confidence") or 0) < EXAMPLE_CONFIDENCE:
                run, run_words, last_end = [], 0, None  # someone else spoke, or it's not surely them
                continue
            if last_end is not None and m["t_start"] - last_end > RUN_GAP_S:
                run, run_words = [], 0
            words = len(tokens(m["text"]))
            if run_words + words <= max_words or not run:
                run, run_words = [*run, m["text"].strip()], run_words + words
            last_end = m["t_end"]
            if run_words > best_words:
                best, best_words = run, run_words
    return " ".join(best)


def examples(mine: list[dict], phrases: list[str]) -> list[str]:
    """Typical lines for the LLM to imitate: mid-length, confidently theirs, with a pet phrase first,
    spread across sessions (round robin) so one evening doesn't set the tone."""
    lo, hi = EXAMPLE_WORDS
    good = [
        m
        for m in mine
        if lo <= len(tokens(m["text"])) <= hi and not m.get("provisional") and (m.get("confidence") or 0) >= EXAMPLE_CONFIDENCE
    ]
    padded = [f" {' '.join(tokens(m['text']))} " for m in good]
    ranked = sorted(range(len(good)), key=lambda i: (not any(f" {p} " in padded[i] for p in phrases), i))
    by_session: dict[str, list[str]] = {}
    for i in ranked:
        by_session.setdefault(good[i].get("session", ""), []).append(good[i]["text"])
    out: list[str] = []
    while len(out) < MAX_EXAMPLES and any(by_session.values()):
        for queue in by_session.values():
            if queue and len(out) < MAX_EXAMPLES:
                out.append(queue.pop(0))
    return out


# ------------------------------------------------------------------ LLM


DESCRIBE_SYSTEM = (
    "You describe how one tabletop role-playing player talks at the table, from counted statistics and "
    "sample lines. Write 2-4 plain sentences about their speaking style only: pace, sentence length, "
    "register, energy, humor, habits, and pet phrases. No judgments of the person, no guesses about who "
    "they are or their life, no markdown, and no quotes longer than six words."
)
RESTYLE_SYSTEM = (
    "Rewrite the text the way this player would say it out loud at the table: their phrasing, sentence "
    "length and register. Use their habits lightly: at most one pet phrase every sentence or two, and "
    "never repeat a sentence. Keep it about as long as the text. Keep every fact: the same events in the "
    "same order, every name and every number exactly as written, each number once. Add no events, "
    "questions, names or numbers. They are the one speaking, so their own name may become I. Plain "
    "spoken text only: no markdown, stage directions or quotation marks around the whole thing."
)
PREVIEW_SYSTEM = (
    "Write something this tabletop role-playing player might say out loud at the table, in one go, as "
    "them: their phrasing, sentence length, register, energy and pet phrases (lightly, never repeated). "
    "Table talk about the game: a plan, a reaction, a question to the GM, a bit of banter. No stage "
    "directions, no real-world personal details, and no names except ones in their sample lines. Plain "
    "spoken text only."
)
TEXT_SCHEMA = {
    "type": "object",
    "properties": {"text": {"type": "string"}},
    "required": ["text"],
    "additionalProperties": False,
}


def _plain(text: str) -> str:
    """An LLM's text as plain spoken words: no markdown marks, one line, no wrapping quotes."""
    return " ".join(re.sub(r"[*_`#>]", "", text).split()).strip('"“”')


def _ask(llm, system: str, user: str, max_tokens: int) -> str:
    """The LLM's {"text"} as plain words ("" for junk). Raises if the LLM can't be reached."""
    text = llm.json(system, user, TEXT_SCHEMA, max_tokens=max_tokens).get("text")
    return _plain(text) if isinstance(text, str) else ""


def _brief(name: str, prof: dict) -> str:
    pace = f"{prof['wpm']} words per minute" if prof.get("wpm") else "unknown pace"
    lines = [
        f"Player: {name}",
        f"Pace: {pace}; {prof['words_per_line']} words per line on average.",
        f"Questions: {prof['questions']:.0%} of lines; exclamations: {prof['exclamations']:.0%}; "
        f"in character: {prof['in_character']:.0%}.",
        f"Pet phrases: {', '.join(prof['phrases']) or 'none stand out'}.",
        f"Often starts lines with: {', '.join(prof['openers']) or 'nothing in particular'}.",
    ]
    if prof.get("description"):
        lines.append(f"Style: {prof['description']}")
    lines.append("Sample lines:")
    lines += [f"- {e}" for e in prof["examples"]]
    return "\n".join(lines)


def describe(llm, name: str, prof: dict) -> str | None:
    """A short plain-text description, or None if the LLM is down or answers junk."""
    try:
        text = _ask(llm, DESCRIBE_SYSTEM, _brief(name, prof), max_tokens=400)
    except Exception:
        return None
    if len(text) < 20:
        return None
    if len(text) > DESCRIPTION_CHARS:  # cut at the last sentence that fits
        cut = text[:DESCRIPTION_CHARS]
        end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
        text = cut[: end + 1] if end > 0 else cut.rstrip() + "…"
    return text


def _found(names: Iterable[str], text: str) -> set[str]:
    low = f" {' '.join(tokens(text))} "
    return {n for n in names if (t := " ".join(tokens(n))) and f" {t} " in low}


def problem(original: str, rewritten: str, names: Iterable[str], own: Iterable[str] = ()) -> str | None:
    """Why a rewrite can't be used, or None: it must keep every number and every known name, add
    neither, and stay about as long. `own` (the speaker's names) may become "I"."""
    if not rewritten.strip():
        return "it was empty"
    lo, hi = LENGTH_RANGE
    if not lo * len(original) - LENGTH_SLACK <= len(rewritten) <= hi * len(original) + LENGTH_SLACK:
        return f"it was {len(rewritten)} characters for a text of {len(original)}; keep it about as long"
    before, after = sorted(re.findall(r"\d+", original)), sorted(re.findall(r"\d+", rewritten))
    if before != after:
        return f"the numbers changed (the text has {', '.join(before) or 'none'}; write each exactly once)"
    names, own = list(names), set(own)
    lost = _found(names, original) - _found(names, rewritten) - own
    added = _found(names, rewritten) - _found(names, original) - own
    if lost or added:
        return f"names changed ({', '.join(sorted(lost | added))}); keep the text's names and add none"
    return None


def restyle(
    llm,
    name: str,
    prof: dict,
    text: str,
    names: Iterable[str],
    own: Iterable[str] = (),
    progress: Callable[[int, int], None] = lambda done, total: None,
) -> tuple[str, int]:
    """(text in their words, paragraphs that kept the original wording). Paragraph by paragraph, so one
    bad rewrite costs one paragraph. A rejected rewrite is asked for again with the reason (the LLM
    runs at temperature 0: the same prompt would give the same answer). Headings and other short
    paragraphs are read as written."""
    names, own = list(names), list(own)
    paragraphs = [p for p in re.split(r"\n\s*\n", text.strip()) if p.strip()]
    brief = _brief(name, prof)
    out, kept, down = [], 0, False
    for i, para in enumerate(paragraphs):
        progress(i, len(paragraphs))
        if len(tokens(para)) < RESTYLE_MIN_WORDS:
            out.append(para)
            continue
        done, prompt = None, f"{brief}\n\nText:\n{para}"
        for _ in range(0 if down else 2):
            try:
                candidate = _ask(llm, RESTYLE_SYSTEM, prompt, max_tokens=1200)
            except Exception:
                down = True  # the LLM is down: the rest is read as written, without waiting on it again
                break
            why = problem(para, candidate, names, own)
            if why is None:
                done = candidate
                break
            prompt += f"\n\nYour last rewrite was not used: {why}. Rewrite the text again."
        kept += done is None
        out.append(done or para)
    progress(len(paragraphs), len(paragraphs))
    return "\n\n".join(out), kept


def _written_sample(llm, system: str, brief: str, target: int, samples: list[str], names, own) -> str:
    """An LLM-written line of about `target` words, or "" if it's offline or wrote junk: a word count
    outside PREVIEW_WORDS, or a known name that's in none of the samples (nor theirs)."""
    try:
        text = _ask(llm, system, f"{brief}\n\nWrite about {target} words.", max_tokens=800)
    except Exception:
        return ""
    names = list(names)
    lo, hi = PREVIEW_WORDS
    allowed = _found(names, " ".join(samples)) | set(own)
    return text if lo * target <= len(tokens(text)) <= hi * target and _found(names, text) <= allowed else ""


def preview_text(
    llm, name: str, prof: dict, names: Iterable[str], own: Iterable[str] = (), seconds: float = PREVIEW_S
) -> tuple[str, str]:
    """(about `seconds` of something they would say, how it was made). "ai": the LLM wrote it from their
    profile; "their lines": the LLM was offline or wrote junk, so it's their longest stretch of talk
    from the transcripts (monologue); "" if there is none."""
    target = round(seconds * (prof.get("wpm") or DEFAULT_WPM) / 60)
    if text := _written_sample(llm, PREVIEW_SYSTEM, _brief(name, prof), target, prof["examples"], names, own):
        return text, "ai"
    passage = prof.get("monologue") or ""
    return passage, "their lines" if passage else ""


CHARACTER_SYSTEM = (
    "Write something this character might say, in character, in a tabletop role-playing game: their "
    "voice, phrasing and manner from the sample lines. Dialogue only: no narration, no stage directions, "
    "no rules talk, no names except ones in the sample lines. Plain spoken text only."
)


def character_text(
    llm, player: str, character: str, lines: list[str], names: Iterable[str], own: Iterable[str] = (), wpm=None
) -> tuple[str, str]:
    """(about PREVIEW_S of something `character` would say, how it was made) for a character voice,
    from the lines they spoke as them: "ai", else their longest such line ("their lines"), else ""."""
    target = round(PREVIEW_S * (wpm or DEFAULT_WPM) / 60)
    samples = sorted(lines, key=lambda line: -len(tokens(line)))[:MAX_EXAMPLES]
    brief = f"Character: {character} (played by {player})\nSample lines:\n" + "\n".join(f"- {s}" for s in samples)
    if text := _written_sample(llm, CHARACTER_SYSTEM, brief, target, samples, names, own):
        return text, "ai"
    return (samples[0], "their lines") if samples else ("", "")


def tempo(player_wpm: float | None, clone_wpm: float | None) -> float:
    """Time-stretch factor that brings the clone to the player's pace (1.0 when either is unknown)."""
    if not player_wpm or not clone_wpm:
        return 1.0
    lo, hi = TEMPO_RANGE
    return round(min(max(player_wpm / clone_wpm, lo), hi), 3)


# ------------------------------------------------------------------ in character, or table talk

CLASSIFY_BATCH = 25  # lines per LLM call
CONTEXT_CHARS = 200  # of each line of context; the line itself gets twice that
CLASSIFY_SYSTEM = (
    "You sort one tabletop role-playing player's lines into in-character speech and table talk. In "
    "character: words spoken as their character, in the story, to other characters or NPCs (dialogue, "
    "a battle cry, a threat, a prayer). Table talk: everything else said as themselves: rules and dice, "
    "plans and questions to the GM, describing what their character does ('I attack', 'she runs'), "
    "jokes and chat between players. Each line comes with the lines just before it for context. Label "
    "every numbered line."
)
CLASSIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "labels": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"n": {"type": "integer"}, "label": {"type": "string", "enum": ["character", "table"]}},
                "required": ["n", "label"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["labels"],
    "additionalProperties": False,
}


def classify_lines(
    llm,
    name: str,
    character: str,
    lines: list[dict],
    progress: Callable[[int, int], None] = lambda done, total: None,
) -> list[bool | None]:
    """For each of their lines ({"text", "context": [(speaker, text), ...]} with the lines just before):
    True when it's spoken in character, False for table talk, None when the LLM didn't say (or is
    down). Untrusted: a label counts only for a line number that exists, with a known label."""
    out: list[bool | None] = [None] * len(lines)
    who = f"{name}, who plays {character}" if character else name
    for start in range(0, len(lines), CLASSIFY_BATCH):
        progress(start, len(lines))
        batch = lines[start : start + CLASSIFY_BATCH]
        parts = [f"The player: {who}."]
        for n, line in enumerate(batch, 1):
            context = "".join(f"  {s}: {t[:CONTEXT_CHARS]}\n" for s, t in line.get("context", []))
            parts.append(f"Line {n}:\n{context}  > {name}: {line['text'][: 2 * CONTEXT_CHARS]}")
        try:
            reply = llm.json(CLASSIFY_SYSTEM, "\n\n".join(parts), CLASSIFY_SCHEMA, max_tokens=60 * len(batch) + 200)
        except Exception:
            break  # the LLM is down: the rest stay unknown
        labels = reply.get("labels")
        for item in labels if isinstance(labels, list) else []:
            n = item.get("n") if isinstance(item, dict) else None
            if isinstance(n, int) and 1 <= n <= len(batch) and item.get("label") in ("character", "table"):
                out[start + n - 1] = item["label"] == "character"
    progress(len(lines), len(lines))
    return out
