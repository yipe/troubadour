"""The processing pipeline: versions on disk, "Refresh this session", and upgrading old sessions."""

import json
import threading
import time
from typing import Any

import pytest
from conftest import RecordingBus, tone, write_wav
from conftest import job as new_job
from fastapi.testclient import TestClient
from test_memory import KNOWN, FakeLLM
from troubadour.core import config
from troubadour.core.transcript import build
from troubadour.engine import MAIN_CAMPAIGN, improve, pipeline
from troubadour.engine.pipeline import Run, Step
from troubadour.lore import memory as mem
from troubadour.lore.campaign import Vault
from troubadour.lore.facts import Fact
from troubadour.server import deps
from troubadour.server.app import app

OLD, NEW = "2025-03-01_190000-aaaa", "2025-04-01_190000-bbbb"


class LLM(FakeLLM):
    def problem(self):
        return None


def make_session(engine, sid=OLD, *, wav=False, stamped=None, texts=("Dilara, three.", "We found a cave near Dallon.")):
    players = [{"id": "p1", "name": "Theo", "character": "Elara", "is_gm": False, "color": "#000"}]
    voices = [{"id": "v1", "label": "Voice 1", "status": "named", "player_id": "p1", "character": None, "trained": True}]
    msgs = [
        {"id": f"m{i}", "t_start": i * 5.0, "t_end": i * 5.0 + 4, "voice_id": "v1", "provisional": False, "confidence": 0.9, "text": t}
        for i, t in enumerate(texts)
    ]  # fmt: skip
    started = time.mktime((int(sid[:4]), int(sid[5:7]), 8, 19, 34, 1, 0, 0, -1))
    meta = {
        "id": sid,
        "started_at": started,
        "source": {"kind": "mic", "device": None},
        "duration_s": 600,
        "campaign": MAIN_CAMPAIGN,
    }
    if stamped is not None:
        meta["pipeline"] = stamped
    record = build(meta, players, voices, msgs)
    folder = engine.sessions_dir() / sid
    folder.mkdir(parents=True)
    (folder / "transcript.json").write_text(json.dumps(record))
    (folder / "meta.json").write_text(json.dumps(record["session"]))
    if wav:
        write_wav(folder / "audio.wav", tone(220, 2.0))
    return folder


def pipeline_of(folder, name="meta.json"):
    data = json.loads((folder / name).read_text())
    return (data["session"] if name == "transcript.json" else data).get("pipeline")


@pytest.fixture
def job():
    return new_job()


@pytest.fixture
def idle(engine, monkeypatch):
    engine.live, engine.status = None, "idle"
    monkeypatch.setattr(config, "CLEANUP", False)  # no spelling step unless a test wants one
    return engine


@pytest.fixture
def memory(idle, tmp_path):
    llm: Any = LLM()  # a scripted stand-in for MemoryLLM
    return mem.Memory(Vault(tmp_path / "campaign"), RecordingBus(), llm=llm, sessions_dir=idle.sessions_dir, seed=lambda: KNOWN)


def step(name, log, *, skip=None, available=True, fail=None, after=None):
    def run(run_, job):
        log.append(name)
        if fail:
            raise ValueError(fail)
        if after:
            after()

    return Step(name, 1, name.title(), (), (), run, skip=lambda r: skip, available=available)


# ------------------------------------------------------------------ versions on disk


def test_sessions_without_a_record_are_version_zero_and_only_runnable_steps_are_stale(idle, memory):
    make_session(idle, OLD)  # no recording, not written up, no recap, never labelled
    assert [s.name for s in pipeline.stale(Run(idle, memory, OLD))] == ["talk"]
    make_session(idle, NEW, wav=True)
    # With a recording the transcript is stale too; speakers need named voices the matcher doesn't have.
    assert [s.name for s in pipeline.stale(Run(idle, memory, NEW))] == ["transcribe", "talk"]


def test_a_recorded_version_is_not_stale_and_a_bumped_one_is(idle, memory, monkeypatch):
    folder = make_session(idle, stamped={"talk": 1})
    assert pipeline.stale(Run(idle, memory, OLD)) == []
    bumped = Step("talk", 2, "Count talk time", (), (), lambda r, j: None)
    assert [s.name for s in pipeline.stale(Run(idle, memory, OLD), [bumped])] == ["talk"]
    pipeline.stamp(folder, bumped)
    assert pipeline.stale(Run(idle, memory, OLD), [bumped]) == []
    assert pipeline_of(folder) == pipeline_of(folder, "transcript.json") == {"talk": 2}


