"""The voice-clone jobs: profile how a player talks, build their voice, say text or read a page aloud.

HTTP-free. A request calls one of the *_job methods, which checks it may start (ValueError or KeyError
say why not) and returns the work to queue on the campaign job thread (Memory.submit); the work
reports through memory.Job. The parts: the engine (consent, Train clips, the speaker model, and the
live session jobs wait out), tts (audio, text, files), talk (speech profile, restyling), the memory
LLM (local, or the hosted one the user picked) and the vault (names a restyle must keep).
See PLAN.md "Voice clones".
"""

import json
import logging
import subprocess
import wave
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soxr

from . import talk, tts
from .audio import load_audio
from .config import SR
from .voices import normalize

log = logging.getLogger("troubadour")

Work = Callable[[object], None]  # work(job), job: memory.Job
CONTEXT_LINES = 2  # lines before one of theirs, for the AI to tell in character from table talk


@dataclass
class Line:
    """One of their solo lines in a recorded session, a candidate for a voice's reference."""

    session: str
    wav: Path
    start: float
    end: float
    text: str
    context: list[tuple[str, str]]  # (speaker, text) of the lines just before
    persona: str | None  # tts.TABLE or a character voice's key; None until decided
    label: str  # the character's name ("" for table talk)
    vec: np.ndarray | None = None
    floor_db: float = 0.0


def _summary(voice: dict) -> str:
    """ "table voice 0.81" / "as Elara 0.62" for a job's last message."""
    name = f"as {voice['label']}" if voice["persona"] != tts.TABLE else "table voice"
    return name if voice["likeness"] is None else f"{name} {voice['likeness']:.2f}"


