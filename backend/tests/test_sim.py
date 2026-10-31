"""troubadour-sim: the entry point runs against a tiny saved session with a stub engine."""

import json
import threading
from types import SimpleNamespace

import numpy as np
from conftest import tone, write_wav
from troubadour.core import config
from troubadour.core.transcript import build
from troubadour.engine import sim

SID = "2026-10-08_193401-eebf"


def record(sid):
    meta = {"id": sid, "started_at": 0.0, "source": None, "duration_s": 1.0, "campaign": "main"}
    line = {"id": "m1", "t_start": 0.0, "t_end": 1.0, "voice_id": None, "provisional": False, "confidence": 0.9, "text": "hello"}
    return build(meta, [], [], [line])


class StubEngine:
    campaigns = {"main": object()}
    load_error = None
    status = "idle"
    messages = [1]
    buffer = SimpleNamespace(n=0)
    cleanup_q = SimpleNamespace(unfinished_tasks=0)

    def __init__(self, bus):
        self.ready = threading.Event()
        self.ready.set()
        self.started = None
        self.live = SimpleNamespace(source=SimpleNamespace(audio=np.zeros(config.SR, np.float32)))

    def open_campaign(self, cid):
        pass

    def start_background(self):
        pass

    def start(self, source):
        self.started = source

    def _refine(self):
        pass

    def transcript_record(self):
        return record("rerun")


def test_main_replays_a_saved_session_and_writes_a_sim_run(dirs, monkeypatch):
    data, _ = dirs
    folder = data / "sessions" / SID
    (folder / "setup").mkdir(parents=True)
    write_wav(folder / "audio.wav", tone(220, 1.0))
    (folder / "transcript.json").write_text(json.dumps(record(SID)))
    (folder / "setup" / "end.json").write_text("{}")
    monkeypatch.setattr(sim, "Engine", StubEngine)
    monkeypatch.setattr(sim.time, "sleep", lambda s: None)
    monkeypatch.setattr(sim.audio.FileSource, "MAX_SPEED", sim.audio.FileSource.MAX_SPEED)  # restored after main raises it
    sim.main([SID, "--speed", "2"])
    (run,) = (folder / "sims").iterdir()
    assert json.loads((run / "transcript.json").read_text())["session"]["sim"] == {"of": SID, "setup": "end"}
    assert json.loads((run / "compare.json").read_text())["lines"] == {"original": 1, "rerun": 1}
