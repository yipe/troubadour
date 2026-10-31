"""Write-up: where each suggested fact was said, its confidence, updates to known facts, and scenes from beats."""

import json
import time

import pytest
from conftest import RecordingBus
from fastapi.testclient import TestClient
from troubadour.core.transcript import build
from troubadour.lore import memory as mem
from troubadour.lore import writeup
from troubadour.lore.campaign import Vault
from troubadour.lore.facts import Fact
from troubadour.server import deps
from troubadour.server.app import app

SID = "2026-10-08_193401-eebf"

# 30 lines at 10 s apart; line 17 (t=170) is the one that says Mudge took the bridge.
FILLER = [f"Line {i} about the weather and snacks and nothing else." for i in range(30)]
FIXTURE = list(FILLER)
FIXTURE[3] = "Elara asks Magenta about the Greyfen road."
FIXTURE[8] = "The ogre Mudge is somewhere near the old bridge, I think."
FIXTURE[17] = "Mudge the ogre now guards the Greyfen bridge, and he wants a toll."
FIXTURE[22] = "Magenta pours everyone another drink."
FIXTURE[25] = "Mudge laughs."


def found_at(fact, about, aliases, lines) -> float | None:
    line = writeup.source_line(fact, about, aliases, lines)
    return line["t_start"] if line else None


def messages(texts=FIXTURE, speaker="Theo", character="Elara"):
    return [
        {"t_start": i * 10.0, "text": t, "speaker": speaker, "character": character, "player_id": "p1"}
        for i, t in enumerate(texts)
    ]


# ------------------------------------------------------------------ source_line


def test_source_line_picks_the_line_that_says_it():
    line = writeup.source_line("Mudge the ogre now guards the Greyfen bridge.", "Mudge", [], messages())
    assert line
    assert line["t_start"] == 170.0


def test_source_line_prefers_a_line_that_names_the_subject():
    # Equal overlap on both lines: the one naming the subject (or an alias) beats the earlier one.
    tie = messages(["Someone guards the bridge toll.", "Mudge guards the bridge toll."])
    assert found_at("Guards the bridge toll.", "Mudge", [], tie) == 10.0
    assert found_at("Guards the bridge toll.", "Ogre", ["Mudge"], tie) == 10.0


def test_source_line_ties_go_to_the_earlier_line():
    lines = messages(["The ogre guards the bridge.", "The ogre guards the bridge."])
    assert found_at("The ogre guards the bridge.", "Nobody", [], lines) == 0.0


def test_source_line_gives_nothing_under_the_threshold():
    # Only the subject's name is shared: not a source.
    assert writeup.source_line("Mudge was once a baker in Dallon.", "Mudge", [], messages()) is None
    assert writeup.source_line("", "Mudge", [], messages()) is None
    assert writeup.source_line("Anything at all.", "Mudge", [], []) is None


def test_said_by_is_the_character_else_the_player_else_nobody():
    assert writeup.said_by({"speaker": "Theo", "character": "Elara", "player_id": "p1"}) == "Elara"
    assert writeup.said_by({"speaker": "Theo", "character": None, "player_id": "p1"}) == "Theo"
    assert writeup.said_by({"speaker": "Voice 3", "character": None, "player_id": None}) is None


# ------------------------------------------------------------------ the facts step


class LLM:
    def __init__(self, reply):
        self.reply, self.user = reply, ""

    def json(self, system, user, schema, max_tokens=4000, think=False, progress=None):
        self.user = user
        return self.reply


def test_facts_step_checks_confidence_and_replaces():
    known = [Fact("Mudge sleeps under the bridge.", "Mudge")]
    reply = {
        "facts": [
            {"about": "Mudge", "text": "A.", "confidence": "gm", "replaces": 1},
            {"about": "Mudge", "text": "B.", "confidence": "certain", "replaces": 99},
            {"about": "Mudge", "text": "C.", "replaces": 0},
            {"about": "Mudge", "text": "D.", "confidence": "theory", "replaces": "1"},
            {"about": "Mudge", "text": "E.", "confidence": "once", "replaces": True},
            {"about": "", "text": "F."},
            "junk",
        ]
    }
    got = writeup.facts(LLM(reply), writeup.Notes(), known)
    assert [(f.text, f.confidence, f.replaces) for f in got] == [
        ("A.", "gm", "Mudge sleeps under the bridge."),
        ("B.", "once", None),
        ("C.", "once", None),
        ("D.", "theory", None),
        ("E.", "once", None),
    ]


