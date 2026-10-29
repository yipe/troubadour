"""What reference makes a closer, cleaner clone? Synthetic voices only (macOS `say`), no players.

    uv run spike/clone_reference.py [out_dir]

Chatterbox takes its voice from three places: the speaker-encoder embedding of the whole reference
(T3), the first 6 s as speech tokens (T3), and the first 10 s as the acoustic prompt plus an x-vector
(S3Gen). One `say` voice reads six different texts; each goes through a simulated table mic (room
reverb, table babble, hiss). Configurations, 3 generations each of one test line:

  first       the first noisy clip as the reference (what one 10 s Train clip gives)
  best        the noisy clip whose clone scores highest, of six (search over references)
  avg         the first clip's prompt, both speaker embeddings averaged over all six clips (~60 s)
  best+avg
  clean       the first clip through DeepFilterNet as the reference
  clean+post  ... and the clone through DeepFilterNet too
  quiet+post  the clean (unprocessed) clip as the reference, the clone through DeepFilterNet: the
              ceiling, what the cleanest possible stretch of someone's speech gives

Likeness: cosine of the clone's WeSpeaker embedding to the voice's clean centroid ("truth") and to
its noisy centroid (what Troubadour can measure: the voiceprint comes from the table mic). Floor:
loud vs quiet frames of the clone, in dB (higher is cleaner).
"""

import subprocess
import sys
import tempfile
import time
from pathlib import Path

import mlx.core as mx
import numpy as np
import soxr
import torch
from mlx_audio.sts.models.deepfilternet.model import DeepFilterNetModel
from mlx_audio.tts.utils import load_model
from pyannote.audio import Pipeline
from scipy.signal import fftconvolve

from troubadour import config
from troubadour.audio import read_wav
from troubadour.voices import embed_span, normalize

VOICE, OTHERS = "Daniel", ["Samantha", "Fred"]
TEXTS = [
    "The bridge is out, so you will have to wade across the river. The water is cold and fast.",
    "I want to check the cargo before we leave. Can I roll investigation on the crates, please?",
    "Something large moves beneath the surface, and the lantern on the far bank flickers out.",
    "Fine, I will bargain with the priest, but if he lies to me again I am taking his boat.",
    "We have three days of food, two torches, and one very angry goat. That is the whole plan.",
    "Roll me a strength saving throw. Fourteen? You make it across, soaked to the bone.",
]
LINE = "Last time, the party crossed the drowned bridge, bargained with a priest, and lost an axe in the mud."
SR16, OUT = 16000, 24000


def say(voice: str, text: str, folder: Path, name: str) -> np.ndarray:
    aiff, wav = folder / f"{name}.aiff", folder / f"{name}.wav"
    subprocess.run(["say", "-v", voice, "-o", str(aiff), text], check=True)
    subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{OUT}", str(aiff), str(wav)], check=True)
    return read_wav(wav)[0]


