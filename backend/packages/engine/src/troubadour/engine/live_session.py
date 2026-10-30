"""One listening run: its own audio, queues and threads."""

import queue
import subprocess
import time
import uuid

from troubadour.sound import levels
from troubadour.sound.audio import Recorder

from .buffers import AudioBuffer
from .state import MAIN_CAMPAIGN

STOP = object()


class LiveSession:
    """One listening run: its own audio, queues, and threads. Starting a new
    session abandons the old one; abandoned threads exit without side effects."""

    def __init__(self, source, desc: dict, campaign: str = MAIN_CAMPAIGN):
        self.campaign = campaign  # saved in meta.json: History lists only the open campaign's sessions
        self.source = source
        self.desc = desc
        self.started_at = time.time()
        self.id = time.strftime("%Y-%m-%d_%H%M%S", time.localtime(self.started_at)) + "-" + uuid.uuid4().hex[:4]
        self.buffer = AudioBuffer()
        self.frames_q: queue.Queue = queue.Queue()
        self.utt_q: queue.Queue = queue.Queue()
        self.abandoned = False
        self.paused = False  # source is held; the segmenter must not treat the silence as a dead mic
        self.awake: subprocess.Popen | None = None  # sleep assertion while listening
        self.recorder: Recorder | None = None  # mic sessions: audio.wav in the session folder
        self.native_rate: int | None = None  # mic sessions: the mic's own rate, which the tap delivers
        self.meter: levels.LevelMeter | None = None  # live level + quality for the UI

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
