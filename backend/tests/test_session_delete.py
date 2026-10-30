"""Deleting, merging and unmerging saved sessions: nothing is ever removed, everything comes back."""

import json
import os
from pathlib import Path

import pytest
from conftest import tone, write_wav
from fastapi.testclient import TestClient
from troubadour.engine import MAIN_CAMPAIGN
from troubadour.server import deps
from troubadour.server.app import app

EARLY, LATE = "2025-03-01_190000-aaaa", "2025-03-01_203000-bbbb"


@pytest.fixture
def client(engine, monkeypatch):
    engine.live = None
    monkeypatch.setattr(deps, "engine", engine)
    monkeypatch.setattr(deps.memory, "sessions_dir", engine.sessions_dir)
    return TestClient(app, base_url="http://127.0.0.1:8765")


def make_session(engine, sid: str, started_at: float, seconds: float, *, wav=True, campaign=True) -> Path:
    folder = engine.sessions_dir() / sid
    folder.mkdir(parents=True)
    session = {"id": sid, "started_at": started_at, "duration_s": seconds, "lines": 1, "source": None}
    msg = {
        "id": f"m-{sid}",
        "t_start": 0.5,
        "t_end": 1.0,
        "text": "hello",
        "speaker": "Voice 1",
        "character": None,
        "provisional": False,
        "player_id": None,
        "voice_id": None,
    }
    record = {"session": session, "players": [], "voices": [], "messages": [msg]}
    (folder / "transcript.json").write_text(json.dumps(record))
    (folder / "transcript.md").write_text(f"# {sid}\n")
    meta = dict(session, title=f"Title {sid}", present_player_ids=["alice"], reviewed_at=123.0)
    if campaign:
        meta["campaign"] = MAIN_CAMPAIGN
    (folder / "meta.json").write_text(json.dumps(meta))
    (folder / "quality.json").write_text("{}")
    (folder / "transcript.orig.json").write_text(json.dumps(record))
    if wav:
        write_wav(folder / "audio.wav", tone(220, seconds))
    return folder


def snapshot(folder: Path) -> dict[str, bytes]:
    return {str(p.relative_to(folder)): p.read_bytes() for p in sorted(folder.rglob("*")) if p.is_file()}


@pytest.fixture
def pair(engine):
    return make_session(engine, EARLY, 1000, 2.0), make_session(engine, LATE, 2000, 1.0)


def test_delete_moves_to_trash_and_undelete_brings_it_back(engine, client, pair):
    before = snapshot(pair[1])
    assert client.delete(f"/api/sessions/{LATE}").status_code == 204
    assert not pair[1].exists()
    assert snapshot(engine.sessions_dir() / ".trash" / LATE) == before
    assert [s["id"] for s in client.get("/api/sessions").json()] == [EARLY]
    back = client.post(f"/api/sessions/{LATE}/undelete")
    assert back.status_code == 200
    assert back.json()["id"] == LATE
    assert snapshot(pair[1]) == before
    assert {s["id"] for s in client.get("/api/sessions").json()} == {EARLY, LATE}


def test_trashed_sessions_are_skipped_by_numbering_and_scans(engine, client, pair):
    client.delete(f"/api/sessions/{EARLY}")
    rows = client.get("/api/sessions").json()
    assert [(s["id"], s["n"]) for s in rows] == [(LATE, 1)]
    assert [p.parent.name for p in engine.sessions_dir().glob("*/transcript.json")] == [LATE]
    assert list(engine.sessions_dir().glob("*/meta.json")) == [pair[1] / "meta.json"]


def test_delete_refusals(engine, client, pair):
    assert client.delete("/api/sessions/2025-03-01_999999-cccc").status_code == 404
    assert client.delete("/api/sessions/..%2Fx").status_code in (404, 405, 422)  # 405: the built UI's fallback
    assert client.delete("/api/sessions/not-an-id").status_code == 422
    assert client.post("/api/sessions/not-an-id/undelete").status_code == 422
    assert client.post(f"/api/sessions/{EARLY}/undelete").status_code == 404  # not in the trash
    engine.live = type("L", (), {"id": EARLY})()
    assert client.delete(f"/api/sessions/{EARLY}").status_code == 400
    assert pair[0].exists()


