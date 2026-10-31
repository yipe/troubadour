"""Campaign memory: the glossary, facts, note import, write-ups and spelling suggestions."""

import json
import re
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import AfterValidator, BaseModel, Field, StringConstraints
from troubadour.engine import SESSION_ID
from troubadour.lore import obsidian, timeline
from troubadour.lore.campaign import TYPES, Entity, SessionIndex, mention_counts
from troubadour.lore.facts import Confidence, Source, fact_id
from troubadour.lore.facts import Fact as FactModel
from troubadour.lore.memory import spelling_suggestions
from troubadour.lore.pages import session_numbers
from troubadour.server import deps
from troubadour.server.routers import timeline as timeline_router

router = APIRouter()


EntityName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


Term = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


def one_line(text: str) -> str:
    """A fact is one bullet in a note: a pasted line break would end it and strand the rest as prose."""
    return re.sub(r"\s+", " ", text).strip()


FactText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000), AfterValidator(one_line)]


def _plain_description(text: str | None) -> str | None:
    """A description sits between the title and the first `## ` heading of the note: a line that starts one
    (or a `---` rule) would split it, and its tail would be read back as a section of its own."""
    for line in (text or "").splitlines():
        if line.startswith("## ") or line.strip() == "---":
            raise ValueError("A description can't contain a line that starts with '## ' or is '---'.")
    return text


Description = Annotated[str, AfterValidator(_plain_description)]


FactId = Annotated[str, StringConstraints(min_length=1, max_length=40)]


Speaker = Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)]


# Spelled out so type checkers (and the generated TS types) see the members; a test keeps it equal to TYPES.
Kind = Literal["pc", "npc", "place", "faction", "item", "creature", "spell", "term"]


class FactSourceIn(BaseModel):
    session_id: str = Field(max_length=100)
    t: float | None = Field(None, ge=0, le=1_000_000)  # seconds into the session


class FactIn(BaseModel):
    text: FactText
    confidence: Confidence = "once"
    source: FactSourceIn | None = None
    said_by: Speaker | None = None


class EntityFactIn(FactIn):
    suggested: bool = False


class FactEdit(BaseModel):
    """Only the fields given change. A text change fixes a typo in place unless `as_update`."""

    fact_id: FactId
    text: FactText | None = None
    confidence: Confidence | None = None
    as_update: bool = False
    source: FactSourceIn | None = None
    said_by: Speaker | None = None


class EntityIn(BaseModel):
    name: EntityName
    type: Kind = "term"
    description: Description = Field("", max_length=4000)
    aliases: list[Term] = Field(default_factory=list, max_length=50)
    heard_as: list[Term] = Field(default_factory=list, max_length=100)


class EntityPatch(BaseModel):
    name: EntityName | None = None
    type: Kind | None = None
    status: Literal["confirmed", "suggested"] | None = None
    description: Description | None = Field(None, max_length=4000)
    aliases: list[Term] | None = Field(None, max_length=50)
    heard_as: list[Term] | None = Field(None, max_length=100)
    heard_as_suggested: list[Term] | None = Field(None, max_length=100)
    heard_as_rejected: list[Term] | None = Field(None, max_length=500)


class ReviewIn(BaseModel):
    accept_spellings: list[Term] = Field(default_factory=list, max_length=100)
    reject_spellings: list[Term] = Field(default_factory=list, max_length=100)
    accept_facts: list[FactId] = Field(default_factory=list, max_length=100)  # suggested fact ids
    reject_facts: list[FactId] = Field(default_factory=list, max_length=100)


class IgnoreIn(BaseModel):
    words: list[Term] = Field(min_length=1, max_length=100)


class MergeIn(BaseModel):
    into: EntityName


class ImportIn(BaseModel):
    title: str = Field("", max_length=120)
    text: str = Field(min_length=1, max_length=2_000_000)


class SaidByOut(BaseModel):
    name: str
    player_id: str | None  # a seated player whose name or character matches, else null


class FactSourceOut(BaseModel):
    page: str  # the vault page it came from: a session write-up or an imported note
    session_id: str | None  # null when the page is not a known session
    t: float | None
    label: str | None  # "S12 1:38"


