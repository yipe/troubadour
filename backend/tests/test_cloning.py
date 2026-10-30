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
from troubadour.core import config
from troubadour.core.config import SR
from troubadour.engine import _training, core
from troubadour.engine.cloning import Cloning
from troubadour.lore.campaign import Vault
from troubadour.lore.memory import Memory
from troubadour.lore.talk import TEMPO_RANGE
from troubadour.server import deps
from troubadour.server.app import app
from troubadour.sound import tts
from troubadour.sound.audio import wav_bytes

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
    vault = Vault(lambda: tmp_path / "vault")
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
    monkeypatch.setattr(core, "IDLE_POLL_S", 0.01)
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


def by_voice(cloning, pid: str, name: str = "Alice") -> dict:
    return cloning._scored(job(), pid, cloning._lines(job(), pid, name))


def test_table_references_are_the_cleanest_session_recordings(engine, cloning):
    pid = seat(engine)
    lines = [message(pid, 1.0, 5.0), message(pid, 7.0, 11.0), message(pid, 13.0, 17.0)]
    save_session("2026-10-01_190000-aaaa", lines, recording(20, 0.03))
    save_session("2026-10-02_190000-bbbb", lines, recording(20, 0.001))
    save_session("2026-10-03_190000-cccc", [message(pid, 1.0, 5.0)])  # a replay: no recording of its own
    cloning.llm_now = ScriptedLLM(*[{"labels": [{"n": n, "label": "table"} for n in range(1, 7)]}])
    found = cloning._references(by_voice(cloning, pid)[tts.TABLE])
    assert [label for label, _, _ in found] == ["recording of 2026-10-02", "recording of 2026-10-01"]
    assert [r for _, _, r in found] == [RATE, RATE]
    assert len(found[0][1]) / RATE == pytest.approx(10 + 2 * tts.REF_GAP_S, abs=0.05)  # 10 s of speech


def test_the_ai_sorts_a_players_lines_into_their_character_and_table_voices(engine, cloning):
    pid = seat(engine)
    engine.update_player(pid, {"character": "Elara"})
    lines = [
        message(pid, 1.0, 5.0, text="Stand aside, cur, or taste my blade!", character="Elara"),
        message(pid, 7.0, 11.0, text="Can I roll for that, do I add my strength?", character="Elara"),
    ]
    save_session("2026-10-01_190000-aaaa", lines, recording(20, 0.001))
    cloning.llm_now = llm = ScriptedLLM(
        {"labels": [{"n": 1, "label": "character"}, {"n": 2, "label": "table"}, {"n": 9, "label": "character"}]}
    )
    voices = by_voice(cloning, pid)
    assert [line.text for line in voices["elara"]] == ["Stand aside, cur, or taste my blade!"]
    assert voices["elara"][0].label == "Elara"
    assert [line.text for line in voices[tts.TABLE]] == ["Can I roll for that, do I add my strength?"]
    assert "Alice, who plays Elara" in llm.prompts[0]


def test_an_unsure_or_offline_ai_leaves_lines_as_table_talk(engine, cloning):
    pid = seat(engine)
    save_session("2026-10-01_190000-aaaa", [message(pid, 1.0, 5.0), message(pid, 7.0, 11.0)], recording(20, 0.001))
    cloning.llm_now = ScriptedLLM(ConnectionError("down"))
    assert set(by_voice(cloning, pid)) == {tts.TABLE}


def test_voices_named_with_a_character_need_no_ai_and_the_gm_gets_one_per_npc(engine, cloning):
    pid = seat(engine)
    engine.update_player(pid, {"is_gm": True})
    voices = [
        {"id": "v-morvath", "player_id": pid, "character": "Morvath"},
        {"id": "v-pip", "player_id": pid, "character": "Pip"},
    ]
    lines = [
        message(pid, 1.0, 5.0, voice="v-morvath"),
        message(pid, 7.0, 11.0, voice="v-pip"),
        message(pid, 13.0, 17.0),  # narration: the GM's lines aren't read by the AI
    ]
    save_session("2026-10-01_190000-aaaa", lines, recording(20, 0.001), voices)
    cloning.llm_now = llm = ScriptedLLM()
    found = by_voice(cloning, pid)
    assert {k: [line.label for line in v] for k, v in found.items()} == {
        tts.TABLE: [""],
        "morvath": ["Morvath"],
        "pip": ["Pip"],
    }
    assert llm.prompts == []


def test_lines_that_dont_sound_like_them_are_skipped(engine, cloning):
    pid = seat(engine)
    save_session("2026-10-02_190000-bbbb", [message(pid, 1.0, 5.0), message(pid, 7.0, 11.0)], recording(20, 0.001, 2500))
    cloning.llm_now = ScriptedLLM({"labels": [{"n": 1, "label": "table"}, {"n": 2, "label": "table"}]})
    assert by_voice(cloning, pid)[tts.TABLE] == []


def test_likeness_is_the_cosine_to_a_voiceprint(engine, cloning):
    pid = seat(engine)
    match = cloning._match(engine.train_voiceprint(pid))
    assert match(tone(ALICE, 2), SR) == pytest.approx(1.0, abs=0.01)
    assert match(tone(2500, 2), SR) < 0.5
    assert cloning._match(None)(tone(ALICE, 2), SR) is None


# ------------------------------------------------------------- jobs


def test_build_needs_a_train_clip_without_listening_to_it(engine, cloning, monkeypatch):
    pid = engine.add_player("Alice")["id"]
    engine.update_player(pid, {"clone_ok": True})
    monkeypatch.setattr(_training, "speech_spans", lambda a: pytest.fail("the request mustn't run the VAD"))
    with pytest.raises(ValueError, match="Train them first"):
        cloning.build_job(pid)


