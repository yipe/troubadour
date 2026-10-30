"""Campaign memory jobs with a scripted LLM: what reaches the vault, and what's refused."""

import json
import time

import httpx
import pytest
from conftest import RecordingBus

from troubadour import memory as mem
from troubadour import writeup
from troubadour.campaign import Vault
from troubadour.transcript import build


class FakeLLM:
    """Answers by prompt, in order; records every call and whether it asked the model to think."""

    def __init__(self, notes=(), facts=(), read=None, page=None, found=None):
        self.notes, self.facts = list(notes), list(facts)
        self.read = read if read is not None else {"beats": [{"at": "00:05", "text": "The party found a cave near Dallon."}]}
        self.page = page or {"title": "The Desert Road", "last_time": "Elara led the way.", "spotlight": [], "highlights": []}
        self.found = found or {"facts": []}  # lasting facts the write-up suggests
        self.calls: list[str] = []
        self.thought: dict[str, bool] = {}

    def json(self, system, user, schema, max_tokens=4000, think=False):
        self.calls.append(user)
        self.thought[system[:40]] = think
        if system is mem.NOTES_SYSTEM:
            return self.notes.pop(0) if self.notes else {}
        if system is mem.FACT_SYSTEM:
            return self.facts.pop(0) if self.facts else {"facts": []}
        if system is writeup.READ_SYSTEM:
            return self.read
        if system is writeup.WRITE_SYSTEM:
            return self.page
        if system is writeup.FACTS_SYSTEM:
            return self.found
        raise AssertionError(f"unexpected prompt: {system[:60]}")


KNOWN = [("Elara", "pc", "Played by Theo."), ("DM", "pc", "Played by Nora.")]  # "DM" is never an entry


@pytest.fixture
def setup(tmp_path):
    vault = Vault(tmp_path / "campaign")
    sessions = tmp_path / "sessions"

    def make(llm):
        return mem.Memory(vault, RecordingBus(), llm=llm, sessions_dir=lambda: sessions, seed=lambda: KNOWN)

    return vault, sessions, make


def wait(job, seconds=5):
    deadline = time.monotonic() + seconds
    while job.state in ("queued", "running") and time.monotonic() < deadline:
        time.sleep(0.01)
    assert job.state == "done", job.message


# ------------------------------------------------------------- import notes


def test_import_creates_entities_keeps_notes_and_seeds_pcs(setup):
    vault, _, make = setup
    llm = FakeLLM(
        notes=[
            {
                "entities": [
                    {
                        "name": "Magenta",
                        "type": "npc",
                        "aliases": ["Maggie"],
                        "description": "Runs the Rusty Flagon.",
                        "facts": ["Owes Kessia a favour."],
                    },
                    {"name": "Dallon", "type": "place", "aliases": [], "description": "A desert city.", "facts": []},
                    {"name": "the party", "type": "term", "aliases": [], "description": "", "facts": []},  # generic: refused
                    {"name": "Zorbo", "type": "wizard", "aliases": [], "description": "x" * 999, "facts": [3]},  # bad type, junk
                    "not an object",
                ],
                "campaign_facts": ["The party is heading to Dallon."],
            }
        ]
    )
    m = make(llm)
    job = m.import_notes("Session 12", "Elara met Magenta in Dallon.\n\nThey talked about Zorbo.")
    wait(job)
    names = {e.name: e for e in vault.entities()}
    assert set(names) == {"Elara", "Magenta", "Dallon", "Zorbo"}
    assert names["Elara"].type == "pc"  # from Setup, not the model
    assert names["Magenta"].aliases == ["Maggie"]
    assert names["Magenta"].facts == ["Owes Kessia a favour. ([[Session 12]])"]
    assert names["Zorbo"].type == "term"
    assert len(names["Zorbo"].description) == mem.TEXT_MAX
    assert vault.campaign_facts() == ["The party is heading to Dallon. ([[Session 12]])"]
    note = (vault.root / "Notes" / "Session 12.md").read_text()
    assert "Elara met Magenta in Dallon.\n\nThey talked about Zorbo." in note
    assert (vault.root / "Glossary.md").exists()
    assert sorted(job.created) == ["Dallon", "Magenta", "Zorbo"]
    assert "Existing glossary" in llm.calls[0]


