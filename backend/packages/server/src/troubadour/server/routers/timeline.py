"""The story so far: one row per session for the Timeline page."""

from pathlib import Path
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel
from troubadour.lore import pages, timeline
from troubadour.lore.campaign import Vault
from troubadour.server import deps

router = APIRouter()

Kind = Literal["pc", "npc", "place", "faction", "item", "creature", "spell", "term"]


class NewEntity(BaseModel):
    name: str
    type: Kind


class TimelineSession(BaseModel):
    id: str
    n: int
    date: str  # YYYY-MM-DD, local time
    title: str | None  # the write-up's title, else the working title
    places: list[str]
    talk: dict[str, float]  # seconds per player id; unnamed voices under "voice:<id>"
    new_entities: list[NewEntity]  # confirmed entries first mentioned in this session
    facts_accepted: int  # confirmed facts sourced from this session


class TimelineOut(BaseModel):
    sessions: list[TimelineSession]  # newest first


def session_context() -> tuple[Vault, list[dict], dict[str, int]]:
    """The vault, the open campaign's saved sessions and their numbers (shared with the entity endpoint)."""
    rows = deps.engine.list_sessions()
    return deps.vault, rows, pages.session_numbers(rows)


@router.get("/api/campaign/timeline", response_model=TimelineOut)
def get_timeline():
    """Per-session places, talk, new entries and accepted facts. Reads transcripts once per change."""
    vault, rows, numbers = session_context()
    written = deps.memory.written_up()
    titles = {sid: pages.session_page(vault.root, rel)["title"] for sid, rel in written.items() if sid in numbers}
    ids_for = {Path(rel).stem: sid for sid, rel in written.items()}
    sessions = timeline.timeline(vault, deps.engine.sessions_dir(), rows, numbers, titles, ids_for)
    return {"sessions": sessions}
