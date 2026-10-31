"""Saved sessions: list, merge, jobs over a recording, quality and audio."""

import json
import re
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Path
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from troubadour.core import settings, transcript
from troubadour.engine import improve, pipeline, session_audio
from troubadour.lore import pages
from troubadour.server import deps
from troubadour.server.models import CampaignJob
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


class UpgradeSession(BaseModel):
    id: str
    n: int | None  # the session's number, as in the list
    stale: list[str]  # steps an older Troubadour processed it with, in the order they run


class Upgrades(BaseModel):
    sessions: list[UpgradeSession]  # oldest first
    current: dict[str, int]  # every step's current version


class Scene(BaseModel):
    """A stretch of the session the write-up named, from its beats."""

    t: float  # seconds into the session where it starts
    title: str
    place: str | None  # a Place in the campaign glossary


class SavedSession(BaseModel):
    """One saved session's summary."""

    id: str
    kind: Literal["recording", "notes"]  # notes: imported notes standing in for a session (no audio, no transcript)
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


# Jobs whose title is a session id: they read the session's files and write them back when done.
SESSION_JOBS = ("improve", "retranscribe", "spelling", "incharacter", "refresh", "writeup", "recap")


def _recorded(sid: str) -> None:
    """409 for a notes-only session: it has no recording or transcript for a job to work on."""
    if deps._call(deps.engine.session_kind, sid) == "notes":
        raise HTTPException(409, "That session is imported notes: there is no recording or transcript to work on.")


def _not_busy(*sids: str) -> None:
    """409 while a queued or running job works on one of these sessions: moving, merging or restoring
    its files under the job would lose either the job's result or the change."""
    for job in deps.memory.list_jobs():
        if job["kind"] in SESSION_JOBS and job["title"] in sids and job["state"] in ("queued", "running"):
            raise HTTPException(409, "A job is working on this session. Wait for it to finish.")


@router.post("/api/sessions/merge", response_model=SavedSession)
def merge_sessions(body: SessionMergeIn):
    """Append the later of two saved sessions onto the earlier one. The later folder goes to
    sessions/.trash; `POST /api/sessions/{sid}/unmerge` undoes it."""
    with deps.campaign_gate:  # no job can start between the check and the move
        _not_busy(*body.ids)
        kept = _conflict(deps.engine.merge_sessions, body.ids)
    return _listed(kept["id"])


@router.post("/api/sessions/{sid}/unmerge", response_model=SavedSession)
def unmerge_session(sid: Annotated[str, Path(pattern=SESSION_PATTERN)]):
    """Undo the last merge into this session: its old transcript and recording come back, and so does the later session."""
    with deps.campaign_gate:
        _not_busy(sid)
        undone = _conflict(deps.engine.unmerge_session, sid)
    return _listed(undone["id"])


@router.delete("/api/sessions/{sid}", status_code=204)
def delete_session(sid: Annotated[str, Path(pattern=SESSION_PATTERN)]):
    """Move a saved session to sessions/.trash (the write-up note in the vault stays)."""
    with deps.campaign_gate:
        _not_busy(sid)
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
    record = transcript.without_fillers(json.loads(deps._call(deps.engine.session_file, sid, "json").read_text(encoding="utf-8")))
    body = transcript.markdown(record) if fmt == "md" else json.dumps(record, ensure_ascii=False, indent=1)
    return deps._download(body, sid, fmt)


@router.post("/api/sessions/{sid}/improve", response_model=CampaignJob)
def improve_transcript(sid: str):
    """Re-transcribe a saved session with what the campaign knows now (a background job; it
    waits while a live session runs). The original is kept as transcript.orig.json."""
    _recorded(sid)
    deps._call(deps.engine.session_file, sid, "json")
    deps._call(session_audio, sid)
    with deps.campaign_gate:
        deps._require_open_campaign(sid)
        return deps.memory.submit(
            "improve",
            sid,
            lambda job: deps.stamped(
                sid,
                "transcribe",
                lambda: improve.run(
                    job, deps.engine, sid, lambda: deps.memory.emit(job), model=settings.current()["whisper_improve"]
                ),
            ),
        ).to_json()


@router.post("/api/sessions/{sid}/retranscribe", response_model=CampaignJob)
def retranscribe(sid: str):
    """Re-assign who spoke each line from the recording. Words stay; hand-set speakers can move.
    The first original transcript is kept."""
    _recorded(sid)
    deps._call(deps.engine.session_file, sid, "json")
    deps._call(session_audio, sid)
    with deps.campaign_gate:
        deps._require_open_campaign(sid)
        return deps.memory.submit(
            "retranscribe",
            sid,
            lambda job: deps.stamped(
                sid, "speakers", lambda: improve.reassign_speakers(job, deps.engine, sid, lambda: deps.memory.emit(job))
            ),
        ).to_json()


@router.post("/api/sessions/{sid}/spelling", response_model=CampaignJob)
def fix_spellings(sid: str):
    """The spelling cleanup over a saved session (a background job; the original is kept)."""
    _recorded(sid)
    deps._call(deps.engine.session_file, sid, "json")
    with deps.campaign_gate:
        deps._require_open_campaign(sid)
        return deps.memory.submit(
            "spelling",
            sid,
            lambda job: deps.stamped(
                sid, "spelling", lambda: improve.fix_spellings(job, deps.engine, sid, lambda: deps.memory.emit(job))
            ),
        ).to_json()


