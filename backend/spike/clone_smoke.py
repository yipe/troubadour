"""Voice-clone smoke test with the real models and a synthetic voice (macOS `say`); no real players.

    uv run spike/clone_smoke.py [out_dir]

Builds a clone from a 20 s "Train clip" made with `say` (48 kHz, plus room noise), then reads a short
session page in it. Prints timings and likeness (cosine to the clip's own voiceprint, the speaker-ID
model's view), and a different `say` voice's likeness for scale. Writes WAVs to out_dir; plays nothing.
"""

import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import soxr
import torch
from pyannote.audio import Pipeline

from troubadour import config, tts
from troubadour.audio import read_wav
from troubadour.memory import Job
from troubadour.voices import embed_span, speech_spans

TRAIN_TEXT = (
    "The bridge is out, so you will have to wade across the river. The water is cold and fast, and "
    "something large moves beneath the surface. Roll me a strength saving throw, please. Fourteen? "
    "You make it across, soaked to the bone, and the lantern on the far bank flickers out."
)
PAGE = """---
type: session
session_id: 2026-01-01_120000-abcd
---
# The Drowned Bridge

The party crossed the drowned bridge and found the shrine of the river god.

## Still open
- Who lit the lantern on the far bank?

## What happened
- [[Marla]] bargained with a [[Sahuagin|sahuagin]] priest for safe passage.
- The dwarf lost his favorite axe in the mud.

## Mentioned
[[Marla]], [[Sahuagin]]
"""


def say(voice: str, text: str, path: Path, rate: int = 48000) -> tuple[np.ndarray, int]:
    aiff = path.with_suffix(".aiff")
    subprocess.run(["say", "-v", voice, "-o", str(aiff), text], check=True)
    subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI24@{rate}", str(aiff), str(path)], check=True)
    return read_wav(path)


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="clone-smoke-"))
    out.mkdir(parents=True, exist_ok=True)
    clip, rate = say("Daniel", TRAIN_TEXT, out / "train.wav")
    rng = np.random.default_rng(0)
    clip = (clip + 0.01 * rng.standard_normal(len(clip))).astype(np.float32)  # a quiet room's hiss
    clip16 = soxr.resample(clip, rate, config.SR).astype(np.float32)
    spans = speech_spans(clip16)

    pipeline = Pipeline.from_pretrained(config.DIARIZER)
    pipeline.to(torch.device("mps"))
    embedder = pipeline._embedding
    target = embed_span(embedder, clip16, 0, len(clip16) / config.SR)

    def likeness(audio: np.ndarray, sr: int) -> float:
        x = soxr.resample(audio, sr, config.SR).astype(np.float32)
        return float(target @ embed_span(embedder, x, 0, len(x) / config.SR))

    other, other_rate = say("Samantha", tts.PREVIEW, out / "other.wav")
    print(f"another voice's likeness, for scale: {likeness(other, other_rate):.3f}")

    clones = tts.Clones(lambda: out / "clones", allowed=lambda pid: True)
    job = Job(id="smoke", kind="clone", title="")
    job.on_change = lambda: print(f"  {job.done}/{job.total} {job.message}")
    t = time.time()
    status = clones.build(job, "psmoke", [("Train recording", tts.speech_only(clip, rate, spans), rate)], likeness)
    print(f"build: {time.time() - t:.1f}s {status}")

    job = Job(id="smoke", kind="read", title="")
    t = time.time()
    clip_meta = clones.speak(job, "psmoke", tts.speakable(PAGE), "read", "The Drowned Bridge", {})
    took = time.time() - t
    print(f"read: {took:.1f}s for {clip_meta['seconds']}s of audio ({job.total} chunks)")
    audio, sr = read_wav(clones.file("psmoke", clip_meta["id"]))
    print(f"read likeness: {likeness(audio, sr):.3f}")
    print(f"text read: {tts.speakable(PAGE)!r}")
    print(f"files in {out}")


if __name__ == "__main__":
    main()
