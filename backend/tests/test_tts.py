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
        self.denoised: list[float] = []

    def denoise(self, audio, rate):
        self.denoised.append(len(audio) / rate)
        return audio * 0.5, rate  # quieter; the reference is peak-normalized again after

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


def cands(audio, rate, spans):
    return [("Train recording", tts.speech_only(audio, rate, spans), rate)]


def test_build_keeps_the_reference_that_clones_closest_and_always_cleans_it(clones):
    audio, rate, spans = train_clip()
    flat = np.full(int(5 * 48000), 0.3, np.float32)  # reads louder than a sine once normalized
    candidates = [("Train recording", tts.speech_only(audio, rate, spans), rate), ("recording of 2026-10-12", flat, 48000)]
    j = job()
    status = clones.build(j, lambda: None, "p1", candidates, lambda out, sr: float(out[0]))
    assert status["source"] == "recording of 2026-10-12"
    assert status["likeness"] == pytest.approx(0.9, abs=1e-3)
    assert [t["source"] for t in status["tried"]] == ["Train recording", "recording of 2026-10-12"]
    assert (j.done, j.total) == (2 * tts.PREVIEW_RUNS + 1, 2 * tts.PREVIEW_RUNS + 1)  # + the preview itself
    assert len(clones.synth.denoised) == 2  # every reference is cleaned: the clone copies the room
    assert len(clones.synth.said) == 2 * tts.PREVIEW_RUNS + 1  # several tries each: one is luck
    assert status["preview_url"].startswith("/api/clones/p1/preview.wav?v=")
    assert read_wav(clones.root() / "p1" / "reference.wav")[1] == 48000
    assert clones.file("p1", "preview").is_file()

    status = clones.build(j, lambda: None, "p1", candidates, lambda out, sr: -float(out[0]))
    assert status["source"] == "Train recording"
    assert clones.voices() == {"p1": status}


def test_build_judges_a_reference_on_its_mean_likeness(clones):
    audio, rate, spans = train_clip()
    scores = iter([0.9, 0.1, 0.1, 0.5, 0.5, 0.5])  # one lucky try mustn't win
    flat = np.full(int(5 * 48000), 0.3, np.float32)
    candidates = [("Train recording", tts.speech_only(audio, rate, spans), rate), ("recording of 2026-10-12", flat, 48000)]
    status = clones.build(job(), lambda: None, "p1", candidates, lambda out, sr: next(scores))
    assert status["source"] == "recording of 2026-10-12"
    assert [t["likeness"] for t in status["tried"]] == [pytest.approx(0.367, abs=1e-3), 0.5]


def test_build_needs_three_seconds_of_speech(clones):
    audio, rate, _ = train_clip()
    with pytest.raises(ValueError, match="has 3 s of speech"):
        clones.build(job(), lambda: None, "p1", cands(audio, rate, [(0.5, 2.5)]), lambda out, sr: 0.5)


def test_nothing_is_made_without_consent(clones):
    audio, rate, spans = train_clip()
    with pytest.raises(ValueError, match="off for this player"):
        clones.build(job(), lambda: None, "p2", cands(audio, rate, spans), lambda out, sr: 0.5)
    assert not (clones.root() / "p2").exists()


def test_consent_withdrawn_mid_reading_leaves_no_clip(clones):
    audio, rate, spans = train_clip()
    clones.build(job(), lambda: None, "p1", cands(audio, rate, spans), lambda out, sr: 0.5)
    clones.synth.on_speak = lambda: clones.allowed_map.update(p1=False)
    with pytest.raises(ValueError, match="off for this player"):
        clones.speak(job(), lambda: None, "p1", "Hello there. Again.", "say", "Hello", {})
    assert clones.clips() == []


def test_speak_reads_chunk_by_chunk_and_redoes_a_reading_cut_short(clones):
    audio, rate, spans = train_clip()
    clones.build(job(), lambda: None, "p1", cands(audio, rate, spans), lambda out, sr: 0.5)
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
    clones.build(job(), lambda: None, "p1", cands(audio, rate, spans), lambda out, sr: 0.5)
    with pytest.raises(KeyError):
        clones.file("p1", name)
    with pytest.raises(KeyError):
        clones.file("..", "preview")


def test_delete_clip_and_forget(clones):
    audio, rate, spans = train_clip()
    clones.build(job(), lambda: None, "p1", cands(audio, rate, spans), lambda out, sr: 0.5)
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


