"""Voice clones (tts.py) without models: a fake Chatterbox reads at a set pace; consent and files are real."""

import json
import threading
import time
from types import SimpleNamespace

import numpy as np
import pytest
from conftest import tone, write_wav
from fastapi.testclient import TestClient
from test_engine import ALICE, named_voice

from troubadour import config, server, tts
from troubadour.audio import read_wav, wav_bytes
from troubadour.config import SR


class FakeSynth:
    """Chatterbox stand-in. A reading is `cps` characters per second, filled with the reference's mean
    level so a test's likeness can tell which reference made it. `bad` readings come back first,
    0.1 s long (cut short)."""

    def __init__(self, cps: float = 14.0, bad: int = 0):
        self.cps, self.bad = cps, bad
        self.said: list[str] = []
        self.on_speak = lambda: None

    def denoise(self, audio, rate):
        return np.full_like(audio, 0.2), rate  # "clean": a flat level, unlike the sine it came from

    def voice(self, audio, rate):
        return float(np.abs(audio).mean())

    def speak(self, text, voice):
        self.said.append(text)
        self.on_speak()
        if self.bad:
            self.bad -= 1
            return np.full(int(0.1 * tts.OUT_SR), voice, np.float32)
        return np.full(int(len(text) / self.cps * tts.OUT_SR), voice, np.float32)


def job():
    return SimpleNamespace(done=0, total=0, message="")


@pytest.fixture
def clones(tmp_path):
    allowed = {"p1": True}
    c = tts.Clones(lambda: tmp_path / "clones", allowed=lambda pid: allowed.get(pid, False), synth=FakeSynth())
    c.allowed_map = allowed
    return c


def train_clip(seconds: float = 12.0, rate: int = 48000) -> tuple[np.ndarray, int, list[tuple[float, float]]]:
    """Speech in 2 s bursts with 1 s of silence between them."""
    audio = np.zeros(int(seconds * rate), np.float32)
    spans = []
    t = 0.5
    while t + 2 <= seconds:
        n = int(2 * rate)
        audio[int(t * rate) : int(t * rate) + n] = 0.3 * np.sin(2 * np.pi * 220 * np.arange(n) / rate)
        spans.append((t, t + 2))
        t += 3
    return audio, rate, spans


# ------------------------------------------------------------- audio and text


def test_speech_only_cuts_the_silences_and_stops_at_ten_seconds():
    audio, rate, spans = train_clip(40)
    ref = tts.speech_only(audio, rate, spans)
    gaps = 4 * int(tts.REF_GAP_S * rate)  # 5 stretches of 2 s make the 10 s
    assert len(ref) == int(tts.REF_S * rate) + gaps
    assert np.abs(ref).max() == pytest.approx(0.9, abs=1e-3)
    assert tts.speech_only(audio, rate, []).size == 0


def test_speakable_reads_a_session_page_like_a_person_would():
    page = """---
type: session
session_id: x
---
# The [[Drowned Bridge]]

They met **[[Marla|the ferrywoman]]** at the #troubadour/session dock. ![[map.png]]
She wanted [gold](https://example.com) and a song.

## Highlights
- a copy of a scene

## Still open
- [ ] Who lit the lantern
1. The *second* thing!

> [!note] A callout line

| a | b |
|---|---|

## Mentioned
[[Marla]], [[Sahuagin]]

## Transcript
[[Transcripts/x|Full transcript]] · 12 lines
<!-- hidden -->
"""
    assert tts.speakable(page).split("\n\n") == [
        "The Drowned Bridge.",
        "They met the ferrywoman at the dock. She wanted gold and a song.",
        "Still open.",
        "Who lit the lantern.",
        "The second thing!",
        "A callout line",
    ]


def test_chunks_pack_whole_sentences_and_never_cross_a_paragraph():
    text = "One. Two is here. Three!\n\nNew paragraph."
    assert tts.chunks(text, max_chars=14) == [
        ("One.", tts.SENTENCE_PAUSE_S),
        ("Two is here.", tts.SENTENCE_PAUSE_S),
        ("Three!", tts.PARAGRAPH_PAUSE_S),
        ("New paragraph.", 0.0),
    ]
    assert tts.chunks("One. Two.") == [("One. Two.", 0.0)]
    assert tts.chunks("  \n\n ") == []


