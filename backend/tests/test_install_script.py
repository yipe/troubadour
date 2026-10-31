"""install.sh preflight: refuses machines it can't serve, lists every missing tool with its fix, never installs unasked.

Runs the real script with PATH holding only stubs, so it never touches the network or this machine's tools.
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="install.sh is for macOS and Linux (install.ps1 on Windows)")

INSTALL = Path(__file__).parents[2] / "install.sh"


def stub(bin_dir: Path, name: str, body: str) -> None:
    path = bin_dir / name
    path.write_text(f"#!/bin/sh\n{body}\n")
    path.chmod(0o755)


@pytest.fixture
def bin_dir(tmp_path):
    """An Apple Silicon Mac with nothing installed."""
    d = tmp_path / "bin"
    d.mkdir()
    os.symlink("/usr/bin/dirname", d / "dirname")
    stub(d, "uname", 'case "$1" in -s) echo Darwin ;; -m) echo arm64 ;; esac')
    return d


def tools(bin_dir: Path, *names: str) -> None:
    for name in names:
        stub(bin_dir, name, "exit 0")


def node(bin_dir: Path, major: int) -> None:
    stub(bin_dir, "node", f"echo {major}")


def run(bin_dir: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["/bin/sh", str(INSTALL), *args],
        env={"PATH": str(bin_dir), "HOME": str(bin_dir.parent)},
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=30,
    )


def test_points_windows_shells_at_install_ps1(bin_dir):
    stub(bin_dir, "uname", 'case "$1" in -s) echo MINGW64_NT-10.0 ;; -m) echo x86_64 ;; esac')
    result = run(bin_dir, "--check")
    assert result.returncode == 1
    assert "install.ps1" in result.stderr


def linux(bin_dir: Path, portaudio: bool = False) -> None:
    stub(bin_dir, "uname", 'case "$1" in -s) echo Linux ;; -m) echo x86_64 ;; esac')
    libs = "libportaudio.so.2 (libc6,x86-64) => /lib/x86_64-linux-gnu/libportaudio.so.2" if portaudio else ""
    stub(bin_dir, "ldconfig", f'echo "{libs}"')


def test_linux_lists_its_packages_and_the_uv_installer(bin_dir):
    linux(bin_dir)
    tools(bin_dir, "apt-get", "corepack")
    node(bin_dir, 24)
    result = run(bin_dir, "--check")
    assert result.returncode == 1
    assert "  - libportaudio2:" in result.stderr
    assert "sudo apt-get install -y ffmpeg libportaudio2 && curl -LsSf https://astral.sh/uv/install.sh | sh" in result.stderr


def test_linux_names_packages_for_its_family(bin_dir):
    linux(bin_dir)
    tools(bin_dir, "dnf", "uv", "ffmpeg", "corepack")
    node(bin_dir, 24)
    assert "sudo dnf install -y portaudio\n" in run(bin_dir, "--check").stderr


def test_linux_without_node_says_where_to_get_a_new_enough_one(bin_dir):
    linux(bin_dir, portaudio=True)
    tools(bin_dir, "apt-get", "uv", "ffmpeg")
    result = run(bin_dir, "--check")
    assert result.returncode == 1
    assert "Install Node 24 or newer from https://nodejs.org" in result.stderr


def test_linux_check_passes_when_everything_is_there(bin_dir):
    linux(bin_dir, portaudio=True)
    tools(bin_dir, "apt-get", "uv", "ffmpeg", "corepack")
    node(bin_dir, 24)
    result = run(bin_dir, "--check")
    assert result.returncode == 0, result.stderr


def test_refuses_a_system_it_doesnt_know(bin_dir):
    stub(bin_dir, "uname", 'case "$1" in -s) echo FreeBSD ;; -m) echo amd64 ;; esac')
    result = run(bin_dir, "--check")
    assert result.returncode == 1
    assert "macOS (Apple Silicon), Linux and Windows" in result.stderr


def test_refuses_an_intel_mac(bin_dir):
    stub(bin_dir, "uname", 'case "$1" in -s) echo Darwin ;; -m) echo x86_64 ;; esac')
    stub(bin_dir, "sysctl", "echo 0")
    result = run(bin_dir, "--check")
    assert result.returncode == 1
    assert "Apple Silicon (M1 or newer)" in result.stderr


def test_tells_a_rosetta_terminal_to_switch(bin_dir):
    stub(bin_dir, "uname", 'case "$1" in -s) echo Darwin ;; -m) echo x86_64 ;; esac')
    stub(bin_dir, "sysctl", "echo 1")
    result = run(bin_dir, "--check")
    assert result.returncode == 1
    assert "Rosetta" in result.stderr


def test_lists_everything_missing_with_one_fix(bin_dir):
    tools(bin_dir, "brew")
    result = run(bin_dir, "--check")
    assert result.returncode == 1
    for tool in ("uv", "ffmpeg", "node", "corepack"):
        assert f"  - {tool}:" in result.stderr
    assert "brew install uv ffmpeg node && npm install -g corepack" in result.stderr


def test_without_homebrew_points_at_brew_sh(bin_dir):
    tools(bin_dir, "uv", "corepack")
    node(bin_dir, 24)
    result = run(bin_dir, "--check")
    assert result.returncode == 1
    assert "  - ffmpeg:" in result.stderr
    assert "https://brew.sh" in result.stderr


def test_old_node_is_reported_not_installed_over(bin_dir):
    tools(bin_dir, "brew", "uv", "ffmpeg", "corepack")
    node(bin_dir, 22)
    result = run(bin_dir, "--check")
    assert result.returncode == 1
    assert "Node 22 is too old" in result.stderr
    assert "brew install" not in result.stderr


def test_node_25_without_corepack_gets_it_from_npm(bin_dir):
    tools(bin_dir, "brew", "uv", "ffmpeg")
    node(bin_dir, 25)
    result = run(bin_dir, "--check")
    assert result.returncode == 1
    assert "Fix with:\n  npm install -g corepack\n" in result.stderr


def test_never_installs_without_a_terminal(bin_dir):
    marker = bin_dir.parent / "brew-ran"
    stub(bin_dir, "brew", f"touch {marker}")
    result = run(bin_dir)
    assert result.returncode == 1
    assert "brew install" in result.stderr
    assert not marker.exists()


def test_check_passes_when_everything_is_there(bin_dir):
    tools(bin_dir, "brew", "uv", "ffmpeg", "corepack")
    node(bin_dir, 24)
    result = run(bin_dir, "--check")
    assert result.returncode == 0, result.stderr
    assert "All prerequisites found." in result.stdout


def test_rejects_unknown_flags(bin_dir):
    result = run(bin_dir, "--frobnicate")
    assert result.returncode == 2
    assert "usage: ./install.sh" in result.stderr
