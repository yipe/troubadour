"""What the engine tracks: players, voices and messages."""

import uuid
from dataclasses import dataclass, field

import numpy as np
from troubadour.core import config

SR = config.SR
PANEL_S = 3.0  # speech a new voice needs before it shows in the panel (benchmark default)
JOIN = 0.5  # cosine to a pending voice's centroid to join it
PROVISIONAL_BELOW = 0.55
PALETTE = ["#f59e0b", "#10b981", "#3b82f6", "#ec4899", "#8b5cf6", "#ef4444", "#14b8a6", "#f97316", "#84cc16", "#06b6d4"]
PERSON_KEYS = ("id", "name", "avatar", "color", "trained", "clone_ok")


def short_id(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:10]}"


@dataclass
class Player:
    """A person in the library. character and is_gm are their seat in the current campaign
    ("" / False for people not playing in it)."""

    id: str
    name: str
    character: str = ""
    avatar: str | None = None
    color: str = PALETTE[0]
    trained: bool = False
    is_gm: bool = False
    clone_ok: bool = False  # they agreed to a voice clone (tts.py); off deletes everything made from it

    def to_json(self) -> dict:
        return dict(self.__dict__)

    def person_json(self) -> dict:
        """The campaign-independent part: what the library stores."""
        return {k: getattr(self, k) for k in PERSON_KEYS}


@dataclass
class Voice:
    id: str
    label: str | None  # "Voice 3"; None until surfaced in the panel
    status: str = "pending"  # pending | named
    player_id: str | None = None
    character: str | None = None
    campaign: str | None = None  # named as a character in this campaign; None: the person's own voice, shared
    seconds: float = 0.0
    spans: list[tuple[float, float]] = field(default_factory=list)  # current-session audio, for the sample
    sample_audio: np.ndarray | None = None  # Train recording (also saved under data/voices/)
    sample_rev: int = 0  # bumped per Train recording so a retrain changes sample_url
    trained: bool = False
    sum: np.ndarray | None = None  # pending only: duration-weighted embedding sum
    suggested_player_id: str | None = None
    suggested_score: float | None = None

    @property
    def visible(self) -> bool:
        return self.status == "named" or self.label is not None

    def to_json(self) -> dict:
        has_sample = bool(self.spans) or self.sample_audio is not None
        # The query changes whenever the sample would, so <audio> refetches (and the UI's player
        # remounts). A Train clip is served as-is: spans mustn't churn its URL every utterance.
        rev = f"t{self.sample_rev}" if self.sample_audio is not None else str(len(self.spans))
        return {
            "id": self.id,
            "label": self.label or "Voice",
            "status": self.status,
            "player_id": self.player_id,
            "character": self.character,
            "seconds": round(self.seconds, 1),
            "sample_url": f"/api/voices/{self.id}/sample.wav?v={rev}" if has_sample else None,
            "suggested_player_id": self.suggested_player_id,
            "suggested_score": None if self.suggested_score is None else round(self.suggested_score, 3),
            "trained": self.trained,
        }


@dataclass
class Message:
    id: str
    voice_id: str | None
    text: str
    t_start: float
    t_end: float
    confidence: float
    provisional: bool
    fixes: list[dict] = field(default_factory=list)  # spelling cleanup: [{start, end, heard}], UTF-16
    level_db: float | None = None  # how loud the line arrived (dBFS): uneven = the mic favours someone
    vec: np.ndarray | None = None
    pinned: bool = False  # the user said who spoke it: refine never moves it
    taught: bool = False  # its voiceprint was learned into its (pinned) voice

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "voice_id": self.voice_id,
            "text": self.text,
            "t_start": round(self.t_start, 2),
            "t_end": round(self.t_end, 2),
            "confidence": round(self.confidence, 3),
            "provisional": self.provisional,
            "fixes": self.fixes,
            "level_db": self.level_db,
        }
