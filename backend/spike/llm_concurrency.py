"""How much does a local model server gain from concurrent requests? Throughput at 1, 2, 4 and 8 at once.

  uv run python spike/llm_concurrency.py TRANSCRIPT.json [--url URL] [--model MODEL]

Each request is a write-up-sized call: a ~12k-char stretch of a real transcript (a different stretch per request,
so no prompt is a cached copy of another) and a JSON reply of up to 600 tokens, thinking off. Then one
whole-session read alone, and the same read with three short calls beside it (does the long call slow down?).
Prints wall time, the slowest request, and output tokens per second across all requests.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import time
from pathlib import Path

from lab_llm import DEFAULT_MODEL, DEFAULT_URL, LabLLM

from troubadour import memory as m

SCHEMA = m._obj({"beats": {"type": "array", "items": m._obj({"at": m.STR, "text": m.STR})}})
SYSTEM = """You are the note-taker for a Dungeons & Dragons session. From this stretch of transcript, write beats:
5 to 8 entries, each at = the timestamp where it starts, text = one specific sentence of what happened.
Answer with JSON only."""


def one(server: LabLLM, part: str, max_tokens: int = 600) -> tuple[float, int, int]:
    llm = LabLLM(url=server.url, model=server.model)  # its own call log: requests run side by side
    t = time.monotonic()
    llm.json(SYSTEM, f"Transcript:\n{part}", SCHEMA, max_tokens)
    usage = (llm.calls[0]["usage"] if llm.calls else None) or {}
    return time.monotonic() - t, usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0)


def batch(llm: LabLLM, parts: list[str]) -> dict:
    t = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(parts)) as pool:
        results = list(pool.map(lambda p: one(llm, p), parts))
    wall = time.monotonic() - t
    out_tokens = sum(r[2] for r in results)
    return {
        "n": len(parts),
        "wall_s": round(wall, 1),
        "slowest_s": round(max(r[0] for r in results), 1),
        "out_tok_per_s": round(out_tokens / wall, 1),
        "prompt_tokens": sum(r[1] for r in results),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("transcript", type=Path)
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    a = ap.parse_args()
    record = json.loads(a.transcript.read_text())
    lines, cast = m.transcript_lines(record)
    parts = m.chunks("\n".join(lines).replace("\n", "\n\n"), 12000)
    llm = LabLLM(url=a.url, model=a.model)
    offset = 0
    for n in (1, 2, 4, 8):
        chosen = [parts[(offset + i) % len(parts)] for i in range(n)]
        offset += n
        print(json.dumps(batch(llm, chosen)), flush=True)

    whole = "\n".join(lines)
    t = time.monotonic()
    elapsed, prompt, out = one(llm, whole, 1500)
    print(json.dumps({"long_read_alone_s": round(elapsed, 1), "prompt_tokens": prompt, "out_tokens": out}), flush=True)
    # Same long read (a different tail so it isn't cached) with three short calls beside it.
    whole2 = "\n".join(lines[5:])
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        long_job = pool.submit(one, llm, whole2, 1500)
        shorts = [pool.submit(one, llm, parts[(offset + i) % len(parts)]) for i in range(3)]
        elapsed, prompt, out = long_job.result()
        short_times = [s.result()[0] for s in shorts]
    print(
        json.dumps(
            {"long_read_with_3_short_s": round(elapsed, 1), "short_s": [round(x, 1) for x in short_times], "out_tokens": out}
        ),
        flush=True,
    )
    print(f"total {time.monotonic() - t:.0f}s", flush=True)


if __name__ == "__main__":
    main()
