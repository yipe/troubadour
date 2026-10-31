"""Hardening of the vault notes and the review (H1): every case here lost or flattened a person's words."""

import json

import pytest
from conftest import RecordingBus
from fastapi.testclient import TestClient
from test_memory import FakeLLM, _session, wait
from troubadour.lore import memory as mem
from troubadour.lore import review as lore_review
from troubadour.lore import writeup
from troubadour.lore.campaign import Vault, parse, same_fact
from troubadour.lore.facts import Fact
from troubadour.server import deps
from troubadour.server.app import app


@pytest.fixture
def vault(tmp_path):
    return Vault(tmp_path / "campaign")


def trashed(vault):
    return sorted(p.name for p in (vault.root / ".trash").glob("*")) if (vault.root / ".trash").is_dir() else []


# ---------------------------------------------------------------- 1. renames never delete the note


def test_a_case_only_rename_keeps_the_note(vault):
    vault.create("orsa vell", "npc", description="Keeps the Gull's Debt.")
    e = vault.update("orsa vell", name="Orsa Vell")
    assert e.name == "Orsa Vell"
    notes = [p.name for p in (vault.root / "People").glob("*.md")]
    assert [n.casefold() for n in notes] == ["orsa vell.md"]  # one file, whichever spelling the disk keeps
    assert vault.get("Orsa Vell").description == "Keeps the Gull's Debt."


def test_a_rename_moves_the_old_note_to_trash_instead_of_deleting_it(vault):
    vault.create("Orsa", "npc", description="Keeps the Gull's Debt.")
    vault.update("Orsa", name="Orsa Vell")
    assert [p.name for p in (vault.root / "People").glob("*.md")] == ["Orsa Vell.md"]
    assert trashed(vault) == ["Orsa.md"]
    assert "Keeps the Gull's Debt." in (vault.root / ".trash" / "Orsa.md").read_text()


# ---------------------------------------------------------------- 2. Facts.md is patched, not rebuilt

FACTS_MD = """---
tags: [troubadour/facts, mine]
cssclasses: wide
---
# The Greyfen Saga

My own intro, with a [[link]].

## Facts
- The party is in Dallon.

## My theories
The toll collector is the queen.
"""


def test_setting_campaign_facts_keeps_everything_but_the_facts_bullets(vault):
    vault.root.mkdir(parents=True)
    vault.facts_path.write_text(FACTS_MD)
    vault.add_campaign_fact(Fact("The bridge is out."))
    text = vault.facts_path.read_text()
    assert text == FACTS_MD.replace("- The party is in Dallon.\n", "- The party is in Dallon.\n- The bridge is out.\n")
    vault.delete_campaign_fact(vault.campaign_facts()[0].id)
    assert vault.facts_path.read_text() == FACTS_MD.replace("- The party is in Dallon.\n", "- The bridge is out.\n")


def test_a_no_op_save_of_facts_md_changes_nothing(vault):
    vault.root.mkdir(parents=True)
    vault.facts_path.write_text(FACTS_MD)
    vault.set_campaign_facts(vault.campaign_facts())
    assert vault.facts_path.read_text() == FACTS_MD


def test_facts_md_without_a_facts_section_gets_one_appended(vault):
    vault.root.mkdir(parents=True)
    vault.facts_path.write_text("# Notes of mine\n\nSome prose.\n")
    vault.add_campaign_fact(Fact("The bridge is out."))
    assert vault.facts_path.read_text() == "# Notes of mine\n\nSome prose.\n\n## Facts\n- The bridge is out.\n"


def test_facts_md_with_a_numbered_list_is_not_rewritten(vault):
    vault.root.mkdir(parents=True)
    original = "# Saga\n\n## Facts\n1. First\n2. Second\n"
    vault.facts_path.write_text(original)
    with pytest.raises(ValueError, match="plain bullets"):
        vault.add_campaign_fact(Fact("The bridge is out."))
    assert vault.facts_path.read_text() == original


