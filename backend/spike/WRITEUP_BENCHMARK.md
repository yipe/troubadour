# Benchmarking session write-ups

How the write-up is measured, so a change can be checked against numbers instead of a read-through.
Findings and the reasons behind the pipeline are in `PLAN.md`, "Session write-ups".

## Tools

- `writeup_lab.py LAB VARIANT [SID ...]`: runs a variant over the lab's sessions and scores it. `prod` is the
  app's own write-up (`Memory._write_up`, on a scratch copy of the vault); `app` runs `troubadour.writeup`
  directly; the rest are experiments configured in `VARIANTS`. `--rescore` scores existing pages again (after a
  scorer change). Writes `LAB/runs/<variant>/<sid>/{page.md,score.json,calls.json,extra.json}` and a line in
  `LAB/LEDGER.md`.
- `writeup_score.py GOLD PAGE [--vault DIR] [--json OUT]`: scores one page against one gold page.
- `lab_llm.py`: the experiments' JSON-schema client (any OpenAI-compatible server; thinking on or off per call).

`LAB/lab.json` maps each session to its transcript folder, a scratch-able copy of its vault, its gold page and
another campaign's gold page (a style example). Keep the lab under `backend/local/` (git-ignored): it holds
campaign content.

## Gold pages

One per test session, written by a strong model from the whole transcript and corrected by the table:
`## Last time`, `## Spotlight`, `## Highlights`, `## What happened` (timestamped beats), `## People and
creatures met`, `## Places`, `## Loot, money and deals`, `## Still open`, `## Gold facts` (`- [weight 1-3]
[H:MM:SS] fact`, 30-60 of them), `## Known traps`, `## Uncertain`.

## Scoring

Out of 100: 50 x weighted gold-fact recall in the story (Last time + What happened), 20 x recall in Last time
alone, 10 x recall anywhere on the page, plus 20 minus 1.5 per error.

- Facts: the judge (a local LLM) says yes / partly / no for each fact, separately for Last time, the story and
  the whole page, and must quote the page; a quote that isn't on the page doesn't count.
- Errors: each story sentence is checked against the gold page; "contradicted" needs a quote from the gold page
  and then a second, one-pair look ("can both be true?"). The vault's other spellings (heard-as, aliases) join
  the reference so the right name isn't an error. `errors_distinct` counts distinct reference quotes (one
  wrong beat usually shows up twice).
- `last_thirds`: Last-time recall in each third of the session (a wrap-up that stops early shows 0 late).

Calibration: a gold page against itself scores ~74 (the judge misses ~13% of facts that are there). LLM judges
overlook errors (TofuEval, FABLES), so error counts are rough; recall is steadier. Generation at temperature 0
on MTPLX is deterministic, but prompt changes move single sessions by several points: a change counts at +3
mean and 3 of 4 sessions.
