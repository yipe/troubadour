"""Voice clones: say anything, or read a session page aloud, in a player's voice. All on this Mac.

Opt-in per player (`Player.clone_ok`): nothing is built or spoken in someone's voice until it is on,
and turning it off deletes their reference and every clip made with it.

Chatterbox doesn't train. It clones zero-shot from one reference clip and reads only its start
(10 s for the decoder, 6 s for the speech-token model), so the reference is the player's Train clip
(the lossless own-rate copy when there is one) with the silences cut out. The clone copies the room
and noise along with the voice, so building a voice tries the clip as recorded and cleaned by
DeepFilterNet, speaks the same preview line from each, and keeps whichever sounds more like the
player to the speaker-ID model (cosine to their voiceprint). See PLAN.md "Voice clones".
"""

import json
import re
import shutil
import threading
import time
import uuid
from collections.abc import Callable
from pathlib import Path

import numpy as np

from . import asr, config
from .audio import read_wav, wav_bytes
from .audio import tempo as stretch

OUT_SR = 24000  # Chatterbox's output rate
REF_S = 10.0  # Chatterbox reads no more of the reference than this
REF_GAP_S = 0.15  # between the Train clip's stretches of speech, once the silences are cut
MIN_REF_S = 3.0
MAX_CHUNK_CHARS = 280  # one Chatterbox call per chunk: longer text drifts, or stops early
SENTENCE_PAUSE_S = 0.25
PARAGRAPH_PAUSE_S = 0.6
# A reading of 40+ characters outside this many characters per second is babble or cut short: retry.
CPS_RANGE = (6.0, 30.0)
CPS_TYPICAL = 14.0
CHECK_MIN_CHARS = 40
ATTEMPTS = 2
PREVIEW = "Previously, on our adventure: the party crossed the river at dawn, and nobody fell in. Mostly."
# Building a voice: each candidate reference speaks the preview this many times and is judged on the
# mean likeness. One generation varies by ~0.1 (spike/clone_reference.py): one would pick by luck.
PREVIEW_RUNS = 3
TRIAL_CHARS = 140  # the part of the preview each candidate is judged on (~7 s): whole sentences
# Candidate references from session recordings: solo lines of their own voice, confidently theirs.
SOLO_GAP_S = 0.3  # nobody else talks within this of the line
LINE_S = (2.5, 12.0)
LINE_CONFIDENCE = 0.75
MAX_LINES = 300  # measured per build (ffmpeg seek + one embedding each): bounded
SESSION_REFS = 3  # sessions tried, the cleanest first (one session: one mic position and room)
SELF_LIKENESS = 0.5  # a line must sound this much like their voiceprint to count as theirs
SAY_MAX_CHARS = 2000
READ_MAX_CHARS = 30000  # about half an hour read aloud
CLIP_TEXT_CHARS = 300  # what a clip's metadata keeps of its text
# Session page sections that don't read well aloud: name lists, links, and copies of the scenes.
SKIP_SECTIONS = {"mentioned", "transcript", "highlights", "table moments", "facts", "suggested facts"}
ID = re.compile(r"[A-Za-z0-9_-]{1,64}")


# ------------------------------------------------------------------ audio


def normalize(audio: np.ndarray, peak: float = 0.9) -> np.ndarray:
    top = float(np.abs(audio).max()) if len(audio) else 0.0
    return (audio * (peak / top)).astype(np.float32) if top > 1e-6 else audio.astype(np.float32)


def speech_only(audio: np.ndarray, rate: int, spans: list[tuple[float, float]], seconds: float = REF_S) -> np.ndarray:
    """The spans' audio back to back with short gaps, up to `seconds` of speech, peak-normalized."""
    parts: list[np.ndarray] = []
    total = 0
    for start, end in spans:
        piece = audio[int(start * rate) : int(end * rate)][: int(seconds * rate) - total]
        if len(piece):
            parts += [piece, np.zeros(int(REF_GAP_S * rate), np.float32)]
            total += len(piece)
        if total >= int(seconds * rate):
            break
    return normalize(np.concatenate(parts[:-1])) if parts else np.zeros(0, np.float32)


