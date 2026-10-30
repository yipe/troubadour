"""Shared fixtures. Tests never load real models or touch backend/data.

A fake speaker embedder stands in for pyannote: its "voiceprint" is the pooled
magnitude spectrum, so sine tones at different pitches act as different
speakers (cosine ≈ 0) and the same pitch as the same speaker (cosine ≈ 1).
"""

import os
import tempfile
from pathlib import Path

# Must happen before anything imports troubadour.core.config (server/app.py builds an Engine at import).
_TMP = Path(tempfile.mkdtemp(prefix="troubadour-tests-"))
os.environ["TROUBADOUR_DATA"] = str(_TMP / "data")
os.environ["TROUBADOUR_SAMPLES"] = str(_TMP / "samples")
os.environ["TROUBADOUR_OBSIDIAN_REGISTRY"] = str(_TMP / "obsidian.json")  # never this Mac's Obsidian vaults
(_TMP / "samples").mkdir()

import numpy as np  # noqa: E402
import pytest  # noqa: E402
from troubadour.core import config  # noqa: E402
from troubadour.engine import Bus, Engine, LiveSession  # noqa: E402
from troubadour.sound.audio import wav_bytes  # noqa: E402
from troubadour.sound.voices import VoiceMatcher  # noqa: E402

SR = config.SR


class FakeEmbedder:
    dimension = 256

    def __call__(self, batch):
        x = batch[:, 0].numpy()
        spec = np.abs(np.fft.rfft(x, axis=1))
        bins = np.array_split(np.arange(spec.shape[1]), self.dimension)
        return np.stack([spec[:, b].sum(axis=1) for b in bins], axis=1) + 1e-6


def tone(freq: float, seconds: float) -> np.ndarray:
    t = np.arange(int(seconds * SR)) / SR
    return (0.3 * np.sin(2 * np.pi * freq * t)).astype(np.float32)


class RecordingBus(Bus):
    def __init__(self):
        super().__init__()
        self.events: list[tuple[str, object]] = []

    def emit(self, type_, data):
        self.events.append((type_, data))

    def of(self, type_: str) -> list:
        return [d for t, d in self.events if t == type_]


class NullSource:
    def __init__(self):
        self.stopped = False
        self.paused = False

    def start(self, sink, on_end):
        pass

    def pause(self):
        self.paused = True

    def resume(self):
        self.paused = False

    def stop(self):
        self.stopped = True


@pytest.fixture
def dirs(tmp_path, monkeypatch):
    data, samples = tmp_path / "data", tmp_path / "samples"
    samples.mkdir()
    monkeypatch.setattr(config, "DATA_DIR", data)
    monkeypatch.setattr(config, "SAMPLES_DIR", samples)
    return data, samples


@pytest.fixture
def engine(dirs, monkeypatch):
    """An Engine with the fake embedder, models 'loaded', and a live session whose buffer tests fill."""
    bus = RecordingBus()
    eng = Engine(bus)
    eng.embedder = FakeEmbedder()
    eng.matcher = VoiceMatcher(eng.embedder)
    eng.ready.set()
    sess = LiveSession(NullSource(), {"kind": "file", "name": "x.wav", "speed": 1.0})
    eng.live, eng.buffer, eng.status = sess, sess.buffer, "running"
    monkeypatch.setattr("troubadour.sound.asr.transcribe", lambda audio: "I deal 12 slashing damage")
    monkeypatch.setattr(config, "ASR_PROMPT", False)  # tests that want the Whisper prompt turn it on

    def no_network(*a, **k):
        raise ConnectionError("tests never call the real LLM; patch engine.cleanup_llm.json")

    monkeypatch.setattr(eng.cleanup_llm, "json", no_network)
    return eng


def speak(eng: Engine, freq: float, seconds: float, gap: float = 0.3) -> tuple[float, float]:
    """Append a 'speaker' (tone) to the live session audio; returns its (t0, t1)."""
    buf = eng.live.buffer
    if gap:
        buf.append(np.zeros(int(gap * SR), np.float32))
    t0 = buf.n / SR
    buf.append(tone(freq, seconds))
    return t0, buf.n / SR


def write_wav(path: Path, audio: np.ndarray) -> Path:
    path.write_bytes(wav_bytes(audio))
    return path


@pytest.fixture(autouse=True)
def hermetic_dnd_terms(tmp_path, monkeypatch):
    """Tests use the built-in D&D names, never a local list in data/dnd_terms.json."""
    monkeypatch.setattr("troubadour.lore.dnd_terms.generated_path", lambda: tmp_path / "no-dnd-terms.json")


# ------------------------------------------------------------- voice clones (tts.py, talk.py, cloning.py)


class FakeSynth:
    """Chatterbox stand-in. A reading is `cps` characters per second, filled with the reference's mean
    level so a test's likeness can tell which reference made it. `bad` readings come back first,
    0.1 s long (cut short). Records what it said and how much audio it cleaned."""

    def __init__(self, cps: float = 14.0, bad: int = 0):
        self.cps, self.bad = cps, bad
        self.said: list[str] = []
        self.denoised: list[float] = []
        self.on_speak = lambda: None

    def denoise(self, audio, rate):
        self.denoised.append(len(audio) / rate)
        return audio * 0.5, rate  # quieter; the reference is peak-normalized again after

    def voice(self, audio, rate):
        return float(np.abs(audio).mean())

    def speak(self, text, voice):
        from troubadour.sound.tts import OUT_SR

        self.said.append(text)
        self.on_speak()
        if self.bad:
            self.bad -= 1
            return np.full(int(0.1 * OUT_SR), voice, np.float32)
        return np.full(int(len(text) / self.cps * OUT_SR), voice, np.float32)


class ScriptedLLM:
    """The memory LLM, answering from a script in order (an Exception in it is raised); records prompts."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.prompts: list[str] = []

    def json(self, system, user, schema, max_tokens=4000):
        self.prompts.append(user)
        reply = self.replies.pop(0) if self.replies else ConnectionError("the script ran out")
        if isinstance(reply, Exception):
            raise reply
        return reply


def job():
    """A campaign job outside the job thread (progress updates go nowhere)."""
    from troubadour.lore.memory import Job

    return Job(id="test", kind="clone", title="")


@pytest.fixture
def fake_vad(monkeypatch):
    """Silero would hear no speech in a test tone: the whole clip is speech."""
    import silero_vad

    monkeypatch.setattr(silero_vad, "get_speech_timestamps", lambda a, m, sampling_rate: [{"start": 0, "end": len(a)}])
