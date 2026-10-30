"""Session start options, the summary fields of saved sessions, and the reviewed flag."""

import json
from pathlib import Path

import pytest
from conftest import speak, tone, write_wav
from fastapi.testclient import TestClient
from test_engine import ALICE, BOB, CARA, named_voice, say
from troubadour.core import config
from troubadour.engine.model import Player
from troubadour.lore import pages
from troubadour.server import deps
from troubadour.server.app import app

VECTORS = Path(__file__).parents[2] / "shared" / "test-vectors" / "session-numbers.json"


@pytest.fixture
def started(engine, dirs, monkeypatch):
    """engine.start for a quiet file replay: the real start, with no audio thread, segmenter or worker."""
    monkeypatch.setattr("troubadour.engine._pipeline.keep_awake", lambda: None)
    monkeypatch.setattr("troubadour.engine._pipeline.FileSource.start", lambda self, sink, on_end: None)
    monkeypatch.setattr(engine, "_segment_loop", lambda sess: None)
    monkeypatch.setattr(engine, "_worker_loop", lambda sess: None)
    write_wav(dirs[1] / "scene.wav", tone(ALICE, 1.0))
    engine.players = {"alice": Player("alice", "Alice"), "bob": Player("bob", "Bob")}

    def start(**options):
        return engine.start({"kind": "file", "name": "scene.wav", "speed": 1}, **options)

    return start


@pytest.fixture
def client(engine, monkeypatch):
    monkeypatch.setattr(deps, "engine", engine)
    return TestClient(app, base_url="http://127.0.0.1:8765")


def test_start_options_show_in_the_session_json_and_meta(started, engine, client):
    out = started(title="The Drowned Abbey", present_player_ids=["alice"])
    say(engine, ALICE)  # a replay with no lines isn't saved
    assert (out["title"], out["present_player_ids"]) == ("The Drowned Abbey", ["alice"])
    folder = engine.save_transcript(force=True)
    meta = json.loads((folder / "meta.json").read_text())
    assert meta["title"] == "The Drowned Abbey"
    assert meta["present_player_ids"] == ["alice"]
    assert meta["reviewed_at"] is None
    assert sum(meta["talk"].values()) == pytest.approx(2.0, abs=0.1)


def test_start_endpoint_accepts_the_options_and_trims_the_title(started, engine, client, monkeypatch):
    monkeypatch.setattr(engine, "_require_models", lambda: None)
    r = client.post(
        "/api/session/start",
        json={
            "source": {"kind": "file", "name": "scene.wav", "speed": 1},
            "title": "  Tide Tables  ",
            "present_player_ids": ["bob"],
            "record_audio": False,
            "cleanup": False,
        },
    )
    assert r.status_code == 200
    assert r.json()["title"] == "Tide Tables"
    assert r.json()["present_player_ids"] == ["bob"]
    assert engine.live.cleanup is False
    assert engine.live.record_audio is False


def test_start_endpoint_limits_the_options(client):
    source = {"kind": "file", "name": "scene.wav", "speed": 1}
    assert client.post("/api/session/start", json={"source": source, "title": "x" * 121}).status_code == 422
    too_many = [f"p{i}" for i in range(33)]
    assert client.post("/api/session/start", json={"source": source, "present_player_ids": too_many}).status_code == 422


def test_an_unknown_present_player_is_refused(started, client):
    r = client.post(
        "/api/session/start",
        json={"source": {"kind": "file", "name": "scene.wav", "speed": 1}, "present_player_ids": ["alice", "nobody"]},
    )
    assert r.status_code == 400
    assert "nobody" in r.json()["detail"]


def test_options_default_to_the_settings(started, engine, monkeypatch):
    monkeypatch.setattr(config, "CLEANUP", False)
    started()
    assert engine.live.cleanup is False
    assert engine.live.record_audio is config.RECORD_AUDIO
    assert engine.live.present_player_ids == []


def test_cleanup_choice_is_for_that_session_only(started, engine):
    started(cleanup=False)
    assert engine.speller(live=True) is None
    assert engine.speller() is not None  # saved sessions still follow the setting


def test_record_audio_false_writes_no_recording(engine, dirs, monkeypatch):
    monkeypatch.setattr("troubadour.engine._pipeline.keep_awake", lambda: None)
    monkeypatch.setattr(engine, "_worker_loop", lambda sess: None)
    monkeypatch.setattr("troubadour.engine._pipeline.MicSource.native_rate", lambda self: 48000)
    monkeypatch.setattr("troubadour.engine._pipeline.MicSource.start", lambda self, sink, on_end: None)
    engine.start({"kind": "mic", "device": None}, record_audio=False)
    assert engine.live.recorder is None
    engine.live.release()
    assert not (engine.sessions_dir() / engine.live.id / "audio.wav").exists()


