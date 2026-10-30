"""The live session: start, pause, resume, stop and the live transcript download."""

import json
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
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


@router.get("/api/transcript.{fmt}")
def current_transcript(fmt: Literal["md", "json"]):
    """The current (or just finished) session, freshly rendered."""
    record = deps.engine.transcript_record()
    if record is None:
        raise HTTPException(404, "no session yet")
    body = transcript.markdown(record) if fmt == "md" else json.dumps(record, ensure_ascii=False, indent=1)
    return deps._download(body, record["session"]["id"], fmt)


@router.post("/api/session/start")
def start(body: StartIn):
    return deps._call(deps.engine.start, body.source.model_dump())


@router.post("/api/session/pause")
def pause():
    return deps.engine.pause()


@router.post("/api/session/resume")
def resume():
    return deps.engine.resume()


@router.post("/api/session/stop")
def stop():
    return deps.engine.stop()