def test_import_merges_into_existing_entries(setup):
    vault, _, make = setup
    vault.create("Kessia", "pc", facts=["Is a tiefling."])
    vault.create("Auggie", "pc")
    llm = FakeLLM(
        notes=[
            {
                "entities": [
                    # "Cassia" is how these notes spell Kessia: reached through the alias.
                    {
                        "name": "Cassia",
                        "type": "npc",
                        "aliases": ["Kessia", "Auggie"],
                        "description": "",
                        "facts": ["is a tiefling", "Plays the lute."],
                    },
                ],
                "campaign_facts": [],
            }
        ]
    )
    job = make(llm).import_notes("Old notes", "Cassia plays the lute.")
    wait(job)
    k = vault.get("Kessia")
    assert "Cassia" in k.aliases
    assert "Auggie" not in k.aliases  # already another entry's name
    assert k.facts == ["Is a tiefling.", "Plays the lute. ([[Old notes]])"]
    assert job.updated == ["Kessia"]
    assert len(vault.entities()) == 3  # + Elara from Setup


def test_import_refuses_empty_notes(setup):
    _, _, make = setup
    with pytest.raises(ValueError, match="Paste"):
        make(FakeLLM()).import_notes("x", "   ")


def test_failed_job_reports_the_error(setup):
    _, _, make = setup

    class Broken(FakeLLM):
        def json(self, *a, **k):
            raise ConnectionError("LM Studio is not running")

    job = make(Broken()).import_notes("x", "Some notes.")
    deadline = time.monotonic() + 5
    while job.state != "error" and time.monotonic() < deadline:
        time.sleep(0.01)
    assert job.state == "error"
    assert "LM Studio" in job.message


# ------------------------------------------------------------- session write-up


def _session(sessions, sid="2026-10-08_193401-eebf", lines=None):
    players = [{"id": "p1", "name": "Theo", "character": "Elara", "is_gm": False, "color": "#000"}]
    voices = [{"id": "v1", "label": "Voice 1", "status": "named", "player_id": "p1", "character": None, "trained": True}]
    msgs = [
        {
            "id": f"m{i}",
            "t_start": i * 5.0,
            "t_end": i * 5.0 + 4,
            "voice_id": "v1",
            "provisional": False,
            "confidence": 0.9,
            "text": t,
        }
        for i, t in enumerate(lines or ["Dilara, three.", "We found a cave near Dallon.", "Magento waved at us."])
    ]
    started = time.mktime((2026, 10, 8, 19, 34, 1, 0, 0, -1))  # local time: page dates use the table's clock
    record = build({"id": sid, "started_at": started, "source": None, "duration_s": 600}, players, voices, msgs)
    (sessions / sid).mkdir(parents=True)
    (sessions / sid / "transcript.json").write_text(json.dumps(record))
    return sid


def _page(vault) -> str:
    (path,) = (vault.root / "Sessions").glob("*.md")
    return path.read_text()


def _section(vault, heading: str) -> list[str]:
    return _page(vault).split(f"## {heading}\n", 1)[1].split("\n\n", 1)[0].splitlines()


