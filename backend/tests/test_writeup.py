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
        def json(self, system, user, schema, max_tokens=4000, think=False):
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
        def json(self, system, user, schema, max_tokens=4000, think=False):
            return {"facts": [{"about": "Mudge", "text": "Mudge guards the bridge."}, {"about": "", "text": "x"}, "junk"]}

    assert writeup.facts(LLM(), writeup.Notes()) == [("Mudge", "Mudge guards the bridge.")]
