"""Campaign memory jobs: the local LLM reads pasted notes and played sessions into the vault.

- import_notes: pasted session notes → Notes/<title>.md (verbatim) + entities and facts.
  The notes are the user's own, so what they name is added as confirmed.
- write_up: a saved session's transcript → Sessions/<date> <title>.md (writeup.py: the whole session
  read into notes, then the page written from the notes), plus *suggested* entities, facts and heard-as
  spellings for review in the Campaign tab. The transcript is copied to Sessions/Transcripts/.
- spelling_suggestions: no LLM; transcript words that look like misspellings of a glossary
  name ("Dilara" for Elara), and frequent unknown names worth adding.

Jobs run one at a time on a worker thread and report progress as `campaign.job` events;
every change to the vault is followed by `campaign.updated`. Model output is untrusted:
names, types and lengths are validated before anything is written.
"""

import collections
import difflib
import hashlib
import json
import logging
import queue
import re
import threading
import time
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from troubadour.core import config, providers, transcript

from . import dnd_terms, writeup
from .campaign import TYPES, Entity, Vault, add_unique, everyday, norm, safe_name, trash_copy, write_atomic
from .facts import Fact, Source

log = logging.getLogger("troubadour")

CHUNK_CHARS = 6000  # notes per extraction call; small enough for a fast, careful answer
RESOLVED_WORDS = 4  # an open item sharing this many content words with a scene is already told
LLM_RETRIES, LLM_RETRY_WAIT_S = 2, 5.0  # a server error or dropped connection is tried again
SNIPPETS_KEPT = 30  # the model's latest finds a running job keeps (sent with every update)
LIVE_EVERY_S = 0.5  # a streaming call's progress reaches the UI at most this often
CHARS_PER_TOKEN = 4  # streamed text -> estimated tokens (servers send several tokens per chunk)
REASONING_HEADROOM = 12000  # extra max_tokens for a thinking model's reasoning
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
MAX_ITEMS = 40
NAME_MAX, TEXT_MAX = 80, 300


# ------------------------------------------------------------------ LLM


