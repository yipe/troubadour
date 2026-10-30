"""Voices and who spoke a line."""

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel, Field
from troubadour.server import deps
from troubadour.server.models import Label

router = APIRouter()


class AssignIn(BaseModel):
    player_id: str = Field(max_length=40)
    character: Label | None = None


@router.post("/api/voices/{vid}/assign")
def assign(vid: str, body: AssignIn):
    return deps._call(deps.engine.assign_voice, vid, body.player_id, body.character)


@router.post("/api/voices/{vid}/unassign")
def unassign(vid: str):
    return deps._call(deps.engine.unassign_voice, vid)


@router.post("/api/messages/{mid}/speaker")
def assign_message(mid: str, body: AssignIn):
    """Who spoke this one line (it stays theirs; its voiceprint teaches their voice)."""
    return deps._call(deps.engine.assign_message, mid, body.player_id, body.character)


@router.get("/api/voices/{vid}/sample.wav")
def voice_sample(vid: str):
    return Response(deps._call(deps.engine.voice_sample, vid), media_type="audio/wav", headers={"Cache-Control": "no-store"})
