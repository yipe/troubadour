"""Runtime settings. Everything runs on this machine; override with env vars."""

import os
import platform
import shutil
import sys
from pathlib import Path


def env(name: str, default: str | None = None) -> str | None:
    """TROUBADOUR_<name>, or the pre-rename BARD_<name> (existing setups), or the default."""
    return os.environ.get(f"TROUBADOUR_{name}", os.environ.get(f"BARD_{name}", default))


def _find_repo() -> Path:
    """The repo root: the first parent holding backend/pyproject.toml (this file's depth is not fixed)."""
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "backend" / "pyproject.toml").is_file():
            return parent
    raise RuntimeError(f"no backend/pyproject.toml above {here}")


REPO = _find_repo()
BACKEND = REPO / "backend"

HOST = env("HOST", "127.0.0.1")
PORT = int(env("PORT", "8765"))

# Local OpenAI-compatible LLM for live spelling cleanup (LM Studio default port here is 1235).
LLM_URL = env("LLM_URL", "http://127.0.0.1:1235/v1")
LLM_MODEL = env("LLM_MODEL", "google/gemma-4-26b-a4b-qat")
# Campaign memory (reading notes, writing up sessions) can use a bigger local model than the
# live spelling cleanup; LM Studio loads it on first use if it isn't loaded yet.
# Graded best of 9 local models on a real 2.6 h session (27/40 vs gemma-26b 18/40; ~4.5x slower).
MEMORY_LLM_MODEL = env("MEMORY_MODEL", "swift-qwen3.8-27b")
# "none" suits gemma (it otherwise spends the budget thinking); gpt-oss wants "low"/"medium"/"high".
MEMORY_REASONING = env("MEMORY_REASONING", "none")

# MLX (Whisper, voice clones) runs on Apple Silicon only. Elsewhere Whisper runs on faster-whisper (an NVIDIA
# GPU when there is one, else the CPU) and voice clones are off. docs/adr/0011.
MLX = sys.platform == "darwin" and platform.machine() == "arm64"
NVIDIA = not MLX and shutil.which("nvidia-smi") is not None


def whisper_defaults(mlx: bool, nvidia: bool) -> tuple[str, str]:
    """(live, re-listen) Whisper for this machine. Without a GPU, large-v3-turbo (int8, 4 threads) took 0.6×
    real time on a fast CPU, too close to falling behind a live table on an ordinary one; small took 0.3×.
    The background re-listen can afford turbo. Off MLX the ids are faster-whisper names."""
    if mlx:
        return "mlx-community/whisper-large-v3-turbo", "mlx-community/whisper-large-v3-mlx"
    return ("large-v3-turbo", "large-v3") if nvidia else ("small", "large-v3-turbo")


WHISPER_MODEL = env("WHISPER", whisper_defaults(MLX, NVIDIA)[0])
# Re-listen (Improve transcript) only: a bigger model than the live one where there's time for it.
# TROUBADOUR_WHISPER_IMPROVE=<the live model> keeps both passes the same.
WHISPER_IMPROVE_MODEL = env("WHISPER_IMPROVE", whisper_defaults(MLX, NVIDIA)[1])
# Prompt Whisper with the campaign's names and the last few lines (measured on a real 2.6 h
# session: word errors 12.9% → 11.0%, names spelled right 31% → 86%, same speed). TROUBADOUR_ASR_PROMPT=0: off.
ASR_PROMPT = env("ASR_PROMPT", "1") != "0"
ASR_CONTEXT_LINES = 2
# Spelling cleanup behind the transcriber (names, D&D terms; see cleanup.py). TROUBADOUR_CLEANUP=0: off.
CLEANUP = env("CLEANUP", "1") != "0"
DIARIZER = "pyannote/speaker-diarization-community-1"  # only its speaker-embedding model is used
# Voice clones (tts.py): Chatterbox on MLX, zero-shot from a player's Train clip; DeepFilterNet cleans
# that clip first. Downloaded from Hugging Face on first use, then local. Apple Silicon only.
VOICE_CLONES = MLX
TTS_MODEL = env("TTS", "mlx-community/chatterbox-multilingual-v3")
DENOISE_MODEL = "mlx-community/DeepFilterNet-mlx"

# Outside the repo so every checkout/worktree shares one set of players, recordings and vault.
DATA_DIR = Path(env("DATA", str(Path.home() / "troubador")))
SAMPLES_DIR = Path(env("SAMPLES", str(BACKEND / "samples" / "eval")))
WEB_DIST = REPO / "web" / "dist"
# Troubadour Cloud (optional backup + web view of the campaign vault). Nothing is sent until the user connects.
CLOUD_URL = env("CLOUD_URL", "https://troubadour.cloud")


def vault_dir() -> Path:
    """The campaign wiki: an Obsidian vault of markdown notes. TROUBADOUR_VAULT points it at an existing
    vault (or a folder in one). Resolved per call, so it follows DATA_DIR (tests use a tmp dir)."""
    vault = env("VAULT")
    return Path(vault) if vault else DATA_DIR / "campaign"


SR = 16000

# File replay speed cap. Stress tests raise it (e.g. TROUBADOUR_MAX_REPLAY_SPEED=8); 4× is plenty for demos.
MAX_REPLAY_SPEED = float(env("MAX_REPLAY_SPEED", "4"))
# Keep each mic session's audio at the mic's own rate (data/sessions/<id>/audio.wav; 48 kHz is
# ~345 MB/hour) so it can be listened to, replayed, or re-run with `troubadour-sim`. TROUBADOUR_RECORD=0: off.
RECORD_AUDIO = env("RECORD", "1") != "0"
