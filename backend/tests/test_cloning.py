"""The voice-clone jobs (cloning.py), the engine's part of them, and their API. No models: FakeSynth,
the fake embedder, a scripted LLM; consent, sessions on disk and the job thread are real."""

import json
import threading
import time

import numpy as np
import pytest
from conftest import FakeSynth, ScriptedLLM, job, tone
from fastapi.testclient import TestClient
from test_engine import ALICE, named_voice

from troubadour import config, server, tts
from troubadour import engine as engine_module
from troubadour.audio import wav_bytes
from troubadour.cloning import Cloning
from troubadour.config import SR
from troubadour.talk import TEMPO_RANGE

RATE = 48000  # session recordings at the mic's own rate


def seat(engine, name: str = "Alice", consent: bool = True, train_s: float = 6) -> str:
    """A seated player with a Train recording (a tone), who agreed to a voice clone."""
    p = engine.add_player(name)
    vid = named_voice(engine, p["id"], ALICE)
    engine.voices[vid].sample_audio = tone(ALICE, train_s)
    if consent:
        engine.update_player(p["id"], {"clone_ok": True})
    return p["id"]


def message(pid, t0, t1, voice="v-own", text="I check the door for traps, carefully.", **kw):
    return {
        "player_id": pid,
        "voice_id": voice,
        "t_start": t0,
        "t_end": t1,
        "confidence": 0.9,
        "provisional": False,
        "text": text,
    } | kw


def save_session(sid: str, messages: list[dict], audio: np.ndarray | None = None, voices=()) -> None:
    folder = config.DATA_DIR / "sessions" / sid
    folder.mkdir(parents=True, exist_ok=True)
    if audio is not None:
        (folder / "audio.wav").write_bytes(wav_bytes(audio.astype(np.float32), RATE))
    record = {"session": {"id": sid}, "voices": list(voices), "messages": messages}
    (folder / "transcript.json").write_text(json.dumps(record))


def recording(seconds: float, noise: float, freq: float = ALICE) -> np.ndarray:
    t = np.arange(int(seconds * RATE)) / RATE
    speech = 0.3 * np.sin(2 * np.pi * freq * t) * (np.sin(2 * np.pi * 0.5 * t) > -0.5)
    return speech + noise * np.random.default_rng(1).standard_normal(len(t))


@pytest.fixture
def cloning(engine, tmp_path, fake_vad):
    engine.status = "idle"
    engine.clones.synth = FakeSynth()
    vault = server.Vault(lambda: tmp_path / "vault")
    llm = ScriptedLLM()
    c = Cloning(engine, llm=lambda: c.llm_now, vault=vault, written_up=lambda: {})
    c.llm_now = llm
    return c


# ------------------------------------------------------------- the engine's part


def test_turning_consent_off_deletes_their_clone(engine):
    p = engine.add_player("Alice")
    folder = config.DATA_DIR / "clones" / p["id"]
    folder.mkdir(parents=True)
    (folder / "voice.json").write_text("{}")
    assert engine.update_player(p["id"], {"clone_ok": True})["clone_ok"] is True
    engine.update_player(p["id"], {"name": "Alicia"})  # other edits leave it be
    assert folder.exists()
    engine.update_player(p["id"], {"clone_ok": False})
    assert not folder.exists()
    folder.mkdir(parents=True)
    engine.remove_player(p["id"])
    assert not folder.exists()


def test_check_clone_says_what_is_missing(engine, monkeypatch):
    p = engine.add_player("Alice")
    with pytest.raises(ValueError, match="Turn on the voice clone for Alice"):
        engine.check_clone(p["id"])
    engine.update_player(p["id"], {"clone_ok": True})
    with pytest.raises(ValueError, match="Stop the session before using the voice clone"):
        engine.check_clone(p["id"])  # the fixture's session is running
    assert engine.check_clone(p["id"], needs_idle=False) == "Alice"
    engine.status = "idle"
    assert engine.check_clone(p["id"]) == "Alice"
    monkeypatch.setattr(engine, "_train_run", lambda job: None)
    engine.train(p["id"], 10)
    with pytest.raises(ValueError, match="Finish or cancel voice training"):
        engine.check_clone(p["id"])
    with pytest.raises(KeyError):
        engine.check_clone("p-nobody")


