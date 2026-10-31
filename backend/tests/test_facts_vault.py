"""Structured facts through the vault and the campaign API: old notes load untouched, writes are patches."""

import os
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from troubadour.lore.campaign import TYPES, SessionIndex, Vault
from troubadour.lore.facts import Fact, Source
from troubadour.server import deps
from troubadour.server.app import app

LOCAL = "http://127.0.0.1:8765"
PAGE = "2026-10-22 The Drowned Abbey"
OLD_PAGE = "2026-10-08 Debts and Riddles"
INDEX = SessionIndex(
    ids_for={PAGE: "s12", OLD_PAGE: "s10"}, numbers={"s12": 12, "s10": 10}, page_for={"s12": PAGE, "s10": OLD_PAGE}
)

OLD_NOTE = """---
type: npc
aliases: []
heard_as: []
status: confirmed
tags: [troubadour/npc]
---
# Orsa Vell

## Facts
- Runs the Gull's Debt.
- Owes Pip 20 gold. ([[2026-10-08 Debts and Riddles]])
"""


@pytest.fixture
def vault(tmp_path):
    return Vault(tmp_path / "campaign", lambda: INDEX)


@pytest.fixture
def note(vault):
    path = vault.root / "People" / "Orsa Vell.md"
    path.parent.mkdir(parents=True)
    path.write_text(OLD_NOTE)
    os.utime(path, ns=(1_000_000_000, 1_000_000_000))
    return path


def facts_section(path) -> list[str]:
    return path.read_text().split("## Facts\n")[1].splitlines()


def test_an_old_note_loads_and_is_not_rewritten_by_reading_or_a_no_op_save(vault, note):
    before = (note.read_bytes(), note.stat().st_mtime_ns)
    e = vault.get("Orsa Vell")
    assert [(f.text, f.confidence) for f in e.facts] == [("Runs the Gull's Debt.", "once"), ("Owes Pip 20 gold.", "once")]
    assert e.facts[1].source == Source(OLD_PAGE)
    assert (note.read_bytes(), note.stat().st_mtime_ns) == before

    vault.update("Orsa Vell")  # a save with no edits writes the same bytes
    assert note.read_bytes() == before[0]


def test_get_through_the_api_does_not_touch_the_file(vault, note, monkeypatch):
    monkeypatch.setattr(deps, "vault", vault)
    monkeypatch.setattr(deps.engine, "vault_dir", lambda: vault.root)
    monkeypatch.setattr(deps.engine, "players", {})
    before = (note.read_bytes(), note.stat().st_mtime_ns)
    api = TestClient(app, base_url=LOCAL)
    fact = api.get("/api/campaign/entities/Orsa%20Vell").json()["facts"][1]
    assert (fact["text"], fact["confidence"], fact["source"]["page"]) == ("Owes Pip 20 gold.", "once", OLD_PAGE)
    assert (note.read_bytes(), note.stat().st_mtime_ns) == before


def test_add_fact_writes_the_canonical_bullet(vault, note):
    vault.add_fact(
        "Orsa Vell",
        Fact("The tide turns at the second bell.", source=Source(PAGE, "s12", 5882.0), said_by="Alex", confidence="gm"),
    )
    assert (
        facts_section(note)[-1]
        == "- The tide turns at the second bell. ([[2026-10-22 The Drowned Abbey#1:38:02|S12 1:38]] · Alex · GM stated)"
    )
    assert facts_section(note)[:2] == [
        "- Runs the Gull's Debt.",
        "- Owes Pip 20 gold. ([[2026-10-08 Debts and Riddles]])",
    ]  # old bullets untouched


