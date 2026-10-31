"""state.json: the campaigns and what migrating an older file means."""

from dataclasses import dataclass, field

from .model import PERSON_KEYS

MAIN_CAMPAIGN = "main"  # everything from before campaigns existed: its players, sessions and vault
STATE_VERSION = 2


@dataclass
class Campaign:
    id: str
    name: str
    # player id -> {"character", "is_gm"}, in table order. Unused for the current campaign, whose
    # seats live on Engine.players.
    roster: dict[str, dict] = field(default_factory=dict)
    # Seats of people taken out of this campaign, so adding them back restores their character.
    left: dict[str, dict] = field(default_factory=dict)
    # What the party calls itself; empty shows as "The table" in the UI.
    table_name: str = ""

    def to_json(self) -> dict:
        return {"id": self.id, "name": self.name, "table_name": self.table_name}


def migrate_state(data: dict) -> dict:
    """state.json from before campaigns (characters on the players) → one campaign, MAIN_CAMPAIGN,
    seating everyone. Voices named as a character were that campaign's NPCs; the rest are people's
    own voices, shared by every campaign they play in."""
    if data.get("version") == STATE_VERSION:
        return data
    players = data.get("players", [])
    roster = [{"player_id": p["id"], "character": p.get("character", ""), "is_gm": p.get("is_gm", False)} for p in players]
    return {
        "version": STATE_VERSION,
        "campaign": MAIN_CAMPAIGN,
        "campaigns": [{"id": MAIN_CAMPAIGN, "name": "My campaign", "roster": roster}],
        "players": [{k: p[k] for k in PERSON_KEYS if k in p} for p in players],
        "voices": [v | {"campaign": MAIN_CAMPAIGN if v.get("character") else None} for v in data.get("voices", [])],
        "next_label": data.get("next_label", len(data.get("voices", [])) + 1),
    }


def seated_players(state: dict) -> list[dict]:
    """The current campaign's players with their seats (the pre-campaign player shape), from any
    state.json or setup snapshot. For scripts that read saved state."""
    state = migrate_state(state)
    people = {p["id"]: p for p in state["players"]}
    campaign = next(c for c in state["campaigns"] if c["id"] == state["campaign"])
    return [
        people[s["player_id"]] | {"character": s["character"], "is_gm": s["is_gm"]}
        for s in campaign["roster"]
        if s["player_id"] in people
    ]
