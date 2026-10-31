"""The server hands Cloud the _Overview/ builder, and it only ever writes into the open campaign's vault."""

from fastapi.testclient import TestClient
from troubadour.server import deps
from troubadour.server.app import app
from troubadour.server.routers import cloud as cloud_router


def test_backups_rebuild_the_overview_of_the_open_campaign(dirs, engine, monkeypatch, tmp_path):
    monkeypatch.setattr(deps, "engine", engine)
    TestClient(app, base_url="http://127.0.0.1:8765")  # imports every router, as the server does
    assert deps.cloud.before_scan is cloud_router.write_overview

    deps.vault.create("Orsa Vell", "npc", description="Captain of the Gull.")
    cloud_router.write_overview(deps.vault.root)
    assert (deps.vault.root / "_Overview" / "Campaign overview.md").is_file()

    other = tmp_path / "other-vault"
    other.mkdir()
    cloud_router.write_overview(other)
    assert not (other / "_Overview").exists()
