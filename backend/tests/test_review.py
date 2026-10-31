"""Review endpoint: suggestions anchored to transcript lines, a frozen list, and one endpoint per decision."""

import json

import pytest
from fastapi.testclient import TestClient
from troubadour.lore.facts import Fact, Source
from troubadour.server import deps
from troubadour.server.app import app

SID = "2026-10-08_193401-eebf"
OLD = "2026-09-01_190000-aaaa"
PAGE = "2026-10-08 The Bridge"

LINES = [
    "Welcome back everyone, last time we left the road.",
    "Elara talks to the ogre Mudge at the bridge.",
    "Mudge now guards the Greyfen bridge and wants a toll.",
    "Then Dilara said hello and I replied, the Dilara thing again.",
    "We found Zorblax carved in the stone, and Zorblax was glowing.",
    "Let us rest at the inn tonight.",
]


@pytest.fixture
def api(dirs, engine, monkeypatch):
    monkeypatch.setattr(deps, "engine", engine)
    return TestClient(app, base_url="http://127.0.0.1:8765")


def save_session(sid, lines, started_at):
    folder = deps.engine.sessions_dir() / sid
    folder.mkdir(parents=True)
    (folder / "meta.json").write_text(json.dumps({"id": sid, "started_at": started_at}))
    messages = [{"id": f"m{i}", "t_start": i * 10.0, "t_end": i * 10.0 + 8, "text": t} for i, t in enumerate(lines)]
    (folder / "transcript.json").write_text(json.dumps({"messages": messages}))
    return folder


def write_page(sid=SID, page=PAGE):
    (deps.vault.root / "Sessions").mkdir(parents=True, exist_ok=True)
    (deps.vault.root / "Sessions" / f"{page}.md").write_text(f"---\nsession_id: {sid}\n---\n# {page}\n")


@pytest.fixture
def world(api):
    """Two saved sessions (the old one mentions nobody new), a write-up for SID, and one of each suggestion."""
    save_session(OLD, ["We talked about the weather and the road."], 1)
    folder = save_session(SID, LINES, 2)
    write_page()
    v = deps.vault
    v.create("Elara", "pc")
    v.create("Greyfen", "place")
    v.create("Mudge", "npc", status="suggested", description="An ogre.")
    v.add_fact("Elara", Fact("Elara fears water.", "Elara"))
    v.add_fact("Mudge", Fact("Mudge guards the Greyfen bridge.", "Mudge", "Theo", Source(PAGE, SID, 25.0), "gm"), suggested=True)
    v.add_fact(
        "Elara",
        Fact("Elara fears deep water.", "Elara", None, Source(PAGE, SID, 3.0), replaces="Elara fears water."),
        suggested=True,
    )
    v.add_campaign_fact(Fact("The toll is two gold.", None, None, Source(PAGE, SID, 28.0)))
    return folder


def get(api, sid=SID):
    r = api.get(f"/api/sessions/{sid}/review")
    assert r.status_code == 200, r.text
    return r.json()


def by_kind(review, kind, **match):
    found = [i for i in review["items"] if i["kind"] == kind and all(i[k] == v for k, v in match.items())]
    return found


def find(review, kind, pick):
    (item,) = [i for i in review["items"] if i["kind"] == kind and pick(i)]
    return item


def act(api, item, **body):
    return api.post(f"/api/sessions/{SID}/review/{item['id']}", json=body)


