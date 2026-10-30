"""The live notebook: pins, keep/dismiss, notebook.updated, saving on finish, session isolation."""

import json

import pytest
from conftest import NullSource
from fastapi.testclient import TestClient
from troubadour.engine import LiveSession
from troubadour.server import deps
from troubadour.server.app import app

ITEM = {"kind": "fact", "text": "The gate opens at low water.", "about": "Tide Gate", "confidence": "gm"}


@pytest.fixture
def client(engine, monkeypatch):
    monkeypatch.setattr(deps, "engine", engine)
    engine.bind_notebook(engine.live)
    return TestClient(app, base_url="http://127.0.0.1:8765")


def test_pin_while_running_is_returned_and_emitted(client, engine):
    r = client.post("/api/session/pins", json={"t": 12.5, "text": "  ask about the ledger "})
    assert r.status_code == 200
    pin = r.json()
    assert (pin["t"], pin["text"]) == (12.5, "ask about the ledger")
    (event,) = engine.bus.of("notebook.updated")
    assert event["session_id"] == engine.live.id
    assert [p["id"] for p in event["pins"]] == [pin["id"]]
    assert client.get("/api/session/notebook").json()["pins"] == [pin]


def test_pin_while_idle_is_400_and_the_notebook_is_empty(client, engine):
    engine.status = "idle"
    assert client.post("/api/session/pins", json={"t": 1, "text": "x"}).status_code == 400
    assert client.get("/api/session/notebook").json() == {"session_id": None, "items": [], "pins": [], "updating": False}


@pytest.mark.parametrize(
    "body",
    [
        {"t": 1, "text": ""},
        {"t": 1, "text": "   "},
        {"t": 1, "text": "x" * 501},
        {"t": -1, "text": "x"},
        {"t": 86401, "text": "x"},
    ],
)
def test_pin_limits(client, body):
    assert client.post("/api/session/pins", json=body).status_code == 422


def test_set_status_is_emitted_and_persisted_on_finish(client, engine):
    (item,) = engine.live.notebook.add_items([ITEM])
    assert item["status"] == "open"
    r = client.post(f"/api/session/notebook/{item['id']}", json={"status": "kept"})
    assert r.status_code == 200
    assert r.json()["status"] == "kept"
    assert engine.bus.of("notebook.updated")[-1]["items"][0]["status"] == "kept"
    assert client.post(f"/api/session/notebook/{item['id']}", json={"status": "open"}).json()["status"] == "open"
    client.post(f"/api/session/notebook/{item['id']}", json={"status": "dismissed"})

    sid = engine.live.id
    engine._finish(engine.live)
    saved = json.loads((engine.sessions_dir() / sid / "notebook.json").read_text())
    assert [i["status"] for i in saved["items"]] == ["dismissed"]
    out = client.get(f"/api/sessions/{sid}/notebook").json()
    assert out["session_id"] == sid
    assert out["items"][0]["text"] == ITEM["text"]


def test_unknown_item_and_bad_status(client):
    assert client.post("/api/session/notebook/nope", json={"status": "kept"}).status_code == 404
    assert client.post("/api/session/notebook/nope", json={"status": "bogus"}).status_code == 422


def test_saved_notebook_of_an_unknown_session_is_empty_and_ids_are_checked(client):
    out = client.get("/api/sessions/2026-01-01_000000-abcd/notebook").json()
    assert (out["items"], out["pins"]) == ([], [])
    assert client.get("/api/sessions/..%2f..%2fetc/notebook").status_code == 404


def test_abandoned_session_emits_and_saves_nothing(client, engine):
    old = engine.live
    (item,) = old.notebook.add_items([ITEM])
    new = LiveSession(NullSource(), {"kind": "file", "name": "x.wav", "speed": 1.0})
    engine.bind_notebook(new)
    with engine.lock:
        engine.live = new
    old.abandon()
    before = len(engine.bus.of("notebook.updated"))

    assert old.notebook.add_items([ITEM]) == []
    with pytest.raises(KeyError):
        old.notebook.set_status(item["id"], "kept")
    with pytest.raises(ValueError, match="no session"):
        old.notebook.add_pin(1, "x")
    old.notebook.set_updating(True)
    old.notebook.save(engine.sessions_dir() / old.id / "notebook.json")

    assert len(engine.bus.of("notebook.updated")) == before
    assert not (engine.sessions_dir() / old.id / "notebook.json").exists()


def test_add_items_drops_unusable_entries_and_caps_text(engine):
    nb = engine.live.notebook
    engine.bind_notebook(engine.live)
    added = nb.add_items(
        [
            {"kind": "nonsense", "text": "x"},
            {"kind": "fact", "text": "  "},
            {"kind": "fact", "text": "y" * 5000, "t": -3, "confidence": "sure"},
        ]
    )
    assert len(added) == 1
    assert len(added[0]["text"]) == 1000
    assert (added[0]["t"], added[0]["confidence"]) == (None, None)


def test_updating_flag_is_emitted(client, engine):
    engine.live.notebook.set_updating(True)
    assert engine.bus.of("notebook.updated")[-1]["updating"] is True
    assert client.get("/api/session/notebook").json()["updating"] is True
