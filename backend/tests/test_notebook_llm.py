"""The notebook's LLM pass: validation of what the model says, the cadence of the loop, and spelling items."""

import json
import threading

import pytest
from conftest import NullSource, ScriptedLLM
from troubadour.engine import LiveSession
from troubadour.engine.model import Message, Player, Voice
from troubadour.engine.notebook import MIN_SPEECH_S, RETRY_S, NotebookLoop
from troubadour.lore import notebook as nb
from troubadour.lore.campaign import Vault


def line(i: int, text: str, speaker="Dana", is_gm=False) -> nb.Line:
    return {"id": f"m{i}", "t": 10.0 * i, "speaker": speaker, "player_id": "p1", "is_gm": is_gm, "text": text}


LINES = [
    line(1, "The Tide Gate opens at low water.", is_gm=True),
    line(2, "Maybe Captain Vell is the smuggler."),
    line(3, "Brann paid the harbour master forty gold."),
]
KNOWN: nb.Known = {
    "entities": [("Tide Gate", "place", ["the gate"]), ("Captain Vell", "npc", [])],
    "facts": [("Captain Vell", "Captain Vell runs the Rusty Flagon."), ("Tide Gate", "The Tide Gate is locked.")],
}


WORDS = [
    "Alphonse",
    "Bertrand",
    "Cornelius",
    "Dorothea",
    "Evangeline",
    "Ferdinand",
    "Gwendolyn",
    "Hieronymus",
    "Isadora",
    "Jebediah",
    "Kristoffer",
    "Leopold",
    "Marguerite",
    "Nathaniel",
    "Octavia",
    "Percival",
    "Quentin",
    "Rosalind",
    "Sebastian",
    "Theodora",
    "Ulysses",
    "Valentina",
    "Wilhelmina",
    "Xavier",
    "Yolanda",
    "Zacharias",
    "Ambrose",
    "Beatrix",
    "Cassius",
    "Delphine",
    "Ezekiel",
    "Fiorella",
    "Gideon",
    "Henrietta",
    "Ignatius",
    "Josephine",
    "Lysander",
    "Mortimer",
    "Nerissa",
    "Ophelia",
    "Peregrine",
    "Rupert",
    "Seraphina",
    "Thaddeus",
    "Ursula",
    "Vivienne",
    "Winifred",
    "Xanthe",
    "Yvette",
    "Zephyr",
]


def run(reply, known=KNOWN, lines=LINES):
    return nb.propose(ScriptedLLM(reply), lines, known)


def test_valid_output_becomes_anchored_items():
    items = run(
        {
            "facts": [{"about": "tide gate", "text": "The Tide Gate opens at low water.", "line": 1, "confidence": "gm"}],
            "updates": [{"replaces": 2, "text": "The Tide Gate is unlocked at low water.", "line": 1}],
            "entries": [{"name": "Brann", "type": "npc", "line": 3}],
        }
    )
    fact, update, entry = items
    assert (fact["kind"], fact["about"], fact["confidence"]) == ("fact", "Tide Gate", "gm")
    assert (fact["line_id"], fact["t"], fact["said_by"]) == ("m1", 10.0, {"name": "Dana", "player_id": "p1"})
    assert (update["kind"], update["old"], update["about"], update["line_id"]) == (
        "update",
        "The Tide Gate is locked.",
        "Tide Gate",
        "m1",
    )
    assert (entry["kind"], entry["text"], entry["entry_type"], entry["line_id"]) == ("entry", "Brann", "npc", "m3")


def test_a_fact_may_be_about_a_new_entry_from_the_same_answer():
    items = run(
        {
            "facts": [{"about": "Brann", "text": "Brann paid the harbour master forty gold.", "line": 3, "confidence": "once"}],
            "entries": [{"name": "Brann", "type": "npc", "line": 3}],
        }
    )
    assert {(i["kind"], i["about"]) for i in items} == {("fact", "Brann"), ("entry", "Brann")}