def test_known_facts_are_numbered_in_the_prompt_and_capped_at_forty():
    known = [Fact(f"Fact number {i}.", "Mudge") for i in range(1, 60)]
    llm = LLM({"facts": []})
    writeup.facts(llm, writeup.Notes(beats=[writeup.Beat("0:05", "x")]), known)
    assert llm.user.startswith("Known facts:\n1. [Mudge] Fact number 1.\n")
    assert "40. [Mudge] Fact number 40." in llm.user
    assert "41." not in llm.user
    assert "Notes:\nBeats:" in llm.user
    empty = LLM({"facts": []})
    writeup.facts(empty, writeup.Notes())
    assert empty.user.startswith("Known facts:\n(none)")


# ------------------------------------------------------------------ the whole job


class FakeLLM:
    def __init__(self, read, found=None, scenes=None):
        self.read, self.found, self.scenes = read, found or {"facts": []}, scenes
        self.prompts: dict[str, str] = {}

    def json(self, system, user, schema, max_tokens=4000, think=False, progress=None):
        self.prompts[system[:30]] = user
        if system is writeup.READ_SYSTEM:
            return self.read
        if system is writeup.WRITE_SYSTEM:
            return {"title": "The Greyfen Bridge", "last_time": "They met Mudge.", "spotlight": [], "highlights": []}
        if system is writeup.FACTS_SYSTEM:
            return self.found
        if system is writeup.SCENES_SYSTEM:
            if isinstance(self.scenes, Exception):
                raise self.scenes
            return self.scenes
        raise AssertionError(system[:60])


BEATS = [
    {"at": "00:00", "text": "The table settled in."},
    {"at": "00:30", "text": "Elara asked Magenta about the road."},
    {"at": "01:40", "text": "Mudge took the Greyfen bridge."},
    {"at": "02:30", "text": "Magenta poured drinks at the inn."},
    {"at": "04:00", "text": "Mudge laughed."},
]
READ = {"beats": BEATS, "people": [], "places": []}


@pytest.fixture
def setup(tmp_path):
    vault = Vault(tmp_path / "campaign")
    sessions = tmp_path / "sessions"
    for name, kind in (
        ("Elara", "pc"),
        ("Mudge", "npc"),
        ("Magenta", "npc"),
        ("Greyfen", "place"),
        ("The Rusty Flagon", "place"),
    ):
        vault.create(name, kind)
    vault.update("Greyfen", aliases=["the Fen"])
    vault.add_fact("Mudge", Fact("Mudge sleeps under the Greyfen bridge.", "Mudge"))
    players = [{"id": "p1", "name": "Theo", "character": "Elara", "is_gm": False, "color": "#000"}]
    voices = [{"id": "v1", "label": "Voice 1", "status": "named", "player_id": "p1", "character": None, "trained": True}]
    msgs = [
        {
            "id": f"m{i}",
            "t_start": i * 10.0,
            "t_end": i * 10.0 + 4,
            "voice_id": "v1",
            "provisional": False,
            "confidence": 0.9,
            "text": t,
        }
        for i, t in enumerate(FIXTURE)
    ]
    started = time.mktime((2026, 10, 8, 19, 34, 1, 0, 0, -1))
    record = build({"id": SID, "started_at": started, "source": None, "duration_s": 600}, players, voices, msgs)
    (sessions / SID).mkdir(parents=True)
    (sessions / SID / "transcript.json").write_text(json.dumps(record))

    def run(llm):
        m = mem.Memory(vault, RecordingBus(), llm=llm, sessions_dir=lambda: sessions, seed=lambda: [])
        job = m.write_up(SID)
        deadline = time.monotonic() + 5
        while job.state in ("queued", "running") and time.monotonic() < deadline:
            time.sleep(0.01)
        return job

    return vault, sessions, run


@pytest.fixture
def client_for_engine(engine, monkeypatch):
    monkeypatch.setattr(deps, "engine", engine)
    return TestClient(app, base_url="http://127.0.0.1:8765")


def scenes_file(sessions):
    path = sessions / SID / "scenes.json"
    return json.loads(path.read_text()) if path.exists() else None