def test_accepting_an_update_nests_the_old_fact_in_history(vault, note):
    old_id = vault.get("Orsa Vell").facts[1].id
    vault.add_fact(
        "Orsa Vell",
        Fact(
            "Orsa Vell paid Pip back.",
            source=Source(PAGE, "s12", 6000.0),
            said_by="Alex",
            confidence="gm",
            replaces="Owes Pip 20 gold.",
        ),
        suggested=True,
    )
    suggestion = vault.get("Orsa Vell").suggested_facts[0]
    assert suggestion.replaces == "Owes Pip 20 gold."
    vault.review("Orsa Vell", accept_facts=[suggestion.id])
    e = vault.get("Orsa Vell")
    assert e.suggested_facts == []
    assert [f.text for f in e.facts] == ["Runs the Gull's Debt.", "Orsa Vell paid Pip back."]  # in the old fact's place
    assert [(v.text, v.source.session_page if v.source else None) for v in e.facts[1].history] == [
        ("Owes Pip 20 gold.", OLD_PAGE)
    ]
    assert facts_section(note)[1:] == [
        "- Orsa Vell paid Pip back. ([[2026-10-22 The Drowned Abbey#1:40:00|S12 1:40]] · Alex · GM stated)",
        "  - ~~Owes Pip 20 gold.~~ ([[2026-10-08 Debts and Riddles]])",
    ]
    assert old_id not in [f.id for f in e.facts]


def test_rejecting_a_suggestion_removes_it(vault, note):
    vault.add_fact("Orsa Vell", Fact("Is a spy."), suggested=True)
    fid = vault.get("Orsa Vell").suggested_facts[0].id
    vault.review("Orsa Vell", reject_facts=[fid])
    assert vault.get("Orsa Vell").suggested_facts == []
    assert "Is a spy" not in note.read_text()
    assert "Suggested facts" not in note.read_text()
    vault.review("Orsa Vell", reject_facts=[fid])  # already decided: nothing to do


def test_a_typo_edit_leaves_no_history_but_an_update_does(vault, note):
    fid = vault.get("Orsa Vell").facts[0].id
    vault.edit_fact("Orsa Vell", fid, text="Runs the Gull's Debt sloop.", confidence="gm")
    fact = vault.get("Orsa Vell").facts[0]
    assert (fact.text, fact.confidence, fact.history) == ("Runs the Gull's Debt sloop.", "gm", [])

    vault.edit_fact("Orsa Vell", fact.id, text="Sold the Gull's Debt.", as_update=True)
    fact = vault.get("Orsa Vell").facts[0]
    assert fact.text == "Sold the Gull's Debt."
    assert [v.text for v in fact.history] == ["Runs the Gull's Debt sloop."]
    assert facts_section(note)[1] == "  - ~~Runs the Gull's Debt sloop.~~ (GM stated)"

    with pytest.raises(KeyError):
        vault.edit_fact("Orsa Vell", "nope", text="x")


def test_delete_fact_by_id(vault, note):
    vault.delete_fact("Orsa Vell", vault.get("Orsa Vell").facts[0].id)
    assert [f.text for f in vault.get("Orsa Vell").facts] == ["Owes Pip 20 gold."]


def test_campaign_facts_round_trip_with_the_same_shapes(vault):
    vault.add_campaign_fact(Fact("The party is in Dallon.", source=Source(PAGE, "s12", 60.0)))
    fid = vault.campaign_facts()[0].id
    assert vault.campaign_facts()[0].about is None
    vault.edit_campaign_fact(fid, text="The party is in Saltreach.", as_update=True)
    assert [v.text for v in vault.campaign_facts()[0].history] == ["The party is in Dallon."]
    vault.delete_campaign_fact(vault.campaign_facts()[0].id)
    assert vault.campaign_facts() == []


def test_a_note_with_unreadable_frontmatter_stays_read_only(vault):
    path = vault.root / "People" / "Broken.md"
    path.parent.mkdir(parents=True)
    original = "---\ntype: [npc\n---\n# Broken\n\n## Facts\n- Something.\n"
    path.write_text(original)
    assert [f.text for f in vault.get("Broken").facts] == ["Something."]
    for write in (
        lambda: vault.add_fact("Broken", Fact("x")),
        lambda: vault.edit_fact("Broken", vault.get("Broken").facts[0].id, text="y"),
        lambda: vault.delete_fact("Broken", vault.get("Broken").facts[0].id),
    ):
        with pytest.raises(ValueError, match="can't read"):
            write()
    assert path.read_text() == original


# ---------------------------------------------------------------- API


@pytest.fixture
def api(vault, monkeypatch):
    monkeypatch.setattr(deps, "vault", vault)
    monkeypatch.setattr(deps.engine, "vault_dir", lambda: vault.root)
    monkeypatch.setattr(deps.engine, "players", {"p1": SimpleNamespace(id="p1", name="Alex", character="Orsa Vell")})
    return TestClient(app, base_url=LOCAL)