def test_adversarial_output_is_dropped_or_clamped():
    good = {"about": "Tide Gate", "text": "Ships wait for the second bell.", "line": 1, "confidence": "gm"}
    reply = {
        "facts": [
            {**good, "line": 99},
            {**good, "line": 0},
            {**good, "line": True},
            {**good, "line": "1"},
            {**good, "about": "Nobody At All"},
            {**good, "text": "Dana is currently standing on the dock."},
            {**good, "text": "The Tide Gate is locked."},  # already known
            {**good, "text": ""},
            {**good, "confidence": "certain"},  # clamped, not dropped
            "not a dict",
            *[{**good, "text": f"{w} guards the harbour at {w[::-1]}."} for w in WORDS],
        ],
        "updates": [
            {"replaces": 9, "text": "x", "line": 1},
            {"replaces": 0, "text": "x", "line": 1},
            {"replaces": "1", "text": "x", "line": 1},
            {"replaces": 1, "text": "Captain Vell sold the Rusty Flagon.", "line": 40},
        ],
        "entries": [
            {"name": "Zarathul the Unseen", "type": "npc", "line": 3},  # not in the text
            {"name": "Tide Gate", "type": "place", "line": 1},  # known
            {"name": "the gate", "type": "place", "line": 1},  # known alias
            {"name": "Bad/Name", "type": "npc", "line": 3},
            {"name": "Brann", "type": "dragon", "line": 3},  # type clamped
            {"name": "Brann", "type": "npc", "line": 3},  # duplicate
        ],
    }
    items = run(reply)
    kinds = [i["kind"] for i in items]
    assert kinds.count("fact") == nb.MAX_FACTS
    assert "update" not in kinds
    entries = [i for i in items if i["kind"] == "entry"]
    assert [(e["text"], e["entry_type"]) for e in entries] == [("Brann", "term")]
    assert all(i["line_id"] in {"m1", "m2", "m3"} for i in items)
    assert all(i["confidence"] in nb.CONFIDENCES for i in items if i["kind"] == "fact")
    assert [i["confidence"] for i in items if i["kind"] == "fact"][0] == "once"  # "certain" is clamped
    assert not any("standing" in i["text"] or i["text"] == "The Tide Gate is locked." for i in items)


def test_caps_per_pass():
    many = [{"replaces": 1, "text": f"Captain Vell changed in way {chr(97 + i) * 6}.", "line": 1} for i in range(10)]
    names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf"]
    lines = [line(1, " ".join(names))]
    items = run({"facts": [], "updates": many, "entries": [{"name": n, "type": "item", "line": 1} for n in names]}, lines=lines)
    # all ten updates replace the same fact, so only one survives; entries are capped at five
    assert [i["kind"] for i in items].count("update") == 1
    assert [i["kind"] for i in items].count("entry") == nb.MAX_ENTRIES
    distinct = [{"replaces": n, "text": f"Rewritten fact {n}: entirely different words {n}{n}{n}.", "line": 1} for n in (1, 2)]
    assert len(run({"updates": distinct}, lines=lines)) == 2


@pytest.mark.parametrize("reply", [{}, {"facts": "no"}, {"facts": None, "updates": 3, "entries": {}}, []])
def test_garbage_replies_give_nothing(reply):
    assert run(reply) == []


def test_no_lines_means_no_call():
    llm = ScriptedLLM({})
    assert nb.propose(llm, [], KNOWN) == []
    assert llm.prompts == []


def test_prompt_numbers_lines_and_known_facts():
    llm = ScriptedLLM({})
    nb.propose(llm, LINES, KNOWN)
    (prompt,) = llm.prompts
    assert "2. [00:20] Dana: Maybe Captain Vell" in prompt
    assert "1. [00:10] Dana (GM): The Tide Gate" in prompt
    assert "F2. Tide Gate: The Tide Gate is locked." in prompt


def test_spellings_group_by_pair_and_are_stable():
    def msg(text, fixes):
        return {"text": text, "fixes": fixes}

    msgs = [
        msg("Magenta waits", [{"start": 0, "end": 7, "heard": "Magento"}]),
        msg("Magenta twice, Magenta", [{"start": 0, "end": 7, "heard": "Magento"}, {"start": 15, "end": 22, "heard": "Magento"}]),
        msg("See Dallon", [{"start": 4, "end": 10, "heard": "Dalon"}]),
        msg("no fixes", []),
        msg("bad", [{"start": "x"}]),
    ]
    out = nb.spellings(msgs)
    assert sorted((o["old"], o["text"], o["count"]) for o in out) == [("Dalon", "Dallon", 1), ("Magento", "Magenta", 2)]
    assert all(o["kind"] == "spelling" for o in out)
    assert nb.spellings(msgs) == out
    more = nb.spellings([*msgs, msg("Magenta again", [{"start": 0, "end": 7, "heard": "Magento"}])])
    assert {o["id"]: o["count"] for o in more} == {o["id"]: o["count"] + (o["old"] == "Magento") for o in out}