def test_a_sentence_too_long_for_one_call_splits_at_clauses_then_words():
    sentence = "alpha beta gamma, delta epsilon zeta, " + "x" * 30
    parts = [c for c, _ in tts.chunks(sentence, max_chars=20)]
    assert all(len(p) <= 20 for p in parts)
    assert " ".join(parts).replace(" ", "") == sentence.replace(" ", "")


def test_plausible_pace():
    text = "x" * 140
    assert tts.plausible(text, np.zeros(10 * tts.OUT_SR))  # 14 per second
    assert not tts.plausible(text, np.zeros(int(0.5 * tts.OUT_SR)))  # cut short
    assert not tts.plausible(text, np.zeros(60 * tts.OUT_SR))  # babbling on
    assert tts.plausible("Hi.", np.zeros(tts.OUT_SR))  # too short to judge


def test_wav_round_trip_at_any_rate_and_depth(tmp_path):
    a = (0.5 * np.sin(np.arange(4800) / 7)).astype(np.float32)
    for bits in (16, 24):
        path = tmp_path / f"{bits}.wav"
        path.write_bytes(wav_bytes(a, 48000, bits=bits))
        back, rate = read_wav(path)
        assert rate == 48000
        assert np.abs(back - a).max() < (1e-4 if bits == 16 else 1e-6)


# ------------------------------------------------------------- Clones


def test_build_keeps_the_reference_that_clones_closer(clones):
    audio, rate, spans = train_clip()
    status = clones.build(job(), lambda: None, "p1", audio, rate, spans, lambda out, sr: float(out[0]))
    assert status["cleaned"] is True  # the flat "cleaned" reference reads louder: more alike here
    assert status["likeness"] == pytest.approx(0.9, abs=1e-3)
    assert status["preview_url"].startswith("/api/clones/p1/preview.wav?v=")
    ref, ref_rate = read_wav(clones.root() / "p1" / "reference.wav")
    assert ref_rate == 48000
    assert clones.file("p1", "preview").is_file()

    status = clones.build(job(), lambda: None, "p1", audio, rate, spans, lambda out, sr: -float(out[0]))
    assert status["cleaned"] is False  # as recorded, this time
    assert clones.voices() == {"p1": status}


def test_build_needs_three_seconds_of_speech(clones):
    audio, rate, _ = train_clip()
    with pytest.raises(ValueError, match="under 3 s"):
        clones.build(job(), lambda: None, "p1", audio, rate, [(0.5, 2.5)], lambda out, sr: 0.5)


def test_nothing_is_made_without_consent(clones):
    audio, rate, spans = train_clip()
    with pytest.raises(ValueError, match="off for this player"):
        clones.build(job(), lambda: None, "p2", audio, rate, spans, lambda out, sr: 0.5)
    assert not (clones.root() / "p2").exists()


def test_consent_withdrawn_mid_reading_leaves_no_clip(clones):
    audio, rate, spans = train_clip()
    clones.build(job(), lambda: None, "p1", audio, rate, spans, lambda out, sr: 0.5)
    clones.synth.on_speak = lambda: clones.allowed_map.update(p1=False)
    with pytest.raises(ValueError, match="off for this player"):
        clones.speak(job(), lambda: None, "p1", "Hello there. Again.", "say", "Hello", {})
    assert clones.clips() == []


def test_speak_reads_chunk_by_chunk_and_redoes_a_reading_cut_short(clones):
    audio, rate, spans = train_clip()
    clones.build(job(), lambda: None, "p1", audio, rate, spans, lambda out, sr: 0.5)
    clones.synth.said.clear()
    clones.synth.bad = 1
    text = "The party crossed the drowned bridge at dawn.\n\nNobody fell in, mostly."
    j, seen = job(), []
    clip = clones.speak(j, lambda: seen.append(j.done), "p1", text, "say", "The party", {"x": 1})
    assert clones.synth.said == ["The party crossed the drowned bridge at dawn."] * 2 + ["Nobody fell in, mostly."]
    assert (j.done, j.total) == (2, 2)
    assert seen[-2:] == [1, 2]
    expected = (len(text.split("\n\n")[0]) + len(text.split("\n\n")[1])) / 14 + tts.PARAGRAPH_PAUSE_S
    assert clip["seconds"] == pytest.approx(expected, abs=0.1)
    assert clones.clips()[0] | {"url": clip["url"]} == clip
    assert clip["url"] == f"/api/clones/p1/{clip['id']}.wav"
    assert clones.file("p1", clip["id"]).is_file()


