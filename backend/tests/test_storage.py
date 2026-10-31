"""GET /api/storage: bytes per bucket on a tmp data dir."""

import pytest
from fastapi.testclient import TestClient
from troubadour.server import deps
from troubadour.server.app import app
from troubadour.server.routers import storage

LOCAL = "http://127.0.0.1:8765"


def put(path, n):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * n)


@pytest.fixture
def api(dirs, monkeypatch):
    monkeypatch.delenv("TROUBADOUR_VAULT", raising=False)
    monkeypatch.setattr(storage, "_cache", None)
    return TestClient(app, base_url=LOCAL), dirs[0]


def test_buckets(api):
    client, data = api
    put(data / "sessions" / "a" / "audio.wav", 1000)
    put(data / "sessions" / "a" / "extra.WAV", 100)
    put(data / "sessions" / "a" / "transcript.json", 7)
    put(data / "voices" / "p1.wav", 20)
    put(data / "clones" / "c1.wav", 30)
    put(data / "campaign" / "People" / "Elara.md", 400)
    put(data / "state.json", 5)
    body = client.get("/api/storage").json()
    assert body == {"root": storage._shown(data), "recordings": 1100, "voices": 50, "notes": 400, "other": 12}


def test_root_uses_tilde():
    from pathlib import Path

    assert storage._shown(Path.home() / "troubador") == "~/troubador"
    assert storage._shown(Path("/tmp/x")) == str(Path("/tmp/x"))  # shown as the system writes it


def test_vault_outside_data_dir_counts_as_notes(api, tmp_path, monkeypatch):
    client, data = api
    vault = tmp_path / "obsidian" / "My Vault"
    put(vault / "Note.md", 300)
    put(data / "state.json", 5)
    monkeypatch.setattr(deps.engine, "vault_dir", lambda cid=None: vault)
    body = client.get("/api/storage").json()
    assert (body["notes"], body["other"]) == (300, 5)


def test_symlinks_are_not_followed(api, tmp_path):
    client, data = api
    outside = tmp_path / "outside"
    put(outside / "big.bin", 9999)
    put(data / "state.json", 5)
    data.mkdir(exist_ok=True)
    (data / "link").symlink_to(outside)
    (data / "linkfile").symlink_to(outside / "big.bin")
    body = client.get("/api/storage").json()
    assert body["other"] == 5


def test_cached_for_a_minute(api, monkeypatch):
    client, data = api
    clock = [1000.0]
    monkeypatch.setattr(storage, "_now", lambda: clock[0])
    put(data / "state.json", 5)
    assert client.get("/api/storage").json()["other"] == 5
    put(data / "more.json", 10)
    clock[0] += 59
    assert client.get("/api/storage").json()["other"] == 5
    clock[0] += 2
    assert client.get("/api/storage").json()["other"] == 15