def test_write_up_suggestions_carry_sources_confidence_and_updates(setup):
    vault, _, run = setup
    found = {
        "facts": [
            {"about": "Mudge", "text": "Mudge the ogre now guards the Greyfen bridge.", "confidence": "gm", "replaces": 1},
            {"about": "Magenta", "text": "Magenta was once a pirate on the Silver Sea.", "confidence": "theory", "replaces": -1},
        ]
    }
    llm = FakeLLM(READ, found, scenes={"scenes": []})
    job = run(llm)
    assert job.state == "done", job.message
    assert "1. [Mudge] Mudge sleeps under the Greyfen bridge." in llm.prompts[writeup.FACTS_SYSTEM[:30]]
    update, new = vault.get("Mudge").suggested_facts[0], vault.get("Magenta").suggested_facts[0]
    assert update.replaces == "Mudge sleeps under the Greyfen bridge."
    assert (update.confidence, update.said_by) == ("gm", "Elara")
    # The vault has no session index here, so a reloaded source has the page and time but no id.
    assert update.source
    assert (update.source.session_page, update.source.t) == ("2026-10-08 The Greyfen Bridge", 170.0)
    assert new.replaces is None
    assert new.source
    assert new.source.t is None  # no line says it: the page only
    assert (new.said_by, new.confidence) == (None, "theory")


def test_a_replaces_that_is_not_one_of_the_entrys_facts_is_dropped(setup):
    vault, _, run = setup
    # The model only points at a number, and fact 1 belongs to Mudge: Magenta's suggestion is plain new.
    found = {"facts": [{"about": "Magenta", "text": "Magenta runs the Flagon.", "confidence": "gm", "replaces": 1}]}
    run(FakeLLM(READ, found, scenes={"scenes": []}))
    assert vault.get("Magenta").suggested_facts[0].replaces is None


def test_scenes_are_validated_and_stored(setup):
    vault, sessions, run = setup
    reply = {
        "scenes": [
            {"start": 2, "title": "  Table   talk  ", "place": "Greyfen"},  # first scene is moved to beat 1
            {"start": 3, "title": "Mudge takes the bridge across the Greyfen at long last today", "place": "the Fen"},
            {"start": 3, "title": "Same start again", "place": ""},  # not strictly increasing
            {"start": 99, "title": "Out of range", "place": ""},
            {"start": 4, "title": "Drinks", "place": "Atlantis"},  # unknown place
            {"start": 2, "title": "Back in time", "place": ""},  # goes backwards
            {"start": 5, "title": "", "place": ""},  # no title
            {"start": "5", "title": "Stringy", "place": ""},
            "junk",
        ]
    }
    job = run(FakeLLM(READ, scenes=reply))
    assert job.state == "done"
    assert scenes_file(sessions) == [
        {"t": 0.0, "title": "Table talk", "place": "Greyfen"},
        {"t": 100.0, "title": "Mudge takes the bridge across the Greyfen at", "place": "Greyfen"},
        {"t": 150.0, "title": "Drinks", "place": None},
    ]


def test_a_failing_scenes_call_still_completes_the_job(setup):
    vault, sessions, run = setup
    (sessions / SID / "scenes.json").write_text("[]")  # left by an earlier write-up
    job = run(FakeLLM(READ, scenes=RuntimeError("model went away")))
    assert job.state == "done", job.message
    assert scenes_file(sessions) is None
    assert [s["state"] for s in job.steps] == ["done"] * 5
    assert list(vault.root.joinpath("Sessions").glob("*.md"))


def test_too_few_usable_scenes_store_nothing(setup):
    _, sessions, run = setup
    run(FakeLLM(READ, scenes={"scenes": [{"start": 1, "title": "Only one", "place": ""}]}))
    assert scenes_file(sessions) is None


# ------------------------------------------------------------------ SavedSession.scenes


def test_saved_sessions_list_their_scenes(engine, client_for_engine):
    sessions = engine.sessions_dir()
    for sid in ("2026-10-01_190000-aaaa", "2026-10-02_190000-bbbb", "2026-10-03_190000-cccc"):
        (sessions / sid).mkdir(parents=True)
        (sessions / sid / "meta.json").write_text(json.dumps({"id": sid, "started_at": 1.0}))
    (sessions / "2026-10-01_190000-aaaa" / "scenes.json").write_text(json.dumps([{"t": 12, "title": "Docks", "place": None}]))
    (sessions / "2026-10-02_190000-bbbb" / "scenes.json").write_text("not json")
    by_id = {s["id"]: s["scenes"] for s in client_for_engine.get("/api/sessions").json()}
    assert by_id == {
        "2026-10-01_190000-aaaa": [{"t": 12.0, "title": "Docks", "place": None}],
        "2026-10-02_190000-bbbb": None,
        "2026-10-03_190000-cccc": None,
    }
