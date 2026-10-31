"""The fact bullet model: trailer grammar, history, old formats, ids. Pure; no vault, no I/O."""

import json
from pathlib import Path

import pytest
from troubadour.lore import campaign
from troubadour.lore.facts import (
    Fact,
    Source,
    fact_id,
    hms,
    parse_bullets,
    parse_hms,
    parse_trailer,
    render_bullets,
)

VECTORS = Path(__file__).resolve().parents[2] / "shared" / "test-vectors" / "hms.json"
PAGE = "2026-10-22 The Drowned Abbey"
IDS = {PAGE: "s12", "2026-10-08 Debts and Riddles": "s10"}
NUMBERS = {"s12": 12, "s10": 10}
PAGES = {"s12": PAGE, "s10": "2026-10-08 Debts and Riddles"}


def roundtrip(lines: list[str], **kw) -> list[str]:
    return render_bullets(parse_bullets(lines, "Orsa Vell", IDS), NUMBERS, PAGES)


@pytest.mark.parametrize(("seconds", "text"), json.loads(VECTORS.read_text()))
def test_hms_vectors(seconds, text):
    assert hms(seconds) == text


@pytest.mark.parametrize("s", ["", "abc", "1", "1:60", "1:2:3:4", "-1:00", "1:xx"])
def test_parse_hms_rejects(s):
    assert parse_hms(s) is None


def test_parse_hms_inverse():
    assert parse_hms("1:38:02") == 5882
    assert parse_hms("38:02") == 2282


def test_trailer_link_only():
    text, src, who, conf = parse_trailer("Owes a favour. ([[Session 12]])")
    assert (text, who, conf) == ("Owes a favour.", None, None)
    assert src == Source("Session 12", None, None, None)


def test_trailer_link_with_time_and_label():
    _, src, _, _ = parse_trailer(f"x ([[{PAGE}#1:38:02|S12 1:38]])")
    assert src == Source(PAGE, None, 5882.0, "S12 1:38")


def test_trailer_speaker_and_confidence_with_link():
    text, src, who, conf = parse_trailer(f"The tide turns. ([[{PAGE}#1:38:02|S12 1:38]] · Orsa Vell · GM stated)")
    assert (text, who, conf) == ("The tide turns.", "Orsa Vell", "gm")
    assert src
    assert src.t == 5882


def test_trailer_link_and_confidence_only():
    assert parse_trailer("A. ([[P]] · Party theory)")[1:] == (Source("P"), None, "theory")


def test_trailer_link_and_speaker_only():
    assert parse_trailer("A. ([[P]] · Pip)")[1:] == (Source("P"), "Pip", None)


def test_trailer_without_link():
    assert parse_trailer("A. (Pip · Heard once)")[1:] == (None, "Pip", "once")
    assert parse_trailer("A. (GM stated)")[1:] == (None, None, "gm")


def test_unknown_label_stays_in_speaker():
    _, _, who, conf = parse_trailer("A. ([[P]] · Pip · Maybe true)")
    assert (who, conf) == ("Pip · Maybe true", None)


def test_plain_parenthetical_is_text():
    s = "The key (rusty, old) opens it."
    assert parse_trailer(s) == (s, None, None, None)
    s = "It was a rusty key (Pip)"
    assert parse_trailer(s) == (s, None, None, None)


def test_heading_link_is_not_a_trailer():
    s = "See notes ([[Page#Heading]])"
    assert parse_trailer(s)[0] == s


def test_middle_dot_and_links_in_text():
    text, src, who, conf = parse_trailer("Met [[Orsa]] · then left. ([[P#0:05|S1 0:00]] · Pip · GM stated)")
    assert text == "Met [[Orsa]] · then left."
    assert src is not None
    assert (src.session_page, who, conf) == ("P", "Pip", "gm")


def test_links_in_text_without_trailer():
    s = "[[Orsa Vell]] owes [[Pip]] gold."
    assert parse_trailer(s) == (s, None, None, None)


def test_canonical_roundtrip_spec_example():
    lines = [
        f"- The tide turns at the second bell. ([[{PAGE}#1:38:02|S12 1:38]] · Orsa Vell · GM stated)",
        f"- Orsa Vell paid Pip back. They're square. ([[{PAGE}#1:42:58|S12 1:42]] · Orsa Vell · GM stated)",
        "  - ~~Orsa Vell owes Pip 20 gold.~~ ([[2026-10-08 Debts and Riddles#0:52:10|S10 0:52]] · Pip · Heard once)",
        "- Brann swore an oath to the drowned god.",
    ]
    facts = parse_bullets(lines, "Orsa Vell", IDS)
    assert len(facts) == 3
    assert len(facts[1].history) == 1
    assert facts[0].source is not None
    assert facts[0].source.session_id == "s12"
    assert facts[1].history[0].source is not None
    assert facts[1].history[0].source.session_id == "s10"
    assert facts[1].history[0].said_by == "Pip"
    assert render_bullets(facts, NUMBERS, PAGES) == lines


def test_history_nesting_four_spaces_renders_at_two():
    lines = ["- New. ([[P]] · Pip · GM stated)", "    - ~~Old.~~ ([[P]] · Pip · Heard once)"]
    facts = parse_bullets(lines, None)
    assert [v.text for v in facts[0].history] == ["Old."]
    assert render_bullets(facts)[1] == "  - ~~Old.~~ ([[P]] · Pip · Heard once)"


