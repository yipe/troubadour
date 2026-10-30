"""The recap job: only reviewed facts reach the model, options shape the prompt, the answer is validated."""

import json
import time
from threading import Event
from typing import cast

import pytest
from conftest import RecordingBus
from fastapi.testclient import TestClient
from troubadour.core import config
from troubadour.lore import memory as mem
from troubadour.lore import recap
from troubadour.lore.campaign import SessionIndex, Vault
from troubadour.lore.facts import Fact, Source
from troubadour.server import deps
from troubadour.server.app import app

SID = "2026-10-22_193401-abcd"
PAGE = "2026-10-22 The Drowned Abbey"
LOCAL = "http://127.0.0.1:8765"
ALL = recap.Include()
GOOD = {
    "title": "Beneath the tide",
    "body": "You reached the abbey. Velis is sure the diamond lies beneath the tide's tongue.",
    "quote": 1,
    "moments": [{"player_id": "p1", "text": "Cracked the bell riddle"}],
    "questions": ["Who rings the second bell?"],
}


class FakeLLM:
    def __init__(self, answer=None):
        self.answer = GOOD if answer is None else answer
        self.calls: list[tuple[str, str]] = []
        self.gate: Event | None = None

    def problem(self):
        return None

    def json(self, system, user, schema, max_tokens=4000, think=False, progress=None):
        self.calls.append((system, user))
        if self.gate:
            self.gate.wait(5)
        return self.answer


def record(extra_messages=()):
    def line(i, pid, speaker, text, character=None):
        return {"id": f"m{i}", "t_start": 10.0 * i, "t_end": 10.0 * i + 5, "speaker": speaker, "player_id": pid,
                "character": character, "text": text}  # fmt: skip

    return {
        "session": {"id": SID, "started_at": 0, "present_player_ids": ["p1", "p2", "gm"]},
        "players": [
            {"id": "gm", "name": "Nora", "is_gm": True, "character": None},
            {"id": "p1", "name": "Sam", "is_gm": False, "character": "Velis"},
            {"id": "p2", "name": "Jo", "is_gm": False, "character": None},
            {"id": "p3", "name": "Absent", "is_gm": False, "character": "Ghost"},
        ],
        "messages": [
            line(1, "p1", "Sam", "The tide's tongue is the clapper of the bell, I am quite sure of it now.", "Velis"),
            line(2, "gm", "Nora", "The tide turns at the second bell and the door opens wide for all of you."),
            line(3, "p2", "Jo", "Too short to quote."),
            line(4, "p3", "Absent", "I was not at the table that night but this line is long enough to quote."),
            *extra_messages,
        ],
    }


@pytest.fixture
def vault(tmp_path):
    index = SessionIndex(ids_for={PAGE: SID}, numbers={SID: 12}, page_for={SID: PAGE})
    v = Vault(tmp_path / "campaign", lambda: index)
    v.create("Orsa Vell", "npc")
    v.add_fact(
        "Orsa Vell", Fact("The tide turns at the second bell.", "Orsa Vell", source=Source(PAGE, None, 60.0), confidence="gm")
    )
    v.add_fact("Orsa Vell", Fact("Owes Pip a favour.", "Orsa Vell", source=Source("2026-10-08 Elsewhere", None, 5.0)))
    v.add_fact("Orsa Vell", Fact("SECRET suggested fact.", "Orsa Vell", source=Source(PAGE, None, 70.0)), suggested=True)
    v.add_campaign_fact(Fact("The abbey floods nightly.", None, source=Source(PAGE, None, 30.0), confidence="theory"))
    return v


def page(vault, summary="The party reached the abbey."):
    path = vault.root / "Sessions" / f"{PAGE}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"---\nsession_id: {SID}\n---\n# {PAGE}\n\n## Last time\n{summary}\n")
    return f"Sessions/{PAGE}.md"


def make_build(vault, llm, options=None, rec=None):
    return recap.build(llm, vault, page(vault), rec or record(), options or recap.Options())


def test_only_confirmed_facts_of_this_session_reach_the_prompt(vault):
    llm = FakeLLM()
    make_build(vault, llm)
    ((system, user),) = llm.calls
    assert "The tide turns at the second bell." in user
    assert "[GM stated] Orsa Vell:" in user
    assert "[Party theory] The abbey floods nightly." in user
    assert "SECRET" not in user
    assert "Owes Pip" not in user
    assert "The party reached the abbey." in user
    assert "theories" in system
    assert "second person plural" in system


def test_nothing_reviewed_is_an_error(tmp_path):
    with pytest.raises(ValueError, match="Nothing reviewed"):
        recap.build(FakeLLM(), Vault(tmp_path / "v"), None, record(), recap.Options())