def test_a_live_session_is_saved_with_what_listening_already_did(engine):
    record = engine.transcript_record()
    assert record["session"]["pipeline"] == pipeline.live_stamp()
    assert set(pipeline.live_stamp()) == {"transcribe", "speakers", "spelling", "talk"}


def test_garbage_in_the_record_counts_as_version_zero():
    assert pipeline.recorded({"pipeline": {"talk": "1", "a": True, "b": 2}}) == {"b": 2}
    assert pipeline.recorded({"pipeline": [1]}) == {}


# ------------------------------------------------------------------ refresh


def test_refresh_runs_steps_in_order_skips_the_ones_that_cannot_run_and_records_each(idle, memory, job):
    folder = make_session(idle)
    log: list[str] = []
    steps = [
        step("a", log),
        step("b", log, skip="no recording"),
        step("c", log, available=False),
        step("d", log),
    ]
    pipeline.refresh(job, Run(idle, memory, OLD), steps)
    assert log == ["a", "d"]
    assert pipeline_of(folder) == {"a": 1, "d": 1}
    assert [s["label"] for s in job.steps] == ["A", "D"]
    assert [s["state"] for s in job.steps] == ["done", "done"]


def test_a_failing_step_stops_the_job_and_leaves_earlier_steps_recorded(idle, memory, job):
    folder = make_session(idle)
    log: list[str] = []
    steps = [step("a", log), step("b", log, fail="the model is down"), step("c", log)]
    with pytest.raises(RuntimeError, match="B failed.*the model is down.*Earlier steps are kept"):
        pipeline.refresh(job, Run(idle, memory, OLD), steps)
    assert log == ["a", "b"]
    assert pipeline_of(folder) == {"a": 1}  # b is not recorded, c never ran


def test_refresh_can_be_cancelled_between_steps(idle, memory, job):
    folder = make_session(idle)
    log: list[str] = []
    steps = [step("a", log, after=lambda: pipeline.request_cancel(job.id)), step("b", log)]
    pipeline.refresh(job, Run(idle, memory, OLD), steps)
    assert log == ["a"]
    assert pipeline_of(folder) == {"a": 1}
    assert "Stopped after 1 of 2" in job.message
    pipeline.refresh(job, Run(idle, memory, OLD), [step("a", log), step("b", log)])  # the cancel was used up
    assert log == ["a", "a", "b"]


def test_only_stale_steps_run_in_an_upgrade(idle, memory, job):
    make_session(idle, stamped={"a": 1})
    log: list[str] = []
    pipeline.refresh(job, Run(idle, memory, OLD), [step("a", log), step("b", log)], only_stale=True)
    assert log == ["b"]


def test_nothing_runs_while_a_session_does(idle, memory, job):
    make_session(idle)
    idle.status = "running"
    with pytest.raises(ValueError, match="session is running"):
        pipeline.refresh(job, Run(idle, memory, OLD), [step("a", [])])


def test_a_refresh_that_rewrites_words_takes_the_restore_point_first(idle, memory, job):
    folder = make_session(idle)
    before = (folder / "transcript.json").read_text()
    seen: list[str] = []
    rewrite = Step("spelling", 1, "Fix", (), (), lambda r, j: seen.append((folder / pipeline.RESTORE_POINT).read_text()))
    pipeline.refresh(job, Run(idle, memory, OLD), [rewrite])
    assert seen == [before]  # taken before the step ran
    # A session already improved keeps its older original.
    (folder / pipeline.RESTORE_POINT).write_text("older")
    pipeline.refresh(job, Run(idle, memory, OLD), [rewrite])
    assert (folder / pipeline.RESTORE_POINT).read_text() == "older"


def test_the_talk_step_counts_talk_time_into_the_record(idle, memory, job):
    folder = make_session(idle)
    pipeline.refresh(job, Run(idle, memory, OLD), [pipeline.BY_NAME["talk"]])
    for name in ("meta.json", "transcript.json"):
        data = json.loads((folder / name).read_text())
        assert (data["session"] if name == "transcript.json" else data)["talk"] == {"p1": 8.0}
    assert not (folder / pipeline.RESTORE_POINT).exists()  # bookkeeping is not a rewrite


def test_a_refresh_with_an_llm_step_stops_up_front_when_the_model_is_down(idle, memory, job, monkeypatch):
    folder = make_session(idle)
    monkeypatch.setattr(memory.llm, "problem", lambda: "LM Studio isn't running")
    llm_step = Step("in_character", 1, "Mark", ("llm",), (), lambda r, j: pytest.fail("ran"))
    with pytest.raises(ValueError, match="LM Studio"):
        pipeline.refresh(job, Run(idle, memory, OLD), [step("a", []), llm_step])
    assert pipeline_of(folder) is None  # nothing ran, nothing half-done