# ------------------------------------------------------------------ the loop


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


@pytest.fixture
def loop(engine, tmp_path):
    engine.llm_ok = True
    engine.players["p1"] = Player(id="p1", name="Dana", is_gm=True)
    engine.voices["v1"] = Voice(id="v1", label="Voice 1", status="named", player_id="p1")
    engine.vault = Vault(tmp_path / "vault")
    engine.vault.create("Tide Gate", "place")
    engine.bind_notebook(engine.live)  # the loop thread only wakes after 10 s; tests call tick()
    lp = NotebookLoop(engine, engine.live, clock=Clock())
    return lp


def say(engine, i: int, seconds: float, text="The Tide Gate opens at low water.", fixes=None):
    m = Message(f"m{i}", "v1", text, 100.0 * i, 100.0 * i + seconds, 0.9, False, fixes or [])
    with engine.lock:
        engine.messages[m.id] = m


FACT = {"facts": [{"about": "Tide Gate", "text": "The Tide Gate opens at low water.", "line": 1, "confidence": "gm"}]}


def test_under_threshold_no_call_over_it_exactly_one(engine, loop):
    llm = engine.cleanup_llm = ScriptedLLM(FACT, FACT)
    say(engine, 1, MIN_SPEECH_S - 1)
    assert loop.tick() is False
    assert llm.prompts == []
    say(engine, 2, 2)
    assert loop.tick() is True
    assert len(llm.prompts) == 1
    assert loop.tick() is False  # the speech was read; nothing new
    assert len(llm.prompts) == 1
    (item,) = engine.live.notebook.items
    assert (item.kind, item.line_id, item.t, item.said_by) == ("fact", "m1", 100.0, {"name": "Dana", "player_id": "p1"})
    flags = [e["updating"] for e in engine.bus.of("notebook.updated")]
    assert (flags[0], flags[-1]) == (True, False)
    assert engine.live.notebook.updating is False


def test_updating_is_true_during_the_pass_and_a_second_pass_waits(engine, loop):
    seen = {}

    class Slow:
        def json(self, system, user, schema, max_tokens=4000):
            seen["updating"] = engine.live.notebook.updating
            seen["lock_free"] = engine.lock.acquire(blocking=False)
            if seen["lock_free"]:
                engine.lock.release()
            say(engine, 9, MIN_SPEECH_S + 1)  # more speech arrives while the model thinks
            seen["second"] = loop.tick()
            return {}

    engine.cleanup_llm = Slow()
    say(engine, 1, MIN_SPEECH_S)
    assert loop.tick() is True
    assert seen == {"updating": True, "lock_free": True, "second": False}


def test_context_is_the_last_minute_and_capped(engine, loop):
    llm = engine.cleanup_llm = ScriptedLLM({}, {})
    say(engine, 1, 5, "Ancient history nobody needs.")
    say(engine, 2, MIN_SPEECH_S, "First pass line.")
    loop.tick()
    # line 3 starts at 300 s; line 2 ended at 380 s, so it is context; line 1 ended long before
    say(engine, 3, MIN_SPEECH_S, "Second pass line.")
    loop.tick()
    prompt = llm.prompts[1]
    assert "First pass line." in prompt
    assert "Second pass line." in prompt
    assert "Ancient history" not in prompt


def test_backlog_is_read_in_chunks_of_at_most_120_lines(engine, loop):
    llm = engine.cleanup_llm = ScriptedLLM({}, {})
    for i in range(1, 201):
        say(engine, i, 3, f"Line number {i} of the long talk.")
    assert loop.tick() is True
    assert llm.prompts[0].count("of the long talk.") == 120
    assert loop.tick() is True
    assert "Line number 200 " in llm.prompts[1]
    assert loop.tick() is False


def test_llm_down_makes_no_call_and_the_speech_still_counts(engine, loop):
    llm = engine.cleanup_llm = ScriptedLLM(FACT)
    engine.llm_ok = False
    say(engine, 1, MIN_SPEECH_S + 5)
    assert loop.tick() is False
    assert llm.prompts == []
    engine.llm_ok = True
    assert loop.tick() is True
    assert len(llm.prompts) == 1


