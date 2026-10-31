"""Voice clones: say anything, or read a session page aloud, in a player's voice. All on this computer.

Opt-in per player (`Player.clone_ok`): nothing is built or spoken in someone's voice until it is on,
and turning it off deletes everything made from it (`Clones.forget`).

Chatterbox doesn't train. It clones zero-shot from one reference clip and reads only its start (10 s
for the decoder, 6 s for the speech-token model), and it copies the room along with the voice: the
clone's likeness follows how clean the reference is far more than how long. So a build tries several
references (the Train recording, then the cleanest stretches of the player's own lines in session
recordings: `solo_lines`, `noise_floor_db`, `pick_sessions`), cleans each with DeepFilterNet, and
keeps the one whose clone sounds most like their voiceprint (`Clones.build`).

A player can have more than one voice: TABLE, how they talk as themselves, and one per character they
voice (in character, by the voices panel or as the AI reads their lines), each its own clone.

This module is audio, text and files; the jobs that feed it are cloning.py. See PLAN.md "Voice clones".
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
from troubadour.core import config
from troubadour.core.fsutil import write_atomic

from . import asr
from .audio import read_wav, wav_bytes
from .audio import tempo as stretch

OUT_SR = 24000  # Chatterbox's output rate
REF_S = 10.0  # Chatterbox reads no more of the reference than this
REF_GAP_S = 0.15  # between stretches of speech, once the silences are cut
MIN_REF_S = 3.0
# Reading: one Chatterbox call per chunk (longer text drifts, or stops early), with pauses between.
MAX_CHUNK_CHARS = 280
SENTENCE_PAUSE_S = 0.25
PARAGRAPH_PAUSE_S = 0.6
# A reading of CHECK_MIN_CHARS+ outside CPS_RANGE characters per second is babble or cut short: retried.
CPS_RANGE = (6.0, 30.0)
CPS_TYPICAL = 14.0
CHECK_MIN_CHARS = 40
ATTEMPTS = 2
# Building: each candidate reference reads the preview's first sentences (TRIAL_CHARS) PREVIEW_RUNS
# times and is judged on the mean likeness: one generation varies by ~0.1 (spike/clone_reference.py).
PREVIEW = "Previously, on our adventure: the party crossed the river at dawn, and nobody fell in. Mostly."
PREVIEW_RUNS = 3
TRIAL_CHARS = 140
# Candidate references from session recordings: their solo, settled, own-voice lines.
SOLO_GAP_S = 0.3  # nobody else talks within this of the line
LINE_S = (2.5, 12.0)
LINE_CONFIDENCE = 0.75
MAX_LINES = 300  # measured per build (an ffmpeg seek and an embedding each)
SESSION_REFS = 3  # sessions tried, the cleanest first (one session: one mic position and room)
SELF_LIKENESS = 0.5  # a line must sound this much like the voice it's labelled with to clone from
# Text in (mirrored in web/src/components/setup/VoiceCloneDialog.tsx) and kept on a clip.
SAY_MAX_CHARS = 2000
READ_MAX_CHARS = 30000  # about half an hour read aloud
CLIP_TEXT_CHARS = 300
# Session page sections that don't read well aloud: name lists, links, and copies of the scenes.
# A session page read aloud is its wrap-up (Last time), spotlight and what's still open: the rest repeats it.
SKIP_SECTIONS = {
    *("mentioned", "transcript", "highlights", "table moments", "facts", "suggested facts"),
    *("what happened", "people and creatures met", "places", "loot, money and deals"),
}
ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
# A player's voices: TABLE (how they talk as themselves; the Train recording's) and one per character
# they voice (as/<key>/), keyed by persona_key(character name).
TABLE = "table"
PERSONA = re.compile(r"[a-z0-9-]{1,40}")


def persona_key(character: str) -> str:
    """ "Morvath the Grey" -> "morvath-the-grey"; never TABLE."""
    key = re.sub(r"[^a-z0-9]+", "-", character.lower()).strip("-")[:40].strip("-") or "character"
    return f"{key}-1" if key == TABLE else key


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


def join(pieces: list[np.ndarray], rate: int) -> np.ndarray:
    """Clips back to back with short gaps, peak-normalized, at most REF_S of speech."""
    if not pieces:
        return np.zeros(0, np.float32)
    ends = np.cumsum([len(p) / rate for p in pieces])
    return speech_only(np.concatenate(pieces), rate, list(zip([0.0, *ends[:-1]], ends, strict=True)))


def speech_seconds(audio: np.ndarray, rate: int) -> float:
    """Length without the silence before and after (under 2% of the peak); 0 for silence."""
    peak = float(np.abs(audio).max()) if len(audio) else 0.0
    loud = np.flatnonzero(np.abs(audio) >= 0.02 * peak) if peak > 0 else []
    return (loud[-1] - loud[0] + 1) / rate if len(loud) else 0.0


def noise_floor_db(audio: np.ndarray, rate: int) -> float:
    """Loud vs quiet 20 ms frames, in dB: how far the speech stands above the room. Higher is cleaner."""
    n = max(1, int(0.02 * rate))
    frames = audio[: len(audio) // n * n].reshape(-1, n)
    if len(frames) < 10:
        return 0.0
    rms = np.sqrt((frames**2).mean(axis=1)) + 1e-9
    return float(20 * np.log10(np.percentile(rms, 95) / np.percentile(rms, 10)))


# ------------------------------------------------------------------ references from sessions


def solo_lines(record: dict, pid: str) -> list[int]:
    """Indexes in record["messages"] of their lines fit to clone from: settled and confident, 2.5-12 s,
    with nobody else talking just before, during or after. In any of their voices: which voice a line
    belongs to (table talk, or a character) is the caller's to decide."""
    messages = record["messages"]
    others = [(m["t_start"], m["t_end"]) for m in messages if m.get("player_id") != pid]
    out = []
    for i, m in enumerate(messages):
        t0, t1 = m["t_start"], m["t_end"]
        if (
            m.get("player_id") != pid
            or m.get("provisional")
            or (m.get("confidence") or 0) < LINE_CONFIDENCE
            or not LINE_S[0] <= t1 - t0 <= LINE_S[1]
            or any(s < t1 + SOLO_GAP_S and e > t0 - SOLO_GAP_S for s, e in others)
        ):
            continue
        out.append(i)
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
    holds asr.model_lock: one audio model at a time. Jobs also wait out live sessions (Clones.wait_idle),
    so this only ever holds up a session that starts mid-call, by that one call."""

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
        with asr.model_lock:
            return np.asarray(dfn.enhance_array(x), np.float32), sr

    def voice(self, audio: np.ndarray, rate: int):
        """Chatterbox's conditioning for this reference (reused for every chunk of one reading)."""
        import mlx.core as mx

        tts, _ = self._models()
        with asr.model_lock:
            return tts.prepare_conditionals(mx.array(audio), rate)

    def speak(self, text: str, voice) -> np.ndarray:
        tts, _ = self._models()
        with asr.model_lock:
            parts = [np.asarray(r.audio, np.float32) for r in tts.generate(text=text, conds=voice, verbose=False)]
        return np.concatenate(parts) if parts else np.zeros(0, np.float32)


