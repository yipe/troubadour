"""Regenerate `srd_terms.json`, the committed SRD vocabulary, from a local JSON data checkout.

Usage: uv run spike/build_srd_terms.py --data /path/to/data [--out PATH] [--check]

An entry is taken ONLY when the data marks it as SRD content: a truthy `srd` (SRD 5.1) or `srd52`
(SRD 5.2) field. Nothing else is read, so an unflagged name can never reach the committed list. A
string flag is the name the SRD itself uses ("Melf's Acid Arrow" -> "Acid Arrow"), so that is what
we emit. `--check` regenerates in memory and fails when the committed file differs.

The data checkout stays on your machine; only the names it flags as SRD are committed
(CC-BY-4.0, attribution in the file; see AGENTS.md rule 5).
"""

import argparse
import json
import re
import sys
from pathlib import Path

OUT = Path(__file__).parents[1] / "packages/lore/src/troubadour/lore/srd_terms.json"
MAX_NAME = 60  # dnd_terms.MAX_NAME

LICENSE = (
    "This work includes material from the System Reference Document 5.1 and 5.2 (SRD 5.1, SRD 5.2) by "
    "Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD is licensed under the "
    "Creative Commons Attribution 4.0 International License, "
    "https://creativecommons.org/licenses/by/4.0/legalcode."
)

# (term type, file glob under the data dir, the arrays in it that hold named entries)
SOURCES: list[tuple[str, str, tuple[str, ...]]] = [
    ("creature", "bestiary/bestiary-*.json", ("monster",)),
    ("spell", "spells/spells-*.json", ("spell",)),
    ("item", "items.json", ("item", "itemGroup")),
    ("item", "items-base.json", ("baseitem",)),
    ("npc", "deities.json", ("deity",)),
    ("term", "actions.json", ("action",)),
    ("term", "backgrounds.json", ("background",)),
    ("term", "class/class-*.json", ("class", "subclass")),
    ("term", "conditionsdiseases.json", ("condition", "disease", "status")),
    ("term", "feats.json", ("feat",)),
    ("term", "items-base.json", ("itemMastery",)),
    ("term", "languages.json", ("language",)),
    ("term", "optionalfeatures.json", ("optionalfeature",)),
    ("term", "races.json", ("race", "subrace")),
    ("term", "senses.json", ("sense",)),
    ("term", "skills.json", ("skill",)),
    ("term", "trapshazards.json", ("hazard", "trap")),
    ("term", "variantrules.json", ("variantrule",)),
]

_QUALIFIER = re.compile(r"\s*\([^)]*\)$")  # "Acid (vial)" -> "Acid"
_SIZE = re.compile(r",\s*\d.*$")  # "Carpet of Flying, 3 ft. × 5 ft." -> "Carpet of Flying"
_ENCHANTMENT = re.compile(r"^[+-]\d+\s")  # "+1 Wand of the War Mage": a variant, not a name


def srd_names(entry: dict) -> set[str]:
    """The names an entry is known by in the SRD; empty when it is not SRD content."""
    names: set[str] = set()
    for flag in (entry.get("srd52"), entry.get("srd")):
        if isinstance(flag, str):
            names.add(flag)
        elif flag and isinstance(entry.get("name"), str):
            names.add(entry["name"])
    return names


def clean(name: str) -> str | None:
    name = _SIZE.sub("", _QUALIFIER.sub("", name)).strip()
    if not name or len(name) > MAX_NAME or _ENCHANTMENT.match(name):
        return None
    return name


def extract(data_dir: Path) -> list[tuple[str, str]]:
    """Sorted, de-duplicated `(name, type)` pairs for every SRD-flagged entry under `data_dir`."""
    found: set[tuple[str, str]] = set()
    for kind, pattern, keys in SOURCES:
        for path in sorted(data_dir.glob(pattern)):
            doc = json.loads(path.read_text())
            for key in keys:
                for entry in doc.get(key, []):
                    for name in srd_names(entry):
                        if cleaned := clean(name):
                            found.add((cleaned, kind))
    return sorted(found, key=lambda t: (t[0].casefold(), t[0], t[1]))


def render(terms: list[tuple[str, str]]) -> str:
    """One term per line, so a regenerated list diffs readably."""
    head = json.dumps({"license": LICENSE, "source": "SRD 5.1 and SRD 5.2"}, indent=0)[:-2]
    rows = ",\n".join(json.dumps(list(t), ensure_ascii=False) for t in terms)
    return f'{head},\n"terms": [\n{rows}\n]\n}}\n'


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--data", type=Path, required=True, help="the JSON data directory")
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--check", action="store_true", help="fail if --out is not up to date")
    args = ap.parse_args()
    if not args.data.is_dir():
        sys.exit(f"--data {args.data} is not a directory")
    terms = extract(args.data)
    if not terms:
        sys.exit(f"no SRD-flagged entries under {args.data}; is that the data directory?")
    text = render(terms)
    if args.check:
        if args.out.read_text() != text:
            sys.exit(f"{args.out} is out of date; rerun without --check")
        print(f"{args.out} is up to date ({len(terms)} terms)")
        return 0
    args.out.write_text(text)
    by_type: dict[str, int] = {}
    for _, kind in terms:
        by_type[kind] = by_type.get(kind, 0) + 1
    print(f"wrote {len(terms)} terms to {args.out}: {by_type}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