class FactVersionOut(BaseModel):
    text: str
    said_by: SaidByOut | None
    source: FactSourceOut | None
    confidence: Confidence


class FactOut(FactVersionOut):
    id: str
    about: str | None  # the entry's name; null for a campaign fact
    history: list[FactVersionOut]  # older wordings, newest first


class FactSuggestionOut(FactOut):
    kind: Literal["new", "update"]
    replaces: str | None  # id of the fact an update would replace


class AppearanceOut(BaseModel):
    session_id: str
    n: int
    count: int  # times the entry is named in that session's transcript


class EntityOut(BaseModel):
    name: str
    type: Kind
    aliases: list[str]
    heard_as: list[str]
    heard_as_suggested: list[str]
    heard_as_rejected: list[str]
    status: Literal["confirmed", "suggested"]
    description: str
    facts: list[FactOut]
    suggested_facts: list[FactSuggestionOut]
    path: str | None
    read_only: bool
    sessions: int
    appearances: list[AppearanceOut] | None = None  # only the single-entry GET fills this in


class ObsidianVaultOut(BaseModel):
    id: str
    folder: str


class CampaignOut(BaseModel):
    vault: str
    obsidian: ObsidianVaultOut | None
    types: list[Kind]
    entities: list[EntityOut]
    facts: list[FactOut]
    jobs: list[dict[str, Any]]
    answers: list[dict[str, Any]]
    written_up: dict[str, str]
    ignored: list[str]


def _session_index() -> SessionIndex:
    """Session numbers (pages.session_numbers: oldest first, merged-away ones skipped) and page names."""
    metas = []
    for folder in deps.engine.campaign_sessions():
        try:
            meta = json.loads((folder / "meta.json").read_text())
            metas.append(
                {
                    "id": str(meta["id"]),
                    "started_at": float(meta.get("started_at") or 0),
                    "merged_from": meta.get("merged_from") or [],
                }
            )
        except (OSError, ValueError, KeyError, TypeError):
            continue
    page_for = {sid: Path(rel).stem for sid, rel in deps.memory.written_up().items()}
    return SessionIndex(
        ids_for={page: sid for sid, page in page_for.items()},
        numbers=session_numbers(metas),
        page_for=page_for,
    )


# Vault is built in deps.py, which knows nothing of sessions; this is where its fact links learn them.
deps.vault.sessions = _session_index


class _Out:
    """Turns facts into API shapes, with one session index and one player list for the whole response."""

    def __init__(self) -> None:
        self.index = deps.vault.index()
        self.players = {}
        for p in deps.engine.players.values():
            for name in (p.name, p.character):
                if name.strip():
                    self.players.setdefault(name.strip().casefold(), p.id)

    def said_by(self, name: str | None) -> SaidByOut | None:
        return SaidByOut(name=name, player_id=self.players.get(name.casefold())) if name else None

    def source(self, src: Source | None) -> FactSourceOut | None:
        if src is None:
            return None
        sid = src.session_id or self.index.ids_for.get(src.session_page)
        n = self.index.numbers.get(sid) if sid else None
        label = src.label
        if n is not None:
            label = f"S{n}" if src.t is None else f"S{n} {int(src.t) // 3600}:{int(src.t) % 3600 // 60:02d}"
        return FactSourceOut(page=src.session_page, session_id=sid, t=src.t, label=label)

    def fact(self, f: FactModel) -> FactOut:
        return FactOut(
            id=f.id,
            text=f.text,
            about=f.about,
            said_by=self.said_by(f.said_by),
            source=self.source(f.source),
            confidence=f.confidence,
            history=[
                FactVersionOut(
                    text=v.text, said_by=self.said_by(v.said_by), source=self.source(v.source), confidence=v.confidence
                )
                for v in f.history
            ],
        )

    def suggestion(self, f: FactModel) -> FactSuggestionOut:
        replaces = fact_id(f.about, f.replaces) if f.replaces else None
        return FactSuggestionOut(**self.fact(f).model_dump(), kind="update" if replaces else "new", replaces=replaces)

    def entity(self, e: Entity, counts: dict[str, int]) -> EntityOut:
        return EntityOut(
            name=e.name,
            type=e.type,  # type: ignore[arg-type]
            aliases=e.aliases,
            heard_as=e.heard_as,
            heard_as_suggested=e.heard_as_suggested,
            heard_as_rejected=e.heard_as_rejected,
            status=e.status,  # type: ignore[arg-type]
            description=e.description,
            facts=[self.fact(f) for f in e.facts],
            suggested_facts=[self.suggestion(f) for f in e.suggested_facts],
            path=str(e.path.relative_to(deps.vault.root)) if e.path else None,
            read_only=e.read_only,
            sessions=counts.get(e.name, 0),
        )


