"""Vault format v1: the structured pages Troubadour Cloud reads to show the app's Timeline and Recaps.

Everything the cloud needs beyond the notes rides in YAML front matter, so it is versioned with each backup,
shows in Obsidian, and needs no second upload channel. Two kinds of page, both under `_Overview/` and both
rebuilt on every backup (they carry the `troubadour: generated` marker):

- `_Overview/Timeline.md` (`type: timeline`): the players at the table and one row per session, newest first,
  exactly what the app's Timeline shows.
- `_Overview/Recaps/<session page>.md` (`type: recap`): a session's recap. The verbatim quote is written only
  when the campaign backs up its transcripts: it is a line of the transcript.

Front-matter values are JSON (valid YAML flow style), one session per line, so no YAML writer is needed and
diffs stay readable. `shared/test-vectors/vault-format.json` pins the exact output for both sides.
"""

import json
from typing import Any

from troubadour.cloud.overview import FOLDER, MARKER, NOTICE, RECAPS

FORMAT = 1


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(", ", ": "))


def _front(kind: str, fields: dict[str, Any], lists: dict[str, list[Any]] | None = None) -> str:
    out = ["---", MARKER, f"type: {kind}", f"troubadour_format: {FORMAT}"]
    out += [f"{key}: {_json(value)}" for key, value in fields.items()]
    for key, items in (lists or {}).items():
        out += [f"{key}: []"] if not items else [f"{key}:", *(f"  - {_json(item)}" for item in items)]
    return "\n".join([*out, "---", ""])


def players_json(players: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The table's people, as the cloud colours and names them (`class` picks the colour unless `color` is set)."""
    return [
        {
            "id": p["id"],
            "name": p["name"],
            "character": p.get("character") or "",
            "gm": bool(p.get("is_gm")),
            "class": p.get("dnd_class"),
            "color": p.get("color"),
        }
        for p in players
    ]


def timeline_page(timeline: list[dict[str, Any]], players: list[dict[str, Any]], pages: dict[str, str]) -> str:
    """`timeline` is lore.timeline.timeline() output (newest first); `pages` maps session id to its write-up page."""
    rows = [
        {
            "id": r["id"],
            "n": r["n"],
            "kind": r.get("kind", "recording"),
            "date": r["date"],
            "title": r.get("title"),
            "page": pages.get(r["id"]),
            "places": r.get("places", []),
            "talk": {k: round(v, 1) for k, v in r.get("talk", {}).items()},
            "new_entities": r.get("new_entities", []),
            "facts_accepted": r.get("facts_accepted", 0),
        }
        for r in timeline
    ]
    body = ["# Timeline", "", f"*{NOTICE}*", ""]
    for r in rows:
        title = f"[[{r['page']}|{r['title'] or r['page']}]]" if r["page"] else (r["title"] or "Untitled session")
        where = f" · {', '.join(r['places'])}" if r["places"] else ""
        body.append(f"- **S{r['n']}** {r['date']} {title}{where}")
    return _front("timeline", {}, {"players": players_json(players), "sessions": rows}) + "\n".join(body) + "\n"


def recap_page(sid: str, page: str, recap: dict[str, Any], names: dict[str, str], include_quote: bool) -> str:
    """One stored recap (lore.recap's recap.json) as a note beside its session; `names` maps player id to name."""
    quote = recap.get("quote") if include_quote else None
    fields: dict[str, Any] = {"session_id": sid, "session": page, "title": recap.get("title") or "Session recap"}
    if recap.get("built_at"):
        fields["built_at"] = recap["built_at"]
    if quote:
        fields["quote"] = {"text": quote["text"], "speaker": quote.get("speaker")}
    body = [f"# {fields['title']}", "", f"*Recap of [[{page}]].*", "", recap.get("body", "").strip(), ""]
    if quote:
        body += [f"> {quote['text']}", f"> — {quote.get('speaker') or 'someone at the table'}", ""]
    moments = [m for m in recap.get("moments", []) if m.get("player_id") in names]
    if moments:
        body += ["## Moments", *(f"- **{names[m['player_id']]}:** {m['text']}" for m in moments), ""]
    if recap.get("questions"):
        body += ["## Questions", *(f"- {q}" for q in recap["questions"]), ""]
    return _front("recap", fields) + "\n".join(body).rstrip("\n") + "\n"


def generate(
    timeline: list[dict[str, Any]],
    players: list[dict[str, Any]],
    pages: dict[str, str],
    recaps: dict[str, dict[str, Any]],
    include_quote: bool,
) -> dict[str, str]:
    """Vault-relative path -> Markdown. `recaps` maps session id to its stored recap; a recap of a session
    without a write-up page has nowhere to sit and is left out."""
    names = {p["id"]: p["name"] for p in players}
    out = {f"{FOLDER}/Timeline.md": timeline_page(timeline, players, pages)}
    for sid, recap in recaps.items():
        if sid in pages:
            out[f"{RECAPS}/{pages[sid]}.md"] = recap_page(sid, pages[sid], recap, names, include_quote)
    return out
