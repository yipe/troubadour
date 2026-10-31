"""The Engine: construction, model loading, shutdown, mic test, session quality and LLM health.

The behaviour lives in the mixins; `Engine.__init__` creates all of their state."""

import json
import logging
import os
import queue
import threading
import time

import numpy as np
from troubadour.core import config
from troubadour.core.fsutil import write_atomic
from troubadour.lore import cleanup
from troubadour.lore.campaign import Vault
from troubadour.lore.memory import MemoryLLM
from troubadour.sound import asr, levels, tts
from troubadour.sound.audio import MicSource, list_mics, load_audio
from troubadour.sound.voices import (
    VoiceMatcher,
    embed_span,
    torch_device,
)

from ._library import LibraryMixin
from ._pipeline import PipelineMixin
from ._sessions import SessionsMixin
from ._training import TrainingMixin, TrainJob
from ._voices import VoicesMixin
from .buffers import AudioBuffer
from .bus import Bus
from .live_session import LiveSession
from .model import SR, Message, Player, Voice
from .paths import session_audio
from .state import MAIN_CAMPAIGN, Campaign

log = logging.getLogger("troubadour")

IDLE_POLL_S = 2.0  # a background job held by a live session checks this often whether it's over
LLM_HEALTH_EVERY_S = 30.0


