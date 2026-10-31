"""Request models shared by more than one router."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, StringConstraints

Label = Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)]


class CampaignJob(BaseModel):
    """A background job as `campaign.job` sends it (lore `Job.to_json`); every job-queuing endpoint returns one."""

    id: str
    kind: str
    title: str  # notes title; the session id for a write-up, improve or recap; the player for a clone
    state: Literal["queued", "running", "done", "error"]
    done: int
    total: int
    message: str
    created: list[str]
    updated: list[str]
    skipped: list[str] = []
    suggested: int
    note: str | None
    player_id: str | None
    steps: list[dict[str, Any]]
    live: dict[str, Any] | None
    snippets: list[dict[str, Any]]