def test_write_up_reads_the_session_then_writes_the_page_from_the_notes(setup):
    vault, sessions, make = setup
    vault.create("Magenta", "npc")
    sid = _session(sessions)
    llm = FakeLLM(
        read={
            "beats": [
                {"at": "00:05", "text": "The party found a cave near Dallon."},
                {"at": "99:99", "text": "Magenta waved them on."},  # a timestamp the transcript doesn't have
                {"at": "00:10", "text": "  "},
                "not a beat",
            ],
            "characters": [{"name": "Elara", "what": "Led the way."}],
            "people": [{"name": "Magenta", "kind": "npc", "what": "A guide."}, {"name": "the party", "kind": "npc", "what": "x"}],
            "places": [{"name": "Dallon", "what": "A desert town with a cave."}],
            "loot": ["A cracked lantern, carried by Elara."],
            "open": ["The cave is unexplored.", "Elara plans to go back tomorrow."],
            "ending": "They camped outside the cave.",
            "spellings": [],
        },
        page={
            "title": "The Desert Road",
            "last_time": "Elara led the way to Dallon.\n\nMagenta waved them on.",
            "spotlight": [{"name": "Elara", "what": "Led the way."}],
            "highlights": [{"at": "00:05", "text": "Finding the cave."}, {"at": "7:77", "text": "Magenta waving."}],
        },
    )
    job = make(llm).write_up(sid)
    wait(job)
    page = _page(vault)
    assert f"session_id: {sid}" in page
    assert "## Last time\n[[Elara]] led the way to [[Dallon]].\n\n[[Magenta]] waved them on.\n" in page
    assert _section(vault, "Spotlight") == ["- **Elara:** Led the way."]
    assert _section(vault, "Highlights") == ["- [00:05] Finding the cave.", "- [[Magenta]] waving."]
    assert _section(vault, "What happened") == [
        "- [00:05] The party found a cave near [[Dallon]].",
        "- [[Magenta]] waved them on.",
    ]
    assert _section(vault, "Places") == ["- **Dallon:** A desert town with a cave."]
    assert _section(vault, "Loot, money and deals") == ["- A cracked lantern, carried by [[Elara]]."]
    assert _section(vault, "Still open") == ["- The cave is unexplored."]  # a plan is not an open thread
    assert _section(vault, "Mentioned") == ["[[Dallon]], [[Elara]], [[Magenta]]"]
    assert f"[[Transcripts/{sid}|Full transcript]]" in page
    assert (vault.root / "Sessions" / "Transcripts" / f"{sid}.md").exists()
    assert job.note == "Sessions/2026-10-08 The Desert Road.md"
    assert vault.get("Dallon").status == "suggested"
    assert vault.get("Dallon").type == "place"
    assert vault.find("the party") is None
    assert job.created == ["Dallon"]
    read, write, _ = llm.calls
    assert "Transcript:\n00:00 Elara (played by Theo): Dilara, three." in read
    assert "Transcript" not in write  # the page comes from the notes, never the transcript
    assert "Mudge" in write  # the style example
    assert "- [00:05] The party found a cave near Dallon." in write
    assert llm.thought[writeup.READ_SYSTEM[:40]] is True
    assert llm.thought[writeup.WRITE_SYSTEM[:40]] is False


def test_empty_notes_fail_the_job_and_write_nothing(setup):
    vault, sessions, make = setup
    sid = _session(sessions)
    job = make(FakeLLM(read={})).write_up(sid)
    deadline = time.monotonic() + 5
    while job.state in ("queued", "running") and time.monotonic() < deadline:
        time.sleep(0.01)
    assert job.state == "error"
    assert "came back empty" in job.message
    assert not (vault.root / "Sessions").exists() or not list((vault.root / "Sessions").glob("*.md"))


def test_write_up_suggests_spellings_found_in_the_transcript(setup):
    vault, sessions, make = setup
    vault.create("Magenta", "npc")
    sid = _session(sessions)
    read = {
        "beats": [{"at": "00:05", "text": "x"}],
        "spellings": [
            {"heard": "Dilara", "means": "Elara"},
            {"heard": "Magento", "means": "Magenta"},
            {"heard": "Ellarina", "means": "Elara"},  # not in the transcript: refused
            {"heard": "Dallon", "means": "Magenta"},  # in the transcript, but nothing like Magenta: refused
        ],
    }
    m = make(FakeLLM(read=read))
    wait(m.write_up(sid))
    assert vault.get("Elara").heard_as_suggested == ["Dilara"]
    assert vault.get("Magenta").heard_as_suggested == ["Magento"]
    vault.update("Elara", heard_as_rejected=["Dilara"], heard_as_suggested=[])
    wait(m.write_up(sid))
    assert vault.get("Elara").heard_as_suggested == []  # rejected stays rejected
    assert len(list((vault.root / "Sessions").glob("*.md"))) == 1  # a re-run replaces the page
    assert m.written_up() == {sid: "Sessions/2026-10-08 The Desert Road.md"}