def test_items_for_each_kind_with_anchors(api, world):
    review = get(api)
    assert review["written_up"] is True
    assert review["counts"] == {"total": 5, "done": 0, "fact": 2, "spelling": 2, "entry": 1}
    mudge = find(review, "fact", lambda i: i["fact"]["about"] == "Mudge")
    assert (mudge["line_id"], mudge["t"]) == ("m2", 25.0)  # the line whose span holds t
    assert mudge["fact"]["confidence"] == "gm"
    assert mudge["fact"]["source"]["session_id"] == SID
    update = find(review, "fact", lambda i: i["fact"]["kind"] == "update")
    assert update["fact"]["replaces"]
    assert update["line_id"] == "m0"  # t=3 is inside line 0 (0..8)
    # "The toll is two gold." is a confirmed campaign fact: nothing waits for a decision, so it is no item.
    assert by_kind(review, "fact", **{"id": "fact:" + deps.vault.campaign_facts()[0].id}) == []
    misheard = find(review, "spelling", lambda i: i["spelling"]["entity"] == "Elara")
    assert misheard["spelling"]["heard"] == "Dilara"
    assert misheard["line_id"] == "m3"
    assert misheard["t"] == 30.0
    unknown = find(review, "spelling", lambda i: i["spelling"]["entity"] is None)
    assert unknown["spelling"] == {"heard": "Zorblax", "entity": None, "count": 2}
    assert unknown["line_id"] == "m4"
    entry = find(review, "entry", lambda i: True)
    assert entry["entry"] == {"name": "Mudge", "type": "npc", "description": "An ogre."}
    assert entry["line_id"] == "m1"
    assert (world / "review.json").is_file()


def test_entry_first_mentioned_earlier_is_not_this_sessions(api, world):
    (deps.engine.sessions_dir() / OLD / "transcript.json").write_text(
        json.dumps({"messages": [{"id": "x", "t_start": 0, "t_end": 1, "text": "Old Mudge was here."}]})
    )
    assert get(api)["counts"]["entry"] == 0


def test_preaccepted_from_the_notebook_and_kept_only_facts(api, world):
    items = [
        {"id": "n1", "kind": "fact", "text": "Mudge guards the Greyfen bridge!", "about": "Mudge", "status": "kept"},
        {"id": "n2", "kind": "entry", "text": "Mudge", "status": "kept"},
        {"id": "n3", "kind": "spelling", "text": "Zorblax → Zorbla", "status": "kept", "count": 2},
        {
            "id": "n4",
            "kind": "fact",
            "text": "The inn has a cellar.",
            "about": "Greyfen",
            "t": 50.0,
            "line_id": "m5",
            "confidence": "theory",
            "status": "kept",
        },
        {"id": "n5", "kind": "fact", "text": "Dismissed thing here.", "about": "Greyfen", "status": "dismissed"},
    ]
    (world / "notebook.json").write_text(json.dumps({"session_id": SID, "items": items, "pins": []}))
    review = get(api)
    assert review["counts"]["total"] == 6
    assert [i["preaccepted"] for i in review["items"]].count(True) == 4
    assert find(review, "fact", lambda i: i["fact"]["about"] == "Mudge")["preaccepted"]
    assert find(review, "entry", lambda i: True)["preaccepted"]
    assert find(review, "spelling", lambda i: i["spelling"]["heard"] == "Zorblax")["preaccepted"]
    own = find(review, "fact", lambda i: i["fact"]["text"] == "The inn has a cellar.")
    assert (own["preaccepted"], own["line_id"], own["t"], own["fact"]["confidence"]) == (True, "m5", 50.0, "theory")
    # Accepting it writes a real fact, with the session as its source.
    assert act(api, own, action="accept").json()["status"] == "accepted"
    (fact,) = [f for f in deps.vault.get("Greyfen").facts if f.text == "The inn has a cellar."]
    assert fact.source
    assert (fact.source.session_page, fact.source.t) == (PAGE, 50.0)


def test_the_total_is_frozen_when_an_item_is_rejected(api, world):
    review = get(api)
    mudge = find(review, "fact", lambda i: i["fact"]["about"] == "Mudge")
    r = act(api, mudge, action="reject")
    assert r.status_code == 200
    assert r.json()["status"] == "rejected"
    assert deps.vault.get("Mudge").suggested_facts == []
    after = get(api)
    assert after["counts"]["total"] == 5
    assert after["counts"]["done"] == 1
    again = find(after, "fact", lambda i: i["id"] == mudge["id"])
    assert again["status"] == "rejected"
    assert again["fact"]["text"] == "Mudge guards the Greyfen bridge."


