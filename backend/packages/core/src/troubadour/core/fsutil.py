"""File helpers shared by every package."""

import contextlib
import os
import tempfile
import time
from pathlib import Path

WINDOWS = os.name == "nt"
REPLACE_TRIES = 10


def _replace(src: Path, dst: Path) -> None:
    """os.replace. Windows refuses a rename onto a file another writer is replacing or has open at that
    moment ("Access is denied"); the other writer is done within milliseconds, so try again briefly."""
    for attempt in range(REPLACE_TRIES):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if not WINDOWS or attempt == REPLACE_TRIES - 1:
                raise
            time.sleep(0.01 * (attempt + 1))


def write_atomic(path: Path, data: str | bytes, mode: int = 0o644) -> None:
    """Write via a temp file and rename: a reader never sees half a file, and a crash after the
    rename keeps the new bytes (the file, then the folder entry, are fsynced). The temp name is
    unique, so two writers never trample each other's half-written file. Text is UTF-8. `mode` is the final
    permission: 0o600 for a file that holds a key or token (it is created 0600 and never widened)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    tmp = Path(name)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data.encode("utf-8") if isinstance(data, str) else data)
            f.flush()
            os.fsync(f.fileno())
        tmp.chmod(mode)  # mkstemp makes it 0600; the default 0644 matches the old write_bytes + replace
        _replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    with contextlib.suppress(OSError):  # directories can't be opened for fsync everywhere
        dir_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
