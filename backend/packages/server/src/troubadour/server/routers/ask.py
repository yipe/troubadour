"""Ask a question about the campaign."""

from fastapi import APIRouter
from pydantic import BaseModel, Field
from troubadour.server import deps

router = APIRouter()


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=500)


@router.post("/api/campaign/ask")
def ask(body: AskIn):
    """A question about the campaign → answered in the background (`campaign.answer` events),
    from the open campaign's transcripts and notes."""
    return deps._call(deps.asker.ask, body.question).to_json()
