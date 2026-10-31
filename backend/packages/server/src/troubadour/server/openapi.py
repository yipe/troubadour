"""Write the server's OpenAPI schema to a file: `python -m troubadour.server.openapi <out.json>`.

Importing `troubadour.server.app` builds the Engine, which reads and writes DATA_DIR (default: the real
~/troubador, with real players, voiceprints and recordings). So this module points the process at a
throwaway world *before* that import, and deletes it afterwards. Nothing here loads a model or contacts
an LLM.
"""

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

# The pre-rename BARD_ names are read as a fallback by config.env, so clear them too.
_SAFE_ENV = {
    "TROUBADOUR_MODELS": "0",
    "TROUBADOUR_LLM_URL": "http://127.0.0.1:9/v1",
}
_UNSET = ("TROUBADOUR_VAULT", "BARD_VAULT", "BARD_DATA", "BARD_MODELS", "BARD_LLM_URL")


def isolate(scratch: Path) -> dict[str, str]:
    """Point this process at `scratch` and return the TROUBADOUR_* values it set."""
    for name in _UNSET:
        os.environ.pop(name, None)
    env = {
        **_SAFE_ENV,
        "TROUBADOUR_DATA": str(scratch / "data"),
        "TROUBADOUR_OBSIDIAN_REGISTRY": str(scratch / "obsidian.json"),
    }
    os.environ.update(env)
    return env


def main(argv: list[str]) -> None:
    if len(argv) != 2:
        sys.exit("usage: python -m troubadour.server.openapi <out.json>")
    out = Path(argv[1])
    scratch = Path(tempfile.mkdtemp(prefix="troubadour-openapi-"))
    try:
        isolate(scratch)
        from troubadour.server.app import app  # noqa: PLC0415  (must follow isolate)

        schema = app.openapi()
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("w", encoding="utf-8") as f:
            json.dump(schema, f, sort_keys=True, indent=1)
            f.write("\n")
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


if __name__ == "__main__":
    main(sys.argv)