def test_duplicate_facts_sections_in_facts_md_are_merged_not_dropped(vault):
    vault.root.mkdir(parents=True)
    vault.facts_path.write_text("# Saga\n\n## Facts\n- One.\n\n## Other\nkept\n\n## Facts\n- Two.\n")
    assert [f.text for f in vault.campaign_facts()] == ["One.", "Two."]
    vault.add_campaign_fact(Fact("Three."))
    assert vault.facts_path.read_text() == "# Saga\n\n## Facts\n- One.\n- Two.\n- Three.\n\n## Other\nkept\n\n"


# ---------------------------------------------------------------- 5. duplicate and odd Facts sections in a note


def test_duplicate_facts_sections_in_a_note_are_merged(vault):
    path = vault.root / "People" / "Orsa.md"
    path.parent.mkdir(parents=True)
    path.write_text("---\ntype: npc\n---\n# Orsa\n\n## Facts\n- One.\n\n## Facts\n- Two.\n")
    e = vault.get("Orsa")
    assert [f.text for f in e.facts] == ["One.", "Two."]
    assert not e.read_only
    vault.update("Orsa", description="x")
    assert (vault.root / "People" / "Orsa.md").read_text().count("## Facts") == 1
    assert [f.text for f in vault.get("Orsa").facts] == ["One.", "Two."]


@pytest.mark.parametrize(
    "body",
    ["1. First\n2. Second", "### Sub\n- One.", "- One.\n\nA paragraph of prose.", "- One.\n  - nested", "Prose first.\n- One."],
)
def test_a_facts_list_that_would_not_round_trip_makes_the_note_read_only(vault, body):
    path = vault.root / "People" / "Orsa.md"
    path.parent.mkdir(parents=True)
    original = f"---\ntype: npc\n---\n# Orsa\n\n## Facts\n{body}\n"
    path.write_text(original)
    assert vault.get("Orsa").read_only
    with pytest.raises(ValueError, match="can't read"):
        vault.update("Orsa", description="x")
    assert path.read_text() == original


def test_a_note_locked_only_for_its_facts_layout_still_names_things_for_transcription(vault):
    people = vault.root / "People"
    people.mkdir(parents=True)
    (people / "Orsa.md").write_text("---\ntype: npc\n---\n# Orsa\n\n## Facts\n1. Captain of the Gull.\n")
    (people / "Pip.md").write_text("---\ntype: [unclosed\n---\n# Pip\n")
    assert vault.get("Orsa").read_only and not vault.get("Orsa").unreadable
    names = {e.name for e in vault.glossary()}
    assert "Orsa" in names  # locked against writes, but its name is fine
    assert "Pip" not in names  # frontmatter unreadable: nothing about it can be trusted


def test_wrapped_bullets_and_history_still_round_trip(vault):
    e = parse("Orsa", "---\ntype: npc\n---\n# Orsa\n\n## Facts\n- Hates goblins\n  because of the fire.\n  - ~~Old.~~\n")
    assert not e.read_only


# ---------------------------------------------------------------- 6. near-duplicates


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("Orsa owes Pip 20 gold to the guild.", "Orsa owes Pip 200 gold to the guild."),
        ("Mudge is the king of the Greyfen marsh.", "Mudge is not the king of the Greyfen marsh."),
        ("Mudge can swim across the Greyfen marsh.", "Mudge can't swim across the Greyfen marsh."),
    ],
)
def test_a_changed_number_or_negation_is_a_different_fact(a, b):
    assert not same_fact(Fact(a), Fact(b))


def test_equal_or_near_equal_text_is_the_same_fact():
    assert same_fact(Fact("Orsa runs the Gull's Debt."), Fact("orsa runs the gulls debt"))
    assert same_fact(Fact("Orsa owes Pip 20 gold to the guild."), Fact("Orsa owes Pip 20 gold to the guilds."))


def test_adding_a_fact_with_a_changed_number_is_kept(vault):
    vault.create("Orsa", "npc")
    vault.add_fact("Orsa", Fact("Orsa owes Pip 20 gold to the guild."))
    vault.add_fact("Orsa", Fact("Orsa owes Pip 200 gold to the guild."))
    assert len(vault.get("Orsa").facts) == 2


