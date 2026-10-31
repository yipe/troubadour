"""Player classes: the SRD's twelve built in, plus the ones the user adds (an artificer, a homebrew class).

Built-ins carry no colour: the client uses its shared token colour. Custom classes live in
`DATA_DIR/classes.json` (`{"classes": [{"id", "label", "color"}]}`), never in the repo.
"""

import json
import logging
import re

from troubadour.core import config
from troubadour.core.fsutil import write_atomic

log = logging.getLogger(__name__)

BUILTIN = (
    "barbarian",
    "bard",
    "cleric",
    "druid",
    "fighter",
    "monk",
    "paladin",
    "ranger",
    "rogue",
    "sorcerer",
    "warlock",
    "wizard",
)
MAX_CUSTOM = 50
MAX_LABEL = 40
COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


def custom_path():
    """Resolved per call so tests can redirect DATA_DIR."""
    return config.DATA_DIR / "classes.json"


def _builtins() -> list[dict]:
    return [{"id": c, "label": c.capitalize(), "color": None, "builtin": True} for c in BUILTIN]


def _load_custom() -> list[dict]:
    path = custom_path()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))["classes"]
    except FileNotFoundError:
        return []
    except (OSError, ValueError, KeyError, TypeError):
        log.warning("ignoring unreadable %s", path)
        return []
    out = []
    for c in raw if isinstance(raw, list) else []:
        if (
            isinstance(c, dict)
            and isinstance(c.get("id"), str)
            and isinstance(c.get("label"), str)
            and isinstance(c.get("color"), str)
            and COLOR.match(c["color"])
            and c["id"] not in BUILTIN
        ):
            out.append({"id": c["id"], "label": c["label"], "color": c["color"], "builtin": False})
    return out


def _save(custom: list[dict]) -> None:
    classes = [{k: c[k] for k in ("id", "label", "color")} for c in custom]
    write_atomic(custom_path(), json.dumps({"classes": classes}, indent=2))


def all_classes() -> list[dict]:
    return _builtins() + _load_custom()


def known(class_id: str) -> bool:
    return class_id in BUILTIN or any(c["id"] == class_id for c in _load_custom())


def _label(label: str) -> str:
    label = label.strip()
    if not 1 <= len(label) <= MAX_LABEL:
        raise ValueError(f"A class name is 1 to {MAX_LABEL} characters.")
    return label


def _color(color: str) -> str:
    if not COLOR.match(color):
        raise ValueError("A class colour is a hex like #8c6040.")
    return color


def _slug(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")


def add(label: str, color: str) -> dict:
    label, color = _label(label), _color(color)
    custom = _load_custom()
    class_id = _slug(label)
    if not class_id:
        raise ValueError("A class name needs a letter or a digit.")
    if class_id in BUILTIN or any(c["id"] == class_id for c in custom):
        raise ValueError("There's already a class with that name.")
    if len(custom) >= MAX_CUSTOM:
        raise ValueError(f"At most {MAX_CUSTOM} custom classes.")
    entry = {"id": class_id, "label": label, "color": color, "builtin": False}
    _save([*custom, entry])
    return entry


def _find(custom: list[dict], class_id: str) -> dict:
    if class_id in BUILTIN:
        raise ValueError("The built-in classes can't be changed.")
    for c in custom:
        if c["id"] == class_id:
            return c
    raise KeyError(class_id)


def update(class_id: str, label: str | None = None, color: str | None = None) -> dict:
    """The id stays put when the label changes: players keep pointing at it."""
    custom = _load_custom()
    entry = _find(custom, class_id)
    if label is not None:
        entry["label"] = _label(label)
    if color is not None:
        entry["color"] = _color(color)
    _save(custom)
    return entry


def remove(class_id: str) -> None:
    custom = _load_custom()
    entry = _find(custom, class_id)
    _save([c for c in custom if c is not entry])
