"""The steps that turn a recording into everything Troubadour knows about a session, and which version of
each step made what is on disk.

Two things use it: "Refresh this session" (every step that can run) and "Upgrade old sessions" (only the
steps whose code changed since the session was processed). Both are the same loop, `refresh`.

Each step has an integer `version`. `meta.json` and `transcript.json` carry `session.pipeline`, `{step:
version}`, written when a step finishes (`stamp`). A session with no `pipeline` is version 0 of every step.
**Bump a step's version only when its output meaningfully changes**: every saved session then offers an
upgrade (`backend/AGENTS.md`).

Where each step's work already lives (nothing is re-implemented here):

| step           | runs                                             | needs                     |
|----------------|--------------------------------------------------|---------------------------|
| `transcribe`   | `improve.run` (Whisper listens again)            | the recording             |
| `speakers`     | `improve.reassign_speakers`                      | the recording, named voices |
| `spelling`     | `improve.fix_spellings`                          | the cleanup switched on   |
| `talk`         | `talk_seconds` over the lines (below)            | nothing                   |
| `in_character` | `improve.label_in_character`                     | the language model        |
| `writeup`      | `Memory._write_up` (notes, page, facts, scenes)  | the LM; a page already exists |
| `review`       | `lore.review` after archiving the old list       | a write-up page           |
| `recap`        | `lore.recap.build`                               | a recap already exists    |

Safety, in order of importance: nothing is deleted (the old transcript is `transcript.orig.json`, the old
page is copied to the vault's `.trash`, the old review list and recap are archived beside the new ones);
confirmed facts are never touched (the write-up only adds suggestions, `Vault.add_fact` dedupes with
`same_fact`); a step that fails stops the job, and the steps before it stay recorded.
"""

import json
import threading
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from troubadour.core import settings
from troubadour.core.fsutil import write_atomic
from troubadour.lore import recap, review
from troubadour.lore.memory import Job

from .paths import SESSION_ID, session_audio

if TYPE_CHECKING:
    from troubadour.lore.campaign import Vault
    from troubadour.lore.memory import Memory

    from .core import Engine

RESTORE_POINT = "transcript.orig.json"
ARCHIVE = "before-refresh"  # review.before-refresh-<ns>.json, recap.before-refresh-<ns>.json
_stamp_lock = threading.Lock()