def test_accepting_a_near_duplicate_suggestion_replaces_the_fact_and_keeps_the_old_wording(vault):
    vault.create("Orsa", "npc", facts=[Fact("Orsa owes Pip 20 gold to the guild.", "Orsa")])
    vault.add_fact("Orsa", Fact("Orsa owes Pip 20 gold to the guilds.", "Orsa"), suggested=True)
    # (a suggestion that near-duplicates a fact is normally never stored; this one was written by hand)
    path = vault.get("Orsa").path
    text = path.read_text() + "\n## Suggested facts\n- Orsa owes Pip 20 gold to the guilds.\n"
    path.write_text(text)
    (s,) = vault.get("Orsa").suggested_facts
    e = vault.review("Orsa", accept_facts=[s.id])
    assert [f.text for f in e.facts] == ["Orsa owes Pip 20 gold to the guilds."]
    assert [h.text for h in e.facts[0].history] == ["Orsa owes Pip 20 gold to the guild."]
    assert e.suggested_facts == []


def test_merge_carries_sections_meta_and_tags(vault):
    vault.create("Cassia", "npc")
    vault.create("Kessia", "pc")
    src = vault.get("Cassia").path
    src.write_text(
        "---\ntype: npc\nmood: grumpy\ntags: [villain]\n---\n# Cassia\n\n## Facts\n- Plays the lute.\n\n## My theories\nShe is the queen.\n"
    )
    dst = vault.get("Kessia").path
    dst.write_text("---\ntype: pc\ntags: [hero]\n---\n# Kessia\n\n## My theories\nOwes a favour.\n")
    e = vault.merge("Cassia", "Kessia")
    assert e.extra_meta == {"mood": "grumpy"}
    assert e.tags == ["hero", "villain"]
    assert dict(e.extra_sections)["My theories"] == "Owes a favour.\n\nShe is the queen."
    assert [f.text for f in e.facts] == ["Plays the lute."]
    assert "Cassia.md" in trashed(vault)


# ---------------------------------------------------------------- 3, 8, 9. write-up and import jobs


@pytest.fixture
def setup(tmp_path):
    vault = Vault(tmp_path / "campaign")
    sessions = tmp_path / "sessions"

    def make(llm):
        return mem.Memory(vault, RecordingBus(), llm=llm, sessions_dir=lambda: sessions, seed=lambda: [])

    return vault, sessions, make


def test_a_second_write_up_keeps_a_copy_of_an_edited_page(setup):
    vault, sessions, make = setup
    sid = _session(sessions)
    m = make(FakeLLM())
    wait(m.write_up(sid))
    (page,) = (vault.root / "Sessions").glob("*.md")
    page.write_text(page.read_text() + "\nMY OWN NOTE about the cave.\n")
    wait(m.write_up(sid))
    assert "MY OWN NOTE" not in page.read_text()
    copies = list((vault.root / ".trash").glob("2026-10-08 The Desert Road *.md"))
    assert len(copies) == 1
    assert "MY OWN NOTE about the cave." in copies[0].read_text()
    assert (vault.root / "Sessions" / "Transcripts" / f"{sid}.md").is_file()


def test_the_transcript_page_is_written_atomically(setup, monkeypatch):
    vault, sessions, make = setup
    sid = _session(sessions)
    written = []
    real = mem.write_atomic
    monkeypatch.setattr(mem, "write_atomic", lambda path, text: (written.append(path.name), real(path, text))[1])
    wait(make(FakeLLM()).write_up(sid))
    assert f"{sid}.md" in written


@pytest.mark.parametrize("junk", ["none", 3, {"a": 1}, None, True])
def test_llm_lists_that_arrive_as_something_else_do_not_abort(setup, junk):
    vault, sessions, make = setup
    llm = FakeLLM(
        notes=[{"entities": [{"name": "Magenta", "type": "npc", "aliases": junk, "facts": junk}], "campaign_facts": junk}],
        facts=[{"facts": junk}],
        read={"beats": [{"at": "", "text": "They found a cave."}], "spellings": junk, "people": junk, "loot": junk},
        page={"title": "T", "last_time": "x", "spotlight": junk, "highlights": junk},
        found={"facts": junk},
    )
    m = make(llm)
    wait(m.import_notes("Old notes", "Magenta lives here."))
    assert [e.name for e in m.vault.entities()] == ["Magenta"]
    wait(m.write_up(_session(sessions)))


