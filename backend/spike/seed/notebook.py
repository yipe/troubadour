"""The saved notebook of the latest session (S12): two kept facts, one dismissed, one pin.

The items point at real lines of that session, so the review page can anchor them. Written by hand in the
engine's notebook.json shape (the seed may not import the engine).
"""

import json

from troubadour.core.fsutil import write_atomic

from .common import SeedContext


def _item(n: int, kind: str, text: str, line: dict, who: dict | None, status: str, **extra) -> dict:
    return {
        "id": f"n{n:02d}",
        "kind": kind,
        "text": text,
        "old": None,
        "about": None,
        "entry_type": None,
        "said_by": who,
        "t": line["t_start"],
        "line_id": line["id"],
        "confidence": None,
        "count": None,
        "status": status,
    } | extra


def seed(ctx: SeedContext) -> None:
    session = ctx.sessions[-1]
    lines = [m for m in session.record["messages"] if not m["provisional"]]
    players = {p.voice_id: p for p in ctx.players}
    speakers = [m for m in lines if m["voice_id"] in players]
    first, second, third = speakers[len(speakers) // 4], speakers[len(speakers) // 2], speakers[3 * len(speakers) // 4]

    def who(line: dict) -> dict:
        player = players[line["voice_id"]]
        return {"name": player.name, "player_id": player.id}

    notebook = {
        "session_id": session.id,
        "items": [
            _item(
                1, "fact", "The tide gate under the abbey only opens at low water.", first, who(first), "kept", confidence="gm"
            ),
            _item(2, "fact", "The harbour master keeps a second ledger.", second, who(second), "kept", confidence="theory"),
            _item(3, "fact", "The lantern was already lit when they arrived.", third, who(third), "dismissed", confidence="once"),
        ],
        "pins": [
            {
                "id": "pin01",
                "t": second["t_start"],
                "text": "Ask about the second ledger next week.",
                "created_at": session.started_at + second["t_start"],
            }
        ],
        "updating": False,
    }
    write_atomic(ctx.data_dir / "sessions" / session.id / "notebook.json", json.dumps(notebook, ensure_ascii=False))
