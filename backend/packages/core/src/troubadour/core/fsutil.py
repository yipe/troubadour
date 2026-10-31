"""File helpers shared by every package."""

import contextlib
import os
import tempfile
from pathlib import Path


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
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    with contextlib.suppress(OSError):  # directories can't be opened for fsync everywhere
        dir_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