def test_write_up_turns_sound_alike_new_names_into_spellings(setup):
    vault, sessions, make = setup
    sid = _session(
        sessions, lines=["Dallara attacks.", "Willie Olly Wally waves.", "Willy Olly Wally again.", "Willie Ollie Wally."]
    )
    people = [
        {"name": "Dallara", "kind": "npc", "what": "An NPC."},  # really Elara
        {"name": "Willie Olly Wally", "kind": "creature", "what": "Three-headed guide."},
        {"name": "Willy Olly Wally", "kind": "npc", "what": "dup"},
    ]
    wait(make(FakeLLM(read={"beats": [{"at": "00:05", "text": "x"}], "people": people})).write_up(sid))
    assert {e.name for e in vault.entities()} == {"Elara", "Willie Olly Wally"}
    assert vault.get("Willie Olly Wally").type == "creature"
    assert vault.get("Elara").heard_as_suggested == ["Dallara"]
    assert vault.get("Willie Olly Wally").heard_as_suggested == ["Willy Olly Wally"]


def test_write_up_suggests_lasting_facts_only(setup, monkeypatch):
    vault, sessions, make = setup
    monkeypatch.setattr(mem, "MAX_SUGGESTED_FACTS", 3)
    sid = _session(sessions)
    facts = [{"about": "Elara", "text": "Elara has one hit point."}, {"about": "Nobody", "text": "Nobody is here."}]
    facts += [
        {"about": "Elara", "text": f"Elara {x}."}
        for x in ("owns a grey owl", "fears deep water", "reads Elvish", "keeps a journal")
    ]
    llm = FakeLLM(found={"facts": facts})
    wait(make(llm).write_up(sid))
    assert vault.get("Elara").suggested_facts == [
        "Elara owns a grey owl. ([[2026-10-08 The Desert Road]])",
        "Elara fears deep water. ([[2026-10-08 The Desert Road]])",
        "Elara reads Elvish. ([[2026-10-08 The Desert Road]])",
    ]
    assert "Beats:\n- [00:05] The party found a cave near Dallon." in llm.calls[2]  # facts come from the notes


def test_a_rewrite_keeps_the_page_name(setup):
    vault, sessions, make = setup
    sid = _session(sessions)
    m = make(FakeLLM())
    wait(m.write_up(sid))
    m.llm.page = {"title": "A New Title", "last_time": "x", "spotlight": [], "highlights": []}
    wait(m.write_up(sid))
    (page,) = (vault.root / "Sessions").glob("*.md")
    assert page.stem == "2026-10-08 The Desert Road"
    assert page.read_text().count("# 2026-10-08 The Desert Road") == 1


def test_an_open_thread_the_story_already_tells_is_dropped(setup):
    vault, sessions, make = setup
    sid = _session(sessions)
    read = {
        "beats": [{"at": "00:05", "text": "A rider on a pink horse tossed Sathrin two hundred gold pieces and rode away."}],
        "open": ["The rider on the pink horse tossed gold and rode away.", "Smiley still wants the treasure hunters dead."],
    }
    wait(make(FakeLLM(read=read)).write_up(sid))
    assert _section(vault, "Still open") == ["- Smiley still wants the treasure hunters dead."]


def test_write_up_unknown_session(setup):
    _, _, make = setup
    with pytest.raises(KeyError):
        make(FakeLLM()).write_up("2026-01-01_000000-ffff")


# ------------------------------------------------------------- helpers


def test_an_everyday_alias_does_not_eat_the_word(tmp_path):
    vault = Vault(tmp_path)
    vault.create("Hank", "npc", aliases=["Dead"])
    assert mem.link_names("They found a dead lizardfolk.", vault) == "They found a dead lizardfolk."


def test_link_names_links_once_and_uses_aliases(tmp_path):
    vault = Vault(tmp_path)
    vault.create("Elara", "pc", aliases=["Ellie"])
    vault.create("Dallon", "place")
    out = mem.link_names("Ellie and Elara went to Dallon, then Dallon again.", vault)
    assert out == "[[Elara|Ellie]] and Elara went to [[Dallon]], then Dallon again."
    assert mem.link_names(out, vault) == out  # already linked: unchanged


