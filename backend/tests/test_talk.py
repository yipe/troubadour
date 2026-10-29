"""Speech profiles and "in their words" (talk.py): counted patterns, and untrusted LLM output checked."""

import numpy as np
import pytest
from test_tts import FakeSynth, alice, api, finished  # noqa: F401 (api is a fixture)

from troubadour import config, talk
from troubadour.audio import tempo

AL, BO = "p-al", "p-bo"


def msg(pid: str, text: str, seconds: float = 2.4, **kw) -> dict:
    return {"player_id": pid, "text": text, "t_start": 0.0, "t_end": seconds, "character": None, "confidence": 0.9} | kw


def table(sessions: int = 2, lines: int = 20) -> list[dict]:
    """Al asks questions, opens with "okay" and says "you know what"; Bo narrates."""
    al = [
        "Okay you know what, I check the door for traps?",
        "Okay so can I roll stealth for that?",
        "You know what, I cast light on my staff.",
        "Okay wait, how far away is the bridge from here?",
    ]
    bo = [
        "The bridge sways over the gorge and the wind howls below it.",
        "Roll a dexterity saving throw as the planks give way under you.",
        "The goblins scatter into the trees when the horn sounds again.",
        "A cold mist rises from the river and the lanterns gutter.",
    ]
    return [
        {
            "session": {"id": f"s{s}"},
            "messages": [msg(AL, al[i % 4]) for i in range(lines)] + [msg(BO, bo[i % 4], 4.0) for i in range(lines)],
        }
        for s in range(sessions)
    ]


# ------------------------------------------------------------- counting


def test_profile_counts_how_they_talk():
    p = talk.profile(table(), AL)
    assert (p["player_id"], p["sessions"], p["lines"]) == (AL, 2, 40)
    assert p["words"] == 10 * (10 + 8 + 9 + 10)
    # 2.4 s lines minus 0.4 s of padding: ~9 words in 2 s.
    assert p["wpm"] == round(60 * p["words"] / (40 * 2.0))
    assert p["words_per_line"] == round(370 / 40, 1)
    assert (p["questions"], p["exclamations"], p["in_character"]) == (0.75, 0.0, 0.0)
    assert p["openers"] == ["okay", "you"]
    assert p["description"] is None


def test_pet_phrases_are_theirs_not_everyones():
    then = ["I attack", "we hide", "let's run", "he prays", "just sneak", "nobody shouts"]
    mine = [f"you know what, {t}" for t in then] + ["the orc runs"] * 6 + ["honestly fine"] * 2
    others = ["the orc runs away"] * 30 + ["I attack the orc"] * 10
    phrases = talk.pet_phrases(mine, others)
    assert phrases[0] == "you know what"  # not "you know" or "know what": the longer phrase covers them
    assert "you know" not in phrases
    assert not any("orc" in p or p == "the" for p in phrases)  # everyone says it
    assert "honestly" not in phrases  # twice isn't a habit


def test_function_words_are_never_a_pet_word_but_discourse_words_can_be():
    words = ["goblin", "door", "torch", "rope", "coin", "boat", "sword", "map", "horse", "bell"]
    mine = [f"{a} like {b}" for a, b in zip(words, reversed(words), strict=True)]
    mine += [f"the {w}" for w in words] + [f"okay {w}" for w in words]
    others = ["a dragon appears"] * 50
    phrases = talk.pet_phrases(mine, others, limit=20)
    assert "the" not in phrases
    assert "like" in phrases
    assert "okay" in phrases


def test_too_few_lines_is_explained():
    with pytest.raises(ValueError, match=r"Not enough of their lines yet \(8 lines"):
        talk.profile(table(sessions=1, lines=8), AL)


def test_pace_is_unknown_without_enough_timed_speech():
    records = table()
    for r in records:
        for m in r["messages"]:
            m["t_end"] = 1.0  # all shorter than MIN_PACE_S once the padding is off
    assert talk.profile(records, AL)["wpm"] is None


def test_examples_are_confident_mid_length_lines_from_every_session():
    records = [
        {
            "session": {"id": s},
            "messages": [msg(AL, f"In session {s} I swing my axe at the nearest goblin {i}") for i in range(40)]
            + [
                msg(AL, "Too short."),
                msg(AL, "I was not sure who said this line in session at all really", confidence=0.3),
                msg(AL, "This one is still provisional so it should never be an example", provisional=True),
            ],
        }
        for s in ("a", "b")
    ]
    ex = talk.examples([m | {"session": r["session"]["id"]} for r in records for m in r["messages"] if m["player_id"] == AL], [])
    assert len(ex) == talk.MAX_EXAMPLES
    assert ex[:2] == [
        "In session a I swing my axe at the nearest goblin 0",
        "In session b I swing my axe at the nearest goblin 0",
    ]
    assert not any("provisional" in e or "not sure" in e or e == "Too short." for e in ex)


