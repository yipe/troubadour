"""The live engine. `core.Engine` composes the mixins in `_sessions`, `_library`, `_voices`, `_pipeline` and
`_training`; this module re-exports the names the server, tests and tools import from `troubadour.engine`.

Patch a symbol in the module whose code reads it (for example `troubadour.engine._pipeline.MIC_STALL_S`);
a patch on a re-export here does nothing."""

from ._pipeline import (
    CONTEXT_MIN_S,
    PROMPT_MENTION_LINES,
    PROMPT_NAMES,
    keep_awake,
)
from ._training import TrainJob
from .buffers import AudioBuffer
from .bus import OVERFLOW, Bus
from .core import Engine
from .live_session import STOP, LiveSession
from .model import PANEL_S, Message, Voice, short_id
from .paths import SESSION_ID, _audio_seconds, sample_path, session_audio
from .state import MAIN_CAMPAIGN, Campaign, migrate_state, seated_players

__all__ = [
    "AudioBuffer",
    "Bus",
    "CONTEXT_MIN_S",
    "Campaign",
    "Engine",
    "LiveSession",
    "MAIN_CAMPAIGN",
    "Message",
    "OVERFLOW",
    "PANEL_S",
    "PROMPT_MENTION_LINES",
    "PROMPT_NAMES",
    "SESSION_ID",
    "STOP",
    "TrainJob",
    "Voice",
    "_audio_seconds",
    "keep_awake",
    "migrate_state",
    "sample_path",
    "seated_players",
    "session_audio",
    "short_id",
]
