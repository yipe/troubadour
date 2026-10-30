"""Ask a question about the campaign."""

from typing import Literal

from fastapi import APIRouter, Path
from pydantic import BaseModel, Field
from troubadour.server import deps

router = APIRouter()


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    t: float | None = Field(default=None, ge=0, le=86400)  # live session seconds when asked


class AnswerSource(BaseModel):
    id: str  # "S1"…, as the model cited it
    kind: Literal["transcript", "entry", "note"]
    label: str
    session: str | None  # transcript: saved session id
    t: float | None  # transcript: seconds into the session
    path: str | None  # entry or note: vault-relative
    entry: str | None  # entry: its name
    excerpt: str


class AnswerStats(BaseModel):
    seconds: float  # how long the answer took; 0 while searching
    transcripts: int  # sessions in the searched corpus
    notes: int  # notes and glossary entries in the searched corpus


class CampaignAnswer(BaseModel):
    id: str
    question: str
    campaign: str | None
    state: Literal["queued", "searching", "thinking", "done", "error"]
    answer: str
    found: bool
    sources: list[AnswerSource]
    message: str
    created: float
    t: float | None
    stats: AnswerStats | None  # null until the corpus is counted


@router.post("/api/campaign/ask", response_model=CampaignAnswer)
def ask(body: AskIn):
    """A question about the campaign → answered in the background (`campaign.answer` events),
    from the open campaign's transcripts and notes."""
    return deps._call(deps.asker.ask, body.question, body.t).to_json()


@router.delete("/api/campaign/answers/{answer_id}", status_code=204)
def delete_answer(answer_id: str = Path(pattern=r"^[0-9a-f]{8}$")):
    """Forget a past question of the open campaign."""
    deps._call(deps.asker.delete, answer_id)