def test_chunks_are_paragraph_aligned_and_bounded():
    text = "\n\n".join(["a" * 40] * 10 + ["b" * 250])
    parts = mem.chunks(text, 100)
    assert all(len(p) <= 100 for p in parts)
    assert "".join(parts).replace("\n", "") == text.replace("\n", "")


@pytest.mark.parametrize(
    ("heard", "name", "expected"),
    [("Dilara", "Elara", True), ("Dallara", "Elara", True), ("Cassia", "Kessia", True), ("Magento", "Magenta", True),
     ("Augie", "Auggie", True), ("Priya", "Kessia", False), ("Elara", "Elara", False), ("Ox", "Oxford", False),
     ("SLR", "Elara", False), ("Elkari", "Elara", False)],
)  # fmt: skip
def test_looks_like(heard, name, expected):
    assert mem.looks_like(heard, name) is expected


def test_spelling_suggestions_from_transcripts(tmp_path):
    vault = Vault(tmp_path / "campaign")
    vault.create("Elara", "pc", heard_as=["Dallara"])
    vault.create("Kessia", "pc", heard_as_rejected=["Cassia"])
    sessions = tmp_path / "sessions"
    _session(
        sessions,
        lines=[
            "Dilara, three.",
            "Dilara again.",
            "Dallara four.",
            "Cassia five.",
            "Cassia six.",
            "Olly waves.",
            "Olly's back.",
            "Water water.",
        ],
    )
    out = mem.spelling_suggestions(vault, sessions.iterdir())
    assert [(s["entity"], s["heard"], s["count"]) for s in out["misheard"]] == [("Elara", "Dilara", 2)]
    assert [u["heard"] for u in out["unknown"]] == ["Olly"]


@pytest.mark.parametrize(
    ("raw", "ok"),
    [("Magenta", True), ("Pipe of Smoke Monsters", True), ("The Rusty Flagon", True), ("El-Khari", True),
     ("The rooster", False), ("the party", False), ("Willie, Ollie, and Wally", False), ("initiative", False)],
)  # fmt: skip
def test_name_filter(raw, ok):
    assert bool(mem._name(raw)) is ok


def test_word_scan_ignores_everyday_words_and_sentence_starts():
    words = mem.scan_words(
        ["Okay. We'll check the slots.", "Slots are full, said Olly.", "We met Olly and olly-ish folk.", "Zorbo!"]
    )
    names = {w.spelling for w in words.values() if mem.name_like(w)}
    assert names == {"Olly", "Zorbo"}  # "Slots" only capitalised at a sentence start; "We'll" a contraction


def test_notes_confirm_a_suggested_entry_and_replace_its_guess(setup):
    vault, _, make = setup
    vault.create("Torred Logan", "npc", status="suggested", description="A person Auggie thinks is cool.")
    llm = FakeLLM(
        notes=[
            {
                "entities": [
                    {
                        "name": "Torred Logan",
                        "type": "npc",
                        "aliases": [],
                        "description": "Leader of the Bedin skirmishers.",
                        "facts": [],
                    }
                ],
                "campaign_facts": [],
            }
        ]
    )
    wait(make(llm).import_notes("Session 11", "Torred Logan leads the Bedin."))
    e = vault.get("Torred Logan")
    assert (e.status, e.description) == ("confirmed", "Leader of the Bedin skirmishers.")


def test_ignored_words_are_never_suggested(tmp_path):
    vault = Vault(tmp_path / "campaign")
    vault.create("Elara", "pc")
    sessions = tmp_path / "sessions"
    _session(
        sessions,
        lines=["We love T-Mobile.", "Our T-Mobile plan.", "Olly waves.", "Olly again.", "Dilara, three.", "Dilara four."],
    )
    vault.ignore(["T-Mobile", "Dilara"])
    out = mem.spelling_suggestions(vault, sessions.iterdir())
    assert [u["heard"] for u in out["unknown"]] == ["Olly"]
    assert out["misheard"] == []