def test_speak_needs_a_built_voice(clones):
    with pytest.raises(ValueError, match="Build this player's voice first"):
        clones.speak(job(), lambda: None, "p1", "Hi.", "say", "Hi", {})


@pytest.mark.parametrize("name", ["../reference", "..", "a/b", "reference", "voice", ""])
def test_files_are_only_previews_and_clips(clones, name):
    audio, rate, spans = train_clip()
    clones.build(job(), lambda: None, "p1", audio, rate, spans, lambda out, sr: 0.5)
    with pytest.raises(KeyError):
        clones.file("p1", name)
    with pytest.raises(KeyError):
        clones.file("..", "preview")


def test_delete_clip_and_forget(clones):
    audio, rate, spans = train_clip()
    clones.build(job(), lambda: None, "p1", audio, rate, spans, lambda out, sr: 0.5)
    clip = clones.speak(job(), lambda: None, "p1", "Hi.", "say", "Hi", {})
    with pytest.raises(KeyError):
        clones.delete_clip("p1", "preview")
    clones.delete_clip("p1", clip["id"])
    assert clones.clips() == []
    clones.forget("p1")
    assert clones.voices() == {}
    assert not (clones.root() / "p1").exists()


# ------------------------------------------------------------- engine


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


def test_check_clone_says_what_is_missing(engine):
    p = engine.add_player("Alice")
    with pytest.raises(ValueError, match="Turn on the voice clone for Alice"):
        engine.check_clone(p["id"])
    engine.update_player(p["id"], {"clone_ok": True})
    with pytest.raises(ValueError, match="Stop the session first"):
        engine.check_clone(p["id"])  # the fixture's session is running
    engine.status = "idle"
    assert engine.check_clone(p["id"]) == "Alice"
    with pytest.raises(KeyError):
        engine.check_clone("p-nobody")


def test_clone_source_prefers_the_lossless_train_clip(engine, monkeypatch):
    import silero_vad

    monkeypatch.setattr(silero_vad, "get_speech_timestamps", lambda a, m, sampling_rate: [{"start": 0, "end": len(a)}])
    p = engine.add_player("Alice")
    with pytest.raises(ValueError, match="Train them first"):
        engine.clone_source(p["id"])
    vid = named_voice(engine, p["id"], ALICE)
    engine.voices[vid].sample_audio = tone(ALICE, 2)
    audio, rate, spans = engine.clone_source(p["id"])
    assert (rate, len(audio), spans) == (SR, 2 * SR, [(0.0, 2.0)])
    hq = config.DATA_DIR / "voices" / f"{vid}.hq.wav"
    hq.parent.mkdir(parents=True, exist_ok=True)
    hq.write_bytes(wav_bytes(np.zeros(2 * 48000, np.float32), 48000, bits=24))
    audio, rate, _ = engine.clone_source(p["id"])
    assert (rate, len(audio)) == (48000, 2 * 48000)


def test_voice_likeness_is_the_cosine_to_their_voiceprint(engine):
    p = engine.add_player("Alice")
    vid = named_voice(engine, p["id"], ALICE)
    engine.voices[vid].sample_audio = tone(ALICE, 2)
    assert engine.voice_likeness(p["id"], tone(ALICE, 2), SR) == pytest.approx(1.0, abs=0.01)
    assert engine.voice_likeness(p["id"], tone(2500, 2), SR) < 0.5
    assert engine.voice_likeness("p-nobody", tone(ALICE, 2), SR) is None


# ------------------------------------------------------------- API


@pytest.fixture
def api(engine, monkeypatch, tmp_path):
    import silero_vad

    monkeypatch.setattr(silero_vad, "get_speech_timestamps", lambda a, m, sampling_rate: [{"start": 0, "end": len(a)}])
    engine.status = "idle"
    engine.clones.synth = FakeSynth()
    vault = server.Vault(lambda: tmp_path / "vault")
    memory = server.Memory(vault, engine.bus, sessions_dir=engine.sessions_dir)
    monkeypatch.setattr(server, "engine", engine)
    monkeypatch.setattr(server, "vault", vault)
    monkeypatch.setattr(server, "memory", memory)
    return TestClient(server.app, base_url="http://127.0.0.1:8765")


