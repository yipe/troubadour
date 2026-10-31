"""One listening run: its own audio, queues and threads."""

import queue
import subprocess
import time
import uuid

import numpy as np
from troubadour.core import config
from troubadour.sound import levels
from troubadour.sound.audio import Recorder
from troubadour.sound.voices import VoiceMatcher

from .buffers import AudioBuffer
from .model import Voice
from .notebook import Notebook
from .state import MAIN_CAMPAIGN

STOP = object()


class LiveSession:
    """One listening run: its own audio, queues, and threads. Starting a new
    session abandons the old one; abandoned threads exit without side effects."""

    def __init__(
        self,
        source,
        desc: dict,
        campaign: str = MAIN_CAMPAIGN,
        *,
        title: str = "",
        present_player_ids: list[str] | None = None,
        record_audio: bool | None = None,
        cleanup: bool | None = None,
    ):
        self.campaign = campaign  # saved in meta.json: History lists only the open campaign's sessions
        self.title = title  # the working title; the write-up's title replaces it once written
        self.present_player_ids = present_player_ids or []  # empty: everyone seated is assumed present
        # Per-session choices; None means the process-wide setting at the time the session starts.
        self.record_audio = config.RECORD_AUDIO if record_audio is None else record_audio
        self.cleanup = config.CLEANUP if cleanup is None else cleanup
        # Voiceprints of absent players, taken out of the matcher for this session and put back after.
        self.absent_vecs: dict[str, np.ndarray] = {}
        self.source = source
        self.desc = desc
        self.started_at = time.time()
        self.id = time.strftime("%Y-%m-%d_%H%M%S", time.localtime(self.started_at)) + "-" + uuid.uuid4().hex[:4]
        self.buffer = AudioBuffer()
        self.frames_q: queue.Queue = queue.Queue()
        self.utt_q: queue.Queue = queue.Queue()
        self.abandoned = False
        self.notebook_loop = None  # NotebookLoop, set by the engine; stop waits for its pass in flight
        self.notebook = Notebook(self.id)  # the engine wires its emit and is-live check when the session starts
        self.paused = False  # source is held; the segmenter must not treat the silence as a dead mic
        self.awake: subprocess.Popen | None = None  # sleep assertion while listening
        self.recorder: Recorder | None = None  # mic sessions: audio.wav in the session folder
        self.native_rate: int | None = None  # mic sessions: the mic's own rate, which the tap delivers
        self.meter: levels.LevelMeter | None = None  # live level + quality for the UI

    def leave_out_absent(self, matcher: VoiceMatcher | None, voices: dict[str, Voice]) -> None:
        """Take the voices of players who aren't at the table out of speaker matching (engine lock held).
        Unnamed voices and voices named later behave as before. restore_absent puts them back."""
        if not self.present_player_ids or matcher is None:
            return
        for vid in list(matcher.names):
            voice = voices.get(vid)
            if voice is not None and voice.player_id is not None and voice.player_id not in self.present_player_ids:
                vec = matcher.remove(vid)
                if vec is not None:
                    self.absent_vecs[vid] = vec

    def restore_absent(self, matcher: VoiceMatcher | None) -> None:
        """Engine lock held."""
        if matcher is not None:
            for vid, vec in self.absent_vecs.items():
                matcher.add(vid, vec)  # merges if the voice was trained again meanwhile
        self.absent_vecs = {}

    def release(self) -> None:
        if self.awake is not None:
            self.awake.terminate()
            self.awake = None
        if self.recorder is not None:
            self.recorder.close()
        if self.meter is not None:
            self.meter.stop()
            self.meter = None

    def abandon(self) -> None:
        self.abandoned = True
        self.source.stop()
        self.release()
        self.frames_q.put(STOP)
        self.utt_q.put(STOP)