# ------------------------------------------------------------------ the write-up keeps what the owner confirmed


def test_a_refreshed_write_up_keeps_confirmed_facts_trashes_the_old_page_and_only_suggests_new_ones(idle, memory, job):
    make_session(idle)
    vault = memory.vault
    memory.llm.found = {"facts": [{"about": "Elara", "text": "Elara owns a grey owl."}]}
    first = memory.write_up(OLD)
    deadline = time.monotonic() + 5
    while first.state in ("queued", "running") and time.monotonic() < deadline:
        time.sleep(0.01)
    assert first.state == "done", first.message
    owl = vault.get("Elara").suggested_facts[0]
    vault.update("Elara", facts=[Fact("Elara is a ranger.")], suggested_facts=[])
    vault.add_fact("Elara", Fact(owl.text))  # the owner accepted the owl
    confirmed = [(f.text, f.about) for f in vault.get("Elara").facts]
    (page_path,) = (vault.root / "Sessions").glob("*.md")
    old_page = page_path.read_text()

    memory.llm.page = {"title": "A New Title", "last_time": "Everything is rewritten.", "spotlight": [], "highlights": []}
    memory.llm.found = {
        "facts": [
            {"about": "Elara", "text": "Elara owns a grey owl"},  # the confirmed one, said again: not suggested
            {"about": "Elara", "text": "Elara fears deep water."},
            {"about": "Elara", "text": "Elara is a rogue.", "replaces": "Elara is a ranger."},  # a change to a confirmed fact
        ]
    }
    pipeline.refresh(job, Run(idle, memory, OLD), [pipeline.BY_NAME["writeup"]])

    elara = vault.get("Elara")
    assert [(f.text, f.about) for f in elara.facts] == confirmed  # confirmed facts: untouched
    suggested = [f.text for f in elara.suggested_facts]
    assert "Elara fears deep water." in suggested
    assert "Elara is a rogue." in suggested  # arrives as a suggestion; accepting it is the owner's call
    assert not any("grey owl" in t for t in suggested)
    (new_page,) = (vault.root / "Sessions").glob("*.md")
    assert new_page == page_path  # same name: facts elsewhere link to it
    assert "Everything is rewritten." in new_page.read_text()
    (kept,) = (vault.root / ".trash").glob("*.md")
    assert kept.read_text() == old_page
    assert pipeline_of(idle.sessions_dir() / OLD) == {"writeup": 1}
    assert job.suggested == 2
    assert job.note == "Sessions/" + new_page.name


def test_a_write_up_that_fails_leaves_the_old_page_in_place(idle, memory, job):
    make_session(idle)
    first = memory.write_up(OLD)
    while first.state in ("queued", "running"):
        time.sleep(0.01)
    (page,) = (memory.vault.root / "Sessions").glob("*.md")
    before = page.read_text()
    memory.llm.read = {}  # the notes come back empty
    with pytest.raises(RuntimeError, match="Write up the session failed"):
        pipeline.refresh(job, Run(idle, memory, OLD), [pipeline.BY_NAME["writeup"]])
    assert page.read_text() == before
    assert pipeline_of(idle.sessions_dir() / OLD) is None


def test_the_write_up_step_only_redoes_pages_that_exist(idle, memory):
    make_session(idle)
    assert pipeline.BY_NAME["writeup"].skip(Run(idle, memory, OLD)) == "not written up"
    assert pipeline.BY_NAME["recap"].skip(Run(idle, memory, OLD)) == "no recap"


# ------------------------------------------------------------------ review list and recap


def test_the_review_list_is_re_derived_but_decisions_and_the_old_file_are_kept(idle):
    folder = make_session(idle)
    saved = {
        "items": [{"id": "a", "kind": "fact"}, {"id": "b", "kind": "fact"}, "junk"],
        "decisions": {"a": "rejected"},
    }
    (folder / "review.json").write_text(json.dumps(saved))
    pipeline.reset_review(folder)
    assert json.loads((folder / "review.json").read_text()) == {
        "items": [{"id": "a", "kind": "fact"}],
        "decisions": {"a": "rejected"},
    }
    (archive,) = folder.glob("review.before-refresh-*.json")
    assert json.loads(archive.read_text()) == saved


def test_recap_options_are_checked_before_use():
    options = pipeline.recap_options({"voice": "pirate", "length_s": 9999, "include": {"quote": False, "moments": "yes"}})
    assert (options.voice, options.length_s, options.include.quote, options.include.moments) == ("narrator", 45, False, True)
    assert pipeline.recap_options({"voice": "bullets", "length_s": 60}).voice == "bullets"
    assert pipeline.recap_options("nonsense").length_s == 45


