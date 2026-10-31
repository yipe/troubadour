"""D&D 5e vocabulary the spelling cleanup knows besides the campaign glossary.

Only names speech-to-text tends to mangle are worth listing: multi-syllable spell and
creature names, conditions, classes. Ordinary English words ("Shield", "Light") are left out
on purpose: the cleanup must never "fix" everyday speech.
"""

import json
import shutil
import threading
import time
from pathlib import Path

from troubadour.core import config
from troubadour.core.fsutil import write_atomic

from .campaign import TYPES, everyday

SRD_PATH = Path(__file__).with_name("srd_terms.json")


def builtin() -> list[tuple[str, str]]:
    """The SRD's names (CC-BY-4.0, shipped with Troubadour; see srd_terms.json for attribution)."""
    try:
        return [(n, k) for n, k in json.loads(SRD_PATH.read_text())["terms"]]
    except (OSError, ValueError, KeyError):
        return []


MAX_NAME = 60
MAX_CUSTOM = 5000


def generated_path() -> Path:
    """An optional, larger local list in the same shape as srd_terms.json
    (`{"terms": [[name, type], ...]}`). It lives in data/, is never committed and is never written."""
    return config.DATA_DIR / "dnd_terms.json"


def custom_path() -> Path:
    """The terms the user added in Settings; the only term file the app writes."""
    return config.DATA_DIR / "custom_terms.json"


class TermsFileError(ValueError):
    """The user's term list could not be read. The message says where the copy was kept."""


def _entries(data) -> tuple[list[tuple[str, str]], int]:
    """(good pairs, number of bad entries). Raises ValueError when the file is not `{"terms": [...]}`."""
    rows = data["terms"] if isinstance(data, dict) else None
    if not isinstance(rows, list):
        raise ValueError("no terms list")
    good = [
        (row[0], row[1])
        for row in rows
        if isinstance(row, (list, tuple)) and len(row) == 2 and all(isinstance(x, str) for x in row)
    ]
    return good, len(rows) - len(good)


def _read(path: Path) -> list[tuple[str, str]]:
    """Lenient, for lookups: a missing or broken file is an empty list. Never use this before a write."""
    try:
        return _entries(json.loads(path.read_text()))[0]
    except (OSError, ValueError):
        return []


def _stamped(path: Path, label: str) -> Path:
    return path.with_name(f"{path.stem}.{label}-{time.strftime('%Y%m%d-%H%M%S')}{path.suffix}")


def _read_for_write(path: Path) -> list[tuple[str, str]]:
    """Strict, for read-modify-write. A file that does not parse is renamed aside (never treated as empty, so
    the next write cannot wipe it) and the error raised; entries that are not (name, type) pairs are skipped,
    with the original kept beside the file since the rewrite drops them."""
    try:
        text = path.read_text()
    except FileNotFoundError:
        return []
    except OSError as e:
        raise TermsFileError(f"Couldn't read your term list ({e.strerror or type(e).__name__}); nothing was changed.") from e
    try:
        pairs, bad = _entries(json.loads(text))
    except ValueError:  # includes JSONDecodeError
        aside = _stamped(path, "corrupt")
        path.replace(aside)
        raise TermsFileError(
            f"Your added terms file couldn't be read. A copy is kept as {aside.name} in the data folder; nothing was lost. Add the terms again."
        ) from None
    if bad:
        shutil.copy2(path, _stamped(path, "skipped"))
    return pairs


def local() -> list[tuple[str, str]]:
    """The optional local list, read-only."""
    return _read(generated_path())


def custom() -> list[tuple[str, str]]:
    """The user's own terms."""
    return _read(custom_path())


_CACHE: tuple[tuple, list[tuple[str, str]]] | None = None


def _stamp(path: Path) -> tuple[int, int] | None:
    try:
        st = path.stat()
    except OSError:
        return None
    return st.st_mtime_ns, st.st_size


def terms() -> list[tuple[str, str]]:
    """(name, type) pairs in the glossary's types: the user's own, then the local list, then the
    built-in names. A name in more than one list (any case) comes from the first."""
    global _CACHE
    key = (generated_path(), _stamp(generated_path()), custom_path(), _stamp(custom_path()))
    if _CACHE is None or _CACHE[0] != key:
        merged: dict[str, tuple[str, str]] = {}
        for pair in custom() + local() + builtin():
            merged.setdefault(pair[0].casefold(), pair)
        _CACHE = (key, list(merged.values()))
    return _CACHE[1]


def _problem(name: str, kind: str, known: set[str]) -> str | None:
    if not name:
        return "empty name"
    if len(name) > MAX_NAME:
        return f"longer than {MAX_NAME} characters"
    if not name.isprintable() or "/" in name or "\\" in name:
        return "contains characters a name cannot have"
    if kind not in TYPES:
        return f"unknown type {kind!r}"
    if name.casefold() in known:
        return "already in the list"
    if " " not in name and everyday(name):
        return "an everyday word: the spelling cleanup never rewrites those"
    return None


_LOCK = threading.Lock()  # read-modify-write of custom_terms.json: two requests must not overwrite each other


def add_custom(pairs: list[tuple[str, str]]) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    """Add the user's own terms. Returns (added, [(name, reason) skipped]). Raises TermsFileError (the file was
    set aside) when the user's list can't be read."""
    with _LOCK:
        return _add_custom(pairs)


def _add_custom(pairs: list[tuple[str, str]]) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    mine = _read_for_write(custom_path())
    known = {n.casefold() for n, _ in terms()}
    added: list[tuple[str, str]] = []
    skipped: list[tuple[str, str]] = []
    for raw, kind in pairs:
        name = " ".join(raw.split())
        why = _problem(name, kind, known)
        if why is None and len(mine) + len(added) >= MAX_CUSTOM:
            why = f"the limit of {MAX_CUSTOM} added terms is reached"
        if why:
            skipped.append((name or raw[:MAX_NAME], why))
            continue
        known.add(name.casefold())
        added.append((name, kind))
    if added:
        write_atomic(custom_path(), json.dumps({"terms": [list(p) for p in mine + added]}, indent=1))
    return added, skipped


def remove_custom(name: str) -> None:
    """Drop one of the user's own terms. KeyError when it is not one; TermsFileError as for `add_custom`."""
    with _LOCK:
        _remove_custom(name)


def _remove_custom(name: str) -> None:
    mine = _read_for_write(custom_path())
    kept = [(n, k) for n, k in mine if n.casefold() != name.casefold()]
    if len(kept) == len(mine):
        raise KeyError(name)
    write_atomic(custom_path(), json.dumps({"terms": [list(p) for p in kept]}, indent=1))
