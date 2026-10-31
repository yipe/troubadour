"""Classes: the SRD built-ins, the user's own, and a player's class and colour override."""

import json
import re
from pathlib import Path

import pytest
from conftest import RecordingBus
from test_server import client  # noqa: F401  (fixture: an API client on a fresh engine and data dir)
from troubadour.core import classes, config
from troubadour.core.transcript import build
from troubadour.engine import Engine, migrate_state

REPO = Path(__file__).resolve().parents[2]


@pytest.fixture
def data(dirs):
    return dirs[0]


def test_builtins_come_first_in_order(data):
    ids = [c["id"] for c in classes.all_classes()]
    assert ids == list(classes.BUILTIN)
    first = classes.all_classes()[0]
    assert first == {"id": "barbarian", "label": "Barbarian", "color": None, "builtin": True}


def test_custom_class_round_trips_through_the_file(data):
    made = classes.add("  Tinkerer ", "#8C6040")
    assert made == {"id": "tinkerer", "label": "Tinkerer", "color": "#8C6040", "builtin": False}
    assert json.loads((data / "classes.json").read_text()) == {
        "classes": [{"id": "tinkerer", "label": "Tinkerer", "color": "#8C6040"}]
    }
    assert classes.all_classes()[-1] == made
    classes.update("tinkerer", label="Gadgeteer")
    assert classes.all_classes()[-1]["label"] == "Gadgeteer"
    assert classes.all_classes()[-1]["id"] == "tinkerer"  # players keep pointing at it
    classes.remove("tinkerer")
    assert len(classes.all_classes()) == len(classes.BUILTIN)


@pytest.mark.parametrize("text", ["{not json", '{"classes": 3}', "[]"])
def test_broken_file_reads_as_no_custom_classes(data, text):
    data.mkdir(parents=True, exist_ok=True)
    (data / "classes.json").write_text(text)
    assert [c["id"] for c in classes.all_classes()] == list(classes.BUILTIN)


def test_builtins_match_the_shared_tokens():
    ts = (REPO / "web/packages/tokens/src/classes.ts").read_text()
    names = re.search(r"CLASS_NAMES = \[(.*?)\]", ts, re.S)
    assert names
    assert tuple(re.findall(r'"(\w+)"', names.group(1))) == classes.BUILTIN


# ------------------------------------------------------------- the API


def test_class_api_round_trip(client):  # noqa: F811
    assert [c["id"] for c in client.get("/api/classes").json()][:2] == ["barbarian", "bard"]
    r = client.post("/api/classes", json={"label": "Tinkerer", "color": "#8c6040"})
    assert r.status_code == 201
    assert r.json()["id"] == "tinkerer"
    r = client.patch("/api/classes/tinkerer", json={"color": "#112233"})
    assert r.json()["color"] == "#112233"
    assert client.delete("/api/classes/tinkerer").status_code == 204
    assert client.delete("/api/classes/tinkerer").status_code == 404


@pytest.mark.parametrize(
    "body",
    [
        {"label": "", "color": "#8c6040"},
        {"label": "x" * 41, "color": "#8c6040"},
        {"label": "Tinkerer", "color": "red"},
        {"label": "Tinkerer", "color": "#abc"},
    ],
)
def test_class_input_validation(client, body):  # noqa: F811
    assert client.post("/api/classes", json=body).status_code == 422  # pydantic, like every other input


def test_duplicate_builtin_and_limit_are_rejected(client):  # noqa: F811
    assert client.post("/api/classes", json={"label": "Tinkerer", "color": "#8c6040"}).status_code == 201
    assert client.post("/api/classes", json={"label": "tinkerer", "color": "#8c6040"}).status_code == 400
    assert client.post("/api/classes", json={"label": "Bard", "color": "#8c6040"}).status_code == 400
    assert client.post("/api/classes", json={"label": "!!!", "color": "#8c6040"}).status_code == 400
    for i in range(classes.MAX_CUSTOM - 1):
        assert client.post("/api/classes", json={"label": f"Class {i}", "color": "#8c6040"}).status_code == 201
    assert client.post("/api/classes", json={"label": "One too many", "color": "#8c6040"}).status_code == 400


def test_builtins_cannot_be_changed_or_removed(client):  # noqa: F811
    assert client.patch("/api/classes/bard", json={"color": "#112233"}).status_code == 400
    assert client.delete("/api/classes/bard").status_code == 400


def test_player_class_and_color_override(client):  # noqa: F811
    p = client.post("/api/players", json={"name": "Alice"}).json()
    assert p["color"] is None
    assert p["dnd_class"] is None
    client.post("/api/classes", json={"label": "Tinkerer", "color": "#8c6040"})
    url = f"/api/players/{p['id']}"
    assert client.patch(url, json={"dnd_class": "tinkerer"}).json()["dnd_class"] == "tinkerer"
    assert client.patch(url, json={"dnd_class": "bard"}).json()["dnd_class"] == "bard"
    assert client.patch(url, json={"dnd_class": "nope"}).status_code == 400
    assert client.patch(url, json={"color": "#00ff00"}).json()["color"] == "#00ff00"
    cleared = client.patch(url, json={"color": None}).json()
    assert cleared["color"] is None
    assert cleared["dnd_class"] == "bard"
    assert client.patch(url, json={"dnd_class": None}).json()["dnd_class"] is None


def test_deleting_a_class_players_use_is_allowed(client):  # noqa: F811
    client.post("/api/classes", json={"label": "Tinkerer", "color": "#8c6040"})
    p = client.post("/api/players", json={"name": "Alice"}).json()
    client.patch(f"/api/players/{p['id']}", json={"dnd_class": "tinkerer"})
    assert client.delete("/api/classes/tinkerer").status_code == 204
    again = next(x for x in client.get("/api/state").json()["players"] if x["id"] == p["id"])
    assert again["dnd_class"] == "tinkerer"  # kept; the UI says "unknown class"


# ------------------------------------------------------------- state and records


def test_migration_keeps_every_existing_color():
    v1 = {
        "players": [{"id": "p1", "name": "Nora", "color": "#f59e0b"}, {"id": "p2", "name": "Jun", "color": "#10b981"}],
        "voices": [],
    }
    assert [p["color"] for p in migrate_state(v1)["players"]] == ["#f59e0b", "#10b981"]
    v2 = migrate_state(v1)
    assert migrate_state(v2) == v2  # idempotent


def test_saved_colors_load_and_new_players_have_none(dirs):
    state = {
        "version": 2,
        "campaign": "main",
        "campaigns": [{"id": "main", "name": "M", "roster": [{"player_id": "p1", "character": "", "is_gm": False}], "left": []}],
        "players": [{"id": "p1", "name": "Nora", "avatar": None, "color": "#f59e0b", "trained": False, "clone_ok": False}],
        "voices": [],
        "next_label": 1,
    }
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    (config.DATA_DIR / "state.json").write_text(json.dumps(state))
    eng = Engine(RecordingBus())
    assert eng.players["p1"].color == "#f59e0b"
    assert eng.players["p1"].dnd_class is None
    assert eng.add_player("Jun")["color"] is None


def test_records_carry_class_and_color():
    players = [{"id": "p1", "name": "Nora", "character": "", "is_gm": True, "color": None, "dnd_class": "bard"}]
    rec = build({"id": "x", "started_at": 1, "source": None, "duration_s": 0}, players, [], [])
    assert rec["players"][0]["dnd_class"] == "bard"
    assert rec["players"][0]["color"] is None
