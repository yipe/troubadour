"""Saved sessions on disk, transcript records, merging, state.json, and the JSON views the server sends.

SessionsMixin holds no state: everything lives on `Engine`, created in `Engine.__init__`.
Reads, or mutates in place: `self._parked_vecs`, `self._persisted_vecs`, `self._save_lock`, `self._transcript_lock`, `self.buffer`, `self.bus`, `self.cleanup_llm`, `self.live`, `self.llm_ok`, `self.load_error`, `self.lock`, `self.matcher`, `self.messages`, `self.parked`, `self.players`, `self.ready`, `self.source_desc`, `self.status`, `self.train_job`, `self.voices`.
Assigns: `self._next_label`, `self._saved_signature`, `self.audio_monitor`, `self.bench`, `self.campaign`, `self.campaigns`.
Locking: `self.lock` guards players, voices, messages and the session fields; `_save_lock` and `_transcript_lock` serialize the writes. File and disk work happens outside `self.lock`.
"""

import contextlib
import json
import logging
import os
import shutil
import tempfile
import threading
import time
from pathlib import Path

import numpy as np
from troubadour.core import config, settings, transcript
from troubadour.sound import asr, levels
from troubadour.sound.audio import load_audio

from . import pipeline
from .live_session import LiveSession
from .model import PERSON_KEYS, SR, Player, Voice
from .paths import SESSION_ID, _audio_seconds, _concat_wav, _first_by_id, session_audio
from .state import MAIN_CAMPAIGN, STATE_VERSION, Campaign, migrate_state

log = logging.getLogger("troubadour")

TRASH = ".trash"  # sessions/.trash/<id>: deleted or merged-away sessions, kept so they can come back
PREMERGE = ".premerge"  # <kept>/.premerge: what a merge replaced, for unmerge
RESTORED = ("transcript.json", "transcript.md", "meta.json", "quality.json", "transcript.orig.json")
_structure_lock = threading.Lock()  # one delete, merge or unmerge at a time

_talk_cache: dict[str, tuple[int, dict[str, float]]] = {}  # session id → (transcript mtime_ns, talk), for old sessions


def talk_seconds(messages: list[dict]) -> dict[str, float]:
    """Seconds spoken per player id; lines of a voice nobody owns count under "voice:<voice_id>"."""
    talk: dict[str, float] = {}
    for m in messages:
        who = m.get("player_id") or (f"voice:{m['voice_id']}" if m.get("voice_id") else None)
        if who is not None:
            talk[who] = round(talk.get(who, 0.0) + max(0.0, m["t_end"] - m["t_start"]), 2)
    return talk


def _write_files(folder: Path, files: dict[str, str]) -> None:
    for name, body in files.items():
        tmp = folder / f".{name}.tmp"
        tmp.write_text(body, encoding="utf-8")
        tmp.replace(folder / name)


