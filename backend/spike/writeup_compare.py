"""Run the write-up for one session with several LM Studio models, side by side.

Works on a scratch COPY of the campaign so ~/troubador is never written:
  uv run python spike/writeup_compare.py 2026-10-22_192432-a64d qwen/qwen3.8-27b google/gemma-4-26b-a4b-qat
Output: /tmp/writeup_compare/<model>.md (the session note) for diffing against what really happened.
"""

import shutil
import sys
import tempfile
import time
from pathlib import Path

from troubadour import config, memory
from troubadour.campaign import Vault


class _Bus:
    def emit(self, *_):
        pass


def main(sid: str, models: list[str]) -> None:
    out = Path("/tmp/writeup_compare")
    out.mkdir(exist_ok=True)
    for spec in models:
        model, _, reasoning = spec.partition("@")  # model[@none|low|medium|high]
        reasoning = reasoning or "none"
        work = Path(tempfile.mkdtemp(prefix="wu-"))
        shutil.copytree(config.DATA_DIR / "campaign", work / "campaign")
        (work / "sessions").mkdir()
        shutil.copytree(config.DATA_DIR / "sessions" / sid, work / "sessions" / sid, ignore=shutil.ignore_patterns("*.wav", "*.flac", "*.m4a"))
        config.MEMORY_REASONING = reasoning
        vault = Vault(work / "campaign")
        mem = memory.Memory(vault, _Bus(), llm=memory.MemoryLLM(model=model, timeout=3000), sessions_dir=lambda: work / "sessions")
        t = time.monotonic()
        job = mem.write_up(sid)
        while job.state in ("queued", "running"):
            time.sleep(1)
        print(f"{spec}: {job.state} in {time.monotonic() - t:.0f}s {job.message}")
        note = mem._session_note(sid)
        (out / (spec.replace("/", "_") + ".md")).write_text(note.read_text() if note else job.message)
        shutil.rmtree(work)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