def test_parse_notes_survives_non_list_fields():
    notes = writeup.parse_notes({"beats": 5, "spellings": "x", "characters": 1, "loot": {"a": 1}}, set())
    assert notes.beats == []
    assert notes.spellings == []


def test_import_leaves_a_read_only_note_alone_and_says_so(setup):
    vault, _, make = setup
    note = vault.root / "People" / "Magenta.md"
    note.parent.mkdir(parents=True)
    original = "---\nnot: [valid\n---\n# Magenta\nMine.\n"
    note.write_text(original)
    llm = FakeLLM(notes=[{"entities": [{"name": "Magenta", "type": "npc", "facts": ["Sings."], "description": "x"}]}])
    job = make(llm).import_notes("Old notes", "Magenta sings.")
    wait(job)
    assert note.read_text() == original
    assert job.skipped == ["Magenta"]
    assert "Magenta" in job.message


def test_looking_for_facts_in_a_read_only_note_says_so(setup):
    vault, _, make = setup
    note = vault.root / "People" / "Magenta.md"
    note.parent.mkdir(parents=True)
    note.write_text("---\nnot: [valid\n---\n# Magenta\nMine.\n")
    job = make(FakeLLM()).seek_facts("Magenta")
    wait(job)
    assert "fix it in Obsidian" in job.message


def test_old_jobs_are_pruned_oldest_first_whatever_their_ids(setup):
    _, _, make = setup
    m = make(FakeLLM())
    first = m.submit("import", "first", lambda job: None)
    wait(first)
    for i in range(25):
        wait(m.submit("import", f"job {i}", lambda job: None))
    kept = [j.title for j in m.jobs.values()]
    assert "first" not in kept
    assert kept[-1] == "job 24"


# ---------------------------------------------------------------- 7. line breaks in user text


@pytest.fixture
def api(dirs, monkeypatch):
    monkeypatch.delenv("TROUBADOUR_VAULT", raising=False)
    return TestClient(app, base_url="http://127.0.0.1:8765")


def test_fact_text_is_collapsed_to_one_line(api):
    facts = api.post("/api/campaign/facts", json={"text": "The bridge\n\n## Facts\n- is out."}).json()
    assert [f["text"] for f in facts] == ["The bridge ## Facts - is out."]
    assert "\n## Facts" not in deps.vault.facts_path.read_text().split("## Facts\n", 1)[1]


def test_a_description_that_would_start_a_section_is_refused(api):
    body = {"name": "Orsa", "type": "npc", "description": "Nice.\n## Facts\n- smuggled"}
    assert api.post("/api/campaign/entities", json=body).status_code == 422
    assert api.post("/api/campaign/entities", json={**body, "description": "Nice.\n---\nmore"}).status_code == 422
    assert api.post("/api/campaign/entities", json={**body, "description": "Line one.\nLine two."}).status_code == 200
    assert api.patch("/api/campaign/entities/Orsa", json={"description": "## Heading"}).status_code == 422
    assert deps.vault.get("Orsa").description == "Line one.\nLine two."


# ---------------------------------------------------------------- 10. a corrupt review.json is set aside


def test_a_corrupt_review_file_is_renamed_before_a_new_one_is_written(tmp_path):
    folder = tmp_path / "sessions" / "2026-10-08_193401-eebf"
    folder.mkdir(parents=True)
    (folder / "review.json").write_text('{"items": [ truncated')
    ctx = lore_review.Context(Vault(tmp_path / "campaign"), folder, [folder], None)
    assert lore_review.review(ctx) == []
    (aside,) = folder.glob("review.corrupt-*.json")
    assert aside.read_text() == '{"items": [ truncated'
    assert json.loads((folder / "review.json").read_text()) == {"items": [], "decisions": {}}
    lore_review.review(ctx)  # a healthy file is left alone
    assert len(list(folder.glob("review.corrupt-*.json"))) == 1


def test_a_missing_review_file_is_not_corrupt(tmp_path):
    folder = tmp_path / "s"
    folder.mkdir()
    ctx = lore_review.Context(Vault(tmp_path / "campaign"), folder, [folder], None)
    lore_review.review(ctx)
    assert not list(folder.glob("review.corrupt-*.json"))