# ------------------------------------------------------------- LLM output is untrusted


class LLM:
    def __init__(self, *replies):
        self.replies = list(replies)
        self.prompts: list[str] = []

    def json(self, system, user, schema, max_tokens=4000):
        self.prompts.append(user)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def test_describe_keeps_plain_short_text_only():
    prof = talk.profile(table(), AL)
    assert talk.describe(LLM({"description": "**Quick** and curious; she asks before she acts."}), "Al", prof) == (
        "Quick and curious; she asks before she acts."
    )
    assert talk.describe(LLM({"description": 42}), "Al", prof) is None
    assert talk.describe(LLM({"description": "ok"}), "Al", prof) is None
    assert talk.describe(LLM(ConnectionError("down")), "Al", prof) is None
    long = "She talks fast. " * 60
    out = talk.describe(LLM({"description": long}), "Al", prof)
    assert len(out) <= talk.DESCRIPTION_CHARS
    assert out.endswith("fast.")


def test_the_prompt_carries_the_counts_and_their_lines():
    prof = talk.profile(table(), AL)
    llm = LLM({"description": "Asks a lot of questions before acting."})
    talk.describe(llm, "Al", prof)
    assert "Pet phrases: " in llm.prompts[0]
    assert "you know what" in llm.prompts[0]
    assert "- Okay you know what, I check the door for traps?" in llm.prompts[0]


@pytest.mark.parametrize(
    ("rewritten", "why"),
    [
        ("Okay so, Marla paid the priest 30 gold, you know?", None),
        ("Okay so, Marla paid the priest 300 gold.", "the numbers changed"),
        ("Okay so, Marla paid 30 gold. Wait, 30 gold!", "the numbers changed"),  # said twice
        ("Okay so, the priest got 30.", "names changed (Marla)"),
        ("Okay so, Marla and Elara paid the priest 30 gold.", "names changed (Elara)"),  # invented
        ("", "it was empty"),
        (
            "Marla paid 30 gold, you know what I mean, honestly, it was a lot, like a whole lot of it.",
            "characters for a text of 30",
        ),
    ],
)
def test_problem_says_why_a_rewrite_is_refused(rewritten, why):
    found = talk.problem("Marla paid the priest 30 gold.", rewritten, ["Marla", "Elara"])
    assert found == why if why is None else why in found


def test_their_own_name_may_become_i():
    assert talk.problem("Dana searched the crates.", "Okay so I searched the crates.", ["Dana"], own=["Dana"]) is None
    assert talk.problem("Dana searched the crates.", "Okay so I searched the crates.", ["Dana"]) is not None


def test_restyle_retries_with_the_reason_and_keeps_the_original_when_it_cant():
    llm = LLM(
        {"text": "Okay so the party crossed the old bridge."},
        {"text": "Okay, Marla paid 3000 gold."},  # wrong number: asked again, with the reason
        {"text": "Okay so Marla paid 30 gold."},
        {"text": "Elara stole his old axe."},  # an invented name, twice: the original stays
        {"text": "Elara stole his old axe."},
    )
    steps = []
    text = "The party crossed the old bridge.\n\nWhat happened.\n\nMarla paid 30 gold.\n\nThe dwarf lost his axe."
    out, kept = talk.restyle(
        llm, "Al", talk.profile(table(), AL), text, ["Marla", "Elara"], progress=lambda d, t: steps.append((d, t))
    )
    assert out.split("\n\n") == [
        "Okay so the party crossed the old bridge.",
        "What happened.",  # a heading: read as written, no LLM call
        "Okay so Marla paid 30 gold.",
        "The dwarf lost his axe.",
    ]
    assert kept == 1
    assert "Your last rewrite was not used: the numbers changed" in llm.prompts[2]
    assert "Your last rewrite was not used" not in llm.prompts[1]
    assert steps == [(0, 4), (1, 4), (2, 4), (3, 4), (4, 4)]


def test_restyle_with_the_llm_down_asks_once_and_keeps_every_word():
    llm = LLM(ConnectionError("down"))
    text = "The party crossed the old bridge.\n\nThe dwarf lost his axe."
    assert talk.restyle(llm, "Al", talk.profile(table(), AL), text, []) == (text, 2)
    assert len(llm.prompts) == 1


