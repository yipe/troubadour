"""Score a session write-up against a gold page (facts recalled, errors made, entities found).

Gold pages are campaign-private (keep them out of the repo, e.g. backend/local/gold/<sid>.md). Their format:
`## Gold facts` lines `- [weight 1-3] [H:MM:SS] fact`, `## Known traps`, `## People and creatures met`,
`## Places`, and the rest of the page as the reference a sentence is checked against.

  uv run python spike/writeup_score.py GOLD.md PAGE.md [--judge MODEL] [--json out.json]

A local LLM judges each fact ("does the write-up state this?") and must quote the write-up; a quote that is
not in it doesn't count, so the judge can't credit what isn't there. Each sentence of the story sections is
checked against the gold page; a contradiction (or a repeated known trap) is an error.

Score (out of 100): 50 x weighted recall in the story (Last time + What happened / the description),
20 x weighted recall in Last time alone (the wrap-up), 10 x recall anywhere on the page, then 20 minus 1.5
per error (not below 0).
"""

from __future__ import annotations

import argparse
import concurrent.futures
import difflib
import hashlib
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from lab_llm import DEFAULT_MODEL, DEFAULT_URL, LabLLM

from troubadour import memory as m

CACHE = Path("/tmp/writeup_score_cache")
FACT_BATCH = 10
CLAIM_BATCH = 12
QUOTE_MATCH = 0.8  # share of a quote that must appear in the page, in one piece
ERROR_COST = 1.5

FACT_SCHEMA = m._obj(
    {
        "results": {
            "type": "array",
            "items": m._obj(
                {"n": {"type": "integer"}, "verdict": {"type": "string", "enum": ["yes", "partly", "no"]}, "quote": m.STR}
            ),
        }
    }
)

FACT_SYSTEM = """You check whether a Dungeons & Dragons session write-up states given facts.
You get the write-up and a numbered list of facts. For each fact:
verdict: "yes" if the write-up states it (same meaning; wording and name spellings may differ), "partly" if it
states part of it or something close but vaguer, "no" if it is missing or the write-up says otherwise.
quote: the shortest span copied exactly from the write-up that states it; "" when the verdict is "no".
Judge each fact on its own. Do not credit a fact the write-up only hints at. Answer with JSON only."""

CLAIM_SCHEMA = m._obj(
    {
        "results": {
            "type": "array",
            "items": m._obj(
                {
                    "n": {"type": "integer"},
                    "verdict": {"type": "string", "enum": ["supported", "contradicted", "not covered"]},
                    "reference_quote": m.STR,
                    "why": m.STR,
                }
            ),
        }
    }
)

CLAIM_SYSTEM = """You check sentences from a Dungeons & Dragons session write-up against a careful reference
page about the same session (written from the full transcript; it lists facts, what happened, who and what was
met, loot, things a writer is likely to get wrong under "Known traps", and what is uncertain).
For each numbered sentence, verdict:
"supported": the reference shows it (wording may differ; a little vaguer or a little more detailed is fine).
"contradicted": the reference clearly states something that cannot also be true: a different person did it, it
happened to someone else, a different outcome, a different number, an event the reference says did not happen,
or the sentence repeats a known trap. reference_quote = the exact words from the reference that show this.
"not covered": anything else, including extra details the reference doesn't mention, a spell or method the
reference doesn't name, or something the reference lists as uncertain. Missing detail is never a contradiction.
Ignore timestamps and the order of clauses inside a sentence. reference_quote is "" unless contradicted.
why: a few words. Answer with JSON only."""

CONFLICT_SCHEMA = m._obj({"answer": {"type": "string", "enum": ["compatible", "incompatible"]}, "why": m.STR})

CONFLICT_SYSTEM = """You compare two statements about the same Dungeons & Dragons session.
A is from a write-up; B is from a careful reference written from the transcript.
answer "incompatible" only if A and B cannot both be true: a different person did it or it happened to someone
else, a different outcome, a different number for the same thing, or B says A's event did not happen.
answer "compatible" if both can be true, including when A adds details, names a spell or method, or is vaguer
or more specific than B. Answer with JSON only."""

STORY = re.compile(r"last time|what happened|session|summary|recap|story|description", re.I)
LAST = re.compile(r"last time|summary|recap", re.I)