def test_said_by_resolves_to_a_seated_player_by_character_name_case_insensitively(api, vault, note):
    r = api.post(
        "/api/campaign/entities/Orsa%20Vell/facts",
        json={
            "text": "Hates the abbey.",
            "said_by": "orsa vell",
            "confidence": "theory",
            "source": {"session_id": "s12", "t": 5882},
        },
    )
    assert r.status_code == 200, r.text
    fact = r.json()["facts"][-1]
    assert fact["said_by"] == {"name": "orsa vell", "player_id": "p1"}
    assert fact["source"] == {"page": PAGE, "session_id": "s12", "t": 5882.0, "label": "S12 1:38"}
    assert fact["confidence"] == "theory"
    assert fact["history"] == []
    assert api.get("/api/campaign/entities/Orsa%20Vell").json()["facts"][0]["said_by"] is None  # no speaker, no player

    unknown = api.post("/api/campaign/entities/Orsa%20Vell/facts", json={"text": "Y.", "said_by": "Someone Else"}).json()
    assert unknown["facts"][-1]["said_by"] == {"name": "Someone Else", "player_id": None}


def test_a_source_for_an_unknown_session_is_refused(api, note):
    r = api.post("/api/campaign/entities/Orsa%20Vell/facts", json={"text": "Z.", "source": {"session_id": "nope"}})
    assert r.status_code == 400


def test_review_edit_and_delete_over_the_api(api, vault, note):
    vault.add_fact(
        "Orsa Vell",
        Fact("Orsa Vell paid Pip back.", source=Source(PAGE, "s12", 6000.0), replaces="Owes Pip 20 gold."),
        suggested=True,
    )
    entity = api.get("/api/campaign/entities/Orsa%20Vell").json()
    suggestion = entity["suggested_facts"][0]
    assert (suggestion["kind"], suggestion["replaces"]) == ("update", entity["facts"][1]["id"])

    r = api.post("/api/campaign/entities/Orsa%20Vell/review", json={"accept_facts": [suggestion["id"]]}).json()
    assert r["suggested_facts"] == []
    assert [h["text"] for h in r["facts"][1]["history"]] == ["Owes Pip 20 gold."]

    fid = r["facts"][0]["id"]
    r = api.patch(
        "/api/campaign/entities/Orsa%20Vell/facts", json={"fact_id": fid, "text": "Captains the Gull's Debt.", "as_update": True}
    )
    assert [h["text"] for h in r.json()["facts"][0]["history"]] == ["Runs the Gull's Debt."]
    assert api.patch("/api/campaign/entities/Orsa%20Vell/facts", json={"fact_id": "nope", "text": "x"}).status_code == 404

    r = api.delete(f"/api/campaign/entities/Orsa%20Vell/facts/{r.json()['facts'][0]['id']}")
    assert [f["text"] for f in r.json()["facts"]] == ["Orsa Vell paid Pip back."]


def test_campaign_facts_over_the_api(api):
    facts = api.post("/api/campaign/facts", json={"text": "Two bells mark each tide."}).json()
    assert facts[0]["about"] is None
    facts = api.patch("/api/campaign/facts", json={"fact_id": facts[0]["id"], "text": "Two bells mark the tide."}).json()
    assert [f["text"] for f in facts] == ["Two bells mark the tide."]
    assert api.get("/api/campaign").json()["facts"][0]["text"] == "Two bells mark the tide."
    assert api.delete(f"/api/campaign/facts/{facts[0]['id']}").json() == []


def test_ask_still_finds_a_facts_text(vault, note):
    from troubadour.lore.ask import entry_passage

    vault.update(
        "Orsa Vell",
        facts=[*vault.get("Orsa Vell").facts, Fact("Fears the tide.", source=Source(PAGE), said_by="Alex", confidence="gm")],
    )
    passage = entry_passage(vault.get("Orsa Vell"), vault.root).text
    assert "Fears the tide." in passage
    assert "Owes Pip 20 gold." in passage
    assert "GM stated" in passage


def test_the_api_entity_kinds_are_the_vaults_types():
    from typing import get_args

    from troubadour.server.routers.campaign import Kind

    assert list(get_args(Kind)) == list(TYPES)