@dataclass
class Run:
    """One saved session and what it is processed with."""

    engine: "Engine"
    memory: "Memory"
    sid: str
    written: dict[str, str] | None = None  # session id -> page path; shared when checking many sessions

    @property
    def folder(self) -> Path:
        return self.engine.sessions_dir() / self.sid

    @property
    def vault(self) -> "Vault":
        return self.memory.vault

    def page(self) -> str | None:
        """The session's write-up page (vault-relative), if there is one."""
        if self.written is None:
            self.written = self.memory.written_up()
        return self.written.get(self.sid)

    def record(self) -> dict:
        return json.loads((self.folder / "transcript.json").read_text(encoding="utf-8"))

    def meta(self) -> dict:
        try:
            return json.loads((self.folder / "meta.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def has_audio(self) -> bool:
        try:
            session_audio(self.sid)
        except (KeyError, AttributeError):  # AttributeError: an old meta.json with no source
            return False
        return True


@dataclass(frozen=True)
class Step:
    name: str
    version: int
    label: str  # shown in the job's steps
    needs: tuple[str, ...]  # "audio" | "voices" | "llm" | "page" | "recap": what must exist for it to run
    writes: tuple[str, ...]
    run: Callable[[Run, Job], None]
    # Why it can't run on this session now (None: it can). A step that can't is skipped, not failed.
    skip: Callable[[Run], str | None] = lambda run: None
    # False: this session has nothing made by an older version to upgrade (a first-time job, not an upgrade).
    upgrades: Callable[[Run], bool] = lambda run: True
    available: bool = True  # False: listed, but not implemented yet; skipped


# ------------------------------------------------------------------ the steps


def _transcribe(run: Run, job: Job) -> None:
    from . import improve

    improve.run(job, run.engine, run.sid, job.on_change, model=settings.current()["whisper_improve"])


def _speakers(run: Run, job: Job) -> None:
    from . import improve

    improve.reassign_speakers(job, run.engine, run.sid, job.on_change)


def _spelling(run: Run, job: Job) -> None:
    from . import improve

    improve.fix_spellings(job, run.engine, run.sid, job.on_change)


def _talk(run: Run, job: Job) -> None:
    from ._sessions import talk_seconds

    job.update(message="Counting who talked")
    patch_session(run.folder, {"talk": talk_seconds(run.record()["messages"])})


def _in_character(run: Run, job: Job) -> None:
    from . import improve

    improve.label_in_character(job, run.engine, run.sid, run.memory.llm)


def _writeup(run: Run, job: Job) -> None:
    rel = run.page()
    if rel:
        trash_copy(run.vault.root, run.vault.root / rel)
    # The page keeps its name (facts elsewhere link to it) and is replaced only when the new one is ready.
    run.memory._write_up(job, run.record())  # noqa: SLF001 - the job thread can't wait on Memory.write_up's own job


def _review(run: Run, job: Job) -> None:
    job.update(message="Re-deriving the review list")
    rel = run.page()
    ctx = review.Context(
        vault=run.vault,
        session_dir=run.folder,
        campaign_sessions=run.engine.campaign_sessions(),
        page=Path(rel).stem if rel else None,
        notebook=run.engine.saved_notebook(run.sid)["items"],
    )
    reset_review(run.folder)
    review.review(ctx)


def _recap(run: Run, job: Job) -> None:
    sessions = run.memory.sessions_dir()
    old = recap.read(sessions, run.sid)
    if old is None:
        return
    job.update(message="Writing the recap")
    options = recap_options(old.get("options"))
    built = recap.build(run.memory.llm, run.vault, run.page(), run.record(), options, job)
    path = recap.recap_path(sessions, run.sid)
    write_atomic(path.with_name(f"recap.{ARCHIVE}-{time.time_ns()}.json"), path.read_text(encoding="utf-8"))
    write_atomic(path, json.dumps({**built, "options": options.to_json(), "built_at": time.time()}, ensure_ascii=False, indent=1))


def _speakers_skip(run: Run) -> str | None:
    if not run.has_audio():
        return "no recording"
    matcher = run.engine.matcher
    return None if matcher is not None and matcher.names else "no named voices"


def _needs_page(run: Run) -> str | None:
    return None if run.page() else "not written up"


def _recap_skip(run: Run) -> str | None:
    return None if recap.read(run.memory.sessions_dir(), run.sid) else "no recap"


STEPS: tuple[Step, ...] = (
    Step(
        "transcribe",
        1,
        "Listen to the recording again",
        ("audio",),
        ("transcript.json",),
        _transcribe,
        skip=lambda run: None if run.has_audio() else "no recording",
    ),
    Step("speakers", 1, "Match lines to voices", ("audio", "voices"), ("transcript.json",), _speakers, skip=_speakers_skip),
    Step(
        "spelling",
        1,
        "Fix spellings",
        ("llm",),
        ("transcript.json",),
        _spelling,
        skip=lambda run: None if run.engine.speller() is not None else "spelling cleanup is off",
    ),
    Step("talk", 1, "Count talk time", (), ("meta.json",), _talk),
    Step(
        "in_character",
        1,
        "Mark in-character lines",
        ("llm",),
        ("transcript.json",),
        _in_character,
        upgrades=lambda run: "in_character" in run.meta(),
    ),
    Step(
        "writeup",
        1,
        "Write up the session",
        ("llm", "page"),
        ("Sessions/<page>.md", "scenes.json", "suggested facts"),
        _writeup,
        skip=_needs_page,
    ),
    Step(
        "review",
        1,
        "Re-derive the review list",
        ("page",),
        ("review.json",),
        _review,
        skip=_needs_page,
        upgrades=lambda run: (run.folder / "review.json").is_file(),
    ),
    Step("recap", 1, "Rewrite the recap", ("llm", "recap"), ("recap.json",), _recap, skip=_recap_skip),
)
BY_NAME = {s.name: s for s in STEPS}
REWRITES = frozenset({"transcribe", "speakers", "spelling", "in_character"})  # steps that rewrite transcript.json
# What a live session already did when it was saved, so it doesn't look out of date the moment it ends.
LIVE_STEPS = ("transcribe", "speakers", "spelling", "talk")


def current() -> dict[str, int]:
    return {s.name: s.version for s in STEPS}


def live_stamp() -> dict[str, int]:
    return {n: BY_NAME[n].version for n in LIVE_STEPS}


def llm_steps(steps: Sequence[Step]) -> bool:
    return any("llm" in s.needs for s in steps)


# ------------------------------------------------------------------ versions on disk


def recorded(meta: dict) -> dict[str, int]:
    raw = meta.get("pipeline")
    if not isinstance(raw, dict):
        return {}
    return {k: v for k, v in raw.items() if isinstance(k, str) and isinstance(v, int) and not isinstance(v, bool)}


def stale(run: Run, steps: Sequence[Step] = STEPS) -> list[Step]:
    """Steps whose recorded version is older than the code's, that this session can run and has output of."""
    done = recorded(run.meta())
    return [s for s in steps if s.available and done.get(s.name, 0) < s.version and s.skip(run) is None and s.upgrades(run)]


def patch_session(folder: Path, changes: dict) -> None:
    """Set keys on `session` in transcript.json and in meta.json. Used for bookkeeping that changes no words,
    so it never takes the restore point."""
    with _stamp_lock:
        for name in ("transcript.json", "meta.json"):
            path = folder / name
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            target = data["session"] if name == "transcript.json" else data
            target.update(changes)
            indent = 1 if name == "transcript.json" else None
            write_atomic(path, json.dumps(data, ensure_ascii=False, indent=indent))


def stamp(folder: Path, step: Step) -> None:
    """Record that `step` finished at its current version."""
    try:
        meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        meta = {}
    patch_session(folder, {"pipeline": {**recorded(meta), step.name: step.version}})


# ------------------------------------------------------------------ keeping what was there


def ensure_restore_point(folder: Path) -> None:
    """Improve's restore point (`transcript.orig.json`), taken before the first step that rewrites words."""
    backup = folder / RESTORE_POINT
    if not backup.exists():
        write_atomic(backup, (folder / "transcript.json").read_bytes())


def trash_copy(root: Path, page: Path) -> Path | None:
    """A copy of a vault note in `.trash/` (Obsidian's convention), kept when the note is rewritten in place."""
    try:
        body = page.read_bytes()
    except OSError:
        return None
    trash = root / ".trash"
    dest = trash / f"{page.stem} {time.strftime('%Y%m%d-%H%M%S')}.md"
    write_atomic(dest, body)
    return dest


def reset_review(folder: Path) -> None:
    """Archive review.json and keep only the items somebody decided on, so the rest are derived again.
    Decisions stay: a fact the owner rejected does not come back."""
    path = folder / "review.json"
    with review._lock_for(folder.name):  # noqa: SLF001 - the same lock the review API holds
        try:
            raw = path.read_text(encoding="utf-8")
            saved = json.loads(raw)
            decisions = saved["decisions"]
            items = saved["items"]
        except (OSError, ValueError, KeyError, TypeError):
            return
        write_atomic(folder / f"review.{ARCHIVE}-{time.time_ns()}.json", raw)
        saved["items"] = [i for i in items if isinstance(i, dict) and i.get("id") in decisions]
        write_atomic(path, json.dumps(saved, ensure_ascii=False))


def recap_options(raw) -> recap.Options:
    """The options a recap was built with, checked: the file is data, not trusted."""
    options = recap.Options()
    if not isinstance(raw, dict):
        return options
    if raw.get("voice") in ("narrator", "chronicle", "bullets"):
        options.voice = raw["voice"]
    if isinstance(raw.get("length_s"), int) and 10 <= raw["length_s"] <= 300:
        options.length_s = raw["length_s"]
    include = raw.get("include")
    if isinstance(include, dict):
        for key in ("happened", "quote", "moments", "questions"):
            if isinstance(include.get(key), bool):
                setattr(options.include, key, include[key])
    return options


# ------------------------------------------------------------------ the job

_cancelled: set[str] = set()
_cancel_lock = threading.Lock()


def request_cancel(job_id: str) -> None:
    """Stop the job with this id before its next step. A step in progress finishes."""
    with _cancel_lock:
        _cancelled.add(job_id)


def _was_cancelled(job_id: str) -> bool:
    with _cancel_lock:
        return job_id in _cancelled


def _child(parent: Job, step: Step) -> Job:
    """A scratch job for one step. The existing jobs set done/total/steps for themselves; this keeps that off
    the refresh job's own step list and relays only the message, the live model line and the finds."""
    child = Job(id=parent.id, kind=step.name, title=parent.title)

    def relay() -> None:
        text = f"{step.label}: {child.message}" if child.message else step.label
        parent.update(message=text, live=child.live, snippets=child.snippets)

    child.on_change = relay
    return child


def make_plan(run: Run, steps: Sequence[Step] = STEPS, only_stale: bool = False) -> list[Step]:
    """The steps a refresh runs: those that can run on this session (and, for an upgrade, are out of date)."""
    wanted = {s.name for s in stale(run, steps)} if only_stale else None
    return [s for s in steps if s.available and s.skip(run) is None and (wanted is None or s.name in wanted)]


def refresh(job: Job, run: Run, steps: Sequence[Step] = STEPS, only_stale: bool = False) -> None:
    """The job: run every step that can run (or only the stale ones), in order, recording each as it finishes."""
    if run.engine.status != "idle":
        raise ValueError("A session is running. Refreshing waits until it ends.")
    plan = make_plan(run, steps, only_stale)
    if not plan:
        job.update(message="Nothing to refresh")
        return
    if llm_steps(plan) and (problem := run.memory.llm.problem()) is not None:
        raise ValueError(problem)
    job.plan(*(s.label for s in plan))
    if any(s.name in REWRITES for s in plan):
        ensure_restore_point(run.folder)
    try:
        for i, step in enumerate(plan):
            if _was_cancelled(job.id):
                job.update(message=f"Stopped after {i} of {len(plan)} steps; what finished is kept")
                return
            job.step(i)
            child = _child(job, step)
            try:
                step.run(run, child)
            except Exception as e:
                raise RuntimeError(f"{step.label} failed ({e}). Earlier steps are kept.") from e
            stamp(run.folder, step)
            job.created += [x for x in child.created if x not in job.created]
            job.updated += [x for x in child.updated if x not in job.updated]
            job.suggested += child.suggested
            job.note = child.note or job.note
    finally:
        with _cancel_lock:
            _cancelled.discard(job.id)
    job.step(len(plan))
    summary = f"Refreshed {len(plan)} step{'s' if len(plan) != 1 else ''}"
    if job.suggested:
        summary += f"; {job.suggested} suggestion{'s' if job.suggested != 1 else ''} to review"
    job.update(message=summary)


def upgradable(engine: "Engine", memory: "Memory") -> list[tuple[str, list[Step]]]:
    """(session id, its stale steps) for the open campaign's saved sessions, oldest first."""
    written = memory.written_up()
    out = []
    for folder in sorted(engine.campaign_sessions(), key=lambda f: f.name):
        if not SESSION_ID.fullmatch(folder.name):
            continue
        todo = stale(Run(engine, memory, folder.name, written))
        if todo:
            out.append((folder.name, todo))
    return out