def test_a_benched_player_can_keep_their_clone_but_not_use_it(engine):
    pid = seat(engine)
    engine.status = "idle"
    engine.bench_player(pid)
    assert engine.clone_allowed(pid)  # their files stay
    with pytest.raises(KeyError):
        engine.check_clone(pid)  # but jobs are for the open campaign's table


def test_train_clip_prefers_the_lossless_copy(engine, fake_vad):
    p = engine.add_player("Alice")
    assert not engine.has_train_clip(p["id"])
    with pytest.raises(ValueError, match="Train them first"):
        engine.train_clip(p["id"])
    vid = named_voice(engine, p["id"], ALICE)
    engine.voices[vid].sample_audio = tone(ALICE, 2)
    assert engine.has_train_clip(p["id"])
    audio, rate, spans = engine.train_clip(p["id"])
    assert (rate, len(audio), spans) == (SR, 2 * SR, [(0.0, 2.0)])
    hq = config.DATA_DIR / "voices" / f"{vid}.hq.wav"
    hq.parent.mkdir(parents=True, exist_ok=True)
    hq.write_bytes(wav_bytes(np.zeros(2 * RATE, np.float32), RATE, bits=24))
    audio, rate, _ = engine.train_clip(p["id"])
    assert (rate, len(audio)) == (RATE, 2 * RATE)


def test_wait_idle_holds_a_job_while_a_session_runs(engine, monkeypatch):
    monkeypatch.setattr(engine_module, "IDLE_POLL_S", 0.01)
    j, said = job(), []
    j.update(message="Trying the Train recording…")
    j.on_change = lambda: said.append(j.message)
    threading.Timer(0.1, lambda: setattr(engine, "status", "idle")).start()  # the session ends meanwhile
    engine.wait_idle(j)
    assert engine.status == "idle"
    assert said[0] == "Paused while a session runs"
    assert said[-1] == "Trying the Train recording…"
    n = len(said)
    engine.wait_idle(j)  # idle: no wait, no messages
    assert len(said) == n


def test_wait_for_models_says_why_they_are_missing(engine):
    engine.ready.clear()
    engine.load_error = "Models failed to load"
    with pytest.raises(RuntimeError, match="Models failed to load"):
        engine.wait_for_models()


# ------------------------------------------------------------- references from sessions


def test_candidates_add_the_cleanest_session_recordings(engine, cloning):
    pid = seat(engine)
    lines = [message(pid, 1.0, 5.0), message(pid, 7.0, 11.0), message(pid, 13.0, 17.0)]
    save_session("2026-10-01_190000-aaaa", lines, recording(20, 0.03))
    save_session("2026-10-02_190000-bbbb", lines, recording(20, 0.001))
    save_session("2026-10-03_190000-cccc", [message(pid, 1.0, 5.0)])  # a replay: no recording of its own
    found = cloning._candidates(job(), pid)
    assert [label for label, _, _ in found] == ["Train recording", "recording of 2026-10-02", "recording of 2026-10-01"]
    assert [r for _, _, r in found] == [SR, RATE, RATE]
    assert len(found[1][1]) / RATE == pytest.approx(10 + 2 * tts.REF_GAP_S, abs=0.05)  # 10 s of speech


def test_candidates_use_lines_under_a_seat_character(engine, cloning):
    # Saved lines carry the seat character for a player with no character voice: still their own voice.
    pid = seat(engine)
    lines = [message(pid, 1.0, 5.0, character="Elara"), message(pid, 7.0, 11.0, character="Elara")]
    save_session("2026-10-01_190000-aaaa", lines, recording(20, 0.001))
    assert [label for label, _, _ in cloning._candidates(job(), pid)][1:] == ["recording of 2026-10-01"]