def test_a_suggestion_that_vanishes_counts_as_rejected_and_new_ones_join(api, world):
    review = get(api)
    mudge = find(review, "fact", lambda i: i["fact"]["about"] == "Mudge")
    deps.vault.delete_fact("Mudge", mudge["fact"]["id"])  # removed elsewhere, no decision
    deps.vault.add_fact("Greyfen", Fact("Greyfen floods in spring.", "Greyfen", None, Source(PAGE, SID, 5.0)), suggested=True)
    after = get(api)
    assert after["counts"]["total"] == 6
    assert find(after, "fact", lambda i: i["id"] == mudge["id"])["status"] == "rejected"
    assert act(api, mudge, action="accept").status_code == 409


def test_accept_fact_keeps_its_source_and_can_be_edited_or_moved(api, world):
    review = get(api)
    mudge = find(review, "fact", lambda i: i["fact"]["about"] == "Mudge")
    r = act(api, mudge, action="accept", text="Mudge guards the Greyfen bridge for a toll.")
    assert r.status_code == 200
    assert r.json()["fact"]["text"] == "Mudge guards the Greyfen bridge for a toll."
    e = deps.vault.get("Mudge")
    assert [f.text for f in e.facts] == ["Mudge guards the Greyfen bridge for a toll."]
    assert not e.suggested_facts
    assert e.facts[0].source
    assert e.facts[0].source.t == 25.0
    assert e.facts[0].confidence == "gm"
    assert act(api, mudge, action="accept").status_code == 409


def test_a_suggested_fact_can_move_to_the_campaign(api, world):
    mudge = find(get(api), "fact", lambda i: i["fact"]["about"] == "Mudge")
    r = act(api, mudge, action="accept", about=None)
    assert r.status_code == 200
    assert r.json()["fact"]["about"] is None
    assert [f.text for f in deps.vault.campaign_facts()][-1] == "Mudge guards the Greyfen bridge."
    assert deps.vault.get("Mudge").suggested_facts == []
    assert [f.text for f in deps.vault.campaign_facts()][0] == "The toll is two gold."


def test_a_campaign_fact_is_no_review_item_even_in_an_old_review_file(api, world):
    fact = deps.vault.campaign_facts()[0]
    row = {
        "id": f"fact:{fact.id}",
        "kind": "fact",
        "key": fact.id,
        "line_id": "m2",
        "t": 28.0,
        "data": {"text": fact.text, "about": None, "source": {"page": PAGE, "session_id": SID, "t": 28.0, "label": None}},
    }
    (world / "review.json").write_text(json.dumps({"items": [row], "decisions": {}}))
    old = find(get(api), "fact", lambda i: i["id"] == row["id"])
    assert old["status"] == "accepted"  # nothing is waiting: the fact is in the vault
    assert act(api, old, action="reject").status_code == 409
    assert [f.text for f in deps.vault.campaign_facts()] == ["The toll is two gold."]


def test_rejecting_a_fact_that_is_confirmed_never_deletes_it(api, world):
    from troubadour.lore import review as lore

    fact = deps.vault.campaign_facts()[0]
    item = lore.Item(f"fact:{fact.id}", "fact", fact.id, fact=fact)
    lore._fact_action(deps.vault, item, "reject", None, None, False)
    assert [f.text for f in deps.vault.campaign_facts()] == ["The toll is two gold."]


def test_a_bad_target_changes_nothing(api, world):
    mudge = find(get(api), "fact", lambda i: i["fact"]["about"] == "Mudge")
    assert act(api, mudge, action="accept", about="Nobody", text="Changed text.").status_code == 404
    assert [s.text for s in deps.vault.get("Mudge").suggested_facts] == ["Mudge guards the Greyfen bridge."]
    assert get(api)["counts"]["done"] == 0


