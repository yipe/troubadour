"""Whisper on faster-whisper (CTranslate2), for machines without MLX: fp16 on an NVIDIA GPU when CTranslate2
can use one, else int8 on the CPU. Called by asr.py under asr.model_lock. docs/adr/0011."""

import logging
from typing import Any

import numpy as np

log = logging.getLogger(__name__)

_loaded: tuple[str, Any] | None = None  # (model id, WhisperModel): one at a time, like mlx-whisper


def _load(model: str) -> Any:
    # Installed everywhere but Apple Silicon (backend/packages/sound/pyproject.toml).
    import ctranslate2  # pyright: ignore[reportMissingImports]
    from faster_whisper import WhisperModel  # pyright: ignore[reportMissingImports]

    if ctranslate2.get_cuda_device_count() > 0:
        try:
            gpu = WhisperModel(model, device="cuda", compute_type="float16")
            gpu.transcribe(np.zeros(16000, np.float32), language="en")  # missing CUDA libraries fail here
            return gpu
        except Exception:
            log.exception(
                "Whisper couldn't use the NVIDIA GPU, so it runs on the CPU (slower). "
                "Install the CUDA 12 cuBLAS and cuDNN 9 libraries to use the GPU."
            )
    return WhisperModel(model, device="cpu", compute_type="int8")


def _model(model: str) -> Any:
    global _loaded
    if _loaded is None or _loaded[0] != model:
        _loaded = None  # free the old model before loading the next
        _loaded = (model, _load(model))
    return _loaded[1]


def segments(audio: np.ndarray, model: str, prompt: str | None) -> list[dict]:
    found, _ = _model(model).transcribe(
        audio,
        language="en",
        beam_size=1,  # greedy, as mlx-whisper decodes (the settings PLAN.md measured)
        # Benchmarked on MLX: these stop repetition loops on trailing noise.
        condition_on_previous_text=False,
        word_timestamps=True,
        hallucination_silence_threshold=1.0,
        initial_prompt=prompt,
    )
    return [{"text": s.text, "no_speech_prob": s.no_speech_prob, "avg_logprob": s.avg_logprob} for s in found]


def warm_up() -> None:
    pass  # asr.warm_up's first transcription loads the model


def memory() -> dict:
    return {}  # CTranslate2 doesn't report its allocations