def test_candidates_skip_character_voices_and_lines_that_dont_sound_like_them(engine, cloning):
    pid = seat(engine)
    voices = [{"id": "v-elara", "player_id": pid, "character": "Elara"}]
    in_character = [message(pid, 1.0, 5.0, voice="v-elara"), message(pid, 7.0, 11.0, voice="v-elara")]
    save_session("2026-10-01_190000-aaaa", in_character, recording(20, 0.001), voices)
    save_session("2026-10-02_190000-bbbb", [message(pid, 1.0, 5.0), message(pid, 7.0, 11.0)], recording(20, 0.001, 2500))
    assert [label for label, _, _ in cloning._candidates(job(), pid)] == ["Train recording"]


def test_likeness_is_the_cosine_to_their_train_voiceprint(engine, cloning):
    pid = seat(engine)
    assert cloning._likeness(pid, tone(ALICE, 2), SR) == pytest.approx(1.0, abs=0.01)
    assert cloning._likeness(pid, tone(2500, 2), SR) < 0.5
    assert cloning._likeness("p-nobody", tone(ALICE, 2), SR) is None


# ------------------------------------------------------------- jobs


def test_build_needs_a_train_clip_without_listening_to_it(engine, cloning, monkeypatch):
    pid = engine.add_player("Alice")["id"]
    engine.update_player(pid, {"clone_ok": True})
    monkeypatch.setattr(engine_module, "speech_spans", lambda a: pytest.fail("the request mustn't run the VAD"))
    with pytest.raises(ValueError, match="Train them first"):
        cloning.build_job(pid)


def test_say_in_their_words_rewrites_then_matches_their_pace(engine, cloning):
    pid = seat(engine)
    _, work = cloning.build_job(pid)
    work(job())  # too few lines for a profile: the stock preview line
    assert engine.clones.status(pid)["preview_kind"] == ""
    prof = {"wpm": 300, "words_per_line": 9, "questions": 0, "exclamations": 0, "in_character": 0}
    prof |= {"phrases": ["you know what"], "openers": [], "examples": [], "description": None, "player_id": pid}
    engine.clones.save_profile(pid, prof)
    cloning.llm_now = ScriptedLLM({"text": "Okay you know what, I open the old door."})
    _, work = cloning.say_job(pid, "I open the old door.", in_their_words=True)
    work(job())
    [clip] = engine.clones.clips()
    assert (clip["text"], clip["title"], clip["in_their_words"]) == (
        "Okay you know what, I open the old door.",
        "I open the old door.",
        True,
    )
    plain = len(clip["text"]) / 14  # FakeSynth's pace; a 300 wpm player is faster than the clone's own
    assert clip["seconds"] == pytest.approx(plain / TEMPO_RANGE[1], abs=0.1)


def test_say_and_read_need_a_voice_and_for_their_words_a_profile(engine, cloning):
    pid = seat(engine)
    with pytest.raises(ValueError, match="Build Alice's voice first"):
        cloning.say_job(pid, "Hi.", in_their_words=False)
    cloning.build_job(pid)[1](job())
    with pytest.raises(ValueError, match="Profile how Alice talks first"):
        cloning.say_job(pid, "Hi.", in_their_words=True)
    with pytest.raises(KeyError, match="no write-up"):
        cloning.read_job(pid, "2026-10-08_140000-abcd", in_their_words=False)


# ------------------------------------------------------------- API


@pytest.fixture
def api(engine, monkeypatch, tmp_path, fake_vad):
    engine.status = "idle"
    engine.clones.synth = FakeSynth()
    vault = server.Vault(lambda: tmp_path / "vault")
    memory = server.Memory(vault, engine.bus, llm=ScriptedLLM(), sessions_dir=engine.sessions_dir)
    cloning = Cloning(engine, llm=lambda: memory.llm, vault=vault, written_up=memory.written_up)
    for name, value in [("engine", engine), ("vault", vault), ("memory", memory), ("cloning", cloning)]:
        monkeypatch.setattr(server, name, value)
    return TestClient(server.app, base_url="http://127.0.0.1:8765")