# ------------------------------------------------------------------ the API


@pytest.fixture
def client(idle, memory, monkeypatch):
    monkeypatch.setattr(deps, "engine", idle)
    monkeypatch.setattr(deps, "memory", memory)
    return TestClient(app, base_url="http://127.0.0.1:8765")


def wait_jobs(memory, seconds=5):
    deadline = time.monotonic() + seconds
    while memory.busy() and time.monotonic() < deadline:
        time.sleep(0.01)
    assert not memory.busy()


def test_upgrades_lists_only_stale_sessions_and_only_their_stale_steps(client, idle):
    make_session(idle, OLD, wav=True, stamped={"talk": 1})  # needs the transcript step only
    make_session(idle, NEW, stamped=pipeline.current())  # up to date
    body = client.get("/api/sessions/upgrades").json()
    assert body["sessions"] == [{"id": OLD, "n": 1, "stale": ["transcribe"]}]
    assert body["current"] == pipeline.current()


def test_upgrade_queues_one_job_per_stale_session_oldest_first(client, idle, memory, monkeypatch):
    make_session(idle, NEW)
    make_session(idle, OLD)
    make_session(idle, "2025-05-01_190000-cccc", stamped=pipeline.current())
    ran: list[tuple[str, bool]] = []
    monkeypatch.setattr(
        pipeline, "refresh", lambda job, run, steps=pipeline.STEPS, only_stale=False: ran.append((run.sid, only_stale))
    )
    jobs = client.post("/api/sessions/upgrade").json()
    assert [(j["kind"], j["title"]) for j in jobs] == [("refresh", OLD), ("refresh", NEW)]
    wait_jobs(memory)
    assert ran == [(OLD, True), (NEW, True)]


def test_refresh_starts_a_job_of_kind_refresh_and_refuses_a_second_while_it_runs(client, idle, memory, monkeypatch):
    make_session(idle)
    gate = threading.Event()
    monkeypatch.setattr(pipeline, "refresh", lambda job, run, steps=pipeline.STEPS, only_stale=False: gate.wait(5))
    r = client.post(f"/api/sessions/{OLD}/refresh")
    assert r.status_code == 200
    assert (r.json()["kind"], r.json()["title"]) == ("refresh", OLD)
    assert client.post(f"/api/sessions/{OLD}/refresh").status_code == 409
    # Upgrading skips a session that is already being refreshed.
    assert client.post("/api/sessions/upgrade").json() == []
    gate.set()
    wait_jobs(memory)


def test_refresh_and_upgrade_are_refused_while_a_session_runs(client, idle):
    make_session(idle)
    idle.status = "running"
    assert client.post(f"/api/sessions/{OLD}/refresh").status_code == 409
    assert client.post("/api/sessions/upgrade").status_code == 409


def test_refresh_of_an_unknown_session_is_404_and_a_model_that_is_down_is_503(client, idle, memory, monkeypatch):
    assert client.post(f"/api/sessions/{OLD}/refresh").status_code == 404
    folder = make_session(idle)
    (folder / "recap.json").write_text("{}")  # a recap makes an LLM step runnable
    monkeypatch.setattr(memory.llm, "problem", lambda: "LM Studio isn't running")
    r = client.post(f"/api/sessions/{OLD}/refresh")
    assert r.status_code == 503
    assert "LM Studio" in r.json()["detail"]


def test_cancel_needs_a_real_refresh_job(client):
    assert client.post("/api/sessions/refresh/deadbeef/cancel").status_code == 404
    assert client.post("/api/sessions/refresh/not-hex/cancel").status_code == 422


def test_the_single_tools_record_their_step_when_they_finish(client, idle, memory, monkeypatch):
    folder = make_session(idle)
    monkeypatch.setattr(improve, "fix_spellings", lambda job, engine, sid, emit: None)
    assert client.post(f"/api/sessions/{OLD}/spelling").status_code == 200
    wait_jobs(memory)
    assert pipeline_of(folder) == {"spelling": 1}

    def boom(job, engine, sid, emit):
        raise ValueError("no")

    monkeypatch.setattr(improve, "reassign_speakers", boom)
    (folder / "audio.wav").write_bytes(b"")  # session_audio needs a file; the job fails before reading it
    monkeypatch.setattr("troubadour.server.routers.sessions.session_audio", lambda sid: (folder / "audio.wav", 1.0))
    assert client.post(f"/api/sessions/{OLD}/retranscribe").status_code == 200
    wait_jobs(memory)
    assert pipeline_of(folder) == {"spelling": 1}  # a failed job records nothing