# ------------------------------------------------------------------ clones on disk


def _url(pid: str, name: str) -> str:
    return f"/api/clones/{pid}/{name}.wav"


class Clones:
    """data/clones/<player id>/: reference.wav (what Chatterbox clones), preview.wav, voice.json,
    profile.json (talk.py) and clips/<clip id>.wav + .json; a character voice's reference, preview
    and voice.json under as/<persona key>/.

    `allowed(pid)` is the player's opt-in, checked again under the lock forget() takes before anything
    is written, so turning it off mid-job leaves nothing. `wait_idle(job)` holds a job while a live
    session runs; it's called before every model call. Jobs are memory.Job: update() and advance()
    report progress."""

    def __init__(
        self,
        root: Callable[[], Path],
        allowed: Callable[[str], bool],
        synth: Synth | None = None,
        wait_idle: Callable[[object], None] = lambda job: None,
    ):
        self.root = root
        self.allowed = allowed
        self.synth = synth or Synth()
        self.wait_idle = wait_idle
        self._lock = threading.Lock()

    # ---------------------------------------------------------------- reading

    def _dir(self, pid: str) -> Path:
        if not ID.fullmatch(pid):
            raise KeyError(pid)
        return self.root() / pid

    @staticmethod
    def _prefix(persona: str) -> str:
        """Where a persona's files sit in the player's folder."""
        if persona == TABLE:
            return ""
        if not PERSONA.fullmatch(persona):
            raise KeyError(persona)
        return f"as/{persona}/"

    def _read_json(self, pid: str, name: str) -> dict | None:
        try:
            return json.loads((self._dir(pid) / name).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def _each(self, read: Callable[[str], dict | None]) -> dict[str, dict]:
        """{player id: read(player id)} over every player folder that has one."""
        root = self.root()
        found = ((d.name, read(d.name)) for d in sorted(root.iterdir()) if d.is_dir()) if root.is_dir() else ()
        return {pid: item for pid, item in found if item}

    def status(self, pid: str) -> dict | None:
        """Their table voice, with `characters`: the character voices built with it (by label)."""
        meta = self._read_json(pid, "voice.json")
        if meta is None:
            return None
        characters = []
        for path in sorted((self._dir(pid) / "as").glob("*/voice.json")):
            if char := self._read_json(pid, f"as/{path.parent.name}/voice.json"):
                characters.append(self._with_preview(pid, path.parent.name, char))
        return self._with_preview(pid, TABLE, meta) | {"characters": sorted(characters, key=lambda c: c["label"])}

    @staticmethod
    def _with_preview(pid: str, persona: str, meta: dict) -> dict:
        name = "preview" if persona == TABLE else f"preview_{persona}"
        return meta | {"preview_url": f"{_url(pid, name)}?v={meta['built_at']}"}

    def voices(self) -> dict[str, dict]:
        return self._each(self.status)

    def profile(self, pid: str) -> dict | None:
        """Their speech profile (talk.py), if one has been made."""
        return self._read_json(pid, "profile.json")

    def profiles(self) -> dict[str, dict]:
        return self._each(self.profile)

    def clips(self) -> list[dict]:
        out = []
        for meta in self.root().glob("*/clips/*.json"):
            try:
                clip = json.loads(meta.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            out.append(clip | {"url": _url(clip["player_id"], clip["id"])})
        return sorted(out, key=lambda c: c["created_at"], reverse=True)

    def file(self, pid: str, name: str) -> Path:
        """A preview ("preview", "preview_<persona key>") or a clip's WAV; KeyError for anything else."""
        if not ID.fullmatch(name):
            raise KeyError(name)
        if name == "preview" or name.startswith("preview_"):
            path = self._dir(pid) / f"{self._prefix(name.removeprefix('preview').lstrip('_') or TABLE)}preview.wav"
        else:
            path = self._dir(pid) / f"clips/{name}.wav"
        if not path.is_file():
            raise KeyError(name)
        return path

    # ---------------------------------------------------------------- writing

    def _write(self, pid: str, files: dict[str, bytes]) -> None:
        """Write their files (paths relative to their folder), if they still agree."""
        folder = self._dir(pid)
        with self._lock:
            self._check_allowed(pid)
            for name, data in files.items():
                write_atomic(folder / name, data)

    def save_profile(self, pid: str, prof: dict) -> None:
        self._write(pid, {"profile.json": json.dumps(prof).encode()})

    def prune(self, pid: str, keep: set[str]) -> None:
        """Delete their character voices other than `keep` (a rebuild that no longer finds one)."""
        with self._lock:
            for folder in (self._dir(pid) / "as").glob("*"):
                if folder.name not in keep:
                    shutil.rmtree(folder, ignore_errors=True)

    def delete_clip(self, pid: str, cid: str) -> None:
        if cid.startswith("preview"):
            raise KeyError(cid)
        path = self.file(pid, cid)
        with self._lock:
            path.unlink(missing_ok=True)
            path.with_suffix(".json").unlink(missing_ok=True)

    def forget(self, pid: str) -> None:
        """Everything made from their voice: the reference, the preview, the profile and every clip."""
        with self._lock:
            shutil.rmtree(self._dir(pid), ignore_errors=True)

    # ---------------------------------------------------------------- the voice model

    def _check_allowed(self, pid: str) -> None:
        if not self.allowed(pid):
            raise ValueError("Voice cloning is off for this player.")

    def _speak(self, job, text: str, voice) -> np.ndarray:
        """Up to ATTEMPTS tries for a reading at a human pace; else the try closest to one."""
        tries = []
        for _ in range(ATTEMPTS):
            self.wait_idle(job)
            audio = self.synth.speak(text, voice)
            if plausible(text, audio):
                return audio
            tries.append(audio)
        return min(tries, key=lambda a: abs(len(text) / max(len(a) / OUT_SR, 1e-3) - CPS_TYPICAL))

    def _read(self, job, text: str, voice) -> np.ndarray:
        """`text` chunk by chunk with the pauses between; the job advances a step per chunk."""
        pieces = []
        for chunk, pause in chunks(text):
            pieces += [self._speak(job, chunk, voice), np.zeros(int(pause * OUT_SR), np.float32)]
            job.advance()
        return np.concatenate(pieces) if pieces else np.zeros(0, np.float32)

    def _voice(self, job, audio: np.ndarray, rate: int):
        self.wait_idle(job)
        return self.synth.voice(audio, rate)

    def build(
        self,
        job,
        pid: str,
        candidates: list[tuple[str, np.ndarray, int]],
        likeness: Callable[[np.ndarray, int], float | None],
        preview_text: str = "",
        preview_kind: str = "",
        persona: str = TABLE,
        label: str = "",
    ) -> dict:
        """Their voice from whichever candidate reference clones closest. candidates: (label, speech,
        rate). Every reference goes through DeepFilterNet first: the voice should sound clean, and the
        likeness (measured against a table-mic voiceprint) would rather keep the room, so it isn't
        asked. Each is judged on PREVIEW_RUNS readings of the preview's first sentences; the winner
        then reads the whole preview once. preview_text: ~20 s of something they would say
        (talk.preview_text), made by preview_kind ("ai" | "their lines"); empty: the stock PREVIEW.
        persona: TABLE, or a character voice's key (persona_key), named `label`."""
        prefix = self._prefix(persona)
        self._check_allowed(pid)
        candidates = [(source, a, r) for source, a, r in candidates if len(a) >= MIN_REF_S * r]
        if not candidates:
            raise ValueError(f"No recording of them has {MIN_REF_S:.0f} s of speech; train again.")
        parts = chunks(preview_text)
        if not parts:
            preview_text, preview_kind, parts = PREVIEW, "", chunks(PREVIEW)
        trial = chunks(preview_text, max_chars=TRIAL_CHARS)[0][0]
        voice_name = label or "voice"
        job.update(done=0, total=len(candidates) * PREVIEW_RUNS + len(parts), message=f"{voice_name}: loading the voice model…")
        tried, best = [], None
        for source, audio, rate in candidates:
            job.update(message=f"{voice_name}: trying the {source}…")
            self.wait_idle(job)
            clean, clean_rate = self.synth.denoise(audio, rate)
            clean = normalize(clean)
            voice = self._voice(job, clean, clean_rate)
            scores = []
            for _ in range(PREVIEW_RUNS):
                scores.append(likeness(self._speak(job, trial, voice), OUT_SR))
                job.advance()
            known = [s for s in scores if s is not None]
            score = float(np.mean(known)) if known else None
            tried.append({"source": source, "likeness": None if score is None else round(score, 3)})
            if best is None or (-1.0 if score is None else score) > (-1.0 if best[0] is None else best[0]):
                best = (score, source, clean, clean_rate, voice)
        score, source, ref, rate, voice = best
        job.update(message=f"{voice_name}: recording the preview with the {source}…")
        preview = self._read(job, preview_text, voice)
        meta = {
            "player_id": pid,
            "persona": persona,
            "label": label,
            "built_at": int(time.time()),
            "source": source,
            "tried": tried,
            "likeness": None if score is None else round(score, 3),
            "reference_s": round(len(ref) / rate, 1),
            "preview_text": " ".join(c for c, _ in parts),
            "preview_kind": preview_kind,
            # The clone's own pace, so "in their words" can time-stretch it to the player's (talk.tempo).
            "clone_wpm": round(60 * len(preview_text.split()) / max(speech_seconds(preview, OUT_SR), 1e-3)),
        }
        self._write(
            pid,
            {
                f"{prefix}reference.wav": wav_bytes(ref, rate, bits=24),
                f"{prefix}preview.wav": wav_bytes(preview, OUT_SR),
                f"{prefix}voice.json": json.dumps(meta).encode(),
            },
        )
        likeness_note = "" if score is None else f" (likeness {score:.2f})"
        job.update(message=f"{voice_name.capitalize()} ready from the {source}{likeness_note}")
        return self._with_preview(pid, persona, meta)

    def speak(
        self,
        job,
        pid: str,
        text: str,
        kind: str,
        title: str,
        source: dict,
        tempo: float = 1.0,
        in_their_words: bool = False,
        persona: str = TABLE,
    ) -> dict:
        """Read `text` in one of their voices (persona) into a new clip. kind: "say" | "read". tempo:
        time-stretch the result (talk.tempo); in_their_words: the text was restyled like them."""
        self._check_allowed(pid)
        try:
            ref, rate = read_wav(self._dir(pid) / f"{self._prefix(persona)}reference.wav")
        except FileNotFoundError:
            raise ValueError("Build this player's voice first.") from None
        parts = chunks(text)
        if not parts:
            raise ValueError("Nothing to read.")
        job.update(done=0, total=len(parts), message="Loading the voice model…")
        voice = self._voice(job, ref, rate)
        job.update(message="")
        audio = stretch(self._read(job, text, voice), OUT_SR, tempo)
        cid = "c" + uuid.uuid4().hex[:10]
        meta = {
            "id": cid,
            "player_id": pid,
            "kind": kind,
            "title": title,
            "text": text[:CLIP_TEXT_CHARS],
            "source": source,
            "in_their_words": in_their_words,
            "persona": persona,
            "seconds": round(len(audio) / OUT_SR, 1),
            "created_at": time.time(),
        }
        self._write(pid, {f"clips/{cid}.wav": wav_bytes(audio, OUT_SR), f"clips/{cid}.json": json.dumps(meta).encode()})
        job.update(message=f"{meta['seconds']:.0f} s of audio")
        return meta | {"url": _url(pid, cid)}