def _entity(e: Entity, counts: dict[str, int] | None = None) -> EntityOut:
    return _Out().entity(e, counts if counts is not None else _mention_counts())


def _facts_out(facts: list[FactModel]) -> list[FactOut]:
    out = _Out()
    return [out.fact(f) for f in facts]


def _new_fact(body: FactIn, about: str | None) -> FactModel:
    return FactModel(body.text, about, body.said_by or None, _source(body.source), body.confidence)


def _source(src: FactSourceIn | None) -> Source | None:
    if src is None:
        return None
    page = deps.vault.index().page_for.get(src.session_id)
    if page is None:
        raise HTTPException(400, f"No write-up page for session {src.session_id}.")
    return Source(page, src.session_id, src.t)


def _mention_counts() -> dict[str, int]:
    try:
        return mention_counts(deps.vault, deps.engine.sessions_dir())
    except OSError:
        return {}


@router.get("/api/campaign", response_model=CampaignOut)
def campaign():
    """The whole glossary (a few hundred notes at most), campaign facts, jobs and write-ups."""
    counts = _mention_counts()
    out = _Out()
    return {
        "vault": str(deps.vault.root),
        "obsidian": obsidian.vault_for(deps.vault.root),  # None: Obsidian doesn't know this folder yet
        "types": list(TYPES),
        "entities": [out.entity(e, counts) for e in deps.vault.entities()],
        "facts": [out.fact(f) for f in deps.vault.campaign_facts()],
        "jobs": deps.memory.list_jobs(),
        "answers": deps.asker.list(),
        "written_up": deps.memory.written_up(),
        "ignored": deps.vault.ignored(),
    }


@router.post("/api/campaign/entities", response_model=EntityOut)
def create_entity(body: EntityIn):
    e = deps._call(
        deps.vault.create, body.name, body.type, description=body.description, aliases=body.aliases, heard_as=body.heard_as
    )
    deps.memory.changed()
    return _entity(e)


@router.get("/api/campaign/entities/{name}", response_model=EntityOut)
def get_entity(name: str):
    """One entry, with how often it is named in each saved session (oldest first, zeros included)."""
    e = deps._call(deps.vault.get, name)
    vault, rows, numbers = timeline_router.session_context()
    out = _entity(e)
    out.appearances = [AppearanceOut(**a) for a in timeline.appearances(vault, deps.engine.sessions_dir(), rows, numbers, e.name)]
    return out


@router.patch("/api/campaign/entities/{name}", response_model=EntityOut)
def update_entity(name: str, body: EntityPatch):
    e = deps._call(deps.vault.update, name, **body.model_dump(exclude_unset=True, exclude_none=True))
    deps.memory.changed()
    return _entity(e)


@router.delete("/api/campaign/entities/{name}", status_code=204)
def delete_entity(name: str):
    deps._call(deps.vault.delete, name)
    deps.memory.changed()


@router.post("/api/campaign/entities/{name}/review", response_model=EntityOut)
def review_entity(name: str, body: ReviewIn):
    """Accept or reject suggestions as changes (safe to click quickly; lists aren't replaced)."""
    e = deps._call(deps.vault.review, name, **body.model_dump())
    deps.memory.changed()
    return _entity(e)


@router.post("/api/campaign/entities/{name}/merge", response_model=EntityOut)
def merge_entity(name: str, body: MergeIn):
    e = deps._call(deps.vault.merge, name, body.into)
    deps.memory.changed()
    return _entity(e)


