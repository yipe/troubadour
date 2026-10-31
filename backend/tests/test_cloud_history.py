"""Troubadour Cloud: which computer is main, backups paused while live, the attempt history, restore points.
Uses test_cloud's in-process fake of the service (httpx.MockTransport): no network."""

# The fixtures are imported from test_cloud, so each test names them as a parameter.
# ruff: noqa: F401, F811

import time

import httpx
import pytest
from test_cloud import SERVICE, FakeService, api, client, connect, noop, service, vault
from troubadour.cloud import backup as cloud_module
from troubadour.cloud.backup import AutoBackup, Cloud, CloudError
from troubadour.server import deps

DAY = 86400


def second_mac(service, tmp_path, name: str) -> Cloud:
    """Another Mac signed in to the same account."""
    mac = Cloud(
        url=SERVICE, path=lambda: tmp_path / name / "cloud.json", http=httpx.Client(transport=service.transport()), device=name
    )
    connect(mac, service)
    return mac


def edit(vault, text: str) -> None:
    (vault / "Facts.md").write_text(text)


def head_of(service) -> str:
    (v,) = service.vaults.values()
    return v["head_snapshot"]


# ---------------------------------------------------------------- device name and message


def test_device_name_falls_back_to_the_hostname(monkeypatch):
    def missing(*_a, **_k):
        raise FileNotFoundError

    monkeypatch.setattr(cloud_module.subprocess, "run", missing)
    monkeypatch.setattr(cloud_module.socket, "gethostname", lambda: "tavern-mac")
    cloud_module.device_name.cache_clear()
    try:
        assert cloud_module.device_name() == "tavern-mac"
    finally:
        cloud_module.device_name.cache_clear()


def test_the_commit_message_names_the_device(client, service, vault):
    client.device = "Studio"
    connect(client, service)
    last = client.backup("main", "The Sunken Gate", vault, noop)
    message = service.messages[head_of(service)]
    assert message == last["message"]
    assert message.startswith("Studio · ")
    assert len(message) <= 200


def test_a_long_device_name_keeps_the_message_within_the_contract(client, service, vault):
    client.device = "M" * 190
    connect(client, service)
    client.backup("main", "The Sunken Gate", vault, noop)
    assert len(service.messages[head_of(service)]) == 200


# ---------------------------------------------------------------- main device


def test_another_macs_newer_backup_makes_this_one_not_main_until_it_backs_up_again(service, vault, tmp_path):
    ours, theirs = second_mac(service, tmp_path, "Studio"), second_mac(service, tmp_path, "Laptop")
    ours.backup("main", "The Sunken Gate", vault, noop)
    assert ours.status("main")["is_main"] is True
    edit(vault, "The gate opens at dusk.\n")
    theirs.backup("main", "The Sunken Gate", vault, noop)

    ours.clock = lambda: time.monotonic() + 61  # past the 60 s reuse of the vault list
    status = ours.status("main")
    assert (status["is_main"], status["main_device"], status["device"]) == (False, "Laptop", "Studio")

    edit(vault, "The gate opens at noon.\n")
    ours.backup("main", "The Sunken Gate", vault, noop)
    status = ours.status("main")
    assert (status["is_main"], status["main_device"]) == (True, "Studio")


def test_a_head_without_a_device_is_another_mac(client, service, vault):
    connect(client, service)
    client.backup("main", "The Sunken Gate", vault, noop)
    service.messages[head_of(service)] = None
    service.vaults[next(iter(service.vaults))]["head_snapshot"] = head = "00000000-0000-4000-8000-000000000001"
    service.snapshots[head] = []
    client.clock = lambda: time.monotonic() + 61
    status = client.status("main")
    assert (status["is_main"], status["main_device"]) == (False, "another computer")


def test_the_main_check_is_reused_for_a_minute_and_skipped_when_offline(client, service, vault, monkeypatch):
    connect(client, service)
    client.backup("main", "The Sunken Gate", vault, noop)
    service.requests.clear()
    client.status("main")
    client.status("main")
    assert [r for r in service.requests if r[1].endswith("/vaults")] == [("GET", f"{SERVICE}/api/v1/vaults")]

    client.clock = lambda: time.monotonic() + 61

    def down(*_a, **_k):
        raise CloudError("network", "offline")

    monkeypatch.setattr(client, "_api", down)
    assert client.status("main")["is_main"] is True  # the last known answer

    assert client.status("main", main=False)["main_device"] == client.device


def test_a_mac_that_never_backed_up_asks_nothing(client, service):
    connect(client, service)
    service.requests.clear()
    status = client.status("main")
    assert status["is_main"] is True
    assert service.requests == []


# ---------------------------------------------------------------- pause while live


@pytest.fixture
def live_auto(client, service, vault):
    live = {"on": True}
    now = [1000.0]
    runner = AutoBackup(
        client,
        current=lambda: ("main", "The Sunken Gate", vault),
        busy=lambda: False,
        submit=lambda cid, name, root: client.backup(cid, name, root, noop),
        clock=lambda: now[0],
        is_live=lambda: live["on"],
    )
    return runner, now, live


