"""The player library and campaigns: roster, seating, opening a campaign, syncing voices to it.

LibraryMixin holds no state: everything lives on `Engine`, created in `Engine.__init__`.
Reads, or mutates in place: `self._parked_vecs`, `self._persisted_vecs`, `self._start_lock`, `self.bench`, `self.bus`, `self.campaigns`, `self.cleanup_q`, `self.clones`, `self.lock`, `self.matcher`, `self.messages`, `self.parked`, `self.ready`, `self.status`, `self.train_job`, `self.voices`.
Assigns: `self._glossary`, `self._learner`, `self._spell`, `self.buffer`, `self.campaign`, `self.live`, `self.players`, `self.source_desc`.
Locking: Everything here mutates under `self.lock`; a campaign switch also holds `_start_lock` so no session or training starts mid-switch.
"""

import re
import time
from pathlib import Path

from troubadour.core import config
from troubadour.lore import cleanup

from .buffers import AudioBuffer
from .model import PALETTE, Player, short_id
from .state import MAIN_CAMPAIGN, Campaign

SETTLE_S = 15.0  # a switch waits this long at most for the finished session's spelling fixes
CAMPAIGN_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")  # also Troubadour Cloud's rule for a campaign id


class LibraryMixin:
    def add_player(self, name: str, character: str = "", avatar: str | None = None, is_gm: bool = False) -> dict:
        with self.lock:
            # Colors are per person: avoid everyone's, so seating someone later doesn't clash.
            people = [*self.players.values(), *self.bench.values()]
            used = {p.color for p in people}
            color = next((c for c in PALETTE if c not in used), PALETTE[len(people) % len(PALETTE)])
            p = Player(id=short_id("p"), name=name, character=character, avatar=avatar, color=color, is_gm=is_gm)
            self.players[p.id] = p
            out = p.to_json()
        self._save_state()
        self.bus.emit("player.upserted", out)
        return out

    def update_player(self, pid: str, fields: dict) -> dict:
        """fields: any of name, character, avatar (None clears), is_gm, color, clone_ok — already validated."""
        with self.lock:
            p = self.players[pid]
            for key in ("name", "character", "avatar", "is_gm", "color", "clone_ok"):
                if key in fields and (fields[key] is not None or key == "avatar"):
                    setattr(p, key, fields[key])
            out = p.to_json()
        if fields.get("clone_ok") is False:  # after the flag: a clone job checks it before it writes
            self.clones.forget(pid)
        self._save_state()
        self.bus.emit("player.upserted", out)
        return out

    def remove_player(self, pid: str) -> None:
        """Delete someone from the library: every campaign, their voiceprints and Train recordings."""
        with self.lock:
            seated = pid in self.players
            if seated:
                owned = [v.id for v in self.voices.values() if v.player_id == pid]
                for vid in owned:
                    self._unassign(vid)  # their voices go back to pending; recordings are deleted
                del self.players[pid]
            elif pid in self.bench:
                del self.bench[pid]
            else:
                raise KeyError(pid)
            for v in [v for v in self.parked.values() if v.player_id == pid]:
                del self.parked[v.id]
                self._parked_vecs.pop(v.id, None)
                self._drop_voice_audio(v.id)
            for c in self.campaigns.values():
                c.roster.pop(pid, None)
                c.left.pop(pid, None)
        self.clones.forget(pid)
        self._save_state()
        if seated:
            self.bus.emit("player.removed", {"id": pid})
        else:
            self.bus.emit("library.updated", self.library_json())

    def seat_player(self, pid: str, character: str | None = None, is_gm: bool | None = None) -> dict:
        """Bring someone from the library into the open campaign; their voiceprints come along.
        Unset fields come from their seat here before they left, else no character, and GM if
        they're the first at the table."""
        with self.lock:
            if pid in self.players:
                raise ValueError("They're already in this campaign.")
            p = self.bench.pop(pid)
            before = self.campaigns[self.campaign].left.pop(pid, None) or {"character": "", "is_gm": not self.players}
            p.character = before["character"] if character is None else character
            p.is_gm = before["is_gm"] if is_gm is None else is_gm
            self.players[pid] = p
            self._sync_voices()
            out = p.to_json()
        self._save_state()
        self.bus.emit("player.upserted", out)
        self.bus.emit("library.updated", self.library_json())
        return out

    def bench_player(self, pid: str) -> None:
        """Take someone out of the open campaign, back to the library: their voiceprints are kept.
        Only between sessions; the finished session is saved and cleared first, so its transcript
        keeps their lines."""
        with self._start_lock:
            with self.lock:
                if pid not in self.players:
                    raise KeyError(pid)
                self._require_idle("removing a player")
            self._close_finished()
            with self.lock:
                p = self.players.pop(pid)
                self.campaigns[self.campaign].left[pid] = {"character": p.character, "is_gm": p.is_gm}
                p.character, p.is_gm = "", False
                self.bench[pid] = p
                self._sync_voices()
                snapshot = self.snapshot()
        self._save_state()
        self.bus.emit("snapshot", snapshot)

    def vault_dir(self, cid: str | None = None) -> Path:
        """A campaign's notes (default: the open one): MAIN's is config.vault_dir() (TROUBADOUR_VAULT or
        data/campaign), later ones live in data/campaigns/<id>."""
        cid = cid or self.campaign
        if cid == MAIN_CAMPAIGN:
            return config.vault_dir()
        return config.DATA_DIR / "campaigns" / cid

    def create_campaign(self, name: str) -> dict:
        with self.lock:
            c = Campaign(short_id("c"), name)
            self.campaigns[c.id] = c
        self._save_state()
        self.bus.emit("campaigns.updated", self.campaigns_json())
        return c.to_json()

    def adopt_campaign(self, cid: str, name: str) -> dict:
        """The campaign with this id, created (as an empty one called `name`) when this Mac doesn't have it,
        so a campaign restored from Troubadour Cloud shows in the picker and keeps backing up to its own
        vault. The id names a folder, so only the shape the service accepts gets through."""
        with self.lock:
            existing = self.campaigns.get(cid)
            if existing:
                return existing.to_json()
            if not CAMPAIGN_ID.fullmatch(cid):
                raise ValueError("That campaign has an id Troubadour can't use.")
            c = self.campaigns[cid] = Campaign(cid, name)
        self._save_state()
        self.bus.emit("campaigns.updated", self.campaigns_json())
        return c.to_json()

    def rename_campaign(self, cid: str, name: str) -> dict:
        with self.lock:
            c = self.campaigns[cid]
            c.name = name
        self._save_state()
        self.bus.emit("campaigns.updated", self.campaigns_json())
        return c.to_json()

    def open_campaign(self, cid: str) -> dict:
        """Switch campaigns between sessions: seat its players, swap in its voices, its notes and
        its History. The finished session is saved and cleared first."""
        with self._start_lock:
            with self.lock:
                if cid not in self.campaigns:
                    raise KeyError(cid)
                if cid == self.campaign:
                    return self.campaigns_json()
                self._require_idle("switching campaigns")
            self._close_finished()
            with self.lock:
                self.campaigns[self.campaign].roster = {
                    p.id: {"character": p.character, "is_gm": p.is_gm} for p in self.players.values()
                }
                for p in self.players.values():
                    p.character, p.is_gm = "", False
                    self.bench[p.id] = p
                self.players = {}
                for pid, seat in self.campaigns[cid].roster.items():
                    if pid in self.bench:
                        p = self.bench.pop(pid)
                        p.character, p.is_gm = seat["character"], seat["is_gm"]
                        self.players[pid] = p
                self.campaigns[cid].roster = {}
                self.campaign = cid
                self._sync_voices()
                # Spellings and names belong to a campaign's notes; rebuild them from the new vault.
                self._glossary, self._spell, self._learner = ((), 0.0, None, [], []), (None, None), cleanup.Learner()
                snapshot = self.snapshot()
        self._save_state()
        self.bus.emit("snapshot", snapshot)
        return self.campaigns_json()

    def _require_idle(self, doing: str) -> None:
        if self.status != "idle":
            raise ValueError(f"Stop the session before {doing}.")
        if self.train_job is not None:
            raise ValueError(f"Finish or cancel voice training before {doing}.")

    def _close_finished(self) -> None:
        """Save the finished session one last time, then clear it from the live view, so later
        roster or campaign changes can't rewrite its transcript (caller holds _start_lock; idle).
        Its last relabel and spelling fixes land first (bounded wait)."""
        if self.live is not None and self.ready.is_set():
            self._refine()
            deadline = time.monotonic() + SETTLE_S
            while self.cleanup_q.unfinished_tasks and time.monotonic() < deadline:
                time.sleep(0.1)
        self.save_transcript(force=True)
        with self.lock:
            self.live, self.source_desc, self.buffer = None, None, AudioBuffer()
            self.messages.clear()
            for vid in [v.id for v in self.voices.values() if v.status == "pending"]:
                del self.voices[vid]
            for v in self.voices.values():
                v.spans = []

    def _sync_voices(self) -> None:
        """Park the named voices the open campaign doesn't use (out of the matcher, voiceprint kept)
        and bring back the ones it does (lock held)."""
        for v in [v for v in self.voices.values() if v.status == "named" and not self._in_campaign(v)]:
            vec = self.matcher.remove(v.id) if self.matcher else self._persisted_vecs.pop(v.id, None)
            del self.voices[v.id]
            self.parked[v.id] = v
            if vec is not None:
                self._parked_vecs[v.id] = vec
            self.bus.emit("voice.removed", {"id": v.id, "merged_into": None})
        for v in [v for v in self.parked.values() if self._in_campaign(v)]:
            del self.parked[v.id]
            vec = self._parked_vecs.pop(v.id, None)
            if vec is not None and self.matcher:
                self.matcher.add(v.id, vec)
            elif vec is not None:
                self._persisted_vecs[v.id] = vec  # models not loaded yet
            self.voices[v.id] = v
            self.bus.emit("voice.upserted", v.to_json())
        self._refresh_suggestions()
