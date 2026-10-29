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
from pathlib import Path

import numpy as np
import soxr

from . import talk, tts
from .audio import load_audio
from .config import SR

log = logging.getLogger("troubadour")

Work = Callable[[object], None]  # work(job), job: memory.Job


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
        """(their name, work): (re)build their voice. The preview is ~20 s of something they would say,
        from their speech profile (made on the way if missing), else the stock line."""
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
            text, kind = "", ""
            if prof is not None:
                job.update(message="Writing something they'd say…")
                text, kind = talk.preview_text(self.llm(), name, prof, self._names(), self._own_names(pid, name))
            candidates = self._candidates(job, pid)
            self.clones.build(job, pid, candidates, lambda audio, rate: self._likeness(pid, audio, rate), text, kind)

        return name, work

    def say_job(self, pid: str, text: str, in_their_words: bool) -> tuple[str, Work]:
        """(their name, work): `text` spoken in their voice as a new clip."""
        name, prof = self._ready_to_speak(pid, in_their_words)
        title = text if len(text) <= 60 else text[:59] + "…"
        return name, self._speak_work(pid, name, prof, text, "say", title, {})

    def read_job(self, pid: str, session: str, in_their_words: bool) -> tuple[str, str, Work]:
        """(the page's title, its vault path, work): a session's write-up page read aloud in their voice."""
        name, prof = self._ready_to_speak(pid, in_their_words)
        page = self.written_up().get(session)
        if page is None:
            raise KeyError("that session has no write-up")
        text = tts.speakable((self.vault.root / page).read_text(encoding="utf-8"))
        if len(text) > tts.READ_MAX_CHARS:
            raise ValueError("That page is too long to read aloud.")
        title = Path(page).stem
        return title, page, self._speak_work(pid, name, prof, text, "read", title, {"session": session, "note": page})

    # ---------------------------------------------------------------- parts

    def _ready_to_speak(self, pid: str, in_their_words: bool) -> tuple[str, dict | None]:
        """(name, their speech profile if in_their_words) once a say/read job may start."""
        name = self.engine.check_clone(pid)
        if self.clones.status(pid) is None:
            raise ValueError(f"Build {name}'s voice first.")
        prof = self.clones.profile(pid) if in_their_words else None
        if in_their_words and prof is None:
            raise ValueError(f"Profile how {name} talks first.")
        return name, prof

    def _speak_work(self, pid: str, name: str, prof: dict | None, text: str, kind: str, title: str, source: dict) -> Work:
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
            self.clones.speak(job, pid, spoken, kind, title, source, tempo=tempo, in_their_words=spoken != text)
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

    def _candidates(self, job, pid: str) -> list[tuple[str, np.ndarray, int]]:
        """References to try, as (label, speech, rate): the Train recording, then up to
        tts.SESSION_REFS sessions' cleanest stretches of their own solo lines (tts.solo_lines) at the
        mic's own rate. A line must sound like their voiceprint (tts.SELF_LIKENESS) and is ranked by how
        far its speech stands above the room (tts.noise_floor_db): hours of play hold quieter moments
        than one Train clip, and the clone's likeness follows the reference's cleanliness."""
        job.update(message="Finding the cleanest recordings of them…")
        self.engine.wait_for_models()
        audio, rate, spans = self.engine.train_clip(pid)
        out = [("Train recording", tts.speech_only(audio, rate, spans), rate)]
        lines = [
            (folder.name, folder / "audio.wav", s, e)
            for folder, record in self._transcripts()
            if (folder / "audio.wav").is_file()  # mic sessions: replays have no recording of their own
            for s, e in tts.solo_lines(record, pid)
        ]
        lines = sorted(lines, key=lambda line: line[2] - line[3])[: tts.MAX_LINES]  # longest first
        target = self.engine.train_voiceprint(pid)
        scored, wavs = [], {}
        for sid, wav, s, e in lines:
            try:
                clip = load_audio(wav, s, e)
            except subprocess.CalledProcessError:
                continue
            vec = self.engine.embed(clip)
            if vec is None or (target is not None and float(target @ vec) < tts.SELF_LIKENESS):
                continue  # labelled theirs, but doesn't sound like them: not worth cloning from
            scored.append((tts.noise_floor_db(clip, SR), sid, s, e))
            wavs[sid] = wav
        for sid, picked in tts.pick_sessions(scored):
            with wave.open(str(wavs[sid])) as w:
                native = w.getframerate()
            pieces = [load_audio(wavs[sid], s, e, rate=native) for s, e in picked]
            out.append((f"recording of {sid[:10]}", tts.join(pieces, native), native))
        return out

    def _likeness(self, pid: str, audio: np.ndarray, rate: int) -> float | None:
        """How much `audio` sounds like them to the speaker model: cosine to their Train voiceprint."""
        target = self.engine.train_voiceprint(pid)
        if target is None:
            return None
        vec = self.engine.embed(soxr.resample(audio, rate, SR).astype(np.float32) if rate != SR else audio)
        return None if vec is None else float(target @ vec)

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
