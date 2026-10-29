"""Voice clones, the audio/text/files part (tts.py), without models: FakeSynth reads at a set pace;
consent, files and progress are real."""

import json
import threading

import numpy as np
import pytest
from conftest import FakeSynth, job, tone, write_wav

from troubadour import tts
from troubadour.audio import read_wav

ALICE = 200.0


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


def cands(seconds: float = 12.0):
    audio, rate, spans = train_clip(seconds)
    return [("Train recording", tts.speech_only(audio, rate, spans), rate)]


FLAT = ("recording of 2026-10-12", np.full(5 * 48000, 0.3, np.float32), 48000)  # reads louder than a sine


def built(clones, pid: str = "p1") -> dict:
    return clones.build(job(), pid, cands(), lambda out, sr: 0.5)


# ------------------------------------------------------------- audio


def test_speech_only_cuts_the_silences_and_stops_at_ten_seconds():
    audio, rate, spans = train_clip(40)
    ref = tts.speech_only(audio, rate, spans)
    gaps = 4 * int(tts.REF_GAP_S * rate)  # 5 stretches of 2 s make the 10 s
    assert len(ref) == int(tts.REF_S * rate) + gaps
    assert np.abs(ref).max() == pytest.approx(0.9, abs=1e-3)
    assert tts.speech_only(audio, rate, []).size == 0


def test_join_is_speech_only_over_back_to_back_clips():
    pieces = [np.full(4 * 48000, 0.2, np.float32), np.full(4 * 48000, 0.4, np.float32), np.ones(4 * 48000, np.float32)]
    joined = tts.join(pieces, 48000)
    assert len(joined) / 48000 == pytest.approx(10 + 2 * tts.REF_GAP_S, abs=1e-3)  # capped at 10 s of speech
    assert joined.max() == pytest.approx(0.9)
    assert tts.join([], 48000).size == 0


def test_noise_floor_is_higher_for_cleaner_speech():
    rng = np.random.default_rng(0)
    t = np.arange(48000) / 48000
    speech = (0.5 * np.sin(2 * np.pi * 200 * t) * (np.sin(2 * np.pi * 2 * t) > 0)).astype(np.float32)  # bursts
    quiet = speech + 0.001 * rng.standard_normal(len(t)).astype(np.float32)
    loud = speech + 0.05 * rng.standard_normal(len(t)).astype(np.float32)
    assert tts.noise_floor_db(quiet, 48000) > tts.noise_floor_db(loud, 48000) + 20
    assert tts.noise_floor_db(np.zeros(10, np.float32), 48000) == 0.0  # too short to tell


def test_speech_seconds_leaves_out_the_silence_around():
    a = np.concatenate([np.zeros(24000), np.full(48000, 0.5), np.zeros(24000)]).astype(np.float32)
    assert tts.speech_seconds(a, 24000) == pytest.approx(2.0)
    assert tts.speech_seconds(np.zeros(100, np.float32), 24000) == 0.0


# ------------------------------------------------------------- references from sessions


def line(pid, t0, t1, voice="v-own", **kw):
    return {"player_id": pid, "voice_id": voice, "t_start": t0, "t_end": t1, "confidence": 0.9, "provisional": False} | kw


def record(*messages, character_voices=("v-elara",)):
    voices = [{"id": "v-own", "player_id": "p1", "character": None}]
    voices += [{"id": v, "player_id": "p1", "character": "Elara"} for v in character_voices]
    return {"voices": voices, "messages": list(messages)}


def test_solo_lines_are_their_settled_lines_with_nobody_else_near():
    r = record(
        line("p1", 0.0, 4.0),
        line("p2", 4.1, 6.0, voice="v-p2"),  # talks right after: 0.1 s is within the gap
        line("p1", 10.0, 14.0),  # ok
        line("p1", 20.0, 24.0, voice="v-elara"),  # ok: in any of their voices
        line("p1", 30.0, 34.0, provisional=True),
        line("p1", 40.0, 44.0, confidence=0.5),
        line("p1", 50.0, 51.0),  # too short
        line("p1", 60.0, 80.0),  # too long
        line("p1", 90.0, 94.0),
        line("p2", 93.0, 95.0, voice="v-p2"),  # talks over the end
    )
    assert tts.solo_lines(r, "p1") == [2, 3]


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


# ------------------------------------------------------------- text


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


# ------------------------------------------------------------- building a voice


