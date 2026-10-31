"""Post-session review: every suggestion a session produced, anchored to a transcript line (lore/review.py)."""

from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from pydantic import AfterValidator, BaseModel, StringConstraints
from troubadour.engine import SESSION_ID, pipeline
from troubadour.lore import review as lore
from troubadour.server import deps
from troubadour.server.routers.campaign import EntityName, FactSuggestionOut, Kind, _Out, one_line

router = APIRouter()


class SpellingOut(BaseModel):
    heard: str
    entity: str | None  # the glossary name it was heard for; null = a word the glossary doesn't know
    count: int


class EntryOut(BaseModel):
    name: str
    type: Kind
    description: str


class ReviewItem(BaseModel):
    id: str  # kind + key; stable
    kind: Literal["fact", "spelling", "entry"]
    line_id: str | None
    t: float | None
    status: Literal["open", "accepted", "rejected"]
    preaccepted: bool  # kept in the live notebook
    fact: FactSuggestionOut | None
    spelling: SpellingOut | None
    entry: EntryOut | None


class ReviewCounts(BaseModel):
    total: int
    done: int
    fact: int
    spelling: int
    entry: int


class Review(BaseModel):
    session_id: str
    written_up: bool
    items: list[ReviewItem]
    counts: ReviewCounts


class ReviewAction(BaseModel):
    action: Literal["accept", "reject"]
    text: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000), AfterValidator(one_line)] | None = (
        None  # edited fact; a new entry's name
    )
    about: EntityName | None = None  # a fact moved to this entry; null (given) = the campaign's facts


def _context(sid: str) -> lore.Context:
    if not SESSION_ID.fullmatch(sid) or deps.engine.session_campaign(sid) is None:
        raise HTTPException(404, f"not found: {sid}")
    deps._require_open_campaign(sid)
    rel = deps.memory.written_up().get(sid)
    return lore.Context(
        vault=deps.vault,
        session_dir=deps.engine.sessions_dir() / sid,
        campaign_sessions=deps.engine.campaign_sessions(),
        page=Path(rel).stem if rel else None,
        notebook=deps.engine.saved_notebook(sid)["items"],
    )


def _item(it: lore.Item, out: _Out) -> ReviewItem:
    return ReviewItem(
        id=it.id,
        kind=it.kind,
        line_id=it.line_id,
        t=it.t,
        status=it.status,
        preaccepted=it.preaccepted,
        fact=out.suggestion(it.fact) if it.fact else None,
        spelling=SpellingOut(heard=it.heard or "", entity=it.entity, count=it.count) if it.kind == "spelling" else None,
        entry=EntryOut(**it.entry) if it.entry else None,  # type: ignore[arg-type]
    )


@router.get("/api/sessions/{sid}/review", response_model=Review)
def get_review(sid: str):
    ctx = _context(sid)
    derived_now = not (ctx.session_dir / "review.json").is_file()
    items = lore.review(ctx)
    if derived_now and (ctx.session_dir / "review.json").is_file():
        # The list was just derived by the current rules; an older one is left for "Upgrade old sessions".
        pipeline.stamp(ctx.session_dir, pipeline.BY_NAME["review"], deps.engine._transcript_lock)
    out = _Out()
    return Review(
        session_id=sid,
        written_up=ctx.page is not None,
        items=[_item(i, out) for i in items],
        counts=ReviewCounts(**lore.counts(items)),
    )


@router.post("/api/sessions/{sid}/review/{item_id}", response_model=ReviewItem)
def review_item(sid: str, item_id: str, body: ReviewAction):
    ctx = _context(sid)
    try:
        it = deps._call(lore.act, ctx, item_id, body.action, body.text, body.about, "about" in body.model_fields_set)
    except lore.AlreadyDecided:
        raise HTTPException(409, "That item was already decided.") from None
    deps.memory.changed()
    return _item(it, _Out())