def finished(api, j: dict) -> dict:
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


def test_api_build_say_listen_delete(api, engine):
    pid = alice(api, engine)
    assert api.post(f"/api/players/{pid}/clone/say", json={"text": "Hi."}).status_code == 400  # no voice yet
    j = api.post(f"/api/players/{pid}/clone").json()
    assert (j["kind"], j["player_id"], j["title"]) == ("clone", pid, "Alice")
    assert finished(api, j)["state"] == "done"
    voices = api.get("/api/clones").json()["voices"]
    assert set(voices) == {pid}
    assert api.get(voices[pid]["preview_url"]).headers["content-type"] == "audio/wav"

    j = api.post(f"/api/players/{pid}/clone/say", json={"text": "  Roll for initiative!  "}).json()
    assert finished(api, j)["state"] == "done"
    [clip] = api.get("/api/clones").json()["clips"]
    assert (clip["kind"], clip["title"], clip["text"]) == ("say", "Roll for initiative!", "Roll for initiative!")
    assert api.get(clip["url"]).content[:4] == b"RIFF"
    assert api.delete(f"/api/clones/{pid}/clips/{clip['id']}").status_code == 204
    assert api.get(clip["url"]).status_code == 404

    api.patch(f"/api/players/{pid}", json={"clone_ok": False})
    assert api.get("/api/clones").json() == {"voices": {}, "clips": []}


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
    assert finished(api, api.post(f"/api/players/{pid}/clone").json())["state"] == "done"
    sid = "2026-10-08_140000-abcd"
    assert api.post(f"/api/players/{pid}/clone/read", json={"session": sid}).status_code == 404
    page = tmp_path / "vault" / "Sessions" / "2026-10-08 The Desert Road.md"
    page.parent.mkdir(parents=True)
    page.write_text(f"---\ntype: session\nsession_id: {sid}\n---\n# The Desert Road\n\nSand. More sand.\n")
    j = api.post(f"/api/players/{pid}/clone/read", json={"session": sid}).json()
    assert (j["kind"], j["title"]) == ("read", sid)
    assert finished(api, j)["state"] == "done"
    [clip] = api.get("/api/clones").json()["clips"]
    assert clip["source"] == {"session": sid, "note": "Sessions/2026-10-08 The Desert Road.md"}
    assert clip["title"] == "2026-10-08 The Desert Road"
    assert engine.clones.synth.said[-2:] == ["The Desert Road.", "Sand. More sand."]


def test_clips_from_two_players_list_newest_first(clones, tmp_path):
    clones.allowed_map["p2"] = True
    audio, rate, spans = train_clip()
    for pid in ("p1", "p2"):
        clones.build(job(), lambda: None, pid, audio, rate, spans, lambda out, sr: 0.5)
    first = clones.speak(job(), lambda: None, "p1", "One.", "say", "One", {})
    second = clones.speak(job(), lambda: None, "p2", "Two.", "say", "Two", {})
    assert [c["id"] for c in clones.clips()] == [second["id"], first["id"]]
    meta = json.loads((clones.root() / "p1" / "clips" / f"{first['id']}.json").read_text())
    assert "url" not in meta  # the URL is derived, not stored


def test_a_corrupt_clip_record_is_skipped(clones):
    folder = clones.root() / "p1" / "clips"
    folder.mkdir(parents=True)
    (folder / "cbroken.json").write_text("{nope")
    write_wav(folder / "cbroken.wav", tone(ALICE, 0.1))
    assert clones.clips() == []


def test_forget_waits_for_a_clip_being_written(clones):
    """forget() and a job's final write share a lock: the clip is either never written or deleted."""
    audio, rate, spans = train_clip()
    clones.build(job(), lambda: None, "p1", audio, rate, spans, lambda out, sr: 0.5)
    started = threading.Event()
    clones.synth.on_speak = started.set
    outcome = []

    def run():
        try:
            outcome.append(clones.speak(job(), lambda: None, "p1", "Hi.", "say", "Hi", {}))
        except ValueError as e:
            outcome.append(e)

    t = threading.Thread(target=run)
    t.start()
    started.wait(5)
    clones.allowed_map["p1"] = False
    clones.forget("p1")
    t.join(5)
    assert len(outcome) == 1
    assert not (clones.root() / "p1").exists()
