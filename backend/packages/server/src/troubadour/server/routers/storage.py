"""Disk usage of the data dir, for Settings → Storage."""

import os
import threading
import time
from pathlib import Path

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from troubadour.core import config
from troubadour.server import deps

router = APIRouter()

CACHE_SECONDS = 60


class StorageUsage(BaseModel):
    root: str  # the data dir, with ~ for the home directory
    recordings: int  # bytes
    voices: int
    notes: int
    other: int


_lock = threading.Lock()
_cache: tuple[float, tuple[Path, Path], StorageUsage] | None = None


def _now() -> float:
    return time.monotonic()


def _tree_files(top: Path, skip: Path | None = None):
    """(path, size) of every regular file under `top`. Symlinks (files or folders) are skipped, so the walk
    never leaves the tree; `skip` is a folder counted elsewhere."""
    stack = [top]
    while stack:
        folder = stack.pop()
        try:
            entries = list(os.scandir(folder))
        except OSError:
            continue
        for e in entries:
            try:
                if e.is_symlink():
                    continue
                if e.is_dir(follow_symlinks=False):
                    if skip is None or Path(e.path) != skip:
                        stack.append(Path(e.path))
                elif e.is_file(follow_symlinks=False):
                    yield Path(e.path), e.stat(follow_symlinks=False).st_size
            except OSError:
                continue


def _shown(root: Path) -> str:
    try:
        return "~/" + root.relative_to(Path.home()).as_posix() if root != Path.home() else "~"
    except ValueError:
        return str(root)


def measure(data: Path, vault: Path) -> StorageUsage:
    recordings = voices = notes = other = 0
    # A vault inside the data dir is counted as notes only, so the data walk skips it.
    in_data = vault.is_relative_to(data)
    for _, size in _tree_files(vault):
        notes += size
    for path, size in _tree_files(data, skip=vault if in_data else None):
        parts = path.relative_to(data).parts
        if parts[0] == "sessions" and path.suffix.lower() == ".wav":
            recordings += size
        elif parts[0] in ("voices", "clones"):
            voices += size
        else:
            other += size
    return StorageUsage(root=_shown(data), recordings=recordings, voices=voices, notes=notes, other=other)


@router.get("/api/storage", response_model=StorageUsage)
async def storage() -> StorageUsage:
    """Bytes by bucket. The walk runs off the event loop and its answer is reused for a minute."""
    global _cache
    data, vault = config.DATA_DIR, deps.engine.vault_dir()
    with _lock:
        if _cache and _cache[1] == (data, vault) and _now() - _cache[0] < CACHE_SECONDS:
            return _cache[2]
    usage = await run_in_threadpool(measure, data, vault)
    with _lock:
        _cache = (_now(), (data, vault), usage)
    return usage
