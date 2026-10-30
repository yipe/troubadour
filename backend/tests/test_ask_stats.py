"""Ask: answer stats, the live time echoed back, and the generated _Overview/ folder left out."""

from fastapi.testclient import TestClient
from test_ask import SID, FakeLLM, setup, wait, write_session  # noqa: F401  (setup is a fixture)
from troubadour.server import deps
from troubadour.server.app import app


def test_stats_count_the_corpus_and_the_time(setup):  # noqa: F811
    vault, sessions, make, _ = setup
    vault.create("Elara", "pc", description="A paladin.")
    vault.write_note("Notes", "Session 3", "---\ntype: notes\n---\nThe duke keeps the diamond.\n")
    write_session(sessions)
    write_session(sessions, sid="2026-10-15_190000-aaaa")
    asker = make(FakeLLM(plan={"terms": ["gem"], "entries": []}))
    seen = []
    asker.bus.emit = lambda name, data: seen.append((name, data))  # noqa: ARG005
    a = asker.ask("Who has the gem?", t=125.5)
    assert a.t == 125.5
    wait(a)
    assert a.state == "done"
    assert a.stats["transcripts"] == 2
    assert a.stats["notes"] == 2  # the entry and the note
    assert a.stats["seconds"] >= 0
    searching = [d for _, d in seen if d["state"] == "searching" and d["stats"]]
    assert searching, "the counted corpus is announced while still searching"
    assert searching[0]["stats"]["seconds"] == 0
    assert (searching[0]["stats"]["transcripts"], searching[0]["stats"]["notes"]) == (2, 2)
    assert asker.list()[0]["t"] == 125.5


def test_overview_notes_are_not_searched(setup):  # noqa: F811
    vault, _, make, _ = setup
    vault.write_note("Notes", "Session 3", "---\ntype: notes\n---\nThe duke keeps the diamond in his tower.\n")
    overview = vault.root / "_Overview" / "Campaign overview.md"
    overview.parent.mkdir(parents=True)
    overview.write_text("The diamond is a summary.")
    llm = FakeLLM()
    a = wait(make(llm).ask("Where is the diamond?"))
    assert "summary" not in llm.prompt()
    assert a.stats["notes"] == 1


def test_endpoint_takes_t_and_validates_it(monkeypatch):
    seen = []

    class Stub:
        def ask(self, question, t=None):
            seen.append((question, t))
            from troubadour.lore.ask import Answer

            return Answer(id="a1", question=question, t=t)

    monkeypatch.setattr(deps, "asker", Stub())
    c = TestClient(app, base_url="http://127.0.0.1:8765")
    r = c.post("/api/campaign/ask", json={"question": "Who?", "t": 12.5})
    assert r.status_code == 200, r.text
    assert r.json()["t"] == 12.5
    assert r.json()["stats"] is None
    assert c.post("/api/campaign/ask", json={"question": "Who?"}).json()["t"] is None
    assert c.post("/api/campaign/ask", json={"question": "Who?", "t": 86401}).status_code == 422
    assert c.post("/api/campaign/ask", json={"question": "Who?", "t": -1}).status_code == 422
    assert seen == [("Who?", 12.5), ("Who?", None)]