def test_a_failing_call_backs_off_then_tries_the_same_speech_again(engine, loop):
    llm = engine.cleanup_llm = ScriptedLLM(ConnectionError("down"), FACT)
    say(engine, 1, MIN_SPEECH_S + 5)
    assert loop.tick() is False
    assert engine.live.notebook.updating is False
    assert loop.tick() is False  # still backing off
    assert len(llm.prompts) == 1
    loop._clock.now += RETRY_S + 1
    assert loop.tick() is True
    assert len(llm.prompts) == 2
    assert len(engine.live.notebook.items) == 1


def test_an_abandoned_session_discards_the_result(engine, loop):
    sess = engine.live

    class Abandon:
        def json(self, system, user, schema, max_tokens=4000):
            with engine.lock:
                engine.live = LiveSession(NullSource(), {"kind": "file", "name": "y.wav", "speed": 1.0})
            return FACT

    engine.cleanup_llm = Abandon()
    say(engine, 1, MIN_SPEECH_S + 5)
    before = len(engine.bus.of("notebook.updated"))
    assert loop.tick() is False
    assert sess.notebook.items == []
    assert engine.live.notebook.items == []
    assert len(engine.bus.of("notebook.updated")) == before + 1  # only the "updating" announcement


def test_spellings_refresh_after_a_pass_and_before_the_save(engine, loop):
    engine.cleanup_llm = ScriptedLLM({})
    fix = [{"start": 4, "end": 13, "heard": "Tight Gate"}]
    say(engine, 1, MIN_SPEECH_S + 5, "The Tide Gate opens.", fix)
    loop.tick()
    (sp,) = [i for i in engine.live.notebook.items if i.kind == "spelling"]
    assert (sp.old, sp.text, sp.count) == ("Tight Gate", "Tide Gate", 1)
    engine.live.notebook.set_status(sp.id, "dismissed")

    say(engine, 2, 3, "The Tide Gate again.", [{"start": 4, "end": 13, "heard": "Tight Gate"}])
    path = engine.sessions_dir() / engine.live.id / "notebook.json"
    engine.live.notebook.before_save = loop.refresh_spellings
    engine.live.notebook.save(path)
    saved = json.loads(path.read_text())["items"]
    assert [(i["id"], i["count"], i["status"]) for i in saved] == [(sp.id, 2, "dismissed")]


def test_the_loop_can_be_turned_off(engine, monkeypatch):
    monkeypatch.setenv("TROUBADOUR_NOTEBOOK", "0")
    lp = NotebookLoop(engine, engine.live)
    lp.start()
    assert engine.live.notebook.before_save is None


def test_a_pass_still_running_at_stop_is_saved_with_the_final_notebook(engine, loop):
    entered, release = threading.Event(), threading.Event()

    def blocked(system, user, schema, max_tokens=4000):
        entered.set()
        assert release.wait(5)
        return FACT

    engine.cleanup_llm.json = blocked
    engine.status = "stopping"
    say(engine, 1, MIN_SPEECH_S + 1)
    running = engine.live.notebook_loop
    pass_thread = threading.Thread(target=running.tick, daemon=True)
    pass_thread.start()
    assert entered.wait(5)  # the model call is in flight
    finish = threading.Thread(target=engine._finish, args=(engine.live,), daemon=True)
    finish.start()  # saves, then waits for the pass before the notebook's save
    release.set()
    finish.join(5)
    pass_thread.join(5)
    assert not finish.is_alive()
    saved = json.loads((engine.sessions_dir() / engine.live.id / "notebook.json").read_text())["items"]
    assert [i["kind"] for i in saved] == ["fact"]
    assert engine.status == "idle"


def test_a_pass_that_outlasts_the_drain_saves_the_notebook_when_it_finishes(engine, loop):
    entered, release = threading.Event(), threading.Event()

    def blocked(system, user, schema, max_tokens=4000):
        entered.set()
        assert release.wait(5)
        return FACT

    engine.cleanup_llm.json = blocked
    say(engine, 1, MIN_SPEECH_S + 1)
    running = engine.live.notebook_loop
    pass_thread = threading.Thread(target=running.tick, daemon=True)
    pass_thread.start()
    assert entered.wait(5)
    assert running.drain(0.01) is False  # gave up waiting
    release.set()
    pass_thread.join(5)
    saved = json.loads((engine.sessions_dir() / engine.live.id / "notebook.json").read_text())["items"]
    assert [i["kind"] for i in saved] == ["fact"]
