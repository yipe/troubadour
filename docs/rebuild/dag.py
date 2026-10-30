#!/usr/bin/env python3
"""Validate the rebuild DAG and print what to run.

    python3 docs/rebuild/dag.py                  # validate, print waves
    python3 docs/rebuild/dag.py --done P0,B1,W1  # tasks whose deps are all done (and that aren't done)
    python3 docs/rebuild/dag.py --mermaid        # graph for README.md

Checks: unique ids, known deps, no cycles, a spec file per task, and that any two tasks that may run
at the same time (neither reaches the other) own disjoint paths.
"""

import argparse
import sys
import tomllib
from itertools import combinations
from pathlib import Path

HERE = Path(__file__).parent


def load() -> dict[str, dict]:
    data = tomllib.loads((HERE / "dag.toml").read_text())
    tasks: dict[str, dict] = {}
    for t in data["task"]:
        if t["id"] in tasks:
            sys.exit(f"duplicate id {t['id']}")
        t["owns"] = [o.format(**data["vars"]) for o in t["owns"]]
        tasks[t["id"]] = t
    return tasks


def ancestors(tasks: dict[str, dict]) -> dict[str, set[str]]:
    memo: dict[str, set[str]] = {}

    def walk(tid: str, stack: tuple[str, ...]) -> set[str]:
        if tid in stack:
            sys.exit(f"cycle: {' -> '.join(stack + (tid,))}")
        if tid not in memo:
            out: set[str] = set()
            for d in tasks[tid]["deps"]:
                out |= {d} | walk(d, stack + (tid,))
            memo[tid] = out
        return memo[tid]

    for tid in tasks:
        walk(tid, ())
    return memo


def overlap(a: str, b: str) -> bool:
    return a == b or (a.endswith("/") and b.startswith(a)) or (b.endswith("/") and a.startswith(b))


def waves(tasks: dict[str, dict]) -> list[list[str]]:
    level: dict[str, int] = {}

    def depth(tid: str) -> int:
        if tid not in level:
            level[tid] = 1 + max((depth(d) for d in tasks[tid]["deps"]), default=-1)
        return level[tid]

    for tid in tasks:
        depth(tid)
    out: list[list[str]] = [[] for _ in range(max(level.values()) + 1)]
    for tid in tasks:
        out[level[tid]].append(tid)
    return out


def validate(tasks: dict[str, dict]) -> list[str]:
    errors = []
    for t in tasks.values():
        errors += [f"{t['id']}: unknown dep {d}" for d in t["deps"] if d not in tasks]
        if not (HERE / "tasks" / f"{t['id']}.md").exists():
            errors.append(f"{t['id']}: missing tasks/{t['id']}.md")
    if errors:
        return errors
    anc = ancestors(tasks)
    for a, b in combinations(tasks, 2):
        if a in anc[b] or b in anc[a]:
            continue
        for pa in tasks[a]["owns"]:
            for pb in tasks[b]["owns"]:
                if overlap(pa, pb):
                    errors.append(f"{a} and {b} can run together but both own {pa if len(pa) <= len(pb) else pb}")
    return errors


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--done", default="")
    p.add_argument("--mermaid", action="store_true")
    args = p.parse_args()
    tasks = load()
    errors = validate(tasks)
    if errors:
        print("\n".join(errors))
        sys.exit(1)
    if args.mermaid:
        print("graph LR")
        for t in tasks.values():
            for d in t["deps"]:
                print(f"  {d} --> {t['id']}")
        return
    if args.done:
        done = set(args.done.split(","))
        ready = [t for t in tasks.values() if t["id"] not in done and set(t["deps"]) <= done]
        for t in ready:
            print(f"{t['id']:4} {t['size']}  {t['title']}")
        return
    for i, wave in enumerate(waves(tasks)):
        print(f"wave {i}: " + ", ".join(f"{tid}({tasks[tid]['size']})" for tid in wave))
    print(f"{len(tasks)} tasks, DAG ok, no ownership conflicts")


if __name__ == "__main__":
    main()
