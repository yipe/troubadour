"""The SRD term generator takes only SRD-flagged names, and the committed list is well-formed."""

import importlib.util
import json
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location("build_srd_terms", Path(__file__).parents[1] / "spike/build_srd_terms.py")
assert _SPEC is not None
assert _SPEC.loader is not None
build = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(build)


def _data(tmp_path: Path) -> Path:
    def put(rel: str, doc: dict) -> None:
        path = tmp_path / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(doc))

    put(
        "spells/spells-x.json",
        {
            "spell": [
                {"name": "Fireball", "srd": True},
                {"name": "Melf's Acid Arrow", "srd": "Acid Arrow", "srd52": "Acid Arrow"},
                {"name": "Homebrew Bolt"},
                {"name": "Closed Bolt", "srd": False, "srd52": False},
            ]
        },
    )
    put(
        "items.json",
        {
            "item": [
                {"name": "Acid (vial)", "srd": True},
                {"name": "+1 Wand of the War Mage", "srd": True},
                {"name": "Carpet of Flying, 3 ft. × 5 ft.", "srd52": True},
                {"name": "Vorpal Sword"},
            ]
        },
    )
    put("bestiary/bestiary-x.json", {"monster": [{"name": "Aboleth", "srd52": True}, {"name": "Tarrasque"}]})
    return tmp_path


def test_extracts_only_flagged_names_and_uses_the_srd_spelling(tmp_path):
    assert build.extract(_data(tmp_path)) == [
        ("Aboleth", "creature"),
        ("Acid", "item"),
        ("Acid Arrow", "spell"),
        ("Carpet of Flying", "item"),
        ("Fireball", "spell"),
    ]


def test_render_round_trips(tmp_path):
    terms = build.extract(_data(tmp_path))
    doc = json.loads(build.render(terms))
    assert doc["terms"] == [list(t) for t in terms]
    assert "Creative Commons Attribution 4.0" in doc["license"]


def test_committed_list_is_clean():
    doc = json.loads(build.OUT.read_text())
    terms = [tuple(t) for t in doc["terms"]]
    assert terms == sorted(set(terms), key=lambda t: (t[0].casefold(), t[0], t[1]))
    assert {kind for _, kind in terms} <= {"creature", "spell", "item", "npc", "term"}
    assert all(0 < len(name) <= build.MAX_NAME and name == build.clean(name) for name, _ in terms)
