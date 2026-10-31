"""GET /api/campaign/appearances: every entry's mentions per session, from one cached pass."""

import json

import pytest
from fastapi.testclient import TestClient
from troubadour.core import config
from troubadour.lore import timeline
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


def session(sid, text):
    folder = config.DATA_DIR / "sessions" / sid
    folder.mkdir(parents=True)
    (folder / "meta.json").write_text(json.dumps({"id": sid, "started_at": START[sid]}))
    (folder / "transcript.json").write_text(json.dumps({"session": {"id": sid}, "messages": [{"text": text}]}))


def entity(api, name, type="npc", aliases=()):
    body = {"name": name, "type": type}
    assert api.post("/api/campaign/entities", json=body).status_code == 200
    if aliases:
        assert api.patch(f"/api/campaign/entities/{name}", json={"aliases": list(aliases)}).status_code == 200


def test_counts_for_several_entries_in_one_call_with_aliases(api):
    session(S2, "Orsa spoke. The Captain nodded. Orsa left.")
    session(S1, "Nothing here but Dallon.")
    session(S3, "Dallon again, and Dallon.")
    entity(api, "Orsa Vell", aliases=["Orsa", "The Captain"])
    entity(api, "Dallon", "place")
    body = api.get("/api/campaign/appearances").json()
    assert body["sessions"] == [{"id": S1, "n": 1}, {"id": S2, "n": 2}, {"id": S3, "n": 3}]
    assert body["counts"]["Dallon"] == [1, 0, 2]
    assert body["counts"]["Orsa Vell"] == [0, 3, 0]  # two "Orsa" and one alias


def test_a_second_request_rescans_nothing(api, monkeypatch):
    session(S1, "Dallon")
    session(S2, "Dallon")
    entity(api, "Dallon", "place")
    scans = []
    real = timeline._scan
    monkeypatch.setattr(timeline, "_scan", lambda text, needles: scans.append(1) or real(text, needles))
    api.get("/api/campaign/appearances")
    api.get("/api/campaign/appearances")
    assert len(scans) == 2  # one per session, not per request
