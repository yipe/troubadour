"""Training a player's voice from their own mic or the running session, and the clone support that reads a training clip.

TrainingMixin holds no state: everything lives on `Engine`, created in `Engine.__init__`.
Reads, or mutates in place: `self._start_lock`, `self.bench`, `self.bus`, `self.embed_lock`, `self.embedder`, `self.live`, `self.load_error`, `self.lock`, `self.matcher`, `self.players`, `self.refine_now`, `self.status`, `self.voices`.
Assigns: `self.train_job`.
Locking: `self.lock` guards `train_job`, voices and the matcher; capture and VAD run outside it. Cancelling sets the job's own flags.
"""

import logging
import threading
import time

import numpy as np
from troubadour.core import config
from troubadour.sound.audio import MicSource, read_wav, wav_bytes
from troubadour.sound.voices import centroid, speech_spans

from .model import SR, Voice, short_id

log = logging.getLogger("troubadour")

TRAIN_MIN_SPEECH_S = 4.0


class TrainJob:
    def __init__(self, player_id: str, seconds: float, from_session: bool, native_rate: int | None = None):
        self.player_id = player_id
        self.seconds = seconds
        self.from_session = from_session  # True: fed by the running session's segmenter; False: own mic
        self.frames: list[np.ndarray] = []  # 16 kHz: the voiceprint and the sample
        # The same speech at the mic's own rate (usually 48 kHz), kept losslessly as the voice-clone
        # reference. None when the audio comes from a file replay: there is nothing better than 16 kHz.
        self.native_rate = native_rate
        self.native: list[np.ndarray] = []
        self.done = threading.Event()
        self.cancelled = False

    @property
    def captured_s(self) -> float:
        return sum(len(f) for f in self.frames) / SR

    def feed(self, frame: np.ndarray) -> None:
        if not self.done.is_set():
            self.frames.append(frame)
            if self.captured_s >= self.seconds:
                self.done.set()

    def feed_native(self, block: np.ndarray) -> None:
        """From the audio callback: keep it cheap. Stops with the 16 kHz capture (`done`)."""
        if self.native_rate is not None and not self.done.is_set():
            self.native.append(block)

    def cancel(self) -> None:
        self.cancelled = True
        self.done.set()