def test_history_newest_first_and_multiple():
    lines = ["- C.", "  - ~~B.~~", "  - ~~A.~~ (Pip · Party theory)"]
    f = parse_bullets(lines, None)[0]
    assert [(v.text, v.confidence) for v in f.history] == [("B.", "once"), ("A.", "theory")]
    assert render_bullets([f]) == lines[:2] + ["  - ~~A.~~ (Pip · Party theory)"]


def test_struck_line_without_parent_is_kept():
    facts = parse_bullets(["  - ~~Orphan.~~ (Pip · Heard once)"], None)
    assert len(facts) == 1
    assert facts[0].history == []
    assert "Orphan." in render_bullets(facts)[0]


def test_old_formats_survive_roundtrip_exactly():
    lines = [
        "- Brann swore an oath.",
        "- Owes Kessia a favour. ([[2026-10-15 Session]])",
        "- Spoke to [[Orsa Vell]] about [[the Abbey]].",
        "- The key (rusty) opens it.",
        "- Unknown trailer ([[Page#Heading]])",
    ]
    assert roundtrip(lines) == lines


def test_old_bullet_text_and_source():
    f = parse_bullets(["- Owes Kessia a favour. ([[2026-10-15 Session]])"], "Pip")[0]
    assert f.text == "Owes Kessia a favour."
    assert f.confidence == "once"
    assert f.said_by is None
    assert f.source == Source("2026-10-15 Session", None, None, None)


def test_old_notes_roundtrip_through_campaign_parser():
    note = "# Pip\n\n## Facts\n- Owes Kessia a favour. ([[2026-10-15 Session]])\n- Likes pie.\n"
    e = campaign.parse("Pip", note)
    original = [line for line in note.splitlines() if line.startswith("- ")]
    assert len(e.facts) == 2
    assert render_bullets(e.facts) == original


def test_asterisk_bullets_and_continuation_lines():
    facts = parse_bullets(["* One", "  continued here", "+ Two"], None)
    assert [f.text for f in facts] == ["One continued here", "Two"]


def test_unknown_session_id_is_none_and_link_kept_as_parsed():
    lines = ["- A. ([[Unknown Page#0:00:10|S3 0:00]] · Pip · GM stated)"]
    f = parse_bullets(lines, None, IDS)[0]
    assert f.source is not None
    assert f.source.session_id is None
    assert render_bullets(f and [f], NUMBERS, PAGES) == lines


def test_label_computed_from_number_when_known():
    f = Fact("A.", "X", "Pip", Source(PAGE, "s12", 5882.0), "gm")
    assert render_bullets([f], NUMBERS, PAGES) == [f"- A. ([[{PAGE}#1:38:02|S12 1:38]] · Pip · GM stated)"]


def test_page_follows_session_rename():
    f = Fact("A.", None, None, Source("Old name", "s12", 60.0), "once")
    out = render_bullets([f], NUMBERS, {"s12": "New name"})[0]
    assert out == "- A. ([[New name#0:01:00|S12 0:01]] · Heard once)"


def test_confidence_only_and_speaker_only_render():
    assert render_bullets([Fact("A.", None, None, None, "theory")]) == ["- A. (Party theory)"]
    assert render_bullets([Fact("A.", None, "Pip", None, "once")]) == ["- A. (Pip · Heard once)"]


def test_replaces_suggestion():
    lines = ["- Pip owes 5 gold. → replaces: Pip owes 20 gold. ([[P]] · Pip · Heard once)"]
    f = parse_bullets(lines, None)[0]
    assert (f.text, f.replaces) == ("Pip owes 5 gold.", "Pip owes 20 gold.")
    assert render_bullets([f]) == lines


def test_id_stable_under_case_and_punctuation():
    a = Fact("The tide turns at the second bell.", "Orsa Vell")
    b = Fact("the TIDE turns, at the second bell!!", "Orsa Vell")
    assert a.id == b.id
    assert len(a.id) == 10
    assert a.id != Fact(a.text, "Pip").id
    assert a.id != Fact("Another fact.", "Orsa Vell").id
    assert fact_id(None, "x") == Fact("x").id


def test_id_ignores_trailer():
    f1 = parse_bullets(["- Same. ([[P]] · Pip · GM stated)"], "A")[0]
    f2 = parse_bullets(["- Same."], "A")[0]
    assert f1.id == f2.id


def test_non_ascii_roundtrip():
    lines = ["- Kessia dit « à bientôt » 🌊. ([[Séance 3#0:00:09|S3 0:00]] · Zoë · GM stated)"]
    f = parse_bullets(lines, "Zoë", {"Séance 3": "s3"})[0]
    assert render_bullets([f], {"s3": 3}, {"s3": "Séance 3"}) == lines


def test_long_fact_roundtrip():
    text = ("word " * 121).strip()
    assert len(text) >= 600
    lines = [f"- {text} ([[P#0:00:01|S1 0:00]] · Pip · Party theory)"]
    f = parse_bullets(lines, None, {"P": "s1"})[0]
    assert f.text == text
    assert render_bullets([f], {"s1": 1}, {"s1": "P"}) == lines