def noise_floor_db(audio: np.ndarray, rate: int) -> float:
    """Loud vs quiet 20 ms frames, in dB: how far the speech stands above the room. Higher is cleaner."""
    n = max(1, int(0.02 * rate))
    frames = audio[: len(audio) // n * n].reshape(-1, n)
    if len(frames) < 10:
        return 0.0
    rms = np.sqrt((frames**2).mean(axis=1)) + 1e-9
    return float(20 * np.log10(np.percentile(rms, 95) / np.percentile(rms, 10)))


def solo_lines(messages: list[dict], pid: str) -> list[tuple[float, float]]:
    """(start, end) of their lines fit to clone from: their own voice (no character), settled and
    confident, 2.5-12 s, with nobody else talking just before, during or after."""
    others = sorted((m["t_start"], m["t_end"]) for m in messages if m.get("player_id") != pid)
    out = []
    for m in messages:
        t0, t1 = m["t_start"], m["t_end"]
        if (
            m.get("player_id") != pid
            or m.get("character")
            or m.get("provisional")
            or (m.get("confidence") or 0) < LINE_CONFIDENCE
            or not LINE_S[0] <= t1 - t0 <= LINE_S[1]
        ):
            continue
        if any(s < t1 + SOLO_GAP_S and e > t0 - SOLO_GAP_S for s, e in others):
            continue
        out.append((t0, t1))
    return out


def pick_sessions(scored: list[tuple[float, str, float, float]], limit: int = SESSION_REFS) -> list[tuple[str, list]]:
    """scored: (noise floor dB, session, start, end) of lines that are theirs. Up to `limit` sessions, the
    cleanest first (mean floor of the lines that would make the reference), each with its cleanest lines
    up to REF_S of speech; sessions with under MIN_REF_S are skipped."""
    by_session: dict[str, list[tuple[float, float, float]]] = {}
    for floor, sid, s, e in sorted(scored, key=lambda x: (-x[0], x[2])):
        by_session.setdefault(sid, []).append((floor, s, e))
    picks = []
    for sid, lines in by_session.items():
        chosen, total = [], 0.0
        for floor, s, e in lines:
            if total >= REF_S:
                break
            chosen.append((floor, s, e))
            total += e - s
        if total >= MIN_REF_S:
            picks.append((float(np.mean([f for f, _, _ in chosen])), sid, [(s, e) for _, s, e in chosen]))
    picks.sort(key=lambda p: -p[0])
    return [(sid, spans) for _, sid, spans in picks[:limit]]


def join(pieces: list[np.ndarray], rate: int) -> np.ndarray:
    """Clips back to back with short gaps, peak-normalized, at most REF_S of speech."""
    spans, t, parts = [], 0.0, []
    for p in pieces:
        parts.append(p)
        spans.append((t, t + len(p) / rate))
        t += len(p) / rate
    return speech_only(np.concatenate(parts), rate, spans) if parts else np.zeros(0, np.float32)


# ------------------------------------------------------------------ text


def _inline(text: str) -> str:
    """Markdown/Obsidian inline syntax → the words a reader would say."""
    text = re.sub(r"!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)", "", text)  # embeds and images
    text = re.sub(r"\[\[([^\]|]*)\|([^\]]*)\]\]", r"\2", text)  # [[Note|shown]]
    text = re.sub(r"\[\[([^\]#]*/)?([^\]#]*)(#[^\]]*)?\]\]", r"\2", text)  # [[Folder/Note#Part]]
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)  # [text](url)
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"(?<![\w&])#[A-Za-z][\w/-]*", "", text)  # #tags
    text = re.sub(r"\*\*|__|~~|==|`|(?<!\w)[*_]|[*_](?!\w)", "", text)
    return " ".join(text.split())


