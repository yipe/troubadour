"""Run the write-up for one session with several LM Studio models, side by side.

Works on a scratch COPY of the campaign so ~/troubador is never written:
  uv run python spike/writeup_compare.py 2026-10-22_192432-a64d qwen/qwen3.8-27b google/gemma-4-26b-a4b-qat
Output: /tmp/writeup_compare/<model>.md (the session note) for diffing against what really happened.
"""

import json
import os
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
    # Experiment knobs, e.g. WU_CHUNK=8000 (chars of transcript per write-up call).
    if os.environ.get("WU_CHUNK"):
        memory.TRANSCRIPT_CHUNK_CHARS = int(os.environ["WU_CHUNK"])
    out = Path("/tmp/writeup_compare")
    out.mkdir(exist_ok=True)
    for spec in models:
        model, _, reasoning = spec.partition("@")  # model[@none|low|medium|high]
        reasoning = reasoning or "none"
        work = Path(tempfile.mkdtemp(prefix="wu-"))
        shutil.copytree(config.DATA_DIR / "campaign", work / "campaign")
        (work / "sessions").mkdir()
        shutil.copytree(
            config.DATA_DIR / "sessions" / sid, work / "sessions" / sid, ignore=shutil.ignore_patterns("*.wav", "*.flac", "*.m4a")
        )
        config.MEMORY_REASONING = reasoning
        vault = Vault(work / "campaign")
        llm = memory.MemoryLLM(model=model, timeout=3000)
        calls = []  # every prompt and reply, to see which step lost a beat
        ask = llm.json

        def logged(system, user, schema, max_tokens=4000, ask=ask, calls=calls):
            reply = ask(system, user, schema, max_tokens)
            calls.append({"system": system[:60], "user_tail": user[-300:], "reply": reply})
            return reply

        llm.json = logged
        mem = memory.Memory(vault, _Bus(), llm=llm, sessions_dir=lambda: work / "sessions")
        t = time.monotonic()
        job = mem.write_up(sid)
        while job.state in ("queued", "running"):
            time.sleep(1)
        print(f"{spec}: {job.state} in {time.monotonic() - t:.0f}s {job.message}")
        note = mem._session_note(sid)
        (out / (spec.replace("/", "_") + os.environ.get("WU_TAG", "") + ".md")).write_text(note.read_text() if note else job.message)
        (out / (spec.replace("/", "_") + os.environ.get("WU_TAG", "") + ".calls.json")).write_text(json.dumps(calls, indent=1))
        shutil.rmtree(work)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
