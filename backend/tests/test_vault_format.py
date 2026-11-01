"""Vault format v1: the Timeline and Recap pages the cloud website reads, pinned by shared test vectors."""

import json
from pathlib import Path

import pytest
import yaml
from troubadour.cloud import overview, vault_format

VECTORS = json.loads((Path(__file__).parents[2] / "shared/test-vectors/vault-format.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", VECTORS, ids=[c["name"] for c in VECTORS])
def test_vectors(case):
    given = case["input"]
    if case["kind"] == "timeline":
        markdown = vault_format.timeline_page(given["timeline"], given["players"], given["pages"])
    else:
        names = {p["id"]: p["name"] for p in given["players"]}
        markdown = vault_format.recap_page(given["sid"], given["page"], given["recap"], names, given["include_quote"])
    assert markdown == case["markdown"]
    assert yaml.safe_load(markdown.split("---\n")[1]) == case["front_matter"]


def test_the_quote_only_goes_up_with_the_transcripts():
    recap = {"title": "T", "body": "B", "quote": {"text": "a line said at the table", "speaker": "Sam"}}
    pages = {"s1": "2026-10-01 Gate"}
    kept = vault_format.generate([], [], pages, {"s1": recap}, include_quote=True)
    dropped = vault_format.generate([], [], pages, {"s1": recap}, include_quote=False)
    assert "a line said at the table" in kept["_Overview/Recaps/2026-10-01 Gate.md"]
    assert "a line said at the table" not in dropped["_Overview/Recaps/2026-10-01 Gate.md"]


def test_a_recap_without_a_write_up_is_left_out():
    built = vault_format.generate([], [], {}, {"s1": {"title": "T", "body": "B"}}, include_quote=False)
    assert list(built) == ["_Overview/Timeline.md"]


def test_recaps_are_written_and_stale_ones_removed(tmp_path):
    root = tmp_path / "vault"
    root.mkdir()
    pages = {"s1": "2026-10-01 Gate", "s2": "2026-10-08 Abbey"}
    recaps = {sid: {"title": sid, "body": "B"} for sid in pages}
    overview.write(root, vault_format.generate([], [], pages, recaps, include_quote=False))
    assert sorted(p.name for p in (root / "_Overview/Recaps").iterdir()) == ["2026-10-01 Gate.md", "2026-10-08 Abbey.md"]

    mine = root / "_Overview/Recaps/My own notes.md"
    mine.write_text("# not generated\n", encoding="utf-8")
    changed = overview.write(root, vault_format.generate([], [], pages, {"s1": recaps["s1"]}, include_quote=False))
    assert "_Overview/Recaps/2026-10-08 Abbey.md" in changed
    assert sorted(p.name for p in (root / "_Overview/Recaps").iterdir()) == ["2026-10-01 Gate.md", "My own notes.md"]


def test_never_writes_below_recaps(tmp_path):
    root = tmp_path / "vault"
    root.mkdir()
    assert overview.write(root, {"_Overview/Recaps/deeper/x.md": "x"}) == []
    assert not (root / "_Overview/Recaps/deeper").exists()