def room(clean: np.ndarray, babble: list[np.ndarray], seed: int, snr_db: float = 15.0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    t = np.arange(int(0.5 * OUT)) / OUT
    ir = rng.standard_normal(len(t)) * np.exp(-6.9 * t / 0.5)
    ir[0] = 8.0
    wet = fftconvolve(clean, ir)[: len(clean)]
    noise = sum(np.roll(np.resize(b, len(wet)), int(rng.integers(len(wet)))) for b in babble)
    noise = noise / (np.abs(noise).max() + 1e-9) + 0.05 * rng.standard_normal(len(wet))
    mix = wet + noise * np.sqrt(np.mean(wet**2) / np.mean(noise**2)) / 10 ** (snr_db / 20)
    return (0.9 * mix / np.abs(mix).max()).astype(np.float32)


def floor_db(a: np.ndarray) -> float:
    f = a[: len(a) // 480 * 480].reshape(-1, 480)
    rms = np.sqrt((f**2).mean(axis=1)) + 1e-9
    return float(20 * np.log10(np.percentile(rms, 95) / np.percentile(rms, 10)))


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="clone-reference-"))
    out.mkdir(parents=True, exist_ok=True)
    clean = [say(VOICE, t, out, f"clean{i}") for i, t in enumerate(TEXTS)]
    babble = [say(v, " ".join(TEXTS[:3]), out, f"babble-{v}") for v in OTHERS]
    noisy = [room(c, babble, seed=i) for i, c in enumerate(clean)]

    pipeline = Pipeline.from_pretrained(config.DIARIZER)
    pipeline.to(torch.device("mps"))
    emb = pipeline._embedding

    def voiceprint(a: np.ndarray) -> np.ndarray:
        x = soxr.resample(a, OUT, SR16).astype(np.float32)
        return embed_span(emb, x, 0, len(x) / SR16)

    truth = normalize(np.mean([voiceprint(c) for c in clean], axis=0))
    measured = normalize(np.mean([voiceprint(n) for n in noisy], axis=0))
    other = say(OTHERS[0], LINE, out, "other-line")
    print(
        f"scale: another voice {float(truth @ voiceprint(other)):.3f}; the noisy clips themselves "
        f"{np.mean([truth @ voiceprint(n) for n in noisy]):.3f} (truth)"
    )

    tts = load_model(config.TTS_MODEL)
    dfn = DeepFilterNetModel.from_pretrained(config.DENOISE_MODEL, version=3)

    def denoise(a: np.ndarray) -> np.ndarray:
        y = np.asarray(dfn.enhance_array(soxr.resample(a, OUT, 48000).astype(np.float32)), np.float32)
        return soxr.resample(y, 48000, OUT).astype(np.float32)

    def conds_for(ref: np.ndarray):
        return tts.prepare_conditionals(mx.array(ref), OUT)

    def averaged(c, clips: list[np.ndarray]):
        """Both speaker embeddings from every clip instead of the reference alone."""
        sixteen = [mx.array(soxr.resample(a, OUT, SR16).astype(np.float32)) for a in clips]
        ve = mx.mean(tts.ve.embeds_from_wavs(sixteen, sample_rate=SR16), axis=0, keepdims=True)
        c.t3.speaker_emb = ve / mx.linalg.norm(ve, axis=-1, keepdims=True)
        xv = mx.concatenate([tts.s3gen.speaker_encoder.inference(w[None]) for w in sixteen], axis=0)
        c.gen["embedding"] = mx.mean(xv, axis=0, keepdims=True)
        return c

    def score(c, runs: int = 3, post: bool = False) -> tuple[float, float, float]:
        outs = []
        for _ in range(runs):
            a = np.concatenate([np.asarray(r.audio, np.float32) for r in tts.generate(text=LINE, conds=c, verbose=False)])
            outs.append(denoise(a) if post else a)
        prints = [voiceprint(o) for o in outs]
        return (
            float(np.mean([truth @ v for v in prints])),
            float(np.mean([measured @ v for v in prints])),
            float(np.mean([floor_db(o) for o in outs])),
        )

    t = time.time()
    per_clip = [score(conds_for(n), runs=1)[1] for n in noisy]  # the search sees only the measured score
    best_i = int(np.argmax(per_clip))
    clean_ref = conds_for(denoise(noisy[0]))
    rows = [
        ("first", score(conds_for(noisy[0]))),
        ("best", score(conds_for(noisy[best_i]))),
        ("avg", score(averaged(conds_for(noisy[0]), noisy))),
        ("best+avg", score(averaged(conds_for(noisy[best_i]), noisy))),
        ("clean", score(clean_ref)),
        ("clean+post", score(clean_ref, post=True)),
        ("quiet+post", score(conds_for(clean[0]), post=True)),
    ]
    print(f"search picked clip {best_i} (measured per clip: {', '.join(f'{s:.3f}' for s in per_clip)})")
    for name, (tr, me, snr) in rows:
        print(f"{name:11s} truth {tr:.3f}  measured {me:.3f}  floor {snr:.0f} dB")
    print(f"took {time.time() - t:.0f}s; files in {out}")


if __name__ == "__main__":
    main()
