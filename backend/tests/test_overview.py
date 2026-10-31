"""The _Overview/ pages: built from a fixture vault, confirmed and written-up only, written with care."""

import os

import pytest
from test_cloud import api, client, connect, noop, service, vault  # noqa: F401
from troubadour.cloud import overview
from troubadour.lore.campaign import Vault
from troubadour.lore.facts import Fact, Source

S1, S2 = "2026-10-01_190000-aaaa", "2026-10-08_190000-bbbb"
P1, P2 = "2026-10-01 The Gate", "2026-10-08 The Abbey"
SESSIONS = [
    {"id": S1, "page": P1, "title": "The Gate", "summary": "The party reached the gate."},
    {"id": S2, "page": P2, "title": "The Abbey", "summary": "They found the abbey."},
]
TIMELINE = [  # newest first, as lore.timeline.timeline gives it
    {"id": S2, "n": 2, "date": "2026-10-08", "title": "The Abbey", "places": ["Dallon", "Drowned Abbey"]},
    {"id": S1, "n": 1, "date": "2026-10-01", "title": "The Gate", "places": ["Dallon"]},
]
NUMBERS = {S1: 1, S2: 2}


def fact(text, page, sid, t=None, said_by=None):
    return Fact(text, None, said_by, Source(page, sid, t))


@pytest.fixture
def lore(tmp_path):
    root = tmp_path / "campaign"
    v = Vault(root)
    v.create("Elara", "pc", description="A half-elf ranger.")
    v.create("Magenta", "npc", description="Runs the Rusty Flagon.")
    v.create("Dallon", "place", description="A river town.")
    v.create("Drowned Abbey", "place", description="Half under water.")
    v.create("Guild", "faction", description="Thieves.")
    v.create("Ghost", "npc", description="Only suggested.", status="suggested")
    v.add_fact("Magenta", fact("Owes Kessia a favour.", P1, S1, 3120.0))
    v.add_fact("Dallon", fact("The bridge fell.", P2, S2, 61.0))
    v.add_fact("Magenta", fact("Is secretly a spy.", P2, S2), suggested=True)
    v.add_fact("Ghost", fact("Should not show.", P2, S2))
    return v


def build(v):
    return overview.generate(v, SESSIONS, TIMELINE, NUMBERS)


def test_the_five_pages(lore):
    pages = build(lore)
    assert sorted(pages) == [
        "_Overview/Campaign overview.md",
        "_Overview/Facts by session.md",
        "_Overview/People and places.md",
        "_Overview/Session log.md",
        "_Overview/The journey.md",
    ]
    for text in pages.values():
        assert text.startswith("---\ntroubadour: generated\n---\n")
        assert "rebuilt on every backup" in text


def test_campaign_overview(lore):
    text = build(lore)["_Overview/Campaign overview.md"]
    assert "S2 · 2026-10-08 · [[2026-10-08 The Abbey|The Abbey]]" in text
    assert "They found the abbey." in text
    assert "- [[Elara]]" in text
    assert "- [[Dallon]]: The bridge fell. ([[2026-10-08 The Abbey|S2 0:01]])" in text
    assert text.index("The bridge fell.") < text.index("Owes Kessia")  # newest first


def test_recently_learned_is_capped_at_ten(lore):
    for i in range(12):
        lore.add_fact("Magenta", fact(f"Thing {i}.", P2, S2, float(i)))
    text = build(lore)["_Overview/Campaign overview.md"]
    assert text.split("## Recently learned")[1].count("\n- ") == 10


def test_session_log_newest_first(lore):
    text = build(lore)["_Overview/Session log.md"]
    assert text.index("S2 · 2026-10-08") < text.index("S1 · 2026-10-01")
    assert "The party reached the gate." in text


def test_people_and_places(lore):
    text = build(lore)["_Overview/People and places.md"]
    assert "- [[Magenta]]: Runs the Rusty Flagon." in text
    assert "- [[Dallon]]: A river town." in text
    assert "- [[Guild]]: Thieves." in text
    assert "Elara" not in text


def test_facts_by_session_and_journey(lore):
    pages = build(lore)
    facts = pages["_Overview/Facts by session.md"]
    assert facts.index("Owes Kessia") > facts.index("## S1")
    assert facts.index("The bridge fell.") > facts.index("## S2")
    journey = pages["_Overview/The journey.md"]
    assert journey.index("## S1") < journey.index("## S2")  # oldest first
    assert "1. [[Dallon]]\n2. [[Drowned Abbey]]" in journey


def test_suggestions_and_unwritten_sessions_never_appear(lore):
    pages = build(lore)
    everything = "\n".join(pages.values())
    assert "secretly a spy" not in everything
    assert "Ghost" not in everything
    assert "Should not show" not in everything
    pages = overview.generate(lore, SESSIONS[:1], TIMELINE, NUMBERS)
    assert "Abbey" not in pages["_Overview/Session log.md"]
    assert "S2 ·" not in "\n".join(pages.values())


def test_empty_campaign_still_makes_pages(tmp_path):
    pages = overview.generate(Vault(tmp_path / "empty"), [], [], {})
    assert len(pages) == 5
    assert all("troubadour: generated" in t for t in pages.values())


def test_unchanged_pages_are_not_rewritten(lore):
    pages = build(lore)
    assert len(overview.write(lore.root, pages)) == 5
    path = lore.root / "_Overview" / "Session log.md"
    os.utime(path, ns=(1_000_000_000, 1_000_000_000))
    assert overview.write(lore.root, pages) == []
    assert path.stat().st_mtime_ns == 1_000_000_000
    pages["_Overview/Session log.md"] += "more\n"
    assert overview.write(lore.root, pages) == ["_Overview/Session log.md"]


def test_a_users_own_file_is_left_alone(lore):
    mine = lore.root / "_Overview" / "Session log.md"
    mine.parent.mkdir(parents=True)
    mine.write_text("# My own log\n")
    changed = overview.write(lore.root, build(lore))
    assert "_Overview/Session log.md" not in changed
    assert len(changed) == 4
    assert mine.read_text() == "# My own log\n"


def test_never_writes_outside_the_folder(lore):
    assert overview.write(lore.root, {"../escape.md": "x", "Elara.md": "x", "_Overview/a/b.md": "x"}) == []
    assert not (lore.root.parent / "escape.md").exists()


def test_the_vault_ignores_the_folder(lore):
    overview.write(lore.root, build(lore))
    (lore.root / "_Overview" / "Stray.md").write_text("---\ntype: npc\n---\n# Stray\n")
    assert "Stray" not in {e.name for e in lore.entities()}
    assert {e.name for e in lore.entities()} == {"Elara", "Magenta", "Dallon", "Drowned Abbey", "Guild", "Ghost"}


def test_a_backup_builds_the_pages_before_scanning(client, service, lore):  # noqa: F811
    connect(client, service)
    client.before_scan = lambda root: overview.write(root, build(lore))
    client.backup("main", "Camp", lore.root, noop)
    (v,) = service.vaults.values()
    paths = {f["path"] for f in service.snapshots[v["head_snapshot"]]}
    assert "_Overview/Session log.md" in paths


def test_a_failing_builder_does_not_stop_the_backup(client, service, lore):  # noqa: F811
    connect(client, service)

    def boom(_root):
        raise RuntimeError("no")

    client.before_scan = boom
    assert client.backup("main", "Camp", lore.root, noop)["snapshot"]