class SessionsMixin:
    live: LiveSession | None  # set in Engine.__init__
    _transcript_lock: threading.Lock

    def sessions_dir(self) -> Path:
        return config.DATA_DIR / "sessions"

    def transcript_record(self) -> dict | None:
        """The current (or just finished) session as a transcript record; None before any session."""
        with self.lock:
            sess = self.live
            if sess is None:
                return None
            meta = {
                "id": sess.id,
                "started_at": sess.started_at,
                "source": sess.desc,
                "duration_s": round(sess.buffer.n / SR, 1),
                "campaign": sess.campaign,
                "title": sess.title,
                "present_player_ids": sess.present_player_ids,
                "reviewed_at": None,  # save_transcript keeps a value set since the last save
                "pipeline": pipeline.live_stamp(),  # what listening live already did (pipeline.py)
            }
            record = transcript.build(
                meta,
                [p.to_json() for p in self.players.values()],
                [v.to_json() for v in self.voices.values()],
                [m.to_json() for m in self.messages.values()],
            )
            record["session"]["talk"] = talk_seconds(record["messages"])
            return record

    def _transcript_signature(self) -> tuple:
        """Changes whenever the saved transcript would: lines, speakers, names."""
        return (
            self.live.id if self.live else None,
            tuple((m.id, m.voice_id) for m in self.messages.values()),
            tuple((p.name, p.character, p.is_gm) for p in self.players.values()),
            tuple((v.id, v.player_id, v.character, v.label) for v in self.voices.values()),
        )

    def save_transcript(self, force: bool = False) -> Path | None:
        """Write data/sessions/<id>/transcript.{json,md} + meta.json (atomic). Skips if nothing changed."""
        with self._transcript_lock:
            with self.lock:
                # A mic session is kept even if nobody spoke: its recording is worth replaying.
                if self.live is None or not (self.messages or self.live.desc["kind"] == "mic"):
                    return None
                sig = self._transcript_signature()
                if not force and sig == self._saved_signature:
                    return None
                record = self.transcript_record()
            if record is None:
                return None
            folder = self.sessions_dir() / record["session"]["id"]
            if (folder / "transcript.orig.json").exists():
                # Improve / Fix spellings rewrote it after the session ended: theirs is newer than
                # what's in memory, so the live copy stops saving over it.
                self._saved_signature = sig
                return None
            folder.mkdir(parents=True, exist_ok=True)
            # "Reviewed" is set from outside the live session; a later autosave must not undo it.
            record["session"]["reviewed_at"] = self._read_meta(folder).get("reviewed_at")
            _write_files(
                folder,
                {
                    "transcript.json": json.dumps(record, ensure_ascii=False, indent=1),
                    "transcript.md": transcript.markdown(record),
                    "meta.json": json.dumps(record["session"]),
                },
            )
            self._saved_signature = sig
            return folder

    @staticmethod
    def _read_meta(folder: Path) -> dict:
        try:
            meta = json.loads((folder / "meta.json").read_text())
        except (OSError, ValueError):
            return {}
        return meta if isinstance(meta, dict) else {}

    def set_reviewed(self, sid: str, reviewed: bool) -> float | None:
        """Set (now) or clear the reviewed time in a saved session's meta.json; returns the new value.
        A patch under the transcript lock, so it can't interleave with the live session's autosave."""
        if not SESSION_ID.fullmatch(sid):
            raise KeyError(sid)
        folder = self.sessions_dir() / sid
        with self._transcript_lock:
            meta = self._read_meta(folder)
            if not meta:
                raise KeyError(sid)
            meta["reviewed_at"] = round(time.time(), 3) if reviewed else None
            _write_files(folder, {"meta.json": json.dumps(meta)})
            return meta["reviewed_at"]

    def session_campaign(self, sid: str) -> str | None:
        """The campaign a saved session belongs to (MAIN for those from before campaigns); None if
        it has no readable meta.json."""
        if not SESSION_ID.fullmatch(sid):
            return None
        try:
            return json.loads((self.sessions_dir() / sid / "meta.json").read_text()).get("campaign", MAIN_CAMPAIGN)
        except (OSError, ValueError, AttributeError):
            return None

    def campaign_sessions(self) -> list[Path]:
        """Folders of the open campaign's saved sessions."""
        return [
            m.parent for m in self.sessions_dir().glob("*/meta.json") if self.session_campaign(m.parent.name) == self.campaign
        ]

    def list_sessions(self) -> list[dict]:
        out = []
        for folder in self.campaign_sessions():
            meta = folder / "meta.json"
            try:
                s = json.loads(meta.read_text())
            except (OSError, json.JSONDecodeError):
                continue
            # Sessions saved before these fields existed list with nulls (and talk, worked out below).
            s.setdefault("started_at", 0)
            s.setdefault("source", None)
            s.setdefault("duration_s", 0)
            s.setdefault("lines", 0)
            s.setdefault("merged_from", [])
            s.setdefault("title", None)
            s.setdefault("present_player_ids", None)
            s.setdefault("reviewed_at", None)
            if not isinstance(s.get("talk"), dict):
                s["talk"] = self._talk_of(meta.parent)
            s["scenes"] = self._scenes_of(meta.parent)
            s["audio"] = (meta.parent / "audio.wav").is_file()
            s["restorable"] = (meta.parent / "transcript.orig.json").is_file()  # improved; original kept
            try:  # the verdict, if the recording has been measured
                s["quality"] = json.loads((meta.parent / "quality.json").read_text())["report"]["verdict"]["kind"]
            except (OSError, ValueError, KeyError, TypeError):
                s["quality"] = None
            try:
                session_audio(s["id"])
                s["replayable"] = True
            except KeyError:
                s["replayable"] = False
            out.append(s)
        return sorted(out, key=lambda s: s.get("started_at", 0), reverse=True)

    @staticmethod
    def _scenes_of(folder: Path) -> list[dict] | None:
        """scenes.json (the write-up's [{t, title, place}]) or None: not written up, or an unreadable file."""
        try:
            raw = json.loads((folder / "scenes.json").read_text())
            return [
                {"t": float(x["t"]), "title": str(x["title"]), "place": x["place"] if isinstance(x["place"], str) else None}
                for x in raw
            ]
        except (OSError, ValueError, KeyError, TypeError):
            return None

    def _talk_of(self, folder: Path) -> dict[str, float]:
        """Talk time from transcript.json, cached until the file changes. Never written back."""
        path = folder / "transcript.json"
        try:
            mtime = path.stat().st_mtime_ns
            cached = _talk_cache.get(folder.name)
            if cached is not None and cached[0] == mtime:
                return cached[1]
            talk = talk_seconds(json.loads(path.read_text())["messages"])
        except (OSError, ValueError, KeyError, TypeError):
            return {}
        _talk_cache[folder.name] = (mtime, talk)
        return talk

    def _check_removable(self, sid: str) -> Path:
        """The folder of a saved session that may be merged away or deleted; KeyError if unknown,
        ValueError for the live session or another campaign's."""
        if not SESSION_ID.fullmatch(sid):
            raise KeyError(sid)
        with self.lock:
            if self.live is not None and self.live.id == sid:
                raise ValueError("Stop the live session first.")
            campaign = self.campaign
        folder = self.sessions_dir() / sid
        if not folder.is_dir():
            raise KeyError(sid)
        if self.session_campaign(sid) not in (None, campaign):
            raise ValueError("That session belongs to another campaign; open it first.")
        return folder

    def _to_trash(self, folder: Path) -> str:
        """Move a session folder to sessions/.trash/ (a timestamp suffix if the name is taken); the
        name it got. Nothing is ever deleted: the folder can be moved back."""
        trash = self.sessions_dir() / TRASH
        trash.mkdir(exist_ok=True)
        name = folder.name
        if (trash / name).exists():
            name = f"{folder.name}.{time.time_ns()}"
        folder.rename(trash / name)
        return name

    def delete_session(self, sid: str) -> str:
        """Move a saved session (recording and transcript) to the trash; returns its trash name.
        The vault's write-up page stays."""
        with _structure_lock:
            return self._to_trash(self._check_removable(sid))

    def undelete_session(self, sid: str) -> dict:
        """Put a trashed session back (the newest one if the id was trashed more than once).
        KeyError: nothing in the trash by that id. FileExistsError: the id is in use again."""
        if not SESSION_ID.fullmatch(sid):
            raise KeyError(sid)
        trash = self.sessions_dir() / TRASH
        with _structure_lock:
            held = sorted(
                (p for p in trash.glob(f"{sid}*") if p.name == sid or p.name.startswith(f"{sid}.")),
                key=lambda p: p.stat().st_mtime_ns,
            )
            if not held:
                raise KeyError(sid)
            if (self.sessions_dir() / sid).exists():
                raise FileExistsError(sid)
            held[-1].rename(self.sessions_dir() / sid)
        return next((s for s in self.list_sessions() if s["id"] == sid), {"id": sid})

    def merge_sessions(self, ids: list[str]) -> dict:
        """Append one saved session onto an earlier one; the later folder goes to the trash.

        The earlier session keeps its id and start time. The later session's lines are shifted
        to follow it, and the two recordings are concatenated when both exist. A recording on
        only one of them is refused: the merged audio would no longer match the transcript.
        Reversible: the earlier session's old files go to `.premerge/` and `unmerge_session`
        puts everything back.
        """
        if len(ids) != 2 or len(set(ids)) != 2:
            raise ValueError("Pick two different saved sessions.")
        with _structure_lock:
            return self._merge(ids)

    def _merge(self, ids: list[str]) -> dict:
        records = []
        for sid in ids:
            folder = self._check_removable(sid)
            try:
                record = json.loads((folder / "transcript.json").read_text())
            except (OSError, json.JSONDecodeError) as e:
                raise KeyError(sid) from e
            records.append((folder, record))
        campaign = self.campaign
        records.sort(key=lambda item: item[1]["session"].get("started_at", 0))
        (keep_dir, keep), (drop_dir, drop) = records
        keep_audio, drop_audio = keep_dir / "audio.wav", drop_dir / "audio.wav"
        if keep_audio.is_file() != drop_audio.is_file():
            raise ValueError("Merge sessions that both have a recording, or neither does.")
        offset = _audio_seconds(keep_audio) if keep_audio.is_file() else float(keep["session"].get("duration_s") or 0)
        seen = {m["id"] for m in keep["messages"]}
        shifted = []
        for m in drop["messages"]:
            mid = m["id"]
            if mid in seen:
                mid = f"{mid}-merged"
            seen.add(mid)
            shifted.append(m | {"id": mid, "t_start": m["t_start"] + offset, "t_end": m["t_end"] + offset})
        messages = sorted(keep["messages"] + shifted, key=lambda m: m["t_start"])
        # The earlier session wins when a player or voice id is in both.
        players = _first_by_id(keep.get("players", []), drop.get("players", []))
        voices = _first_by_id(keep.get("voices", []), drop.get("voices", []))
        added = _audio_seconds(drop_audio) if drop_audio.is_file() else float(drop["session"].get("duration_s") or 0)
        session = dict(keep["session"])
        session["duration_s"] = round(offset + added, 1)
        session["lines"] = len(messages)
        session["talk"] = talk_seconds(messages)
        session["reviewed_at"] = None  # new content to review
        merged_from = list(session.get("merged_from") or [])
        merged_from.append(drop["session"]["id"])
        session["merged_from"] = merged_from
        record = keep | {"session": session, "players": players, "voices": voices, "messages": messages}
        # meta.json holds fields the transcript's session dict may lack (campaign, title,
        # present_player_ids); keep them, overlay what the merge changed.
        changed = {k: session[k] for k in ("duration_s", "lines", "talk", "reviewed_at", "merged_from")}
        meta = {**session, **self._read_meta(keep_dir), **changed, "campaign": campaign}

        # Everything the merge replaces is set aside first, so any failure (or a later unmerge) can put it back.
        pre = keep_dir / PREMERGE
        if pre.exists():  # an earlier merge's restore point stays, under another name
            pre.rename(keep_dir / f"{PREMERGE}.{time.time_ns()}")
        pre.mkdir()
        audio_bytes = keep_audio.stat().st_size if keep_audio.is_file() else None
        for name in RESTORED:
            if (keep_dir / name).is_file():
                shutil.copy2(keep_dir / name, pre / name)
        if audio_bytes is not None:
            # The concat replaces the file, so a hard link keeps the original. Without links, unmerge truncates.
            with contextlib.suppress(OSError):
                os.link(keep_audio, pre / "audio.wav")
        _write_files(pre, {"merge.json": json.dumps({"dropped": drop["session"]["id"], "audio_bytes": audio_bytes})})
        try:
            if audio_bytes is not None:
                _concat_wav(keep_audio, drop_audio)
            _write_files(
                keep_dir,
                {
                    "transcript.json": json.dumps(record, ensure_ascii=False, indent=1),
                    "transcript.md": transcript.markdown(record),
                    "meta.json": json.dumps(meta),
                },
            )
            for name in ("quality.json", "transcript.orig.json"):  # both describe the old content
                if (keep_dir / name).is_file():
                    (keep_dir / name).replace(pre / name)
            trashed = self._to_trash(drop_dir)
        except BaseException:
            self._restore_premerge(keep_dir)
            raise
        _write_files(
            pre, {"merge.json": json.dumps({"dropped": drop["session"]["id"], "audio_bytes": audio_bytes, "trash": trashed})}
        )
        return next((s for s in self.list_sessions() if s["id"] == keep["session"]["id"]), {"id": keep["session"]["id"]})

    @staticmethod
    def _restore_premerge(keep_dir: Path) -> None:
        """Put the files in `.premerge/` back over the merged ones, audio first. Does not touch the trash."""
        pre = keep_dir / PREMERGE
        info = json.loads((pre / "merge.json").read_text())
        audio = keep_dir / "audio.wav"
        if (pre / "audio.wav").is_file():
            if audio.exists() and os.path.samefile(audio, pre / "audio.wav"):
                (pre / "audio.wav").unlink()  # the merge never replaced it; this is only the second name
            else:
                (pre / "audio.wav").replace(audio)
        elif info.get("audio_bytes") is not None:
            # No saved copy: cut the appended samples off and fix the two sizes in the WAV header.
            size = info["audio_bytes"]
            with open(audio, "r+b") as f:
                f.truncate(size)
                f.seek(4)
                f.write((size - 8).to_bytes(4, "little"))
                f.seek(40)
                f.write((size - 44).to_bytes(4, "little"))
        for name in RESTORED:
            if (pre / name).is_file():
                (pre / name).replace(keep_dir / name)
            elif (keep_dir / name).is_file():
                # Made after the merge (an Improve of the merged session) and it doesn't describe the
                # restored transcript: set it aside rather than delete it.
                (keep_dir / name).replace(keep_dir / f"{name}.undone")
        (pre / "merge.json").unlink(missing_ok=True)
        with contextlib.suppress(OSError):
            pre.rmdir()

    def unmerge_session(self, sid: str) -> dict:
        """Undo the last merge into `sid`: its old files, its recording's length, and the dropped
        session's folder (from the trash) all come back. KeyError: unknown session.
        FileNotFoundError: no merge to undo. FileExistsError: the dropped id is in use again."""
        if not SESSION_ID.fullmatch(sid):
            raise KeyError(sid)
        keep_dir = self.sessions_dir() / sid
        with _structure_lock:
            if not keep_dir.is_dir():
                raise KeyError(sid)
            try:
                info = json.loads((keep_dir / PREMERGE / "merge.json").read_text())
                dropped, held = info["dropped"], self.sessions_dir() / TRASH / info["trash"]
            except (OSError, ValueError, KeyError, TypeError):
                raise FileNotFoundError(sid) from None
            if not held.is_dir():
                raise FileNotFoundError(sid)
            home = self.sessions_dir() / dropped
            if home.exists():
                raise FileExistsError(dropped)
            held.rename(home)
            try:
                self._restore_premerge(keep_dir)
            except BaseException:
                home.rename(held)
                raise
        return next((s for s in self.list_sessions() if s["id"] == sid), {"id": sid})

    def session_file(self, sid: str, fmt: str) -> Path:
        """A saved session's transcript.{md,json} or its own recording (fmt "wav")."""
        if not SESSION_ID.fullmatch(sid) or fmt not in ("md", "json", "wav"):
            raise KeyError(sid)
        path = self.sessions_dir() / sid / ("audio.wav" if fmt == "wav" else f"transcript.{fmt}")
        if not path.is_file():
            raise KeyError(sid)
        return path

    def _snapshot_setup(self, sess: LiveSession, phase: str) -> None:
        """sessions/<id>/setup/<phase>.json (state.json's shape: players + voiceprints) plus the
        voices' training clips, so `troubadour-sim` can re-run the session against exactly this setup.
        "start" is what the session began with; "end" adds the voices named during play."""
        folder = self.sessions_dir() / sess.id / "setup"
        try:
            data = self._state_data()
            (folder / "voices").mkdir(parents=True, exist_ok=True)
            for v in data["voices"]:
                wav = self._voice_audio_path(v["id"])
                if wav.is_file():
                    shutil.copyfile(wav, folder / "voices" / wav.name)
            tmp = folder / f".{phase}.json.tmp"
            tmp.write_text(json.dumps(data))
            tmp.replace(folder / f"{phase}.json")
        except OSError:
            log.exception("couldn't snapshot the %s setup", phase)

    def _state_path(self) -> Path:
        return config.DATA_DIR / "state.json"

    def _voice_audio_path(self, vid: str) -> Path:
        return config.DATA_DIR / "voices" / f"{vid}.wav"

    def _voice_hq_path(self, vid: str) -> Path:
        """The Train clip at the mic's own rate, 24-bit (see TrainJob.native)."""
        return config.DATA_DIR / "voices" / f"{vid}.hq.wav"

    def _drop_voice_audio(self, vid: str) -> None:
        self._voice_audio_path(vid).unlink(missing_ok=True)
        self._voice_hq_path(vid).unlink(missing_ok=True)

    def _load_state(self) -> None:
        path = self._state_path()
        if not path.exists():
            return
        data = json.loads(path.read_text())
        if data.get("version") != STATE_VERSION:
            backup = path.with_name("state.v1.json")  # the pre-campaign file, kept as it was
            if not backup.exists():
                shutil.copyfile(path, backup)
            data = migrate_state(data)
        people = {p["id"]: Player(**{k: p[k] for k in PERSON_KEYS if k in p}) for p in data["players"]}

        def seats(entries: list[dict]) -> dict[str, dict]:
            return {
                s["player_id"]: {"character": s["character"], "is_gm": s["is_gm"]} for s in entries if s["player_id"] in people
            }

        self.campaigns = {
            c["id"]: Campaign(c["id"], c["name"], seats(c["roster"]), seats(c.get("left", [])), c.get("table_name", ""))
            for c in data["campaigns"]
        }
        if not self.campaigns:  # a hand-edited file: keep everyone, in a fresh main campaign
            self.campaigns = {MAIN_CAMPAIGN: Campaign(MAIN_CAMPAIGN, "My campaign")}
        self.campaign = data["campaign"] if data["campaign"] in self.campaigns else next(iter(self.campaigns))
        for pid, seat in self.campaigns[self.campaign].roster.items():
            p = people.pop(pid)
            p.character, p.is_gm = seat["character"], seat["is_gm"]
            self.players[pid] = p
        self.campaigns[self.campaign].roster = {}
        self.bench = people
        for v in data["voices"]:
            voice = Voice(
                id=v["id"],
                label=v["label"],
                status="named",
                player_id=v["player_id"],
                character=v["character"],
                campaign=v.get("campaign"),
                seconds=v["seconds"],
                trained=v.get("trained", False),
            )
            wav = self._voice_audio_path(voice.id)
            if wav.exists():
                voice.sample_audio = load_audio(wav)
            vec = np.array(v["vec"], np.float64)
            if self._in_campaign(voice):
                self.voices[voice.id], self._persisted_vecs[voice.id] = voice, vec
            else:
                self.parked[voice.id], self._parked_vecs[voice.id] = voice, vec
        self._next_label = data["next_label"]
        # Recordings whose voice is gone (unassigned/deleted while offline, or older builds).
        for wav in (config.DATA_DIR / "voices").glob("*.wav"):
            vid = wav.name.removesuffix(".wav").removesuffix(".hq")  # <vid>.wav and <vid>.hq.wav
            if vid not in self.voices and vid not in self.parked:
                wav.unlink(missing_ok=True)

    def _in_campaign(self, v: Voice) -> bool:
        """A named voice the open campaign uses: a seated player's own voice, or a character of theirs
        named in this campaign."""
        return v.player_id in self.players and v.campaign in (None, self.campaign)

    def _voiceprint(self, vid: str) -> np.ndarray | None:
        if self.matcher and vid in self.matcher.names:
            return self.matcher.vector(vid)
        if self.live is not None and vid in self.live.absent_vecs:
            return self.live.absent_vecs[vid]  # left out of matching for this session
        if vid in self._parked_vecs:
            return self._parked_vecs[vid]
        return self._persisted_vecs.get(vid)  # models not loaded yet

    def _state_data(self) -> dict:
        """The library, campaigns and named voiceprints (parked ones too), as stored in state.json."""
        with self.lock:
            voices = []
            for v in (*self.voices.values(), *self.parked.values()):
                vec = self._voiceprint(v.id) if v.status == "named" else None
                if vec is None:
                    continue
                voices.append(
                    {
                        "id": v.id,
                        "label": v.label,
                        "player_id": v.player_id,
                        "character": v.character,
                        "campaign": v.campaign,
                        "seconds": v.seconds,
                        "trained": v.trained,
                        "vec": vec.tolist(),
                    }
                )
            seated = {p.id: {"character": p.character, "is_gm": p.is_gm} for p in self.players.values()}
            campaigns = [
                {
                    "id": c.id,
                    "name": c.name,
                    "table_name": c.table_name,
                    "roster": [
                        {"player_id": pid, **seat} for pid, seat in (seated if c.id == self.campaign else c.roster).items()
                    ],
                    "left": [{"player_id": pid, **seat} for pid, seat in c.left.items()],
                }
                for c in self.campaigns.values()
            ]
            return {
                "version": STATE_VERSION,
                "campaign": self.campaign,
                "campaigns": campaigns,
                "players": [p.person_json() for p in (*self.players.values(), *self.bench.values())],
                "voices": voices,
                "next_label": self._next_label,
            }

    def _save_state(self) -> None:
        """Atomically write players + named voiceprints. Safe from any thread."""
        with self._save_lock:
            data = self._state_data()
            config.DATA_DIR.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile("w", dir=config.DATA_DIR, suffix=".tmp", delete=False) as f:
                json.dump(data, f)
            Path(f.name).replace(self._state_path())

    def memory_stats(self) -> dict:
        """Where memory goes, for soak tests (GET /api/debug/memory)."""
        import gc
        import sys

        import torch

        out = {k: round(v, 1) for k, v in asr.memory().items()}
        if torch.backends.mps.is_available():
            out["torch_mps_allocated_mb"] = round(torch.mps.current_allocated_memory() / 2**20, 1)
            out["torch_mps_driver_mb"] = round(torch.mps.driver_allocated_memory() / 2**20, 1)
        with self.lock:
            out |= {
                "py_blocks": sys.getallocatedblocks(),
                "py_objects": len(gc.get_objects()),
                "audio_buffer_mb": round(self.buffer._data.nbytes / 2**20, 1),
                "messages": len(self.messages),
                "voices": len(self.voices),
            }
        return out

    def session_json(self) -> dict:
        job = self.train_job
        return {
            "status": self.status,
            "source": self.source_desc,
            "t": round(self.buffer.n / SR, 2),
            "llm": {"url": self.cleanup_llm.url, "model": self.cleanup_llm.model, "ok": self.llm_ok},
            "audio_monitor": self.audio_monitor,
            "title": self.live.title if self.live else "",
            "present_player_ids": self.live.present_player_ids if self.live else [],
            # Speech models (Whisper, VAD, voices) load once at start-up: ~20 s, or fail for good.
            "asr": {
                "model": settings.current()["whisper"],
                "state": "error" if self.load_error else "ready" if self.ready.is_set() else "loading",
            },
            "training": {"player_id": job.player_id} if job else None,
            "error": self.load_error,
        }

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "session": self.session_json(),
                **self.campaigns_json(),
                "players": [p.to_json() for p in self.players.values()],
                "library": self.library_json(),
                "voices": [v.to_json() for v in self.voices.values() if v.visible],
                "messages": [m.to_json() for m in self.messages.values()],
            }

    def campaigns_json(self) -> dict:
        with self.lock:
            return {"campaign": self.campaign, "campaigns": [c.to_json() for c in self.campaigns.values()]}

    def library_json(self) -> list[dict]:
        """People who aren't playing in the open campaign (their voiceprints are kept)."""
        with self.lock:
            return [p.person_json() for p in self.bench.values()]

    def _emit_session(self) -> None:
        self.bus.emit("session.updated", self.session_json())

    def set_audio_monitor(self, on: bool) -> None:
        """The live level + quality read-out costs a little work on every frame; the UI can
        switch it off. Applies to the running session at once and to the next ones."""
        stopped = None
        with self.lock:
            self.audio_monitor = on
            sess = self.live
            if sess is not None and self.status != "idle":
                if on and sess.meter is None:
                    sess.meter = levels.LevelMeter(self.bus.emit)
                elif not on:
                    stopped, sess.meter = sess.meter, None
        if stopped is not None:
            stopped.stop()  # the meter reads "off"
        self._emit_session()

    def _emit_patches(self, patches: list[dict]) -> None:
        if patches:
            self.bus.emit("messages.updated", patches)
