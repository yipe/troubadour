"""Build a complete demo data dir (campaign "The Sunken Crown") in about a second: no models, no LLM, no network.

Usage: uv run python spike/seed_demo.py <data_dir>

Refuses (exit 2) a data dir inside ~/troubador, or a non-empty one without the `.troubadour-seed` marker.
Running again into a seeded dir replaces what the seed owns (common.OWNED) with identical bytes.
"""

import shutil
import sys
from pathlib import Path

from seed import notebook, players, sessions, vault
from seed.common import MARKER, OWNED, SeedContext


def check_target(data_dir: Path) -> str | None:
    """Why this dir must not be seeded, or None."""
    real = Path.home() / "troubador"
    if data_dir == real or real in data_dir.parents:
        return f"{data_dir} is inside {real}, which holds real data"
    if data_dir.exists() and not data_dir.is_dir():
        return f"{data_dir} is not a directory"
    if data_dir.is_dir() and any(data_dir.iterdir()) and not (data_dir / MARKER).is_file():
        return f"{data_dir} is not empty and has no {MARKER} marker"
    return None


def main(data_dir: Path) -> int:
    data_dir = data_dir.expanduser().resolve()
    problem = check_target(data_dir)
    if problem:
        print(f"seed_demo: refusing: {problem}", file=sys.stderr)
        return 2
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / MARKER).write_text("Made by backend/spike/seed_demo.py; safe to reseed.\n")
    for name in OWNED:
        path = data_dir / name
        shutil.rmtree(path) if path.is_dir() else path.unlink(missing_ok=True)
    ctx = SeedContext(data_dir=data_dir, vault_dir=data_dir / "campaign")
    for module in (players, sessions, vault, notebook):
        module.seed(ctx)
    print(f"Seeded {len(ctx.sessions)} sessions and {len(ctx.players)} players into {data_dir}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: seed_demo.py <data_dir>", file=sys.stderr)
        sys.exit(2)
    sys.exit(main(Path(sys.argv[1])))