def finished(j: dict) -> dict:
    deadline = time.time() + 10
    while time.time() < deadline:
        state = server.memory.jobs[j["id"]]
        if state.state in ("done", "error"):
            return state.to_json()
        time.sleep(0.02)
    raise AssertionError("job never finished")


def alice(api, engine, consent: bool = True) -> str:
    p = api.post("/api/players", json={"name": "Alice"}).json()
    vid = named_voice(engine, p["id"], ALICE)
    engine.voices[vid].sample_audio = tone(ALICE, 6)
    if consent:
        assert api.patch(f"/api/players/{p['id']}", json={"clone_ok": True}).json()["clone_ok"] is True
    return p["id"]


def table_talk(pid: str) -> None:
    """Two saved sessions of them asking questions and saying "you know what" (no recordings)."""
    lines = [
        "Okay you know what, I check the door for traps?",
        "Okay so can I roll stealth for that?",
        "You know what, I cast light on my staff.",
        "Okay wait, how far away is the bridge from here?",
    ]
    for s in range(2):
        mine = [message(pid, 0.0, 2.4, text=lines[i % 4]) for i in range(20)]
        gm = [message("p-gm", 0.0, 4.0, voice="v-gm", text="The bridge sways over the gorge below.") for _ in range(20)]
        save_session(f"2026-10-0{s + 1}_140000-abcd", mine + gm)
    (config.DATA_DIR / "sessions" / "broken").mkdir()
    (config.DATA_DIR / "sessions" / "broken" / "transcript.json").write_text("{nope")


def test_api_build_say_listen_delete(api, engine):
    pid = alice(api, engine)
    assert api.post(f"/api/players/{pid}/clone/say", json={"text": "Hi."}).status_code == 400  # no voice yet
    j = api.post(f"/api/players/{pid}/clone").json()
    assert (j["kind"], j["player_id"], j["title"]) == ("clone", pid, "Alice")
    assert finished(j)["state"] == "done"
    voices = api.get("/api/clones").json()["voices"]
    assert set(voices) == {pid}
    assert api.get(voices[pid]["preview_url"]).headers["content-type"] == "audio/wav"

    j = api.post(f"/api/players/{pid}/clone/say", json={"text": "  Roll for initiative!  "}).json()
    assert finished(j)["state"] == "done"
    [clip] = api.get("/api/clones").json()["clips"]
    assert (clip["kind"], clip["title"], clip["text"]) == ("say", "Roll for initiative!", "Roll for initiative!")
    assert api.get(clip["url"]).content[:4] == b"RIFF"
    assert api.delete(f"/api/clones/{pid}/clips/{clip['id']}").status_code == 204
    assert api.get(clip["url"]).status_code == 404

    api.patch(f"/api/players/{pid}", json={"clone_ok": False})
    assert api.get("/api/clones").json() == {"voices": {}, "profiles": {}, "clips": []}


def test_api_refuses_without_consent_or_training(api, engine):
    pid = alice(api, engine, consent=False)
    r = api.post(f"/api/players/{pid}/clone")
    assert r.status_code == 400
    assert "Turn on the voice clone" in r.json()["detail"]
    bob = api.post("/api/players", json={"name": "Bob"}).json()["id"]
    api.patch(f"/api/players/{bob}", json={"clone_ok": True})
    assert "Train them first" in api.post(f"/api/players/{bob}/clone").json()["detail"]
    assert api.post("/api/players/p-nobody/clone").status_code == 404


def test_api_validates_text(api, engine):
    pid = alice(api, engine)
    assert api.post(f"/api/players/{pid}/clone/say", json={"text": "   "}).status_code == 422
    assert api.post(f"/api/players/{pid}/clone/say", json={"text": "x" * (tts.SAY_MAX_CHARS + 1)}).status_code == 422


