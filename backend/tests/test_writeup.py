"""The write-up's notes and page: what a model's reply may put on the page."""

from troubadour import writeup


def test_notes_keep_real_timestamps_and_drop_junk():
    raw = {
        "beats": [
            {"at": "1:02:03", "text": "  The party   met Mudge. "},
            {"at": "[0:05]", "text": "They crossed the bridge."},
            {"at": "9:99:99", "text": "Made-up time."},
            {"at": "0:05", "text": ""},
            "junk",
        ],
        "people": [
            {"name": "Mudge", "kind": "creature", "what": "An ogre."},
            {"name": "mudge", "kind": "npc", "what": "dup"},
            {"name": "Odric", "kind": "wizard", "what": "x" * 900},
            {"name": "", "kind": "npc", "what": "nameless"},
        ],
        "loot": ["340 silver", 7, ""],
        "open": ["The letter is unopened."] * 12,
        "spellings": [{"heard": "Mudj", "means": "Mudge"}, {"heard": "", "means": "x"}],
        "ending": 3,
    }
    notes = writeup.parse_notes(raw, {"1:02:03", "0:05"})
    assert [(b.at, b.text) for b in notes.beats] == [
        ("1:02:03", "The party met Mudge."),
        ("0:05", "They crossed the bridge."),
        ("", "Made-up time."),
    ]
    assert [(p.name, p.kind) for p in notes.people] == [("Mudge", "creature"), ("Odric", "")]
    assert len(notes.people[1].what) == writeup.TEXT_MAX
    assert notes.loot == ["340 silver"]
    assert len(notes.open) == 8
    assert notes.spellings == [("Mudj", "Mudge")]
    assert notes.ending == ""
    assert writeup.parse_notes({}, set()).beats == []


def test_the_wrap_up_keeps_its_paragraphs():
    raw = {
        "title": " Bridge  Troubles ",
        "last_time": "First  part.\n\n\n Second part.\nStill second.",
        "highlights": [{"at": "0:05", "text": "x"}],
    }
    page = writeup.parse_page(raw, {"0:05"})
    assert page.title == "Bridge Troubles"
    assert page.last_time == "First part.\n\nSecond part. Still second."
    assert [(h.at, h.text) for h in page.highlights] == [("0:05", "x")]
    assert page.spotlight == []


def test_the_writer_gets_the_notes_and_the_example_and_reads_nothing_else():
    class LLM:
        def json(self, system, user, schema, max_tokens=4000, think=False, progress=None):
            self.user, self.think = user, think
            return {"title": "T", "last_time": "S", "spotlight": [], "highlights": []}

    notes = writeup.Notes(beats=[writeup.Beat("0:05", "They crossed the bridge.")], loot=["340 silver"], ending="At the inn.")
    llm = LLM()
    writeup.write(llm, notes, {"0:05"})
    assert writeup.EXAMPLE in llm.user
    assert "- [0:05] They crossed the bridge." in llm.user
    assert "Loot and deals:\n- 340 silver" in llm.user
    assert "Ending: At the inn." in llm.user
    assert llm.think is False


def test_facts_come_back_as_pairs():
    class LLM:
        def json(self, system, user, schema, max_tokens=4000, think=False, progress=None):
            return {"facts": [{"about": "Mudge", "text": "Mudge guards the bridge."}, {"about": "", "text": "x"}, "junk"]}

    assert writeup.facts(LLM(), writeup.Notes()) == [("Mudge", "Mudge guards the bridge.")]


def test_snippets_are_the_finished_entries_of_a_reply_still_streaming():
    partial = '{"beats": [{"at": "0:05", "text": "They crossed the \\"old\\" bridge."}, {"at": "1:02:03", "text": "Mudge'
    assert writeup.snippets(partial) == [{"kind": "beat", "at": "0:05", "text": 'They crossed the "old" bridge.'}]
    more = (
        partial + ' joined them."}], "characters": [{"name": "Pip", "what": "Freed Mudge."}], '
        '"people": [{"name": "Mudge", "kind": "creature", "what": "An ogre."}, {"name": "Odr'
    )
    assert [(s["kind"], s["text"]) for s in writeup.snippets(more)] == [
        ("beat", 'They crossed the "old" bridge.'),
        ("beat", "Mudge joined them."),
        ("character", "Pip: Freed Mudge."),
        ("person", "Mudge: An ogre."),
    ]
    loot = '{"places": [{"name": "Greyfen", "what": "A marsh road."}], "loot": ["340 silver", "a sealed le'
    assert [(s["kind"], s["text"]) for s in writeup.snippets(loot)] == [
        ("place", "Greyfen: A marsh road."),
        ("loot", "340 silver"),
    ]
    assert writeup.snippets("") == []
    long = '{"loot": ["' + "gold coin " * 40 + '", "x"]'
    (cut,) = [x["text"] for x in writeup.snippets(long) if x["text"] != "x"]
    assert cut.endswith("coin…")
    assert len(cut) <= writeup.SNIPPET_MAX + 1


def test_table_stats_count_what_code_can():
    def msg(t, speaker, text, db=-30.0, pid="p"):
        return {"t_start": t, "t_end": t + 10, "speaker": speaker, "player_id": pid, "text": text, "level_db": db}

    record = {
        "session": {"duration_s": 3700},
        "players": [{"id": "p"}, {"id": "q"}],
        "messages": [
            msg(0, "Nora", "Mudge waves at Mudge."),
            msg(20, "Nora", "Mudge again, natural 20!"),
            msg(40, "Theo", "Nat 1. No way, that is terrible!", db=-12.0),
            msg(60, "Theo", "ok", db=-5.0),  # loud but too short to quote
        ],
    }
    stats = writeup.table_stats(record, ["Mudge", "Pip"])
    assert stats == [
        "1:01:40 of play, 4 lines, 2 at the table",
        "Most talk: Nora 50%, Theo 50%",
        "Most-said name: Mudge (3 times)",
        "Natural 20s called out: 1; natural 1s: 1",
        "Loudest moment, 00:40: Theo: “Nat 1. No way, that is terrible!”",
    ]
    assert writeup.table_stats({"messages": []}, []) == []