@router.post("/api/sessions/{sid}/in-character", response_model=CampaignJob)
def estimate_in_character(sid: str):
    """Which of each player's lines were in character, read by the memory LLM (a background job;
    the original is kept)."""
    _recorded(sid)
    deps._call(deps.engine.session_file, sid, "json")
    with deps.campaign_gate:
        deps._require_open_campaign(sid)
        return deps.memory.submit(
            "incharacter",
            sid,
            lambda job: deps.stamped(
                sid, "in_character", lambda: improve.label_in_character(job, deps.engine, sid, deps.memory.llm)
            ),
        ).to_json()


def _idle() -> None:
    if deps.engine.status != "idle":
        raise HTTPException(409, "A session is running. Refreshing waits until it ends.")


def _refreshing(sid: str) -> bool:
    return any(
        j["kind"] == "refresh" and j["title"] == sid and j["state"] in ("queued", "running") for j in deps.memory.list_jobs()
    )


def _queue_refresh(sid: str, only_stale: bool):
    """Queue the pipeline for one session (the caller holds the campaign gate)."""
    return deps.memory.submit(
        "refresh",
        sid,
        lambda job: pipeline.refresh(job, pipeline.Run(deps.engine, deps.memory, sid), only_stale=only_stale),
    )


def _llm_ready(steps: list[pipeline.Step]) -> None:
    """Fail now, not minutes into the job, when a step needs a language model that can't answer."""
    if pipeline.llm_steps(steps) and (problem := deps.memory.llm.problem()) is not None:
        raise HTTPException(503, problem)


@router.post("/api/sessions/{sid}/refresh", response_model=CampaignJob)
def refresh_session(sid: Annotated[str, Path(pattern=SESSION_PATTERN)]):
    """Re-run every processing step that can run on a saved session (a background job of kind "refresh"):
    listening, speakers, spellings, talk time, in-character lines, the write-up, the review list, the recap.
    Originals are kept; confirmed facts are never changed. 409 while a session runs."""
    _idle()
    _recorded(sid)
    deps._call(deps.engine.session_file, sid, "json")
    _llm_ready(pipeline.make_plan(pipeline.Run(deps.engine, deps.memory, sid)))  # may ask the model server: not under the gate
    with deps.campaign_gate:
        deps._require_open_campaign(sid)
        if _refreshing(sid):
            raise HTTPException(409, "That session is already being refreshed.")
        return _queue_refresh(sid, only_stale=False).to_json()


@router.post("/api/sessions/refresh/{job_id}/cancel", status_code=204)
def cancel_refresh(job_id: Annotated[str, Path(pattern=r"^[0-9a-f]{8}$")]):
    """Stop a refresh before its next step. What already finished stays."""
    if not any(j["kind"] == "refresh" and j["id"] == job_id for j in deps.memory.list_jobs()):
        raise HTTPException(404, f"not found: {job_id}")
    pipeline.request_cancel(job_id)


@router.get("/api/sessions/upgrades", response_model=Upgrades)
def session_upgrades():
    """Sessions an older Troubadour processed, and the steps to redo (only those steps)."""
    todo = pipeline.upgradable(deps.engine, deps.memory)
    numbers = pages.session_numbers(deps.engine.list_sessions())
    return {
        "sessions": [{"id": sid, "n": numbers.get(sid), "stale": [s.name for s in steps]} for sid, steps in todo],
        "current": pipeline.current(),
    }


@router.post("/api/sessions/upgrade", response_model=list[CampaignJob])
def upgrade_sessions():
    """Queue the stale steps of every out-of-date session, oldest first, one session at a time. What was
    recorded survives a restart, so asking again continues where it stopped. 409 while a session runs."""
    _idle()
    _llm_ready([s for _, steps in pipeline.upgradable(deps.engine, deps.memory) for s in steps])  # not under the gate
    with deps.campaign_gate:  # the campaign may have changed meanwhile: work out the list again
        todo = [(sid, steps) for sid, steps in pipeline.upgradable(deps.engine, deps.memory) if not _refreshing(sid)]
        return [_queue_refresh(sid, only_stale=True).to_json() for sid, _ in todo]


class Restored(BaseModel):
    restored: str  # the session id


@router.post("/api/sessions/{sid}/restore", response_model=Restored)
def restore_transcript(sid: str):
    """Undo improvements: put the session's original transcript back."""
    _recorded(sid)
    deps._call(deps.engine.session_file, sid, "json")
    with deps.campaign_gate:
        _not_busy(sid)
        restored = improve.restore(deps.engine.sessions_dir() / sid, deps.engine._transcript_lock)
    if not restored:
        raise HTTPException(404, "this transcript was never improved")
    return {"restored": sid}


class SessionNotes(BaseModel):
    text: str


@router.get("/api/sessions/{sid}/notes", response_model=SessionNotes)
def session_notes(sid: Annotated[str, Path(pattern=SESSION_PATTERN)]):
    """What a notes-only session says: its vault page without the front matter and heading. 404 for a recording."""
    page = deps.memory.written_up().get(sid)
    if deps._call(deps.engine.session_kind, sid) != "notes" or page is None:
        raise HTTPException(404, f"not found: {sid}")
    root = deps.vault.root.resolve()
    path = (root / page).resolve()
    if not path.is_relative_to(root):
        raise HTTPException(404, f"not found: {sid}")
    try:
        body = path.read_text(encoding="utf-8")
    except OSError:
        raise HTTPException(404, f"not found: {sid}") from None
    body = re.sub(r"\A---\n.*?\n---\n", "", body, count=1, flags=re.S)
    return {"text": re.sub(r"\A\s*# .*\n", "", body, count=1).strip()}


@router.get("/api/sessions/{sid}/quality", response_model=dict[str, Any])
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
