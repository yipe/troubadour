"""Where sessions and replay samples live on disk, and small WAV helpers."""

import json
import re
import subprocess
import wave
from pathlib import Path

from troubadour.core import config

SESSION_ID = re.compile(r"\d{4}-\d{2}-\d{2}_\d{6}-[0-9a-f]{4}")


def _first_by_id(earlier: list[dict], later: list[dict]) -> list[dict]:
    out: dict[str, dict] = {}
    for item in earlier + later:
        out.setdefault(item["id"], item)
    return list(out.values())


def _audio_seconds(path: Path) -> float:
    with wave.open(str(path)) as w:
        return w.getnframes() / w.getframerate()


def _concat_wav(keep: Path, extra: Path) -> None:
    """Append extra's samples onto keep. Same format is copied; otherwise ffmpeg matches keep."""
    with wave.open(str(keep)) as a, wave.open(str(extra)) as b:
        same = (a.getnchannels(), a.getsampwidth(), a.getframerate()) == (
            b.getnchannels(),
            b.getsampwidth(),
            b.getframerate(),
        )
        spec = (a.getnchannels(), a.getsampwidth(), a.getframerate())
        a_frames = a.readframes(a.getnframes()) if same else b""
        b_frames = b.readframes(b.getnframes()) if same else b""
    tmp = keep.with_name(".audio.merging.wav")  # ffmpeg picks the format from the suffix
    if same:
        with wave.open(str(tmp), "wb") as dst:
            dst.setnchannels(spec[0])
            dst.setsampwidth(spec[1])
            dst.setframerate(spec[2])
            dst.writeframes(a_frames + b_frames)
    else:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-nostdin",
                "-v",
                "error",
                "-i",
                str(keep),
                "-i",
                str(extra),
                "-filter_complex",
                "[0:a][1:a]concat=n=2:v=0:a=1",
                "-ac",
                str(spec[0]),
                "-ar",
                str(spec[2]),
                "-f",
                "wav",
                str(tmp),
            ],
            check=True,
        )
    tmp.replace(keep)


def sample_path(name: str) -> Path:
    """A replay file inside SAMPLES_DIR; KeyError for anything else (no traversal)."""
    root = config.SAMPLES_DIR.resolve()
    path = (root / name).resolve()
    if path.parent != root or path.suffix != ".wav" or not path.is_file():
        raise KeyError(name)
    return path


def session_audio(sid: str) -> tuple[Path, float | None]:
    """(path, end_s) of the audio a saved session heard: its own recording (mic sessions), else
    the sample file it replayed; replays of replays lead back to the original. end_s caps the
    replay at what the session actually heard (a replay stopped after 30 s of a 10 min sample);
    None means all of it. KeyError if there is no audio."""
    end: float | None = None
    for _ in range(8):
        if not isinstance(sid, str) or not SESSION_ID.fullmatch(sid):
            raise KeyError(sid)
        folder = config.DATA_DIR / "sessions" / sid
        if (folder / "audio.wav").is_file():
            return folder / "audio.wav", end
        try:
            meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
            src = meta["source"]
        except (OSError, ValueError, KeyError, TypeError):
            raise KeyError(sid) from None
        if not isinstance(src, dict):  # a session with no recorded source (older or imported): no audio
            raise KeyError(sid)
        heard = meta.get("duration_s")
        if isinstance(heard, int | float) and heard > 0:
            end = heard if end is None else min(end, heard)
        if src.get("kind") == "file":
            return sample_path(src["name"]), end
        if src.get("kind") != "session":
            raise KeyError(sid)
        nxt = src.get("id")
        if not isinstance(nxt, str):
            raise KeyError(sid)
        sid = nxt
    raise KeyError(sid)
