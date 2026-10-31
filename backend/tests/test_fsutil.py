"""write_atomic: unique temp name, fsynced file and folder."""

import os
import stat

import pytest
from conftest import FSYNCS_PER_FILE, WINDOWS, assert_mode
from troubadour.core import fsutil
from troubadour.core.fsutil import write_atomic


def test_write_atomic_never_touches_another_writers_temp_file(tmp_path):
    target = tmp_path / "state.json"
    other = tmp_path / ".state.json.tmp"  # what a second writer using a fixed name would be filling in
    other.write_text("half written")
    write_atomic(target, '{"a": 1}')
    assert target.read_text() == '{"a": 1}'
    assert other.read_text() == "half written"
    assert [p.name for p in tmp_path.iterdir() if p.name not in (target.name, other.name)] == []


def test_write_atomic_fsyncs_the_file_then_the_folder(tmp_path, monkeypatch):
    synced = []
    real = os.fsync
    monkeypatch.setattr(fsutil.os, "fsync", lambda fd: (synced.append(os.fstat(fd).st_mode), real(fd)))
    write_atomic(tmp_path / "a.txt", b"bytes")
    assert len(synced) == FSYNCS_PER_FILE
    assert stat.S_ISREG(synced[0])
    if not WINDOWS:
        assert stat.S_ISDIR(synced[1])


def test_a_failed_write_leaves_the_old_file_and_no_temp(tmp_path, monkeypatch):
    target = tmp_path / "a.txt"
    target.write_text("old")

    def boom(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr(fsutil.os, "replace", boom)
    with pytest.raises(OSError, match="disk full"):
        write_atomic(target, "new")
    assert target.read_text() == "old"
    assert [p.name for p in tmp_path.iterdir()] == ["a.txt"]


def test_write_atomic_mode_is_the_final_permission(tmp_path):
    write_atomic(tmp_path / "public.txt", "x")
    write_atomic(tmp_path / "secret.json", "x", mode=0o600)
    assert_mode(tmp_path / "public.txt", 0o644)
    assert_mode(tmp_path / "secret.json", 0o600)
    write_atomic(tmp_path / "secret.json", "y", mode=0o600)  # an overwrite keeps it private
    assert_mode(tmp_path / "secret.json", 0o600)


@pytest.mark.parametrize("windows", [True, False])
def test_a_rename_windows_refuses_for_a_moment_is_tried_again(tmp_path, monkeypatch, windows):
    real, calls = os.replace, []

    def busy_twice(src, dst):
        calls.append(dst)
        if len(calls) <= 2:
            raise PermissionError(13, "Access is denied")
        real(src, dst)

    monkeypatch.setattr(fsutil, "WINDOWS", windows)
    monkeypatch.setattr(fsutil.os, "replace", busy_twice)
    monkeypatch.setattr(fsutil.time, "sleep", lambda s: None)
    if windows:
        write_atomic(tmp_path / "q.json", "{}")
        assert (tmp_path / "q.json").read_text() == "{}"
        assert len(calls) == 3
    else:  # elsewhere a refused rename is a real error
        with pytest.raises(PermissionError):
            write_atomic(tmp_path / "q.json", "{}")
    assert not list(tmp_path.glob(".*.tmp"))
