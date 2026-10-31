"""Whisper on MLX (Apple Silicon). Called by asr.py under asr.model_lock."""

import numpy as np

# MLX's buffer cache defaults to ~all of RAM; Whisper sees a new input length every
# utterance, so an unbounded cache creeps up over a long session. 1 GB keeps reuse.
CACHE_LIMIT = 1 << 30


def segments(audio: np.ndarray, model: str, prompt: str | None) -> list[dict]:
    import mlx_whisper

    result = mlx_whisper.transcribe(
        audio,
        path_or_hf_repo=model,
        language="en",
        verbose=None,
        # Benchmarked: these stop repetition loops on trailing noise.
        condition_on_previous_text=False,
        word_timestamps=True,
        hallucination_silence_threshold=1.0,
        initial_prompt=prompt,
    )
    segments: list[dict] = result["segments"]  # pyright: ignore[reportAssignmentType]  # typed str | list upstream
    return segments


def warm_up() -> None:
    import mlx.core as mx

    mx.set_cache_limit(CACHE_LIMIT)


def memory() -> dict:
    import mlx.core as mx

    return {"mlx_active_mb": mx.get_active_memory() / 2**20, "mlx_cache_mb": mx.get_cache_memory() / 2**20}