def test_unknown_names_skip_vocabulary_acronyms_and_fillers(tmp_path):
    vault = Vault(tmp_path / "campaign")
    sessions = tmp_path / "sessions"
    lines = [
        "I cast Thunderwave.",
        "More Thunderwave.",
        "He is an NPC.",
        "Another NPC here.",
        "Bye-bye now.",
        "Bye-bye.",
        "Olly waves.",
        "Olly again.",
    ]
    _session(sessions, lines=lines)
    assert [u["heard"] for u in mem.spelling_suggestions(vault, sessions.iterdir())["unknown"]] == ["Olly"]


# ------------------------------------------------------------- LLM health


def _llm_with(handler) -> mem.MemoryLLM:
    llm = mem.MemoryLLM(url="http://llm.test/v1", model="m")
    llm.client = httpx.Client(transport=httpx.MockTransport(handler))
    return llm


@pytest.mark.parametrize(
    ("response", "healthy"),
    [
        (httpx.Response(200, json={"data": [{"id": "m"}]}), True),
        (httpx.Response(200, json={"data": [{"id": "other"}]}), False),  # our model isn't loaded
        (httpx.Response(200, json={"data": ["not-a-dict"]}), False),
        (httpx.Response(200, text="<html>not an LLM</html>"), False),  # some other service on the port
        (httpx.Response(500), False),
    ],
)
def test_llm_healthy_never_raises(response, healthy):
    assert _llm_with(lambda request: response).healthy() is healthy


def test_llm_healthy_when_server_down():
    def handler(request):
        raise httpx.ConnectError("refused")

    assert _llm_with(handler).healthy() is False


def test_an_lm_studio_error_says_why(monkeypatch):
    monkeypatch.setattr(mem, "LLM_RETRY_WAIT_S", 0)
    body = {
        "error": "Error in iterating prediction stream: Traceback ...\n  File x\nThe model has crashed without additional information. (Exit code: null)"
    }
    llm = _llm_with(lambda request: httpx.Response(400, json=body))
    with pytest.raises(RuntimeError, match=r"The model server couldn't answer \(400\): The model has crashed"):
        llm.json("s", "u", {})
    llm = _llm_with(lambda request: httpx.Response(500, text="<html>oops</html>"))
    with pytest.raises(RuntimeError, match="oops"):
        llm.json("s", "u", {})


def test_a_spell_slot_is_not_a_fact():
    assert mem.fleeting("Elara has one third level spell slot remaining.")
    assert mem.fleeting("Magenta has one hit point.")
    assert not mem.fleeting("Elara is a cleric of Akadi.")


def test_look_for_facts_reads_transcripts_and_notes_and_skips_a_moment(setup, tmp_path):
    vault, sessions, make = setup
    vault.create("Elara", "pc")
    (sessions / "2026-10-08_120000-aaaa").mkdir(parents=True)
    (sessions / "2026-10-08_120000-aaaa" / "transcript.json").write_text(
        json.dumps({"messages": [{"text": "Elara has one spell slot remaining."}, {"text": "Elara serves Akadi."}]})
    )
    notes = vault.root / "Notes"
    notes.mkdir()
    (notes / "Old notes.md").write_text("Elara grew up in Dallon.\nThe weather was hot.\n")
    llm = FakeLLM(
        facts=[
            {"facts": ["Elara has one spell slot remaining.", "Elara serves Akadi."]},
            {"facts": ["Elara grew up in Dallon."]},
        ]
    )
    job = make(llm).seek_facts("Elara")
    wait(job)
    suggested = vault.get("Elara").suggested_facts
    assert "Elara serves Akadi. ([[2026-10-08_120000-aaaa]])" in suggested
    assert "Elara grew up in Dallon. ([[Old notes]])" in suggested
    assert not any("spell slot" in f for f in suggested)
    assert job.suggested == 2


