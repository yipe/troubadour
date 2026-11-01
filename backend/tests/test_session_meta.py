"""Session start options, the summary fields of saved sessions, and the reviewed flag."""

import json
import time
import types
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


def test_wrap_up_reads_the_whole_wrap_up_or_what_stands_in_for_it(tmp_path):
    (tmp_path / "p.md").write_text(PAGE)
    assert pages.wrap_up(tmp_path, "p.md") == "The party reached Saltreach at dusk.\n\nThey left at dawn."
    notes = "---\ntype: notes\nsession: x\n---\n# 2026-01-01 Session 3\n\nWe met [[Zorbo]].\n\nHe owes us.\n"
    (tmp_path / "n.md").write_text(notes)
    assert pages.wrap_up(tmp_path, "n.md") == "We met Zorbo.\n\nHe owes us."  # imported notes stand in
    older = "---\nsession_id: x\n---\n# 2026-01-01 Old\n\nThe party met [[Zorbo]].\n\n## Highlights\n- not it\n"
    (tmp_path / "o.md").write_text(older)
    assert pages.wrap_up(tmp_path, "o.md") == "The party met Zorbo."  # an older page: its summary before the sections
    (tmp_path / "r.md").write_text("# T\n\n## Last time\n(no wrap-up)\n\n## Highlights\n- not a wrap-up\n")
    assert pages.wrap_up(tmp_path, "r.md") == ""
    (tmp_path / "long.md").write_text("# T\n\n## Last time\n" + "word " * 2000 + "\n")
    assert len(pages.wrap_up(tmp_path, "long.md")) <= pages.WRAP_UP_MAX
    assert pages.wrap_up(tmp_path, "nope.md") == pages.wrap_up(tmp_path, "../outside.md") == ""


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
    # A traversal id never reaches the handler: 404, or 405 when the built UI's fallback catches the path.
    assert client.post("/api/sessions/..%2Fstate/reviewed", json={"reviewed": True}).status_code in (404, 405)


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


def test_a_merged_session_shows_the_name_and_summary_of_the_session_merged_into_it(engine, client, tmp_path, monkeypatch):
    early, late = "2026-01-01_000000-aaaa", "2026-01-01_010000-bbbb"
    _write_saved(engine, early, 1.0, {"merged_from": [late]})  # unnamed, and the later session was merged into it
    monkeypatch.setattr(deps.vault, "_root", tmp_path)
    page = tmp_path / "Sessions" / "2026-01-01 The Abbey.md"
    page.parent.mkdir()
    page.write_text(PAGE.replace("session_id: x", f"session_id: {late}"))  # the write-up the later session had
    monkeypatch.setattr(deps.memory, "sessions_dir", engine.sessions_dir)
    row = client.get("/api/sessions").json()[0]
    assert row["title"] == "The Abbey"
    assert row["summary"] == "The party reached Saltreach at dusk."
    assert client.get("/api/campaign").json()["written_up"][early] == "Sessions/2026-01-01 The Abbey.md"


def test_a_notes_session_lists_on_the_timeline_and_refuses_audio_jobs(engine, client, tmp_path, monkeypatch):
    monkeypatch.setattr(deps.vault, "_root", tmp_path)
    monkeypatch.setattr(deps.memory, "sessions_dir", engine.sessions_dir)
    rec, note = "2026-01-02_120000-aaaa", "2026-01-01_120000-bbbb"
    _write_saved(engine, rec, 2_000_000_000.0, messages=[])
    _write_saved(
        engine, note, 1_990_000_000.0, {"kind": "notes", "note": "Notes/2026-01-01 Bells.md", "campaign": engine.campaign}
    )
    (tmp_path / "Notes").mkdir()
    (tmp_path / "Notes" / "2026-01-01 Bells.md").write_text(
        f"---\ntype: notes\nsession: {note}\n---\n# 2026-01-01 Bells\n\nWe rang them.\n"
    )
    rows = {r["id"]: r for r in client.get("/api/sessions").json()}
    assert (rows[note]["kind"], rows[rec]["kind"], rows[note]["title"]) == ("notes", "recording", "Bells")
    line = {s["id"]: s for s in client.get("/api/campaign/timeline").json()["sessions"]}
    assert (line[note]["kind"], line[note]["n"], line[rec]["n"]) == ("notes", 1, 2)  # numbered in date order
    for path in ("improve", "retranscribe", "spelling", "in-character", "refresh", "restore"):
        assert client.post(f"/api/sessions/{note}/{path}").status_code == 409, path
    assert client.get(f"/api/sessions/{note}/notes").json() == {"text": "We rang them."}
    assert client.get(f"/api/sessions/{rec}/notes").status_code == 404
    assert client.post("/api/sessions/merge", json={"ids": [note, rec]}).status_code == 409
    assert client.post(f"/api/campaign/writeup/{note}").status_code == 409
    assert client.delete(f"/api/sessions/{note}").status_code == 204


