"""Speech-to-text for one utterance: Whisper on MLX (Apple Silicon, asr_mlx.py) or faster-whisper
(everywhere else, asr_ct2.py). This module holds what both share: the prompt and the checks on the result.

Calls are serialized: an abandoned session's worker can still be mid-utterance
when the next session's worker starts, and neither backend is meant to run twice
at once.
"""

import base64
import functools
import re
import threading
import unicodedata
from pathlib import Path
from types import ModuleType

import numpy as np
from troubadour.core import config
from troubadour.core.config import SR
from troubadour.core.settings import current as model_settings

# One audio model runs at a time: Whisper here, the voice-clone models in tts.py.
model_lock = threading.Lock()

# Whisper's stock outputs for noise / silence (YouTube outros and subtitle credits).
HALLUCINATIONS = {
    "",
    "you",
    "thank you",
    "thanks for watching",
    "thank you for watching",
    "bye",
    "we'll be right back",
    "we'll see you next time",
    "see you next time",
    "subtitles by the amara.org community",
}
MAX_WORDS_PER_S = 8.0  # people top out near 6.6 (99th percentile of a real session)

# Whisper reads at most n_ctx/2 - 1 prompt tokens and silently drops the *start* of a longer
# prompt: the names. A big glossary plus two long lines overflowed 46% of one real session's prompts.
PROMPT_TOKENS = 223
CONTEXT_TOKENS = 60  # of those, for the last lines (tuned in PLAN.md, "Whisper prompt")
PROMPT_HEAD, PROMPT_TAIL = "A D&D session.", "Initiative, perception check, saving throw."


@functools.cache
def _encoding():
    """Whisper's multilingual vocabulary (every model the menus list), shipped with the package so prompts
    are counted the same on every backend without loading a model. From openai/whisper (MIT)."""
    import tiktoken

    lines = Path(__file__).with_name("whisper-multilingual.tiktoken").read_text().splitlines()
    ranks = {base64.b64decode(token): int(rank) for token, rank in (line.split() for line in lines if line)}
    pattern = r"""'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+"""
    return tiktoken.Encoding(name="whisper-multilingual", pat_str=pattern, mergeable_ranks=ranks, special_tokens={})


def prompt_tokens(text: str) -> int:
    """Prompt length the way Whisper counts it (it encodes " " + the stripped prompt)."""
    return len(_encoding().encode_ordinary(" " + text.strip()))


def build_prompt(names: list[str], lines: list[str], context_tokens: int = CONTEXT_TOKENS) -> str:
    """'A D&D session. <names>. Initiative, … <the last lines>' that fits Whisper's prompt window:
    the lines keep their last context_tokens tokens, and names go in, in the given order, while
    there's room."""
    words = " ".join(lines).split()
    while words and prompt_tokens(" ".join(words)) > context_tokens:
        words = words[max(1, len(words) // 8) :]  # whole words off the front, oldest first
    context = " ".join(words)

    def build(k: int) -> str:
        head = f"{PROMPT_HEAD} {', '.join(names[:k])}." if k else PROMPT_HEAD
        return " ".join(p for p in (head, PROMPT_TAIL, context) if p)

    lo, hi = 0, len(names)  # the most names that fit (more names, more tokens)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        lo, hi = (mid, hi) if prompt_tokens(build(mid)) <= PROMPT_TOKENS else (lo, mid - 1)
    return build(lo)


def prompt_names(first: list[str], glossary: list[str], recent: list[str], nicknames: list[str] | None = None) -> list[str]:
    """The order names earn a place in the prompt: `first` (Setup's characters and players, the
    voices panel), then names said in `recent` lines (latest first), then the rest of the glossary.
    A nickname (a glossary alias) said lately goes in as said: "Phisho", not only "Phishondra"."""
    forms = {n.casefold(): n for n in (*glossary, *(nicknames or [])) if n}
    said: list[str] = []
    if forms:  # longest first: "Ten Proof Babadabroose" wins over "Ten Proof"
        alternatives = "|".join(re.escape(k) for k in sorted(forms, key=len, reverse=True))
        spoken = re.compile(rf"(?<!\w)(?:{alternatives})(?!\w)")
        for line in reversed(recent):
            said += [forms[m.group(0)] for m in spoken.finditer(line.casefold())]
    return list(dict.fromkeys(n for n in (*first, *said, *glossary) if n))


@functools.cache
def _backend() -> ModuleType:
    if config.MLX:
        from . import asr_mlx as backend
    else:
        from . import asr_ct2 as backend
    return backend


def _run(audio: np.ndarray, prompt: str | None, model: str | None = None) -> str:
    with model_lock:
        result = _backend().segments(audio, model or model_settings()["whisper"], prompt)
    # Language is forced to English and every name the table uses is in Latin script: letters from
    # another script mean the segment is Whisper making things up ("образbak Waters factual").
    segments = [
        s for s in result if not (s.get("no_speech_prob", 0) > 0.6 and s.get("avg_logprob", 0) < -1.0) and not _foreign(s["text"])
    ]
    text = " ".join(s["text"].strip() for s in segments).strip()
    return "" if text.lower().strip(" .!?,") in HALLUCINATIONS else text


def _foreign(text: str) -> bool:
    """Any letter outside the Latin script (accented Latin letters are fine)."""
    return any(ch.isalpha() and not unicodedata.name(ch, "").startswith("LATIN") for ch in text)


def too_fast(text: str, audio: np.ndarray) -> bool:
    """More words than anyone fits in the clip: invented ("We'll be right back." in 0.3 s)."""
    return len(text.split()) > MAX_WORDS_PER_S * len(audio) / SR


def _words(text: str) -> list[str]:
    return [w for w in (t.strip(".,!?;:\"'()-").lower() for t in text.split()) if w]


def suspicious(text: str, prompt: str) -> bool:
    """A prompted result that reads the prompt back (5 of its words in a row) or loops."""
    words = _words(text)
    if any(len(w) > 25 for w in words):  # "epipopeopeopeo…"
        return True
    if len(words) >= 8 and len(set(words)) / len(words) < 0.3:
        return True
    p = _words(prompt)
    grams = {tuple(p[i : i + 5]) for i in range(len(p) - 4)}
    if any(tuple(words[i : i + 5]) in grams for i in range(len(words) - 4)):
        return True
    # A short line that is mostly the prompt's names ("Auggie, Kessia, Magenta, Nora." from noise).
    return len(words) >= 3 and sum(w in set(p) for w in words) / len(words) >= 0.75


def transcribe(audio: np.ndarray, prompt: str | None = None, model: str | None = None) -> str:
    """One utterance. A prompt (glossary names) helps names, but on a quiet clip Whisper can read
    it back as speech, fall into a loop or invent a sentence; such a result is redone without the
    prompt, and a line still spoken impossibly fast is dropped.
    model: another Whisper (e.g. large-v3-mlx for an offline pass); default the live one."""
    text = _run(audio, prompt, model)
    if prompt and text and (suspicious(text, prompt) or too_fast(text, audio)):
        text = _run(audio, None, model)
    return "" if too_fast(text, audio) else text


def warm_up() -> None:
    _backend().warm_up()
    transcribe(np.zeros(16000, np.float32))


def memory() -> dict:
    return _backend().memory()
