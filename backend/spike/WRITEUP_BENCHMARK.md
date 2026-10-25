# Benchmarking session write-ups

How the write-up pipeline was measured, so a change can be checked against numbers instead of a read-through.
Findings and the reasons behind the pipeline are in `PLAN.md`, "Session write-ups".

## Tools

- `writeup_compare.py SID model[@reasoning] …`: the production write-up (`Memory._write_up`) on a scratch copy of
  the vault. Saves each page and every prompt/reply (`*.calls.json`) to `/tmp/writeup_compare/`. Knobs:
  `WU_CHUNK` (chars per part), `WU_TAG` (file suffix), `TROUBADOUR_LLM_URL` (another server).
- `writeup_oneshot.py SID MODEL`: one call over the whole labelled transcript. Flags: `--openrouter` (sends the
  transcript to OpenRouter; key in `~/.openrouter_key`), `--record` (another transcript, e.g. a re-transcribed
  copy), `--temperature`, `--tag`, `--dump` (print the labelled transcript a grader checks claims against).

Both read the session and vault read-only. Load big local models with one slot so a 40k-token session fits:
`lms load MODEL --context-length 65536 --parallel 1` (with `--parallel 4` each request gets a quarter).

## Scoring

Atomic facts (FActScore-style), scored out of 40:
- recall (28): weighted gold facts the page states (full or half credit);
- precision (8): minus 1.5 per known error repeated, minus 0.5 per other unsupported claim;
- readability (4): repetition across sections, stale "Still open" items.

The gold set is the players' own corrections of a generated page, turned into ~50 weighted facts and ~20 known
errors. It is campaign-private and lives in the data dir (`benchmarks/<session>/`: `gold_facts.json`,
`known_errors.json`, `score_spec.md`, the scored pages), never in the repo. A strong model grades with the spec;
expect about ±2 points of grader noise, and check its "unsupported" calls against the gold before trusting a
small difference.

Lessons about the method itself:
- Holistic rubric grading swung ±4 between identical pages; atomic facts are steadier.
- Keep a gold set honest: three rounds of player corrections turned some "known errors" into true facts.
- Temperature 0 runs are reproducible only when nothing else shares the GPU.