class MemoryLLM:
    """Chat with a JSON schema. `wire` picks the API: "chat" is OpenAI-compatible chat completions (LM Studio,
    which supports structured output; OpenRouter; DeepSeek), "anthropic" the Messages API, and "responses" the
    ChatGPT plan's Responses API, authorized by `token` (the sign-in's current access token; see providers.py)."""

    def __init__(
        self,
        url: str = config.LLM_URL,
        model: str = config.MEMORY_LLM_MODEL,
        timeout: float = 600,
        api_key: str = "",
        wire: str = "chat",
        token: Callable[..., str] | None = None,
    ):
        self.url = url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.wire = wire
        self.token = token
        self.client = httpx.Client(timeout=timeout)

    def _headers(self) -> dict:
        secret = self.token() if self.wire == "responses" and self.token else self.api_key
        return providers.headers(self.wire, secret)

    def problem(self) -> str | None:
        """Why this model can't be used right now (server down, model not offered), or None. A quick check
        before a long job, so it fails at the start with a reason instead of minutes in."""
        try:
            r = self.client.get(f"{self.url}{providers.models_path(self.wire)}", headers=self._headers(), timeout=10)
        except providers.NotConnected as e:
            return str(e)
        except httpx.HTTPError:
            return f"Couldn't reach the model server at {self.url}. Is it running? (Models picks the server.)"
        if r.status_code != 200:
            return f"The model server at {self.url} answered {r.status_code}."
        try:
            offered = providers.model_ids(self.wire, r.json())
        except ValueError:
            return f"The model server at {self.url} sent a model list Troubadour can't read."
        if self.model not in offered:
            some = ", ".join(offered[:5]) or "none"
            return f"The model server at {self.url} doesn't offer {self.model} (it offers: {some}). Pick one in Models."
        return None

    def healthy(self) -> bool:
        """The server answers and has this model."""
        try:
            r = self.client.get(f"{self.url}{providers.models_path(self.wire)}", headers=self._headers(), timeout=10)
            return r.status_code == 200 and self.model in providers.model_ids(self.wire, r.json())
        except Exception:  # down, signed out, wrong service on the port, non-JSON reply: all mean "not usable"
            return False

    def json(
        self,
        system: str,
        user: str,
        schema: dict,
        max_tokens: int = 4000,
        think: bool = False,
        progress: Callable[[dict], None] | None = None,
    ) -> dict:
        """One reply as a dict ({} when it isn't JSON). `think`: let a local model reason first (it is on anyway
        when MEMORY_REASONING says so); hosted models decide for themselves. `progress`: the reply is streamed
        and this hears how far it is (Job.model_progress); chat servers only."""
        if self.wire == "anthropic":
            content, cut = self._anthropic(system, user, schema, max_tokens)
        elif self.wire == "responses":
            content, cut = self._responses(system, user, schema)
        else:
            content, cut = self._chat(system, user, schema, max_tokens, think, progress)
        if cut:
            log.warning("model reply cut off at %s tokens; that part of the job is lost", max_tokens)
        match = re.search(r"\{.*\}", content, re.S)
        try:
            out = json.loads(match.group(0)) if match else {}
        except json.JSONDecodeError:
            log.warning("model reply was not JSON (%d chars); that part of the job is lost", len(content))
            out = {}
        return out if isinstance(out, dict) else {}

    def _chat(
        self, system: str, user: str, schema: dict, max_tokens: int, think: bool = False, progress=None
    ) -> tuple[str, bool]:
        effort = config.MEMORY_REASONING
        if think and effort in ("", "none"):
            effort = "medium"
        thinking = effort not in ("", "none")
        payload = {
            "model": self.model,
            "temperature": 0,
            # Thinking tokens count against max_tokens; without room the JSON is cut off and parses to {}.
            "max_tokens": max_tokens + (REASONING_HEADROOM if thinking else 0),
            "reasoning_effort": effort,
            # Qwen on MTPLX (and other chat-template servers) thinks unless told here; reasoning_effort alone
            # doesn't stop it.
            "chat_template_kwargs": {"enable_thinking": thinking},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "response_format": {"type": "json_schema", "json_schema": {"name": "out", "strict": True, "schema": schema}},
        }
        if progress is not None and (streamed := self._chat_stream(payload, progress)) is not None:
            return streamed
        r = self._post("/chat/completions", payload)
        # A server that rejects chat_template_kwargs; then OpenRouter, DeepSeek and some local servers that
        # reject reasoning_effort or strict json_schema.
        if r.status_code == 400:
            payload.pop("chat_template_kwargs")
            r = self._post("/chat/completions", payload)
        if r.status_code == 400:
            payload.pop("reasoning_effort", None)
            payload.pop("response_format", None)
            r = self._post("/chat/completions", payload)
        _raise_for(r)
        choice = r.json()["choices"][0]
        return choice["message"]["content"] or "", choice.get("finish_reason") == "length"

    def _chat_stream(self, payload: dict, progress: Callable[[dict], None]) -> tuple[str, bool] | None:
        """The same request streamed, telling `progress` how far it is: "reading" until the first token (the
        prompt is being read: a whole session takes minutes), then "thinking" or "writing" with an estimate of
        the tokens so far and their rate. None if the server won't stream it (the caller asks again plainly)."""
        started, first = time.time(), None
        thought = written = 0
        text: list[str] = []
        finish = None
        progress({"phase": "reading", "tokens": 0, "tok_s": 0, "started": started})
        body = {**payload, "stream": True, "stream_options": {"include_usage": True}}
        try:
            with self.client.stream("POST", f"{self.url}/chat/completions", headers=self._headers(), json=body) as r:
                if r.status_code != 200:
                    return None
                for line in r.iter_lines():
                    data = line[5:].strip() if line.startswith("data:") else ""
                    if not data or data == "[DONE]":
                        continue
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    for choice in chunk.get("choices") or []:
                        delta = choice.get("delta") or {}
                        reasoning = delta.get("reasoning_content") or delta.get("reasoning") or ""
                        said = delta.get("content") or ""
                        if (reasoning or said) and first is None:
                            first = time.time()
                        thought += len(reasoning)
                        written += len(said)
                        text.append(said)
                        finish = choice.get("finish_reason") or finish
                    if first is not None:
                        tokens = round((thought + written) / CHARS_PER_TOKEN)
                        rate = tokens / max(time.time() - first, 1e-3)
                        phase = "writing" if written else "thinking"
                        info = {"phase": phase, "tokens": tokens, "tok_s": round(rate, 1), "started": started}
                        progress({**info, "text": "".join(text)})
        except (httpx.ConnectError, httpx.RemoteProtocolError, httpx.ReadError):
            return None
        return "".join(text), finish == "length"

    def _anthropic(self, system: str, user: str, schema: dict, max_tokens: int) -> tuple[str, bool]:
        # Current Claude models think by default, and thinking counts against max_tokens.
        payload = providers.anthropic_payload(self.model, system, user, schema, max_tokens + REASONING_HEADROOM)
        r = self._post("/messages", payload)
        if r.status_code == 400:  # a schema structured outputs can't take: the prompts still ask for JSON
            payload.pop("output_config")
            r = self._post("/messages", payload)
        _raise_for(r)
        return providers.anthropic_text(r.json())

    def _post(self, path: str, payload: dict) -> httpx.Response:
        """One request, tried again on a server error, a rate limit or a dropped connection: a write-up is a few
        dozen calls over 20 minutes (four at once), and one LM Studio hiccup (a 500, seen in practice) or a hosted
        provider's 429 used to sink it all."""
        for attempt in range(LLM_RETRIES + 1):
            try:
                r = self.client.post(f"{self.url}{path}", headers=self._headers(), json=payload)
            except (httpx.ConnectError, httpx.RemoteProtocolError) as e:  # not a timeout: that would just wait again
                if attempt == LLM_RETRIES:
                    raise RuntimeError(
                        f"Couldn't reach the model server at {self.url}. Is it running? (Models picks the server.)"
                    ) from e
            else:
                if not _try_again(r) or attempt == LLM_RETRIES:
                    return r
                log.warning("model server error %s; trying again", r.status_code)
            time.sleep(LLM_RETRY_WAIT_S)
        raise AssertionError("unreachable")

    def _responses(self, system: str, user: str, schema: dict) -> tuple[str, bool]:
        """One streamed ChatGPT plan request. Tried again like _post, after one token refresh on a 401, and
        once without the JSON schema if the plan route won't take it."""
        if self.token is None:
            raise providers.NotConnected("Sign in with ChatGPT in Models first.")
        payload = providers.responses_payload(self.model, system, user, schema)
        rejected = None
        for attempt in range(LLM_RETRIES + 1):
            token = self.token(rejected)
            try:
                with self.client.stream(
                    "POST", f"{self.url}/responses", headers=providers.headers("responses", token), json=payload
                ) as r:
                    if r.status_code == 200:
                        return providers.read_stream(r.iter_lines())
                    r.read()
            except (httpx.ConnectError, httpx.RemoteProtocolError):
                if attempt == LLM_RETRIES:
                    raise
                time.sleep(LLM_RETRY_WAIT_S)
                continue
            if r.status_code == 401 and rejected is None:
                rejected = token
            elif r.status_code == 400 and "text" in payload and "subscription_sharing_unsupported_capability" in r.text:
                payload.pop("text")
            elif not _try_again(r) or attempt == LLM_RETRIES:
                raise providers.ProviderError(providers.http_error(r))
            else:
                log.warning("ChatGPT error %s; trying again", r.status_code)
                time.sleep(LLM_RETRY_WAIT_S)
        raise providers.ProviderError(providers.http_error(r))