class TrainingMixin:
    def train(self, pid: str, seconds: float = 20.0) -> None:
        self._require_models()
        # _start_lock: a campaign switch or bench (which check for training under it) can't
        # slip in between and leave this job training someone who's no longer seated.
        with self._start_lock, self.lock:
            if pid not in self.players:
                raise KeyError(pid)
            if self.train_job is not None:
                raise ValueError("Already training someone; finish or cancel that first.")
            from_session = self.status == "running"
            native_rate = self.live.native_rate if from_session and self.live is not None else None
            job = TrainJob(pid, max(5.0, min(float(seconds), 60.0)), from_session, native_rate)
            self.train_job = job
        self._emit_session()
        threading.Thread(target=self._train_run, args=(job,), name="train", daemon=True).start()

    def cancel_training(self) -> None:
        with self.lock:
            job = self.train_job
        if job is not None:
            job.cancel()

    def _train_status(self, job: TrainJob, state: str, message: str | None = None) -> None:
        recent = job.frames[-8:]
        level = float(min(1.0, np.sqrt(np.mean(np.concatenate(recent) ** 2)) * 8)) if recent else 0.0
        self.bus.emit(
            "train.status",
            {
                "player_id": job.player_id,
                "state": state,
                "seconds_left": round(max(0.0, job.seconds - job.captured_s), 1) if state == "recording" else 0,
                "level": round(level, 3) if state == "recording" else 0,
                "message": message,
            },
        )

    def _train_run(self, job: TrainJob) -> None:
        own_mic = None
        try:
            if not self._wait_ready():
                raise RuntimeError(self.load_error or "models unavailable")
            if not job.from_session:  # no session running: open the default mic just for this
                own_mic = MicSource()
                job.native_rate = own_mic.native_rate()
                own_mic.tap = job.feed_native
                own_mic.start(job.feed, lambda: None)
            deadline = time.monotonic() + job.seconds * 3 + 5
            while not job.done.wait(0.25):
                self._train_status(job, "recording")
                if job.from_session and self.status == "paused":
                    deadline += 0.25  # wall time spent paused is not "no audio arrived"
                    continue
                if job.from_session and self.status != "running":
                    raise RuntimeError("The session stopped before training finished.")
                if time.monotonic() > deadline:
                    raise RuntimeError("No audio arrived; is the mic working?")
            if own_mic:
                own_mic.stop()
                own_mic = None
            if job.cancelled:
                self._train_status(job, "cancelled")
                return
            self._train_status(job, "processing")
            message = self._finish_training(job)
            self._train_status(job, "done", message)
        except Exception as e:
            log.warning("training failed: %s", e)
            self._train_status(job, "error", str(e))
        finally:
            if own_mic:
                own_mic.stop()
            with self.lock:
                if self.train_job is job:
                    self.train_job = None
            self._emit_session()

    def _finish_training(self, job: TrainJob) -> str:
        audio = np.concatenate(job.frames)
        spans = speech_spans(audio)
        speech = sum(e - s for s, e in spans)
        if speech < TRAIN_MIN_SPEECH_S:
            raise ValueError(f"Only heard {speech:.0f}s of speech. Try again, a bit louder or closer.")
        with self.embed_lock:
            vec = centroid(self.embedder, audio, spans)
        if vec is None:
            raise ValueError("Couldn't get a voiceprint from that recording.")
        with self.lock:
            p = self.players.get(job.player_id)
            if p is None:
                raise ValueError("That player was deleted.")
            target = next(
                (v for v in self.voices.values() if v.status == "named" and v.player_id == p.id and v.character is None),
                None,
            )
            if target is None:
                target = Voice(id=short_id("v"), label=None, status="named", player_id=p.id)
                self._surface(target)
                self.voices[target.id] = target
            self.matcher.add(target.id, vec)  # merges if the voice already exists
            target.sample_audio = audio
            target.sample_rev += 1
            target.seconds += speech
            target.trained = p.trained = True
            self.bus.emit("voice.upserted", target.to_json())
            self.bus.emit("player.upserted", p.to_json())
            self._refresh_suggestions()
            path = self._voice_audio_path(target.id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(wav_bytes(audio))  # voice samples survive restarts
        hq = self._voice_hq_path(target.id)
        if job.native:
            hq.write_bytes(wav_bytes(np.concatenate(job.native), job.native_rate, bits=24))
        else:  # a Train clip from a file replay: an older full-quality clip would no longer match it
            hq.unlink(missing_ok=True)
        self._save_state()
        self.refine_now.set()
        return f"Heard {speech:.0f}s of speech."

    def clone_allowed(self, pid: str) -> bool:
        with self.lock:
            p = self.players.get(pid) or self.bench.get(pid)
            return bool(p and p.clone_ok)

    def check_clone(self, pid: str, needs_idle: bool = True) -> str:
        """The player's name if a voice-clone job for them may start now; ValueError says why not.
        needs_idle: it runs the voice model, which a live session's transcription must not wait on."""
        with self.lock:
            p = self.players.get(pid)
            if p is None:
                raise KeyError(pid)
            if not p.clone_ok:
                raise ValueError(f"Turn on the voice clone for {p.name} first (they agree to it).")
            if needs_idle:
                if not config.VOICE_CLONES:
                    raise ValueError("Voice clones need a Mac with Apple Silicon. The speech profile works here.")
                self._require_idle("using the voice clone")
            return p.name

    def _train_voice(self, pid: str) -> Voice | None:
        """Their own voice with a Train recording (lock held)."""
        return next(
            (
                v
                for v in self.voices.values()
                if v.status == "named" and v.player_id == pid and v.character is None and v.sample_audio is not None
            ),
            None,
        )

    def has_train_clip(self, pid: str) -> bool:
        with self.lock:
            return self._train_voice(pid) is not None

    def train_clip(self, pid: str) -> tuple[np.ndarray, int, list[tuple[float, float]]]:
        """(audio, rate, speech spans in seconds) of their Train clip: the lossless own-rate copy when
        there is one. The spans come from the 16 kHz copy (Silero's rate); both hold the same seconds."""
        with self.lock:
            v = self._train_voice(pid)
            if v is None:
                raise ValueError("Train them first: the voice clone copies the Train recording.")
            audio, hq = v.sample_audio, self._voice_hq_path(v.id)
        spans = speech_spans(audio)
        if hq.is_file():
            native, rate = read_wav(hq)
            return native, rate, spans
        return audio, SR, spans

    def train_voiceprint(self, pid: str) -> np.ndarray | None:
        """Their own (Train) voice's voiceprint, as the matcher has it now."""
        with self.lock:
            v = self._train_voice(pid)
            if v is None or self.matcher is None or v.id not in self.matcher.names:
                return None
            return self.matcher.vector(v.id).copy()