def test_deleting_twice_keeps_both_and_undelete_refuses_a_taken_slot(engine, client, pair):
    client.delete(f"/api/sessions/{LATE}")
    make_session(engine, LATE, 2000, 1.0)  # same id again
    client.delete(f"/api/sessions/{LATE}")
    assert len(list((engine.sessions_dir() / ".trash").glob(f"{LATE}*"))) == 2
    make_session(engine, LATE, 2000, 1.0)
    assert client.post(f"/api/sessions/{LATE}/undelete").status_code == 409


def test_merge_then_unmerge_restores_both_folders_byte_for_byte(engine, client, pair):
    before = [snapshot(f) for f in pair]
    out = client.post("/api/sessions/merge", json={"ids": [EARLY, LATE]})
    assert out.status_code == 200, out.text
    assert out.json()["id"] == EARLY
    assert out.json()["merged_from"] == [LATE]
    assert not pair[1].exists()
    assert snapshot(engine.sessions_dir() / ".trash" / LATE) == before[1]
    merged = json.loads((pair[0] / "transcript.json").read_text())
    assert [m["text"] for m in merged["messages"]] == ["hello", "hello"]
    assert (pair[0] / ".premerge" / "merge.json").is_file()
    assert [s["id"] for s in client.get("/api/sessions").json()] == [EARLY]

    back = client.post(f"/api/sessions/{EARLY}/unmerge")
    assert back.status_code == 200
    assert back.json()["merged_from"] == []
    assert [snapshot(f) for f in pair] == before
    assert {s["id"] for s in client.get("/api/sessions").json()} == {EARLY, LATE}
    assert client.post(f"/api/sessions/{EARLY}/unmerge").status_code == 409  # nothing left to undo


def test_unmerge_without_hard_links_truncates_the_recording(engine, client, pair, monkeypatch):
    before = snapshot(pair[0])
    monkeypatch.setattr(os, "link", lambda *a, **k: (_ for _ in ()).throw(OSError("no links")))
    client.post("/api/sessions/merge", json={"ids": [EARLY, LATE]})
    assert not (pair[0] / ".premerge" / "audio.wav").exists()
    assert client.post(f"/api/sessions/{EARLY}/unmerge").status_code == 200
    assert snapshot(pair[0]) == before


def test_unmerge_conflicts(engine, client, pair):
    client.post("/api/sessions/merge", json={"ids": [EARLY, LATE]})
    (engine.sessions_dir() / LATE).mkdir()  # the id is in use again
    assert client.post(f"/api/sessions/{EARLY}/unmerge").status_code == 409
    assert (engine.sessions_dir() / ".trash" / LATE).is_dir()
    assert (pair[0] / ".premerge").is_dir()
    assert client.post("/api/sessions/2025-03-01_999999-cccc/unmerge").status_code == 404


def test_merge_keeps_meta_fields_and_the_campaign(engine, client):
    early = make_session(engine, EARLY, 1000, 2.0, campaign=False)
    make_session(engine, LATE, 2000, 1.0)
    out = client.post("/api/sessions/merge", json={"ids": [EARLY, LATE]}).json()
    meta = json.loads((early / "meta.json").read_text())
    assert meta["campaign"] == MAIN_CAMPAIGN
    assert (meta["title"], meta["present_player_ids"]) == (f"Title {EARLY}", ["alice"])
    assert out["id"] == EARLY
    assert out["reviewed_at"] is None
    assert out["title"] == f"Title {EARLY}"


def test_a_failed_merge_leaves_both_sessions_as_they_were(engine, client, pair, monkeypatch):
    before = [snapshot(f) for f in pair]

    def boom(*a):
        raise RuntimeError("disk full")

    monkeypatch.setattr("troubadour.engine._sessions._concat_wav", boom)
    with pytest.raises(RuntimeError):
        client.post("/api/sessions/merge", json={"ids": [EARLY, LATE]})
    assert [snapshot(f) for f in pair] == before
    assert not (engine.sessions_dir() / ".trash").exists()


def test_a_second_merge_keeps_the_first_restore_point(engine, client, pair):
    third = "2025-03-01_220000-cccc"
    make_session(engine, third, 3000, 1.0)
    client.post("/api/sessions/merge", json={"ids": [EARLY, LATE]})
    client.post("/api/sessions/merge", json={"ids": [EARLY, third]})
    assert len(list(pair[0].glob(".premerge*"))) == 2
    assert client.post(f"/api/sessions/{EARLY}/unmerge").json()["merged_from"] == [LATE]