def test_options_change_the_prompt(vault):
    on, off = FakeLLM(), FakeLLM()
    make_build(vault, on)
    opts = recap.Options("bullets", 30, recap.Include(happened=False, quote=False, moments=False, questions=False))
    make_build(vault, off, opts)
    (s_on, u_on), (s_off, u_off) = on.calls[0], off.calls[0]
    assert "Quote candidates" in u_on
    assert "Players present" in u_on
    assert "Quote candidates" not in u_off
    assert "Players present" not in u_off
    assert f"at most {recap.max_words(30)} words" in s_off
    assert recap.max_words(30) == 78
    assert "bullet lines" in s_off
    assert "bullet lines" not in s_on
    assert "Do not retell the events" in s_off
    assert "quote: always -1" in s_off
    assert "moments: always an empty list" in s_off
    assert "questions: always an empty list" in s_off
    assert make_build(vault, FakeLLM(), opts)["quote"] is None


def test_quote_candidates_are_player_lines_of_six_to_twenty_five_words_of_present_players(vault):
    players = recap.present_players(record())
    assert [p["id"] for p in players] == ["p1", "p2"]  # not the GM, not the absent
    assert [m["id"] for m in recap.quote_candidates(record(), players)] == ["m1"]


def test_candidates_are_capped_and_spread(vault):
    many = [{"id": f"x{i}", "t_start": float(i), "t_end": i + 1.0, "speaker": "Sam", "player_id": "p1", "character": None,
             "text": "one two three four five six seven"} for i in range(100)]  # fmt: skip
    got = recap.quote_candidates(record(many), recap.present_players(record()))
    assert len(got) == recap.CANDIDATES_MAX
    assert got[0]["t_start"] < 20
    assert got[-1]["t_start"] > 80


def test_a_valid_answer_is_stored_with_its_quote_looked_up(vault):
    out = make_build(vault, FakeLLM())
    assert out["quote"] == {"text": record()["messages"][0]["text"], "speaker": "Velis", "player_id": "p1", "t": 10.0}
    assert out["moments"] == [{"player_id": "p1", "text": "Cracked the bell riddle"}]
    assert out["questions"] == ["Who rings the second bell?"]


@pytest.mark.parametrize("pick", [0, 2, -1, 99, "1", 1.5, True, None])
def test_a_quote_number_out_of_range_gives_no_quote(vault, pick):
    # candidate 1 is the only one; 2 and above do not exist
    assert make_build(vault, FakeLLM({**GOOD, "quote": pick}))["quote"] is None


def test_moments_for_unknown_or_absent_players_are_dropped(vault):
    bad = [
        {"player_id": "p1", "text": "x" * 100},
        {"player_id": "p1", "text": "Second for the same player"},
        {"player_id": "nobody", "text": "Invented"},
        {"player_id": "p3", "text": "Not at the table"},
        {"player_id": "gm", "text": "The GM"},
        {"player_id": "p2", "text": "  "},
        "junk",
        {"player_id": 4, "text": "x"},
    ]
    out = make_build(vault, FakeLLM({**GOOD, "moments": bad}))
    assert [m["player_id"] for m in out["moments"]] == ["p1"]
    assert len(out["moments"][0]["text"]) <= recap.MOMENT_MAX


def test_title_and_questions_are_capped_and_junk_ignored(vault):
    ans = {**GOOD, "title": "T" * 200, "questions": ["a", "b", "c", "d", 5, "q" * 300, ""]}
    out = make_build(vault, FakeLLM(ans))
    assert len(out["title"]) <= recap.TITLE_MAX
    assert out["questions"] == ["a", "b", "c"]
    assert make_build(vault, FakeLLM({**GOOD, "title": ""}))["title"] == "The Drowned Abbey"
    junk = {"title": 5, "body": GOOD["body"], "quote": "x", "moments": "no", "questions": {"a": 1}}
    out = make_build(vault, FakeLLM(junk))
    assert (out["moments"], out["questions"], out["quote"]) == ([], [], None)


