"""Ask: deleting a past question, including one still being answered."""

import threading

from fastapi.testclient import TestClient
from test_ask import FakeLLM, setup, wait, write_session  # noqa: F401  (setup is a fixture)
from troubadour.server import deps
from troubadour.server.app import app


class GatedLLM(FakeLLM):
    """Holds the plan call until released, so a test can act while an answer is running."""

    def __init__(self):
        super().__init__()
        self.started, self.release = threading.Event(), threading.Event()

    def json(self, system, user, schema, max_tokens=4000):
        self.started.set()
        assert self.release.wait(5)
        return super().json(system, user, schema, max_tokens)


def test_delete_removes_the_answer_and_tells_other_windows(setup):  # noqa: F811
    vault, sessions, make, _ = setup
    write_session(sessions)
    asker = make(FakeLLM())
    a = wait(asker.ask("Who has the gem?"))
    b = wait(asker.ask("Where is the cave?"))
    asker.delete(a.id)
    assert [x["id"] for x in asker.list()] == [b.id]
    assert ("campaign.updated", {}) in asker.bus.events


def test_unknown_and_other_campaigns_answers_are_not_found(setup):  # noqa: F811
    _, sessions, make, state = setup
    write_session(sessions)
    asker = make(FakeLLM())
    a = wait(asker.ask("Who has the gem?"))
    try:
        asker.delete("nope")
        raise AssertionError("expected KeyError")
    except KeyError:
        pass
    state["campaign"] = "other"
    try:
        asker.delete(a.id)
        raise AssertionError("expected KeyError")
    except KeyError:
        pass
    state["campaign"] = "main"
    assert len(asker.list()) == 1


def test_a_running_answer_deleted_midway_does_not_come_back(setup):  # noqa: F811
    _, sessions, make, _ = setup
    write_session(sessions)
    llm = GatedLLM()
    asker = make(llm)
    a = asker.ask("Who has the gem?")
    assert llm.started.wait(5)
    asker.delete(a.id)
    asker.bus.events.clear()
    llm.release.set()
    wait(a)
    assert a.state == "done"
    assert asker.list() == []
    assert asker.bus.of("campaign.answer") == []


def test_a_queued_answer_deleted_before_it_starts_is_skipped(setup):  # noqa: F811
    _, sessions, make, _ = setup
    write_session(sessions)
    llm = GatedLLM()
    asker = make(llm)
    first = asker.ask("Who has the gem?")
    assert llm.started.wait(5)
    queued = asker.ask("Where is the cave?")
    asker.delete(queued.id)
    llm.release.set()
    wait(first)
    assert queued.state == "queued"
    assert [x["id"] for x in asker.list()] == [first.id]


def test_route_deletes_validates_the_id_and_maps_unknown_to_404(monkeypatch):
    seen = []

    class Stub:
        def delete(self, answer_id):
            seen.append(answer_id)
            if answer_id == "deadbeef":
                raise KeyError(answer_id)

    monkeypatch.setattr(deps, "asker", Stub())
    c = TestClient(app, base_url="http://127.0.0.1:8765")
    assert c.delete("/api/campaign/answers/0123abcd").status_code == 204
    assert c.delete("/api/campaign/answers/deadbeef").status_code == 404
    assert c.delete("/api/campaign/answers/NOTVALID").status_code == 422
    assert seen == ["0123abcd", "deadbeef"]