@dataclass
class Gold:
    facts: list[tuple[int, str, str]]  # weight, at, text
    traps: list[str]
    names: list[str]  # people, creatures and places (first bold name of each bullet)
    reference: str


@dataclass
class Page:
    sections: dict[str, str]  # heading -> text ("" heading: the paragraph before the first ##)
    last: str = ""
    story: str = ""
    whole: str = ""
    claims: list[str] = field(default_factory=list)


def plain(text: str) -> str:
    text = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", text)
    text = re.sub(r"\[\[([^\]]*)\]\]", r"\1", text)
    return text.replace("**", "")


def sections(md: str) -> dict[str, str]:
    md = re.sub(r"\A---\n.*?\n---\n", "", md, flags=re.S)
    out: dict[str, list[str]] = {"": []}
    head = ""
    for line in md.splitlines():
        if line.startswith("# "):
            continue
        if line.startswith("## "):
            head = line[3:].strip()
            out[head] = []
            continue
        out[head].append(line)
    return {k: plain("\n".join(v)).strip() for k, v in out.items()}


def parse_gold(path: Path) -> Gold:
    sec = sections(path.read_text(encoding="utf-8"))
    facts = [
        (int(w), at, text.strip())
        for w, at, text in re.findall(r"^- \[weight (\d)\] \[(\d+:\d\d:\d\d)\] (.+)$", sec.get("Gold facts", ""), re.M)
    ]
    traps = [ln[2:].strip() for ln in sec.get("Known traps", "").splitlines() if ln.startswith("- ")]
    names = []
    raw = path.read_text(encoding="utf-8")
    for head in ("People and creatures met", "Places"):
        block = re.search(rf"^## {head}\n(.*?)(?=^## |\Z)", raw, re.S | re.M)
        for bold in re.findall(r"^- \*\*([^*]+)\*\*", block.group(1) if block else "", re.M):
            names.append(re.split(r"[(:]", bold)[0].strip())
    reference = "\n\n".join(f"## {k}\n{v}" for k, v in sec.items() if k not in ("", "Gold facts", "Spotlight", "Highlights"))
    return Gold(facts, traps, [n for n in names if n], reference)


def parse_page(path: Path) -> Page:
    sec = sections(path.read_text(encoding="utf-8"))
    sec = {k: v for k, v in sec.items() if k not in ("Mentioned", "Transcript")}
    last = "\n".join(v for k, v in sec.items() if (k == "" or LAST.search(k)) and v)
    story = "\n".join(v for k, v in sec.items() if (k == "" or STORY.search(k)) and v)
    claims = []
    for k, v in sec.items():
        if not (k == "" or STORY.search(k)):
            continue
        for line in v.splitlines():
            line = re.sub(r"^[-*] ", "", line.strip())
            line = re.sub(r"^\[[\d:]+\]\s*", "", line)  # timestamps are not claims
            claims += [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z\[])", line) if len(s.strip()) > 20]
    whole = "\n\n".join(f"## {k}\n{v}" if k else v for k, v in sec.items() if v)
    return Page(sec, last, story, whole, claims)


