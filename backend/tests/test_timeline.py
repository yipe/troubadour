"""Timeline rows and entity appearances, against a tmp vault and tmp sessions."""

import json

import pytest
from fastapi.testclient import TestClient
from troubadour.core import config
from troubadour.lore import timeline
from troubadour.server import deps
from troubadour.server.app import app

S1, S2, S3 = "2026-10-01_190000-aaaa", "2026-10-08_190000-bbbb", "2026-10-15_190000-cccc"
START = {S1: 1_790_000_000, S2: 1_790_600_000, S3: 1_791_200_000}


@pytest.fixture(autouse=True)
def fresh_cache():
    timeline._cache.clear()


@pytest.fixture
def api(dirs, monkeypatch):
    monkeypatch.delenv("TROUBADOUR_VAULT", raising=False)
    return TestClient(app, base_url="http://127.0.0.1:8765")


def session(sid, text, scenes=None, title=None):
    folder = config.DATA_DIR / "sessions" / sid
    folder.mkdir(parents=True)
    meta = {"id": sid, "started_at": START[sid], "talk": {"alice": 12.5}, "title": title}
    (folder / "meta.json").write_text(json.dumps(meta))
    (folder / "transcript.json").write_text(json.dumps({"session": {"id": sid}, "messages": [{"text": text}]}))
    if scenes is not None:
        (folder / "scenes.json").write_text(json.dumps(scenes))
    return folder


def entity(api, name, type="npc"):
    assert api.post("/api/campaign/entities", json={"name": name, "type": type}).status_code == 200


def by_id(api):
    return {s["id"]: s for s in api.get("/api/campaign/timeline").json()["sessions"]}


def test_rows_are_newest_first_with_numbers_and_talk(api):
    session(S1, "hello", title="Working title")
    session(S2, "again")
    rows = api.get("/api/campaign/timeline").json()["sessions"]
    assert [(r["id"], r["n"]) for r in rows] == [(S2, 2), (S1, 1)]
    assert rows[1]["title"] == "Working title"
    assert rows[1]["talk"] == {"alice": 12.5}
    assert len(rows[1]["date"]) == 10


def test_places_from_scenes_drop_consecutive_duplicates(api):
    entity(api, "Dallon", "place")
    scenes = [
        {"t": 0, "title": "a", "place": "Dallon"},
        {"t": 1, "title": "b", "place": "Dallon"},
        {"t": 2, "title": "c", "place": None},
        {"t": 3, "title": "d", "place": "Mire"},
        {"t": 4, "title": "e", "place": "Dallon"},
    ]
    session(S1, "Dallon", scenes=scenes)
    assert by_id(api)[S1]["places"] == ["Dallon", "Mire", "Dallon"]


def test_places_fall_back_to_first_mention_order_capped_at_three(api):
    for name in ("Aldersea", "Bracken", "Corvane", "Dunmere"):
        entity(api, name, "place")
    entity(api, "Pip", "npc")
    session(S1, "Pip left Dunmere, then Bracken, then Aldersea and Bracken again, then Corvane.")
    assert by_id(api)[S1]["places"] == ["Dunmere", "Bracken", "Aldersea"]


def test_new_entities_only_on_first_mention(api):
    entity(api, "Pip")
    entity(api, "Dallon", "place")
    api.post("/api/campaign/entities", json={"name": "Ghost"})  # never mentioned
    session(S1, "Pip walked.")
    session(S2, "Pip and Dallon.")
    rows = by_id(api)
    assert rows[S1]["new_entities"] == [{"name": "Pip", "type": "npc"}]
    assert rows[S2]["new_entities"] == [{"name": "Dallon", "type": "place"}]
    assert rows[S2]["places"] == ["Dallon"]


def test_suggested_entries_are_not_new_entities(api):
    entity(api, "Pip")
    api.patch("/api/campaign/entities/Pip", json={"status": "suggested"})
    session(S1, "Pip walked.")
    assert by_id(api)[S1]["new_entities"] == []


def test_facts_accepted_counts_by_source(api):
    entity(api, "Pip")
    session(S1, "Pip")
    session(S2, "Pip")
    (deps.vault.root / "Sessions").mkdir(exist_ok=True)
    (deps.vault.root / "Sessions" / "2026-10-01 Session.md").write_text(f"---\nsession_id: {S1}\n---\n# One\n")
    for text in ("Owes a favour.", "Keeps bees."):
        r = api.post("/api/campaign/entities/Pip/facts", json={"text": text, "source": {"session_id": S1}})
        assert r.status_code == 200, r.text
    api.post("/api/campaign/entities/Pip/facts", json={"text": "No source."})
    rows = by_id(api)
    assert (rows[S1]["facts_accepted"], rows[S2]["facts_accepted"]) == (2, 0)
    assert rows[S1]["title"] == "One"


def test_appearances_include_zeros_oldest_first(api):
    entity(api, "Pip")
    session(S1, "Pip said Pip.")
    session(S2, "nobody")
    session(S3, "pip")
    got = api.get("/api/campaign/entities/Pip").json()["appearances"]
    assert got == [
        {"session_id": S1, "n": 1, "count": 2},
        {"session_id": S2, "n": 2, "count": 0},
        {"session_id": S3, "n": 3, "count": 1},
    ]
    assert api.post("/api/campaign/entities", json={"name": "Other"}).json()["appearances"] is None


def test_scans_are_cached_until_a_transcript_or_the_names_change(api, monkeypatch):
    entity(api, "Pip")
    session(S1, "Pip")
    session(S2, "Pip")
    scans = []
    real = timeline._scan
    monkeypatch.setattr(timeline, "_scan", lambda text, needles: scans.append(1) or real(text, needles))
    by_id(api)
    assert len(scans) == 2
    by_id(api)
    api.get("/api/campaign/entities/Pip")
    assert len(scans) == 2  # nothing changed: nothing rescanned
    entity(api, "Dallon", "place")  # a vault change
    by_id(api)
    assert len(scans) == 4
    path = config.DATA_DIR / "sessions" / S1 / "transcript.json"
    path.write_text(json.dumps({"messages": [{"text": "Pip and Dallon"}]}))
    by_id(api)
    assert len(scans) == 5
