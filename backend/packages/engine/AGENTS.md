# troubadour-engine

The live session engine and the work on saved sessions. `Engine` (`core.py`) is assembled from mixins:
`_pipeline` (listening threads, notebook loop), `_sessions` (saved sessions: list, merge/unmerge, delete to
`.trash`), `_library` (players, campaigns), `_voices`, `_training`. Also `notebook`, `pipeline` (versioned
refresh/upgrade steps), `improve`, `cloning`, `sim`. `__init__` re-exports the names other packages use.

- May import `core`, `sound`, `lore` and `cloud`. Never `server`.
- Patch a symbol in the module that reads it (`troubadour.engine._pipeline.X`); a patch on a re-export does nothing.
- Mixins hold no state of their own and never import each other; each docstring lists the `Engine` attributes it uses.
- Never delete a saved session's files: move them (`sessions/.trash/`, `<id>/.premerge/`). Every scan uses `*/…` globs, which skip both.
- Bump a step's `VERSION` in `pipeline.py` only when its output meaningfully changes (it marks old sessions for upgrade).
- Never start real mic sessions in tests; the mic is faked. `TROUBADOUR_MODELS=0` skips loading models.
