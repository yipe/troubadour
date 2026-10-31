"""Tonight's notebook: items to keep or dismiss, and the GM's pins."""

from typing import Annotated, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field, StringConstraints
from troubadour.server import deps

router = APIRouter()


class SaidBy(BaseModel):
    name: str
    player_id: str | None


class NotebookItem(BaseModel):
    id: str
    kind: Literal["fact", "update", "entry", "spelling"]
    text: str  # fact text; entry name; "Isolde → Ysolde"
    old: str | None  # update: the fact it replaces
    about: str | None  # entity name the fact is about
    entry_type: str | None
    said_by: SaidBy | None
    t: float | None  # session seconds of the source line
    line_id: str | None
    confidence: Literal["gm", "theory", "once"] | None
    count: int | None  # spelling: lines fixed tonight
    status: Literal["open", "kept", "dismissed"]


class Pin(BaseModel):
    id: str
    t: float
    text: str
    created_at: float  # epoch seconds


class Notebook(BaseModel):
    session_id: str | None
    items: list[NotebookItem]
    pins: list[Pin]
    updating: bool  # the notebook pass is running


class PinIn(BaseModel):
    t: float = Field(ge=0, le=86400)
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class StatusIn(BaseModel):
    status: Literal["open", "kept", "dismissed"]


@router.get("/api/session/notebook", response_model=Notebook)
def live_notebook():
    return deps.engine.notebook_json()


@router.post("/api/session/pins", response_model=Pin)
def add_pin(body: PinIn):
    return deps._call(deps.engine.add_pin, body.t, body.text)


@router.post("/api/session/notebook/{item_id}", response_model=NotebookItem)
def set_item_status(item_id: str, body: StatusIn):
    return deps._call(deps.engine.set_notebook_status, item_id, body.status)


@router.get("/api/sessions/{sid}/notebook", response_model=Notebook)
def saved_notebook(sid: str):
    return deps._call(deps.engine.saved_notebook, sid)
