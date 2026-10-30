"""Microphones, the mic test, the level monitor and sample files."""

import wave
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from troubadour.core import config
from troubadour.engine import sample_path
from troubadour.server import deps
from troubadour.sound import mics
from troubadour.sound.audio import list_mics

router = APIRouter()


class MicSpecsIn(BaseModel):
    """Corrections to what Troubadour knows about a mic (the OS can't report pattern or capsule)."""

    model: str | None = Field(None, max_length=80)
    capsule: Literal["dynamic", "condenser", "array"] | None = None
    patterns: (
        list[Literal["omni", "cardioid", "supercardioid", "hypercardioid", "figure-8", "stereo", "boundary", "beamforming"]]
        | None
    ) = Field(None, max_length=8)
    wireless: bool | None = None
    notes: str | None = Field(None, max_length=300)


class MicTestIn(BaseModel):
    device: str | None = Field(None, max_length=200)
    seconds: float = Field(20.0, ge=3, le=120)


class AudioMonitorIn(BaseModel):
    on: bool


def _sample_files() -> list[dict]:
    files = []
    for path in sorted(config.SAMPLES_DIR.glob("*.wav")):
        try:
            with wave.open(str(path)) as w:
                duration = w.getnframes() / w.getframerate()
        except (wave.Error, EOFError, OSError):
            continue  # not a PCM wav we can describe; skip it
        files.append({"name": path.name, "duration": round(duration, 1), "audio_url": f"/api/files/{path.name}"})
    return files


@router.get("/api/mics")
def list_mic_details():
    """Every input: what macOS reports, specs (catalog or yours), measurements, ✓/✗ checklist."""
    return mics.describe(deps.engine.sessions_dir())


@router.patch("/api/mics/{name}")
def correct_mic(name: str, body: MicSpecsIn):
    if len(name) > 200:
        raise HTTPException(422, "name too long")
    mics.set_override(name, body.model_dump(exclude_unset=True))
    return next(
        (m for m in mics.describe(deps.engine.sessions_dir()) if m["name"] == name), {"name": name, "specs": mics.specs(name)}
    )


@router.post("/api/mic/test")
def mic_test(body: MicTestIn):
    """Level meter and quality for the mic without a session (events: audio.level, audio.quality, mic.test)."""
    return deps._call(deps.engine.mic_test, body.device, body.seconds)


@router.post("/api/mic/test/stop")
def stop_mic_test():
    return deps.engine.stop_mic_test()


@router.put("/api/audio/monitor")
def audio_monitor(body: AudioMonitorIn):
    """Switch the live session's level + quality read-out on or off (reported as session.audio_monitor)."""
    deps.engine.set_audio_monitor(body.on)
    return {"on": body.on}


@router.get("/api/sources")
def sources():
    return {"files": _sample_files(), "mics": list_mics()}


@router.get("/api/files/{name}")
def sample_file(name: str):
    return FileResponse(deps._call(sample_path, name), media_type="audio/wav")  # supports Range for seeking
