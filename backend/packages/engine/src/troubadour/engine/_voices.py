"""Voices: the panel's suggestions, assigning a voice or a line to a player, speaker identification, and the refine and tidy passes.

VoicesMixin holds no state: everything lives on `Engine`, created in `Engine.__init__`.
Reads, or mutates in place: `self._persisted_vecs`, `self.buffer`, `self.bus`, `self.campaign`, `self.lock`, `self.matcher`, `self.messages`, `self.players`, `self.ready`, `self.refine_now`, `self.voices`.
Assigns: `self._next_label`.
Locking: Callers hold `self.lock` while these touch voices and messages; `embed_lock` is not taken here.
"""

import logging

import numpy as np
from troubadour.sound.audio import wav_bytes
from troubadour.sound.voices import normalize

from .model import JOIN, PANEL_S, PROVISIONAL_BELOW, SR, Message, Voice, short_id

log = logging.getLogger("troubadour")

SUGGEST_MIN = 0.25
CHARACTER_MARGIN = 0.08  # one player's other voiceprint must win by this much to switch (no flicker)
SAMPLE_MAX_S = 8.0
REFINE_EVERY_S = 15.0


class VoicesMixin:
    def _surface(self, v: Voice) -> None:
        v.label = f"Voice {self._next_label}"
        self._next_label += 1

    def _update_suggestion(self, v: Voice) -> None:
        if v.status != "pending" or v.sum is None or not self.matcher or not self.matcher.names:
            v.suggested_player_id = v.suggested_score = None
            return
        scores = self.matcher.scores(normalize(v.sum))
        best = int(np.argmax(scores))
        target = self.voices.get(self.matcher.names[best])
        if float(scores[best]) >= SUGGEST_MIN and target and target.player_id:
            v.suggested_player_id, v.suggested_score = target.player_id, float(scores[best])
        else:
            v.suggested_player_id = v.suggested_score = None

    def _refresh_suggestions(self) -> None:
        for other in self.voices.values():
            if other.status == "pending" and other.visible:
                self._update_suggestion(other)
                self.bus.emit("voice.upserted", other.to_json())

    def assign_voice(self, vid: str, player_id: str, character: str | None = None) -> dict:
        character = (character or "").strip() or None
        with self.lock:
            v = self.voices[vid]
            if player_id not in self.players:
                raise KeyError(player_id)
            if v.status == "named":  # re-point an already named voice
                v.player_id, v.character = player_id, character
                v.campaign = self.campaign if character else None
                self.bus.emit("voice.upserted", v.to_json())
                result = {"voice": v.to_json(), "merged_into": None}
            else:
                if self.matcher is None:
                    raise ValueError("Models are still loading; try again in a few seconds.")
                vec = normalize(v.sum)
                target = next(
                    (
                        t
                        for t in self.voices.values()
                        if t.status == "named" and t.player_id == player_id and t.character == character
                    ),
                    None,
                )
                if target:
                    self.matcher.add(target.id, vec)  # same player + character → merge
                    target.seconds += v.seconds
                    target.spans += v.spans
                    del self.voices[vid]
                    patches = []
                    for m in self.messages.values():
                        if m.voice_id == vid:
                            m.voice_id = target.id
                            patches.append({"id": m.id, "voice_id": target.id})
                    self.bus.emit("voice.removed", {"id": vid, "merged_into": target.id})
                    self.bus.emit("voice.upserted", target.to_json())
                    self._emit_patches(patches)
                    result = {"voice": target.to_json(), "merged_into": target.id}
                else:
                    self.matcher.add(vid, vec)
                    v.status, v.player_id, v.character, v.sum = "named", player_id, character, None
                    v.campaign = self.campaign if character else None  # a character is this campaign's
                    v.suggested_player_id = v.suggested_score = None
                    if v.label is None:
                        self._surface(v)
                    self.bus.emit("voice.upserted", v.to_json())
                    result = {"voice": v.to_json(), "merged_into": None}
            self._refresh_suggestions()
        self._save_state()
        self.refine_now.set()
        return result

    def assign_message(self, mid: str, player_id: str, character: str | None = None) -> dict:
        """The user says who spoke one line: it moves to that person's (or character's) voice at
        once and stays there (refine never relabels it), and its voiceprint teaches that voice,
        like one confident span. Moving it again takes the lesson back first."""
        character = (character or "").strip() or None
        with self.lock:
            m = self.messages[mid]
            if player_id not in self.players:
                raise KeyError(player_id)
            if self.matcher is None:
                raise ValueError("Models are still loading; try again in a few seconds.")
            target = next(
                (
                    v
                    for v in self.voices.values()
                    if v.status == "named" and v.player_id == player_id and v.character == character
                ),
                None,
            )
            if target is None:
                target = Voice(id=short_id("v"), label=None, status="named", player_id=player_id, character=character)
                target.campaign = self.campaign if character else None  # a character is this campaign's
                self._surface(target)
                self.voices[target.id] = target
            if m.taught and m.vec is not None:
                self.matcher.forget(m.voice_id, m.vec)
            if m.vec is not None:
                self.matcher.learn(target.id, m.vec)
            if m.voice_id != target.id:
                target.seconds += m.t_end - m.t_start
                target.spans.append((m.t_start, m.t_end))
            m.voice_id, m.confidence, m.provisional = target.id, 1.0, False
            m.pinned, m.taught = True, m.vec is not None
            self.bus.emit("voice.upserted", target.to_json())
            self._emit_patches([{"id": m.id, "voice_id": target.id, "confidence": 1.0, "provisional": False}])
            self._refresh_suggestions()
            result = {"message": m.to_json(), "voice": target.to_json()}
        self._save_state()
        self.refine_now.set()  # the lesson may move other lines too
        return result

    def unassign_voice(self, vid: str) -> dict:
        with self.lock:
            out = self._unassign(vid)
        self._save_state()
        return out

    def _unassign(self, vid: str) -> dict:
        """Back to pending (lock held). A Train recording stays with the person, not the voice: delete it."""
        v = self.voices[vid]
        if v.status == "named":
            owner = self.players.get(v.player_id)
            vec = self.matcher.remove(vid) if self.matcher else self._persisted_vecs.pop(vid, None)
            v.status, v.player_id, v.character, v.campaign = "pending", None, None, None
            for m in self.messages.values():
                if m.voice_id == vid:  # its print is gone: the lines it was taught by are free again
                    m.pinned = m.taught = False
            v.sum = (vec if vec is not None else np.zeros(256)) * max(v.seconds, 1.0)
            if v.trained:
                v.trained, v.sample_audio = False, None
                self._drop_voice_audio(vid)
            if owner is not None:
                owner.trained = any(
                    o.trained and o.player_id == owner.id and o.character is None
                    for o in self.voices.values()
                    if o.status == "named"
                )
                self.bus.emit("player.upserted", owner.to_json())
            if v.label is None:
                self._surface(v)
            self._update_suggestion(v)
        self.bus.emit("voice.upserted", v.to_json())
        return v.to_json()

    def voice_sample(self, vid: str) -> bytes:
        with self.lock:
            v = self.voices[vid]
            if v.sample_audio is not None:
                return wav_bytes(v.sample_audio[: int(SAMPLE_MAX_S * SR)])
            audio = self.buffer.view()
            chunks, total = [], 0.0
            # Longest spans first: they carry the clearest voice.
            for s, e in sorted(v.spans, key=lambda x: x[0] - x[1]):
                if total >= SAMPLE_MAX_S:
                    break
                chunks += [audio[int(s * SR) : int(e * SR)], np.zeros(int(0.25 * SR), np.float32)]
                total += e - s
        if not chunks:
            raise KeyError(vid)
        return wav_bytes(np.concatenate(chunks))

    def _identify(self, vec: np.ndarray | None, t0: float, t1: float) -> tuple[str | None, float, bool]:
        """(voice_id, confidence, provisional); lock held. Option B discovery when nothing matches."""
        duration = t1 - t0
        if vec is None:  # too short to embed: lean on the previous speaker, flagged
            last = next(reversed(self.messages.values()), None)
            return (last.voice_id if last else None), 0.2, True
        name, score, unknown = self.matcher.classify(vec, duration)
        if not unknown:
            name = self._character_tiebreak(self.matcher.scores(vec), name, self._last_voice_of(name))
            v = self.voices.get(name)
            if v:
                v.seconds += duration
                v.spans.append((t0, t1))
            return name, score, score < PROVISIONAL_BELOW
        pending = [(float(normalize(v.sum) @ vec), v) for v in self.voices.values() if v.status == "pending"]
        best_score, group = max(pending, key=lambda x: x[0], default=(0.0, None))
        if group is None or best_score < JOIN:
            group = Voice(id=short_id("v"), label=None, sum=np.zeros_like(vec))
            self.voices[group.id] = group
            best_score = 0.0
        group.sum = group.sum + vec * duration
        group.seconds += duration
        group.spans.append((t0, t1))
        if group.label is None and group.seconds >= PANEL_S:
            self._surface(group)
        if group.visible:
            self._update_suggestion(group)
            self.bus.emit("voice.upserted", group.to_json())
        return group.id, best_score, True

    def _last_voice_of(self, voice_id: str) -> str | None:
        """The voice used for this voice's player in their most recent message."""
        owner = self.voices[voice_id].player_id if voice_id in self.voices else None
        if owner is None:
            return None
        for m in reversed(self.messages.values()):
            v = self.voices.get(m.voice_id) if m.voice_id else None
            if v and v.player_id == owner:
                return v.id
        return None

    def _character_tiebreak(self, scores: np.ndarray, best: str, previous: str | None) -> str:
        """Pick among ONE player's voiceprints (e.g. normal + a character voice named in the panel).

        The speaker embedding barely separates one person's voices, so switching
        away from the player's previous voice needs CHARACTER_MARGIN; near-ties
        keep the previous one (else their normal voice). The player is right either way.
        """
        owner = self.voices[best].player_id if best in self.voices else None
        if owner is None:
            return best
        names = self.matcher.names
        candidates = [n for n in names if n in self.voices and self.voices[n].player_id == owner]
        if len(candidates) < 2:
            return best
        rivals = [float(scores[names.index(n)]) for n in candidates if n != best]
        if float(scores[names.index(best)]) - max(rivals) >= CHARACTER_MARGIN:
            return best
        if previous in candidates:
            return previous
        normal = next((n for n in candidates if self.voices[n].character is None), None)
        return normal or best

    def _refine_loop(self) -> None:
        while True:
            self.refine_now.wait(REFINE_EVERY_S)
            self.refine_now.clear()
            if not self.ready.is_set():
                continue
            try:
                self._refine()
                self.save_transcript()  # autosave: a crash or power loss costs at most REFINE_EVERY_S
            except Exception:
                log.exception("refine failed")

    def _refine(self) -> None:
        """Re-score past messages with the matured voiceprints (benchmark: +14 pts for option B),
        then tidy pending voices. All message changes go out as one messages.updated batch."""
        patches: dict[str, dict] = {}
        with self.lock:
            if self.matcher.names:
                self._relabel(patches)
            self._tidy_pending(patches)
        self._emit_patches([{"id": mid, **p} for mid, p in patches.items()])

    def _relabel(self, patches: dict[str, dict]) -> None:
        for m in self.messages.values():
            if m.vec is None or m.pinned:
                continue
            scores = self.matcher.scores(m.vec)
            best = int(np.argmax(scores))
            score = float(scores[best])
            patch = {}
            if score >= self.matcher.unknown_below:
                pick = self._character_tiebreak(scores, self.matcher.names[best], m.voice_id)
                if pick != m.voice_id:
                    patch["voice_id"] = m.voice_id = pick
            current = self.voices.get(m.voice_id)
            if current and current.status == "named" and m.voice_id in self.matcher.names:
                own = float(scores[self.matcher.names.index(m.voice_id)])
                provisional = own < PROVISIONAL_BELOW
                if abs(own - m.confidence) > 0.02:
                    m.confidence = own
                    patch["confidence"] = round(own, 3)
                if provisional != m.provisional:
                    patch["provisional"] = m.provisional = provisional
            if patch:
                patches.setdefault(m.id, {}).update(patch)

    def _tidy_pending(self, patches: dict[str, dict]) -> None:
        """Keep the voices panel short over a long session (a 16 h soak grew 132 pending voices).

        - A pending voice whose lines have all moved to named voices disappears.
        - Pending voices whose voiceprints drifted together (≥ JOIN) merge into the biggest.
        """
        owned: dict[str, int] = {}
        for m in self.messages.values():
            if m.voice_id:
                owned[m.voice_id] = owned.get(m.voice_id, 0) + 1
        pending = sorted((v for v in self.voices.values() if v.status == "pending"), key=lambda v: -v.seconds)
        kept: list[Voice] = []
        changed: set[str] = set()
        for v in pending:
            if not owned.get(v.id):
                self._drop_pending(v, None)
                continue
            target = next((k for k in kept if float(normalize(k.sum) @ normalize(v.sum)) >= JOIN), None)
            if target is None:
                kept.append(v)
                continue
            target.sum = target.sum + v.sum
            target.seconds += v.seconds
            target.spans += v.spans
            for m in self.messages.values():
                if m.voice_id == v.id:
                    m.voice_id = target.id
                    patches.setdefault(m.id, {})["voice_id"] = target.id
            self._drop_pending(v, target.id)
            changed.add(target.id)
        for vid in changed:
            target = self.voices[vid]
            if target.label is None and target.seconds >= PANEL_S:
                self._surface(target)
            if target.visible:
                self._update_suggestion(target)
                self.bus.emit("voice.upserted", target.to_json())

    def _drop_pending(self, v: Voice, merged_into: str | None) -> None:
        del self.voices[v.id]
        if v.visible:
            self.bus.emit("voice.removed", {"id": v.id, "merged_into": merged_into})

    def _speaker_name(self, m: Message) -> str:
        v = self.voices.get(m.voice_id) if m.voice_id else None
        if v and v.player_id and v.player_id in self.players:
            p = self.players[v.player_id]
            who = v.character or p.character
            return f"{p.name}{' (GM)' if p.is_gm else ''}{f' as {who}' if who else ''}"
        return v.label if v and v.label else "Unknown"