def _sentence(text: str) -> str:
    return text if text[-1] in ".!?…:;" else text + "."


def speakable(markdown: str) -> str:
    """A note as plain paragraphs to read aloud: no frontmatter, comments, code, tables or link
    syntax; headings and list items become sentences of their own; SKIP_SECTIONS are left out."""
    text = re.sub(r"\A---\n.*?\n---\n", "", markdown, flags=re.S)
    text = re.sub(r"<!--.*?-->|```.*?```", "", text, flags=re.S)
    paragraphs: list[str] = []
    para: list[str] = []
    skip = False

    def flush() -> None:
        if para:
            paragraphs.append(" ".join(para))
            para.clear()

    for raw in text.splitlines():
        line = raw.strip()
        heading = re.match(r"(#{1,6})\s+(.*)", line)
        if heading:
            flush()
            title = _inline(heading.group(2))
            skip = len(heading.group(1)) > 1 and title.lower().rstrip(".:") in SKIP_SECTIONS
            if title and not skip:
                paragraphs.append(_sentence(title))
            continue
        if skip:
            continue
        if not line or line.startswith("|"):
            flush()
            continue
        item = re.match(r"(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?(.*)", line)
        if item:
            flush()
            if words := _inline(item.group(1)):
                paragraphs.append(_sentence(words))
            continue
        if words := _inline(re.sub(r"^>\s*(\[![\w-]+\][+-]?\s*)?", "", line)):
            para.append(words)
    flush()
    return "\n\n".join(paragraphs)


def _pack(pieces: list[str], max_chars: int) -> list[str]:
    out: list[str] = []
    for p in pieces:
        if out and len(out[-1]) + 1 + len(p) <= max_chars:
            out[-1] += " " + p
        else:
            out.append(p)
    return out


def _split_long(sentence: str, max_chars: int) -> list[str]:
    """A sentence too long for one call: at clause breaks, then between words, then hard."""
    if len(sentence) <= max_chars:
        return [sentence]
    pieces: list[str] = []
    for clause in re.split(r"(?<=[,;:])\s+", sentence):
        for word in clause.split() if len(clause) > max_chars else [clause]:
            pieces += [word[i : i + max_chars] for i in range(0, len(word), max_chars)]
    return _pack(pieces, max_chars)


def chunks(text: str, max_chars: int = MAX_CHUNK_CHARS) -> list[tuple[str, float]]:
    """(chunk, pause after it in seconds) in reading order: whole sentences packed up to max_chars,
    never across a paragraph."""
    out: list[tuple[str, float]] = []
    for para in re.split(r"\n\s*\n", text.strip()):
        para = " ".join(para.split())
        if not para:
            continue
        pieces = [p for s in re.split(r"(?<=[.!?…])\s+", para) for p in _split_long(s, max_chars)]
        packed = _pack(pieces, max_chars)
        out += [(c, SENTENCE_PAUSE_S) for c in packed[:-1]] + [(packed[-1], PARAGRAPH_PAUSE_S)]
    if out:
        out[-1] = (out[-1][0], 0.0)
    return out


def plausible(text: str, audio: np.ndarray, rate: int = OUT_SR) -> bool:
    """Short lines vary too much to judge; longer ones read at a human pace."""
    if len(text) < CHECK_MIN_CHARS:
        return len(audio) > 0
    cps = len(text) / max(len(audio) / rate, 1e-3)
    return CPS_RANGE[0] <= cps <= CPS_RANGE[1]


# ------------------------------------------------------------------ models


