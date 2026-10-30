"""Players, voices, campaigns and state.json.

state.json is written by hand: the engine's writer is a method on a running Engine, which the seed must not import.
The shape is `STATE_VERSION` 2 (see engine `_state_data` / `_load_state`).
"""

import json

from troubadour.core.fsutil import write_atomic

from .common import CAMPAIGN_ID, CAMPAIGN_NAME, OTHER_CAMPAIGN_ID, OTHER_CAMPAIGN_NAME, PlayerSeed, SeedContext, rng

# The engine's palette (engine.live.PALETTE), repeated because the seed may not import the engine.
PALETTE = ["#f59e0b", "#10b981", "#3b82f6", "#ec4899", "#8b5cf6"]
# Each player's class (the GM has none), and a made-up custom class nobody uses yet.
CLASSES = {"p-sam": "bard", "p-jo": "druid", "p-rin": "barbarian", "p-maya": "wizard"}
CUSTOM_CLASSES = {"classes": [{"id": "tinkerer", "label": "Tinkerer", "color": "#8c6040"}]}
EMBEDDING_DIM = 256  # what the speaker embedder produces


def _voiceprint(key: str) -> list[float]:
    """A made-up unit vector. Only has to load; nothing matches against it without models."""
    r = rng("voice", key)
    v = [r.uniform(0.0, 1.0) for _ in range(EMBEDDING_DIM)]
    norm = sum(x * x for x in v) ** 0.5
    return [round(x / norm, 6) for x in v]


def seed(ctx: SeedContext) -> None:
    ctx.players = [
        PlayerSeed("p-alex", "Alex", "", True, PALETTE[0], True, "v-alex"),
        PlayerSeed("p-sam", "Sam", "Pip Tallowmere", False, PALETTE[1], True, "v-sam"),
        PlayerSeed("p-jo", "Jo", "Thessaly", False, PALETTE[2], True, "v-jo"),
        PlayerSeed("p-rin", "Rin", "Brann Coldwater", False, PALETTE[3], True, "v-rin"),
        PlayerSeed("p-maya", "Maya", "Velis Anwe", False, PALETTE[4], False, "v-maya"),
    ]
    people = [
        {
            "id": p.id,
            "name": p.name,
            "avatar": None,
            # A player with a class shows the class colour; the GM keeps a picked colour.
            "color": None if p.id in CLASSES else p.color,
            "dnd_class": CLASSES.get(p.id),
            "trained": p.trained,
            "clone_ok": False,
        }
        for p in ctx.players
    ]
    # In the library, playing only in the second campaign.
    people.append(
        {"id": "p-dee", "name": "Dee", "avatar": None, "color": "#14b8a6", "dnd_class": None, "trained": False, "clone_ok": False}
    )

    def voice(vid: str, label: str, player_id: str, character: str | None, trained: bool, seconds: float) -> dict:
        return {
            "id": vid,
            "label": label,
            "player_id": player_id,
            "character": character,
            "campaign": CAMPAIGN_ID if character else None,  # a character voice belongs to its campaign
            "seconds": seconds,
            "trained": trained,
            "vec": _voiceprint(vid),
        }

    voices = [
        voice("v-alex", "Alex", "p-alex", None, True, 60.0),
        voice("v-sam", "Sam", "p-sam", None, True, 55.0),
        voice("v-jo", "Jo", "p-jo", None, True, 52.0),
        voice("v-rin", "Rin", "p-rin", None, True, 58.0),
        voice("v-maya", "Maya", "p-maya", None, False, 310.0),  # learned from play, never trained
        voice("v-orsa", "Captain Orsa Vell", "p-alex", "Captain Orsa Vell", False, 640.0),
        voice("v-merrow", "Sister Merrow", "p-alex", "Sister Merrow", False, 410.0),
    ]
    state = {
        "version": 2,
        "campaign": CAMPAIGN_ID,
        "campaigns": [
            {
                "id": CAMPAIGN_ID,
                "name": CAMPAIGN_NAME,
                "roster": [{"player_id": p.id, "character": p.character, "is_gm": p.is_gm} for p in ctx.players],
                "left": [],
            },
            {
                "id": OTHER_CAMPAIGN_ID,
                "name": OTHER_CAMPAIGN_NAME,
                "roster": [
                    {"player_id": "p-dee", "character": "", "is_gm": True},
                    {"player_id": "p-sam", "character": "Marlow Quill", "is_gm": False},
                ],
                "left": [],
            },
        ],
        "players": people,
        "voices": voices,
        "next_label": 4,  # "Voice 3" is the unnamed voice heard in the latest session
    }
    write_atomic(ctx.data_dir / "state.json", json.dumps(state))
    write_atomic(ctx.data_dir / "classes.json", json.dumps(CUSTOM_CLASSES))