class OfflineLLM:
    """LM Studio isn't running (tests never reach it)."""

    def json(self, *a, **k):
        raise ConnectionError("tests never call the real LLM")


@pytest.fixture
def api(engine, monkeypatch, tmp_path):
    import silero_vad

    monkeypatch.setattr(silero_vad, "get_speech_timestamps", lambda a, m, sampling_rate: [{"start": 0, "end": len(a)}])
    engine.status = "idle"
    engine.clones.synth = FakeSynth()
    vault = server.Vault(lambda: tmp_path / "vault")
    memory = server.Memory(vault, engine.bus, llm=OfflineLLM(), sessions_dir=engine.sessions_dir)
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
        clones.build(job(), lambda: None, pid, cands(audio, rate, spans), lambda out, sr: 0.5)
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
    clones.build(job(), lambda: None, "p1", cands(audio, rate, spans), lambda out, sr: 0.5)
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


def test_build_measures_the_clones_own_pace_and_speak_can_match_another(clones):
    audio, rate, spans = train_clip()
    status = clones.build(job(), lambda: None, "p1", cands(audio, rate, spans), lambda out, sr: 0.5)
    # The fake reads 14 characters a second: PREVIEW's words over its length.
    assert status["clone_wpm"] == round(60 * len(tts.PREVIEW.split()) / (len(tts.PREVIEW) / 14))
    text = "The party crossed the drowned bridge at dawn and nobody fell in."
    plain = clones.speak(job(), lambda: None, "p1", text, "say", "x", {})
    faster = clones.speak(job(), lambda: None, "p1", text, "say", "x", {}, tempo=1.15, in_their_words=True)
    assert faster["seconds"] == pytest.approx(plain["seconds"] / 1.15, abs=0.1)
    assert (plain["in_their_words"], faster["in_their_words"]) == (False, True)


# ------------------------------------------------------------- finding clean references in sessions


def line(pid, t0, t1, **kw):
    return {"player_id": pid, "t_start": t0, "t_end": t1, "confidence": 0.9, "provisional": False, "character": None} | kw


def test_solo_lines_are_their_own_settled_voice_with_nobody_else_near():
    messages = [
        line("p1", 0.0, 4.0),  # ok
        line("p2", 4.1, 6.0),  # p2 starts within 0.3 s of the next one ending? no: it overlaps the gap after 0-4
        line("p1", 10.0, 14.0),  # ok
        line("p1", 20.0, 24.0, character="Elara"),  # a character voice
        line("p1", 30.0, 34.0, provisional=True),
        line("p1", 40.0, 44.0, confidence=0.5),
        line("p1", 50.0, 51.0),  # too short
        line("p1", 60.0, 80.0),  # too long
        line("p1", 90.0, 94.0),
        line("p2", 93.0, 95.0),  # talks over the end
    ]
    assert tts.solo_lines(messages, "p1") == [(10.0, 14.0)]


def test_pick_sessions_takes_the_cleanest_session_first_up_to_ten_seconds_each():
    scored = [
        (30.0, "noisy", 0.0, 6.0),
        (30.0, "noisy", 10.0, 16.0),
        (50.0, "quiet", 0.0, 4.0),
        (48.0, "quiet", 10.0, 14.0),
        (45.0, "quiet", 20.0, 24.0),
        (44.0, "quiet", 30.0, 34.0),  # past 10 s of speech: not needed
        (60.0, "tiny", 0.0, 2.6),  # cleanest line, but under 3 s in all
    ]
    assert tts.pick_sessions(scored) == [
        ("quiet", [(0.0, 4.0), (10.0, 14.0), (20.0, 24.0)]),
        ("noisy", [(0.0, 6.0), (10.0, 16.0)]),
    ]
    assert tts.pick_sessions(scored, limit=1) == [("quiet", [(0.0, 4.0), (10.0, 14.0), (20.0, 24.0)])]


def test_noise_floor_is_higher_for_cleaner_speech():
    rng = np.random.default_rng(0)
    t = np.arange(48000) / 48000
    speech = (0.5 * np.sin(2 * np.pi * 200 * t) * (np.sin(2 * np.pi * 2 * t) > 0)).astype(np.float32)  # bursts
    quiet = speech + 0.001 * rng.standard_normal(len(t)).astype(np.float32)
    loud = speech + 0.05 * rng.standard_normal(len(t)).astype(np.float32)
    assert tts.noise_floor_db(quiet, 48000) > tts.noise_floor_db(loud, 48000) + 20


