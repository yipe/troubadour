"""The OpenAPI dump runs against a throwaway world, never the real data dir."""

import json
import os
import subprocess
import sys
from pathlib import Path

from troubadour.server import openapi


def test_dump_is_valid_json_and_touches_nothing_outside_its_temp_dirs(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    out = tmp_path / "out" / "openapi.json"
    env = {k: v for k, v in os.environ.items() if not k.startswith(("TROUBADOUR_", "BARD_"))}
    env["HOME"] = str(home)
    subprocess.run([sys.executable, "-m", "troubadour.server.openapi", str(out)], env=env, check=True, timeout=120)

    schema = json.loads(out.read_text())
    assert "/api/campaigns" in schema["paths"]
    assert "CampaignsOut" in schema["components"]["schemas"]
    assert list(home.iterdir()) == []  # no ~/troubador was created under the fake HOME


def test_isolate_points_every_path_at_the_scratch_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("TROUBADOUR_VAULT", "/real/vault")
    monkeypatch.setenv("BARD_VAULT", "/real/vault")
    # isolate() writes os.environ directly: register every key with monkeypatch so it is restored.
    for name in (*openapi._SAFE_ENV, *openapi._UNSET, "TROUBADOUR_DATA", "TROUBADOUR_OBSIDIAN_REGISTRY"):
        monkeypatch.setenv(name, os.environ.get(name, ""))
        if name not in os.environ or os.environ[name] == "":
            monkeypatch.delenv(name, raising=False)
    env = openapi.isolate(tmp_path)

    assert Path(env["TROUBADOUR_DATA"]).is_relative_to(tmp_path)
    assert Path(env["TROUBADOUR_OBSIDIAN_REGISTRY"]).is_relative_to(tmp_path)
    assert os.environ["TROUBADOUR_MODELS"] == "0"
    assert os.environ["TROUBADOUR_LLM_URL"] == "http://127.0.0.1:9/v1"
    assert "TROUBADOUR_VAULT" not in os.environ
    assert "BARD_VAULT" not in os.environ


def test_isolate_does_not_leak_into_later_tests():
    """Runs after the test above, which calls isolate(); its env must have been restored."""
    assert os.environ.get("TROUBADOUR_MODELS") != "0"
    assert "127.0.0.1:9/" not in os.environ.get("TROUBADOUR_LLM_URL", "")