def test_api_reads_a_session_write_up_aloud(api, engine, tmp_path):
    pid = alice(api, engine)
    assert finished(api.post(f"/api/players/{pid}/clone").json())["state"] == "done"
    sid = "2026-10-08_140000-abcd"
    assert api.post(f"/api/players/{pid}/clone/read", json={"session": sid}).status_code == 404
    page = tmp_path / "vault" / "Sessions" / "2026-10-08 The Desert Road.md"
    page.parent.mkdir(parents=True)
    page.write_text(f"---\ntype: session\nsession_id: {sid}\n---\n# The Desert Road\n\nSand. More sand.\n")
    j = api.post(f"/api/players/{pid}/clone/read", json={"session": sid}).json()
    assert (j["kind"], j["title"], j["note"]) == ("read", "2026-10-08 The Desert Road", "Sessions/2026-10-08 The Desert Road.md")
    assert finished(j)["state"] == "done"
    [clip] = api.get("/api/clones").json()["clips"]
    assert clip["source"] == {"session": sid, "note": "Sessions/2026-10-08 The Desert Road.md"}
    assert clip["title"] == "2026-10-08 The Desert Road"
    assert engine.clones.synth.said[-2:] == ["The Desert Road.", "Sand. More sand."]


def test_api_profile_then_say_in_their_words(api, engine, monkeypatch):
    pid = alice(api, engine)
    assert finished(api.post(f"/api/players/{pid}/clone").json())["state"] == "done"  # no transcripts yet
    assert api.get("/api/clones").json()["voices"][pid]["preview_kind"] == ""
    r = api.post(f"/api/players/{pid}/clone/say", json={"text": "Hi.", "in_their_words": True})
    assert r.json()["detail"] == "Profile how Alice talks first."
    table_talk(pid)

    llm = ScriptedLLM({"text": "Asks before acting; opens with okay."}, {"text": "Okay you know what, I open the door."})
    monkeypatch.setattr(server.memory, "llm", llm)
    j = api.post(f"/api/players/{pid}/profile").json()
    assert (j["kind"], j["player_id"]) == ("profile", pid)
    assert finished(j)["message"] == "Profile ready"
    prof = api.get("/api/clones").json()["profiles"][pid]
    assert prof["description"] == "Asks before acting; opens with okay."
    assert any("you know what" in p for p in prof["phrases"])

    j = api.post(f"/api/players/{pid}/clone/say", json={"text": "I open the door.", "in_their_words": True}).json()
    assert finished(j)["state"] == "done"
    [clip] = api.get("/api/clones").json()["clips"]
    assert (clip["in_their_words"], clip["text"]) == (True, "Okay you know what, I open the door.")
    assert engine.clones.synth.said[-1] == "Okay you know what, I open the door."

    api.patch(f"/api/players/{pid}", json={"clone_ok": False})
    assert api.get("/api/clones").json()["profiles"] == {}


def test_api_profile_needs_consent_not_an_idle_mic(api, engine):
    pid = alice(api, engine, consent=False)
    assert api.post(f"/api/players/{pid}/profile").status_code == 400
    api.patch(f"/api/players/{pid}", json={"clone_ok": True})
    engine.status = "running"  # counting lines and asking the LLM don't touch the voice model
    j = finished(api.post(f"/api/players/{pid}/profile").json())
    assert j["state"] == "error"  # but there are no transcripts to count
    assert "Not enough of their lines yet" in j["message"]


def test_api_build_writes_a_line_they_would_say(api, engine, monkeypatch):
    pid = alice(api, engine)
    table_talk(pid)
    line = " ".join(["Okay so you know what, I check the door for traps?"] * 7)
    monkeypatch.setattr(server.memory, "llm", ScriptedLLM({"text": "Asks before acting."}, {"text": line}))
    assert finished(api.post(f"/api/players/{pid}/clone").json())["state"] == "done"
    clones = api.get("/api/clones").json()
    assert pid in clones["profiles"]  # made on the way, from their transcripts
    assert (clones["voices"][pid]["preview_text"], clones["voices"][pid]["preview_kind"]) == (line, "ai")
