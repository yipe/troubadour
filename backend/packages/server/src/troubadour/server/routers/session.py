"""The live session: start, pause, resume, stop and the live transcript download."""

import json
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, StringConstraints
from troubadour.core import config, transcript
from troubadour.server import deps

router = APIRouter()


class MicIn(BaseModel):
    kind: Literal["mic"]
    device: str | None = Field(None, max_length=200)


class FileIn(BaseModel):
    kind: Literal["file"]
    name: str = Field(max_length=200)
    speed: float = Field(1.0, ge=0.5, le=config.MAX_REPLAY_SPEED)


class SessionIn(BaseModel):
    """Replay a saved session's audio through the pipeline."""

    kind: Literal["session"]
    id: str = Field(max_length=40)
    speed: float = Field(1.0, ge=0.5, le=config.MAX_REPLAY_SPEED)


class StartIn(BaseModel):
    source: Annotated[MicIn | FileIn | SessionIn, Field(discriminator="kind")]
    title: Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)] = ""
    present_player_ids: list[Annotated[str, Field(max_length=40)]] = Field(default_factory=list, max_length=32)
    record_audio: bool | None = None  # None: the TROUBADOUR_RECORD setting
    cleanup: bool | None = None  # None: the TROUBADOUR_CLEANUP setting


class MicDesc(BaseModel):
    kind: Literal["mic"]
    device: str | None
    device_name: str | None = None


class FileDesc(BaseModel):
    kind: Literal["file"]
    name: str
    speed: float


class ReplayDesc(BaseModel):
    kind: Literal["session"]
    id: str
    speed: float


class LlmStatus(BaseModel):
    url: str
    model: str
    ok: bool


class AsrStatus(BaseModel):
    """Whisper and the voice models, loaded once at start-up."""

    model: str
    state: Literal["loading", "ready", "error"]


class TrainingStatus(BaseModel):
    player_id: str


class Session(BaseModel):
    """The live session: what is running, from which source, and the engine's health."""

    status: Literal["idle", "running", "paused", "stopping"]
    source: Annotated[MicDesc | FileDesc | ReplayDesc, Field(discriminator="kind")] | None
    t: float
    llm: LlmStatus
    audio_monitor: bool
    title: str
    present_player_ids: list[str]
    asr: AsrStatus
    training: TrainingStatus | None
    error: str | None


@router.get("/api/transcript.{fmt}")
def current_transcript(fmt: Literal["md", "json"]):
    """The current (or just finished) session, freshly rendered."""
    record = deps.engine.transcript_record()
    if record is None:
        raise HTTPException(404, "no session yet")
    body = transcript.markdown(record) if fmt == "md" else json.dumps(record, ensure_ascii=False, indent=1)
    return deps._download(body, record["session"]["id"], fmt)


@router.post("/api/session/start", response_model=Session)
def start(body: StartIn):
    return deps._call(
        deps.engine.start,
        body.source.model_dump(),
        title=body.title,
        present_player_ids=body.present_player_ids,
        record_audio=body.record_audio,
        cleanup=body.cleanup,
    )


@router.post("/api/session/pause", response_model=Session)
def pause():
    return deps.engine.pause()


@router.post("/api/session/resume", response_model=Session)
def resume():
    return deps.engine.resume()


@router.post("/api/session/stop", response_model=Session)
def stop():
    return deps.engine.stop()
