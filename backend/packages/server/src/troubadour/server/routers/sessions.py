"""Saved sessions: list, merge, jobs over a recording, quality and audio."""

import json
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Path
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from troubadour.core import settings, transcript
from troubadour.engine import improve, session_audio
from troubadour.lore import pages
from troubadour.server import deps
from troubadour.server.routers.session import FileDesc, MicDesc, ReplayDesc

router = APIRouter()

SESSION_PATTERN = r"^\d{4}-\d{2}-\d{2}_\d{6}-[0-9a-f]{4}$"


class SessionMergeIn(BaseModel):
    ids: list[str] = Field(min_length=2, max_length=2)


class ReviewedIn(BaseModel):
    reviewed: bool


class ReviewedOut(BaseModel):
    id: str
    reviewed_at: float | None


class Scene(BaseModel):
    """A stretch of the session the write-up named, from its beats."""

    t: float  # seconds into the session where it starts
    title: str
    place: str | None  # a Place in the campaign glossary


class SavedSession(BaseModel):
    """One saved session's summary."""

    id: str
    n: int | None  # 1-based position among the campaign's sessions, oldest first (None: not listed)
    started_at: float  # epoch seconds
    source: Annotated[MicDesc | FileDesc | ReplayDesc, Field(discriminator="kind")] | None
    duration_s: float
    lines: int
    campaign: str | None = None
    audio: bool  # has its own mic recording
    replayable: bool  # its recording, or the sample file it replayed, still exists
    restorable: bool  # improved; the original transcript can be restored
    quality: Literal["good", "settings", "microphone"] | None  # None: not measured yet
    merged_from: list[str]  # ids of later sessions already appended onto this one
    title: str | None  # the write-up's title, else the working title
    summary: str | None  # first paragraph of the write-up's wrap-up
    present_player_ids: list[str] | None  # None: saved before this was recorded
    reviewed_at: float | None
    talk: dict[str, float]  # seconds per player id; unnamed voices under "voice:<id>"
    scenes: list[Scene] | None  # None: not written up (or the write-up's scenes call failed)


def _summaries(rows: list[dict]) -> list[dict]:
    """The engine's rows plus what the vault knows: the write-up's title and wrap-up, and each session's number."""
    numbers = pages.session_numbers(rows)
    written = deps.memory.written_up()
    out = []
    for row in rows:
        page = pages.session_page(deps.vault.root, written[row["id"]]) if row["id"] in written else {}
        out.append(
            {
                **row,
                "n": numbers.get(row["id"]),
                "title": page.get("title") or row["title"] or None,
                "summary": page.get("summary"),
            }
        )
    return out


@router.get("/api/sessions", response_model=list[SavedSession])
def sessions():
    """Saved sessions (autosaved every few seconds and when a session ends), newest first."""
    return _summaries(deps.engine.list_sessions())


def _listed(sid: str) -> dict:
    """One saved session's summary; 409 if it exists but isn't in the open campaign's list."""
    row = next((s for s in _summaries(deps.engine.list_sessions()) if s["id"] == sid), None)
    if row is None:
        raise HTTPException(409, "That session isn't in the open campaign.")
    return row


def _conflict(fn, *args):
    """deps._call, with 'nothing to undo' and 'that slot is taken' as 409."""
    try:
        return deps._call(fn, *args)
    except (FileNotFoundError, FileExistsError) as e:
        raise HTTPException(409, f"Can't do that: {e}") from None


@router.post("/api/sessions/merge", response_model=SavedSession)
def merge_sessions(body: SessionMergeIn):
    """Append the later of two saved sessions onto the earlier one. The later folder goes to
    sessions/.trash; `POST /api/sessions/{sid}/unmerge` undoes it."""
    kept = deps._call(deps.engine.merge_sessions, body.ids)
    return _listed(kept["id"])


@router.post("/api/sessions/{sid}/unmerge", response_model=SavedSession)
def unmerge_session(sid: Annotated[str, Path(pattern=SESSION_PATTERN)]):
    """Undo the last merge into this session: its old transcript and recording come back, and so does the later session."""
    return _listed(_conflict(deps.engine.unmerge_session, sid)["id"])


@router.delete("/api/sessions/{sid}", status_code=204)
def delete_session(sid: Annotated[str, Path(pattern=SESSION_PATTERN)]):
    """Move a saved session to sessions/.trash (the write-up note in the vault stays)."""
    deps._call(deps.engine.delete_session, sid)


@router.post("/api/sessions/{sid}/undelete", response_model=SavedSession)
def undelete_session(sid: Annotated[str, Path(pattern=SESSION_PATTERN)]):
    """Bring a deleted session back, if its id is free."""
    return _listed(_conflict(deps.engine.undelete_session, sid)["id"])


@router.post("/api/sessions/{sid}/reviewed", response_model=ReviewedOut)
def mark_reviewed(sid: str, body: ReviewedIn):
    """Mark a saved session as reviewed (or clear it)."""
    return {"id": sid, "reviewed_at": deps._call(deps.engine.set_reviewed, sid, body.reviewed)}


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
