import pytest
from troubadour.engine import core


def test_mic_test_on_a_missing_device_names_it(engine, monkeypatch):
    engine.status = "idle"
    monkeypatch.setattr(core, "list_mics", lambda: [{"name": "Built-in", "default": True}])
    started = []
    monkeypatch.setattr(core.MicSource, "start", lambda *a, **k: started.append(1))
    with pytest.raises(ValueError, match="Yeti 2.*isn't connected"):
        engine.mic_test("Yeti 2")
    assert started == []