def _try_again(r: httpx.Response) -> bool:
    """A server error or a rate limit, but not a used-up ChatGPT plan: waiting seconds won't bring that back."""
    if r.status_code == 429:
        return "subscription_sharing_usage_limit_exceeded" not in r.text
    return r.status_code >= 500


def _raise_for(r: httpx.Response) -> None:
    if r.is_error:
        raise RuntimeError(f"The model server couldn't answer ({r.status_code}): {_server_error(r)}")


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


_NOT_OPEN = re.compile(r"\b(plans to|wants to|is going to|hopes to|might|maybe|possibly|could be)\b", re.I)
_CONTENT = re.compile(r"[A-Za-z][A-Za-z'-]{3,}")
_STOP = frozenset(
    {
        *("that", "this", "with", "from", "they", "them", "their", "there", "then", "than", "were", "been"),
        *("have", "into", "over", "after", "before", "about", "session", "party", "still", "just", "only"),
        *("when", "what", "your", "onto", "also", "back"),
    }
)


def _words(text: str) -> set[str]:
    return {w.casefold() for w in _CONTENT.findall(text) if w.casefold() not in _STOP}


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
    unidentified voices are labelled so "Theo as Pip" can't be read as Pip being a thing in the
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


def apply_heard_as(lines: list[str], entities: list[Entity]) -> list[str]:
    """Lines with each confirmed heard-as spelling replaced by its name ("Thayrin" → "Phaerimm").

    The user confirmed these; a saved transcript predates some of them, and a hint alone left the model
    writing the misheard word. Whole words only, after the speaker label.
    """
    swaps = {norm(h): e.name for e in entities for h in e.heard_as if len(norm(h)) >= 3}
    if not swaps:
        return lines
    rx = re.compile(r"(?<![\w'])(" + "|".join(re.escape(h) for h in sorted(swaps, key=len, reverse=True)) + r")(?![\w'])", re.I)

    def fix(line: str) -> str:
        label, sep, text = line.partition(": ")
        return label + sep + rx.sub(lambda m: swaps.get(norm(m.group(0)), m.group(0)), text) if sep else line

    return [fix(line) for line in lines]


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
    kind: str  # "import" | "writeup" | "facts" | "improve" | "spelling" | "retranscribe" | "backup" | "restore" | "clone" | "say" | "read" | "profile" | "incharacter"
    title: str
    state: str = "queued"  # queued | running | done | error
    done: int = 0
    total: int = 0
    message: str = ""
    created: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)  # notes left alone because Troubadour can't read them safely
    suggested: int = 0
    note: str | None = None  # vault-relative path of the note it wrote (a read-aloud job: the note it reads)
    player_id: str | None = None  # voice-clone jobs: whose voice
    # A job with stages: [{"label", "state": "pending" | "running" | "done"}] (plan(), step()).
    steps: list[dict] = field(default_factory=list)
    # The model call in flight (model_progress): {"phase": "reading" | "thinking" | "writing", "tokens" (estimated),
    # "tok_s", "started" (epoch seconds)}; None between calls.
    live: dict | None = None
    # Things found so far, shown while it runs: {"kind": "stat" | "beat" | "person" | "place" | "loot" |
    # "character", "at", "text"}; stats first (code, at the start), then what the model has written.
    snippets: list[dict] = field(default_factory=list)
    # Called after every update(): Memory.submit points it at the campaign.job event. Not sent.
    on_change: Callable[[], None] = field(default=lambda: None, repr=False, compare=False)
    _live_sent: float = field(default=0.0, repr=False, compare=False)

    def to_json(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if k not in ("on_change", "_live_sent")}

    def stats(self, lines: list[str]) -> None:
        """Code-counted facts about the session, shown before the model has found anything."""
        self.update(snippets=[{"kind": "stat", "at": "", "text": t} for t in lines] + self.snippets)

    def plan(self, *labels: str) -> None:
        """The job's stages, all pending; done/total count them."""
        self.update(steps=[{"label": label, "state": "pending"} for label in labels], done=0, total=len(labels))

    def step(self, index: int, message: str = "") -> None:
        """Stage `index` is running (earlier ones done); past the last one, all are done."""
        for i, s in enumerate(self.steps):
            s["state"] = "done" if i < index else "running" if i == index else "pending"
        label = self.steps[index]["label"] if index < len(self.steps) else ""
        self.update(done=index, live=None, message=message or label)

    def model_progress(self, info: dict) -> None:
        """A streaming model call's progress; sent at most twice a second (and at each change of phase)."""
        now = time.monotonic()
        found = info.get("snippets") or []
        info = {k: v for k, v in info.items() if k not in ("text", "snippets")}
        phase_changed = (self.live or {}).get("phase") != info.get("phase")
        self.live = info
        known = {(s["kind"], s["text"]) for s in self.snippets}
        new = [s for s in found if (s["kind"], s["text"]) not in known]
        if new:
            stats = [s for s in self.snippets if s["kind"] == "stat"]
            self.snippets = stats + [s for s in self.snippets if s["kind"] != "stat"][-SNIPPETS_KEPT:]
            self.snippets += new[-SNIPPETS_KEPT:]
            phase_changed = True
        if phase_changed or now - self._live_sent >= LIVE_EVERY_S:
            self._live_sent = now
            self.on_change()

    def update(self, **fields) -> None:
        """Set any of done, total, message (...) and tell the UI."""
        for key, value in fields.items():
            setattr(self, key, value)
        self.on_change()

    def advance(self) -> None:
        self.update(done=self.done + 1)


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

    def submit(self, kind: str, title: str, work, player_id: str | None = None, note: str | None = None) -> Job:
        """Queue work(job) on the job thread (one job at a time); progress goes out as campaign.job."""
        job = Job(id=uuid.uuid4().hex[:8], kind=kind, title=title, player_id=player_id, note=note)
        job.on_change = lambda: self.emit(job)
        with self._lock:
            self.jobs[job.id] = job
            for old in list(self.jobs.values())[:-20]:  # oldest first: dicts keep insertion order, ids are random
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

    def import_sessions(self, campaign: str, title: str, rows: list[dict]) -> Job:
        """Notes pasted with session headings: each row (`date` YYYY-MM-DD, `title`, `text`, `n`) becomes a
        notes-only session on the Timeline, then the same notes pass reads it, crediting its facts to its own
        page. A row whose text is already a notes session of this campaign is skipped, so pasting twice adds
        nothing. ValueError when no row has text."""
        rows = [r for r in rows if r["text"].strip()]
        if not rows:
            raise ValueError("Those sessions have no notes in them.")
        title = safe_name(title or time.strftime("Notes %Y-%m-%d"))
        return self.submit("import", title, lambda job: self._import_sessions(job, campaign, rows))

    def _notes_fingerprints(self, campaign: str) -> set[str]:
        out = set()
        for path in self.sessions_dir().glob("*/meta.json"):
            try:
                meta = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(meta, dict) and meta.get("kind") == "notes" and meta.get("campaign") == campaign:
                out.add(str(meta.get("fingerprint")))
        return out

    def _new_notes_folder(self, day: str) -> Path:
        """A fresh `sessions/<YYYY-MM-DD_120000-xxxx>` (noon local time on `day`); never an existing one."""
        root = self.sessions_dir()
        root.mkdir(parents=True, exist_ok=True)
        while True:
            folder = root / f"{day}_120000-{uuid.uuid4().hex[:4]}"
            try:
                folder.mkdir()
            except FileExistsError:
                continue
            return folder

    def _import_sessions(self, job: Job, campaign: str, rows: list[dict]) -> None:
        self.seed_known()
        have = self._notes_fingerprints(campaign)
        stamp = time.strftime("%Y-%m-%d")
        made: list[tuple[str, str]] = []  # (page name, text)
        for row in rows:
            text, day = row["text"].strip(), row["date"]
            fingerprint = hashlib.sha256(text.encode("utf-8")).hexdigest()
            if fingerprint in have:
                continue
            have.add(fingerprint)
            label = row.get("title") or (f"Session {row['n']}" if row.get("n") else "Notes")
            folder = self._new_notes_folder(day)
            sid = folder.name
            path = self.vault.write_note(
                "Notes",
                f"{day} {label}",
                f"---\ntype: notes\nimported: {stamp}\nsession: {sid}\ntags: [troubadour/notes]\n---\n# {day} {label}\n\n{text}\n",
            )
            started = time.mktime(time.strptime(f"{day} 12:00:00", "%Y-%m-%d %H:%M:%S"))
            meta = {
                "id": sid,
                "kind": "notes",
                "campaign": campaign,
                "started_at": started,
                "title": row.get("title") or None,
                "note": path.relative_to(self.vault.root).as_posix(),
                "duration": 0,
                "duration_s": 0,
                "lines": 0,
                "pipeline": {},
                "fingerprint": fingerprint,
            }
            write_atomic(folder / "meta.json", json.dumps(meta, ensure_ascii=False))
            made.append((path.stem, text))
        job.note = f"{len(made)} sessions"
        parts = [(page, part) for page, text in made for part in chunks(text, CHUNK_CHARS)]
        job.total = len(parts)
        self.emit(job)
        self.bus.emit("campaign.updated", {})
        for page, part in parts:
            out = self.llm.json(NOTES_SYSTEM, f"Existing glossary:\n{glossary_brief(self.vault)}\n\nNotes:\n{part}", NOTES_SCHEMA)
            self._merge_notes(job, out, page)
            job.done += 1
            job.message = f"Read part {job.done} of {job.total}"
            self.emit(job)
            self.bus.emit("campaign.updated", {})
        job.message = f"{len(made)} sessions added; {len(job.created)} new, {len(job.updated)} updated"
        if len(made) < len(rows):
            job.message += f"; {len(rows) - len(made)} already imported"
        if job.skipped:
            job.message += f"; left alone (fix in Obsidian first): {', '.join(job.skipped)}"

    def _import(self, job: Job, title: str, text: str) -> None:
        self.seed_known()
        stamp = time.strftime("%Y-%m-%d")
        path = self.vault.write_note(
            "Notes", title, f"---\ntype: notes\nimported: {stamp}\ntags: [troubadour/notes]\n---\n# {title}\n\n{text}\n"
        )
        note = path.stem
        job.note = path.relative_to(self.vault.root).as_posix()
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
        if job.skipped:
            job.message += f"; left alone (fix in Obsidian first): {', '.join(job.skipped)}"

    def _merge_notes(self, job: Job, out: dict, note: str) -> None:
        source = Source(note)
        items = writeup.as_list(out.get("entities"))
        for item in items[:MAX_ITEMS]:
            if not isinstance(item, dict) or not (name := _name(item.get("name"))):
                continue
            aliases = [a for a in (_name(a) for a in writeup.as_list(item.get("aliases")) if isinstance(a, str)) if a]
            facts = [
                Fact(f, name, source=source)
                for f in (_text(f) for f in writeup.as_list(item.get("facts")) if isinstance(f, str))
                if f
            ][:5]
            description = _text(item.get("description"))
            existing = self.vault.find(name) or next((e for a in aliases if (e := self.vault.find(a))), None)
            if existing is not None and existing.read_only:
                if existing.name not in job.skipped:
                    job.skipped.append(existing.name)
                continue
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
        for fact in writeup.as_list(out.get("campaign_facts"))[:5]:
            if text := _text(fact):
                self.vault.add_campaign_fact(Fact(text, source=source))

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
        if entity.read_only:
            job.message = f"{entity.name}.md can't be read safely; fix it in Obsidian first."
            return
        passages = passages_about(self.vault, self.sessions_dir(), entity.names())
        if not passages:
            job.message = f"Nothing mentions {entity.name}"
            return
        known = "\n".join(f"- {f.text}" for f in [*entity.facts, *entity.suggested_facts]) or "- (none)"
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
            for raw in writeup.as_list(out.get("facts")):
                fact = _text(raw)
                if not fact or fleeting(fact):
                    continue
                before = self.vault.find(entity.name)
                if before is None:
                    return
                prior = len(before.facts) + len(before.suggested_facts)
                self.vault.add_fact(entity.name, Fact(fact, entity.name, source=Source(label)), suggested=True)
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
        record = json.loads(path.read_text(encoding="utf-8"))
        return self.submit("writeup", sid, lambda job: self._write_up(job, record))

    def _write_up(self, job: Job, record: dict) -> None:
        """The session page (writeup.py: read the whole session into notes, then write from the notes), then
        suggestions for the glossary: new names, lasting facts, misheard spellings."""
        self.seed_known()
        s = record["session"]
        lines, cast = transcript_lines(record)
        lines = apply_heard_as(lines, self.vault.entities())
        if not lines:
            raise ValueError("That session has no lines.")
        stamps = {line.split(" ", 1)[0] for line in lines}
        job.plan("Read the whole session", "Write the page", "Scenes", "Suggest names, facts and spellings", "Save the page")
        job.stats(writeup.table_stats(record, [n for e in self.vault.entities() for n in (e.name, *e.aliases)]))
        job.step(0, f"Reading {len(lines)} lines…")
        notes = writeup.read(self.llm, lines, cast, glossary_brief(self.vault), job.model_progress)
        if not notes.beats:
            raise ValueError("The language model's notes on this session came back empty; nothing was written.")
        job.step(1, f"Noted {len(notes.beats)} beats; writing the page…")
        page = writeup.write(self.llm, notes, stamps, job.model_progress)
        job.step(2)
        self._write_scenes(job, record["session"]["id"], notes)
        job.step(3)
        date = time.strftime("%Y-%m-%d", time.localtime(s["started_at"]))
        sid = s["id"]
        existing = self._session_note(sid)
        # A re-run keeps the page's name: facts elsewhere link to it.
        note_title = existing.stem if existing else safe_name(f"{date} {page.title or 'Session'}")
        # Suggestions first, so the session page can link the new names.
        heard_text = norm("\n".join(lines))
        self._suggest_names(job, notes, heard_text)
        found = writeup.facts(self.llm, notes, self._known_facts(notes), job.model_progress)
        self._suggest_facts(job, found, note_title, sid, record["messages"])
        job.step(4)
        self._suggest_spellings(job, notes.spellings, heard_text)

        tdir = self.vault.root / "Sessions" / "Transcripts"
        tdir.mkdir(parents=True, exist_ok=True)
        write_atomic(tdir / f"{sid}.md", transcript.markdown(record))
        body = self._session_markdown(record, note_title, notes, page, len(lines))
        path = existing or self.vault.root / "Sessions" / f"{note_title}.md"
        # The page may have been edited in Obsidian since the last run: keep what it was.
        if path.exists():
            trash_copy(self.vault.root, path)
        write_atomic(path, body)
        job.note = path.relative_to(self.vault.root).as_posix()
        job.step(len(job.steps), f"Wrote {path.stem}; {job.suggested} suggestions to review")

    def _suggest_names(self, job: Job, notes: writeup.Notes, heard_text: str) -> None:
        """People, creatures, groups and places the notes name that the glossary lacks become suggested entries.
        A "new" name that sounds like a known one is that one misheard ("Dallara" is Elara): a spelling, not a
        character. Among the new names, a later spelling of an earlier one folds into it ("Willy Olly Wally")."""
        kept: list[str] = []
        spellings: list[tuple[str, str]] = []
        named = [(x, x.kind or "npc") for x in notes.people] + [(x, "place") for x in notes.places]
        for item, kind in named:
            name = _name(item.name)
            if not name or self.vault.find(name):
                continue
            known = next((e for e in self.vault.entities() if any(looks_like(name, n) for n in e.names())), None)
            if known is not None:
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
                self.vault.create(name, _kind(kind), status="suggested", description=_text(item.what))
            except ValueError:
                continue
            kept.append(name)
            job.created.append(name)
            job.suggested += 1
        self._suggest_spellings(job, spellings, heard_text)

    def _known_facts(self, notes: writeup.Notes) -> list[Fact]:
        """The facts already in the vault about names the notes mention (for the facts step to say "this changes
        that one")."""
        text = norm(notes.text())
        out: list[Fact] = []
        for e in self.vault.entities():
            if any(re.search(rf"\b{re.escape(n)}\b", text) for n in map(norm, e.names()) if n):
                out += e.facts
        return out[: writeup.KNOWN_MAX]

    def _write_scenes(self, job: Job, sid: str, notes: writeup.Notes) -> None:
        """sessions/<id>/scenes.json from the beats. Optional: if the call fails or its answer is unusable,
        nothing is stored (a stale file from an earlier run goes too, it describes other beats) and the
        write-up carries on."""
        path = self.sessions_dir() / sid / "scenes.json"
        places = {norm(n): e.name for e in self.vault.entities() if e.type == "place" for n in e.names() if norm(n)}
        try:
            found = writeup.scenes(self.llm, notes, places, job.model_progress)
        except Exception as e:  # the model is down, out of tokens, or sent junk: scenes are not worth the write-up
            log.warning("scenes for %s failed: %s", sid, e)
            found = None
        if found:
            write_atomic(path, json.dumps(found, ensure_ascii=False))
        else:
            path.unlink(missing_ok=True)

    def _suggest_facts(self, job: Job, found: list[writeup.Suggestion], note_title: str, sid: str, messages: list[dict]) -> None:
        added = 0
        for item in found:
            e = self.vault.find(item.about)
            if e is None or e.read_only or fleeting(item.text) or added >= MAX_SUGGESTED_FACTS:
                continue
            # The old wording must really be one of this entry's facts: the model only saw a numbered list.
            old = item.replaces if any(f.text == item.replaces for f in e.facts) else None
            line = writeup.source_line(item.text, e.name, e.aliases, messages)
            source = Source(note_title, sid, line["t_start"] if line else None)
            fact = Fact(item.text, e.name, writeup.said_by(line) if line else None, source, item.confidence, replaces=old)
            before = len(e.suggested_facts) + len(e.facts)
            e = self.vault.add_fact(e.name, fact, suggested=True)
            if len(e.suggested_facts) + len(e.facts) > before:
                added += 1
                job.suggested += 1
                if e.name not in job.created and e.name not in job.updated:
                    job.updated.append(e.name)

    def _suggest_spellings(self, job: Job, spellings: list[tuple[str, str]], heard_text: str) -> None:
        """A heard-as suggestion for each misheard glossary name. Only words that really occur in the transcript
        (`heard_text`, normalized), sound like the name they're said to mean ("Elkari" is El-Khari, not Elara), and
        aren't already a name of their own."""
        for heard, means in spellings:
            e = self.vault.find(means)
            if e is None or e.read_only or self.vault.find(heard) is not None:
                continue
            if norm(heard) not in heard_text:
                continue
            if not any(looks_like(heard, n) for n in e.names()):
                continue
            if norm(heard) in {norm(h) for h in (*e.heard_as, *e.heard_as_suggested, *e.heard_as_rejected)}:
                continue
            self.vault.update(e.name, heard_as_suggested=[*e.heard_as_suggested, heard])
            job.suggested += 1

    def _session_markdown(self, record: dict, title: str, notes: writeup.Notes, page: writeup.Page, lines: int) -> str:
        s = record["session"]
        entities = self.vault.entities()

        def link(text: str) -> str:
            return link_names(text, self.vault, entities)

        def stamp(at: str) -> str:
            return f"[{at}] " if at else ""

        # A thread the story already resolves (the rider arrived; they long rested) is not still open.
        told = " ".join(b.text for b in notes.beats)
        still_open = [o for o in notes.open if not _NOT_OPEN.search(o) and len(_words(o) & _words(told)) < RESOLVED_WORDS]
        linked = [
            *(link(p) for p in page.last_time.split("\n\n")),
            *(link(x.what) for x in page.spotlight),
            *(link(h.text) for h in page.highlights),
            *(link(b.text) for b in notes.beats),
            *(link(o) for o in still_open),
        ]
        mentioned = sorted({e.name for e in entities if any(f"[[{e.name}]]" in x or f"[[{e.name}|" in x for x in linked)})
        date = time.strftime("%Y-%m-%d", time.localtime(s["started_at"]))
        out = [
            f"---\ntype: session\nsession_id: {s['id']}\ndate: {date}\n"
            f"duration: {transcript.clock(s.get('duration_s', 0))}\ntags: [troubadour/session]\n---",
            f"# {title}",
            "",
            "## Last time",
            "\n\n".join(link(p) for p in page.last_time.split("\n\n")) or "(no wrap-up)",
            "",
        ]
        if page.spotlight:
            out += ["## Spotlight", *(f"- **{x.name}:** {link(x.what)}" for x in page.spotlight), ""]
        if page.highlights:
            out += ["## Highlights", *(f"- {stamp(h.at)}{link(h.text)}" for h in page.highlights), ""]
        out += ["## What happened", *(f"- {stamp(b.at)}{link(b.text)}" for b in notes.beats), ""]
        if notes.people:
            out += ["## People and creatures met", *(f"- **{x.name}:** {link(x.what)}" for x in notes.people), ""]
        if notes.places:
            out += ["## Places", *(f"- **{x.name}:** {link(x.what)}" for x in notes.places), ""]
        if notes.loot:
            out += ["## Loot, money and deals", *(f"- {link(x)}" for x in notes.loot), ""]
        out += ["## Still open", *(f"- {link(o)}" for o in still_open), ""]
        out += [
            "## Mentioned",
            ", ".join(f"[[{n}]]" for n in mentioned) or "(nobody from the glossary)",
            "",
            "## Transcript",
            f"[[Transcripts/{s['id']}|Full transcript]] · {s.get('lines', lines)} lines",
            "",
        ]
        return "\n".join(out)

    def absorbed(self) -> dict[str, list[str]]:
        """Surviving session id → ids of the sessions merged into it (their folders are in the trash)."""
        out = {}
        for path in self.sessions_dir().glob("*/meta.json"):
            try:
                ids = json.loads(path.read_text(encoding="utf-8")).get("merged_from")
            except (OSError, ValueError, AttributeError):
                continue
            if isinstance(ids, list) and ids:
                out[path.parent.name] = [i for i in ids if isinstance(i, str)]
        return out

    def _session_note(self, sid: str) -> Path | None:
        """A session's existing write-up (re-running one replaces it instead of adding another). A merged
        session without a page of its own takes over the page of a session merged into it."""
        for want in (sid, *self.absorbed().get(sid, [])):
            for path in (self.vault.root / "Sessions").glob("*.md"):
                try:
                    head = path.read_text(encoding="utf-8")[:400]
                except OSError:
                    continue
                if f"session_id: {want}\n" in head:
                    return path
        return None

    def written_up(self) -> dict[str, str]:
        """session id → vault-relative path of its write-up. A session that other sessions were merged into
        and has no page of its own shows the page of the first of them that has one."""
        out = {}
        for path in (self.vault.root / "Sessions").glob("*.md"):
            try:
                m = re.search(r"^session_id: (\S+)$", path.read_text(encoding="utf-8")[:400], re.M)
            except OSError:
                continue
            if m:
                out[m.group(1)] = path.relative_to(self.vault.root).as_posix()
        for path in (self.vault.root / "Notes").glob("*.md"):  # imported notes that stand in for a session
            try:
                m = re.search(r"^session: (\S+)$", path.read_text(encoding="utf-8")[:400], re.M)
            except OSError:
                continue
            if m:
                out.setdefault(m.group(1), path.relative_to(self.vault.root).as_posix())
        for survivor, ids in self.absorbed().items():
            if survivor not in out and (page := next((out[i] for i in ids if i in out), None)):
                out[survivor] = page
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


# "Aww", "Mhm", "Ughh", "Hahaha": sounds people make, however many letters they hold.
INTERJECTION = re.compile(r"(?:a+w+h?|m+h*m+|h+m+|u+g+h+|u+h+m*|o+h+|a+h+|e+w+|e+h+|(?:h+a+)+h*|h+e+h+|o+o+f+|p+h+e+w+)", re.I)


def ordinary(word: str) -> bool:
    """An everyday word (or a form of one, or a filler or interjection): never a name candidate."""
    return word.casefold() in FILLERS or INTERJECTION.fullmatch(word) is not None or everyday(word)


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
            texts += [
                m.get("text", "")
                for m in json.loads((folder / "transcript.json").read_text(encoding="utf-8")).get("messages", [])
            ]
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