def test_clone_candidates_add_the_cleanest_session_recording(engine, monkeypatch):
    import json

    import silero_vad

    monkeypatch.setattr(silero_vad, "get_speech_timestamps", lambda a, m, sampling_rate: [{"start": 0, "end": len(a)}])
    p = engine.add_player("Alice")
    vid = named_voice(engine, p["id"], ALICE)
    engine.voices[vid].sample_audio = tone(ALICE, 6)
    rate = 48000
    for sid, noise, freq in [("2026-10-01_190000-aaaa", 0.03, ALICE), ("2026-10-02_190000-bbbb", 0.001, ALICE)]:
        folder = config.DATA_DIR / "sessions" / sid
        folder.mkdir(parents=True)
        t = np.arange(20 * rate) / rate
        audio = 0.3 * np.sin(2 * np.pi * freq * t) * (np.sin(2 * np.pi * 0.5 * t) > -0.5)
        audio = audio + noise * np.random.default_rng(1).standard_normal(len(t))
        (folder / "audio.wav").write_bytes(wav_bytes(audio.astype(np.float32), rate))
        msgs = [line(p["id"], 1.0, 5.0), line(p["id"], 7.0, 11.0), line(p["id"], 13.0, 17.0)]
        (folder / "transcript.json").write_text(json.dumps({"messages": msgs}))
    replay = config.DATA_DIR / "sessions" / "2026-10-03_190000-cccc"  # no recording of its own
    replay.mkdir()
    (replay / "transcript.json").write_text(json.dumps({"messages": [line(p["id"], 1.0, 5.0)]}))

    found = engine.clone_candidates(p["id"])
    assert [label for label, _, _ in found] == ["Train recording", "recording of 2026-10-02", "recording of 2026-10-01"]
    assert [r for _, _, r in found] == [SR, rate, rate]  # sessions at the mic's own rate
    assert len(found[1][1]) / rate == pytest.approx(10 + 2 * tts.REF_GAP_S, abs=0.05)  # 10 s of speech


def test_clone_candidates_skip_lines_that_dont_sound_like_them(engine, monkeypatch):
    import json

    import silero_vad

    monkeypatch.setattr(silero_vad, "get_speech_timestamps", lambda a, m, sampling_rate: [{"start": 0, "end": len(a)}])
    p = engine.add_player("Alice")
    vid = named_voice(engine, p["id"], ALICE)
    engine.voices[vid].sample_audio = tone(ALICE, 6)
    folder = config.DATA_DIR / "sessions" / "2026-10-01_190000-aaaa"
    folder.mkdir(parents=True)
    (folder / "audio.wav").write_bytes(wav_bytes(tone(2500, 20), SR))  # mislabelled: someone else's voice
    (folder / "transcript.json").write_text(json.dumps({"messages": [line(p["id"], 1.0, 5.0), line(p["id"], 7.0, 11.0)]}))
    assert [label for label, _, _ in engine.clone_candidates(p["id"])] == ["Train recording"]


def test_clone_candidates_wait_for_the_models(engine, monkeypatch):
    engine.ready.clear()
    engine.load_error = "Models failed to load"
    with pytest.raises(RuntimeError, match="Models failed to load"):
        engine.clone_candidates("p-anyone")


def test_build_scores_on_the_first_part_then_reads_their_whole_line(clones):
    audio, rate, spans = train_clip()
    first = "Okay so here's the thing, I don't trust that ferryman, not one bit, not after the last time we crossed."
    rest = "Can I check his boat for anything weird before we get on it? I want to look under the tarp."
    clones.build(job(), lambda: None, "p1", cands(audio, rate, spans), lambda out, sr: 0.5, f"{first} {rest}", "ai")
    said = clones.synth.said
    assert said[: tts.PREVIEW_RUNS] == [first] * tts.PREVIEW_RUNS  # judged on the first part
    assert said[tts.PREVIEW_RUNS :] == [f"{first} {rest}"]  # then the whole line, once
    status = clones.voices()["p1"]
    assert (status["preview_text"], status["preview_kind"]) == (f"{first} {rest}", "ai")


def test_build_without_a_line_of_theirs_uses_the_stock_one(clones):
    audio, rate, spans = train_clip()
    status = clones.build(job(), lambda: None, "p1", cands(audio, rate, spans), lambda out, sr: 0.5, "   ", "ai")
    assert (status["preview_text"], status["preview_kind"]) == (tts.PREVIEW, "")