def test_build_keeps_the_reference_that_clones_closest_and_always_cleans_it(clones):
    candidates = [*cands(), FLAT]
    j = job()
    status = clones.build(j, "p1", candidates, lambda out, sr: float(out[0]))
    assert status["source"] == "recording of 2026-10-12"
    assert status["likeness"] == pytest.approx(0.9, abs=1e-3)
    assert [t["source"] for t in status["tried"]] == ["Train recording", "recording of 2026-10-12"]
    assert (j.done, j.total) == (2 * tts.PREVIEW_RUNS + 1, 2 * tts.PREVIEW_RUNS + 1)  # + the preview itself
    assert len(clones.synth.denoised) == 2  # every reference is cleaned: the clone copies the room
    assert len(clones.synth.said) == 2 * tts.PREVIEW_RUNS + 1  # several tries each: one is luck
    assert status["preview_url"].startswith("/api/clones/p1/preview.wav?v=")
    assert read_wav(clones.root() / "p1" / "reference.wav")[1] == 48000
    assert clones.file("p1", "preview").is_file()

    status = clones.build(j, "p1", candidates, lambda out, sr: -float(out[0]))
    assert status["source"] == "Train recording"
    assert clones.voices() == {"p1": status | {"characters": []}}


def test_build_judges_a_reference_on_its_mean_likeness(clones):
    scores = iter([0.9, 0.1, 0.1, 0.5, 0.5, 0.5])  # one lucky try mustn't win
    status = clones.build(job(), "p1", [*cands(), FLAT], lambda out, sr: next(scores))
    assert status["source"] == "recording of 2026-10-12"
    assert [t["likeness"] for t in status["tried"]] == [pytest.approx(0.367, abs=1e-3), 0.5]


def test_build_scores_on_the_first_sentences_then_reads_their_whole_line(clones):
    first = "Okay so here's the thing, I don't trust that ferryman, not one bit, not after the last time we crossed."
    rest = "Can I check his boat for anything weird before we get on it? I want to look under the tarp."
    clones.build(job(), "p1", cands(), lambda out, sr: 0.5, f"{first} {rest}", "ai")
    said = clones.synth.said
    assert said[: tts.PREVIEW_RUNS] == [first] * tts.PREVIEW_RUNS  # judged on the first sentences
    assert said[tts.PREVIEW_RUNS :] == [f"{first} {rest}"]  # then the whole line, once
    status = clones.voices()["p1"]
    assert (status["preview_text"], status["preview_kind"]) == (f"{first} {rest}", "ai")
    # The fake reads 14 characters a second: the line's words over its length is the clone's pace.
    assert status["clone_wpm"] == round(60 * len(f"{first} {rest}".split()) / (len(f"{first} {rest}") / 14))


def test_build_without_a_line_of_theirs_uses_the_stock_one(clones):
    status = clones.build(job(), "p1", cands(), lambda out, sr: 0.5, "   ", "ai")
    assert (status["preview_text"], status["preview_kind"]) == (tts.PREVIEW, "")


def test_build_needs_three_seconds_of_speech(clones):
    audio, rate, _ = train_clip()
    with pytest.raises(ValueError, match="has 3 s of speech"):
        clones.build(job(), "p1", [("Train recording", tts.speech_only(audio, rate, [(0.5, 2.5)]), rate)], lambda o, s: 0.5)


def test_every_model_call_waits_out_a_live_session(clones):
    waited = []
    clones.wait_idle = lambda j: waited.append(len(clones.synth.said))
    built(clones)
    # Before the reference's cleaning, its conditioning, and each reading (3 trials + the preview).
    assert len(waited) == 2 + tts.PREVIEW_RUNS + 1
    clones.speak(job(), "p1", "Hello there.", "say", "Hello", {})
    assert len(waited) == 2 + tts.PREVIEW_RUNS + 1 + 2


# ------------------------------------------------------------- character voices


def test_persona_keys_are_safe_folder_names():
    assert tts.persona_key("Morvath the Grey") == "morvath-the-grey"
    assert tts.persona_key("Élara!") == "lara"
    assert tts.persona_key("???") == "character"
    assert tts.persona_key("Table") == "table-1"  # never the table voice's


def test_a_character_voice_has_its_own_reference_preview_and_clips(clones):
    built(clones)
    elara = clones.build(job(), "p1", [FLAT], lambda out, sr: 0.4, "Hold, traveller.", "their lines", "elara", "Elara")
    assert (elara["persona"], elara["label"]) == ("elara", "Elara")
    assert elara["preview_url"].startswith("/api/clones/p1/preview_elara.wav?v=")
    status = clones.voices()["p1"]
    assert status["persona"] == "table"
    assert [c["label"] for c in status["characters"]] == ["Elara"]
    assert clones.file("p1", "preview_elara") == clones.root() / "p1" / "as" / "elara" / "preview.wav"
    with pytest.raises(KeyError):
        clones.file("p1", "preview_morvath")

    clones.synth.said.clear()
    clip = clones.speak(job(), "p1", "Hold, traveller.", "say", "Hold", {}, persona="elara")
    assert clip["persona"] == "elara"
    with pytest.raises(KeyError):
        clones.delete_clip("p1", "preview_elara")
    with pytest.raises(ValueError, match="Build this player's voice first"):
        clones.speak(job(), "p1", "Hi.", "say", "Hi", {}, persona="morvath")
    with pytest.raises(KeyError):
        clones.speak(job(), "p1", "Hi.", "say", "Hi", {}, persona="../x")


