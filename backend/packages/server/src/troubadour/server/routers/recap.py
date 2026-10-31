"""A session's recap to share: build it as a background job, read the stored one."""

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from troubadour.engine import SESSION_ID
from troubadour.lore import recap
from troubadour.server import deps

router = APIRouter()


class RecapInclude(BaseModel):
    happened: bool
    quote: bool
    moments: bool
    questions: bool


class RecapIn(BaseModel):
    voice: Literal["narrator", "chronicle", "bullets"]
    length_s: int = Field(ge=15, le=120)
    include: RecapInclude


class RecapQuote(BaseModel):
    text: str
    speaker: str  # the character's name when the player has one
    player_id: str
    t: float  # session seconds


class RecapMoment(BaseModel):
    player_id: str
    text: str


class Recap(BaseModel):
    title: str
    body: str
    quote: RecapQuote | None
    moments: list[RecapMoment]
    questions: list[str]
    options: RecapIn  # what it was built with
    built_at: float  # epoch seconds


class RecapJob(BaseModel):
    """The job as `campaign.job` sends it (the web's `CampaignJob`)."""

    id: str
    kind: str
    title: str  # the session id
    state: Literal["queued", "running", "done", "error"]
    done: int
    total: int
    message: str
    created: list[str]
    updated: list[str]
    suggested: int
    note: str | None
    player_id: str | None
    steps: list[dict[str, Any]]
    live: dict[str, Any] | None
    snippets: list[dict[str, Any]]


def _saved(sid: str) -> None:
    if not SESSION_ID.fullmatch(sid):
        raise HTTPException(404, f"not found: {sid}")
    deps._require_open_campaign(sid)


@router.post("/api/sessions/{sid}/recap", response_model=RecapJob)
def build_recap(sid: str, body: RecapIn):
    """Write the recap from the session page and its reviewed facts (a background job; progress arrives as
    campaign.job events). 409 while one is already running for this session."""
    options = recap.Options(body.voice, body.length_s, recap.Include(**body.include.model_dump()))
    # Fail now, not minutes into the job, when the model can't answer. Asked before taking the gate: the check
    # can wait on the network, and a campaign switch must not queue behind it.
    if (problem := deps.memory.llm.problem()) is not None:
        raise HTTPException(503, problem)
    with deps.campaign_gate:
        _saved(sid)
        if not (deps.memory.sessions_dir() / sid / "transcript.json").is_file():
            raise HTTPException(404, f"not found: {sid}")
        try:
            return deps._call(recap.start, deps.memory, deps.memory.sessions_dir(), sid, options).to_json()
        except RuntimeError as e:
            raise HTTPException(409, str(e)) from None


@router.get("/api/sessions/{sid}/recap", response_model=Recap | None)
def get_recap(sid: str):
    """The stored recap, or null when none was built yet."""
    _saved(sid)
    return recap.read(deps.memory.sessions_dir(), sid)