class Cloning:
    def __init__(self, engine, llm: Callable[[], object], vault, written_up: Callable[[], dict[str, str]]):
        self.engine = engine
        self.clones: tts.Clones = engine.clones
        self.llm = llm  # the memory LLM, looked up per job: the user may switch providers
        self.vault = vault
        self.written_up = written_up  # session id -> vault-relative path of its write-up

    # ---------------------------------------------------------------- jobs

    def profile_job(self, pid: str) -> tuple[str, Work]:
        """(their name, work): count how they talk across every saved transcript (needs consent only:
        no voice model, so it may run during a session)."""
        name = self.engine.check_clone(pid, needs_idle=False)

        def work(job) -> None:
            prof = self._profile(job, pid, name)
            job.update(message="Profile ready" + ("" if prof["description"] else " (the AI is offline: numbers only)"))

        return name, work

    def build_job(self, pid: str) -> tuple[str, Work]:
        """(their name, work): (re)build their voices. Their table voice from the Train recording or the
        cleanest stretch of their table talk; a character voice for each character they voice in the
        sessions (_lines). Each preview is ~20 s of something they'd say (talk.preview_text,
        talk.character_text; their speech profile is made on the way if missing)."""
        name = self.engine.check_clone(pid)
        if not self.engine.has_train_clip(pid):
            raise ValueError("Train them first: the voice clone copies the Train recording.")

        def work(job) -> None:
            prof = self.clones.profile(pid)
            if prof is None:
                try:
                    prof = self._profile(job, pid, name)
                except ValueError:  # too few of their lines yet: the stock line will do
                    prof = None
            names, own = self._names(), self._own_names(pid, name)
            text, kind = "", ""
            if prof is not None:
                job.update(message="Writing something they'd say…")
                text, kind = talk.preview_text(self.llm(), name, prof, names, own)
            self.engine.wait_for_models()
            by_voice = self._scored(job, pid, self._lines(job, pid, name))
            audio, rate, spans = self.engine.train_clip(pid)
            references = [("Train recording", tts.speech_only(audio, rate, spans), rate)]
            target = self.engine.train_voiceprint(pid)
            built = [
                self.clones.build(
                    job, pid, references + self._references(by_voice.pop(tts.TABLE)), self._match(target), text, kind
                )
            ]
            wpm = prof.get("wpm") if prof else None
            for persona, lines in by_voice.items():
                references = self._references(lines)
                if not references:
                    continue
                label = lines[0].label
                job.update(message=f"Writing something {label} would say…")
                said, kind = talk.character_text(self.llm(), name, label, [line.text for line in lines], names, own, wpm)
                as_them = normalize(np.mean([line.vec for line in lines], axis=0))  # how they sound as them
                built.append(self.clones.build(job, pid, references, self._match(as_them), said, kind, persona, label))
            self.clones.prune(pid, {b["persona"] for b in built})
            job.update(message="Ready: " + ", ".join(_summary(b) for b in built))

        return name, work

    def say_job(self, pid: str, text: str, in_their_words: bool, persona: str = tts.TABLE) -> tuple[str, Work]:
        """(their name, work): `text` spoken in one of their voices as a new clip."""
        name, prof = self._ready_to_speak(pid, in_their_words, persona)
        title = text if len(text) <= 60 else text[:59] + "…"
        return name, self._speak_work(pid, name, prof, text, "say", title, {}, persona)

    def read_job(self, pid: str, session: str, in_their_words: bool, persona: str = tts.TABLE) -> tuple[str, str, Work]:
        """(the page's title, its vault path, work): a session's write-up page read aloud in their voice."""
        name, prof = self._ready_to_speak(pid, in_their_words, persona)
        page = self.written_up().get(session)
        if page is None:
            raise KeyError("that session has no write-up")
        text = tts.speakable((self.vault.root / page).read_text(encoding="utf-8"))
        if len(text) > tts.READ_MAX_CHARS:
            raise ValueError("That page is too long to read aloud.")
        title = Path(page).stem
        source = {"session": session, "note": page}
        return title, page, self._speak_work(pid, name, prof, text, "read", title, source, persona)

    # ---------------------------------------------------------------- parts

    def _ready_to_speak(self, pid: str, in_their_words: bool, persona: str) -> tuple[str, dict | None]:
        """(name, their speech profile if in_their_words) once a say/read job in `persona` may start.
        In their words is their table talk's style, so it's for their table voice only."""
        name = self.engine.check_clone(pid)
        status = self.clones.status(pid)
        if status is None:
            raise ValueError(f"Build {name}'s voice first.")
        if persona != tts.TABLE and persona not in {c["persona"] for c in status["characters"]}:
            raise KeyError(f"{name} has no voice {persona!r}")
        if in_their_words and persona != tts.TABLE:
            raise ValueError("In their words is for their own voice, not a character's.")
        prof = self.clones.profile(pid) if in_their_words else None
        if in_their_words and prof is None:
            raise ValueError(f"Profile how {name} talks first.")
        return name, prof

    def _speak_work(
        self, pid: str, name: str, prof: dict | None, text: str, kind: str, title: str, source: dict, persona: str
    ) -> Work:
        """The say/read job: restyled like them first when there's a profile, then spoken at their pace."""

        def work(job) -> None:
            spoken, tempo, kept = text, 1.0, 0
            if prof is not None:
                own = self._own_names(pid, name)
                spoken, kept = talk.restyle(
                    self.llm(),
                    name,
                    prof,
                    text,
                    self._names(),
                    own,
                    lambda done, total: job.update(done=done, total=total, message="Rewriting it in their words…"),
                )
                tempo = talk.tempo(prof.get("wpm"), (self.clones.status(pid) or {}).get("clone_wpm"))
            self.clones.speak(job, pid, spoken, kind, title, source, tempo=tempo, in_their_words=spoken != text, persona=persona)
            if kept:
                job.update(message=f"{job.message}; {kept} part{'s' if kept != 1 else ''} kept the original wording")

        return work

    def _profile(self, job, pid: str, name: str) -> dict:
        """Count how they talk across every saved transcript, add the AI's description, save it."""
        records = [record for _, record in self._transcripts()]
        job.update(message=f"Counting their lines in {len(records)} sessions…")
        prof = talk.profile(records, pid)
        job.update(message="Describing how they talk…")
        prof["description"] = talk.describe(self.llm(), name, prof)
        self.clones.save_profile(pid, prof)
        return prof

    def _lines(self, job, pid: str, name: str) -> list[Line]:
        """Their solo lines in mic-recorded sessions (tts.solo_lines), the longest tts.MAX_LINES, each
        given a voice: a voice named with a character in the voices panel is that character's; else,
        for a player (not the GM, whose NPCs the AI can't tell apart), the AI reads it in context:
        in character goes to their seat's character, table talk (or unsure) to their table voice."""
        lines: list[Line] = []
        for folder, record in self._transcripts():
            if not (folder / "audio.wav").is_file():  # mic sessions: replays have no recording of their own
                continue
            messages = record["messages"]
            panel = {v["id"]: v["character"] for v in record.get("voices", []) if v.get("character")}
            for i in tts.solo_lines(record, pid):
                m = messages[i]
                character = panel.get(m.get("voice_id"))
                context = [(c.get("speaker") or "?", c.get("text", "")) for c in messages[max(0, i - CONTEXT_LINES) : i]]
                lines.append(
                    Line(
                        folder.name,
                        folder / "audio.wav",
                        m["t_start"],
                        m["t_end"],
                        m.get("text", ""),
                        context,
                        tts.persona_key(character) if character else None,
                        character or "",
                    )
                )
        lines = sorted(lines, key=lambda line: line.start - line.end)[: tts.MAX_LINES]  # longest first
        with self.engine.lock:
            player = self.engine.players.get(pid)
            is_gm, seat = (player.is_gm, player.character) if player else (False, "")
        unread = [line for line in lines if line.persona is None]
        if unread and not is_gm:
            label = seat or "In character"
            in_character = talk.classify_lines(
                self.llm(),
                name,
                seat,
                [{"text": line.text, "context": line.context} for line in unread],
                lambda done, total: job.update(message=f"Reading which of their lines are in character ({done}/{total})…"),
            )
            for line, ic in zip(unread, in_character, strict=True):
                if ic:
                    line.persona, line.label = tts.persona_key(label), label
        for line in lines:
            if line.persona is None:
                line.persona, line.label = tts.TABLE, ""
        return lines

    def _scored(self, job, pid: str, lines: list[Line]) -> dict[str, list[Line]]:
        """Lines by voice (persona), each measured: its voiceprint and how far its speech stands above the
        room (tts.noise_floor_db). A line that doesn't sound like the voice it's in is dropped (a
        mislabelled line isn't worth cloning from): table talk against their Train voiceprint, a
        character's lines against those lines' own centroid (a performance can sound like someone
        else entirely: the GM's troll is still the GM). Both at tts.SELF_LIKENESS."""
        job.update(message="Finding the cleanest recordings of them…")
        out: dict[str, list[Line]] = {tts.TABLE: []}
        for line in lines:
            try:
                clip = load_audio(line.wav, line.start, line.end)
            except subprocess.CalledProcessError:
                continue
            line.vec = self.engine.embed(clip)
            if line.vec is not None:
                line.floor_db = tts.noise_floor_db(clip, SR)
                out.setdefault(line.persona, []).append(line)
        for persona, measured in out.items():
            centroid = normalize(np.mean([line.vec for line in measured], axis=0)) if measured else None
            target = self.engine.train_voiceprint(pid) if persona == tts.TABLE else centroid
            if target is not None:
                out[persona] = [line for line in measured if float(target @ line.vec) >= tts.SELF_LIKENESS]
        return out

    def _references(self, lines: list[Line]) -> list[tuple[str, np.ndarray, int]]:
        """Up to tts.SESSION_REFS references from these lines, a session each, the cleanest first, at
        the mic's own rate: hours of play hold quieter moments than one Train clip, and the clone's
        likeness follows the reference's cleanliness."""
        wavs = {line.session: line.wav for line in lines}
        out = []
        for sid, picked in tts.pick_sessions([(line.floor_db, line.session, line.start, line.end) for line in lines]):
            with wave.open(str(wavs[sid])) as w:
                native = w.getframerate()
            pieces = [load_audio(wavs[sid], s, e, rate=native) for s, e in picked]
            out.append((f"recording of {sid[:10]}", tts.join(pieces, native), native))
        return out

    def _match(self, target: np.ndarray | None) -> Callable[[np.ndarray, int], float | None]:
        """The likeness a build scores clones by: cosine of a clone's voiceprint to `target`."""

        def likeness(audio: np.ndarray, rate: int) -> float | None:
            if target is None:
                return None
            vec = self.engine.embed(soxr.resample(audio, rate, SR).astype(np.float32) if rate != SR else audio)
            return None if vec is None else float(target @ vec)

        return likeness

    def _transcripts(self) -> Iterator[tuple[Path, dict]]:
        """(session folder, saved record) of every saved session, all campaigns: people are library-wide."""
        for path in sorted(self.engine.sessions_dir().glob("*/transcript.json")):
            try:
                yield path.parent, json.loads(path.read_text())
            except (OSError, ValueError):
                log.warning("skipping unreadable transcript %s", path)

    def _names(self) -> list[str]:
        """Names a restyle must keep and mustn't invent: the table's and the campaign glossary's."""
        with self.engine.lock:
            names = [n for p in self.engine.players.values() for n in (p.name, p.character) if n]
        try:
            names += [n for e in self.vault.entities() for n in e.names()]
        except Exception:  # a broken vault never stops the voice; the numbers check still holds
            log.exception("couldn't read the glossary for a restyle")
        return names

    def _own_names(self, pid: str, name: str) -> list[str]:
        """The speaker's own names (theirs and their character's): they may say "I" instead."""
        with self.engine.lock:
            p = self.engine.players.get(pid)
            return [n for n in (name, p.character if p else "") if n]