def test_record_audio_true_records_even_when_the_setting_is_off(engine, dirs, monkeypatch):
    monkeypatch.setattr(config, "RECORD_AUDIO", False)
    monkeypatch.setattr("troubadour.engine._pipeline.keep_awake", lambda: None)
    monkeypatch.setattr(engine, "_worker_loop", lambda sess: None)
    monkeypatch.setattr("troubadour.engine._pipeline.MicSource.native_rate", lambda self: 48000)
    monkeypatch.setattr("troubadour.engine._pipeline.MicSource.start", lambda self, sink, on_end: None)
    engine.start({"kind": "mic", "device": None}, record_audio=True)
    assert engine.live.recorder is not None
    engine.live.release()


def test_an_absent_players_voice_is_never_chosen(started, engine):
    alice_v = named_voice(engine, "alice", ALICE)
    bob_v = named_voice(engine, "bob", BOB)
    started(present_player_ids=["alice"])
    assert engine.matcher.names == [alice_v]
    assert say(engine, ALICE)["voice_id"] == alice_v
    assert say(engine, BOB)["voice_id"] != bob_v  # Bob is away: his voice is a stranger's
    engine._finish(engine.live)
    assert set(engine.matcher.names) == {alice_v, bob_v}
    assert engine._voiceprint(bob_v) is not None


def test_a_new_session_puts_absent_voices_back(started, engine):
    alice_v = named_voice(engine, "alice", ALICE)
    bob_v = named_voice(engine, "bob", BOB)
    started(present_player_ids=["alice"])
    assert bob_v not in engine.matcher.names
    started()  # everyone again; the first session never finished
    assert set(engine.matcher.names) == {alice_v, bob_v}
    assert say(engine, BOB)["voice_id"] == bob_v


def test_talk_sums_seconds_per_player_and_voice(started, engine):
    alice_v = named_voice(engine, "alice", ALICE)
    started()
    first = say(engine, ALICE, 2.0)
    say(engine, ALICE, 3.0)
    stranger = say(engine, CARA, 2.0)
    talk = engine.transcript_record()["session"]["talk"]
    assert talk["alice"] == pytest.approx(5.0, abs=0.1)
    assert talk[f"voice:{stranger['voice_id']}"] == pytest.approx(2.0, abs=0.1)
    assert first["voice_id"] == alice_v


def _write_saved(engine, sid: str, started_at: float, meta_extra: dict | None = None, messages: list[dict] | None = None):
    folder = engine.sessions_dir() / sid
    folder.mkdir(parents=True)
    meta = {"id": sid, "started_at": started_at, "source": {"kind": "mic", "device": None}, "duration_s": 60, "lines": 1}
    meta |= meta_extra or {}
    (folder / "meta.json").write_text(json.dumps(meta))
    if messages is not None:
        record = {"version": 1, "session": meta, "players": [], "voices": [], "messages": messages}
        (folder / "transcript.json").write_text(json.dumps(record))
    return folder


def test_an_old_session_lists_with_nulls_and_computed_talk(engine, client):
    lines = [
        {"id": "a", "t_start": 0, "t_end": 4, "player_id": "alice", "voice_id": "v1"},
        {"id": "b", "t_start": 4, "t_end": 6, "player_id": None, "voice_id": "v9"},
        {"id": "c", "t_start": 6, "t_end": 7, "player_id": "alice", "voice_id": "v1"},
    ]
    folder = _write_saved(engine, "2026-01-01_000000-aaaa", 1.0, messages=lines)
    before = (folder / "meta.json").read_text()
    row = client.get("/api/sessions").json()[0]
    assert row["title"] is None
    assert row["summary"] is None
    assert row["present_player_ids"] is None
    assert row["reviewed_at"] is None
    assert row["n"] == 1
    assert row["talk"] == {"alice": 5.0, "voice:v9": 2.0}
    assert (folder / "meta.json").read_text() == before  # computed, not written back


def test_a_session_without_a_transcript_lists_with_empty_talk(engine, client):
    _write_saved(engine, "2026-01-01_000000-aaaa", 1.0)
    assert client.get("/api/sessions").json()[0]["talk"] == {}