def test_transcript_lines_label_gm_characters_and_unknown_voices():
    players = [
        {"id": "g", "name": "Mika", "character": "DM", "is_gm": True},
        {"id": "k", "name": "Wren", "character": "Auggie", "is_gm": False},
    ]

    def msg(speaker, pid, text, character=None):
        return {"t_start": 1.0, "speaker": speaker, "player_id": pid, "character": character, "text": text}

    msgs = [
        msg("Mika", "g", "A smashed autognome."),
        msg("Mika", "g", "Hello.", "Magenta"),  # the GM voicing an NPC
        msg("Wren", "k", "I look."),  # untagged line: still the player's character
        msg("Voice", None, "Smiley."),
    ]
    lines, cast = mem.transcript_lines({"players": players, "messages": msgs})
    assert lines[0].endswith("GM Mika: A smashed autognome.")
    assert lines[1].endswith("GM Mika voicing Magenta: Hello.")
    assert lines[2].endswith("Auggie (played by Wren): I look.")
    assert lines[3].endswith("Unknown voice: Smiley.")
    assert "Mika is the GM" in cast
    assert "Auggie is a player character, played by Wren" in cast
    assert "DM is a player character" not in cast
    assert "Magenta is a player character" not in cast


def test_a_thinking_model_gets_room_for_its_reasoning(monkeypatch):
    sent = []

    def reply(request):
        sent.append(json.loads(request.content)["max_tokens"])
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"a": 1}'}, "finish_reason": "stop"}]})

    llm = _llm_with(reply)
    monkeypatch.setattr(mem.config, "MEMORY_REASONING", "none")
    assert llm.json("s", "u", {}, 500) == {"a": 1}
    monkeypatch.setattr(mem.config, "MEMORY_REASONING", "low")
    llm.json("s", "u", {}, 500)
    assert sent == [500, 500 + mem.REASONING_HEADROOM]


def test_confirmed_heard_as_spellings_are_fixed_before_the_model_reads(tmp_path):
    vault = Vault(tmp_path)
    vault.create("Phaerimm", "creature", heard_as=["Thayrin"])
    vault.create("Tomb Tapper", "creature", heard_as=["tomb town"])
    lines = ["2:16:15 GM Mika: They fought the Thayrin. This thing is a tomb town.", "2:16:20 Thayrin (played by X): hi"]
    out = mem.apply_heard_as(lines, vault.entities())
    assert out[0] == "2:16:15 GM Mika: They fought the Phaerimm. This thing is a Tomb Tapper."
    assert out[1] == lines[1]  # speaker labels are left alone


def test_think_turns_a_local_models_thinking_on_and_off(monkeypatch):
    monkeypatch.setattr(mem.config, "MEMORY_REASONING", "none")
    sent = []

    def reply(request):
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"a": 1}'}, "finish_reason": "stop"}]})

    llm = _llm_with(reply)
    llm.json("s", "u", {}, 500)
    llm.json("s", "u", {}, 500, think=True)
    off, on = sent
    assert (off["chat_template_kwargs"], off["reasoning_effort"], off["max_tokens"]) == ({"enable_thinking": False}, "none", 500)
    assert (on["chat_template_kwargs"], on["reasoning_effort"]) == ({"enable_thinking": True}, "medium")
    assert on["max_tokens"] == 500 + mem.REASONING_HEADROOM


def test_a_server_that_refuses_chat_template_kwargs_keeps_the_schema(monkeypatch):
    sent = []

    def reply(request):
        body = json.loads(request.content)
        sent.append(body)
        if "chat_template_kwargs" in body:
            return httpx.Response(400, json={"error": "unknown field chat_template_kwargs"})
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"a": 1}'}, "finish_reason": "stop"}]})

    assert _llm_with(reply).json("s", "u", {}) == {"a": 1}
    assert "response_format" in sent[-1]
    assert "chat_template_kwargs" not in sent[-1]


def test_a_server_hiccup_is_tried_again(monkeypatch):
    monkeypatch.setattr(mem, "LLM_RETRY_WAIT_S", 0)
    replies = [
        httpx.Response(500, text="</html>"),
        httpx.Response(200, json={"choices": [{"message": {"content": '{"ok": 1}'}}]}),
    ]
    llm = _llm_with(lambda request: replies.pop(0))
    assert llm.json("s", "u", {}) == {"ok": 1}
