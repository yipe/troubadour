"""A vault or data dir exported in the developer's shell must never reach the suite."""

import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent


def test_a_vault_in_the_shell_environment_is_never_written(tmp_path):
    vault = tmp_path / "real-vault"
    vault.mkdir()
    env = {**os.environ, "TROUBADOUR_VAULT": str(vault), "BARD_VAULT": str(vault)}
    run = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "test_overview_wiring.py", "test_review.py"],
        cwd=HERE,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert run.returncode == 0, run.stdout[-2000:]
    assert list(vault.rglob("*")) == []
