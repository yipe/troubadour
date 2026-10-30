"""Players, the campaign picker and voice training."""

from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, StringConstraints
from troubadour.server import deps
from troubadour.server.models import Label

router = APIRouter()


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


Avatar = Annotated[str, StringConstraints(max_length=300_000, pattern=r"^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$")]


Color = Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]


class PlayerIn(BaseModel):
    name: Name
    character: Label = ""
    avatar: Avatar | None = None
    is_gm: bool = False


class PlayerPatch(BaseModel):
    name: Name | None = None
    character: Label | None = None
    avatar: Avatar | None = None
    is_gm: bool | None = None
    color: Color | None = None
    clone_ok: bool | None = None  # they agree to a voice clone; False deletes everything made from it


class SeatIn(BaseModel):
    character: Label | None = None  # unset: their seat before they left this campaign
    is_gm: bool | None = None


class CampaignIn(BaseModel):
    name: Name


class CampaignInfo(BaseModel):
    """A campaign: its own players' characters, notes (vault) and saved sessions."""

    id: str
    name: str


class CampaignsOut(BaseModel):
    campaign: str  # id of the open campaign
    campaigns: list[CampaignInfo]


class TrainIn(BaseModel):
    seconds: float = Field(20.0, ge=5, le=60)


@router.post("/api/players")
def add_player(body: PlayerIn):
    return deps.engine.add_player(body.name, body.character, body.avatar, body.is_gm)


@router.patch("/api/players/{pid}")
def update_player(pid: str, body: PlayerPatch):
    return deps._call(deps.engine.update_player, pid, body.model_dump(exclude_unset=True))


@router.delete("/api/players/{pid}", status_code=204)
def remove_player(pid: str):
    """Delete from the library: every campaign, voiceprints and training."""
    deps._call(deps.engine.remove_player, pid)


@router.post("/api/players/{pid}/seat")
def seat_player(pid: str, body: SeatIn):
    """A library player joins the open campaign (their voice training comes along)."""
    return deps._call(deps.engine.seat_player, pid, body.character, body.is_gm)


@router.post("/api/players/{pid}/bench", status_code=204)
def bench_player(pid: str):
    """Out of the open campaign, back to the library (training kept). Between sessions only."""
    with deps.campaign_gate:  # it saves the finished session for good: not while a job rewrites it
        if deps.memory.busy():
            raise HTTPException(400, "Wait for the campaign jobs to finish before removing a player.")
        deps._call(deps.engine.bench_player, pid)


@router.post("/api/campaigns", response_model=CampaignInfo)
def create_campaign(body: CampaignIn):
    return deps.engine.create_campaign(body.name)


@router.patch("/api/campaigns/{cid}", response_model=CampaignInfo)
def rename_campaign(cid: str, body: CampaignIn):
    return deps._call(deps.engine.rename_campaign, cid, body.name)


@router.post("/api/campaigns/{cid}/open", response_model=CampaignsOut)
def open_campaign(cid: str):
    """Switch campaigns (between sessions): players, voices, notes and History follow."""
    with deps.campaign_gate:
        if deps.memory.busy():
            raise HTTPException(400, "Wait for the campaign jobs to finish before switching campaigns.")
        out = deps._call(deps.engine.open_campaign, cid)
    deps.bus.emit("campaign.updated", {})  # the Campaign tab reloads from the new vault
    return out


@router.post("/api/players/{pid}/train", status_code=202)
def train(pid: str, body: TrainIn | None = None):
    deps._call(deps.engine.train, pid, (body or TrainIn()).seconds)
    return {"ok": True}


@router.post("/api/train/cancel", status_code=204)
def cancel_training():
    deps.engine.cancel_training()