class Engine(SessionsMixin, LibraryMixin, VoicesMixin, PipelineMixin, TrainingMixin):
    def __init__(self, bus: Bus):
        self.bus = bus
        self.lock = threading.RLock()
        self.embed_lock = threading.Lock()  # torch MPS isn't safe across threads
        self._save_lock = threading.Lock()
        self._transcript_lock = threading.Lock()
        self._saved_signature: tuple | None = None
        self._start_lock = threading.Lock()  # serializes start/stop so sources can't leak
        # The open campaign's players (seated); everyone else in the library waits on the bench.
        self.players: dict[str, Player] = {}
        self.bench: dict[str, Player] = {}
        self.campaigns: dict[str, Campaign] = {MAIN_CAMPAIGN: Campaign(MAIN_CAMPAIGN, "My campaign")}
        self.campaign = MAIN_CAMPAIGN
        # Named voices the open campaign uses (and this session's pending ones). The rest (benched
        # people's, other campaigns' characters) are parked with their voiceprints, out of the matcher.
        self.voices: dict[str, Voice] = {}
        self.parked: dict[str, Voice] = {}
        self._parked_vecs: dict[str, np.ndarray] = {}
        self.messages: dict[str, Message] = {}
        self.status = "idle"
        self.source_desc: dict | None = None
        self.live: LiveSession | None = None
        self.buffer = AudioBuffer()  # current session's audio (for t and voice samples)
        self.audio_monitor = True  # live level + quality while a mic session runs; the UI can switch it off
        self.refine_now = threading.Event()
        self.train_job: TrainJob | None = None
        self.ready = threading.Event()
        self.load_error: str | None = None
        self.embedder = None
        self.matcher: VoiceMatcher | None = None
        self.cleanup_llm = MemoryLLM(model=config.LLM_MODEL, timeout=60)
        self.llm_ok = False
        self._next_label = 1
        self._persisted_vecs: dict[str, np.ndarray] = {}  # voiceprints from state.json until the matcher exists
        self.vault: Vault | None = None  # campaign.Vault (set by the server): its glossary corrects new lines
        self.clones = tts.Clones(lambda: config.DATA_DIR / "clones", allowed=self.clone_allowed, wait_idle=self.wait_idle)
        self._glossary: tuple = ((), 0.0, None, [], [])  # (signature, checked, fixer, names, entries)
        self._spell: tuple = (None, None)  # (key, Speller): rebuilt when the glossary or Setup changes
        self.cleanup_q: queue.Queue = queue.Queue()  # lines with names only the LLM can settle
        self._learner = cleanup.Learner()
        self._mic_test: tuple | None = None  # (source, meter, timer) while Setup's mic test runs
        self._load_state()

    def start_background(self) -> None:
        loops = (
            (self._load_models, "load-models"),
            (self._llm_health_loop, "llm"),
            (self._refine_loop, "refine"),
            (self._cleanup_loop, "cleanup"),
        )
        for target, name in loops:
            threading.Thread(target=target, name=name, daemon=True).start()

    def _load_models(self) -> None:
        if config.env("MODELS", "1") == "0":
            # Scratch servers run many at once; loading Whisper and the embedder in each would swamp the Mac.
            log.info("TROUBADOUR_MODELS=0: not loading Whisper, the speaker embedder or the VAD; asr.state stays 'loading'")
            return
        if os.environ.get("HUGGING_FACE_TOKEN") and not os.environ.get("HF_TOKEN"):
            os.environ["HF_TOKEN"] = os.environ["HUGGING_FACE_TOKEN"]
        t0 = time.perf_counter()
        try:
            import torch
            from pyannote.audio import Pipeline
            from silero_vad import load_silero_vad

            pipeline = Pipeline.from_pretrained(config.DIARIZER)
            pipeline.to(torch.device(torch_device()))
            self.embedder = pipeline._embedding
            load_silero_vad()  # warm the download/cache; each session loads its own instance
            asr.warm_up()
        except Exception as e:
            log.exception("model load failed")
            self.load_error = (
                f"Models failed to load ({type(e).__name__}: {e}). Check HF_TOKEN has access to {config.DIARIZER}, then restart."
            )
            self.bus.emit("error", {"message": self.load_error})
            self._emit_session()
            return
        with self.lock:
            self.matcher = VoiceMatcher(self.embedder)
            for vid, vec in self._persisted_vecs.items():
                if vid in self.voices and self.voices[vid].status == "named":
                    self.matcher.add(vid, vec)
            self._persisted_vecs.clear()
        self.ready.set()
        self.llm_ok = self.cleanup_llm.healthy()
        log.info(
            "models ready in %.1fs; llm %s at %s ok=%s",
            time.perf_counter() - t0,
            self.cleanup_llm.model,
            self.cleanup_llm.url,
            self.llm_ok,
        )
        self._emit_session()

    def _wait_ready(self, sess: LiveSession | None = None) -> bool:
        """Block until models are loaded; False if loading failed or the session was abandoned."""
        while not self.ready.wait(0.5):
            if self.load_error or (sess is not None and sess.abandoned):
                return False
        return True

    def _require_models(self) -> None:
        if self.load_error:
            raise ValueError(self.load_error)

    def shutdown(self) -> None:
        with self._start_lock:
            if self.live is not None:
                self.live.abandon()
        with self.lock:
            job = self.train_job
        if job:
            job.cancel()
        self._save_state()
        self.save_transcript(force=True)

    def mic_test(self, device: str | None, seconds: float = 20.0) -> dict:
        """Listen to the mic for a while without a session: just the level meter and quality
        read-out (nothing is recorded or transcribed), for tuning mic settings."""
        with self._start_lock:
            if self.status != "idle" or self.train_job is not None:
                raise ValueError("Stop the session (or training) first; its own meter shows the mic.")
        # PortAudio matches a name as a substring and an unplugged mic would otherwise fall back
        # to something else; fail with the name instead.
        if device is not None and device not in {m["name"] for m in list_mics()}:
            raise ValueError(f"Couldn't open {device}: it isn't connected.")
        self.stop_mic_test()
        frames: queue.Queue = queue.Queue()
        meter = levels.LevelMeter(self.bus.emit, source="test")
        src = MicSource(device)
        try:
            src.start(frames.put, lambda: None)
        except Exception as e:
            src.stop()
            raise ValueError(f"Couldn't open the microphone: {e}") from e
        timer = threading.Timer(seconds, self.stop_mic_test)
        timer.daemon = True
        self._mic_test = (src, meter, timer, frames)

        def drain() -> None:  # the meter's maths stays off the audio callback
            while self._mic_test is not None and self._mic_test[1] is meter:
                try:
                    meter.feed(frames.get(timeout=0.5))
                except queue.Empty:
                    continue

        threading.Thread(target=drain, name="mic-test", daemon=True).start()
        timer.start()
        out = {"state": "running", "device": device, "seconds": seconds}
        self.bus.emit("mic.test", out)
        return out

    def stop_mic_test(self) -> dict:
        test, self._mic_test = self._mic_test, None
        if test is not None:
            src, meter, timer, _ = test
            timer.cancel()
            src.stop()
            meter.stop()
            self.bus.emit("mic.test", {"state": "stopped"})
        return {"state": "stopped"}

    def session_quality(self, sid: str) -> dict:
        """The quality report of a recorded session (cached next to it until the audio changes)."""
        folder = self.sessions_dir() / sid
        path, end = session_audio(sid)
        st = path.stat()
        key = [str(path), st.st_mtime_ns, st.st_size, end]
        cache = folder / "quality.json"
        try:
            cached = json.loads(cache.read_text())
            if cached.get("key") == key:
                return cached["report"]
        except (OSError, ValueError):
            pass
        record = json.loads((folder / "transcript.json").read_text())
        out = levels.report(load_audio(path, 0.0, end), record["messages"])
        src = record["session"].get("source") or {}
        out["mic"] = src.get("device") or src.get("name") or src.get("kind")
        write_atomic(cache, json.dumps({"key": key, "report": out}))
        return out

    def _quality_quietly(self, sid: str) -> None:
        try:
            self.session_quality(sid)
        except Exception:
            log.exception("couldn't measure the recording's quality")

    def known_names(self) -> list[tuple[str, str, str]]:
        """(name, type, description) for the campaign glossary: Setup's characters and the names
        given to voices in the voices panel."""
        with self.lock:
            out = [(p.character, "pc", f"Played by {p.name}.") for p in self.players.values() if p.character and not p.is_gm]
            for v in self.voices.values():
                if v.status == "named" and v.character and v.player_id in self.players:
                    out.append((v.character, "npc", f"Voiced by {self.players[v.player_id].name}."))
        return out

    def _set_llm_ok(self, ok: bool) -> None:
        if ok != self.llm_ok:
            self.llm_ok = ok
            self._emit_session()

    def recheck_llm(self) -> dict:
        """Probe LM Studio now, instead of waiting for the periodic health loop."""
        try:
            ok = self.cleanup_llm.healthy()
        except Exception as e:
            log.warning("llm health check failed: %s", e)
            ok = False
        self._set_llm_ok(ok)
        return {"url": self.cleanup_llm.url, "model": self.cleanup_llm.model, "ok": self.llm_ok}

    def _llm_health_loop(self) -> None:
        while True:
            try:
                self._set_llm_ok(self.cleanup_llm.healthy())
            except Exception as e:
                log.warning("llm health check failed: %s", e)
                self._set_llm_ok(False)
            time.sleep(LLM_HEALTH_EVERY_S)

    def embed(self, audio: np.ndarray) -> np.ndarray | None:
        """The speaker model's voiceprint of 16 kHz audio (None if too short to trust)."""
        self.wait_for_models()
        with self.embed_lock:
            return embed_span(self.embedder, audio, 0.0, len(audio) / SR)

    def wait_for_models(self) -> None:
        """Block until the speech models are loaded (a job started while the app starts up)."""
        if not self._wait_ready():
            raise RuntimeError(self.load_error or "The speech models didn't load.")

    def wait_idle(self, job) -> None:
        """Hold a background job while a session runs: the session needs Whisper and the GPU more.
        The job says so meanwhile, then gets its own message back."""
        if self.status == "idle":
            return
        before = job.message
        while self.status != "idle":
            job.update(message="Paused while a session runs")
            time.sleep(IDLE_POLL_S)
        job.update(message=before)