def test_prune_drops_character_voices_a_rebuild_no_longer_finds(clones):
    built(clones)
    for key in ("elara", "morvath"):
        clones.build(job(), "p1", [FLAT], lambda out, sr: 0.4, persona=key, label=key.title())
    clones.prune("p1", {"table", "elara"})
    assert [c["persona"] for c in clones.voices()["p1"]["characters"]] == ["elara"]


# ------------------------------------------------------------- consent


def test_nothing_is_made_without_consent(clones):
    with pytest.raises(ValueError, match="off for this player"):
        built(clones, "p2")
    with pytest.raises(ValueError, match="off for this player"):
        clones.save_profile("p2", {"player_id": "p2"})
    assert not (clones.root() / "p2").exists()


def test_consent_withdrawn_mid_reading_leaves_no_clip(clones):
    built(clones)
    clones.synth.on_speak = lambda: clones.allowed_map.update(p1=False)
    with pytest.raises(ValueError, match="off for this player"):
        clones.speak(job(), "p1", "Hello there. Again.", "say", "Hello", {})
    assert clones.clips() == []


def test_forget_waits_for_a_clip_being_written(clones):
    """forget() and a job's final write share a lock: the clip is either never written or deleted."""
    built(clones)
    started = threading.Event()
    clones.synth.on_speak = started.set
    outcome = []

    def run():
        try:
            outcome.append(clones.speak(job(), "p1", "Hi.", "say", "Hi", {}))
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


# ------------------------------------------------------------- speaking and clips


def test_speak_reads_chunk_by_chunk_and_redoes_a_reading_cut_short(clones):
    built(clones)
    clones.synth.said.clear()
    clones.synth.bad = 1
    text = "The party crossed the drowned bridge at dawn.\n\nNobody fell in, mostly."
    j, seen = job(), []
    j.on_change = lambda: seen.append(j.done)
    clip = clones.speak(j, "p1", text, "say", "The party", {"x": 1})
    assert clones.synth.said == ["The party crossed the drowned bridge at dawn."] * 2 + ["Nobody fell in, mostly."]
    assert (j.done, j.total) == (2, 2)
    assert seen[-3:-1] == [1, 2]
    expected = (len(text.split("\n\n")[0]) + len(text.split("\n\n")[1])) / 14 + tts.PARAGRAPH_PAUSE_S
    assert clip["seconds"] == pytest.approx(expected, abs=0.1)
    assert clones.clips()[0] == clip
    assert clip["url"] == f"/api/clones/p1/{clip['id']}.wav"
    assert clones.file("p1", clip["id"]).is_file()


def test_speak_can_match_their_pace(clones):
    built(clones)
    text = "The party crossed the drowned bridge at dawn and nobody fell in."
    plain = clones.speak(job(), "p1", text, "say", "x", {})
    faster = clones.speak(job(), "p1", text, "say", "x", {}, tempo=1.15, in_their_words=True)
    assert faster["seconds"] == pytest.approx(plain["seconds"] / 1.15, abs=0.1)
    assert (plain["in_their_words"], faster["in_their_words"]) == (False, True)


def test_speak_needs_a_built_voice(clones):
    with pytest.raises(ValueError, match="Build this player's voice first"):
        clones.speak(job(), "p1", "Hi.", "say", "Hi", {})


@pytest.mark.parametrize("name", ["../reference", "..", "a/b", "reference", "voice", ""])
def test_files_are_only_previews_and_clips(clones, name):
    built(clones)
    with pytest.raises(KeyError):
        clones.file("p1", name)
    with pytest.raises(KeyError):
        clones.file("..", "preview")


def test_delete_clip_and_forget(clones):
    built(clones)
    clones.save_profile("p1", {"player_id": "p1"})
    clip = clones.speak(job(), "p1", "Hi.", "say", "Hi", {})
    with pytest.raises(KeyError):
        clones.delete_clip("p1", "preview")
    clones.delete_clip("p1", clip["id"])
    assert clones.clips() == []
    clones.forget("p1")
    assert (clones.voices(), clones.profiles()) == ({}, {})
    assert not (clones.root() / "p1").exists()


def test_clips_from_two_players_list_newest_first(clones):
    clones.allowed_map["p2"] = True
    for pid in ("p1", "p2"):
        built(clones, pid)
    first = clones.speak(job(), "p1", "One.", "say", "One", {})
    second = clones.speak(job(), "p2", "Two.", "say", "Two", {})
    assert [c["id"] for c in clones.clips()] == [second["id"], first["id"]]
    meta = json.loads((clones.root() / "p1" / "clips" / f"{first['id']}.json").read_text())
    assert "url" not in meta  # the URL is derived, not stored


def test_a_corrupt_clip_record_is_skipped(clones):
    folder = clones.root() / "p1" / "clips"
    folder.mkdir(parents=True)
    (folder / "cbroken.json").write_text("{nope")
    write_wav(folder / "cbroken.wav", tone(ALICE, 0.1))
    assert clones.clips() == []