@router.post("/api/campaign/entities/{name}/facts/search")
def seek_facts(name: str):
    """Scrub transcripts and imported notes for lasting facts about this entry."""
    with deps.campaign_gate:
        return deps._call(deps.memory.seek_facts, name).to_json()


@router.post("/api/campaign/entities/{name}/facts", response_model=EntityOut)
def add_entity_fact(name: str, body: EntityFactIn):
    e = deps._call(deps.vault.add_fact, name, _new_fact(body, name), body.suggested)
    deps.memory.changed()
    return _entity(e)


def _edits(body: FactEdit) -> dict:
    return {
        "text": body.text,
        "confidence": body.confidence,
        "as_update": body.as_update,
        "said_by": body.said_by,
        "source": _source(body.source),
    }


@router.patch("/api/campaign/entities/{name}/facts", response_model=EntityOut)
def edit_entity_fact(name: str, body: FactEdit):
    e = deps._call(deps.vault.edit_fact, name, body.fact_id, **_edits(body))
    deps.memory.changed()
    return _entity(e)


@router.delete("/api/campaign/entities/{name}/facts/{fact_id}", response_model=EntityOut)
def delete_entity_fact(name: str, fact_id: str):
    e = deps._call(deps.vault.delete_fact, name, fact_id)
    deps.memory.changed()
    return _entity(e)


@router.post("/api/campaign/facts", response_model=list[FactOut])
def add_campaign_fact(body: FactIn):
    facts = deps._call(deps.vault.add_campaign_fact, _new_fact(body, None))
    deps.memory.changed()
    return _facts_out(facts)


@router.patch("/api/campaign/facts", response_model=list[FactOut])
def edit_campaign_fact(body: FactEdit):
    facts = deps._call(deps.vault.edit_campaign_fact, body.fact_id, **_edits(body))
    deps.memory.changed()
    return _facts_out(facts)


@router.delete("/api/campaign/facts/{fact_id}", response_model=list[FactOut])
def delete_campaign_fact(fact_id: str):
    facts = deps._call(deps.vault.delete_campaign_fact, fact_id)
    deps.memory.changed()
    return _facts_out(facts)


@router.post("/api/campaign/import")
def import_notes(body: ImportIn):
    """Pasted notes → a background job (progress arrives as campaign.job events)."""
    with deps.campaign_gate:
        return deps._call(deps.memory.import_notes, body.title, body.text).to_json()


def _queue_write_up(sid: str):
    """Memory.write_up, with the job recording the pipeline step so the session isn't offered an upgrade."""
    record = json.loads((deps.memory.sessions_dir() / sid / "transcript.json").read_text())
    return deps.memory.submit("writeup", sid, lambda job: deps.stamped(sid, "writeup", lambda: deps.memory._write_up(job, record)))  # noqa: SLF001


@router.post("/api/campaign/writeup/{sid}")
def write_up(sid: str):
    if not SESSION_ID.fullmatch(sid):
        raise HTTPException(404, "not found")
    with deps.campaign_gate:
        deps._require_open_campaign(sid)
    if not (deps.memory.sessions_dir() / sid / "transcript.json").is_file():
        raise HTTPException(404, f"not found: {sid}")
    # Fail now, not minutes into the job, when the write-up's model can't answer.
    if (problem := deps.memory.llm.problem()) is not None:
        raise HTTPException(503, problem)
    with deps.campaign_gate:
        deps._require_open_campaign(sid)
        return deps._call(_queue_write_up, sid).to_json()


@router.post("/api/campaign/ignore")
def ignore_words(body: IgnoreIn):
    """Never suggest these words as names again (kept in the vault's "Ignored words" note)."""
    words = deps.vault.ignore(body.words)
    deps.memory.changed()
    return words


@router.delete("/api/campaign/ignore/{word}")
def unignore_word(word: str):
    words = deps.vault.unignore(word)
    deps.memory.changed()
    return words


@router.get("/api/campaign/suggestions")
def suggestions():
    """Transcript words that look like misspelled glossary names, and unknown names heard."""
    return spelling_suggestions(deps.vault, deps.engine.campaign_sessions())