def test_accepting_an_update_keeps_the_old_wording_as_history(api, world):
    update = find(get(api), "fact", lambda i: i["fact"]["kind"] == "update")
    assert act(api, update, action="accept").status_code == 200
    (fact,) = deps.vault.get("Elara").facts
    assert fact.text == "Elara fears deep water."
    assert [h.text for h in fact.history] == ["Elara fears water."]


def test_spelling_accept_and_reject(api, world):
    review = get(api)
    misheard = find(review, "spelling", lambda i: i["spelling"]["entity"] == "Elara")
    assert act(api, misheard, action="accept").json()["status"] == "accepted"
    assert deps.vault.get("Elara").heard_as == ["Dilara"]
    # An unknown word that is rejected is ignored from then on.
    unknown = find(review, "spelling", lambda i: i["spelling"]["entity"] is None)
    assert act(api, unknown, action="reject").json()["status"] == "rejected"
    assert "zorblax" in [w.casefold() for w in deps.vault.ignored()]
    assert get(api)["counts"]["total"] == 5


def test_misheard_reject_is_remembered(api, world):
    misheard = find(get(api), "spelling", lambda i: i["spelling"]["entity"] == "Elara")
    assert act(api, misheard, action="reject").status_code == 200
    assert deps.vault.get("Elara").heard_as_rejected == ["Dilara"]
    assert deps.vault.get("Elara").heard_as == []


def test_unknown_word_accept_creates_the_entry_the_client_names(api, world):
    unknown = find(get(api), "spelling", lambda i: i["spelling"]["entity"] is None)
    assert act(api, unknown, action="accept").status_code == 400  # the client must name it
    assert get(api)["counts"]["done"] == 0
    assert act(api, unknown, action="accept", text="Zorblax the Stone").json()["status"] == "accepted"
    e = deps.vault.get("Zorblax the Stone")
    assert e.status == "confirmed"
    assert e.heard_as == ["Zorblax"]


def test_entry_accept_and_reject(api, world):
    entry = find(get(api), "entry", lambda i: True)
    assert act(api, entry, action="accept").json()["status"] == "accepted"
    assert deps.vault.get("Mudge").status == "confirmed"


def test_entry_reject_moves_the_note_to_trash(api, world):
    entry = find(get(api), "entry", lambda i: True)
    assert act(api, entry, action="reject").json()["status"] == "rejected"
    assert deps.vault.find("Mudge") is None
    assert (deps.vault.root / ".trash" / "Mudge.md").is_file()
    after = get(api)
    assert find(after, "entry", lambda i: True)["entry"]["name"] == "Mudge"  # still listed, from its snapshot


def test_a_repeat_action_is_409_and_unknown_items_404(api, world):
    entry = find(get(api), "entry", lambda i: True)
    assert act(api, entry, action="accept").status_code == 200
    assert act(api, entry, action="reject").status_code == 409
    assert deps.vault.get("Mudge").status == "confirmed"
    assert api.post(f"/api/sessions/{SID}/review/fact:nope", json={"action": "accept"}).status_code == 404
    assert api.post(f"/api/sessions/{SID}/review/x", json={"action": "maybe"}).status_code == 422


def test_unknown_or_bad_session_ids(api, world):
    assert api.get("/api/sessions/2026-01-01_000000-ffff/review").status_code == 404
    assert api.get("/api/sessions/not-an-id/review").status_code == 404
    assert api.post("/api/sessions/not-an-id/review/x", json={"action": "accept"}).status_code == 404


def test_a_session_that_is_not_written_up_has_only_notebook_items(api, dirs):
    folder = save_session(SID, LINES, 2)
    deps.vault.create("Mudge", "npc", status="suggested")
    items = [
        {"id": "n1", "kind": "fact", "text": "Mudge guards the bridge.", "about": "Mudge", "status": "kept", "t": 12.0},
        {"id": "n2", "kind": "fact", "text": "Left open.", "about": "Mudge", "status": "open"},
    ]
    (folder / "notebook.json").write_text(json.dumps({"session_id": SID, "items": items, "pins": []}))
    review = get(api)
    assert review["written_up"] is False
    assert [i["fact"]["text"] for i in review["items"]] == ["Mudge guards the bridge."]
    assert review["items"][0]["line_id"] is None
    assert review["items"][0]["fact"]["source"] is None
    assert review["counts"] == {"total": 1, "done": 0, "fact": 1, "spelling": 0, "entry": 0}


