import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_package_layers_hold():
    """server -> engine -> cloud -> lore | sound -> core: import-linter fails on any upward import."""
    done = subprocess.run(
        [sys.executable, "-m", "importlinter.cli", "--config", str(ROOT / "pyproject.toml")],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert done.returncode == 0, done.stdout + done.stderr