def test_editing_a_notes_session_changes_its_date_and_title_and_reads_it_again(engine, client, tmp_path, monkeypatch):
    monkeypatch.setattr(deps.vault, "_root", tmp_path)
    monkeypatch.setattr(deps.memory, "sessions_dir", engine.sessions_dir)
    monkeypatch.setattr(deps.memory, "llm", types.SimpleNamespace(json=lambda *a, **k: {}))
    rec, note = "2026-01-02_120000-aaaa", "2026-01-01_120000-bbbb"
    _write_saved(engine, rec, 2_000_000_000.0, messages=[])
    _write_saved(
        engine, note, 1_990_000_000.0, {"kind": "notes", "note": "Notes/2026-01-01 Bells.md", "campaign": engine.campaign}
    )
    (tmp_path / "Notes").mkdir()
    (tmp_path / "Notes" / "2026-01-01 Bells.md").write_text(
        f"---\ntype: notes\nsession: {note}\n---\n# 2026-01-01 Bells\n\nWe rang them.\n"
    )
    edit = {"date": "2026-03-04", "title": "Tolling", "text": "We rang them twice."}
    assert client.put(f"/api/sessions/{rec}/notes", json=edit).status_code == 409  # a recording has no notes
    assert client.put(f"/api/sessions/{note}/notes", json={**edit, "date": "2026-13-01"}).status_code == 422
    res = client.put(f"/api/sessions/{note}/notes", json=edit)
    assert res.status_code == 200
    job = res.json()
    assert job["sessions"] == [note]
    deadline = time.monotonic() + 5
    while deps.memory.jobs[job["id"]].state in ("queued", "running") and time.monotonic() < deadline:
        time.sleep(0.01)
    assert deps.memory.jobs[job["id"]].state == "done"
    row = {r["id"]: r for r in client.get("/api/sessions").json()}[note]
    assert (row["title"], row["ingested"], row["started_at"]) == ("Tolling", True, time.mktime((2026, 3, 4, 12, 0, 0, 0, 0, -1)))
    assert client.get(f"/api/sessions/{note}/notes").json() == {"text": "We rang them twice."}
    assert not (tmp_path / "Notes" / "2026-01-01 Bells.md").exists()
    res = client.put(f"/api/sessions/{note}/notes", json={**edit, "date": None})  # no date: unknown
    assert res.status_code == 200
    deadline = time.monotonic() + 5
    while deps.memory.jobs[res.json()["id"]].state in ("queued", "running") and time.monotonic() < deadline:
        time.sleep(0.01)
    rows = {r["id"]: r for r in client.get("/api/sessions").json()}
    assert rows[note]["started_at"] < rows[rec]["started_at"]
    assert rows[note]["n"] == 1
    assert (
        client.put(f"/api/sessions/{note}/notes", json={**edit, "date": "1970-06-01"}).status_code == 422
    )  # real dates start in 1971


def test_the_import_preview_lists_up_to_the_limit_and_counts_the_rest(client):
    text = "\n".join(f"Session {n}\nWe did thing {n}." for n in range(1, 206))
    got = client.post("/api/campaign/import/preview", json={"title": "", "text": text}).json()
    assert (len(got["sessions"]), got["more"]) == (200, 5)
    assert got["sessions"][0]["date"] is None  # undated headings: the client marks them unknown
    assert (
        client.post("/api/campaign/import/preview", json={"title": "", "text": "Session 1\nx\nSession 2\ny"}).json()["more"] == 0
    )


def test_the_order_of_unknown_dated_sessions_is_set_over_the_api(engine, client, tmp_path, monkeypatch):
    monkeypatch.setattr(deps.vault, "_root", tmp_path)
    monkeypatch.setattr(deps.memory, "sessions_dir", engine.sessions_dir)
    a, b, dated = "1970-01-01_120000-aaaa", "1970-01-01_120000-bbbb", "2026-01-02_120000-cccc"
    for sid, at in ((a, 172_802.0), (b, 172_803.0), (dated, 2_000_000_000.0)):
        _write_saved(engine, sid, at, {"kind": "notes", "note": f"Notes/{sid}.md", "campaign": engine.campaign})
    ids = lambda rows: [r["id"] for r in rows]  # noqa: E731
    assert ids(client.get("/api/sessions").json()) == [dated, b, a]  # newest first
    res = client.put("/api/sessions/order", json={"ids": [b, a]})
    assert res.status_code == 200
    assert ids(res.json()) == [dated, a, b]
    assert {r["id"]: r["n"] for r in res.json()} == {b: 1, a: 2, dated: 3}
    assert client.put("/api/sessions/order", json={"ids": [a]}).status_code == 409  # not all of them
    assert client.put("/api/sessions/order", json={"ids": [a, b, dated]}).status_code == 409  # a dated one
    assert client.put("/api/sessions/order", json={"ids": ["nope"]}).status_code == 422
