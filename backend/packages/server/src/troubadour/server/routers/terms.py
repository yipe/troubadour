"""The D&D names the spelling cleanup knows: browse them, add your own, upload a list."""

import csv
import json
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field, StringConstraints
from troubadour.lore import dnd_terms
from troubadour.server import deps

router = APIRouter()

MAX_UPLOAD = 1_000_000
MAX_PAGE = 200
MAX_SKIPPED = 200  # the reasons shown back; a junk file must not return thousands of rows

Source = Literal["builtin", "local", "custom"]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=dnd_terms.MAX_NAME)]
Kind = Annotated[str, StringConstraints(max_length=20)]


class TermIn(BaseModel):
    name: Name
    type: Kind = "term"


class TermsIn(BaseModel):
    terms: list[TermIn] = Field(max_length=dnd_terms.MAX_CUSTOM)


class TermOut(BaseModel):
    name: str
    type: str
    source: Source


class TermCounts(BaseModel):
    builtin: int
    local: int
    custom: int


class TermsOut(BaseModel):
    counts: TermCounts
    items: list[TermOut]
    total: int  # matching the search and source, before paging


class Skipped(BaseModel):
    name: str
    reason: str


class AddedOut(BaseModel):
    added: int
    skipped: list[Skipped]
    more_skipped: int  # skipped beyond the first MAX_SKIPPED


def _effective() -> list[TermOut]:
    """Every name once, from the first list that has it (the order `dnd_terms.terms()` uses)."""
    seen: set[str] = set()
    out: list[TermOut] = []
    lists: list[tuple[Source, list[tuple[str, str]]]] = [
        ("custom", dnd_terms.custom()),
        ("local", dnd_terms.local()),
        ("builtin", dnd_terms.builtin()),
    ]
    for source, pairs in lists:
        for name, kind in pairs:
            if name.casefold() not in seen:
                seen.add(name.casefold())
                out.append(TermOut(name=name, type=kind, source=source))
    return out


@router.get("/api/terms", response_model=TermsOut)
def list_terms(
    q: Annotated[str, Query(max_length=60)] = "",
    source: Source | None = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE)] = 50,
):
    everything = _effective()
    counts = TermCounts(
        builtin=sum(t.source == "builtin" for t in everything),
        local=sum(t.source == "local" for t in everything),
        custom=sum(t.source == "custom" for t in everything),
    )
    needle = q.strip().casefold()
    hits = [t for t in everything if (source is None or t.source == source) and needle in t.name.casefold()]
    return TermsOut(counts=counts, items=hits[offset : offset + limit], total=len(hits))


def _add(pairs: list[tuple[str, str]]) -> AddedOut:
    added, skipped = dnd_terms.add_custom(pairs)
    shown = [Skipped(name=n, reason=r) for n, r in skipped[:MAX_SKIPPED]]
    return AddedOut(added=len(added), skipped=shown, more_skipped=len(skipped) - len(shown))


@router.post("/api/terms", response_model=AddedOut)
def add_terms(body: TermsIn):
    return _add([(t.name, t.type) for t in body.terms])


@router.delete("/api/terms/{name}", status_code=204)
def remove_term(name: str):
    deps._call(dnd_terms.remove_custom, name)


def _parse_upload(text: str) -> list[tuple[str, str]]:
    """JSON (`{"terms": [[name, type], ...]}` or a list of names), else one term per line,
    optionally `name,type`. A header row of `name,type` is ignored."""
    stripped = text.lstrip()
    if stripped[:1] in ("{", "["):
        try:
            data = json.loads(stripped)
            rows = data["terms"] if isinstance(data, dict) else data
            pairs = []
            for row in rows:
                if isinstance(row, str):
                    pairs.append((row, "term"))
                elif isinstance(row, (list, tuple)) and len(row) == 2 and all(isinstance(x, str) for x in row):
                    pairs.append((row[0], row[1]))
                elif isinstance(row, dict) and isinstance(row.get("name"), str):
                    pairs.append((row["name"], str(row.get("type") or "term")))
                else:
                    raise ValueError("unexpected entry")
            return pairs
        except (ValueError, KeyError, TypeError):
            raise HTTPException(400, "That JSON is not a list of terms.") from None
    pairs = []
    for row in csv.reader(text.splitlines()):
        if not row or not row[0].strip():
            continue
        name = row[0].strip()
        kind = row[1].strip().casefold() if len(row) > 1 and row[1].strip() else "term"
        if (name.casefold(), kind) == ("name", "type"):
            continue
        pairs.append((name, kind))
    return pairs


@router.post("/api/terms/upload", response_model=AddedOut)
async def upload_terms(request: Request):
    body = await request.body()
    if len(body) > MAX_UPLOAD:
        raise HTTPException(413, "That file is over 1 MB.")
    try:
        text = body.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(400, "That file is not UTF-8 text.") from None
    pairs = _parse_upload(text)
    if not pairs:
        raise HTTPException(400, "No terms found in that file.")
    return _add(pairs)
