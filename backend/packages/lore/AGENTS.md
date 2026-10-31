# troubadour-lore

Campaign vault, Obsidian, memory jobs, write-ups, Ask, spelling cleanup, talk, D&D terms (`srd_terms.json`).

- May import `troubadour.core` only. No ML dependencies; never `sound`, `cloud`, `engine` or `server`.
- Any LLM output is untrusted: validate names, types and lengths, and constrain choices before writing.
- Only SRD names are committed in `srd_terms.json` (CC-BY-4.0).
- Never edit `srd_terms.json` by hand: regenerate it with `uv run spike/build_srd_terms.py --data <data dir>`
  (takes only entries the data flags as SRD; `--check` verifies it is current).
- Long work runs as background jobs; never block a request on an LLM.
- Tests: `test_campaign.py`, `test_campaigns.py`, `test_obsidian.py`, `test_memory.py`, `test_writeup.py`, `test_ask.py`, `test_cleanup.py`, `test_talk.py`.