class Synth:
    """Chatterbox and DeepFilterNet on MLX, loaded on first use (downloaded the first time). Each call
    holds Whisper's lock, so only one MLX model runs at a time, and a live session's transcription
    waits for at most one chunk (a few seconds)."""

    def __init__(self, model: str | None = None):
        self.model_id = model or config.TTS_MODEL
        self._tts = None
        self._dfn = None
        self._load = threading.Lock()

    def _models(self):
        with self._load:
            if self._tts is None:
                from mlx_audio.sts.models.deepfilternet.model import DeepFilterNetModel
                from mlx_audio.tts.utils import load_model

                self._dfn = DeepFilterNetModel.from_pretrained(config.DENOISE_MODEL, version=3)
                self._tts = load_model(self.model_id)
        return self._tts, self._dfn

    def denoise(self, audio: np.ndarray, rate: int) -> tuple[np.ndarray, int]:
        import soxr

        _, dfn = self._models()
        sr = dfn.config.sample_rate
        x = soxr.resample(audio, rate, sr).astype(np.float32) if rate != sr else audio
        with asr._lock:
            return np.asarray(dfn.enhance_array(x), np.float32), sr

    def voice(self, audio: np.ndarray, rate: int):
        """Chatterbox's conditioning for this reference (reused for every chunk of one reading)."""
        import mlx.core as mx

        tts, _ = self._models()
        with asr._lock:
            return tts.prepare_conditionals(mx.array(audio), rate)

    def speak(self, text: str, voice) -> np.ndarray:
        tts, _ = self._models()
        with asr._lock:
            parts = [np.asarray(r.audio, np.float32) for r in tts.generate(text=text, conds=voice, verbose=False)]
        return np.concatenate(parts) if parts else np.zeros(0, np.float32)


# ------------------------------------------------------------------ clones on disk


def speech_seconds(audio: np.ndarray, rate: int) -> float:
    """Length without the silence before and after (under 2% of the peak)."""
    loud = np.flatnonzero(np.abs(audio) >= 0.02 * (np.abs(audio).max() if len(audio) else 0.0))
    return (loud[-1] - loud[0] + 1) / rate if len(loud) else 0.0


def _write_atomic(path: Path, data: bytes) -> None:
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


