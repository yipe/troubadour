"""notes_split.split_sessions against the shared vectors (Python only: the client doesn't split)."""

import json
from pathlib import Path

import pytest
from troubadour.lore.notes_split import preamble, split_sessions

VECTORS = json.loads((Path(__file__).parents[2] / "shared" / "test-vectors" / "notes-split.json").read_text())


@pytest.mark.parametrize("case", VECTORS, ids=[c["name"] for c in VECTORS])
def test_split_vectors(case):
    got = [{"n": s.n, "date": s.date, "title": s.title, "text": s.text} for s in split_sessions(case["text"])]
    assert got == case["expected"]


def test_the_text_before_the_first_heading_is_the_preamble():
    text = "Cast list\nElara - a cleric\n\nSession I:\nOne.\nSession II:\nTwo."
    assert preamble(text) == "Cast list\nElara - a cleric"
    assert preamble("Session I:\nOne.\nSession II:\nTwo.") == ""
    assert preamble("Cast list\nSession I:\nOnly one session.") == ""  # not clearly split: nothing to take it from
