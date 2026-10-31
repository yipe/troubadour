"""The session lifecycle (start, pause, resume, stop, finish), the segmenter and worker loops, transcription and the spelling-cleanup loop.

PipelineMixin holds no state: everything lives on `Engine`, created in `Engine.__init__`.
Reads, or mutates in place: `self._learner`, `self._start_lock`, `self.audio_monitor`, `self.bus`, `self.campaign`, `self.cleanup_llm`, `self.cleanup_q`, `self.embed_lock`, `self.lock`, `self.matcher`, `self.messages`, `self.players`, `self.refine_now`, `self.train_job`, `self.vault`, `self.voices`.
Assigns: `self._glossary`, `self._spell`, `self.buffer`, `self.live`, `self.source_desc`, `self.status`.
Locking: `self.lock` guards shared state; a session's own threads check `sess is self.live` under it before writing (session isolation). Whisper and the LLM run outside the lock; `_start_lock` serializes start and stop.
"""

import logging
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any, cast

import numpy as np
from troubadour.core import config, transcript
from troubadour.lore import cleanup
from troubadour.lore.campaign import Corrector, Entity, english
from troubadour.sound import asr, levels
from troubadour.sound.audio import FileSource, MicSource, Recorder
from troubadour.sound.segment import SegmentConfig, Segmenter
from troubadour.sound.voices import normalize

from .buffers import AudioBuffer
from .bus import Bus
from .live_session import STOP, LiveSession
from .model import JOIN, PROVISIONAL_BELOW, SR, Message, Player, short_id
from .notebook import Notebook, NotebookLoop

if TYPE_CHECKING:
    from .core import Engine
from .paths import SESSION_ID, sample_path, session_audio

log = logging.getLogger("troubadour")

SEGMENT = SegmentConfig()  # utterance cutting; values measured in PLAN.md ("Utterance cutting")
ACTIVE_EVERY_S = 0.5  # fast speaker.active cadence while someone talks
ACTIVE_WINDOW_S = 1.5
MIC_STALL_S = 5.0  # mic silent this long (no frames at all, not just quiet) → warn the UI
NOTEBOOK_DRAIN_S = 30.0  # how long Stop waits for a notebook pass already asking the model
GLOSSARY_CHECK_S = 5.0  # how often new lines re-check the vault for glossary edits
PROMPT_NAMES = 20  # more names make Whisper worse at everything else (PLAN.md, "Whisper prompt")
PROMPT_MENTION_LINES = 100  # glossary names said this recently go first in the Whisper prompt
CONTEXT_MIN_S = 1.0  # shorter clips get the names but not the last lines in their Whisper prompt
CLEANUP_BATCH, CLEANUP_GATHER_S, CLEANUP_CONTEXT = 8, 1.5, 4  # lines per LLM call, wait to fill it, lines before


# Windows: the flag lasts while the thread that set it lives, so a helper process sets it and waits for us.
_WINDOWS_AWAKE = (
    "$k = Add-Type -Name Power -Namespace Troubadour -PassThru -MemberDefinition "
    "'[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);'; "
    "[void]$k::SetThreadExecutionState(0x80000001); Wait-Process -Id {pid}"  # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
)


def awake_command(pid: int) -> list[str] | None:
    """A process that keeps the computer from idle-sleeping until it is stopped or `pid` exits; None when
    this system has no way to ask."""
    if exe := shutil.which("caffeinate"):  # macOS
        return [exe, "-i", "-w", str(pid)]
    if (exe := shutil.which("systemd-inhibit")) and (tail := shutil.which("tail")):  # most Linux desktops
        why = ["--what=idle:sleep", "--who=Troubadour", "--why=A session is running"]
        return [exe, *why, tail, f"--pid={pid}", "-f", "/dev/null"]
    if sys.platform == "win32" and (exe := shutil.which("powershell")):
        return [exe, "-NoProfile", "-NonInteractive", "-Command", _WINDOWS_AWAKE.format(pid=pid)]
    return None


def keep_awake() -> subprocess.Popen | None:
    """Hold off idle sleep while a session runs; the helper also dies with this process."""
    command = awake_command(os.getpid())
    if command is None:
        return None
    try:
        return subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:  # start() has already taken the session live; a missing sleep assertion is no reason to fail it
        log.warning("couldn't hold off sleep; the computer may idle-sleep during this session", exc_info=True)
        return None