def test_auto_backup_waits_while_live_then_runs_when_the_session_ends(live_auto, client, service):
    runner, now, live = live_auto
    connect(client, service)
    assert runner.tick() is False  # first sight of the notes
    now[0] += 130
    assert runner.tick() is False  # settled, but a session is live
    assert service.snapshots == {}
    now[0] += 3600
    assert runner.tick() is False
    live["on"] = False
    assert runner.tick() is True  # the pending backup, straight away
    assert len(service.snapshots) == 1


def test_api_status_says_paused_and_manual_backup_is_refused_while_live(api, service, monkeypatch):
    code, state = service.approve(api.post("/api/cloud/connect").json()["authorize_url"])
    api.get("/api/cloud/callback", params={"code": code, "state": state})
    assert api.get("/api/cloud").json()["paused_live"] is False
    monkeypatch.setattr(deps.engine, "status", "running")
    assert api.get("/api/cloud").json()["paused_live"] is True
    refused = api.post("/api/cloud/backup")
    assert refused.status_code == 409
    assert refused.json()["detail"] == "Backups wait until the session ends."
    assert service.snapshots == {}
    monkeypatch.setattr(deps.engine, "status", "idle")
    assert api.post("/api/cloud/backup").status_code == 200


# ---------------------------------------------------------------- history


def test_every_attempt_is_logged_failures_too(client, service, vault):
    connect(client, service)
    client.backup("main", "The Sunken Gate", vault, noop)
    service.fail_next_commit = "quota_exceeded"
    edit(vault, "Changed.\n")
    with pytest.raises(CloudError):
        client.backup("main", "The Sunken Gate", vault, noop)
    client.backup("main", "The Sunken Gate", vault, noop)
    attempts = client.history("main")
    assert [a["ok"] for a in attempts] == [True, False, True]  # newest first
    newest, middle, oldest = attempts
    assert newest["snapshot"] == head_of(service)
    assert newest["error"] is None
    assert newest["message"] == service.messages[head_of(service)]
    assert (middle["error"], middle["snapshot"]) == ("quota_exceeded", None)
    assert oldest["files"] > 0
    assert oldest["changed"] == oldest["files"]
    assert client.history("other") == []


def test_history_is_per_campaign_and_pruned_at_ninety_days(client, service, vault, monkeypatch):
    connect(client, service)
    now = time.time()
    monkeypatch.setattr(cloud_module.time, "time", lambda: now - 91 * DAY)
    client.backup("main", "The Sunken Gate", vault, noop)
    monkeypatch.setattr(cloud_module.time, "time", lambda: now - 89 * DAY)
    edit(vault, "Newer.\n")
    client.backup("main", "The Sunken Gate", vault, noop)
    monkeypatch.setattr(cloud_module.time, "time", lambda: now)
    assert len(client.history("main")) == 1  # the 91-day-old one is hidden
    edit(vault, "Newest.\n")
    client.backup("main", "The Sunken Gate", vault, noop)
    stored = client._history_all()["main"]
    assert len(stored) == 2  # and dropped from the file on the next write


def test_api_history_lists_newest_first(api, service, dirs):
    from troubadour.core import config  # noqa: PLC0415

    code, state = service.approve(api.post("/api/cloud/connect").json()["authorize_url"])
    api.get("/api/cloud/callback", params={"code": code, "state": state})
    notes = config.vault_dir()
    notes.mkdir(parents=True, exist_ok=True)
    (notes / "Facts.md").write_text("One.\n")
    assert api.get("/api/cloud/history").json() == {"attempts": []}
    cid, root = deps.engine.campaign, notes
    deps.cloud.backup(cid, "x", root, noop)
    (notes / "Facts.md").write_text("Two.\n")
    deps.cloud.backup(cid, "x", root, noop)
    attempts = api.get("/api/cloud/history").json()["attempts"]
    assert len(attempts) == 2
    assert attempts[0]["at"] >= attempts[1]["at"]
    assert set(attempts[0]) == {"at", "ok", "snapshot", "files", "changed", "message", "error"}


# ---------------------------------------------------------------- restore point


def test_restore_with_a_snapshot_fetches_that_snapshot(client, service, vault, tmp_path):
    connect(client, service)
    edit(vault, "The gate opens at dawn.\n")
    client.backup("main", "The Sunken Gate", vault, noop)
    first = head_of(service)
    edit(vault, "The gate is gone.\n")
    client.backup("main", "The Sunken Gate", vault, noop)
    vault_id = next(iter(service.vaults))
    target = tmp_path / "restored"
    service.requests.clear()
    result = client.restore(vault_id, target, noop, snapshot=first)
    assert result["snapshot"] == first
    assert (target / "Facts.md").read_text() == "The gate opens at dawn.\n"
    assert ("GET", f"{SERVICE}/api/v1/vaults/{vault_id}/snapshots/{first}") in service.requests

    # Without a snapshot, the newest one comes back; on top of the old, the differing note goes to .trash.
    client.restore(vault_id, target, noop)
    assert (target / "Facts.md").read_text() == "The gate is gone.\n"
    assert list((target / ".trash").rglob("Facts.md"))


def test_api_restore_refuses_a_snapshot_id_that_is_not_an_id(api, service):
    code, state = service.approve(api.post("/api/cloud/connect").json()["authorize_url"])
    api.get("/api/cloud/callback", params={"code": code, "state": state})
    bad = api.post("/api/cloud/restore", json={"vault_id": "0" * 8 + "-" * 4 + "0" * 24, "snapshot": "../x"})
    assert bad.status_code == 422
