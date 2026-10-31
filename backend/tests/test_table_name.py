"""The table's name (the party's name for itself) on a campaign."""

import json

import pytest
from fastapi.testclient import TestClient
from troubadour.engine.state import MAIN_CAMPAIGN
from troubadour.server import deps
from troubadour.server.app import app


@pytest.fixture
def api(engine, monkeypatch):
    monkeypatch.setattr(deps, "engine", engine)
    monkeypatch.setattr(deps, "bus", engine.bus)
    return TestClient(app, base_url="http://127.0.0.1:8765")


def test_old_state_without_table_name_loads_empty(engine):
    engine._save_state()
    path = engine._state_path()
    data = json.loads(path.read_text())
    assert data["campaigns"][0]["table_name"] == ""
    del data["campaigns"][0]["table_name"]
    path.write_text(json.dumps(data))
    engine._load_state()
    assert engine.campaigns[MAIN_CAMPAIGN].table_name == ""


def test_patch_sets_clears_and_caps(api, engine):
    r = api.patch(f"/api/campaigns/{MAIN_CAMPAIGN}", json={"table_name": "  Magic Mushroom Mob "})
    assert r.status_code == 200, r.text
    assert r.json()["table_name"] == "Magic Mushroom Mob"
    assert r.json()["name"] == engine.campaigns[MAIN_CAMPAIGN].name  # name untouched
    assert engine.bus.of("campaigns.updated")[-1]["campaigns"][0]["table_name"] == "Magic Mushroom Mob"
    assert api.patch(f"/api/campaigns/{MAIN_CAMPAIGN}", json={"name": "Renamed"}).json()["table_name"] == "Magic Mushroom Mob"
    assert json.loads(engine._state_path().read_text())["campaigns"][0]["table_name"] == "Magic Mushroom Mob"
    assert api.patch(f"/api/campaigns/{MAIN_CAMPAIGN}", json={"table_name": ""}).json()["table_name"] == ""
    assert api.patch(f"/api/campaigns/{MAIN_CAMPAIGN}", json={"table_name": "x" * 61}).status_code == 422
    assert api.patch(f"/api/campaigns/{MAIN_CAMPAIGN}", json={}).status_code == 422
