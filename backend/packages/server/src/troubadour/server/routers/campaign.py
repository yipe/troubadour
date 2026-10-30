"""Campaign memory: the glossary, facts, note import, write-ups and spelling suggestions."""

from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, StringConstraints
from troubadour.engine import SESSION_ID
from troubadour.lore import obsidian
from troubadour.lore.campaign import TYPES, mention_counts
from troubadour.lore.memory import spelling_suggestions
from troubadour.server import deps

router = APIRouter()


EntityName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


Term = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


Fact = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


Kind = Literal[tuple(TYPES)]  # type: ignore[valid-type]


class EntityIn(BaseModel):
    name: EntityName
    type: Kind = "term"
    description: str = Field("", max_length=4000)
    aliases: list[Term] = Field(default_factory=list, max_length=50)
    heard_as: list[Term] = Field(default_factory=list, max_length=100)


class EntityPatch(BaseModel):
    name: EntityName | None = None
    type: Kind | None = None
    status: Literal["confirmed", "suggested"] | None = None
    description: str | None = Field(None, max_length=4000)
    aliases: list[Term] | None = Field(None, max_length=50)
    heard_as: list[Term] | None = Field(None, max_length=100)
    heard_as_suggested: list[Term] | None = Field(None, max_length=100)
    heard_as_rejected: list[Term] | None = Field(None, max_length=500)
    facts: list[Fact] | None = Field(None, max_length=500)
    suggested_facts: list[Fact] | None = Field(None, max_length=500)


class ReviewIn(BaseModel):
    accept_spellings: list[Term] = Field(default_factory=list, max_length=100)
    reject_spellings: list[Term] = Field(default_factory=list, max_length=100)
    accept_facts: list[Fact] = Field(default_factory=list, max_length=100)
    reject_facts: list[Fact] = Field(default_factory=list, max_length=100)


class IgnoreIn(BaseModel):
    words: list[Term] = Field(min_length=1, max_length=100)


class MergeIn(BaseModel):
    into: EntityName


class FactIn(BaseModel):
    text: Fact
    suggested: bool = False


class FactsIn(BaseModel):
    facts: list[Fact] = Field(max_length=1000)


class ImportIn(BaseModel):
    title: str = Field("", max_length=120)
    text: str = Field(min_length=1, max_length=2_000_000)


def _entity(e, counts: dict[str, int] | None = None) -> dict:
    data = e.to_json(deps.vault.root)
    data["sessions"] = (counts if counts is not None else _mention_counts()).get(e.name, 0)
    return data


def _mention_counts() -> dict[str, int]:
    try:
        return mention_counts(deps.vault, deps.engine.sessions_dir())
    except OSError:
        return {}


@router.get("/api/campaign")
def campaign():
    """The whole glossary (a few hundred notes at most), campaign facts, jobs and write-ups."""
    counts = _mention_counts()
    return {
        "vault": str(deps.vault.root),
        "obsidian": obsidian.vault_for(deps.vault.root),  # None: Obsidian doesn't know this folder yet
        "types": list(TYPES),
        "entities": [_entity(e, counts) for e in deps.vault.entities()],
        "facts": deps.vault.campaign_facts(),
        "jobs": deps.memory.list_jobs(),
        "answers": deps.asker.list(),
        "written_up": deps.memory.written_up(),
        "ignored": deps.vault.ignored(),
    }


@router.post("/api/campaign/entities")
def create_entity(body: EntityIn):
    e = deps._call(
        deps.vault.create, body.name, body.type, description=body.description, aliases=body.aliases, heard_as=body.heard_as
    )
    deps.memory.changed()
    return _entity(e)


@router.get("/api/campaign/entities/{name}")
def get_entity(name: str):
    return _entity(deps._call(deps.vault.get, name))


@router.patch("/api/campaign/entities/{name}")
def update_entity(name: str, body: EntityPatch):
    e = deps._call(deps.vault.update, name, **body.model_dump(exclude_unset=True, exclude_none=True))
    deps.memory.changed()
    return _entity(e)


@router.delete("/api/campaign/entities/{name}", status_code=204)
def delete_entity(name: str):
    deps._call(deps.vault.delete, name)
    deps.memory.changed()


@router.post("/api/campaign/entities/{name}/review")
def review_entity(name: str, body: ReviewIn):
    """Accept or reject suggestions as changes (safe to click quickly; lists aren't replaced)."""
    e = deps._call(deps.vault.review, name, **body.model_dump())
    deps.memory.changed()
    return _entity(e)


@router.post("/api/campaign/entities/{name}/merge")
def merge_entity(name: str, body: MergeIn):
    e = deps._call(deps.vault.merge, name, body.into)
    deps.memory.changed()
    return _entity(e)


@router.post("/api/campaign/entities/{name}/facts/search")
def seek_facts(name: str):
    """Scrub transcripts and imported notes for lasting facts about this entry."""
    with deps.campaign_gate:
        return deps._call(deps.memory.seek_facts, name).to_json()


@router.post("/api/campaign/entities/{name}/facts")
def add_entity_fact(name: str, body: FactIn):
    e = deps._call(deps.vault.add_fact, name, body.text, body.suggested)
    deps.memory.changed()
    return _entity(e)


@router.put("/api/campaign/facts")
def set_campaign_facts(body: FactsIn):
    facts = deps.vault.set_campaign_facts(body.facts)
    deps.memory.changed()
    return facts


@router.post("/api/campaign/facts")
def add_campaign_fact(body: FactIn):
    facts = deps.vault.add_campaign_fact(body.text)
    deps.memory.changed()
    return facts


@router.post("/api/campaign/import")
def import_notes(body: ImportIn):
    """Pasted notes → a background job (progress arrives as campaign.job events)."""
    with deps.campaign_gate:
        return deps._call(deps.memory.import_notes, body.title, body.text).to_json()


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
        return deps._call(deps.memory.write_up, sid).to_json()


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