def test_an_empty_session_has_no_items(api, dirs):
    save_session(SID, LINES, 2)
    assert get(api)["items"] == []


def test_rejecting_an_entry_confirmed_since_the_list_froze_never_trashes_it(api, world):
    entry = find(get(api), "entry", lambda i: True)
    deps.vault.update("Mudge", status="confirmed")  # confirmed in the Codex meanwhile
    assert act(api, entry, action="reject").status_code in (400, 409)
    assert deps.vault.get("Mudge").status == "confirmed"
    assert not (deps.vault.root / ".trash" / "Mudge.md").exists()


# Accepting a fact into an entry that already holds a pending suggestion saying the same thing (under another
# id, since ids hash the entry name) must promote that suggestion: exactly one confirmed copy, nothing else lost.
DARK = "Elara fears the dark."


def _dark_fact_with_a_pending_twin_on_elara(about):
    from troubadour.lore import review as lore

    deps.vault.add_fact("Elara", Fact(DARK, "Elara"), suggested=True)
    twin = deps.vault.get("Elara").suggested_facts[-1]
    mine = Fact(DARK, about, source=Source(PAGE, SID, 3.0))
    assert mine.id != twin.id
    return lore, lore.Item(f"fact:{mine.id}", "fact", mine.id, fact=mine)


def _assert_one_confirmed_dark_fact():
    e = deps.vault.get("Elara")
    assert [f.text for f in e.facts].count(DARK) == 1
    assert DARK not in [s.text for s in e.suggested_facts]
    assert "Elara fears water." in [f.text for f in e.facts]  # nothing else confirmed was removed


def test_moving_a_suggestion_onto_an_entry_with_a_pending_twin_keeps_one_confirmed_copy(api, world):
    lore, it = _dark_fact_with_a_pending_twin_on_elara("Mudge")
    deps.vault.add_fact("Mudge", it.fact, suggested=True)
    lore._fact_action(deps.vault, it, "accept", None, "Elara", True)
    _assert_one_confirmed_dark_fact()
    assert DARK not in [s.text for s in deps.vault.get("Mudge").suggested_facts]


def test_moving_a_campaign_fact_onto_an_entry_with_a_pending_twin_keeps_one_confirmed_copy(api, world):
    lore, it = _dark_fact_with_a_pending_twin_on_elara(None)
    deps.vault.add_campaign_fact(it.fact)
    lore._fact_action(deps.vault, it, "accept", None, "Elara", True)
    _assert_one_confirmed_dark_fact()
    assert DARK not in [f.text for f in deps.vault.campaign_facts()]
    assert [f.text for f in deps.vault.campaign_facts()] == ["The toll is two gold."]


def test_accepting_a_kept_notebook_fact_onto_an_entry_with_a_pending_twin_keeps_one_confirmed_copy(api, world):
    from troubadour.lore import review as lore

    deps.vault.add_fact("Elara", Fact(DARK, "Elara"), suggested=True)
    # Worded a little differently, so it has its own id but is "the same fact" to the duplicate check.
    mine = Fact("Elara fears the darkness.", "Elara", source=Source(PAGE, SID, 3.0))
    assert mine.id != deps.vault.get("Elara").suggested_facts[-1].id
    assert lore._where(deps.vault, mine) is None  # held in neither list: a kept notebook fact
    lore._fact_action(deps.vault, lore.Item(f"fact:{mine.id}", "fact", mine.id, fact=mine), "accept", None, "Elara", True)
    e = deps.vault.get("Elara")
    assert [f.text for f in e.facts if "dark" in f.text] == ["Elara fears the darkness."]
    assert not [s for s in e.suggested_facts if "dark" in s.text]
    assert "Elara fears water." in [f.text for f in e.facts]
