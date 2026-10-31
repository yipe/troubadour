import json
import stat

import pytest
from troubadour.core import config, settings


def _other_whisper() -> str:
    """A menu id that isn't the default live model, on whichever backend this machine runs."""
    return next(o["id"] for o in settings.WHISPER_OPTIONS if o["id"] != config.WHISPER_MODEL)


def test_saved_models_override_the_environment(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    assert settings.current()["whisper"] == config.WHISPER_MODEL
    other = _other_whisper()
    chosen = settings.update({"whisper": other, "memory": "other/gemma"})
    assert chosen["whisper"] == other
    assert chosen["memory"] == "other/gemma"
    assert chosen["llm"] == config.LLM_MODEL
    again = settings.current()
    assert again["whisper"] == other
    assert "other/gemma" in settings.known_llms()
    assert config.LLM_MODEL in settings.known_llms()


def test_menu_labels_name_the_exact_weights():
    mlx = [o["label"] for o in settings.MLX_OPTIONS]
    assert mlx[0].startswith("Whisper large-v3-turbo · 809M params · fp16 MLX")
    assert mlx[1].startswith("Whisper large-v3 · 1.55B params · fp16 MLX")
    ct2 = {o["id"]: o["label"] for o in settings.CT2_OPTIONS}
    assert ct2["small"].startswith("Whisper small · 244M params · faster-whisper")
    assert settings.SPEAKER_LABEL.startswith("WeSpeaker ResNet34")


def test_each_machine_gets_whisper_it_can_run():
    assert config.whisper_defaults(mlx=True, nvidia=False) == (
        "mlx-community/whisper-large-v3-turbo",
        "mlx-community/whisper-large-v3-mlx",
    )
    assert config.whisper_defaults(mlx=False, nvidia=True) == ("large-v3-turbo", "large-v3")
    assert config.whisper_defaults(mlx=False, nvidia=False) == ("small", "large-v3-turbo")  # a CPU keeps up live
    menus = {True: settings.MLX_OPTIONS, False: settings.CT2_OPTIONS}
    for mlx in (True, False):
        for nvidia in (True, False):
            ids = {o["id"] for o in menus[mlx]}
            assert set(config.whisper_defaults(mlx, nvidia)) <= ids  # the defaults are on that machine's menu


def test_address_accepts_a_port_a_lan_host_or_openrouter():
    assert settings.normalize_llm_url("11434") == "http://127.0.0.1:11434/v1"
    assert settings.normalize_llm_url("10.0.0.8:1234") == "http://10.0.0.8:1234/v1"
    assert settings.normalize_llm_url("https://openrouter.ai/api/v1") == "https://openrouter.ai/api/v1"
    try:
        settings.normalize_llm_url("file:///etc/passwd")
    except ValueError:
        pass
    else:
        raise AssertionError("a file URL should be rejected")


def test_whisper_ids_must_come_from_the_menu(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    with pytest.raises(ValueError, match="listed Whisper"):
        settings.update({"whisper": "someone/else"})
    with pytest.raises(ValueError, match="listed Whisper"):
        settings.update({"whisper_improve": "x" * 10})
    assert not (tmp_path / "settings.json").exists()
    other = _other_whisper()
    assert settings.update({"whisper_improve": other})["whisper_improve"] == other


def test_the_active_whisper_id_is_accepted_even_when_off_the_menu(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "WHISPER_MODEL", "my/env-override")
    assert settings.update({"whisper": "my/env-override"})["whisper"] == "my/env-override"


def test_settings_file_is_private_and_leaves_no_temp_files(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    settings.update({"api_key": "sk-secret"})
    assert stat.S_IMODE((tmp_path / "settings.json").stat().st_mode) == 0o600
    assert [p.name for p in tmp_path.iterdir()] == ["settings.json"]


def test_a_broken_settings_file_is_kept_before_a_new_one_is_written(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    (tmp_path / "settings.json").write_text('{"api_key": "sk-secret", "llm": ')
    settings.update({"memory": "other/gemma"})
    (kept,) = tmp_path.glob("settings.corrupt-*.json")
    assert "sk-secret" in kept.read_text()
    assert json.loads((tmp_path / "settings.json").read_text())["memory"] == "other/gemma"