def test_build_makes_a_character_voice_and_drops_one_no_longer_found(engine, cloning):
    pid = seat(engine)
    engine.update_player(pid, {"character": "Elara"})
    stale = config.DATA_DIR / "clones" / pid / "as" / "old-npc"
    stale.mkdir(parents=True)
    voices = [{"id": "v-elara", "player_id": pid, "character": "Elara"}]
    lines = [message(pid, 1.0, 5.0, voice="v-elara"), message(pid, 7.0, 11.0, voice="v-elara")]
    save_session("2026-10-01_190000-aaaa", lines, recording(20, 0.001), voices)
    cloning.llm_now = ScriptedLLM(
        {"text": "Hold, traveller. None pass the river ford without paying the toll, and none ever will while I stand."}
    )
    j = job()
    cloning.build_job(pid)[1](j)
    status = engine.clones.status(pid)
    [elara] = status["characters"]
    assert (elara["label"], elara["source"], elara["preview_kind"]) == ("Elara", "recording of 2026-10-01", "their lines")
    assert not stale.exists()
    assert j.message.startswith("Ready: table voice")
    assert "as Elara" in j.message

    _, work = cloning.say_job(pid, "Hold, traveller.", in_their_words=False, persona="elara")
    work(job())
    assert engine.clones.clips()[0]["persona"] == "elara"
    with pytest.raises(KeyError, match="no voice"):
        cloning.say_job(pid, "Hi.", in_their_words=False, persona="morvath")
    with pytest.raises(ValueError, match="for their own voice"):
        cloning.say_job(pid, "Hi.", in_their_words=True, persona="elara")


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
    vault = Vault(lambda: tmp_path / "vault")
    memory = Memory(vault, engine.bus, llm=ScriptedLLM(), sessions_dir=engine.sessions_dir)
    cloning = Cloning(engine, llm=lambda: memory.llm, vault=vault, written_up=memory.written_up)
    for name, value in [("engine", engine), ("vault", vault), ("memory", memory), ("cloning", cloning)]:
        monkeypatch.setattr(deps, name, value)
    return TestClient(app, base_url="http://127.0.0.1:8765")


def finished(j: dict) -> dict:
    deadline = time.time() + 10
    while time.time() < deadline:
        state = deps.memory.jobs[j["id"]]
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
    assert api.post(f"/api/players/{pid}/clone/say", json={"text": "Hi.", "persona": "../x"}).status_code == 422
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
    monkeypatch.setattr(deps.memory, "llm", llm)
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
    monkeypatch.setattr(deps.memory, "llm", ScriptedLLM({"text": "Asks before acting."}, {"text": line}))
    assert finished(api.post(f"/api/players/{pid}/clone").json())["state"] == "done"
    clones = api.get("/api/clones").json()
    assert pid in clones["profiles"]  # made on the way, from their transcripts
    assert (clones["voices"][pid]["preview_text"], clones["voices"][pid]["preview_kind"]) == (line, "ai")


def test_saved_in_character_labels_need_no_second_reading(engine, cloning):
    pid = seat(engine)
    engine.update_player(pid, {"character": "Elara"})
    lines = [
        message(pid, 1.0, 5.0, text="Stand aside, cur!", in_character=True),
        message(pid, 7.0, 11.0, text="Can I roll for that?", in_character=False),
    ]
    save_session("2026-10-01_190000-aaaa", lines, recording(20, 0.001))
    cloning.llm_now = llm = ScriptedLLM()
    voices = by_voice(cloning, pid)
    assert [line.text for line in voices["elara"]] == ["Stand aside, cur!"]
    assert [line.text for line in voices[tts.TABLE]] == ["Can I roll for that?"]
    assert llm.prompts == []


def test_api_estimates_in_character_time_for_a_saved_session(api, engine, monkeypatch):
    from troubadour.core.transcript import build

    pid = alice(api, engine)
    sid = "2026-10-08_140000-abcd"
    players = [{"id": pid, "name": "Alice", "character": "Elara", "is_gm": False, "color": "#000"}]
    voices = [{"id": "v-own", "label": "Voice 1", "status": "named", "player_id": pid, "character": None, "trained": True}]
    said = ["Stand aside, cur, or taste my blade!", "Can I roll intimidation for that?"]
    messages = [
        {
            "id": f"m{i}",
            "voice_id": "v-own",
            "text": t,
            "t_start": 4.0 * i,
            "t_end": 4.0 * i + 3,
            "confidence": 0.9,
            "provisional": False,
        }
        for i, t in enumerate(said)
    ]
    record = build({"id": sid, "started_at": 1, "source": None, "duration_s": 8}, players, voices, messages)
    folder = config.DATA_DIR / "sessions" / sid
    folder.mkdir(parents=True)
    (folder / "transcript.json").write_text(json.dumps(record))
    (folder / "meta.json").write_text(json.dumps(record["session"]))
    monkeypatch.setattr(deps.memory, "llm", ScriptedLLM({"labels": [{"n": 1, "label": "character"}, {"n": 2, "label": "table"}]}))
    j = finished(api.post(f"/api/sessions/{sid}/in-character").json())
    assert (j["state"], j["message"]) == ("done", "50% of the players' lines in character")
    saved = json.loads((folder / "transcript.json").read_text())
    assert [m["in_character"] for m in saved["messages"]] == [True, False]
    assert saved["session"]["in_character"]["by_ai"] == 2
    assert (folder / "transcript.orig.json").exists()  # Restore original undoes it
    assert api.post("/api/sessions/2026-10-09_140000-ffff/in-character").status_code == 404
