"""Shared pieces of the demo seed: the context every module receives, ids, dates, one seeded RNG.

Everything is deterministic: no clock, no uuid, no unseeded randomness, so two runs write identical bytes.
"""

import random
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

CAMPAIGN_ID = "main"  # the id the engine treats as the original campaign: its vault is <data>/campaign
CAMPAIGN_NAME = "The Sunken Crown"
OTHER_CAMPAIGN_ID = "c-lantern"
OTHER_CAMPAIGN_NAME = "Lantern Road"
MARKER = ".troubadour-seed"
# What the seed writes, relative to the data dir. A rerun replaces exactly these and nothing else.
OWNED = ("state.json", "sessions", "campaign", "campaigns", "voices")
SEED = 20261030


@dataclass
class PlayerSeed:
    id: str
    name: str  # the person
    character: str  # their seat in The Sunken Crown ("" for the GM)
    is_gm: bool
    color: str
    trained: bool
    voice_id: str


@dataclass
class SessionSeed:
    n: int
    id: str
    title: str
    started_at: float
    duration_s: float
    record: dict  # the saved transcript.json

    @property
    def date(self) -> str:
        return datetime.fromtimestamp(self.started_at, UTC).strftime("%Y-%m-%d")

    @property
    def page_title(self) -> str:
        """The write-up's note name; facts link to it."""
        return f"{self.date} {self.title}"


@dataclass
class SeedContext:
    data_dir: Path
    vault_dir: Path
    campaign_id: str = CAMPAIGN_ID
    players: list[PlayerSeed] = field(default_factory=list)
    sessions: list[SessionSeed] = field(default_factory=list)


def rng(*key: object) -> random.Random:
    """A generator that depends only on the key, so one module's draws never shift another's."""
    return random.Random(f"{SEED}:" + ":".join(str(k) for k in key))


def utc(month: int, day: int, hour: int = 19) -> float:
    return datetime(2026, month, day, hour, 0, 0, tzinfo=UTC).timestamp()


def session_id(started_at: float, r: random.Random) -> str:
    """The engine's id shape: <date>_<HHMMSS>-<4 hex>."""
    return datetime.fromtimestamp(started_at, UTC).strftime("%Y-%m-%d_%H%M%S") + f"-{r.randrange(16**4):04x}"