def _norm(text: str) -> str:
    text = text.casefold().replace("’", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", re.sub(r"[^\w' ]+", " ", text)).strip()


def found(quote: str, text: str) -> bool:
    pieces = [p for p in re.split(r"\.\.\.|…", quote) if len(p.strip()) >= 8]
    if len(pieces) > 1:  # "a ... b": the judge cut out the middle; each piece must be there
        return all(found(p, text) for p in pieces)
    q, t = _norm(quote), _norm(text)
    if not q:
        return False
    if q in t:
        return True
    match = difflib.SequenceMatcher(None, t, q, autojunk=False).find_longest_match(0, len(t), 0, len(q))
    return match.size >= QUOTE_MATCH * len(q)


def cached(llm, system: str, user: str, schema: dict, max_tokens: int) -> dict:
    CACHE.mkdir(exist_ok=True)
    key = hashlib.sha256(f"{llm.model}\n{system}\n{user}".encode()).hexdigest()[:32]
    path = CACHE / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text())
    out = llm.json(system, user, schema, max_tokens)
    if out:
        path.write_text(json.dumps(out))
    return out


WORKERS = 4  # the judge server takes several requests at once


def _ask_all(llm, system: str, users: list[str], schema: dict) -> list[dict]:
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        return list(pool.map(lambda u: cached(llm, system, u, schema, 2500), users))


def _judge_facts_in(llm, facts: list[tuple[int, str, str]], text: str) -> list[tuple[str, str, float]]:
    """(verdict, quote, credit) for each fact, judged against `text` alone."""
    out = []
    batches = [facts[i : i + FACT_BATCH] for i in range(0, len(facts), FACT_BATCH)]
    users = [
        f"Write-up:\n{text}\n\nFacts:\n" + "\n".join(f"{i + 1}. {fact}" for i, (_, _, fact) in enumerate(batch))
        for batch in batches
    ]
    for batch, reply in zip(batches, _ask_all(llm, FACT_SYSTEM, users, FACT_SCHEMA), strict=True):
        by_n = {r.get("n"): r for r in reply.get("results") or [] if isinstance(r, dict)}
        for i in range(len(batch)):
            r = by_n.get(i + 1, {})
            verdict, quote = r.get("verdict", "no"), r.get("quote") or ""
            if verdict != "no" and not found(quote, text):
                verdict = "no"  # a quote that isn't there: the judge was crediting what isn't on the page
            out.append((verdict, quote, {"yes": 1.0, "partly": 0.5}.get(verdict, 0.0)))
    return out


def judge_facts(llm, gold: Gold, page: Page) -> list[dict]:
    """Each fact judged three ways: in Last time alone, in the story (Last time + description), and anywhere on
    the page. Separate passes, because a judge given the whole page quotes whichever section it likes."""
    last = _judge_facts_in(llm, gold.facts, page.last) if page.last else [("no", "", 0.0)] * len(gold.facts)
    story = _judge_facts_in(llm, gold.facts, page.story) if page.story else [("no", "", 0.0)] * len(gold.facts)
    rest = [i for i, (_, _, credit) in enumerate(story) if credit < 1]
    elsewhere = dict(zip(rest, _judge_facts_in(llm, [gold.facts[i] for i in rest], page.whole), strict=True))
    out = []
    for i, (weight, at, text) in enumerate(gold.facts):
        page_credit = max(story[i][2], elsewhere.get(i, ("", "", 0.0))[2])
        out.append(
            {
                "weight": weight,
                "at": at,
                "fact": text,
                "last": last[i][2],
                "story": max(story[i][2], last[i][2]),
                "page": max(page_credit, last[i][2]),
                "quote": story[i][1] or elsewhere.get(i, ("", "", 0.0))[1],
            }
        )
    return out


def judge_claims(llm, gold: Gold, page: Page) -> list[dict]:
    out = []
    batches = [page.claims[i : i + CLAIM_BATCH] for i in range(0, len(page.claims), CLAIM_BATCH)]
    users = [
        f"Reference page:\n{gold.reference}\n\nSentences to check:\n" + "\n".join(f"{i + 1}. {s}" for i, s in enumerate(batch))
        for batch in batches
    ]
    for batch, reply in zip(batches, _ask_all(llm, CLAIM_SYSTEM, users, CLAIM_SCHEMA), strict=True):
        by_n = {r.get("n"): r for r in reply.get("results") or [] if isinstance(r, dict)}
        for i, sentence in enumerate(batch):
            r = by_n.get(i + 1, {})
            verdict = r.get("verdict", "not covered")
            if verdict == "contradicted" and not found(r.get("reference_quote") or "", gold.reference):
                verdict = "not covered"  # no evidence in the reference: the judge's own reading, not a fact
            out.append(
                {
                    "sentence": sentence,
                    "verdict": verdict,
                    "why": r.get("why", ""),
                    "reference_quote": r.get("reference_quote", ""),
                }
            )
    # A second look at each contradiction on its own: one batch call over-reads "doesn't mention" as "says otherwise".
    flagged = [c for c in out if c["verdict"] == "contradicted"]
    users = [f"A: {c['sentence']}\nB: {c['reference_quote']}" for c in flagged]
    for c, reply in zip(flagged, _ask_all(llm, CONFLICT_SYSTEM, users, CONFLICT_SCHEMA), strict=True):
        if reply.get("answer") != "incompatible":
            c["verdict"] = "not covered"
            c["why"] = f"(second look: compatible) {c['why']}"
    return out


def names_found(gold: Gold, text: str) -> list[tuple[str, bool]]:
    """Each gold person, creature or place, and whether the page names it (any word of 4+ letters of it)."""
    have = _norm(text)
    out = []
    for name in gold.names:
        words = [w for w in re.split(r"[^\w']+", _norm(name)) if len(w) >= 4 and w not in ("the", "with")]
        out.append((name, bool(words) and any(re.search(rf"\b{re.escape(w)}\b", have) for w in words)))
    return out


def _clock(at: str) -> float:
    parts = [int(p) for p in at.split(":")]
    return float(sum(p * 60**i for i, p in enumerate(reversed(parts))))


def score(gold_path: Path, page_path: Path, llm, spellings: str = "") -> dict:
    """`spellings`: the campaign's known other spellings ("Thayrin is also written Phaerimm"), added to the
    reference so a page that uses the vault's spelling isn't called wrong for it."""
    gold, page = parse_gold(gold_path), parse_page(page_path)
    if spellings:
        gold.reference += f"\n\n## Other spellings of the same names\n{spellings}"
    facts = judge_facts(llm, gold, page)
    claims = judge_claims(llm, gold, page)
    total = sum(f["weight"] for f in facts) or 1

    def recall(key: str) -> float:
        return sum(f["weight"] * f[key] for f in facts) / total

    errors = [c for c in claims if c["verdict"] == "contradicted"]
    names = names_found(gold, page.whole)
    r_story, r_last, r_page = recall("story"), recall("last"), recall("page")
    # Last-time recall by thirds of the session (a wrap-up that stops early shows as 0 in the later thirds).
    end = max((_clock(f["at"]) for f in facts), default=0.0) or 1.0
    thirds = []
    for k in range(3):
        part = [f for f in facts if k * end / 3 <= _clock(f["at"]) < (k + 1) * end / 3 + (k == 2)]
        weight = sum(f["weight"] for f in part) or 1
        thirds.append(round(sum(f["weight"] * f["last"] for f in part) / weight, 2))
    result = {
        "score": round(50 * r_story + 20 * r_last + 10 * r_page + max(0.0, 20 - ERROR_COST * len(errors)), 1),
        "recall_story": round(r_story, 3),
        "recall_last": round(r_last, 3),
        "recall_page": round(r_page, 3),
        "errors": len(errors),
        # One wrong beat is usually wrong twice (Last time and What happened): distinct reference quotes.
        "errors_distinct": len({_norm(c["reference_quote"]) for c in errors}),
        "last_thirds": thirds,
        "claims": len(claims),
        "not_covered": sum(1 for c in claims if c["verdict"] == "not covered"),
        "names": round(sum(1 for _, ok in names if ok) / (len(names) or 1), 3),
        "last_words": len(page.last.split()),
        "story_words": len(page.story.split()),
        "facts": facts,
        "claim_checks": claims,
        "names_found": names,
    }
    return result


def vault_spellings(vault_dir: Path) -> str:
    from troubadour.campaign import Vault

    lines = []
    for e in Vault(vault_dir).entities():
        others = [n for n in (*e.aliases, *e.heard_as) if n and n != e.name]
        if others:
            lines.append(f"- {e.name} is also written: {', '.join(others)}")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("gold", type=Path)
    ap.add_argument("page", type=Path)
    ap.add_argument("--judge", default=DEFAULT_MODEL)
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--json", type=Path)
    ap.add_argument("--vault", type=Path, help="campaign folder: its heard-as spellings join the reference")
    a = ap.parse_args()
    llm = LabLLM(url=a.url, model=a.judge)
    result = score(a.gold, a.page, llm, vault_spellings(a.vault) if a.vault else "")
    if a.json:
        a.json.write_text(json.dumps(result, indent=1, ensure_ascii=False))
    brief = {k: v for k, v in result.items() if not isinstance(v, list)}
    print(json.dumps(brief))
    for f in result["facts"]:
        if f["page"] < 1 and f["weight"] == 3:
            print(f"  missed w3 [{f['at']}] {f['fact'][:110]}", file=sys.stderr)
    for c in result["claim_checks"]:
        if c["verdict"] == "contradicted":
            print(f"  error: {c['sentence'][:110]} ({c['why'][:80]})", file=sys.stderr)


if __name__ == "__main__":
    main()
