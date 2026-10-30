"""File helpers shared by every package."""

from pathlib import Path


def write_atomic(path: Path, data: str | bytes) -> None:
    """Write via a temp file and rename: a reader never sees half a file. Text is UTF-8."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_bytes(data.encode("utf-8") if isinstance(data, str) else data)
    tmp.replace(path)