class PipelineMixin:
    # Set in Engine.__init__; declared for the type checker where this file's newer code uses them.
    lock: threading.RLock
    players: dict[str, Player]
    campaign: str
    voices: dict[str, Any]  # typed loosely: the older code here treats Voice fields as unchecked
    matcher: Any  # a VoiceMatcher once the models load (start() waits for them)
    bus: Bus
    sessions_dir: Callable[[], Path]  # SessionsMixin

    def start(
        self,
        source: dict,
        *,
        title: str = "",
        present_player_ids: list[str] | None = None,
        record_audio: bool | None = None,
        cleanup: bool | None = None,
    ) -> dict:
        """present_player_ids: seated players at the table (empty: everyone). record_audio and cleanup
        override the process-wide settings for this session only. source: {"kind": "file", "name", "speed"} | {"kind": "session", "id", "speed"} (replay a
        saved session's audio) | {"kind": "mic", "device"} (validated by the server). A file
        source may also carry "end" (seconds; troubadour-sim only, the API never passes it)."""
        self._require_models()
        present = list(dict.fromkeys(present_player_ids or []))
        with self.lock:
            unknown = [pid for pid in present if pid not in self.players]
        if unknown:
            raise ValueError(f"Not seated in this campaign: {', '.join(unknown)}")
        kind = source["kind"]
        if kind in ("file", "session"):
            key = "name" if kind == "file" else "id"
            try:
                if kind == "file":
                    path, end = sample_path(source[key]), source.get("end")
                else:
                    path, end = session_audio(source[key])
                src = FileSource(path, float(source.get("speed") or 1.0), end=end)
            except KeyError:
                raise
            except Exception as e:
                raise ValueError(f"Couldn't read {source[key]}: {e}") from e
            desc = {"kind": kind, key: source[key], "speed": src.speed}
        else:
            src = MicSource(source.get("device"))
            desc = {"kind": "mic", "device": source.get("device"), "device_name": src.device_name()}
        self.stop_mic_test()  # a session needs the mic; its own meter takes over
        with self._start_lock:
            sess = LiveSession(
                src, desc, self.campaign, title=title, present_player_ids=present, record_audio=record_audio, cleanup=cleanup
            )
            if kind == "mic":
                self._attach_tap(sess, src)  # before start(): the recording begins at t=0 too
            # Open the source first: if the mic is missing or busy, nothing has changed yet.
            try:
                src.start(sess.frames_q.put, lambda: sess.frames_q.put(STOP))
            except Exception as e:
                src.stop()
                if sess.recorder is not None:
                    sess.recorder.close()
                    shutil.rmtree(sess.recorder.path.parent, ignore_errors=True)
                raise ValueError(f"Couldn't open {desc['kind']}: {e}") from e
            self.save_transcript(force=True)  # the old transcript is about to be cleared
            with self.lock:
                if self.live is not None:
                    self.live.abandon()  # its threads exit without touching shared state
                    self.live.restore_absent(self.matcher)
                self.messages.clear()
                for vid in [v.id for v in self.voices.values() if v.status == "pending"]:
                    del self.voices[vid]
                for v in self.voices.values():
                    v.spans = []  # spans pointed into the previous session's audio
                self.live, self.buffer, self.source_desc, self.status = sess, sess.buffer, desc, "running"
                sess.leave_out_absent(self.matcher, self.voices)
                snapshot = self.snapshot()
            sess.awake = keep_awake()  # a 4-hour session must not stop when the computer idles to sleep
            self._snapshot_setup(sess, "start")
            self.bind_notebook(sess)
            sess.meter = levels.LevelMeter(self.bus.emit) if self.audio_monitor else None
            threading.Thread(target=self._segment_loop, args=(sess,), name="segmenter", daemon=True).start()
            threading.Thread(target=self._worker_loop, args=(sess,), name="worker", daemon=True).start()
        self.bus.emit("snapshot", snapshot)  # clients drop the old transcript
        return snapshot["session"]

    def _attach_tap(self, sess: LiveSession, src: MicSource) -> None:
        """The mic's own-rate audio (usually 48 kHz), not the pipeline's 16 kHz, goes to the session
        recording (unless TROUBADOUR_RECORD=0) and to a Train clip taken mid-session."""
        try:
            rate = src.native_rate()
        except Exception:
            return  # no such device: start() is about to fail with the real message
        sess.native_rate = rate

        def failed(error: str) -> None:  # from the writer thread, mid-session
            log.error("session recording stopped: %s", error)
            self.bus.emit("error", {"message": f"The audio recording stopped (the transcript still saves): {error}"})

        if sess.record_audio:
            try:
                sess.recorder = Recorder(self.sessions_dir() / sess.id / "audio.wav", rate, on_error=failed)
            except OSError as e:
                log.exception("can't record session audio")
                self.bus.emit("error", {"message": f"Not recording audio (the transcript still saves): {e}"})
        recorder = sess.recorder

        def tap(block: np.ndarray) -> None:  # the audio callback: appends only
            if recorder is not None:
                recorder.write(block)
            job = self.train_job
            if job is not None and job.from_session:
                job.feed_native(block)

        src.tap = tap

    def pause(self) -> dict:
        """Hold the mic or replay. The session, transcript, and recording stay open."""
        with self._start_lock, self.lock:
            sess = self.live
            if self.status != "running" or sess is None:
                return self.session_json()
            sess.paused = True
            self.status = "paused"
            sess.source.pause()
            out = self.session_json()
        self.bus.emit("session.updated", out)
        return out

    def resume(self) -> dict:
        with self._start_lock, self.lock:
            sess = self.live
            if self.status != "paused" or sess is None:
                return self.session_json()
            sess.source.resume()
            sess.paused = False
            self.status = "running"
            out = self.session_json()
        self.bus.emit("session.updated", out)
        return out

    def stop(self) -> dict:
        """Stop listening; queued utterances still finish, then status goes idle."""
        with self._start_lock, self.lock:
            sess = self.live
            if self.status not in ("running", "paused") or sess is None:
                return self.session_json()
            self.status = "stopping"
            sess.paused = False
            sess.source.stop()
            sess.frames_q.put(STOP)
            out = self.session_json()
        self.bus.emit("session.updated", out)
        return out

    def _finish(self, sess: LiveSession) -> None:
        with self.lock:
            if sess is not self.live:
                return
        # Save everything before announcing "idle": a Replay clicked the moment the UI says the
        # session ended must see the final meta.json (its duration caps the replay) and recording.
        try:
            failed = self._save_final(sess)
            if failed:
                self.bus.emit("error", {"message": "Saving the session failed: " + "; ".join(failed)})
        finally:  # a full disk must not leave the engine "stopping": Stop, Refresh and backup all wait on idle
            self._go_idle(sess)

    def _save_final(self, sess: LiveSession) -> list[str]:
        """Each save is tried on its own, so a failed transcript save still keeps the notebook and the
        voiceprints. Returns what failed, for the error the UI shows."""
        failed: list[str] = []
        eng = cast("Engine", self)

        def attempt(what: str, save: Callable[[], object]) -> None:
            try:
                save()
            except Exception as e:
                log.exception("saving the finished session: %s failed", what)
                failed.append(f"{what}: {type(e).__name__}: {e}")

        def release() -> None:
            sess.release()
            with self.lock:
                sess.restore_absent(self.matcher)  # before the state save: their voiceprints are written from the matcher

        def notebook() -> None:
            if sess.notebook_loop is not None:  # a pass in flight would add its items after the save below
                sess.notebook_loop.drain(NOTEBOOK_DRAIN_S)
            sess.notebook.save(self.sessions_dir() / sess.id / "notebook.json")

        attempt("recording", release)
        attempt("transcript", lambda: eng.save_transcript(force=True))
        attempt("voices", eng._save_state)  # keep voiceprints adapted during the session
        attempt("setup", lambda: eng._snapshot_setup(sess, "end"))
        attempt("notebook", notebook)
        if sess.desc["kind"] == "mic":
            threading.Thread(target=self._quality_quietly, args=(sess.id,), name="quality", daemon=True).start()
        return failed

    def _go_idle(self, sess: LiveSession) -> None:
        with self.lock:
            if sess is not self.live:  # a new session started meanwhile; it saved this one first
                return
            self.status = "idle"
        self._emit_session()
        self.refine_now.set()

    def bind_notebook(self, sess: LiveSession) -> None:
        """Let the session's notebook emit, and only while the session is the live one."""

        def is_live() -> bool:
            with self.lock:
                return sess is self.live

        sess.notebook.is_live = is_live
        sess.notebook.emit = lambda data: self.bus.emit("notebook.updated", data)
        sess.notebook_loop = NotebookLoop(cast("Engine", self), sess)
        sess.notebook_loop.start()

    def notebook_json(self) -> dict:
        """The live notebook, or an empty one when no session is running."""
        with self.lock:
            sess = self.live if self.status != "idle" else None
        return sess.notebook.to_json() if sess is not None else Notebook(None).to_json()

    def add_pin(self, t: float, text: str) -> dict:
        with self.lock:
            sess = self.live if self.status != "idle" else None
        if sess is None:
            raise ValueError("no session is running")
        return sess.notebook.add_pin(t, text)

    def set_notebook_status(self, item_id: str, status: str) -> dict:
        with self.lock:
            sess = self.live if self.status != "idle" else None
        if sess is None:
            raise KeyError(item_id)
        return sess.notebook.set_status(item_id, status)

    def saved_notebook(self, sid: str) -> dict:
        """A saved session's notebook (empty when it has none)."""
        if not SESSION_ID.fullmatch(sid):
            raise KeyError(sid)
        return Notebook.load(self.sessions_dir() / sid / "notebook.json", sid).to_json()

    def _segment_loop(self, sess: LiveSession) -> None:
        if not self._wait_ready(sess):
            # Models failed to load (the error toast is already out) or the session was replaced:
            # stop the source and let the worker end the session instead of leaving it "running".
            sess.source.stop()
            sess.utt_q.put(STOP)
            return
        try:
            self._segment(sess)
        except Exception as e:
            log.exception("segmenter failed")
            self.bus.emit("error", {"message": f"Listening stopped: {type(e).__name__}: {e}"})
            with self.lock:
                if sess is self.live and self.status == "running":
                    self.status = "stopping"
            sess.source.stop()
            sess.utt_q.put(STOP)  # worker finishes what it has, then the session goes idle

    def _segment(self, sess: LiveSession) -> None:
        import torch
        from silero_vad import load_silero_vad

        # Own model per session: Silero is stateful, and an abandoned session may still be draining.
        vad = load_silero_vad()
        seg = Segmenter(SR, SEGMENT)
        buffer, frames_q, utt_q = sess.buffer, sess.frames_q, sess.utt_q
        was_speaking = False
        next_active = 0
        active_voice: str | None = None
        next_session_emit = 0.0
        last_frame, stalled = time.monotonic(), False
        while True:
            try:
                frame = frames_q.get(timeout=0.5)
            except queue.Empty:
                if sess.abandoned:
                    return
                if sess.paused:
                    last_frame = time.monotonic()
                    continue
                # A mic that stops delivering (unplugged, Bluetooth drop, device reset) would
                # otherwise leave a silent "running" session. File replays are paced by us.
                if sess.desc["kind"] == "mic" and not stalled and time.monotonic() - last_frame > MIC_STALL_S:
                    stalled = True
                    log.warning("no audio from the microphone for %.0fs", MIC_STALL_S)
                    self.bus.emit(
                        "error", {"message": f"No audio from the microphone for {MIC_STALL_S:.0f}s. Is it still plugged in?"}
                    )
                continue
            last_frame = time.monotonic()
            if stalled:
                stalled = False
                log.info("microphone audio is back")
            if sess.abandoned:
                return
            if frame is STOP:
                for start, end in seg.flush():
                    utt_q.put((start / SR, end / SR))
                utt_q.put(STOP)
                return
            buffer.append(frame)
            meter = sess.meter  # read once: the UI can switch the monitor off mid-frame
            if meter is not None:
                meter.feed(frame)
            job = self.train_job
            if job is not None and job.from_session:
                job.feed(frame)
            now = buffer.n
            with torch.no_grad():
                prob = vad(torch.from_numpy(frame), SR).item()
            for start, end in seg.feed(frame, prob):
                utt_q.put((start / SR, end / SR))
            if seg.start is not None and not was_speaking:
                next_active = seg.start + int(0.8 * SR)
            was_speaking = seg.start is not None
            if seg.start is None and active_voice is not None:
                active_voice = None
                self.bus.emit("speaker.active", {"voice_id": None, "confidence": 0.0})
            if seg.start is not None and now >= next_active:
                next_active = now + int(ACTIVE_EVERY_S * SR)
                vid, score = self._quick_speaker(buffer, max(seg.start, now - int(ACTIVE_WINDOW_S * SR)), now)
                if vid is not None:
                    active_voice = vid
                    self.bus.emit("speaker.active", {"voice_id": vid, "confidence": round(score, 3)})
            if now / SR >= next_session_emit:
                next_session_emit = now / SR + 5.0
                self._emit_session()

    def _embed(self, audio: np.ndarray, start: float, end: float) -> np.ndarray | None:
        with self.embed_lock:
            return self.matcher.embed(audio, start, end)

    def _quick_speaker(self, buffer: AudioBuffer, start: int, end: int) -> tuple[str | None, float]:
        """Best guess for the box lights: named voices, else a visible pending voice. No adaptation."""
        vec = self._embed(buffer.view(), start / SR, end / SR)
        if vec is None:
            return None, 0.0
        with self.lock:
            if self.matcher.names:
                scores = self.matcher.scores(vec)
                best = int(np.argmax(scores))
                if scores[best] >= self.matcher.unknown_below:
                    return self.matcher.names[best], float(scores[best])
            pending = [(float(normalize(v.sum) @ vec), v.id) for v in self.voices.values() if v.status == "pending" and v.visible]
        if pending:
            score, vid = max(pending)
            if score >= JOIN:
                return vid, score
        return None, 0.0

    def _worker_loop(self, sess: LiveSession) -> None:
        # No wait for the models here: utterances only arrive once the segmenter has them.
        warned = False
        while True:
            item = sess.utt_q.get()
            if sess.abandoned:
                return
            if item is STOP:
                self._finish(sess)
                return
            try:
                self._process_utterance(sess, *item)
            except Exception as e:
                log.exception("utterance failed")
                if not warned:  # once per session: the UI should know lines are being lost
                    warned = True
                    self.bus.emit("error", {"message": f"Transcription failed: {type(e).__name__}: {e}"})

    def _glossary_state(self) -> tuple[Corrector | None, list[str]]:
        """(text fixer, names for Whisper) from the vault, rebuilt when a note changes (checked
        every few seconds). A vault that can't be read never stops transcription."""
        if self.vault is None:
            return None, []
        signature, checked, corrector, names, entries = self._glossary
        now = time.monotonic()
        if corrector is not None and now - checked < GLOSSARY_CHECK_S:
            return corrector, names
        try:
            fresh = self.vault.signature()
            if corrector is None or fresh != signature:
                entries = self.vault.glossary()
                corrector = Corrector(entries, english())
                order = {"pc": 0, "npc": 1}
                names = [e.name for e in sorted(entries, key=lambda e: order.get(e.type, 2))]
        except OSError:
            log.exception("couldn't read the campaign glossary")
            fresh = signature
        self._glossary = (fresh, now, corrector, names, entries)
        return corrector, names

    def _ignored_signature(self) -> tuple:
        try:
            st = self.vault.ignored_path.stat() if self.vault is not None else None
            return (st.st_mtime_ns, st.st_size) if st else ()
        except Exception:  # an odd or broken vault never stops transcription
            return ()

    def speller(self, live: bool = False) -> cleanup.Speller | None:
        """Known spellings for the cleanup: confirmed glossary entries, the names Setup and the
        voices panel know (even before they're in the vault), and the D&D vocabulary.
        live: for the running session's lines, which follow that session's own cleanup choice."""
        sess = self.live
        if not (sess.cleanup if live and sess is not None else config.CLEANUP):
            return None
        self._glossary_state()
        signature, entries = self._glossary[0], self._glossary[4]
        with self.lock:
            known = tuple(self.known_names())
        key = (signature, known, self._ignored_signature())
        if self._spell[0] != key:
            have = {e.name.casefold() for e in entries}
            extra = [Entity(name, kind, description=about) for name, kind, about in known if name.casefold() not in have]
            keep = []
            if self.vault is not None:
                try:  # the user's calls: ignored words, and names still waiting for review
                    keep = [
                        *self.vault.ignored(),
                        *(n for e in self.vault.entities() if e.status == "suggested" for n in e.names()),
                    ]
                except Exception:  # an odd or broken vault never stops transcription
                    keep = []
            self._spell = (key, cleanup.Speller([*entries, *extra], keep=keep))
        return self._spell[1]

    def whisper_prompt(self, vault_names: list[str], history: list[str], seconds: float) -> str:
        """The Whisper prompt for a `seconds` long clip after `history` (the lines so far): the
        table's names (Setup, voices panel), glossary names said lately, the rest of the glossary,
        and the last lines, fitted to Whisper's prompt window. A clip shorter than CONTEXT_MIN_S
        gets no lines: on a blip of noise they tempt Whisper into a whole invented sentence.
        asr.transcribe drops the prompt if it gets echoed."""
        with self.lock:
            table = [n for n, _, _ in self.known_names()] + [p.name for p in self.players.values()]
        nicknames = [a for e in self._glossary[4] for a in e.aliases]  # entries as of the last glossary check
        names = asr.prompt_names(table, vault_names, history[-PROMPT_MENTION_LINES:], nicknames)[:PROMPT_NAMES]
        lines = history[-config.ASR_CONTEXT_LINES :] if seconds >= CONTEXT_MIN_S else []
        return asr.build_prompt(names, lines)

    def _whisper_prompt(self, vault_names: list[str], seconds: float) -> str | None:
        if not config.ASR_PROMPT:
            return None
        with self.lock:
            history = [m.text for m in list(self.messages.values())[-PROMPT_MENTION_LINES:]]
        return self.whisper_prompt(vault_names, history, seconds)

    def _process_utterance(self, sess: LiveSession, t0: float, t1: float) -> None:
        audio = sess.buffer.view()
        corrector, vault_names = self._glossary_state()
        clip = audio[int(t0 * SR) : int(t1 * SR)]
        prompt = self._whisper_prompt(vault_names, t1 - t0)
        text = asr.transcribe(clip, prompt) if prompt else asr.transcribe(clip)
        if not text or transcript.filler_only(text):  # "Um...": nothing was said
            return
        if corrector is not None:
            text = corrector(text)
        fixes: list[dict] = []
        unsure = False
        if (speller := self.speller(live=True)) is not None:
            sure = [(c.start, c.end, c.options[0]) for c in speller.find(text) if c.sure]
            if sure:
                text, fixes = cleanup.apply(text, [], sure)
            unsure = any(not c.sure for c in speller.find(text))
        vec = self._embed(audio, t0, t1)
        with self.lock:
            if sess is not self.live:  # a newer session started while we transcribed
                return
            voice_id, confidence, provisional = self._identify(vec, t0, t1)
            m = Message(
                id=short_id("m"),  # unique across sessions: late LLM results can't hit a new message
                voice_id=voice_id,
                text=text,
                t_start=t0,
                t_end=t1,
                confidence=confidence,
                provisional=provisional,
                fixes=fixes,
                level_db=levels.clip_db(clip),
                vec=vec,
            )
            self.messages[m.id] = m
            out = m.to_json()
            prev_id = next(reversed(list(self.messages)[:-1]), None)
        self.bus.emit("message.created", out)
        if prev_id is not None:
            self._separate_from_next(audio, prev_id, t0)
        if unsure:
            self.cleanup_q.put(m.id)

    def _separate_from_next(self, audio: np.ndarray, prev_id: str, next_start: float) -> None:
        """The previous line's voiceprint was taken before we knew this line would follow.
        Rescore it on audio that stops where this line starts, so its tail isn't this speaker."""
        with self.lock:
            prev = self.messages.get(prev_id)
            if prev is None or prev.pinned or self.matcher is None:
                return
            if next_start - prev.t_end > self.matcher.pad_to:
                return
            end = min(prev.t_end, next_start)
            # The cutter keeps ~200 ms after the last speech frame; that is where a quick reply sits.
            if next_start - prev.t_end < 0.5 and end - prev.t_start > 0.7:
                end -= 0.2
            start = prev.t_start
            if end - start < 0.5:
                return
        vec = self._embed(audio, start, end)
        if vec is None:
            return
        with self.lock:
            prev = self.messages.get(prev_id)
            if prev is None or prev.pinned or not self.matcher.names:
                return
            scores = self.matcher.scores(vec)
            best = int(np.argmax(scores))
            score = float(scores[best])
            names = self.matcher.names
            current = float(scores[names.index(prev.voice_id)]) if prev.voice_id in names else -1.0
            # A near tie stays: the same person, heard a little differently, is not a new speaker.
            if score < self.matcher.unknown_below or score - current < 0.1:
                return
            pick = self._character_tiebreak(scores, names[best], prev.voice_id)
            if pick == prev.voice_id:
                return
            prev.vec = vec
            dur = prev.t_end - prev.t_start
            old = self.voices.get(prev.voice_id)
            if old is not None:
                old.seconds = max(0.0, old.seconds - dur)
            new = self.voices.get(pick)
            if new is not None:
                new.seconds += dur
                new.spans.append((prev.t_start, prev.t_end))
            prev.voice_id = pick
            prev.confidence = score
            prev.provisional = score < PROVISIONAL_BELOW
            patch = {
                "id": prev.id,
                "voice_id": pick,
                "confidence": round(score, 3),
                "provisional": prev.provisional,
            }
        self._emit_patches([patch])

    def _cleanup_loop(self) -> None:
        """Settles names only context can decide ("Dallara": Elara or Delara?) a few seconds
        behind the transcript, in small batches."""
        while True:
            batch = [self.cleanup_q.get()]
            deadline = time.monotonic() + CLEANUP_GATHER_S
            while len(batch) < CLEANUP_BATCH and (left := deadline - time.monotonic()) > 0:
                try:
                    batch.append(self.cleanup_q.get(timeout=left))
                except queue.Empty:
                    break
            try:
                self._cleanup(batch)
            except Exception:  # the LLM is down or confused: the line keeps Whisper's spelling
                log.exception("spelling cleanup failed")
            finally:
                for _ in batch:
                    self.cleanup_q.task_done()  # a campaign switch waits for these

    def _cleanup(self, batch: list[str]) -> None:
        speller = self.speller(live=True)
        if speller is None:
            return
        with self.lock:
            order = list(self.messages)
            targets = []
            for mid in batch:
                m = self.messages.get(mid)
                cands = [c for c in speller.find(m.text) if not c.sure] if m else []
                if cands:
                    targets.append((m.id, self._speaker_name(m), m.text, cands))
            if not targets:
                return
            first = order.index(targets[0][0])
            asked = {t[0] for t in targets}
            context = [
                (self.messages[j].id, self._speaker_name(self.messages[j]), self.messages[j].text)
                for j in order[max(0, first - CLEANUP_CONTEXT) : first]
                if j not in asked
            ]
        picked = cleanup.ask(self.cleanup_llm.json, speller, context, targets)
        patches, learned = [], []
        with self.lock:
            for mid, _, text, cands in targets:
                m = self.messages.get(mid)
                if m is None or m.text != text:  # changed meanwhile: the answer no longer fits
                    continue
                edits = [(c.start, c.end, picked[(mid, c.start)]) for c in cands if (mid, c.start) in picked]
                if not edits:
                    continue
                learned += [(text[s:e], name) for s, e, name in edits]
                m.text, m.fixes = cleanup.apply(m.text, m.fixes, edits)
                patches.append({"id": m.id, "text": m.text, "fixes": m.fixes})
        self._emit_patches(patches)
        self.learn(learned, speller)

    def learn(self, learned: list[tuple[str, str]], speller: cleanup.Speller, learner: cleanup.Learner | None = None) -> None:
        """A spelling the LLM keeps resolving the same way becomes a heard-as suggestion."""
        if self.vault is None:
            return
        changed = False
        for heard, name in learned:
            if not (learner or self._learner).note(heard, name) or name not in speller.glossary:
                continue
            try:
                e = self.vault.get(name)
                taken = {h.casefold() for h in (*e.heard_as_suggested, *e.heard_as_rejected)}
                if self.vault.find(heard) is not None or heard.casefold() in taken:
                    continue
                self.vault.update(e.name, heard_as_suggested=[*e.heard_as_suggested, heard])
                changed = True
            except (KeyError, ValueError, OSError):
                continue
        if changed:
            self.bus.emit("campaign.updated", {})
