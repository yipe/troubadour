"""write_atomic: unique temp name, fsynced file and folder."""

import os
import stat

import pytest
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
    assert len(synced) == 2
    assert stat.S_ISREG(synced[0])
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