class Clones:
    """data/clones/<player id>/: reference.wav (what Chatterbox clones), preview.wav, voice.json, and
    clips/<clip id>.wav + .json. `allowed(pid)` is the player's opt-in, checked again (under the
    lock that forget() takes) before anything is written, so turning it off mid-job leaves nothing."""

    def __init__(self, root: Callable[[], Path], allowed: Callable[[str], bool], synth: Synth | None = None):
        self.root = root
        self.allowed = allowed
        self.synth = synth or Synth()
        self._lock = threading.Lock()

    def _dir(self, pid: str) -> Path:
        if not ID.fullmatch(pid):
            raise KeyError(pid)
        return self.root() / pid

    def status(self, pid: str) -> dict | None:
        try:
            meta = json.loads((self._dir(pid) / "voice.json").read_text())
        except (OSError, ValueError):
            return None
        return meta | {"preview_url": f"/api/clones/{pid}/preview.wav?v={meta['built_at']}"}

    def voices(self) -> dict[str, dict]:
        root = self.root()
        found = (self.status(d.name) for d in sorted(root.iterdir()) if d.is_dir()) if root.is_dir() else ()
        return {s["player_id"]: s for s in found if s}

    def profile(self, pid: str) -> dict | None:
        """Their speech profile (talk.py), if one has been made."""
        try:
            return json.loads((self._dir(pid) / "profile.json").read_text())
        except (OSError, ValueError):
            return None

    def profiles(self) -> dict[str, dict]:
        root = self.root()
        found = (self.profile(d.name) for d in sorted(root.iterdir()) if d.is_dir()) if root.is_dir() else ()
        return {p["player_id"]: p for p in found if p}

    def save_profile(self, pid: str, prof: dict) -> None:
        folder = self._dir(pid)
        with self._lock:
            self._check_allowed(pid)
            folder.mkdir(parents=True, exist_ok=True)
            _write_atomic(folder / "profile.json", json.dumps(prof).encode())

    def clips(self) -> list[dict]:
        out = []
        for meta in self.root().glob("*/clips/*.json"):
            try:
                clip = json.loads(meta.read_text())
            except (OSError, ValueError):
                continue
            out.append(clip | {"url": f"/api/clones/{clip['player_id']}/{clip['id']}.wav"})
        return sorted(out, key=lambda c: c["created_at"], reverse=True)

    def file(self, pid: str, name: str) -> Path:
        """preview.wav or a clip's WAV; KeyError for anything else (no traversal)."""
        if not ID.fullmatch(name):
            raise KeyError(name)
        path = self._dir(pid) / ("preview.wav" if name == "preview" else f"clips/{name}.wav")
        if not path.is_file():
            raise KeyError(name)
        return path

    def delete_clip(self, pid: str, cid: str) -> None:
        if cid == "preview":
            raise KeyError(cid)
        path = self.file(pid, cid)
        with self._lock:
            path.unlink(missing_ok=True)
            path.with_suffix(".json").unlink(missing_ok=True)

    def forget(self, pid: str) -> None:
        """Everything made from their voice: the reference, the preview and every clip."""
        with self._lock:
            shutil.rmtree(self._dir(pid), ignore_errors=True)

    def _check_allowed(self, pid: str) -> None:
        if not self.allowed(pid):
            raise ValueError("Voice cloning is off for this player.")

    def _speak(self, text: str, voice) -> np.ndarray:
        """Up to ATTEMPTS tries for a reading at a human pace; else the try closest to one."""
        tries = []
        for _ in range(ATTEMPTS):
            audio = self.synth.speak(text, voice)
            if plausible(text, audio):
                return audio
            tries.append(audio)
        return min(tries, key=lambda a: abs(len(text) / max(len(a) / OUT_SR, 1e-3) - CPS_TYPICAL))

    def _read(self, text: str, voice, step: Callable[[], None] = lambda: None) -> np.ndarray:
        """`text` chunk by chunk (chunks), with the pauses between; step() after each chunk."""
        pieces = []
        for chunk, pause in chunks(text):
            pieces += [self._speak(chunk, voice), np.zeros(int(pause * OUT_SR), np.float32)]
            step()
        return np.concatenate(pieces) if pieces else np.zeros(0, np.float32)

    def build(
        self,
        job,
        emit: Callable[[], None],
        pid: str,
        candidates: list[tuple[str, np.ndarray, int]],
        likeness: Callable[[np.ndarray, int], float | None],
        preview_text: str = PREVIEW,
        preview_kind: str = "",
    ) -> dict:
        """Their voice from whichever candidate reference clones closest. candidates: (label, speech,
        rate): the Train recording's speech, then the cleanest stretches of session recordings. Every
        reference goes through DeepFilterNet first: the clone copies whatever room it hears, and the
        voice should sound clean (the likeness, measured against a table-mic voiceprint, would rather
        keep the room: it isn't asked). Each candidate is judged on PREVIEW_RUNS readings of the
        preview's first sentences (TRIAL_CHARS); the winner then reads the whole preview (about 20 s of something they
        would say: talk.preview_text) once."""
        self._check_allowed(pid)
        candidates = [(label, a, r) for label, a, r in candidates if len(a) >= MIN_REF_S * r]
        if not candidates:
            raise ValueError(f"No recording of them has {MIN_REF_S:.0f} s of speech; train again.")
        parts = chunks(preview_text) or chunks(PREVIEW)
        preview_text = " ".join(c for c, _ in parts)
        preview_kind = preview_kind if preview_text != PREVIEW else ""
        trial = chunks(preview_text, max_chars=TRIAL_CHARS)[0][0]
        job.done, job.total = 0, len(candidates) * PREVIEW_RUNS + len(parts)
        job.message = "Loading the voice model (the first time downloads it)…"
        emit()
        tried, best = [], None
        for label, audio, rate in candidates:
            job.message = f"Trying the {label}…"
            emit()
            clean, clean_rate = self.synth.denoise(audio, rate)
            clean = normalize(clean)
            voice = self.synth.voice(clean, clean_rate)
            scores = []
            for _ in range(PREVIEW_RUNS):
                scores.append(likeness(self._speak(trial, voice), OUT_SR))
                job.done += 1
                emit()
            known = [s for s in scores if s is not None]
            score = float(np.mean(known)) if known else None
            tried.append({"source": label, "likeness": None if score is None else round(score, 3)})
            if best is None or (score if score is not None else -1.0) > (best[0] if best[0] is not None else -1.0):
                best = (score, label, clean, clean_rate, voice)
        score, label, ref, rate, voice = best
        job.message = f"Recording the preview with the {label}…"
        emit()

        def step() -> None:
            job.done += 1
            emit()

        preview = self._read(preview_text, voice, step)
        meta = {
            "player_id": pid,
            "built_at": int(time.time()),
            "source": label,
            "tried": tried,
            "likeness": None if score is None else round(score, 3),
            "reference_s": round(len(ref) / rate, 1),
            "preview_text": preview_text,
            "preview_kind": preview_kind,  # "ai" (written in their style) | "their lines" | "" (the stock line)
            # The clone's own pace, so "in their words" can time-stretch it to the player's (talk.tempo).
            "clone_wpm": round(60 * len(preview_text.split()) / max(speech_seconds(preview, OUT_SR), 1e-3)),
        }
        folder = self._dir(pid)
        with self._lock:
            self._check_allowed(pid)
            folder.mkdir(parents=True, exist_ok=True)
            _write_atomic(folder / "reference.wav", wav_bytes(ref, rate, bits=24))
            _write_atomic(folder / "preview.wav", wav_bytes(preview, OUT_SR))
            _write_atomic(folder / "voice.json", json.dumps(meta).encode())
        job.message = f"Voice ready from the {label}" + ("" if score is None else f" (likeness {score:.2f})")
        return self.status(pid) or meta

    def speak(
        self,
        job,
        emit: Callable[[], None],
        pid: str,
        text: str,
        kind: str,
        title: str,
        source: dict,
        tempo: float = 1.0,
        in_their_words: bool = False,
    ) -> dict:
        """Read `text` in their voice into a new clip. kind: "say" | "read". tempo: time-stretch the
        result (talk.tempo); in_their_words: the text was restyled like them (recorded on the clip)."""
        self._check_allowed(pid)
        try:
            ref, rate = read_wav(self._dir(pid) / "reference.wav")
        except FileNotFoundError:
            raise ValueError("Build this player's voice first.") from None
        parts = chunks(text)
        if not parts:
            raise ValueError("Nothing to read.")
        job.done, job.total, job.message = 0, len(parts), "Loading the voice model…"
        emit()
        voice = self.synth.voice(ref, rate)
        job.message = ""

        def step() -> None:
            job.done += 1
            emit()

        audio = stretch(self._read(text, voice, step), OUT_SR, tempo)
        cid = "c" + uuid.uuid4().hex[:10]
        meta = {
            "id": cid,
            "player_id": pid,
            "kind": kind,
            "title": title,
            "text": text[:CLIP_TEXT_CHARS],
            "source": source,
            "in_their_words": in_their_words,
            "seconds": round(len(audio) / OUT_SR, 1),
            "created_at": time.time(),
        }
        clips = self._dir(pid) / "clips"
        with self._lock:
            self._check_allowed(pid)
            clips.mkdir(parents=True, exist_ok=True)
            _write_atomic(clips / f"{cid}.wav", wav_bytes(audio, OUT_SR))
            _write_atomic(clips / f"{cid}.json", json.dumps(meta).encode())
        job.message = f"{meta['seconds']:.0f} s of audio"
        return meta | {"url": f"/api/clones/{pid}/{cid}.wav"}
