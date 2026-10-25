"""Benchmark a whole-session write-up: one call over a saved session's labelled transcript.

The production write-up is `Memory._write_up`; this is the bare experiment behind its one-shot step, for
comparing models, settings and transcripts on one session (see PLAN.md, "Session write-ups"). It reads the
session and campaign read-only and writes only under --out.

  uv run python spike/writeup_oneshot.py SID MODEL                       # LM Studio at TROUBADOUR_LLM_URL
  uv run python spike/writeup_oneshot.py SID anthropic/claude-sonnet-5.5 --openrouter   # key in ~/.openrouter_key
  uv run python spike/writeup_oneshot.py SID MODEL --record other.json --temperature 0.3 --tag=-t03
  uv run python spike/writeup_oneshot.py SID --dump                       # the labelled transcript a grader reads

Load big local models with one slot so the session fits: `lms load MODEL --context-length 65536 --parallel 1`.
"""

import argparse
import json
import time
from pathlib import Path

from troubadour import config
from troubadour import memory as m
from troubadour.campaign import Vault

SYSTEM = """You write the recap of a Dungeons & Dragons session from its whole speech-to-text transcript, for a player who
missed it. The transcript mishears words; the glossary has the right names. Lines are labelled with who spoke; the GM
narrates and speaks for every NPC and monster. Players joke, plan and talk about real life: only what happens in the
game counts. Be accurate before being complete: leave out a detail you are not sure of (who did it, a number) rather
than guess. Keep who did what to whom, motives that were said, debts and deals, who was hurt and how badly, names of
NPCs, and how the session ended.
hook: one sentence, the session's main turns.
summary: one paragraph, at most 150 words.
timeline: 8 to 14 beats in order, each one sentence, each with the clock time it starts (as written in the transcript).
moments: up to 5 dice or table moments (natural 20s, big damage, a twist), each with its clock time.
open: unresolved threads, up to 5.
Answer with JSON only."""

BEAT = m._obj({"at": m.STR, "text": m.STR})
SCHEMA = m._obj(
    {
        "hook": m.STR,
        "summary": m.STR,
        "timeline": {"type": "array", "items": BEAT},
        "moments": {"type": "array", "items": BEAT},
        "open": m.STRS,
    }
)


def beat(b: dict) -> dict:
    """Hosted models without enforced schemas sometimes say time/beat instead of at/text."""
    return {"at": b.get("at") or b.get("time") or "", "text": b.get("text") or b.get("beat") or ""}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("sid")
    ap.add_argument("model", nargs="?")
    ap.add_argument("--record", help="a transcript.json to use instead of the saved one (e.g. a re-transcribed copy)")
    ap.add_argument("--openrouter", action="store_true", help="send to OpenRouter (the transcript leaves this Mac)")
    ap.add_argument("--temperature", type=float, default=0.0)
    ap.add_argument("--max-tokens", type=int, default=6000)
    ap.add_argument("--tag", default="", help="file-name suffix; write it as --tag=-x (a leading dash)")
    ap.add_argument("--out", default="/tmp/writeup_compare")
    ap.add_argument("--dump", action="store_true", help="print the labelled transcript and exit")
    a = ap.parse_args()

    path = Path(a.record) if a.record else config.DATA_DIR / "sessions" / a.sid / "transcript.json"
    record = json.loads(path.read_text())
    vault = Vault(config.DATA_DIR / "campaign")
    lines, cast = m.transcript_lines(record)
    lines = m.apply_heard_as(lines, vault.entities())
    if a.dump:
        print("\n".join(lines))
        return
    if not a.model:
        ap.error("MODEL is required unless --dump")

    if a.openrouter:
        key = (Path.home() / ".openrouter_key").read_text().strip()
        llm = m.MemoryLLM(url="https://openrouter.ai/api/v1", model=a.model, timeout=5400, api_key=key)
    else:
        llm = m.MemoryLLM(model=a.model, timeout=5400)
    post = llm.client.post

    def tuned(url, **kw):
        # Qwen-family templates ignore reasoning_effort on long prompts and think until max_tokens (MTPLX, Nemotron).
        body = kw.setdefault("json", {})
        body.setdefault("chat_template_kwargs", {"enable_thinking": False})
        body["temperature"] = a.temperature
        if a.temperature:
            body.update(top_p=0.8, top_k=20)
        return post(url, **kw)

    llm.client.post = tuned
    user = f"Who is at the table:\n{cast}\n\nGlossary:\n{m.glossary_brief(vault)}\n\nTranscript:\n" + "\n".join(lines)
    t = time.monotonic()
    out = llm.json(SYSTEM, user, SCHEMA, a.max_tokens)
    print(f"{a.model}: {time.monotonic() - t:.0f}s, {len(user)} prompt chars")

    page = ["# One-shot recap", "", out.get("hook", ""), "", out.get("summary", ""), "", "## Timeline"]
    page += [f"- [{b['at']}] {b['text']}" for b in map(beat, out.get("timeline") or []) if b["text"]]
    page += ["", "## Table moments"] + [f"- [{b['at']}] {b['text']}" for b in map(beat, out.get("moments") or []) if b["text"]]
    page += ["", "## Still open"] + [f"- {o}" for o in out.get("open") or [] if isinstance(o, str)]
    dest = Path(a.out)
    dest.mkdir(parents=True, exist_ok=True)
    (dest / f"oneshot-{a.model.replace('/', '_')}{a.tag}.md").write_text("\n".join(page))


if __name__ == "__main__":
    main()
