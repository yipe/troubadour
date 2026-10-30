"""Saved sessions: list, merge, jobs over a recording, quality and audio."""

import json
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from troubadour.core import settings, transcript
from troubadour.engine import improve, session_audio
from troubadour.server import deps

router = APIRouter()


class SessionMergeIn(BaseModel):
    ids: list[str] = Field(min_length=2, max_length=2)


@router.get("/api/sessions")
def sessions():
    """Saved sessions (autosaved every few seconds and when a session ends), newest first."""
    return deps.engine.list_sessions()


@router.post("/api/sessions/merge")
def merge_sessions(body: SessionMergeIn):
    """Append the later of two saved sessions onto the earlier one. The later folder is removed."""
    return deps._call(deps.engine.merge_sessions, body.ids)


@router.get("/api/sessions/{sid}/transcript.{fmt}")
def saved_transcript(sid: str, fmt: Literal["md", "json"]):
    """Rendered from transcript.json, so records saved by older versions read like new ones."""
    record = transcript.without_fillers(json.loads(deps._call(deps.engine.session_file, sid, "json").read_text()))
    body = transcript.markdown(record) if fmt == "md" else json.dumps(record, ensure_ascii=False, indent=1)
    return deps._download(body, sid, fmt)


@router.post("/api/sessions/{sid}/improve")
def improve_transcript(sid: str):
    """Re-transcribe a saved session with what the campaign knows now (a background job; it
    waits while a live session runs). The original is kept as transcript.orig.json."""
    deps._call(deps.engine.session_file, sid, "json")
    deps._call(session_audio, sid)
    with deps.campaign_gate:
        deps._require_open_campaign(sid)
        return deps.memory.submit(
            "improve",
            sid,
            lambda job: improve.run(
                job, deps.engine, sid, lambda: deps.memory.emit(job), model=settings.current()["whisper_improve"]
            ),
        ).to_json()


@router.post("/api/sessions/{sid}/retranscribe")
def retranscribe(sid: str):
    """Re-assign who spoke each line from the recording. Words stay; hand-set speakers can move.
    The first original transcript is kept."""
    deps._call(deps.engine.session_file, sid, "json")
    deps._call(session_audio, sid)
    with deps.campaign_gate:
        deps._require_open_campaign(sid)
        return deps.memory.submit(
            "retranscribe", sid, lambda job: improve.reassign_speakers(job, deps.engine, sid, lambda: deps.memory.emit(job))
        ).to_json()


@router.post("/api/sessions/{sid}/spelling")
def fix_spellings(sid: str):
    """The spelling cleanup over a saved session (a background job; the original is kept)."""
    deps._call(deps.engine.session_file, sid, "json")
    with deps.campaign_gate:
        deps._require_open_campaign(sid)
        return deps.memory.submit(
            "spelling", sid, lambda job: improve.fix_spellings(job, deps.engine, sid, lambda: deps.memory.emit(job))
        ).to_json()


@router.post("/api/sessions/{sid}/in-character")
def estimate_in_character(sid: str):
    """Which of each player's lines were in character, read by the memory LLM (a background job;
    the original is kept)."""
    deps._call(deps.engine.session_file, sid, "json")
    with deps.campaign_gate:
        deps._require_open_campaign(sid)
        return deps.memory.submit(
            "incharacter", sid, lambda job: improve.label_in_character(job, deps.engine, sid, deps.memory.llm)
        ).to_json()


@router.post("/api/sessions/{sid}/restore")
def restore_transcript(sid: str):
    """Undo improvements: put the session's original transcript back."""
    deps._call(deps.engine.session_file, sid, "json")
    if not improve.restore(deps.engine.sessions_dir() / sid):
        raise HTTPException(404, "this transcript was never improved")
    return {"restored": sid}


@router.get("/api/sessions/{sid}/quality")
def session_quality(sid: str):
    """How good a recording is (levels, noise, rumble, per-speaker loudness, verdict)."""
    deps._call(deps.engine.session_file, sid, "json")
    return deps._call(deps.engine.session_quality, sid)


@router.get("/api/sessions/{sid}/audio.wav")
def saved_audio(sid: str):
    """A mic session's recording (Range supported, so the browser can seek)."""
    return FileResponse(
        deps._call(deps.engine.session_file, sid, "wav"), media_type="audio/wav", filename=f"troubadour-{sid}.wav"
    )