def test_an_over_long_body_is_cut_at_a_sentence_under_the_cap(vault):
    sentence = "The party walked on and on. "
    body = sentence * 50  # 6 words each
    out = make_build(vault, FakeLLM({**GOOD, "body": body}), recap.Options("narrator", 15))
    cap = recap.max_words(15)
    assert len(out["body"].split()) <= cap
    assert out["body"].endswith("on.")
    assert out["body"] == (sentence * (cap // 6)).strip()


def test_a_body_without_sentence_ends_is_cut_at_the_word_cap(vault):
    out = make_build(vault, FakeLLM({**GOOD, "body": "word " * 200}), recap.Options("chronicle", 15))
    assert len(out["body"].split()) == recap.max_words(15)


def test_bullets_are_three_to_six_lines_under_the_cap(vault):
    body = "\n".join(f"* Thing number {i} happened here" for i in range(10))
    out = make_build(vault, FakeLLM({**GOOD, "body": body}), recap.Options("bullets", 120))
    assert out["body"].splitlines() == [f"- Thing number {i} happened here" for i in range(6)]
    long_lines = "\n".join(f"Thing {i} happened here and then something else followed it" for i in range(6))  # 10 words
    tight = make_build(vault, FakeLLM({**GOOD, "body": long_lines}), recap.Options("bullets", 15))
    assert len(tight["body"].splitlines()) == 3
    assert len(tight["body"].replace("- ", "").split()) <= recap.max_words(15)


def test_an_empty_body_is_an_error(vault):
    with pytest.raises(ValueError, match="empty"):
        make_build(vault, FakeLLM({}))


# ------------------------------------------------------------- the job and the endpoints


@pytest.fixture
def api(dirs, monkeypatch):
    monkeypatch.delenv("TROUBADOUR_VAULT", raising=False)
    memory = mem.Memory(deps.vault, RecordingBus(), llm=FakeLLM(), sessions_dir=lambda: config.DATA_DIR / "sessions")  # pyright: ignore[reportArgumentType]
    monkeypatch.setattr(deps, "memory", memory)
    folder = config.DATA_DIR / "sessions" / SID
    folder.mkdir(parents=True)
    (folder / "transcript.json").write_text(json.dumps(record()))
    (folder / "meta.json").write_text(json.dumps({"id": SID}))
    page(deps.vault)
    return TestClient(app, base_url=LOCAL)


BODY = {"voice": "narrator", "length_s": 45, "include": {"happened": True, "quote": True, "moments": True, "questions": False}}


def wait(api, job_id, state="done"):
    job: dict = {}
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        (job,) = [j for j in deps.memory.list_jobs() if j["id"] == job_id]
        if job["state"] == state:
            return job
        time.sleep(0.01)
    raise AssertionError(f"job never reached {state}: {job}")


def test_the_job_stores_the_recap_and_get_returns_it(api):
    assert api.get(f"/api/sessions/{SID}/recap").json() is None
    r = api.post(f"/api/sessions/{SID}/recap", json=BODY)
    assert r.status_code == 200, r.text
    assert (r.json()["kind"], r.json()["title"]) == ("recap", SID)
    wait(api, r.json()["id"])
    stored = api.get(f"/api/sessions/{SID}/recap").json()
    assert stored["title"] == "Beneath the tide"
    assert stored["questions"] == []  # switched off
    assert stored["options"] == BODY
    assert stored["quote"]["speaker"] == "Velis"
    assert stored["built_at"] > 0
    assert json.loads((config.DATA_DIR / "sessions" / SID / "recap.json").read_text())["body"] == GOOD["body"]


def test_a_second_post_while_running_is_409(api):
    gate = Event()
    cast(FakeLLM, deps.memory.llm).gate = gate
    first = api.post(f"/api/sessions/{SID}/recap", json=BODY)
    assert first.status_code == 200
    assert api.post(f"/api/sessions/{SID}/recap", json=BODY).status_code == 409
    gate.set()
    wait(api, first.json()["id"])
    assert api.post(f"/api/sessions/{SID}/recap", json=BODY).status_code == 200


def test_a_job_with_nothing_to_use_ends_in_error(api, monkeypatch):
    (deps.vault.root / "Sessions" / f"{PAGE}.md").unlink()
    job = api.post(f"/api/sessions/{SID}/recap", json=BODY).json()
    assert "Nothing reviewed" in wait(api, job["id"], "error")["message"]
    assert api.get(f"/api/sessions/{SID}/recap").json() is None


@pytest.mark.parametrize("change", [{"length_s": 14}, {"length_s": 121}, {"voice": "poem"}, {"include": {"happened": True}}])
def test_the_request_is_limited(api, change):
    assert api.post(f"/api/sessions/{SID}/recap", json={**BODY, **change}).status_code == 422


def test_unknown_sessions_are_404_and_a_down_model_is_503(api, monkeypatch):
    assert api.post("/api/sessions/2026-01-01_000000-ffff/recap", json=BODY).status_code == 404
    assert api.get("/api/sessions/2026-01-01_000000-ffff/recap").status_code in (200, 404)
    assert api.post("/api/sessions/not-an-id/recap", json=BODY).status_code == 404
    monkeypatch.setattr(deps.memory.llm, "problem", lambda: "down")
    assert api.post(f"/api/sessions/{SID}/recap", json=BODY).status_code == 503