def test_pet_phrases_merge_only_what_is_said_together():
    verbs, who = ("hide", "run", "pray", "sneak", "swim", "climb"), ("him", "her", "it", "them", "you", "elves")
    mine = [f"okay so can I {v}" for v in verbs] + [f"well I don't trust {t}" for t in who]
    others = ["the dragon sleeps"] * 40
    phrases = talk.pet_phrases(mine, others, limit=20)
    assert "okay so can i" in phrases
    assert not any("can i don't" in p for p in phrases)  # "can I" + "I don't" share one word only


def test_tempo_matches_their_pace_within_limits():
    assert talk.tempo(180, 150) == 1.15  # capped
    assert talk.tempo(150, 160) == pytest.approx(0.9375, abs=1e-3)
    assert talk.tempo(None, 150) == 1.0
    assert talk.tempo(150, None) == 1.0


def test_audio_tempo_keeps_pitch_and_changes_length():
    sr = 24000
    a = (0.3 * np.sin(2 * np.pi * 440 * np.arange(sr * 2) / sr)).astype(np.float32)
    fast = tempo(a, sr, 1.25)
    assert len(fast) == pytest.approx(len(a) / 1.25, rel=0.02)
    peak = np.argmax(np.abs(np.fft.rfft(fast))) * sr / len(fast)
    assert peak == pytest.approx(440, abs=5)
    assert tempo(a, sr, 1.0) is a


# ------------------------------------------------------------- API


def _transcripts(pid: str, other: str) -> None:
    import json

    for r in table():
        for m in r["messages"]:
            m["player_id"] = pid if m["player_id"] == AL else other
        folder = config.DATA_DIR / "sessions" / f"2026-10-0{r['session']['id'][1]}_140000-abcd"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "transcript.json").write_text(json.dumps(r))
    (config.DATA_DIR / "sessions" / "broken").mkdir()
    (config.DATA_DIR / "sessions" / "broken" / "transcript.json").write_text("{nope")


def test_api_profile_then_say_in_their_words(api, engine, monkeypatch):  # noqa: F811
    from troubadour import server

    pid = alice(api, engine)
    _transcripts(pid, "p-gm")
    r = api.post(f"/api/players/{pid}/clone/say", json={"text": "Hi.", "in_their_words": True})
    assert r.status_code == 400  # no voice yet
    assert finished(api, api.post(f"/api/players/{pid}/clone").json())["state"] == "done"
    r = api.post(f"/api/players/{pid}/clone/say", json={"text": "Hi.", "in_their_words": True})
    assert r.json()["detail"] == "Profile how Alice talks first."

    llm = LLM({"description": "Asks before acting; opens with okay."}, {"text": "Okay you know what, I open the door."})
    monkeypatch.setattr(server.memory, "llm", llm)
    j = api.post(f"/api/players/{pid}/profile").json()
    assert (j["kind"], j["player_id"]) == ("profile", pid)
    assert finished(api, j)["message"] == "Profile ready"
    prof = api.get("/api/clones").json()["profiles"][pid]
    assert prof["description"] == "Asks before acting; opens with okay."
    assert any("you know what" in p for p in prof["phrases"])

    j = api.post(f"/api/players/{pid}/clone/say", json={"text": "I open the door.", "in_their_words": True}).json()
    assert finished(api, j)["state"] == "done"
    [clip] = api.get("/api/clones").json()["clips"]
    assert clip["in_their_words"] is True
    assert clip["text"] == "Okay you know what, I open the door."
    assert clip["title"] == "I open the door."  # what was asked for
    assert engine.clones.synth.said[-1] == "Okay you know what, I open the door."

    api.patch(f"/api/players/{pid}", json={"clone_ok": False})
    assert api.get("/api/clones").json()["profiles"] == {}


def test_api_profile_needs_consent_not_an_idle_mic(api, engine):  # noqa: F811
    pid = alice(api, engine, consent=False)
    assert api.post(f"/api/players/{pid}/profile").status_code == 400
    api.patch(f"/api/players/{pid}", json={"clone_ok": True})
    engine.status = "running"  # counting lines and asking the LLM don't touch the voice model
    j = api.post(f"/api/players/{pid}/profile").json()
    assert finished(api, j)["state"] == "error"  # but there are no transcripts to count
    assert "Not enough of their lines yet" in finished(api, j)["message"]


def test_profile_needs_consent_to_be_saved(tmp_path):
    from troubadour.tts import Clones

    clones = Clones(lambda: tmp_path, allowed=lambda pid: False, synth=FakeSynth())
    with pytest.raises(ValueError, match="off for this player"):
        clones.save_profile("p1", {"player_id": "p1"})
    assert clones.profiles() == {}