def test_saved_talk_comes_from_meta(engine, client):
    _write_saved(engine, "2026-01-01_000000-aaaa", 1.0, {"talk": {"alice": 9.5}, "title": "Working title"})
    row = client.get("/api/sessions").json()[0]
    assert row["talk"] == {"alice": 9.5}
    assert row["title"] == "Working title"


def test_the_write_up_title_and_wrap_up_replace_the_working_title(engine, client, tmp_path, monkeypatch):
    sid = "2026-01-01_000000-aaaa"
    _write_saved(engine, sid, 1.0, {"title": "Working title"})
    monkeypatch.setattr(deps.memory, "written_up", lambda: {sid: "Sessions/2026-01-01 The Abbey.md"})
    monkeypatch.setattr(deps.vault, "_root", tmp_path)
    page = tmp_path / "Sessions" / "2026-01-01 The Abbey.md"
    page.parent.mkdir()
    page.write_text(PAGE)
    row = client.get("/api/sessions").json()[0]
    assert row["title"] == "The Abbey"
    assert row["summary"] == "The party reached Saltreach at dusk."


PAGE = """---
type: session
session_id: x
---
# 2026-01-01 The Abbey

## Last time
The party reached [[Saltreach]] at [dusk](http://x).

They left at dawn.

## Highlights
- Something else
"""


def test_session_page_reads_title_and_first_wrap_up_paragraph(tmp_path):
    (tmp_path / "Sessions").mkdir()
    (tmp_path / "Sessions" / "p.md").write_text(PAGE)
    assert pages.session_page(tmp_path, "Sessions/p.md") == {
        "title": "The Abbey",
        "summary": "The party reached Saltreach at dusk.",
    }


def test_session_page_caps_the_summary_and_survives_missing_pages(tmp_path):
    (tmp_path / "p.md").write_text("# T\n\n## Last time\n" + "word " * 400 + "\n")
    assert len(pages.session_page(tmp_path, "p.md")["summary"] or "") <= 600
    assert pages.session_page(tmp_path, "nope.md") == {"title": None, "summary": None}
    assert pages.session_page(tmp_path, "../outside.md") == {"title": None, "summary": None}
    (tmp_path / "q.md").write_text("# Only a title\n")
    assert pages.session_page(tmp_path, "q.md") == {"title": "Only a title", "summary": None}
    (tmp_path / "r.md").write_text("# T\n\n## Last time\n(no wrap-up)\n")
    assert pages.session_page(tmp_path, "r.md")["summary"] is None


@pytest.mark.parametrize("case", json.loads(VECTORS.read_text()))
def test_session_numbers_pass_the_shared_vectors(case):
    sessions = [{**s, "started_at": _epoch(s["started_at"])} for s in case["sessions"]]
    assert pages.session_numbers(sessions) == case["expected"]


def _epoch(stamp: str) -> float:
    from datetime import datetime

    return datetime.fromisoformat(stamp).timestamp()


def test_reviewed_can_be_set_and_cleared(engine, client):
    sid = "2026-01-01_000000-aaaa"
    folder = _write_saved(engine, sid, 1.0)
    r = client.post(f"/api/sessions/{sid}/reviewed", json={"reviewed": True})
    assert r.status_code == 200
    stamp = r.json()["reviewed_at"]
    assert stamp > 0
    assert json.loads((folder / "meta.json").read_text())["reviewed_at"] == stamp
    assert client.get("/api/sessions").json()[0]["reviewed_at"] == stamp
    r = client.post(f"/api/sessions/{sid}/reviewed", json={"reviewed": False})
    assert r.json()["reviewed_at"] is None
    assert json.loads((folder / "meta.json").read_text())["reviewed_at"] is None


def test_reviewed_is_404_for_an_unknown_session(client):
    assert client.post("/api/sessions/2026-01-01_000000-ffff/reviewed", json={"reviewed": True}).status_code == 404
    assert client.post("/api/sessions/..%2Fstate/reviewed", json={"reviewed": True}).status_code == 404


def test_an_autosave_keeps_the_reviewed_time(started, engine):
    started(title="T")
    say(engine, ALICE)
    folder = engine.save_transcript(force=True)
    engine.set_reviewed(engine.live.id, True)
    stamp = json.loads((folder / "meta.json").read_text())["reviewed_at"]
    speak(engine, ALICE, 1.0)
    engine.save_transcript(force=True)
    assert json.loads((folder / "meta.json").read_text())["reviewed_at"] == stamp
    assert json.loads((folder / "transcript.json").read_text())["session"]["reviewed_at"] == stamp
